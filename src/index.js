import config, { validateConfig } from './config/index.js';
import { initClient, getUsdcBalance } from './services/client.js';
import { checkNewTrades, markTradeProcessed } from './services/watcher.js';
import { executeBuy, executeSell } from './services/executor.js';
import { checkAndRedeemPositions } from './services/redeemer.js';
import { getOpenPositions } from './services/position.js';
import logger from './utils/logger.js';

// ASCII Art Banner
function showBanner() {
    console.log(`
\x1b[36m╔══════════════════════════════════════════════════════╗
║        🎯 POLYMARKET COPY TRADE TOOL 🎯              ║
║        Auto-copy trades from any trader               ║
╚══════════════════════════════════════════════════════╝\x1b[0m
  `);
}

// Show current settings
function showSettings() {
    logger.info('=== Settings ===');
    logger.info(`Trader: ${config.traderAddress}`);
    logger.info(`Size Mode: ${config.sizeMode} (${config.sizePercent}%)`);
    logger.info(`Min Trade Size: $${config.minTradeSize}`);
    logger.info(`Auto Sell: ${config.autoSellEnabled ? `ON (${config.autoSellProfitPercent}% profit)` : 'OFF'}`);
    logger.info(`Sell Mode: ${config.sellMode}`);
    logger.info(`Poll Interval: ${config.pollInterval / 1000}s`);
    logger.info(`Redeem Interval: ${config.redeemInterval / 1000}s`);
    logger.info(`Dry Run: ${config.dryRun ? 'YES (no real trades)' : 'NO (live trading!)'}`);
    logger.info('================');
}

// Main watcher loop
async function watcherLoop() {
    try {
        logger.watch('Checking trader activity...');
        const newTrades = await checkNewTrades();

        if (newTrades.length === 0) {
            logger.watch('No new trades from trader');
            return;
        }

        logger.watch(`Found ${newTrades.length} new trade(s) from trader`);

        for (const trade of newTrades) {
            try {
                if (trade.type === 'BUY') {
                    await executeBuy(trade);
                } else if (trade.type === 'SELL') {
                    await executeSell(trade);
                }
            } catch (err) {
                logger.error(`Error processing trade ${trade.id}:`, err.message);
            }

            // Mark as processed regardless of success/failure
            markTradeProcessed(trade.id);
        }
    } catch (err) {
        logger.error('Watcher loop error:', err.message);
    }
}

// Redeemer loop
async function redeemerLoop() {
    try {
        await checkAndRedeemPositions();
    } catch (err) {
        logger.error('Redeemer loop error:', err.message);
    }
}

// Main
async function main() {
    showBanner();

    // Validate config
    try {
        validateConfig();
    } catch (err) {
        logger.error(err.message);
        process.exit(1);
    }

    showSettings();

    // Initialize client
    try {
        await initClient();
    } catch (err) {
        logger.error('Failed to initialize client:', err.message);
        process.exit(1);
    }

    // Show balance
    try {
        const balance = await getUsdcBalance();
        logger.money(`USDC.e Balance: $${balance.toFixed(2)}`);
    } catch (err) {
        logger.warn('Could not fetch balance:', err.message);
    }

    // Show existing positions
    const positions = getOpenPositions();
    if (positions.length > 0) {
        logger.info(`Existing positions: ${positions.length}`);
        positions.forEach((p) => {
            logger.info(`  - ${p.market} | ${p.shares} shares @ $${p.avgBuyPrice}`);
        });
    }

    logger.success('Bot started! Watching trader activity...');
    logger.info('Press Ctrl+C to stop');

    // Start loops
    // Initial run
    await watcherLoop();
    await redeemerLoop();

    // Interval loops
    const watcherInterval = setInterval(watcherLoop, config.pollInterval);
    const redeemerInterval = setInterval(redeemerLoop, config.redeemInterval);

    // Graceful shutdown
    const shutdown = () => {
        logger.info('Shutting down...');
        clearInterval(watcherInterval);
        clearInterval(redeemerInterval);
        logger.info('Goodbye! 👋');
        process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}

main().catch((err) => {
    logger.error('Fatal error:', err.message);
    console.error(err);
    process.exit(1);
});
