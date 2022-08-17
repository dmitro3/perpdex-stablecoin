// SPDX-License-Identifier: GPL-3.0-or-later
import { BigNumber, Wallet } from "ethers"
import { ethers, waffle } from "hardhat"
import IPerpdexPriceFeedJson from "../../deps/perpdex-contract/artifacts/contracts/interfaces/IPerpdexPriceFeed.sol/IPerpdexPriceFeed.json"
import { TestERC20, TestPerpdexExchange, TestPerpdexMarket, TestPerpdexTokenBase } from "../../typechain"

export interface PerpdexTokenBaseFixture {
    perpdexExchange: TestPerpdexExchange
    perpdexMarket: TestPerpdexMarket
    perpdexTokenBase: TestPerpdexTokenBase
    weth: TestERC20
    owner: Wallet
    alice: Wallet
    bob: Wallet
}

export function createPerpdexTokenBaseFixture(): (wallets, provider) => Promise<PerpdexTokenBaseFixture> {
    return async ([owner, alice, bob], provider): Promise<PerpdexTokenBaseFixture> => {
        // erc20 asset
        const tokenFactory = await ethers.getContractFactory("contracts/test/TestERC20.sol:TestERC20")
        let weth = (await tokenFactory.deploy("TestWETH", "WETH", 18)) as TestERC20
        let settlementToken = weth.address

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

        // exchange
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
        const perpdexExchange = (await perpdexExchangeFactory.deploy(settlementToken)) as TestPerpdexExchange

        // priceFeed
        const priceFeed = await waffle.deployMockContract(owner, IPerpdexPriceFeedJson.abi)
        await priceFeed.mock.getPrice.returns(BigNumber.from(10).pow(12))
        await priceFeed.mock.decimals.returns(12)

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
            priceFeed.address,
            ethers.constants.AddressZero,
        )) as TestPerpdexMarket

        await perpdexMarket.connect(owner).setFundingMaxPremiumRatio(0)

        // test token
        const perpdexTokenBaseF = await ethers.getContractFactory("TestPerpdexTokenBase")
        const perpdexTokenBase = (await perpdexTokenBaseF.deploy(
            perpdexMarket.address,
            "TestToken",
            "TT",
            ethers.constants.AddressZero,
        )) as TestPerpdexTokenBase

        return {
            perpdexExchange,
            perpdexMarket,
            perpdexTokenBase,
            weth,
            owner,
            alice,
            bob,
        }
    }
}
