/**
 * proxy-patch.cjs
 * CommonJS module to patch https.request BEFORE any axios imports.
 * This ensures @polymarket/clob-client uses the proxy.
 *
 * Must be imported as very first thing in the app.
 * In ES modules: import './proxy-patch.cjs'
 */
const https = require('https');
const http = require('http');
const { HttpsProxyAgent } = require('https-proxy-agent');

const PROXY_URL = process.env.PROXY_URL || '';

if (PROXY_URL) {
    const agent = new HttpsProxyAgent(PROXY_URL);
    const originalHttpsRequest = https.request.bind(https);

    // Polymarket domains that must go through proxy
    const POLY_DOMAINS = [
        'polymarket.com',
        'clob.polymarket.com',
        'gamma-api.polymarket.com',
        'data-api.polymarket.com',
    ];

    function shouldProxy(url) {
        try {
            const hostname = new URL(url).hostname;
            return POLY_DOMAINS.some(domain => hostname === domain || hostname.endsWith(`.${domain}`));
        } catch {
            return false;
        }
    }

    // Patch https.request
    https.request = function(...args) {
        const url = args[0];
        if (typeof url === 'string' && shouldProxy(url)) {
            const options = args[1] || {};
            options.agent = agent;
            return originalHttpsRequest(url, options);
        }
        return originalHttpsRequest(...args);
    };

    console.log(`[proxy-patch] HTTPS patched for Polymarket routing via proxy`);
}
