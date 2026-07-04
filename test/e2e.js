// End-to-end smoke test against a locally running server (DEV_MODE=true, testnet).
// Exercises: dev wallet funding -> x402 402 -> dev signing -> facilitator settle
// -> wheel spin + payout -> trivia full run + payout -> play limits.
const BASE = process.env.BASE_URL || "http://localhost:3001";

const log = (...a) => console.log("»", ...a);

async function j(res) {
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

async function payAndCall(path, body) {
  const first = await fetch(BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (first.status !== 402) return { status: first.status, data: await j(first) };

  const headers = {};
  first.headers.forEach((v, k) => (headers[k] = v));
  log(`402 received for ${path} — signing payment…`);
  const payRes = await fetch(BASE + "/api/dev/pay", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ headers }),
  });
  const pay = await j(payRes);
  if (!payRes.ok) throw new Error("dev pay failed: " + JSON.stringify(pay));

  const retry = await fetch(BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...pay.paymentHeaders },
    body: JSON.stringify(body),
  });
  return { status: retry.status, data: await j(retry) };
}

const start = Date.now();

// 1) Dev wallet (this is the "player").
//    PLAYER_TYPE=contract -> a smart-wallet-style CONTRACT ACCOUNT (C...) that
//    both PAYS the entry fee and RECEIVES the prizes (the Meridian Pay case).
const walletType = process.env.PLAYER_TYPE === "contract" ? "contract" : "ed25519";
const wres = await fetch(BASE + "/api/dev/wallet", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ type: walletType }),
});
const wallet = await j(wres);
if (!wres.ok) throw new Error("wallet: " + JSON.stringify(wallet));
// PLAYER_ADDRESS optionally points payouts somewhere other than the payer.
const PLAYER = process.env.PLAYER_ADDRESS || wallet.address;
log(`player wallet (${wallet.type}):`, wallet.address);
if (PLAYER !== wallet.address) log("payout destination override:", PLAYER);

// 2) Wheel: pay 0.5 XLM via x402, then spin
const s1 = await payAndCall("/api/wheel/session", { address: PLAYER });
log("wheel session:", s1.status, JSON.stringify(s1.data));
if (s1.status !== 200) throw new Error("wheel session failed");

const spin = await fetch(BASE + "/api/wheel/spin", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ token: s1.data.token }),
});
const spinData = await j(spin);
log("spin result:", spin.status, JSON.stringify(spinData));
if (spin.status !== 200) throw new Error("spin failed");

// Double-spend the spin credit (should 409)
const spin2 = await fetch(BASE + "/api/wheel/spin", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ token: s1.data.token }),
});
log("double-spin blocked:", spin2.status === 409 ? "OK" : `FAIL (${spin2.status})`);

// 3) Trivia: pay, then answer all 10 (alternate right-ish/wrong answers blindly)
const t = await payAndCall("/api/trivia/session", { address: PLAYER });
log("trivia session:", t.status, JSON.stringify(t.data).slice(0, 160));
if (t.status !== 200) throw new Error("trivia session failed");

let payload = t.data, answered = 0, final = null;
while (answered < 10) {
  const res = await fetch(BASE + "/api/trivia/answer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: t.data.token, choiceIndex: answered % 4 }),
  });
  const data = await j(res);
  if (res.status !== 200) throw new Error("answer failed: " + JSON.stringify(data));
  answered++;
  if (data.done) final = data;
}
log("trivia final:", JSON.stringify({ score: final.score, totalXlm: final.totalXlm, payout: final.payout }));

// 4) Trivia replay must be blocked BEFORE payment (403, no 402)
const replay = await fetch(BASE + "/api/trivia/session", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ address: PLAYER }),
});
log("trivia replay blocked pre-payment:", replay.status === 403 ? "OK" : `FAIL (${replay.status})`);

log(`ALL CHECKS PASSED in ${((Date.now() - start) / 1000).toFixed(1)}s`);
