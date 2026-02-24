/**
 * PM2 ecosystem config
 *
 * Usage:
 *   pm2 start ecosystem.config.cjs            # live trading
 *   pm2 start ecosystem.config.cjs --env sim  # simulation / dry-run
 *
 *   pm2 logs polymarket-copy          # tail logs
 *   pm2 logs polymarket-copy --lines 200
 *   pm2 stop / restart / delete polymarket-copy
 */
module.exports = {
    apps: [
        {
            name: 'polymarket-copy',
            script: 'src/bot.js',
            interpreter: 'node',

            // Live trading (default)
            env: {
                NODE_ENV: 'production',
                DRY_RUN:  'false',
            },

            // Simulation: pm2 start ecosystem.config.cjs --env sim
            env_sim: {
                NODE_ENV: 'production',
                DRY_RUN:  'true',
            },

            // Log files (relative to project root)
            out_file:        'logs/out.log',
            error_file:      'logs/error.log',
            log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
            merge_logs:      true,

            // Restart policy
            restart_delay:  5000,   // wait 5s before restarting
            max_restarts:   10,     // give up after 10 crashes in a row
            min_uptime:     '10s',  // must stay up ≥10s to count as "stable"
            max_memory_restart: '256M',

            // Treat non-zero exit as a crash (don't restart on clean SIGTERM)
            stop_exit_codes: [0],
        },
    ],
};
