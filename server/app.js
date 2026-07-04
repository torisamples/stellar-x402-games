import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { assertServerConfig, TRIVIA_MAX_PLAYS, WHEEL_MAX_PLAYS } from "./config.js";
import * as store from "./store.js";
import { buildPaywall } from "./x402.js";
import { mountDev } from "./dev.js";
import { mountWheel } from "./games/wheel.js";
import { mountTrivia } from "./games/trivia.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());

for (const p of assertServerConfig()) console.warn(`⚠ config: ${p}`);

// Play-limit precheck BEFORE the paywall, so nobody pays for a session
// they aren't allowed to start. (The paywall settles money before handlers run.)
const LIMITS = { "/api/wheel/session": ["wheel", WHEEL_MAX_PLAYS], "/api/trivia/session": ["trivia", TRIVIA_MAX_PLAYS] };
app.use(async (req, res, next) => {
  const limit = req.method === "POST" && LIMITS[req.path];
  if (!limit) return next();
  const [game, max] = limit;
  const address = String(req.body?.address || "");
  if (/^[GC][A-Z2-7]{55}$/.test(address)) {
    const used = await store.getPlays(game, address);
    if (used >= max) {
      return res.status(403).json({
        error: game === "wheel" ? `Limit reached: ${max} spins per wallet.` : "You already played — one run per wallet!",
        playsUsed: used,
        maxPlays: max,
      });
    }
  }
  next();
});

// Dev helpers (no-op unless DEV_MODE=true on testnet).
mountDev(app);

// The x402 paywall guards the session-creation routes.
app.use(buildPaywall());

// Games.
mountWheel(app);
mountTrivia(app);

// Health.
app.get("/api/health", (_req, res) => res.json({ ok: true }));

// Static frontend (Vercel serves public/ via CDN; this covers local dev).
app.use(express.static(path.join(__dirname, "..", "public")));

export default app;
