import { ethers } from 'ethers';
import config from '../config/index.js';
import { getOpenPositions, updatePosition, removePosition } from './position.js';
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
 * Check if a market has been resolved and our position is a winner
 * @param {string} conditionId
 * @returns {Object|null} { resolved, won }
 */
async function checkMarketResolution(conditionId) {
    try {
        // Check via Gamma API
        const url = `${config.gammaHost}/markets?condition_id=${conditionId}`;
        const response = await fetch(url);
        if (!response.ok) return null;

        const markets = await response.json();
        if (!markets || markets.length === 0) return null;

        const market = markets[0];
        return {
            resolved: market.closed || market.resolved || false,
            active: market.active,
            endDate: market.end_date_iso,
            resolutionSource: market.resolution_source,
            question: market.question,
        };
    } catch (err) {
        logger.error('Failed to check market resolution:', err.message);
        return null;
    }
}

/**
 * Check on-chain if a position (token) has value (payout available)
 */
async function checkOnChainPayout(conditionId) {
    try {
        const provider = new ethers.providers.JsonRpcProvider('https://polygon-rpc.com');
        const ctf = new ethers.Contract(CTF_ADDRESS, CTF_ABI, provider);

        const denominator = await ctf.payoutDenominator(conditionId);
        if (denominator.isZero()) return { resolved: false, payouts: [] };

        // Check payouts for both outcomes (YES=0, NO=1)
        const payouts = [];
        for (let i = 0; i < 2; i++) {
            const numerator = await ctf.payoutNumerators(conditionId, i);
            payouts.push(numerator.toNumber() / denominator.toNumber());
        }

        return { resolved: true, payouts };
    } catch (err) {
        // If payoutDenominator is 0 or reverts, market not resolved
        return { resolved: false, payouts: [] };
    }
}

/**
 * Redeem winning position on-chain
 */
async function redeemPosition(conditionId, isNegRisk = false) {
    try {
        const provider = new ethers.providers.JsonRpcProvider('https://polygon-rpc.com');
        const wallet = new ethers.Wallet(config.privateKey, provider);
        const ctfAddress = isNegRisk ? NEG_RISK_CTF_ADDRESS : CTF_ADDRESS;
        const ctf = new ethers.Contract(ctfAddress, CTF_ABI, wallet);

        const parentCollectionId = ethers.constants.HashZero;
        const indexSets = [1, 2]; // Both outcomes

        logger.info(`Redeeming position for conditionId: ${conditionId}`);

        const tx = await ctf.redeemPositions(
            USDC_ADDRESS,
            parentCollectionId,
            conditionId,
            indexSets,
            { gasLimit: 300000 },
        );

        logger.info(`Redeem tx sent: ${tx.hash}`);
        const receipt = await tx.wait();
        logger.success(`Redeem confirmed in block ${receipt.blockNumber}`);

        return true;
    } catch (err) {
        logger.error('Failed to redeem position:', err.message);
        return false;
    }
}

/**
 * Check all open positions for redeemable (resolved & won) markets
 */
export async function checkAndRedeemPositions() {
    const positions = getOpenPositions();
    if (positions.length === 0) return;

    logger.info(`Checking ${positions.length} position(s) for redemption...`);

    for (const position of positions) {
        try {
            // Check via API first
            const resolution = await checkMarketResolution(position.conditionId);

            if (!resolution || !resolution.resolved) {
                // Try on-chain check as fallback
                const onChain = await checkOnChainPayout(position.conditionId);
                if (!onChain.resolved) continue;

                // Check if our outcome won
                // Determine outcome index (0=YES, 1=NO based on token position)
                logger.info(`Market resolved on-chain: ${position.market} | Payouts: ${onChain.payouts}`);
            } else {
                logger.info(`Market resolved: ${position.market}`);
            }

            if (config.dryRun) {
                logger.info(`[DRY RUN] Would redeem position: ${position.market}`);
                continue;
            }

            // Attempt to redeem
            const success = await redeemPosition(position.conditionId);
            if (success) {
                removePosition(position.conditionId);
                logger.money(`Redeemed: ${position.market}`);
            }
        } catch (err) {
            logger.error(`Error checking position ${position.market}:`, err.message);
        }
    }
}
