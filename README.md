# 🎯 Polymarket Copy Trade Tool

Auto-copy trades dari trader manapun di Polymarket.

## Features

- 👀 **Watch Trader** — Monitor aktivitas trading dari address wallet tertentu
- 📊 **Copy Buy** — Otomatis buy ketika trader buy, dengan sizing yang bisa di-setting
- 📉 **Copy Sell** — Otomatis sell ketika trader sell (market / limit)
- 💰 **Auto Sell** — Pasang limit sell otomatis setelah buy filled (sesuai target profit %)
- 🏆 **Auto Redeem** — Cek dan redeem posisi yang sudah WIN secara berkala
- 🔄 **Smart Position** — 1 market hanya buy 1x, tidak duplikat
- ✅ **Balance Check** — Cek saldo sebelum trade
- 🧪 **Dry Run Mode** — Test tanpa eksekusi trade sungguhan

## Setup

### 1. Clone & Install

```bash
git clone <repo-url>
cd polymarket-copy
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` dengan setting Anda:

| Variable | Description | Default |
|---|---|---|
| `PRIVATE_KEY` | Private key wallet Polygon | (required) |
| `WALLET_ADDRESS` | Address wallet Anda | (required) |
| `TRADER_ADDRESS` | Address trader yang mau di-copy | (required) |
| `SIZE_MODE` | `percentage` (dari size trader) atau `balance` (dari balance sendiri) | `percentage` |
| `SIZE_PERCENT` | Persentase sizing | `50` |
| `MIN_TRADE_SIZE` | Minimum trade dalam USDC | `1` |
| `AUTO_SELL_ENABLED` | Aktifkan auto-sell | `true` |
| `AUTO_SELL_PROFIT_PERCENT` | Target profit % untuk auto-sell | `10` |
| `SELL_MODE` | `market` atau `limit` saat copy sell | `market` |
| `POLL_INTERVAL` | Interval polling (detik) | `15` |
| `REDEEM_INTERVAL` | Interval cek redeem (detik) | `60` |
| `DRY_RUN` | Mode simulasi tanpa real trade | `true` |

### 3. Run

```bash
# Development (auto-reload)
npm run dev

# Production
npm start
```

## How It Works

```
┌─────────────────────────────────────────────┐
│              WATCHER LOOP                   │
│  Poll Data API setiap N detik               │
│  → Cek trade baru dari trader               │
├─────────────────┬───────────────────────────┤
│     NEW BUY     │       NEW SELL            │
│                 │                           │
│  ✓ Cek posisi   │  ✓ Cek ada posisi?        │
│  ✓ Cek balance  │  ✓ Cancel auto-sell       │
│  ✓ Market order │  ✓ Market/Limit sell      │
│  ✓ Retry loop   │  ✓ Retry loop             │
│  ✓ Auto-sell    │  ✓ Remove position        │
│  ✓ Save posisi  │                           │
├─────────────────┴───────────────────────────┤
│             REDEEMER LOOP                   │
│  Cek berkala posisi yang sudah WIN          │
│  → Redeem on-chain via CTF contract         │
└─────────────────────────────────────────────┘
```

## Folder Structure

```
polymarket-copy/
├── src/
│   ├── config/index.js    — Environment vars & settings
│   ├── services/
│   │   ├── client.js      — CLOB client init & balance check
│   │   ├── watcher.js     — Poll trader activity
│   │   ├── executor.js    — Buy & sell logic
│   │   ├── position.js    — Position management
│   │   ├── autoSell.js    — Auto limit sell
│   │   └── redeemer.js    — Redeem winning positions
│   ├── utils/
│   │   ├── logger.js      — Color-coded logging
│   │   └── state.js       — JSON state management
│   └── index.js           — Main entry point
├── data/                  — Runtime state (gitignored)
├── .env.example
├── .gitignore
└── package.json
```

## Important Notes

- ⚠️ **Test dengan DRY_RUN=true** terlebih dahulu
- ⚠️ **Gunakan SIZE_PERCENT kecil** untuk percobaan awal
- ⚠️ **Private key jangan di-commit** — sudah ada di .gitignore
- Butuh USDC.e di Polygon untuk trading
- Butuh sedikit MATIC untuk gas fee (redeem positions)
