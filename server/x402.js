// The x402 paywall: 0.5 XLM (native SAC, SEP-41) per game session.
//
// Flow: client POSTs /api/{wheel,trivia}/session -> 402 Payment Required with
// payment requirements in the response headers/body -> wallet signs a Soroban
// auth entry / transaction -> client retries with the X-PAYMENT header ->
// facilitator verifies + settles on Stellar -> handler runs and issues a
// session token. Entry fees settle straight to PAY_TO.
import { paymentMiddlewareFromConfig } from "@x402/express";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactStellarScheme } from "@x402/stellar/exact/server";
import {
  ENTRY_FEE_STROOPS,
  ENTRY_FEE_XLM,
  FACILITATOR_API_KEY,
  FACILITATOR_URL,
  NATIVE_XLM_SAC,
  NETWORK,
  PAY_TO,
} from "./config.js";

export function buildPaywall() {
  const entryFee = {
    scheme: "exact",
    network: NETWORK,
    payTo: PAY_TO,
    // Price in native XLM, atomic units (7 decimals): 0.5 XLM = 5_000_000 stroops.
    price: { asset: NATIVE_XLM_SAC, amount: ENTRY_FEE_STROOPS },
  };

  const facilitator = new HTTPFacilitatorClient({
    url: FACILITATOR_URL,
    // OpenZeppelin Channels (mainnet) authenticates with an API key.
    ...(FACILITATOR_API_KEY
      ? { createAuthHeaders: async () => ({ Authorization: `Bearer ${FACILITATOR_API_KEY}` }) }
      : {}),
  });

  return paymentMiddlewareFromConfig(
    {
      "POST /api/wheel/session": {
        accepts: entryFee,
        resource: { description: `Spin the Wheel — ${ENTRY_FEE_XLM} XLM per spin` },
      },
      "POST /api/trivia/session": {
        accepts: entryFee,
        resource: { description: `Stellar Trivia — ${ENTRY_FEE_XLM} XLM entry` },
      },
    },
    facilitator,
    [{ network: "stellar:*", server: new ExactStellarScheme() }],
  );
}
