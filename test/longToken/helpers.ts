// SPDX-License-Identifier: GPL-3.0-or-later
import { BigNumber } from "ethers"
import { ethers } from "hardhat"

export async function initPool(fixture, base, quote, baseBalancePerShareX96 = void 0): Promise<void> {
    let exchange = fixture.perpdexExchange
    let market = fixture.perpdexMarket
    let owner = fixture.owner
    let priceFeedBase = fixture.priceFeedBase

    await market.connect(owner).setFundingMaxPremiumRatio(0)
    await market.setPoolFeeConfig({
        fixedFeeRatio: 0,
        atrFeeRatio: 0,
        atrEmaBlocks: 1,
    })
    await exchange.connect(owner).setIsMarketAllowed(market.address, true)

    await exchange.setAccountInfo(
        owner.address,
        {
            collateralBalance: quote.mul(10),
        },
        [],
    )

    if (base.gt(0) && quote.gt(0)) {
        // mock price feed before add liquidity
        var basePrice = quote.div(base).mul(BigNumber.from(10).pow(await priceFeedBase.decimals()))
        await priceFeedBase.mock.getPrice.returns(basePrice)
        await exchange.connect(owner).addLiquidity({
            market: market.address,
            base: base,
            quote: quote,
            minBase: 0,
            minQuote: 0,
            deadline: ethers.constants.MaxUint256,
        })
        if (baseBalancePerShareX96) {
            const poolInfo = await market.poolInfo()
            await market.setPoolInfo({
                ...poolInfo,
                baseBalancePerShareX96: baseBalancePerShareX96,
            })
        }
    }
}
