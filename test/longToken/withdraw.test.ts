// SPDX-License-Identifier: GPL-3.0-or-later
import { expect } from "chai"
import { Wallet } from "ethers"
import { parseUnits } from "ethers/lib/utils"
import { ethers, waffle } from "hardhat"
import { PerpdexLongToken, TestERC20, TestPerpdexExchange, TestPerpdexMarket } from "../../typechain"
import { createPerpdexExchangeFixture } from "./fixtures"
import { initPool } from "./helpers"

describe("PerpdexLongToken withdraw", async () => {
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
            settlementToken: "weth",
            wethDecimals: 18,
        },
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

                // deposit ETH into wETH contract
                if (fixtureParams.settlementToken === "ETH") {
                    await weth.connect(owner).deposit({
                        value: ethers.utils.parseEther("15"),
                    })
                }
            })

            describe("maxWithdraw", async () => {
                beforeEach(async () => {
                    // alice approve longToken of max assets
                    await weth.approveForce(alice.address, longToken.address, ethers.constants.MaxUint256)
                })
                ;[
                    {
                        title: "returns 0 when market is not allowed",
                        pool: {
                            base: "10000",
                            quote: "10000",
                        },
                        isMarketAllowed: false,
                        depositAssets: "10",
                        removeLiquidity: 0,
                        expected: "0",
                    },
                    {
                        title: "returns 0 when liquidity is zero",
                        pool: {
                            base: "0",
                            quote: "0",
                        },
                        isMarketAllowed: true,
                        depositAssets: "0",
                        expected: "0", // math error without message
                    },
                    {
                        title: "success case",
                        pool: {
                            base: "10000",
                            quote: "10000",
                        },
                        isMarketAllowed: true,
                        depositAssets: "10",
                        expected: "9.999999999999999999",
                    },
                ].forEach(test => {
                    it(test.title, async () => {
                        // init pool
                        await initPool(fixture, parseShares(test.pool.base), parseShares(test.pool.quote))

                        // alice deposits
                        await weth.connect(owner).mint(alice.address, parseAssets(test.depositAssets))

                        if (test.pool.base !== "0" && test.depositAssets !== "0") {
                            var owner_ = alice
                            await weth.connect(owner).mint(alice.address, parseAssets(test.depositAssets))
                            await longToken.connect(owner_).deposit(parseAssets(test.depositAssets), owner_.address)
                        }

                        await exchange.connect(owner).setIsMarketAllowed(market.address, test.isMarketAllowed)

                        const maxWithdraw = await longToken.maxWithdraw(alice.address)
                        expect(maxWithdraw).to.eq(parseAssets(test.expected))

                        // check consistency
                        const previewSubject = longToken.connect(alice).previewWithdraw(maxWithdraw)
                        const withdrawSubject = longToken
                            .connect(alice)
                            .withdraw(maxWithdraw, alice.address, alice.address)
                        if (maxWithdraw.gt(0)) {
                            await expect(previewSubject).not.to.reverted
                            await expect(withdrawSubject).not.to.reverted
                        } else {
                            await expect(previewSubject).to.reverted
                            await expect(withdrawSubject).to.reverted
                        }
                    })
                })
            })

            describe("previewWithdraw and (withdraw or withdrawETH)", async () => {
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
                        withdrawAssets: "5",
                        ownerAllowance: "0",
                        caller: "alice",
                        owner: "alice",
                        receiver: "alice",
                        revertedWithPreview: "PE_CMA: market not allowed",
                        revertedWith: "PE_CMA: market not allowed", // maxWithdraw == 0
                    },
                    {
                        title: "both reverts when assets is zero",
                        pool: {
                            base: "10000",
                            quote: "10000",
                        },
                        isMarketAllowed: true,
                        depositAssets: "10",
                        withdrawAssets: "0",
                        ownerAllowance: "0",
                        caller: "alice",
                        owner: "alice",
                        receiver: "alice",
                        burnedSharesPreview: "0",
                        revertedWith: "VL_W: zero amount",
                    },
                    {
                        title: "withdraw reverts and preview succeeds when assets is more than max",
                        pool: {
                            base: "10000",
                            quote: "10000",
                        },
                        isMarketAllowed: true,
                        depositAssets: "10",
                        withdrawAssets: "20",
                        ownerAllowance: "0",
                        caller: "alice",
                        owner: "alice",
                        receiver: "alice",
                        burnedSharesPreview: "20.000020000020000021",
                        revertedWith: "ERC20: burn amount exceeds balance",
                    },
                    {
                        title: "withdraw reverts and preview succeeds when alice withdraws unapproved bob's assets",
                        pool: {
                            base: "10000",
                            quote: "10000",
                        },
                        isMarketAllowed: true,
                        depositAssets: "10",
                        withdrawAssets: "9.9",
                        ownerAllowance: "0",
                        caller: "alice",
                        owner: "bob",
                        receiver: "alice",
                        burnedSharesPreview: "9.890010989999990110",
                        revertedWith: "ERC20: insufficient allowance",
                    },
                    {
                        title: "succeeds when alice withdraws her assets",
                        pool: {
                            base: "10000",
                            quote: "10000",
                        },
                        isMarketAllowed: true,
                        depositAssets: "10",
                        withdrawAssets: "9.9",
                        ownerAllowance: "0",
                        caller: "alice",
                        owner: "alice",
                        receiver: "alice",
                        burnedSharesPreview: "9.890010989999990110",
                        burnedShares: "9.890010989999990110",
                    },
                    {
                        title: "succeeds when alice withdraws approved bob's assets to alice",
                        pool: {
                            base: "10000",
                            quote: "10000",
                        },
                        isMarketAllowed: true,
                        depositAssets: "10",
                        withdrawAssets: "9.9",
                        ownerAllowance: "9.891",
                        caller: "alice",
                        owner: "bob",
                        receiver: "alice",
                        burnedSharesPreview: "9.890010989999990110",
                        burnedShares: "9.890010989999990110",
                    },
                    {
                        title: "succeeds when alice withdraws approved bob's assets to charlie",
                        pool: {
                            base: "10000",
                            quote: "10000",
                        },
                        isMarketAllowed: true,
                        depositAssets: "10",
                        withdrawAssets: "9.9",
                        ownerAllowance: "9.891",
                        caller: "alice",
                        owner: "bob",
                        receiver: "charlie",
                        burnedSharesPreview: "9.890010989999990110",
                        burnedShares: "9.890010989999990110",
                    },
                ].forEach(test => {
                    it(test.title, async () => {
                        // pool
                        await initPool(fixture, parseShares(test.pool.base), parseShares(test.pool.quote))

                        var caller = toWallet(test.caller)
                        var owner_ = toWallet(test.owner)
                        var receiver = toWallet(test.receiver)

                        // owner_ deposit
                        await weth.connect(owner).mint(owner_.address, parseAssets(test.depositAssets))
                        await longToken.connect(owner_).deposit(parseAssets(test.depositAssets), owner_.address)

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

                        // caller previews and withdraws
                        var withdrawAssets = parseAssets(test.withdrawAssets)
                        var previewSubject = longToken.connect(caller).previewWithdraw(withdrawAssets)
                        var withdrawSubject = longToken
                            .connect(caller)
                            .withdraw(withdrawAssets, receiver.address, owner_.address)

                        // assert withdraw
                        if (test.revertedWith !== void 0) {
                            // preview
                            if (test.revertedWithPreview !== void 0) {
                                await expect(previewSubject).to.revertedWith(test.revertedWithPreview)
                            } else if (test.burnedSharesPreview !== void 0) {
                                expect(await previewSubject).to.equal(parseShares(test.burnedSharesPreview))
                            }
                            // withdraw
                            await expect(withdrawSubject).to.revertedWith(test.revertedWith)
                        } else {
                            var burnedShares = parseShares(test.burnedShares)
                            // event
                            expect(await withdrawSubject)
                                .to.emit(longToken, "Withdraw")
                                .withArgs(caller.address, receiver.address, owner.address, withdrawAssets, burnedShares)

                            // share
                            expect(await longToken.totalSupply()).to.eq(totalSharesBefore.sub(burnedShares))
                            expect(await longToken.balanceOf(owner_.address)).to.eq(ownerSharesBefore.sub(burnedShares))

                            // asset
                            expect(await longToken.totalAssets()).to.lt(totalAssetsBefore)
                            expect(await weth.balanceOf(receiver.address)).to.eq(
                                receiverAssetsBefore.add(withdrawAssets),
                            )

                            // preview >= burned
                            expect(await previewSubject).to.eq(parseShares(test.burnedSharesPreview))
                        }
                    })
                })
            })
        })
    })
})
