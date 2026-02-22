import { ClobClient } from '@polymarket/clob-client';
import { Wallet } from 'ethers';
import config from '../config/index.js';
import logger from '../utils/logger.js';

let clobClient = null;
let signer = null;

/**
 * Initialize the Polymarket CLOB client
 * Auto-derives API credentials if not provided in .env
 */
export async function initClient() {
    logger.info('Initializing Polymarket CLOB client...');

    signer = new Wallet(config.privateKey);
    const walletAddress = signer.address;
    logger.info(`Wallet address: ${walletAddress}`);

    // Step 1: Create temp client to derive API credentials
    let apiCreds;
    if (config.clobApiKey && config.clobApiSecret && config.clobApiPassphrase) {
        apiCreds = {
            key: config.clobApiKey,
            secret: config.clobApiSecret,
            passphrase: config.clobApiPassphrase,
        };
        logger.info('Using API credentials from .env');
    } else {
        const tempClient = new ClobClient(config.clobHost, config.chainId, signer);
        apiCreds = await tempClient.createOrDeriveApiKey();
        logger.info('API credentials derived successfully');
    }

    // Step 2: Initialize full trading client
    clobClient = new ClobClient(
        config.clobHost,
        config.chainId,
        signer,
        apiCreds,
        0, // Signature type: 0 = EOA
        config.walletAddress || walletAddress, // Funder address
    );

    logger.success('CLOB client initialized');
    return clobClient;
}

/**
 * Get the initialized CLOB client
 */
export function getClient() {
    if (!clobClient) {
        throw new Error('CLOB client not initialized. Call initClient() first.');
    }
    return clobClient;
}

/**
 * Get the signer wallet
 */
export function getSigner() {
    if (!signer) {
        throw new Error('Signer not initialized. Call initClient() first.');
    }
    return signer;
}

/**
 * Get USDC.e balance on Polygon for the wallet
 */
export async function getUsdcBalance() {
    const { ethers } = await import('ethers');
    const provider = new ethers.providers.JsonRpcProvider('https://polygon-rpc.com');
    const usdcAddress = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174'; // USDC.e on Polygon
    const abi = ['function balanceOf(address) view returns (uint256)'];
    const usdc = new ethers.Contract(usdcAddress, abi, provider);
    const funderAddress = config.walletAddress || signer.address;
    const balance = await usdc.balanceOf(funderAddress);
    return parseFloat(ethers.utils.formatUnits(balance, 6));
}
