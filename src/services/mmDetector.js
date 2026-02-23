/**
 * mmDetector.js
 * Detects upcoming markets for configured assets (BTC, ETH, SOL, …)
 * using deterministic slug construction — supports 5-minute and 15-minute durations.
 *
 * Slug format: {asset}-updown-{duration}-{eventStartTimestamp}
 * e.g.  btc-updown-5m-1771755000
 *       eth-updown-15m-1771754100
 *
 * NEVER enters the currently active market — always targets the NEXT upcoming slot.
 */

import config from '../config/index.js';
import logger from '../utils/logger.js';

// Slot size in seconds (300 for 5m, 900 for 15m)
const SLOT_SEC = config.mmDuration === '15m' ? 900 : 300;

let pollTimer   = null;
let onMarketCb  = null;
const seenKeys  = new Set(); // `${asset}-${slotTimestamp}` already scheduled

// ── Slot helpers ──────────────────────────────────────────────────────────────

function currentSlot() {
    return Math.floor(Date.now() / 1000 / SLOT_SEC) * SLOT_SEC;
}

function nextSlot() {
    return currentSlot() + SLOT_SEC;
}

// ── Gamma API fetch ───────────────────────────────────────────────────────────

async function fetchBySlug(asset, slotTimestamp) {
    const slug = `${asset}-updown-${config.mmDuration}-${slotTimestamp}`;
    try {
        const resp = await fetch(`${config.gammaHost}/markets/slug/${slug}`);
        if (!resp.ok) return null;
        const data = await resp.json();
        return data?.conditionId ? data : null;
    } catch {
        return null;
    }
}

// ── Market data extraction ────────────────────────────────────────────────────

function extractMarketData(market, asset) {
    const conditionId = market.conditionId || market.condition_id || '';
    if (!conditionId) return null;

    // clobTokenIds may arrive as a JSON string or an actual array
    let tokenIds = market.clobTokenIds ?? market.clob_token_ids;
    if (typeof tokenIds === 'string') {
        try { tokenIds = JSON.parse(tokenIds); } catch { tokenIds = null; }
    }

    let yesTokenId, noTokenId;
    if (Array.isArray(tokenIds) && tokenIds.length >= 2) {
        [yesTokenId, noTokenId] = tokenIds;
    } else if (Array.isArray(market.tokens) && market.tokens.length >= 2) {
        yesTokenId = market.tokens[0]?.token_id ?? market.tokens[0]?.tokenId;
        noTokenId  = market.tokens[1]?.token_id ?? market.tokens[1]?.tokenId;
    }

    if (!yesTokenId || !noTokenId) return null;

    return {
        asset,
        conditionId,
        question:       market.question || market.title || '',
        endTime:        market.endDate  || market.end_date_iso || market.endDateIso,
        eventStartTime: market.eventStartTime || market.event_start_time,
        yesTokenId:     String(yesTokenId),
        noTokenId:      String(noTokenId),
        negRisk:        market.negRisk  ?? market.neg_risk  ?? false,
        tickSize:       String(market.orderPriceMinTickSize ?? market.minimum_tick_size ?? market.minimumTickSize ?? '0.01'),
    };
}

// ── Schedule an asset slot ────────────────────────────────────────────────────

async function scheduleAsset(asset, slotTimestamp) {
    const key = `${asset}-${slotTimestamp}`;
    if (seenKeys.has(key)) return;

    const market = await fetchBySlug(asset, slotTimestamp);
    if (!market) return; // not in API yet — poll will retry

    const data = extractMarketData(market, asset);
    if (!data) {
        logger.warn(`MM: skipping ${asset.toUpperCase()} slot ${slotTimestamp} — missing token IDs`);
        seenKeys.add(key);
        return;
    }

    seenKeys.add(key);

    // Refuse to enter a market already well into its window (e.g., bot restart mid-slot)
    const openAt     = data.eventStartTime ? new Date(data.eventStartTime).getTime() : slotTimestamp * 1000;
    const elapsedSec = Math.round((Date.now() - openAt) / 1000);
    if (elapsedSec > 15) {
        logger.info(`MM: ${asset.toUpperCase()} next slot already ${elapsedSec}s old — skipping, will catch next`);
        return;
    }

    const secsUntilOpen = Math.round((openAt - Date.now()) / 1000);
    if (secsUntilOpen > 0) {
        logger.success(`MM: ${asset.toUpperCase()} found "${data.question.slice(0, 40)}" — splitting position now (${secsUntilOpen}s before open)`);
    } else {
        logger.success(`MM: ${asset.toUpperCase()} found "${data.question.slice(0, 40)}" — splitting position now`);
    }

    if (onMarketCb) onMarketCb(data);
}

// ── Poll ──────────────────────────────────────────────────────────────────────

async function poll() {
    try {
        // Schedule NEXT slot only — never the currently active market
        const next = nextSlot();
        await Promise.all(config.mmAssets.map((asset) => scheduleAsset(asset, next)));
    } catch (err) {
        logger.error('MM detector poll error:', err.message);
    }
}

// ── Public API ────────────────────────────────────────────────────────────────

export function startMMDetector(onNewMarket) {
    onMarketCb = onNewMarket;
    seenKeys.clear();

    poll();
    pollTimer = setInterval(poll, config.mmPollInterval);

    const ns = nextSlot();
    const secsUntil = ns - Math.floor(Date.now() / 1000);
    logger.info(`MM detector started — assets: ${config.mmAssets.join(', ').toUpperCase()} | duration: ${config.mmDuration}`);
    logger.info(`Next slot: *-updown-${config.mmDuration}-${ns} (opens in ${secsUntil}s)`);
    logger.info(`Order: $${config.mmTradeSize}/side × 2 sides = $${config.mmTradeSize * 2} per market`);
}

export function stopMMDetector() {
    if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
    }
}
