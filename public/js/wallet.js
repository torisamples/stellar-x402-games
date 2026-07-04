// Wallet adapter layer.
//
// Every wallet implements:
//   connect(): Promise<string /* Stellar address (G... or C...) */>
//   createPaymentHeaders({ headers, body }): Promise<Record<string,string>>
//     -> given a 402 response, return the X-PAYMENT retry headers
//
// Production: MeridianPayWallet (smart wallet / contract account, passkey-secured).
// Development: DevWallet (server-side Ed25519 test signer via /api/dev/*).

/**
 * Meridian Pay adapter — wire the real SDK in here.
 * Players will already be signed in, so `connect()` should resolve instantly.
 */
export class MeridianPayWallet {
  constructor() {
    this.address = null;
  }

  available() {
    // TODO(Meridian Pay SDK): detect the injected provider / SDK handle.
    return typeof window !== "undefined" && Boolean(window.MeridianPay);
  }

  async connect() {
    // TODO(Meridian Pay SDK): e.g.
    //   const session = await window.MeridianPay.connect();
    //   this.address = session.contractAddress;   // C... contract account
    if (!this.available()) throw new Error("Meridian Pay is not available in this browser.");
    const session = await window.MeridianPay.connect();
    this.address = session.contractAddress ?? session.address;
    return this.address;
  }

  async createPaymentHeaders({ headers /* , body */ }) {
    // The x402 payment requirements ride in the 402 response headers. The wallet
    // must build an "exact" scheme Stellar payment payload and sign the Soroban
    // auth entry with the user's passkey. With the SDK exposing a SEP-43 style
    // signer (signAuthEntry / signTransaction), this is:
    //
    //   import { x402Client, x402HTTPClient } from "https://esm.sh/@x402/fetch";
    //   import { ExactStellarScheme } from "https://esm.sh/@x402/stellar/exact/client";
    //   const client = new x402Client().register("stellar:*",
    //     new ExactStellarScheme(window.MeridianPay.signer));
    //   const http = new x402HTTPClient(client);
    //   const required = http.getPaymentRequiredResponse((n) => headers[n.toLowerCase()]);
    //   const payload = await client.createPaymentPayload(required);
    //   return http.encodePaymentSignatureHeader(payload);
    //
    // TODO(Meridian Pay SDK): replace with the SDK's native x402 helper if one exists.
    throw new Error("Meridian Pay x402 signing not wired up yet — see wallet.js TODOs.");
  }

  label() {
    return "Meridian Pay";
  }
}

/**
 * Dev wallet: a friendbot-funded testnet keypair held by the server (DEV_MODE only).
 * Lets you exercise the full x402 402 -> sign -> settle flow with zero setup.
 */
export class DevWallet {
  constructor() {
    this.address = null;
    this.secret = null;
  }

  available() {
    return true;
  }

  async connect() {
    // Add ?wallet=contract to the URL to play as a smart-wallet-style
    // CONTRACT ACCOUNT (C...) instead of a classic keypair.
    const type = new URLSearchParams(location.search).get("wallet") === "contract" ? "contract" : "ed25519";
    const saved = localStorage.getItem(`devWallet:${type}`);
    if (saved) {
      const { address, secret } = JSON.parse(saved);
      this.address = address;
      this.secret = secret;
      return address;
    }
    const res = await fetch("/api/dev/wallet", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type }),
    });
    if (!res.ok) throw new Error("Dev wallet unavailable. Is the server running with DEV_MODE=true?");
    const data = await res.json();
    this.address = data.address;
    this.secret = data.secret;
    localStorage.setItem(`devWallet:${type}`, JSON.stringify(data));
    return this.address;
  }

  async createPaymentHeaders({ headers }) {
    const res = await fetch("/api/dev/pay", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ headers, address: this.address, secret: this.secret }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Dev payment signing failed.");
    return data.paymentHeaders;
  }

  label() {
    return "Dev Wallet (testnet)";
  }
}

/** Prefer Meridian Pay when present; fall back to the dev wallet. */
export function pickWallet() {
  const meridian = new MeridianPayWallet();
  return meridian.available() ? meridian : new DevWallet();
}
