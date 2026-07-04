// TESTNET-ONLY dev helpers (enabled with DEV_MODE=true; hard-disabled on mainnet).
//
// These stand in for the Meridian Pay wallet during development:
//   POST /api/dev/wallet  -> generate + friendbot-fund a throwaway keypair
//   POST /api/dev/pay     -> given a 402 response (headers+body), build and sign
//                            the x402 payment payload with the dev secret and
//                            return the X-PAYMENT retry headers.
//
// In production, step 2 happens inside the player's Meridian Pay wallet
// (passkey signs the Soroban auth entry). See public/js/wallet.js.
import { Keypair, Transaction, TransactionBuilder } from "@stellar/stellar-sdk";
import { x402Client, x402HTTPClient } from "@x402/fetch";
import { createEd25519Signer, getNetworkPassphrase } from "@x402/stellar";
import { ExactStellarScheme } from "@x402/stellar/exact/client";
import { DEV_MODE, DEV_PLAYER_SECRET, NETWORK, RPC_URL } from "./config.js";

let devSecret = DEV_PLAYER_SECRET;

export function mountDev(app) {
  if (!DEV_MODE) return;
  console.warn("⚠ DEV_MODE enabled: /api/dev/* endpoints are live (testnet only).");

  app.post("/api/dev/wallet", async (_req, res) => {
    try {
      const kp = Keypair.random();
      const r = await fetch(`https://friendbot.stellar.org/?addr=${kp.publicKey()}`);
      if (!r.ok) throw new Error(`friendbot: ${r.status}`);
      devSecret = kp.secret(); // subsequent /api/dev/pay calls sign with this wallet
      res.json({ address: kp.publicKey(), secret: kp.secret(), funded: true });
    } catch (err) {
      res.status(500).json({ error: String(err?.message || err) });
    }
  });

  app.post("/api/dev/pay", async (req, res) => {
    try {
      if (!devSecret) {
        return res.status(400).json({ error: "No dev wallet. POST /api/dev/wallet first or set DEV_PLAYER_SECRET." });
      }
      const { headers = {}, secret } = req.body || {};
      const signer = createEd25519Signer(secret || devSecret, NETWORK);
      const client = new x402Client().register(
        "stellar:*",
        new ExactStellarScheme(signer, { url: RPC_URL }),
      );
      const httpClient = new x402HTTPClient(client);

      const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
      const paymentRequired = httpClient.getPaymentRequiredResponse((name) => lower[name.toLowerCase()]);

      let paymentPayload = await client.createPaymentPayload(paymentRequired);

      // Testnet facilitator sponsors fees but rejects txs above its fee limit;
      // pin the fee to 1 stroop (same trick as the official quickstart).
      const passphrase = getNetworkPassphrase(NETWORK);
      const tx = new Transaction(paymentPayload.payload.transaction, passphrase);
      const sorobanData = tx.toEnvelope().v1()?.tx()?.ext()?.sorobanData();
      if (sorobanData) {
        paymentPayload = {
          ...paymentPayload,
          payload: {
            ...paymentPayload.payload,
            transaction: TransactionBuilder.cloneFrom(tx, {
              fee: "1",
              sorobanData,
              networkPassphrase: passphrase,
            })
              .build()
              .toXDR(),
          },
        };
      }

      res.json({ paymentHeaders: httpClient.encodePaymentSignatureHeader(paymentPayload) });
    } catch (err) {
      console.error("dev pay failed:", err);
      res.status(500).json({ error: String(err?.message || err) });
    }
  });
}
