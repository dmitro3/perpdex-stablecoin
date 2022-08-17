// SPDX-License-Identifier: GPL-3.0-or-later
import { expect } from "chai"
import { Wallet } from "ethers"
import { parseUnits } from "ethers/lib/utils"
import { ethers, waffle } from "hardhat"
import { PerpdexLongToken, TestERC20, TestPerpdexExchange, TestPerpdexMarket } from "../../typechain"
import { createPerpdexExchangeFixture } from "./fixtures"
import { initPool } from "./helpers"

describe("PerpdexLongToken redeemETH", async () => {
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
    let charlie: Wallet

    function parseAssets(amount: string) {
        return parseUnits(amount, wethDecimals)
    }

    function parseShares(amount: string) {
        return parseUnits(amount, longTokenDecimals)
    }

    function toWallet(who: string) {
        if (who === "alice") {
            return alice
        }
        if (who === "bob") {
            return bob
        }
        if (who === "charlie") {
            return charlie
        }
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
                charlie = fixture.charlie
            })

            describe("previewRedeem and redeemETH", async () => {
                beforeEach(async () => {
                    // alice approve longToken of max assets
                    await weth.approveForce(alice.address, longToken.address, ethers.constants.MaxUint256)
                    // bob approve longToken of max assets
                    await weth.approveForce(bob.address, longToken.address, ethers.constants.MaxUint256)
                })
                ;[
                    {
                        title: "both reverts when market is not allowed",
                        pool: {
                            base: "10000",
                            quote: "10000",
                        },
                        isMarketAllowed: false,
                        depositAssets: "10",
                        redeemShares: "5",
                        ownerAllowance: "0",
                        caller: "alice",
                        owner: "alice",
                        receiver: "alice",
                        revertedWithPreview: "PE_CMA: market not allowed",
                        revertedWith: "PE_CMA: market not allowed", // maxWithdraw == 0
                    },
                    {
                        title: "both reverts when shares is zero",
                        pool: {
                            base: "10000",
                            quote: "10000",
                        },
                        isMarketAllowed: true,
                        depositAssets: "10",
                        redeemShares: "0",
                        ownerAllowance: "0",
                        caller: "alice",
                        owner: "alice",
                        receiver: "alice",
                        withdrawnAssetsPreview: "0",
                        revertedWith: "VL_W: zero amount'",
                    },
                    {
                        title: "redeem reverts and preview succeeds when shares is more than max",
                        pool: {
                            base: "10000",
                            quote: "10000",
                        },
                        isMarketAllowed: true,
                        depositAssets: "10",
                        redeemShares: "20",
                        ownerAllowance: "0",
                        caller: "alice",
                        owner: "alice",
                        receiver: "alice",
                        withdrawnAssetsPreview: "19.999980039960000079",
                        revertedWith: "ERC20: burn amount exceeds balance",
                    },
                    {
                        title: "redeem reverts and preview succeeds when alice redeems unapproved bob's shares",
                        pool: {
                            base: "10000",
                            quote: "10000",
                        },
                        isMarketAllowed: true,
                        depositAssets: "10",
                        redeemShares: "9.9",
                        ownerAllowance: "0",
                        caller: "alice",
                        owner: "bob",
                        receiver: "alice",
                        withdrawnAssetsPreview: "9.909989199802887336",
                        revertedWith: "ERC20: insufficient allowance",
                    },
                    {
                        title: "succeeds when alice redeems her shares",
                        pool: {
                            base: "10000",
                            quote: "10000",
                        },
                        isMarketAllowed: true,
                        depositAssets: "10",
                        redeemShares: "9.9",
                        ownerAllowance: "0",
                        caller: "alice",
                        owner: "alice",
                        receiver: "alice",
                        withdrawnAssetsPreview: "9.909989199802887336",
                        withdrawnAssets: "9.909989199802887336",
                    },
                    {
                        title: "succeeds when alice redeems approved bob's shares to alice",
                        pool: {
                            base: "10000",
                            quote: "10000",
                        },
                        isMarketAllowed: true,
                        depositAssets: "10",
                        redeemShares: "9.9",
                        ownerAllowance: "9.9",
                        caller: "alice",
                        owner: "bob",
                        receiver: "alice",
                        withdrawnAssetsPreview: "9.909989199802887336",
                        withdrawnAssets: "9.909989199802887336",
                    },
                    {
                        title: "succeeds when alice redeems approved bob's shares to charlie",
                        pool: {
                            base: "10000",
                            quote: "10000",
                        },
                        isMarketAllowed: true,
                        depositAssets: "10",
                        redeemShares: "9.9",
                        ownerAllowance: "9.9",
                        caller: "alice",
                        owner: "bob",
                        receiver: "charlie",
                        withdrawnAssetsPreview: "9.909989199802887336",
                        withdrawnAssets: "9.909989199802887336",
                    },
                ].forEach(test => {
                    it(test.title, async () => {
                        // pool
                        await initPool(fixture, parseShares(test.pool.base), parseShares(test.pool.quote))

                        var caller = toWallet(test.caller)
                        var owner_ = toWallet(test.owner)
                        var receiver = toWallet(test.receiver)

                        // owner_ deposit
                        var depositAssets = parseAssets(test.depositAssets)
                        await weth.connect(owner).mint(owner_.address, depositAssets)
                        await longToken.connect(owner_).depositETH(owner_.address, { value: depositAssets })

                        // owner_ approves caller
                        await longToken.connect(owner_).approve(caller.address, parseShares(test.ownerAllowance))

                        // hold before states
                        var ownerSharesBefore = await longToken.balanceOf(owner_.address)
                        var receiverAssetsBefore = await weth.balanceOf(receiver.address)
                        var totalAssetsBefore = await longToken.totalAssets()
                        var totalSharesBefore = await longToken.totalSupply()

                        // change market allowance
                        if (test.isMarketAllowed !== void 0) {
                            await exchange.connect(owner).setIsMarketAllowed(market.address, test.isMarketAllowed)
                        }

                        // caller previews and redeems
                        var redeemShares = parseShares(test.redeemShares)
                        var previewSubject = longToken.connect(caller).previewRedeem(redeemShares)
                        var redeemSubject = longToken
                            .connect(caller)
                            .redeemETH(redeemShares, receiver.address, owner_.address)

                        // assert
                        if (test.revertedWith !== void 0) {
                            // preview
                            if (test.revertedWithPreview !== void 0) {
                                await expect(previewSubject).to.revertedWith(test.revertedWithPreview)
                            } else {
                                expect(await previewSubject).to.equal(parseAssets(test.withdrawnAssetsPreview))
                            }
                            // redeem
                            await expect(redeemSubject).to.revertedWith(test.revertedWith)
                        } else {
                            var withdrawnAssets = parseShares(test.withdrawnAssets)
                            // event
                            expect(await redeemSubject)
                                .to.emit(longToken, "Withdraw")
                                .withArgs(
                                    caller.address,
                                    receiver.address,
                                    owner.address,
                                    redeemShares,
                                    withdrawnAssets,
                                )

                            // share
                            expect(await longToken.totalSupply()).to.eq(totalSharesBefore.sub(redeemShares))
                            expect(await longToken.balanceOf(owner_.address)).to.eq(ownerSharesBefore.sub(redeemShares))

                            // asset
                            expect(await longToken.totalAssets()).to.lt(totalAssetsBefore)
                            expect(await redeemSubject).to.changeEtherBalance(receiver, withdrawnAssets)

                            // preview >= burned
                            expect(await previewSubject).to.eq(parseShares(test.withdrawnAssetsPreview))
                        }
                    })
                })
            })
        })
    })
})
