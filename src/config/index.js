import dotenv from 'dotenv';
dotenv.config();

const config = {
  // Wallet
  privateKey: process.env.PRIVATE_KEY,
  walletAddress: process.env.WALLET_ADDRESS,

  // Polymarket API (optional, auto-derived if empty)
  clobApiKey: process.env.CLOB_API_KEY || '',
  clobApiSecret: process.env.CLOB_API_SECRET || '',
  clobApiPassphrase: process.env.CLOB_API_PASSPHRASE || '',

  // Polymarket endpoints
  clobHost: 'https://clob.polymarket.com',
  gammaHost: 'https://gamma-api.polymarket.com',
  dataHost: 'https://data-api.polymarket.com',
  chainId: 137,

  // Trader to copy
  traderAddress: process.env.TRADER_ADDRESS,

  // Trade sizing
  sizeMode: process.env.SIZE_MODE || 'percentage', // "percentage" | "balance"
  sizePercent: parseFloat(process.env.SIZE_PERCENT || '50'),
  minTradeSize: parseFloat(process.env.MIN_TRADE_SIZE || '1'),

  // Auto sell
  autoSellEnabled: process.env.AUTO_SELL_ENABLED === 'true',
  autoSellProfitPercent: parseFloat(process.env.AUTO_SELL_PROFIT_PERCENT || '10'),

  // Sell mode when copying sell
  sellMode: process.env.SELL_MODE || 'market', // "market" | "limit"

  // Polling intervals (seconds)
  pollInterval: parseInt(process.env.POLL_INTERVAL || '15', 10) * 1000,
  redeemInterval: parseInt(process.env.REDEEM_INTERVAL || '60', 10) * 1000,

  // Dry run
  dryRun: process.env.DRY_RUN === 'true',

  // Retry settings
  maxRetries: 5,
  retryDelay: 3000,
};

// Validation
export function validateConfig() {
  const required = ['privateKey', 'walletAddress', 'traderAddress'];
  const missing = required.filter((key) => !config[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required config: ${missing.join(', ')}. Check your .env file.`);
  }
  if (!['percentage', 'balance'].includes(config.sizeMode)) {
    throw new Error(`Invalid SIZE_MODE: ${config.sizeMode}. Use "percentage" or "balance".`);
  }
  if (!['market', 'limit'].includes(config.sellMode)) {
    throw new Error(`Invalid SELL_MODE: ${config.sellMode}. Use "market" or "limit".`);
  }
}

export default config;
