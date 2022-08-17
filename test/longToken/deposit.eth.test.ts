// SPDX-License-Identifier: GPL-3.0-or-later
import { expect } from "chai"
import { Wallet } from "ethers"
import { parseUnits } from "ethers/lib/utils"
import { ethers, waffle } from "hardhat"
import { PerpdexLongToken, TestERC20, TestPerpdexExchange, TestPerpdexMarket } from "../../typechain"
import { createPerpdexExchangeFixture } from "./fixtures"
import { initPool } from "./helpers"

describe("PerpdexLongToken depositETH", async () => {
    let loadFixture = waffle.createFixtureLoader(waffle.provider.getWallets())
    let fixture

    let longToken: PerpdexLongToken
    let longTokenDecimals: number
    let market: TestPerpdexMarket
    let exchange: TestPerpdexExchange
    let weth: TestERC20
    let wethDecimals: number
    let owner: Wallet
    let alice: Wallet
    let bob: Wallet

    function parseAssets(amount: string) {
        return parseUnits(amount, wethDecimals)
    }

    function parseShares(amount: string) {
        return parseUnits(amount, longTokenDecimals)
    }

    ;[
        {
            settlementToken: "ETH",
            wethDecimals: 18,
        },
    ].forEach(fixtureParams => {
        describe(JSON.stringify(fixtureParams), () => {
            beforeEach(async () => {
                fixture = await loadFixture(createPerpdexExchangeFixture(fixtureParams))

                longToken = fixture.perpdexLongToken
                longTokenDecimals = await longToken.decimals()
                market = fixture.perpdexMarket
                exchange = fixture.perpdexExchange

                weth = fixture.weth
                wethDecimals = await weth.decimals()

                owner = fixture.owner
                alice = fixture.alice
                bob = fixture.bob
            })

            describe("depositETH", async () => {
                beforeEach(async () => {
                    // alice approve longToken of max assets
                    await weth.approveForce(alice.address, longToken.address, ethers.constants.MaxUint256)
                })
                ;[
                    {
                        title: "reverts when market is not allowed",
                        pool: {
                            base: "10",
                            quote: "10",
                        },
                        isMarketAllowed: false,
                        aliceQuoteAssets: "1000",
                        depositAssets: "100",
                        revertedWith: "PE_CMA: market not allowed",
                    },
                    {
                        title: "reverts when liquidity is zero",
                        pool: {
                            base: "0",
                            quote: "0",
                        },
                        aliceQuoteAssets: "1000",
                        depositAssets: "100",
                        revertedWith: "PM_S: too large amount", // maxDeposit == 0
                    },
                    {
                        title: "reverts when assets is zero",
                        pool: {
                            base: "10",
                            quote: "10",
                        },
                        aliceQuoteAssets: "1000",
                        depositAssets: "0",
                        revertedWith: ": zero amount",
                    },
                    {
                        title: "reverts when assets is too large",
                        pool: {
                            base: "10",
                            quote: "10",
                        },
                        aliceQuoteAssets: "1000",
                        depositAssets: "100",
                        revertedWith: "PM_S: too large amount",
                    },
                    {
                        title: "succeeds",
                        pool: {
                            base: "10000",
                            quote: "10000",
                        },
                        aliceQuoteAssets: "500",
                        depositAssets: "10",
                        mintedShares: "9.990009990009990009",
                        totalAssetsAfter: "10.009999999999999999", // price impact
                        aliceAssetsAfter: "490.000000000000000000",
                    },
                ].forEach(test => {
                    it(test.title, async () => {
                        // pool
                        await initPool(fixture, parseShares(test.pool.base), parseShares(test.pool.quote))

                        if (test.isMarketAllowed !== void 0) {
                            await exchange.connect(owner).setIsMarketAllowed(market.address, test.isMarketAllowed)
                        }

                        // alice balance
                        await weth.connect(owner).mint(alice.address, parseAssets(test.aliceQuoteAssets))

                        // alice deposit preview
                        var depositAssets = parseAssets(test.depositAssets)
                        var previewSubject = longToken.connect(alice).previewDeposit(depositAssets)

                        // alice deposits
                        if (fixtureParams.settlementToken === "ETH") {
                            var depositSubject = longToken
                                .connect(alice)
                                .depositETH(alice.address, { value: depositAssets })
                        } else {
                            var depositSubject = longToken.connect(alice).deposit(depositAssets, alice.address)
                        }

                        // assert
                        if (test.revertedWith !== void 0) {
                            if (test.depositAssets === "0") {
                                expect(await previewSubject).to.eq(0)
                            } else {
                                await expect(previewSubject).to.be.reverted
                            }
                            await expect(depositSubject).to.revertedWith(test.revertedWith)
                        } else {
                            var mintedShares = parseShares(test.mintedShares)
                            // event
                            expect(await depositSubject)
                                .to.emit(longToken, "Deposit")
                                .withArgs(alice.address, alice.address, depositAssets, mintedShares)

                            // share
                            expect(await longToken.totalSupply()).to.eq(mintedShares)
                            expect(await longToken.balanceOf(alice.address)).to.eq(mintedShares)

                            // asset
                            expect(await longToken.totalAssets()).to.eq(parseAssets(test.totalAssetsAfter))
                            if (fixtureParams.settlementToken === "ETH") {
                                expect(await depositSubject).to.changeEtherBalance(alice, depositAssets)
                            } else {
                                expect(await weth.balanceOf(alice.address)).to.eq(parseAssets(test.aliceAssetsAfter))
                            }

                            // preview <= shares
                            expect(await previewSubject).to.lte(mintedShares)
                        }
                    })
                })
            })
        })
    })
})
