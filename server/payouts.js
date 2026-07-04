// XLM prize payouts from the game's hot wallet.
//
// Two paths, because Meridian Pay wallets are *contract accounts* (C... addresses):
//   - G... destination -> classic Horizon payment (with createAccount fallback)
//   - C... destination -> invoke the native XLM SAC `transfer` via Soroban RPC
//
// A promise-chain queue serializes submissions so the single hot wallet's
// sequence number never collides.
import {
  Asset,
  BASE_FEE,
  Contract,
  Horizon,
  Keypair,
  Memo,
  Operation,
  TransactionBuilder,
  nativeToScVal,
  rpc,
} from "@stellar/stellar-sdk";
import {
  HORIZON_URL,
  NATIVE_XLM_SAC,
  NETWORK_PASSPHRASE,
  PAYOUT_SECRET,
  RPC_URL,
} from "./config.js";

const horizon = new Horizon.Server(HORIZON_URL);
const soroban = new rpc.Server(RPC_URL, { allowHttp: false });

let queue = Promise.resolve();
function enqueue(job) {
  const run = queue.then(job, job); // keep the chain alive even after failures
  queue = run.catch(() => {});
  return run;
}

/**
 * Send `amountXlm` (decimal string or number) to `destination` (G... or C...).
 * Returns { status: "paid", tx } | { status: "skipped", reason } | { status: "failed", error }
 */
export function sendXlm(destination, amountXlm, memoText = "") {
  if (!PAYOUT_SECRET) {
    return Promise.resolve({ status: "skipped", reason: "no_payout_key" });
  }
  return enqueue(async () => {
    try {
      const kp = Keypair.fromSecret(PAYOUT_SECRET);
      const amount = Number(amountXlm).toFixed(7);
      const hash = destination.startsWith("C")
        ? await payContractAccount(kp, destination, amount)
        : await payClassicAccount(kp, destination, amount, memoText);
      return { status: "paid", tx: hash };
    } catch (err) {
      console.error("payout failed:", err?.response?.data?.extras ?? err);
      return { status: "failed", error: String(err?.message || err) };
    }
  });
}

async function payClassicAccount(kp, destination, amount, memoText) {
  const account = await horizon.loadAccount(kp.publicKey());
  const build = (op) => {
    const b = new TransactionBuilder(account, {
      fee: String(Number(BASE_FEE) * 10),
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(op)
      .setTimeout(60);
    if (memoText) b.addMemo(Memo.text(memoText.slice(0, 28)));
    const tx = b.build();
    tx.sign(kp);
    return tx;
  };

  try {
    const res = await horizon.submitTransaction(
      build(Operation.payment({ destination, asset: Asset.native(), amount })),
    );
    return res.hash;
  } catch (err) {
    // Destination account doesn't exist yet -> create it (needs >= 1 XLM base reserve).
    const codes = err?.response?.data?.extras?.result_codes?.operations || [];
    if (codes.includes("op_no_destination") && Number(amount) >= 1) {
      const fresh = await horizon.loadAccount(kp.publicKey());
      const tx = new TransactionBuilder(fresh, {
        fee: String(Number(BASE_FEE) * 10),
        networkPassphrase: NETWORK_PASSPHRASE,
      })
        .addOperation(Operation.createAccount({ destination, startingBalance: amount }))
        .setTimeout(60)
        .build();
      tx.sign(kp);
      const res = await horizon.submitTransaction(tx);
      return res.hash;
    }
    throw err;
  }
}

async function payContractAccount(kp, destination, amount) {
  const stroops = BigInt(Math.round(Number(amount) * 10_000_000));
  const account = await soroban.getAccount(kp.publicKey());
  const sac = new Contract(NATIVE_XLM_SAC);

  const tx = new TransactionBuilder(account, {
    fee: String(Number(BASE_FEE) * 100),
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      sac.call(
        "transfer",
        nativeToScVal(kp.publicKey(), { type: "address" }),
        nativeToScVal(destination, { type: "address" }),
        nativeToScVal(stroops, { type: "i128" }),
      ),
    )
    .setTimeout(60)
    .build();

  const prepared = await soroban.prepareTransaction(tx);
  prepared.sign(kp);
  const sent = await soroban.sendTransaction(prepared);
  if (sent.status === "ERROR") {
    throw new Error(`Soroban send failed: ${JSON.stringify(sent.errorResult ?? sent)}`);
  }

  // Poll for confirmation (ledgers close in ~5s).
  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    const got = await soroban.getTransaction(sent.hash);
    if (got.status === "SUCCESS") return sent.hash;
    if (got.status === "FAILED") {
      throw new Error(`Soroban transfer failed: ${JSON.stringify(got.resultXdr ?? got)}`);
    }
  }
  // Not confirmed within our polling budget; hand back the hash for manual lookup.
  return sent.hash;
}
