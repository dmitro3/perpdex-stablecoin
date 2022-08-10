// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity >=0.7.6;
pragma abicoder v2;

import { ReentrancyGuard } from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { Multicall } from "@openzeppelin/contracts/utils/Multicall.sol";
import { PRBMath } from "prb-math/contracts/PRBMath.sol";
import { FixedPoint96 } from "@uniswap/v3-core/contracts/libraries/FixedPoint96.sol";
import { IPerpdexExchange } from "../deps/perpdex-contract/contracts/interfaces/IPerpdexExchange.sol";
import { IPerpdexMarket } from "../deps/perpdex-contract/contracts/interfaces/IPerpdexMarket.sol";
import { IWETH9 } from "../deps/perpdex-contract/contracts/interfaces/external/IWETH9.sol";
import { IERC4626 } from "./interfaces/IERC4626.sol";
import { IERC20Metadata } from "./interfaces/IERC20Metadata.sol";

abstract contract PerpdexTokenBase is IERC4626, ReentrancyGuard, ERC20, Multicall {
    using SafeCast for int256;

    address public immutable override asset;
    address public immutable market;
    address public immutable exchange;
    address public immutable weth;

    uint8 private constant DECIMALS = 18;

    modifier onlyWeth() {
        require(weth != address(0), "PTB_OW: weth is not available");
        _;
    }

    constructor(
        address marketArg,
        string memory namePrefix,
        string memory symbolPrefix,
        string memory nativeTokenSymbol,
        address wethArg
    )
        ERC20(
            _getERC20Name(marketArg, namePrefix, nativeTokenSymbol),
            _getERC20Name(marketArg, symbolPrefix, nativeTokenSymbol)
        )
    {
        address exchangeVar = IPerpdexMarket(marketArg).exchange();
        address settlementToken = IPerpdexExchange(exchangeVar).settlementToken();
        address assetVar;

        require(IPerpdexExchange(exchangeVar).quoteDecimals() == DECIMALS, "PTB_C: invalid decimals");

        if (settlementToken == address(0)) {
            require(wethArg != address(0), "PTB_C: weth is required");
            assetVar = wethArg;
        } else {
            require(wethArg == address(0), "PTB_C: weth can not be used");
            assetVar = settlementToken;
        }

        asset = assetVar;
        market = marketArg;
        weth = wethArg;
        exchange = exchangeVar;
    }

    receive() external payable {}

    // make ERC20 external functions non reentrant

    function transfer(address recipient, uint256 amount) public override nonReentrant returns (bool) {
        return ERC20.transfer(recipient, amount);
    }

    function approve(address spender, uint256 amount) public override nonReentrant returns (bool) {
        return ERC20.approve(spender, amount);
    }

    function transferFrom(
        address sender,
        address recipient,
        uint256 amount
    ) public override nonReentrant returns (bool) {
        return ERC20.transferFrom(sender, recipient, amount);
    }

    function increaseAllowance(address spender, uint256 addedValue) public override nonReentrant returns (bool) {
        return ERC20.increaseAllowance(spender, addedValue);
    }

    function decreaseAllowance(address spender, uint256 subtractedValue) public override nonReentrant returns (bool) {
        return ERC20.decreaseAllowance(spender, subtractedValue);
    }

    // ERC4626

    function totalAssets() public view override returns (uint256 totalManagedAssets) {
        int256 value = IPerpdexExchange(exchange).getTotalAccountValue(address(this));
        totalManagedAssets = value < 0 ? 0 : _convertToAssetDecimals(uint256(value));
    }

    function convertToShares(uint256 assets) public view override returns (uint256 shares) {
        uint256 supply = totalSupply();
        if (supply == 0) {
            return
                PRBMath.mulDiv(
                    _convertToPerpdexDecimals(assets),
                    FixedPoint96.Q96,
                    IPerpdexMarket(market).getShareMarkPriceX96()
                );
        }
        return PRBMath.mulDiv(assets, supply, totalAssets());
    }

    function convertToAssets(uint256 shares) public view override returns (uint256 assets) {
        uint256 supply = totalSupply();
        if (supply == 0) {
            return
                PRBMath.mulDiv(
                    _convertToAssetDecimals(shares),
                    IPerpdexMarket(market).getShareMarkPriceX96(),
                    FixedPoint96.Q96
                );
        }
        return PRBMath.mulDiv(shares, totalAssets(), supply);
    }

    function _convertToPerpdexDecimals(uint256 amount) internal view returns (uint256 assets) {
        return PRBMath.mulDiv(amount, 10**DECIMALS, 10**IERC20Metadata(asset).decimals());
    }

    function _convertToAssetDecimals(uint256 amount) internal view returns (uint256 assets) {
        return PRBMath.mulDiv(amount, 10**IERC20Metadata(asset).decimals(), 10**DECIMALS);
    }

    function _beforeTrade(
        bool isBaseToQuote,
        bool isExactInput,
        uint256 amount
    ) private view returns (uint256) {
        if (isBaseToQuote) {
            if (!isExactInput) {
                return _convertToPerpdexDecimals(amount);
            }
        } else {
            if (isExactInput) {
                return _convertToPerpdexDecimals(amount);
            }
        }
        return amount;
    }

    function _afterTrade(
        bool isBaseToQuote,
        bool isExactInput,
        uint256 amount
    ) private view returns (uint256) {
        if (isBaseToQuote) {
            if (isExactInput) {
                return _convertToAssetDecimals(amount);
            }
        } else {
            if (!isExactInput) {
                return _convertToAssetDecimals(amount);
            }
        }
        return amount;
    }

    function _maxTrade(bool isBaseToQuote, bool isExactInput) internal view returns (uint256 maxAmount) {
        maxAmount = IPerpdexExchange(exchange).maxTrade(
            IPerpdexExchange.MaxTradeParams({
                trader: address(this),
                market: market,
                caller: address(this),
                isBaseToQuote: isBaseToQuote,
                isExactInput: isExactInput
            })
        );

        maxAmount = _afterTrade(isBaseToQuote, isExactInput, maxAmount);
    }

    function _tryPreviewTrade(
        bool isBaseToQuote,
        bool isExactInput,
        uint256 amount
    ) internal view returns (bool success, uint256 oppositeAmount) {
        amount = _beforeTrade(isBaseToQuote, isExactInput, amount);
        try
            IPerpdexExchange(exchange).previewTrade(
                IPerpdexExchange.PreviewTradeParams({
                    trader: address(this),
                    market: market,
                    caller: address(this),
                    isBaseToQuote: isBaseToQuote,
                    isExactInput: isExactInput,
                    amount: amount,
                    oppositeAmountBound: isExactInput ? 0 : type(uint256).max
                })
            )
        returns (uint256 v) {
            success = true;
            oppositeAmount = _afterTrade(isBaseToQuote, isExactInput, v);
        } catch {}
    }

    function _previewTrade(
        bool isBaseToQuote,
        bool isExactInput,
        uint256 amount
    ) internal view returns (uint256 oppositeAmount) {
        amount = _beforeTrade(isBaseToQuote, isExactInput, amount);
        oppositeAmount = IPerpdexExchange(exchange).previewTrade(
            IPerpdexExchange.PreviewTradeParams({
                trader: address(this),
                market: market,
                caller: address(this),
                isBaseToQuote: isBaseToQuote,
                isExactInput: isExactInput,
                amount: amount,
                oppositeAmountBound: isExactInput ? 0 : type(uint256).max
            })
        );
        oppositeAmount = _afterTrade(isBaseToQuote, isExactInput, oppositeAmount);
    }

    function _trade(
        bool isBaseToQuote,
        bool isExactInput,
        uint256 amount
    ) internal returns (uint256 oppositeAmount) {
        amount = _beforeTrade(isBaseToQuote, isExactInput, amount);
        oppositeAmount = IPerpdexExchange(exchange).trade(
            IPerpdexExchange.TradeParams({
                trader: address(this),
                market: market,
                isBaseToQuote: isBaseToQuote,
                isExactInput: isExactInput,
                amount: amount,
                oppositeAmountBound: isExactInput ? 0 : type(uint256).max,
                deadline: type(uint256).max
            })
        );
        oppositeAmount = _afterTrade(isBaseToQuote, isExactInput, oppositeAmount);
    }

    function _depositToPerpdex(uint256 amount) internal {
        if (weth == address(0)) {
            IERC20(asset).approve(exchange, type(uint256).max);
            IPerpdexExchange(exchange).deposit(amount);
        } else {
            IPerpdexExchange(exchange).deposit{ value: amount }(0);
        }
    }

    function _withdrawFromPerpdex(uint256 amount) internal {
        IPerpdexExchange(exchange).withdraw(_convertToPerpdexDecimals(amount));
    }

    function _transferAssetTo(address to, uint256 amount) internal {
        if (weth != address(0)) {
            IWETH9(weth).deposit{ value: amount }();
        }
        SafeERC20.safeTransfer(IERC20(asset), to, amount);
    }

    function _transferAssetFromSender(uint256 amount) internal {
        address from = msg.sender;
        address to = address(this);
        SafeERC20.safeTransferFrom(IERC20(asset), from, to, amount);
        if (weth != address(0)) {
            IWETH9(weth).withdraw(amount);
        }
    }

    function _getERC20Name(
        address marketArg,
        string memory prefix,
        string memory nativeTokenSymbol
    ) private view returns (string memory) {
        address settlementToken = IPerpdexExchange(IPerpdexMarket(marketArg).exchange()).settlementToken();

        return
            string(
                abi.encodePacked(
                    prefix,
                    IPerpdexMarket(marketArg).symbol(),
                    settlementToken == address(0) ? nativeTokenSymbol : IERC20Metadata(settlementToken).symbol()
                )
            );
    }
}
