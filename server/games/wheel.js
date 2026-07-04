// Game 1: Spin the Wheel. 10 segments; the OUTCOME is decided server-side
// with weighted randomness, then the client animates the wheel to land on it.
import crypto from "node:crypto";
import * as store from "../store.js";
import { sendXlm } from "../payouts.js";
import { ENTRY_FEE_XLM, WHEEL_MAX_PLAYS } from "../config.js";

// 10 segments. `weight` controls server-side odds (sums to 100).
// Expected XLM payout per spin ≈ 0.905 XLM vs 0.5 XLM entry — conference-generous;
// tune weights/amounts for your budget.
export const SEGMENTS = [
  { id: 0, type: "xlm", label: "1 XLM", amount: 1, weight: 14 },
  { id: 1, type: "swag", label: "Sticker Pack", weight: 13 },
  { id: 2, type: "xlm", label: "0.5 XLM", amount: 0.5, weight: 14 },
  { id: 3, type: "swag", label: "Stellar Tee", weight: 10 },
  { id: 4, type: "xlm", label: "2 XLM", amount: 2, weight: 10 },
  { id: 5, type: "swag", label: "Sticker Pack", weight: 13 },
  { id: 6, type: "xlm", label: "1 XLM", amount: 1, weight: 14 },
  { id: 7, type: "xlm", label: "5 XLM", amount: 5, weight: 5 },
  { id: 8, type: "swag", label: "Stellar Cap", weight: 6 },
  { id: 9, type: "vip", label: "VIP Photo Op ★", weight: 1 },
];

function pickSegment() {
  const total = SEGMENTS.reduce((s, seg) => s + seg.weight, 0);
  let roll = crypto.randomInt(total);
  for (const seg of SEGMENTS) {
    roll -= seg.weight;
    if (roll < 0) return seg;
  }
  return SEGMENTS[0];
}

function redemptionCode() {
  return `MERIDIAN-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
}

const ADDRESS_RE = /^[GC][A-Z2-7]{55}$/;

export function mountWheel(app) {
  // Public config for rendering the wheel (no weights exposed).
  app.get("/api/wheel/config", async (req, res) => {
    const segments = SEGMENTS.map(({ id, type, label }) => ({ id, type, label }));
    const address = String(req.query.address || "");
    const playsUsed = ADDRESS_RE.test(address) ? await store.getPlays("wheel", address) : 0;
    res.json({ segments, entryFeeXlm: ENTRY_FEE_XLM, maxPlays: WHEEL_MAX_PLAYS, playsUsed });
  });

  // PAYWALLED (x402 middleware runs first): buy one spin.
  app.post("/api/wheel/session", async (req, res) => {
    const address = String(req.body?.address || "");
    if (!ADDRESS_RE.test(address)) {
      return res.status(400).json({ error: "Valid Stellar address (G... or C...) required." });
    }
    const playsUsed = await store.recordPlay("wheel", address);
    const token = crypto.randomUUID();
    await store.createSession(token, { game: "wheel", address, spun: false });
    res.json({ token, playsUsed, maxPlays: WHEEL_MAX_PLAYS });
  });

  // Spend the spin credit. Server decides the outcome and pays out.
  app.post("/api/wheel/spin", async (req, res) => {
    const token = String(req.body?.token || "");
    const session = await store.getSession(token);
    if (!session || session.game !== "wheel") {
      return res.status(404).json({ error: "Unknown or expired session. Pay to play!" });
    }
    if (session.spun) {
      return res.status(409).json({ error: "This spin was already used. Pay for another!" });
    }
    session.spun = true;
    await store.updateSession(token, session);

    const seg = pickSegment();
    const result = { segmentIndex: seg.id, prize: { type: seg.type, label: seg.label } };

    if (seg.type === "xlm") {
      result.payout = await sendXlm(session.address, seg.amount, "Wheel prize");
      result.prize.amount = seg.amount;
    } else {
      const code = redemptionCode();
      await store.saveRedemption(code, {
        prize: seg.label,
        type: seg.type,
        address: session.address,
        redeemed: false,
        createdAt: new Date().toISOString(),
      });
      result.redemptionCode = code;
      result.redeemNote =
        seg.type === "vip"
          ? "Show this code at the Stellar booth to book your VIP photo op!"
          : "Show this code at the Stellar booth to grab your swag.";
    }
    res.json(result);
  });

  // Booth-staff endpoint: verify + burn a redemption code.
  app.post("/api/wheel/redeem", async (req, res) => {
    const code = String(req.body?.code || "").toUpperCase().trim();
    const found = await store.getRedemption(code);
    if (!found) return res.status(404).json({ valid: false, error: "Code not found." });
    if (found.redeemed) return res.status(409).json({ valid: false, error: "Already redeemed.", ...found });
    const updated = await store.markRedeemed(code);
    res.json({ valid: true, ...updated });
  });
}
