// SPDX-License-Identifier: GPL-3.0-or-later

import { expect } from "chai"
import { BigNumber } from "ethers"
import { ethers, waffle } from "hardhat"
import IPerpdexExchangeJson from "../../deps/perpdex-contract/artifacts/contracts/interfaces/IPerpdexExchange.sol/IPerpdexExchange.json"
import IPerpdexPriceFeedJson from "../../deps/perpdex-contract/artifacts/contracts/interfaces/IPerpdexPriceFeed.sol/IPerpdexPriceFeed.json"
import { TestERC20, TestPerpdexExchange, TestPerpdexMarket } from "../../typechain"

describe("PerpdexTokenBase constructor", async () => {
    async function deployWeth() {
        const tokenFactory = await ethers.getContractFactory("contracts/test/TestERC20.sol:TestERC20")
        var weth = (await tokenFactory.deploy("TestWETH", "WETH", 18)) as TestERC20
        return weth
    }

    async function deployPerpdexExchange(settlementTokenAddress) {
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

        var perpdexExchangeFactory = await ethers.getContractFactory(
            "contracts/test/TestPerpdexExchange.sol:TestPerpdexExchange",
            {
                libraries: {
                    AccountLibrary: accountLibrary.address,
                    MakerOrderBookLibrary: makerOrderBookLibrary.address,
                    VaultLibrary: vaultLibrary.address,
                },
            },
        )
        var perpdexExchange = (await perpdexExchangeFactory.deploy(settlementTokenAddress)) as TestPerpdexExchange
        return perpdexExchange
    }

    async function deployMockedPriceFeed(owner) {
        var priceFeed = await waffle.deployMockContract(owner, IPerpdexPriceFeedJson.abi)
        await priceFeed.mock.getPrice.returns(BigNumber.from(10).pow(12))
        await priceFeed.mock.decimals.returns(12)
        return priceFeed
    }

    async function deployPerpdexMarket(perpdexExchangeAddress, priceFeedBaseAddress, priceFeedQuoteAddress) {
        const orderBookLibraryFactory = await ethers.getContractFactory(
            "deps/perpdex-contract/contracts/lib/OrderBookLibrary.sol:OrderBookLibrary",
        )
        const orderBookLibrary = await orderBookLibraryFactory.deploy()

        var perpdexMarketFactory = await ethers.getContractFactory(
            "contracts/test/TestPerpdexMarket.sol:TestPerpdexMarket",
            {
                libraries: {
                    OrderBookLibrary: orderBookLibrary.address,
                },
            },
        )
        var perpdexMarket = (await perpdexMarketFactory.deploy(
            "USD",
            perpdexExchangeAddress,
            priceFeedBaseAddress,
            priceFeedQuoteAddress,
        )) as TestPerpdexMarket
        return perpdexMarket
    }

    describe("settlement", async () => {
        ;[
            // weth
            {
                title: "reverts when (settlementArg, wethArg) is (weth, weth)",
                settlementTokenAddress: "weth",
                wethArg: "weth",
                revertedWith: "PTB_C: weth can not be used",
            },
            {
                title: "reverts when (settlementArg, wethArg) is (weth, alice)",
                settlementTokenAddress: "weth",
                wethArg: "alice",
                revertedWith: "PTB_C: weth can not be used",
            },
            {
                title: "succeeds when (settlementArg, wethArg) is (weth, 0)",
                settlementTokenAddress: "weth",
                wethArg: "0",
            },

            // ETH
            {
                title: "reverts when (settlementArg, wethArg) is (0, 0)",
                settlementTokenAddress: "ETH",
                wethArg: "0",
                revertedWith: "PTB_C: weth is required",
            },
            {
                title: "succeeds when (settlementArg, wethArg) is (0, weth)",
                settlementTokenAddress: "ETH",
                wethArg: "weth",
            },
            {
                title: "succeeds when (settlementArg, wethArg) is (0, alice). (this should be fixed)",
                settlementTokenAddress: "ETH",
                wethArg: "alice",
            },
        ].forEach(test => {
            it(test.title, async () => {
                var [owner, alice] = await waffle.provider.getWallets()
                var weth = await deployWeth()

                // convert to address
                let wethArg
                if (test.wethArg === "alice") {
                    wethArg = alice.address
                } else if (test.wethArg === "0") {
                    wethArg = ethers.constants.AddressZero
                } else if (test.wethArg === "weth") {
                    wethArg = weth.address
                }

                let settlementTokenAddress
                if (test.settlementTokenAddress === "weth") {
                    settlementTokenAddress = weth.address
                } else if (test.settlementTokenAddress === "ETH") {
                    settlementTokenAddress = ethers.constants.AddressZero
                }

                // deploy contracts
                var exchange = await deployPerpdexExchange(settlementTokenAddress)
                var priceFeed = await deployMockedPriceFeed(owner)
                var market = await deployPerpdexMarket(
                    exchange.address,
                    priceFeed.address,
                    ethers.constants.AddressZero,
                )
                var perpdexTokenBaseF = await ethers.getContractFactory("TestPerpdexTokenBase")

                // assert
                var subject = perpdexTokenBaseF.deploy(market.address, "prefix", "symbol", wethArg)
                if (test.revertedWith === void 0) {
                    await subject
                } else {
                    await expect(subject).to.revertedWith(test.revertedWith)
                }
            })
        })
    })

    it("reverts when perpdex decimals is not 18", async () => {
        var [owner] = await waffle.provider.getWallets()

        // deploy mocked exchange and mock decimals to not 18
        var weth = await deployWeth()
        var mockedExchange = await waffle.deployMockContract(owner, IPerpdexExchangeJson.abi)
        await mockedExchange.mock.settlementToken.returns(weth.address) // this needed before assertion
        await mockedExchange.mock.quoteDecimals.returns(17) // mock
        var priceFeed = await deployMockedPriceFeed(owner)
        var market = await deployPerpdexMarket(mockedExchange.address, priceFeed.address, ethers.constants.AddressZero)
        var perpdexTokenBaseF = await ethers.getContractFactory("TestPerpdexTokenBase")
        await expect(
            perpdexTokenBaseF.deploy(market.address, "prefix", "symbol", ethers.constants.AddressZero),
        ).to.revertedWith("PTB_C: invalid decimals")
    })
})
