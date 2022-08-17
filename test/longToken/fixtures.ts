// SPDX-License-Identifier: GPL-3.0-or-later
import { MockContract } from "ethereum-waffle"
import { BigNumber, Wallet } from "ethers"
import { ethers, waffle } from "hardhat"
import IPerpdexPriceFeedJson from "../../deps/perpdex-contract/artifacts/contracts/interfaces/IPerpdexPriceFeed.sol/IPerpdexPriceFeed.json"
import { PerpdexLongToken, TestERC20, TestPerpdexExchange, TestPerpdexMarket } from "../../typechain"

export interface PerpdexExchangeFixture {
    perpdexExchange: TestPerpdexExchange
    perpdexMarket: TestPerpdexMarket
    perpdexLongToken: PerpdexLongToken
    weth: TestERC20
    owner: Wallet
    alice: Wallet
    bob: Wallet
    charlie: Wallet
    baseDecimals: number
    priceFeedBase: MockContract
}

interface FixtureParams {
    settlementToken: string
    wethDecimals: number
}

export function createPerpdexExchangeFixture(
    params: FixtureParams = { settlementToken: "weth", wethDecimals: 18 },
): (wallets, provider) => Promise<PerpdexExchangeFixture> {
    return async ([owner, alice, bob, charlie], provider): Promise<PerpdexExchangeFixture> => {
        const tokenFactory = await ethers.getContractFactory("contracts/test/TestERC20.sol:TestERC20")
        let weth = (await tokenFactory.deploy("TestWETH", "WETH", params.wethDecimals)) as TestERC20
        let settlementTokenAddress
        let wethAddress
        let naitiveTokenSymbol

        if (params.settlementToken === "weth") {
            settlementTokenAddress = weth.address
            wethAddress = ethers.constants.AddressZero
            naitiveTokenSymbol = ""
        } else if (params.settlementToken === "ETH") {
            settlementTokenAddress = ethers.constants.AddressZero
            wethAddress = weth.address
            naitiveTokenSymbol = "ETH"
        }

        let baseDecimals = 18

        // exchange
        const accountLibraryFactory = await ethers.getContractFactory(
            "deps/perpdex-contract/contracts/lib/AccountLibrary.sol:AccountLibrary",
        )
        const accountLibrary = await accountLibraryFactory.deploy()
        const makerOrderBookLibraryFactory = await ethers.getContractFactory(
            "deps/perpdex-contract/contracts/lib/MakerOrderBookLibrary.sol:MakerOrderBookLibrary",
            {
                libraries: {
                    AccountLibrary: accountLibrary.address,
                },
            },
        )
        const makerOrderBookLibrary = await makerOrderBookLibraryFactory.deploy()
        const vaultLibraryFactory = await ethers.getContractFactory(
            "deps/perpdex-contract/contracts/lib/VaultLibrary.sol:VaultLibrary",
            {
                libraries: {
                    AccountLibrary: accountLibrary.address,
                },
            },
        )
        const vaultLibrary = await vaultLibraryFactory.deploy()

        const perpdexExchangeFactory = await ethers.getContractFactory(
            "contracts/test/TestPerpdexExchange.sol:TestPerpdexExchange",
            {
                libraries: {
                    AccountLibrary: accountLibrary.address,
                    MakerOrderBookLibrary: makerOrderBookLibrary.address,
                    VaultLibrary: vaultLibrary.address,
                },
            },
        )
        const perpdexExchange = (await perpdexExchangeFactory.deploy(settlementTokenAddress)) as TestPerpdexExchange

        // base priceFeed
        const priceFeedBase = await waffle.deployMockContract(owner, IPerpdexPriceFeedJson.abi)
        await priceFeedBase.mock.getPrice.returns(BigNumber.from(10).pow(12))
        await priceFeedBase.mock.decimals.returns(12)

        // market
        const orderBookLibraryFactory = await ethers.getContractFactory(
            "deps/perpdex-contract/contracts/lib/OrderBookLibrary.sol:OrderBookLibrary",
        )
        const orderBookLibrary = await orderBookLibraryFactory.deploy()
        const perpdexMarketFactory = await ethers.getContractFactory(
            "contracts/test/TestPerpdexMarket.sol:TestPerpdexMarket",
            {
                libraries: {
                    OrderBookLibrary: orderBookLibrary.address,
                },
            },
        )
        const perpdexMarket = (await perpdexMarketFactory.deploy(
            "USD",
            perpdexExchange.address,
            priceFeedBase.address,
            ethers.constants.AddressZero,
        )) as TestPerpdexMarket

        await perpdexMarket.connect(owner).setFundingMaxPremiumRatio(0)
        await perpdexMarket.setPoolFeeConfig({
            fixedFeeRatio: 0,
            atrFeeRatio: 0,
            atrEmaBlocks: 1,
        })
        // long token
        const perpdexLongTokenF = await ethers.getContractFactory("PerpdexLongToken")
        const perpdexLongToken = (await perpdexLongTokenF.deploy(
            perpdexMarket.address,
            wethAddress,
            naitiveTokenSymbol,
        )) as PerpdexLongToken

        return {
            perpdexExchange,
            perpdexMarket,
            perpdexLongToken,
            weth,
            owner,
            alice,
            bob,
            charlie,
            baseDecimals,
            priceFeedBase,
        }
    }
}
