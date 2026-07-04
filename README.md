# Stellar Arcade — two x402-gated games

Two fast games behind a **0.5 XLM x402 paywall**, with prizes paid straight to the player's connected wallet on Stellar.

| Game | URL | Entry | Prize | Limit |
|---|---|---|---|---|
| 🎡 Spin the Wheel | `/wheel/` | 0.5 XLM | XLM (0.5–5), swag codes, rare VIP Photo Op | 3 plays/wallet |
| 🧠 Stellar Trivia | `/trivia/` | 0.5 XLM | 2 XLM per correct answer, paid once at the end | 1 play/wallet |

## Tech stack

- **Node 22 + Express** — one app, both games, deployed as a single Vercel serverless function (`api/index.js`) with the frontend served statically from `public/`.
- **x402 on Stellar** — `@x402/express` middleware + `@x402/stellar` "exact" scheme. Entry fee is priced in **native XLM** via its SEP-41 Stellar Asset Contract (not USDC): `price: { asset: <native SAC>, amount: "5000000" }`.
- **Facilitator** — Coinbase's hosted facilitator (`https://www.x402.org/facilitator`) on testnet (sponsored fees); OpenZeppelin Channels on mainnet.
- **Payouts** — a hot wallet pays prizes: classic Horizon payment for `G...` addresses, native-SAC `transfer` via Soroban RPC for `C...` **contract accounts (Meridian Pay wallets)**. Submissions are serialized to avoid sequence collisions.
- **State** — Upstash Redis (Vercel Marketplace) for play limits / sessions / redemption codes; in-memory fallback for local dev.
- **Frontend** — vanilla HTML/CSS/JS, no build step. Canvas wheel animation; outcomes are decided **server-side** (weighted RNG via `crypto.randomInt`), the wheel just animates to the result. Trivia answers are validated server-side with per-question time windows; correct answers never reach the browser.

## How the paywall works

1. Client `POST /api/wheel/session` (or `/api/trivia/session`) → server responds `402 Payment Required` with payment requirements in headers.
2. Wallet signs a Soroban auth entry / transaction for exactly 0.5 XLM to the treasury.
3. Client retries with `X-PAYMENT` headers → facilitator verifies + settles on Stellar (~5s) → handler issues a session token.
4. Game plays out; prizes flow back from the payout wallet.

Play limits are enforced **before** the paywall middleware, so a maxed-out wallet is rejected with `403` before being charged.

## Run locally (testnet)

```bash
npm install
cp .env.example .env          # set PAYOUT_SECRET (fund at https://lab.stellar.org/account/fund)
npm run dev                   # starts with DEV_MODE=true on :3001
```

Open http://localhost:3001 — "Connect Wallet" uses the dev wallet (a friendbot-funded testnet keypair signed server-side), so you can play both games end-to-end with zero setup. `test/e2e.js` runs the whole loop headlessly:

```bash
node test/e2e.js              # against a running server
```

## Deploy to Vercel

1. `vercel` (or import the repo in the dashboard). `vercel.json` routes `/api/*` to the Express function; `public/` ships to the CDN.
2. Add **Upstash Redis** from the Vercel Marketplace (injects `KV_REST_API_URL` / `KV_REST_API_TOKEN`). Required in production — serverless instances don't share memory.
3. Set env vars: `PAYOUT_SECRET` (funded hot wallet), optionally `PAY_TO_ADDRESS`, and `DEV_MODE=true` only while testing.
4. Each game lives at its own URL: `https://<app>.vercel.app/wheel/` and `.../trivia/`.

## Switching to mainnet

Config-only:

```
STELLAR_NETWORK=stellar:pubnet
FACILITATOR_URL=https://channels.openzeppelin.com/x402
FACILITATOR_API_KEY=<from https://channels.openzeppelin.com/gen>
PAYOUT_SECRET=<funded mainnet hot wallet>
DEV_MODE=false                # dev endpoints refuse to run on mainnet anyway
```

The native XLM SAC address flips automatically. Budget note: expected wheel payout is ~0.9 XLM per 0.5 XLM spin (weights in `server/games/wheel.js`), and a perfect trivia run pays 20 XLM — tune `SEGMENTS` weights and `TRIVIA_XLM_PER_CORRECT` to taste.

## Wiring up Meridian Pay

`public/js/wallet.js` defines the adapter interface every wallet implements:

```
connect() -> address                      // C... contract account
createPaymentHeaders({headers, body})     // 402 -> signed X-PAYMENT headers
```

`MeridianPayWallet` is stubbed with TODOs at the exact integration points: `connect()` should resolve the signed-in session's contract address, and `createPaymentHeaders` should feed the wallet's SEP-43-style signer (passkey signs the Soroban auth entry) into `ExactStellarScheme` from `@x402/stellar/exact/client` (bundle it or load from esm.sh). Everything else — paywall, payouts to C-addresses, limits — already handles contract accounts.

**Note:** the C-address payout path (native SAC `transfer` via Soroban RPC) is implemented but was verified only against G-addresses in testing; give it one smoke test with a real Meridian Pay wallet.

## Booth operations

- Swag/VIP wheel prizes issue codes like `MERIDIAN-7E91B60A`; verify + burn them at the booth via `POST /api/wheel/redeem {"code": "..."}`.
- Payout failures never block gameplay — the player sees a friendly message and the error is logged.

## Layout

```
api/index.js            Vercel entry (exports the Express app)
server/
  app.js                wiring: limits → dev → paywall → games → static
  config.js             env-driven config, testnet/mainnet switch
  x402.js               0.5 XLM paywall (native SAC, exact scheme)
  payouts.js            XLM to G... (Horizon) and C... (Soroban SAC transfer)
  store.js              Upstash Redis / in-memory: plays, sessions, codes
  dev.js                TESTNET-ONLY dev wallet + payment signer
  games/wheel.js        weighted outcomes, redemption codes
  games/trivia.js       server-validated answers, single final payout
  games/trivia-questions.js
public/                 landing, /wheel/, /trivia/, wallet adapters
test/e2e.js             full-loop smoke test (real testnet settlement)
```
