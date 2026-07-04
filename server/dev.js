// TESTNET-ONLY dev helpers (enabled with DEV_MODE=true; hard-disabled on mainnet).
//
// These stand in for the Meridian Pay wallet during development:
//   POST /api/dev/wallet                    -> friendbot-funded classic keypair (G...)
//   POST /api/dev/wallet {type:"contract"}  -> deploys a smart-wallet-style CONTRACT
//                                              ACCOUNT (C...) that both pays and receives
//   POST /api/dev/pay                       -> given a 402 response's headers, build and
//                                              sign the x402 payment payload and return
//                                              the X-PAYMENT retry headers.
//
// In production, signing happens inside the player's Meridian Pay wallet
// (passkey signs the Soroban auth entry). See public/js/wallet.js.
import { Keypair, Transaction, TransactionBuilder } from "@stellar/stellar-sdk";
import { x402Client, x402HTTPClient } from "@x402/fetch";
import { createEd25519Signer, getNetworkPassphrase } from "@x402/stellar";
import { ExactStellarScheme } from "@x402/stellar/exact/client";
import { DEV_MODE, DEV_PLAYER_SECRET, NETWORK, RPC_URL } from "./config.js";
import { ContractAccountScheme, deploySimpleAccount } from "./contract-wallet.js";

let devWallet = DEV_PLAYER_SECRET
  ? { type: "ed25519", secret: DEV_PLAYER_SECRET, address: Keypair.fromSecret(DEV_PLAYER_SECRET).publicKey() }
  : null;

export function mountDev(app) {
  if (!DEV_MODE) return;
  console.warn("⚠ DEV_MODE enabled: /api/dev/* endpoints are live (testnet only).");

  app.post("/api/dev/wallet", async (req, res) => {
    try {
      const type = req.body?.type || req.query?.type || "ed25519";
      if (type === "contract") {
        // Smart-wallet stand-in: deploy a custom account contract (C...).
        devWallet = await deploySimpleAccount();
      } else {
        const kp = Keypair.random();
        const r = await fetch(`https://friendbot.stellar.org/?addr=${kp.publicKey()}`);
        if (!r.ok) throw new Error(`friendbot: ${r.status}`);
        devWallet = { type: "ed25519", address: kp.publicKey(), secret: kp.secret() };
      }
      res.json({ ...devWallet, funded: true });
    } catch (err) {
      console.error("dev wallet failed:", err);
      res.status(500).json({ error: String(err?.message || err) });
    }
  });

  app.post("/api/dev/pay", async (req, res) => {
    try {
      const { headers = {}, address, secret } = req.body || {};
      const w =
        address && secret
          ? { type: address.startsWith("C") ? "contract" : "ed25519", address, secret }
          : devWallet;
      if (!w) {
        return res.status(400).json({ error: "No dev wallet. POST /api/dev/wallet first or set DEV_PLAYER_SECRET." });
      }

      // Contract account (C...): our custom scheme signs the auth entry with the
      // wallet's owner key. Classic account (G...): the stock Ed25519 signer.
      const schemeClient =
        w.type === "contract"
          ? new ContractAccountScheme(w.address, Keypair.fromSecret(w.secret))
          : new ExactStellarScheme(createEd25519Signer(w.secret, NETWORK), { url: RPC_URL });

      const client = new x402Client().register("stellar:*", schemeClient);
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
