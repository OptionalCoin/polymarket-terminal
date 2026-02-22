const COLORS = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    dim: '\x1b[2m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    white: '\x1b[37m',
};

function timestamp() {
    return new Date().toISOString().replace('T', ' ').substring(0, 19);
}

function formatMsg(level, color, emoji, ...args) {
    const ts = timestamp();
    const prefix = `${COLORS.dim}[${ts}]${COLORS.reset} ${color}${emoji} ${level}${COLORS.reset}`;
    console.log(prefix, ...args);
}

const logger = {
    info: (...args) => formatMsg('INFO', COLORS.blue, 'ℹ️ ', ...args),
    success: (...args) => formatMsg('SUCCESS', COLORS.green, '✅', ...args),
    warn: (...args) => formatMsg('WARN', COLORS.yellow, '⚠️ ', ...args),
    error: (...args) => formatMsg('ERROR', COLORS.red, '❌', ...args),
    trade: (...args) => formatMsg('TRADE', COLORS.magenta, '📊', ...args),
    watch: (...args) => formatMsg('WATCH', COLORS.cyan, '👀', ...args),
    money: (...args) => formatMsg('MONEY', COLORS.green, '💰', ...args),
};

export default logger;
