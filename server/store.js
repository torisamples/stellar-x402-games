// Tiny state store: play counts, game sessions, swag redemption codes.
// Uses Upstash Redis (REST) when configured — required on Vercel, where
// serverless instances don't share memory. Falls back to in-memory for local dev.
import { KV_URL, KV_TOKEN } from "./config.js";

const memory = new Map(); // key -> { value, expiresAt }

function memGet(key) {
  const e = memory.get(key);
  if (!e) return null;
  if (e.expiresAt && Date.now() > e.expiresAt) {
    memory.delete(key);
    return null;
  }
  return e.value;
}
function memSet(key, value, ttlSec) {
  memory.set(key, { value, expiresAt: ttlSec ? Date.now() + ttlSec * 1000 : 0 });
}

async function kv(cmd) {
  const res = await fetch(KV_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${KV_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(cmd),
  });
  if (!res.ok) throw new Error(`KV error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.result;
}

const useKv = Boolean(KV_URL && KV_TOKEN);

export async function get(key) {
  if (!useKv) return memGet(key);
  const raw = await kv(["GET", key]);
  return raw == null ? null : JSON.parse(raw);
}

export async function set(key, value, ttlSec = 0) {
  if (!useKv) return memSet(key, value, ttlSec);
  const cmd = ttlSec ? ["SET", key, JSON.stringify(value), "EX", String(ttlSec)] : ["SET", key, JSON.stringify(value)];
  await kv(cmd);
}

export async function incr(key, ttlSec = 0) {
  if (!useKv) {
    const cur = (memGet(key) || 0) + 1;
    memSet(key, cur, ttlSec);
    return cur;
  }
  const n = await kv(["INCR", key]);
  if (ttlSec && n === 1) await kv(["EXPIRE", key, String(ttlSec)]);
  return n;
}

// ---- Domain helpers ----------------------------------------------------

const PLAYS_TTL = 14 * 24 * 3600; // keep play counts for two weeks
const SESSION_TTL = 3600; // 1h

export async function getPlays(game, address) {
  return (await get(`plays:${game}:${address}`)) || 0;
}

export async function recordPlay(game, address) {
  return incr(`plays:${game}:${address}`, PLAYS_TTL);
}

export async function createSession(token, data) {
  await set(`session:${token}`, data, SESSION_TTL);
}

export async function getSession(token) {
  return get(`session:${token}`);
}

export async function updateSession(token, data) {
  await set(`session:${token}`, data, SESSION_TTL);
}

export async function saveRedemption(code, data) {
  await set(`redeem:${code}`, data, 30 * 24 * 3600);
}

export async function getRedemption(code) {
  return get(`redeem:${code}`);
}

export async function markRedeemed(code) {
  const data = await get(`redeem:${code}`);
  if (!data) return null;
  data.redeemed = true;
  data.redeemedAt = new Date().toISOString();
  await set(`redeem:${code}`, data, 30 * 24 * 3600);
  return data;
}
