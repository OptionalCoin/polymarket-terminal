import { ethers } from 'ethers';
import config from '../config/index.js';
import { getPolygonProvider } from './client.js';
import { getOpenPositions, removePosition } from './position.js';
import { recordSimResult } from '../utils/simStats.js';
import logger from '../utils/logger.js';

// Contract addresses on Polygon
const CTF_ADDRESS = '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045';
const NEG_RISK_CTF_ADDRESS = '0xC5d563A36AE78145C45a50134d48A1215220f80a';
const USDC_ADDRESS = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';

// CTF ABI (minimal for redeemPositions & balanceOf)
const CTF_ABI = [
    'function redeemPositions(address collateralToken, bytes32 parentCollectionId, bytes32 conditionId, uint256[] indexSets)',
    'function balanceOf(address owner, uint256 tokenId) view returns (uint256)',
    'function payoutNumerators(bytes32 conditionId, uint256 outcomeIndex) view returns (uint256)',
    'function payoutDenominator(bytes32 conditionId) view returns (uint256)',
];

/**
 * Check if a market has been resolved via Gamma API
 */
async function checkMarketResolution(conditionId) {
    try {
        const url = `${config.gammaHost}/markets?condition_id=${conditionId}`;
        const response = await fetch(url);
        if (!response.ok) return null;

        const markets = await response.json();
        if (!markets || markets.length === 0) return null;

        const market = markets[0];
        return {
            resolved: market.closed || market.resolved || false,
            active: market.active,
            question: market.question,
        };
    } catch (err) {
        logger.error('Failed to check market resolution:', err.message);
        return null;
    }
}

/**
 * Check on-chain payout fractions for a condition
 * Returns: { resolved: bool, payouts: [yes_fraction, no_fraction] }
 */
async function checkOnChainPayout(conditionId) {
    try {
        const provider = await getPolygonProvider();
        const ctf = new ethers.Contract(CTF_ADDRESS, CTF_ABI, provider);

        const denominator = await ctf.payoutDenominator(conditionId);
        if (denominator.isZero()) return { resolved: false, payouts: [] };

        const payouts = [];
        for (let i = 0; i < 2; i++) {
            const numerator = await ctf.payoutNumerators(conditionId, i);
            payouts.push(numerator.toNumber() / denominator.toNumber());
        }

        return { resolved: true, payouts };
    } catch {
        return { resolved: false, payouts: [] };
    }
}

/**
 * Redeem winning position on-chain (real mode only)
 */
async function redeemPosition(conditionId, isNegRisk = false) {
    try {
        const provider = await getPolygonProvider();
        const wallet = new ethers.Wallet(config.privateKey, provider);
        const ctfAddress = isNegRisk ? NEG_RISK_CTF_ADDRESS : CTF_ADDRESS;
        const ctf = new ethers.Contract(ctfAddress, CTF_ABI, wallet);

        const parentCollectionId = ethers.constants.HashZero;
        const indexSets = [1, 2];

        logger.info(`Redeeming position: ${conditionId}`);
        const tx = await ctf.redeemPositions(
            USDC_ADDRESS,
            parentCollectionId,
            conditionId,
            indexSets,
            { gasLimit: 300000 },
        );

        logger.info(`Redeem tx: ${tx.hash}`);
        const receipt = await tx.wait();
        logger.success(`Redeemed in block ${receipt.blockNumber}`);
        return true;
    } catch (err) {
        logger.error('Failed to redeem:', err.message);
        return false;
    }
}

/**
 * Simulate redemption: determine win/loss and record stats
 */
async function simulateRedeem(position) {
    // Need on-chain payout to know who actually won
    const onChain = await checkOnChainPayout(position.conditionId);

    if (!onChain.resolved) {
        logger.info(`[SIM] Market resolved via API but payout not on-chain yet: ${position.market}`);
        return false; // check again next interval
    }

    // outcome index: YES = 0, NO = 1
    const outcomeStr = (position.outcome || 'yes').toLowerCase();
    const outcomeIdx = outcomeStr === 'yes' ? 0 : 1;
    const payoutFraction = onChain.payouts[outcomeIdx] ?? 0;

    // In Polymarket, winning shares redeem at $1 each
    const returned = payoutFraction * position.shares;
    const pnl = returned - position.totalCost;

    if (payoutFraction > 0) {
        logger.money(
            `[SIM] WIN! "${position.market}" | ${position.outcome} won` +
            ` | +$${pnl.toFixed(2)} (+${((pnl / position.totalCost) * 100).toFixed(1)}%)`,
        );
        recordSimResult(position, 'WIN', pnl, returned);
    } else {
        logger.error(
            `[SIM] LOSS: "${position.market}" | ${position.outcome} lost` +
            ` | -$${position.totalCost.toFixed(2)} (-100%)`,
        );
        recordSimResult(position, 'LOSS', pnl, returned);
    }

    removePosition(position.conditionId);
    return true;
}

/**
 * Check all open positions for resolved markets and redeem/simulate
 */
export async function checkAndRedeemPositions() {
    const positions = getOpenPositions();
    if (positions.length === 0) return;

    logger.info(`Checking ${positions.length} position(s) for resolution...`);

    for (const position of positions) {
        try {
            // 1. Check via Gamma API
            const resolution = await checkMarketResolution(position.conditionId);
            const isResolved = resolution?.resolved;

            if (!isResolved) {
                // 2. Fallback: on-chain check
                const onChain = await checkOnChainPayout(position.conditionId);
                if (!onChain.resolved) continue;
                logger.info(`Market resolved on-chain: ${position.market}`);
            } else {
                logger.info(`Market resolved: ${position.market}`);
            }

            // 3. Simulate or execute real redeem
            if (config.dryRun) {
                await simulateRedeem(position);
            } else {
                const success = await redeemPosition(position.conditionId);
                if (success) {
                    removePosition(position.conditionId);
                    logger.money(`Redeemed: ${position.market}`);
                }
            }
        } catch (err) {
            logger.error(`Error checking ${position.market}:`, err.message);
        }
    }
}
