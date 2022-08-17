// SPDX-License-Identifier: GPL-3.0-or-later
import { PANIC_CODES } from "@nomicfoundation/hardhat-chai-matchers/panic"
import { expect } from "chai"
import { Wallet } from "ethers"
import { parseUnits } from "ethers/lib/utils"
import { ethers, waffle } from "hardhat"
import { PerpdexLongToken, TestERC20, TestPerpdexExchange, TestPerpdexMarket } from "../../typechain"
import { createPerpdexExchangeFixture } from "./fixtures"
import { initPool } from "./helpers"

describe("PerpdexLongToken mintETH", async () => {
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

            describe("mintETH", async () => {
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
                        mintShares: "100",
                        sendETHValue: "110",
                        revertedWith: "PM_PS: too large amount", // maxMint == 0
                    },
                    {
                        title: "reverts when liquidity is zero",
                        pool: {
                            base: "0",
                            quote: "0",
                        },
                        aliceQuoteAssets: "1000",
                        mintShares: "100",
                        sendETHValue: "110",
                        revertedWith: "PM_PS: too large amount", // maxMint == 0
                    },
                    {
                        title: "reverts when assets is zero",
                        pool: {
                            base: "10",
                            quote: "10",
                        },
                        aliceQuoteAssets: "1000",
                        mintShares: "0",
                        sendETHValue: "0",
                        revertedWith: "VL_DE: zero amount",
                        skipPreviewSubjectRevertAssert: true,
                    },
                    {
                        title: "reverts when assets is too large",
                        pool: {
                            base: "10",
                            quote: "10",
                        },
                        aliceQuoteAssets: "1000",
                        mintShares: "100",
                        sendETHValue: "110",
                        revertedWith: "PM_PS: too large amount",
                    },
                    {
                        title: "reverts when send ETH value is lower than previewMint",
                        pool: {
                            base: "10000",
                            quote: "10000",
                        },
                        aliceQuoteAssets: "50",
                        mintShares: "20",
                        sendETHValue: "10",
                        revertedWith: PANIC_CODES.ARITHMETIC_UNDER_OR_OVERFLOW,
                        skipPreviewSubjectRevertAssert: true,
                    },
                    {
                        title: "succeeds",
                        pool: {
                            base: "10000",
                            quote: "10000",
                        },
                        aliceQuoteAssets: "50",
                        mintShares: "20",
                        sendETHValue: "30",
                        depositedAssets: "20.040080160320641283",
                        totalAssetsAfter: "20.080240641603848980",
                        aliceAssetsAfter: "29.959919839679358717",
                    },
                ].forEach(test => {
                    it(test.title, async () => {
                        // pool
                        await initPool(fixture, parseShares(test.pool.base), parseShares(test.pool.quote))

                        // alice balance
                        await weth.connect(owner).mint(alice.address, parseAssets(test.aliceQuoteAssets))

                        // alice mint preview
                        var mintShares = parseShares(test.mintShares)
                        var previewSubject = longToken.connect(alice).previewMint(mintShares)

                        // alice mints
                        var mintSubject = longToken
                            .connect(alice)
                            .mintETH(mintShares, alice.address, { value: parseUnits(test.sendETHValue, 18) })

                        // assert
                        if (test.revertedWith !== void 0) {
                            if (!test.skipPreviewSubjectRevertAssert) {
                                await expect(previewSubject).to.reverted
                            }
                            if (typeof test.revertedWith === "number") {
                                await expect(mintSubject).to.revertedWithPanic(test.revertedWith)
                            } else {
                                await expect(mintSubject).to.revertedWith(test.revertedWith)
                            }
                        } else {
                            var depositedAssets = parseAssets(test.depositedAssets)
                            // event
                            expect(await mintSubject)
                                .to.emit(longToken, "Deposit")
                                .withArgs(alice.address, alice.address, depositedAssets, mintShares)

                            // share
                            expect(await longToken.totalSupply()).to.eq(mintShares)
                            expect(await longToken.balanceOf(alice.address)).to.eq(mintShares)

                            // asset
                            expect(await longToken.totalAssets()).to.eq(parseAssets(test.totalAssetsAfter))
                            expect(await mintSubject).to.changeEtherBalance(alice, depositedAssets)

                            // preview >= assets
                            expect(await previewSubject).to.gte(depositedAssets)
                        }
                    })
                })
            })
        })
    })
})
