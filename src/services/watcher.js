import config from '../config/index.js';
import logger from '../utils/logger.js';
import { readState, writeState } from '../utils/state.js';

const PROCESSED_FILE = 'processed_trades.json';

/**
 * Fetch trader's recent activity from Data API
 * @returns {Array} List of trade activities
 */
async function fetchTraderActivity() {
    const url = `${config.dataHost}/activity?user=${config.traderAddress}`;
    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Data API returned ${response.status}`);
        }
        return await response.json();
    } catch (err) {
        logger.error('Failed to fetch trader activity:', err.message);
        return [];
    }
}

/**
 * Get list of already processed trade IDs
 */
function getProcessedTrades() {
    return readState(PROCESSED_FILE, { tradeIds: [] });
}

/**
 * Mark a trade as processed
 */
function markTradeProcessed(tradeId) {
    const data = getProcessedTrades();
    data.tradeIds.push(tradeId);
    // Keep only last 500 trade IDs to prevent unbounded growth
    if (data.tradeIds.length > 500) {
        data.tradeIds = data.tradeIds.slice(-500);
    }
    writeState(PROCESSED_FILE, data);
}

/**
 * Check for new trades from the watched trader
 * @returns {Array} New trades to process: { id, type, tokenId, conditionId, market, price, size, timestamp, side }
 */
export async function checkNewTrades() {
    const activities = await fetchTraderActivity();
    const processed = getProcessedTrades();

    if (!Array.isArray(activities) || activities.length === 0) {
        return [];
    }

    const newTrades = [];

    for (const activity of activities) {
        // Skip already processed
        const tradeId = activity.id || activity.transaction_hash || `${activity.timestamp}_${activity.asset}`;
        if (processed.tradeIds.includes(tradeId)) {
            continue;
        }

        // Only process filled trades (buys and sells)
        const type = activity.type?.toUpperCase();
        if (!['BUY', 'SELL'].includes(type)) {
            // Mark non-buy/sell as processed so we don't re-check
            markTradeProcessed(tradeId);
            continue;
        }

        // Extract trade info
        const trade = {
            id: tradeId,
            type, // BUY or SELL
            tokenId: activity.asset || activity.token_id || '',
            conditionId: activity.condition_id || activity.conditionId || '',
            market: activity.title || activity.question || activity.market || '',
            price: parseFloat(activity.price || '0'),
            size: parseFloat(activity.size || activity.amount || '0'),
            side: activity.side || type,
            timestamp: activity.timestamp || activity.created_at || new Date().toISOString(),
            outcome: activity.outcome || '',
            proxyWalletAddress: activity.proxyWalletAddress || '',
        };

        // Need tokenId to trade
        if (!trade.tokenId) {
            logger.warn(`Skipping trade without tokenId: ${tradeId}`);
            markTradeProcessed(tradeId);
            continue;
        }

        newTrades.push(trade);
    }

    return newTrades;
}

/**
 * Mark trade as processed after handling
 */
export { markTradeProcessed };

/**
 * Fetch market info from Gamma API by condition ID
 */
export async function fetchMarketInfo(conditionId) {
    try {
        const url = `${config.gammaHost}/markets?condition_id=${conditionId}`;
        const response = await fetch(url);
        if (!response.ok) return null;
        const markets = await response.json();
        return markets && markets.length > 0 ? markets[0] : null;
    } catch (err) {
        logger.error('Failed to fetch market info:', err.message);
        return null;
    }
}

/**
 * Fetch market info by token ID (CLOB token)
 */
export async function fetchMarketByTokenId(tokenId) {
    try {
        const url = `${config.gammaHost}/markets?clob_token_ids=${tokenId}`;
        const response = await fetch(url);
        if (!response.ok) return null;
        const markets = await response.json();
        return markets && markets.length > 0 ? markets[0] : null;
    } catch (err) {
        logger.error('Failed to fetch market by tokenId:', err.message);
        return null;
    }
}
