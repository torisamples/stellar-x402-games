// Central configuration. Everything is env-driven so the testnet -> mainnet
// switch is a config change, not a code change.
import { Keypair } from "@stellar/stellar-sdk";

export const NETWORK = process.env.STELLAR_NETWORK || "stellar:testnet";
export const IS_TESTNET = NETWORK === "stellar:testnet";

export const NETWORK_PASSPHRASE = IS_TESTNET
  ? "Test SDF Network ; September 2015"
  : "Public Global Stellar Network ; September 2015";

export const RPC_URL =
  process.env.STELLAR_RPC_URL ||
  (IS_TESTNET ? "https://soroban-testnet.stellar.org" : "https://mainnet.sorobanrpc.com");

export const HORIZON_URL =
  process.env.HORIZON_URL ||
  (IS_TESTNET ? "https://horizon-testnet.stellar.org" : "https://horizon.stellar.org");

export const EXPLORER_URL = IS_TESTNET
  ? "https://stellar.expert/explorer/testnet"
  : "https://stellar.expert/explorer/public";

// Native XLM Stellar Asset Contract (SEP-41). Derived from Asset.native().contractId().
export const NATIVE_XLM_SAC = IS_TESTNET
  ? "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC"
  : "CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA";

// x402 facilitator. Coinbase's facilitator supports stellar:testnet with
// sponsored fees. For mainnet use the OpenZeppelin Channels facilitator
// (https://channels.openzeppelin.com/x402) and set FACILITATOR_API_KEY.
export const FACILITATOR_URL =
  process.env.FACILITATOR_URL ||
  (IS_TESTNET ? "https://www.x402.org/facilitator" : "https://channels.openzeppelin.com/x402");
export const FACILITATOR_API_KEY = process.env.FACILITATOR_API_KEY || "";

// Prize payout hot wallet (S... secret). Entry fees land on PAY_TO_ADDRESS,
// which defaults to the payout wallet's public key.
export const PAYOUT_SECRET = process.env.PAYOUT_SECRET || "";
export const PAY_TO =
  process.env.PAY_TO_ADDRESS ||
  (PAYOUT_SECRET ? Keypair.fromSecret(PAYOUT_SECRET).publicKey() : "");

// Game economics
export const ENTRY_FEE_XLM = process.env.ENTRY_FEE_XLM || "0.5";
export const ENTRY_FEE_STROOPS = String(Math.round(Number(ENTRY_FEE_XLM) * 10_000_000));

export const WHEEL_MAX_PLAYS = Number(process.env.WHEEL_MAX_PLAYS || 3);
export const TRIVIA_MAX_PLAYS = Number(process.env.TRIVIA_MAX_PLAYS || 1);
export const TRIVIA_XLM_PER_CORRECT = Number(process.env.TRIVIA_XLM_PER_CORRECT || 2);

// Per-question answer window (server-side; client shows 12s + network slack)
export const TRIVIA_ANSWER_WINDOW_MS = Number(process.env.TRIVIA_ANSWER_WINDOW_MS || 20_000);
// Hard cap on a whole trivia session
export const TRIVIA_SESSION_MAX_MS = Number(process.env.TRIVIA_SESSION_MAX_MS || 4 * 60_000);

// Dev mode: enables /api/dev/* helpers (server-side test signer, friendbot).
// Refuses to run on mainnet.
export const DEV_MODE = process.env.DEV_MODE === "true" && IS_TESTNET;
export const DEV_PLAYER_SECRET = process.env.DEV_PLAYER_SECRET || "";

// Upstash Redis (Vercel Marketplace) — optional; falls back to in-memory for local dev.
export const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "";
export const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";

export function assertServerConfig() {
  const problems = [];
  if (!PAY_TO) problems.push("PAY_TO_ADDRESS or PAYOUT_SECRET must be set (entry-fee destination).");
  if (!PAYOUT_SECRET) problems.push("PAYOUT_SECRET not set — prize payouts will be skipped.");
  return problems;
}
