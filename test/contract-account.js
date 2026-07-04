// Helpers for testing payouts to CONTRACT ACCOUNTS (C... addresses), i.e. the
// Meridian Pay smart-wallet case.
//
//   node test/contract-account.js deploy   -> deploys a contract on testnet, prints its C... address
//   node test/contract-account.js pay C... -> sends 1.5 XLM to it via server/payouts.js
//   node test/contract-account.js balance C... -> reads its XLM balance from the native SAC
//
// Requires PAYOUT_SECRET in the environment (npm scripts load .env).
import {
  Asset,
  BASE_FEE,
  Contract,
  Keypair,
  Operation,
  TransactionBuilder,
  nativeToScVal,
  scValToNative,
  rpc,
} from "@stellar/stellar-sdk";
import { NATIVE_XLM_SAC, NETWORK_PASSPHRASE, PAYOUT_SECRET, RPC_URL } from "../server/config.js";
import { sendXlm } from "../server/payouts.js";

const server = new rpc.Server(RPC_URL);
const [cmd, arg] = process.argv.slice(2);

async function submit(tx, kp) {
  const prepared = await server.prepareTransaction(tx);
  prepared.sign(kp);
  const sent = await server.sendTransaction(prepared);
  if (sent.status === "ERROR") throw new Error(JSON.stringify(sent.errorResult ?? sent));
  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    const got = await server.getTransaction(sent.hash);
    if (got.status === "SUCCESS") return got;
    if (got.status === "FAILED") throw new Error(JSON.stringify(got.resultXdr?.toXDR?.("base64") ?? got));
  }
  throw new Error("timed out waiting for tx " + sent.hash);
}

if (cmd === "deploy") {
  // Deploy a Stellar Asset Contract for a throwaway asset. Any deployed
  // contract has a C... address and can hold XLM balances — a fine stand-in
  // for a smart-wallet contract account on the RECEIVING side.
  const kp = Keypair.fromSecret(PAYOUT_SECRET);
  const asset = new Asset("DEMOPLAYER", kp.publicKey());
  const cid = asset.contractId(NETWORK_PASSPHRASE);
  console.log("contract address:", cid);
  try {
    const account = await server.getAccount(kp.publicKey());
    const tx = new TransactionBuilder(account, {
      fee: String(Number(BASE_FEE) * 100),
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(Operation.createStellarAssetContract({ asset }))
      .setTimeout(60)
      .build();
    await submit(tx, kp);
    console.log("deployed ✓");
  } catch (e) {
    if (String(e).includes("ExistingValue") || String(e).includes("AAAAAA==")) {
      console.log("already deployed ✓");
    } else throw e;
  }
} else if (cmd === "pay") {
  console.log(await sendXlm(arg, "1.5", "C-addr payout test"));
} else if (cmd === "balance") {
  // Read XLM balance of any address from the native SAC via simulation.
  const kp = Keypair.fromSecret(PAYOUT_SECRET);
  const account = await server.getAccount(kp.publicKey());
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE })
    .addOperation(new Contract(NATIVE_XLM_SAC).call("balance", nativeToScVal(arg, { type: "address" })))
    .setTimeout(60)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (!rpc.Api.isSimulationSuccess(sim)) throw new Error(JSON.stringify(sim));
  const stroops = scValToNative(sim.result.retval);
  console.log(`balance of ${arg.slice(0, 6)}…: ${Number(stroops) / 1e7} XLM`);
} else {
  console.log("usage: node test/contract-account.js deploy | pay C... | balance C...");
}
