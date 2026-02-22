# AGENT.MD — Polymarket Copy Trade Tool

Dokumentasi untuk AI Agent yang akan melanjutkan atau memodifikasi project ini.

## Overview

Tool untuk copy trade otomatis dari trader di Polymarket. Dibangun dengan Node.js (ESM), menggunakan Polymarket CLOB SDK.

## Architecture

- **Config** (`src/config/index.js`): Semua settings dari `.env`, validasi required fields
- **Client** (`src/services/client.js`): Inisialisasi `ClobClient` dari `@polymarket/clob-client`, auto-derive API creds, cek balance USDC.e on-chain
- **Watcher** (`src/services/watcher.js`): Polling `data-api.polymarket.com/activity?user={address}` untuk deteksi trade baru. Dedup via `processed_trades.json`
- **Executor** (`src/services/executor.js`): Execute buy (market FOK order + retry) dan sell (market/limit). Sizing mode: percentage of trader size atau percentage of own balance
- **Position** (`src/services/position.js`): CRUD posisi di `positions.json`. Prevent duplicate buy per conditionId (1 market = 1 buy only)
- **AutoSell** (`src/services/autoSell.js`): Setelah buy filled, place GTC limit sell di `avgBuyPrice * (1 + profitPercent/100)`. Rounded ke tick size yang valid
- **Redeemer** (`src/services/redeemer.js`): Check resolved markets via Gamma API + on-chain CTF `payoutDenominator`. Redeem via CTF `redeemPositions`
- **State** (`src/utils/state.js`): Atomic JSON file writes (tmp file + rename) ke folder `data/`
- **Logger** (`src/utils/logger.js`): Timestamped, color-coded, emoji-prefixed console logging

## Key APIs Used

| API | Base URL | Auth | Purpose |
|-----|----------|------|---------|
| Gamma API | `gamma-api.polymarket.com` | No | Market info, resolution status |
| Data API | `data-api.polymarket.com` | No | Trader activity, positions |
| CLOB API | `clob.polymarket.com` | Yes (L2) | Place/cancel orders |
| Polygon RPC | `polygon-rpc.com` | No | USDC balance, CTF redeem |

## Dependencies

- `@polymarket/clob-client` — Official Polymarket CLOB SDK (uses ethers v5 internally)
- `ethers@5` — Wallet signing, contract interaction
- `dotenv` — Environment variable loading
- `nodemon` (dev) — Auto-reload on file changes (ignores `data/*.json`)

## State Files (data/)

- `positions.json` — Active positions: `{ [conditionId]: { tokenId, shares, avgBuyPrice, ... } }`
- `processed_trades.json` — Already-handled trade IDs (max 500): `{ tradeIds: [...] }`

## Trade Flow

1. Watcher detects new BUY → check no existing position → calculate size → check balance → market buy (FOK + retry) → save position → auto-sell if enabled
2. Watcher detects new SELL → check position exists → cancel auto-sell order → market/limit sell → remove position
3. Redeemer loop → check resolved markets → redeem CTF on-chain → remove position

## Important Notes

- Module type: ESM (`"type": "module"` in package.json)
- USDC on Polygon = USDC.e (`0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174`)
- CTF Contract = `0x4D97DCd97eC945f40cF65F87097ACe5EA0476045`
- Neg Risk CTF = `0xC5d563A36AE78145C45a50134d48A1215220f80a`
- Signature type 0 = EOA wallet
- Tick sizes: 0.1, 0.01, 0.001, 0.0001
- Market orders use FOK (fill-or-kill), limit orders use GTC (good-til-cancelled)
- Data API activity response fields vary — code handles multiple field name conventions

## Known Limitations

- No WebSocket support yet (polling only)
- No partial fill tracking for market orders
- Redeem requires MATIC for gas
- No proxy wallet support (EOA only, signature type 0)
