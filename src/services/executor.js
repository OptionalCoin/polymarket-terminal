import { Side, OrderType } from '@polymarket/clob-client';
import config from '../config/index.js';
import { getClient, getUsdcBalance } from './client.js';
import { hasPosition, addPosition, getPosition, updatePosition, removePosition } from './position.js';
import { fetchMarketByTokenId } from './watcher.js';
import { placeAutoSell } from './autoSell.js';
import { recordSimBuy } from '../utils/simStats.js';
import logger from '../utils/logger.js';

/**
 * Calculate trade size for our entry — independent of the individual fill event.
 *
 * Limit orders can be filled in many small chunks; using the event's fill size
 * would give inconsistent (often sub-minimum) results.
 *
 * SIZE_MODE=percentage → SIZE_PERCENT% of MAX_POSITION_SIZE per market
 * SIZE_MODE=balance    → SIZE_PERCENT% of our current USDC.e balance
 */
async function calculateTradeSize() {
    if (config.sizeMode === 'percentage') {
        return config.maxPositionSize * (config.sizePercent / 100);
    } else if (config.sizeMode === 'balance') {
        const balance = await getUsdcBalance();
        return balance * (config.sizePercent / 100);
    }
    return 0;
}

/**
 * Get market options (tick size and neg risk) for a token
 */
async function getMarketOptions(tokenId) {
    const client = getClient();
    try {
        // Try to get from market info
        const marketInfo = await fetchMarketByTokenId(tokenId);
        if (marketInfo) {
            return {
                tickSize:   String(marketInfo.minimum_tick_size || '0.01'),
                negRisk:    marketInfo.neg_risk || false,
                conditionId: marketInfo.condition_id || '',
                question:   marketInfo.question || '',
                endDateIso: marketInfo.end_date_iso || marketInfo.game_start_time || null,
                active:     marketInfo.active !== false,
                acceptingOrders: marketInfo.accepting_orders !== false,
            };
        }
    } catch (err) {
        logger.warn('Failed to get market info, using defaults:', err.message);
    }

    // Fallback: try SDK methods
    try {
        const tickSize = await client.getTickSize(tokenId);
        const negRisk = await client.getNegRisk(tokenId);
        return { tickSize: String(tickSize), negRisk, conditionId: '', question: '', endDateIso: null, active: true, acceptingOrders: true };
    } catch (err) {
        logger.warn('Failed to get tick size from SDK, using default 0.01');
        return { tickSize: '0.01', negRisk: false, conditionId: '', question: '', endDateIso: null, active: true, acceptingOrders: true };
    }
}

/**
 * Execute a BUY trade (copy trader's buy)
 * @param {Object} trade - Trade info from watcher
 */
export async function executeBuy(trade) {
    const { tokenId, conditionId, market, price, size } = trade;

    // Get market options first to resolve conditionId + end time
    const marketOpts = await getMarketOptions(tokenId);
    const effectiveConditionId = conditionId || marketOpts.conditionId;

    // ── Market expiry guard ────────────────────────────────────────────────────
    if (!marketOpts.active || !marketOpts.acceptingOrders) {
        logger.warn(`Market closed/not accepting orders: ${market || effectiveConditionId} — skipping buy`);
        return;
    }
    if (marketOpts.endDateIso) {
        const secsLeft = (new Date(marketOpts.endDateIso).getTime() - Date.now()) / 1000;
        if (secsLeft < config.minMarketTimeLeft) {
            const minsLeft = Math.max(0, Math.floor(secsLeft / 60));
            const sLeft    = Math.max(0, Math.floor(secsLeft % 60));
            logger.warn(
                `Market expires in ${minsLeft}m ${sLeft}s — below MIN_MARKET_TIME_LEFT ` +
                `(${config.minMarketTimeLeft}s). Skipping buy: ${market || effectiveConditionId}`,
            );
            return;
        }
    }
    // ──────────────────────────────────────────────────────────────────────────

    // Check existing position and max position size cap
    const existingPos = getPosition(effectiveConditionId);
    if (existingPos) {
        const spent = existingPos.totalCost || 0;
        if (spent >= config.maxPositionSize) {
            logger.warn(`Max position $${config.maxPositionSize} reached for: ${market || effectiveConditionId} (spent $${spent.toFixed(2)}). Skipping.`);
            return;
        }
        logger.info(`Adding to existing position (spent $${spent.toFixed(2)} / $${config.maxPositionSize})`);
    }

    // Calculate our trade size (independent of individual fill event)
    let tradeSize = await calculateTradeSize();

    // Cap so we don't exceed maxPositionSize
    if (existingPos) {
        const remaining = config.maxPositionSize - (existingPos.totalCost || 0);
        tradeSize = Math.min(tradeSize, remaining);
    } else {
        tradeSize = Math.min(tradeSize, config.maxPositionSize);
    }

    if (tradeSize < config.minTradeSize) {
        logger.warn(`Trade size $${tradeSize.toFixed(2)} below minimum $${config.minTradeSize}. Skipping.`);
        return;
    }

    // Check balance
    const balance = await getUsdcBalance();
    if (balance < tradeSize) {
        logger.error(`Insufficient balance: $${balance.toFixed(2)} < $${tradeSize.toFixed(2)} needed`);
        return;
    }

    logger.trade(`BUY ${market || tokenId} | Size: $${tradeSize.toFixed(2)} | Trader price: ${price}`);

    if (config.dryRun) {
        logger.trade(`[SIM] BUY ${market || tokenId} | $${tradeSize.toFixed(2)} @ $${price} | outcome: ${trade.outcome || '?'}`);
        const dryShares = tradeSize / price;
        if (existingPos) {
            const newShares = existingPos.shares + dryShares;
            const newTotalCost = existingPos.totalCost + tradeSize;
            updatePosition(effectiveConditionId, {
                shares: newShares,
                avgBuyPrice: newTotalCost / newShares,
                totalCost: newTotalCost,
            });
            logger.info(`[SIM] Position accumulated: $${newTotalCost.toFixed(2)} / $${config.maxPositionSize}`);
        } else {
            addPosition({
                conditionId: effectiveConditionId,
                tokenId,
                market: market || marketOpts.question || tokenId,
                shares: dryShares,
                avgBuyPrice: price,
                totalCost: tradeSize,
                outcome: trade.outcome,
            });
        }
        recordSimBuy();
        return;
    }

    // Place market order (FAK) with retries
    const client = getClient();
    let filled = false;
    let totalSharesFilled = 0;
    let totalCostFilled = 0;

    for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
        try {
            const remainingAmount = tradeSize - totalCostFilled;
            if (remainingAmount < config.minTradeSize) break;

            logger.info(`Buy attempt ${attempt}/${config.maxRetries} | Amount: $${remainingAmount.toFixed(2)}`);

            const response = await client.createAndPostMarketOrder(
                {
                    tokenID: tokenId,
                    side: Side.BUY,
                    amount: remainingAmount,
                    price: Math.min(price * 1.02, 0.99), // 2% slippage, max 0.99
                },
                {
                    tickSize: marketOpts.tickSize,
                    negRisk: marketOpts.negRisk,
                },
                OrderType.FAK, // Fill-and-Kill: takes what's available, no full-fill requirement
            );

            if (response && response.success) {
                const sharesFilled = parseFloat(response.takingAmount || '0');
                const costFilled   = parseFloat(response.makingAmount || '0');

                if (sharesFilled > 0) {
                    logger.success(`Order filled: ${response.orderID} | ${sharesFilled.toFixed(4)} shares @ ~$${(costFilled / sharesFilled).toFixed(4)}`);
                    totalSharesFilled += sharesFilled;
                    totalCostFilled   += costFilled || (sharesFilled * price);
                    filled = true;
                    // If remainder is below minimum, stop; otherwise loop for partial fill
                    if (tradeSize - totalCostFilled < config.minTradeSize) break;
                } else {
                    logger.warn(`No liquidity — FAK filled 0 shares (attempt ${attempt})`);
                }
            } else {
                logger.warn(`Order rejected: ${response?.errorMsg || 'unknown'}`);
            }
        } catch (err) {
            logger.error(`Buy attempt ${attempt} failed: ${err.message}`);
        }

        if (attempt < config.maxRetries) {
            await new Promise((r) => setTimeout(r, config.retryDelay));
        }
    }

    if (!filled || totalCostFilled === 0) {
        logger.error(`Failed to fill buy order for ${market || tokenId} after ${config.maxRetries} attempts`);
        return;
    }

    // Calculate avg buy price for this fill
    const fillAvgPrice = totalSharesFilled > 0 ? totalCostFilled / totalSharesFilled : price;

    if (existingPos) {
        // Accumulate into existing position (weighted avg price)
        const newShares = existingPos.shares + totalSharesFilled;
        const newTotalCost = existingPos.totalCost + totalCostFilled;
        const newAvgBuyPrice = newTotalCost / newShares;
        updatePosition(effectiveConditionId, {
            shares: newShares,
            avgBuyPrice: newAvgBuyPrice,
            totalCost: newTotalCost,
        });
        logger.success(`Position updated: ${existingPos.market} | total $${newTotalCost.toFixed(2)} / $${config.maxPositionSize}`);
    } else {
        // New position
        addPosition({
            conditionId: effectiveConditionId,
            tokenId,
            market: market || marketOpts.question || tokenId,
            shares: totalSharesFilled,
            avgBuyPrice: fillAvgPrice,
            totalCost: totalCostFilled,
            outcome: trade.outcome,
        });

        // Auto-sell only on initial entry, not on accumulation
        if (config.autoSellEnabled) {
            await placeAutoSell(effectiveConditionId, tokenId, totalSharesFilled, fillAvgPrice, marketOpts);
        }
    }
}

/**
 * Execute a SELL trade (copy trader's sell)
 * @param {Object} trade - Trade info from watcher
 */
export async function executeSell(trade) {
    const { tokenId, conditionId, market, price } = trade;

    // Get market options to resolve conditionId
    let effectiveConditionId = conditionId;
    let marketOpts;
    if (!effectiveConditionId) {
        marketOpts = await getMarketOptions(tokenId);
        effectiveConditionId = marketOpts.conditionId;
    }

    // Check if we have a position
    const position = getPosition(effectiveConditionId);
    if (!position) {
        logger.warn(`No position found for: ${market || effectiveConditionId}. Skipping sell.`);
        return;
    }

    if (position.status === 'selling' || position.status === 'sold') {
        logger.warn(`Position already ${position.status}: ${market || effectiveConditionId}. Skipping.`);
        return;
    }

    logger.trade(`SELL ${position.market} | Shares: ${position.shares} | Trader price: ${price}`);

    if (config.dryRun) {
        logger.info('[DRY RUN] Would place sell order');
        removePosition(effectiveConditionId);
        return;
    }

    // Cancel existing auto-sell order if any
    if (position.sellOrderId) {
        try {
            const client = getClient();
            await client.cancelOrder(position.sellOrderId);
            logger.info(`Cancelled auto-sell order: ${position.sellOrderId}`);
        } catch (err) {
            logger.warn(`Failed to cancel auto-sell: ${err.message}`);
        }
    }

    updatePosition(effectiveConditionId, { status: 'selling' });

    if (!marketOpts) {
        marketOpts = await getMarketOptions(tokenId);
    }

    const client = getClient();
    let filled = false;

    for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
        try {
            if (config.sellMode === 'market') {
                // Market sell (FAK) — takes what's available at 2% slippage
                logger.info(`Sell attempt ${attempt}/${config.maxRetries} (market) | Shares: ${position.shares}`);

                const response = await client.createAndPostMarketOrder(
                    {
                        tokenID: tokenId,
                        side: Side.SELL,
                        amount: position.shares,
                        price: Math.max(price * 0.98, 0.01), // 2% slippage, min 0.01
                    },
                    {
                        tickSize: marketOpts.tickSize,
                        negRisk: marketOpts.negRisk,
                    },
                    OrderType.FAK, // Fill-and-Kill: takes what's available
                );

                if (response && response.success) {
                    const sharesFilled = parseFloat(response.takingAmount || '0');
                    if (sharesFilled > 0) {
                        logger.success(`Sell filled: ${response.orderID} | ${sharesFilled.toFixed(4)} shares`);
                        filled = true;
                        break;
                    } else {
                        logger.warn(`No bid liquidity — FAK filled 0 shares (attempt ${attempt})`);
                    }
                } else {
                    logger.warn(`Sell rejected: ${response?.errorMsg || 'unknown'}`);
                }
            } else {
                // Limit sell at trader's sell price
                logger.info(`Sell attempt ${attempt}/${config.maxRetries} (limit) | Price: ${price}`);

                const response = await client.createAndPostOrder(
                    {
                        tokenID: tokenId,
                        price: price,
                        size: position.shares,
                        side: Side.SELL,
                    },
                    {
                        tickSize: marketOpts.tickSize,
                        negRisk: marketOpts.negRisk,
                    },
                    OrderType.GTC,
                );

                if (response && response.success) {
                    logger.success(`Limit sell placed: ${response.orderID} @ $${price}`);
                    filled = true;
                    break;
                } else {
                    logger.warn(`Limit sell failed: ${response?.errorMsg || 'Unknown'}`);
                }
            }
        } catch (err) {
            logger.error(`Sell attempt ${attempt} failed:`, err.message);
        }

        if (attempt < config.maxRetries) {
            await new Promise((r) => setTimeout(r, config.retryDelay));
        }
    }

    if (filled) {
        removePosition(effectiveConditionId);
        logger.money(`Position sold: ${position.market}`);
    } else {
        updatePosition(effectiveConditionId, { status: 'open' });
        logger.error(`Failed to sell ${position.market} after ${config.maxRetries} attempts`);
    }
}
