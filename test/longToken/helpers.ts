// SPDX-License-Identifier: GPL-3.0-or-later
import { ethers } from "hardhat"

export async function initPool(exchange, market, owner, base, quote): Promise<void> {
    await market.connect(owner).setFundingMaxPremiumRatio(0)
    await exchange.connect(owner).setIsMarketAllowed(market.address, true)

    await exchange.setAccountInfo(
        owner.address,
        {
            collateralBalance: quote.mul(10),
        },
        [],
    )

    if (base.gt(0) && quote.gt(0)) {
        await exchange.connect(owner).addLiquidity({
            market: market.address,
            base: base,
            quote: quote,
            minBase: 0,
            minQuote: 0,
            deadline: ethers.constants.MaxUint256,
        })
    }
}