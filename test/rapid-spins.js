// Reproduce: multiple back-to-back wheel payments from the same contract wallet.
const BASE = process.env.BASE_URL || "http://localhost:3001";
const j = async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return { raw: t }; } };

const wres = await fetch(BASE + "/api/dev/wallet", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ type: "contract" }),
});
const wallet = await j(wres);
if (!wres.ok) throw new Error(JSON.stringify(wallet));
console.log("wallet:", wallet.address);

for (let n = 1; n <= 3; n++) {
  const t0 = Date.now();
  const first = await fetch(BASE + "/api/wheel/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address: wallet.address }),
  });
  if (first.status !== 402) { console.log(`spin ${n}: unexpected first status ${first.status}`, await j(first)); continue; }
  const headers = {};
  first.headers.forEach((v, k) => (headers[k] = v));
  const payRes = await fetch(BASE + "/api/dev/pay", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ headers }),
  });
  const pay = await j(payRes);
  if (!payRes.ok) { console.log(`spin ${n}: dev/pay FAILED:`, pay.error); continue; }
  const retry = await fetch(BASE + "/api/wheel/session", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...pay.paymentHeaders },
    body: JSON.stringify({ address: wallet.address }),
  });
  const data = await j(retry);
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  if (retry.status === 200) {
    console.log(`spin ${n}: OK in ${secs}s (playsUsed ${data.playsUsed})`);
  } else {
    console.log(`spin ${n}: FAILED ${retry.status} in ${secs}s`);
    console.log("   body error:", JSON.stringify(data.error ?? data).slice(0, 500));
    const settleHdr = retry.headers.get("x-payment-response") || retry.headers.get("payment-response");
    if (settleHdr) console.log("   settle header:", settleHdr.slice(0, 300));
  }
}
