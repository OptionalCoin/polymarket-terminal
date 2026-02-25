/**
 * PM2 ecosystem config
 *
 * Start all bots:
 *   pm2 start ecosystem.config.cjs            # live trading
 *   pm2 start ecosystem.config.cjs --env sim  # simulation / dry-run
 *
 * Start individual bot:
 *   pm2 start ecosystem.config.cjs --only polymarket-copy
 *   pm2 start ecosystem.config.cjs --only polymarket-mm
 *   pm2 start ecosystem.config.cjs --only polymarket-copy --env sim
 *   pm2 start ecosystem.config.cjs --only polymarket-mm  --env sim
 *
 * Logs:
 *   pm2 logs                          # all bots
 *   pm2 logs polymarket-copy          # copy trade only
 *   pm2 logs polymarket-mm            # market maker only
 *   pm2 logs polymarket-copy --lines 200
 *
 * Management:
 *   pm2 restart / stop / delete polymarket-copy
 *   pm2 restart / stop / delete polymarket-mm
 *   pm2 restart all
 */
module.exports = {
    apps: [
        // ── Copy Trade Bot ─────────────────────────────────────────────────────
        {
            name: 'polymarket-copy',
            script: 'src/bot.js',
            interpreter: 'node',

            env: {
                NODE_ENV: 'production',
                DRY_RUN:  'false',
            },
            env_sim: {
                NODE_ENV: 'production',
                DRY_RUN:  'true',
            },

            out_file:        'logs/copy-out.log',
            error_file:      'logs/copy-error.log',
            log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
            merge_logs:      true,

            restart_delay:      5000,
            max_restarts:       10,
            min_uptime:         '10s',
            max_memory_restart: '256M',
            stop_exit_codes:    [0],
        },

        // ── Market Maker Bot ───────────────────────────────────────────────────
        {
            name: 'polymarket-mm',
            script: 'src/mm-bot.js',
            interpreter: 'node',

            env: {
                NODE_ENV: 'production',
                DRY_RUN:  'false',
            },
            env_sim: {
                NODE_ENV: 'production',
                DRY_RUN:  'true',
            },

            out_file:        'logs/mm-out.log',
            error_file:      'logs/mm-error.log',
            log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
            merge_logs:      true,

            restart_delay:      5000,
            max_restarts:       10,
            min_uptime:         '10s',
            max_memory_restart: '256M',
            stop_exit_codes:    [0],
        },
    ],
};
