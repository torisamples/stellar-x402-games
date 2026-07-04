// Contract-account (smart wallet) support for the demo — the payer IS a
// C... contract account, like a Meridian Pay wallet.
//
// Two pieces:
//  1. deploySimpleAccount(): deploys the `simple_account` custom account
//     contract (from stellar/rs-soroban-env test wasms) on testnet. Its
//     __check_auth verifies an ed25519 signature against a stored owner key —
//     structurally the same as a passkey smart wallet, with ed25519 standing
//     in for the WebAuthn passkey.
//  2. ContractAccountScheme: an x402 "exact" scheme client whose payer is the
//     contract address. It builds the SEP-41 transfer with from = C...,
//     signs the Soroban auth entry with the owner key, and sets the raw
//     64-byte signature ScVal that simple_account's __check_auth expects.
//     (The stock ExactStellarScheme only knows the classic G-account
//     signature format, so contract accounts need this custom scheme —
//     production smart wallets like Meridian Pay do the equivalent
//     internally with passkey signatures.)
import { readFile } from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  Address,
  BASE_FEE,
  Contract,
  Keypair,
  Operation,
  StrKey,
  TransactionBuilder,
  contract,
  hash,
  nativeToScVal,
  rpc,
  xdr,
} from "@stellar/stellar-sdk";
import { NETWORK_PASSPHRASE, PAYOUT_SECRET, RPC_URL } from "./config.js";
import { sendXlm } from "./payouts.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WASM_PATH = path.join(__dirname, "..", "test", "fixtures", "simple_account.wasm");

const server = new rpc.Server(RPC_URL);

async function submitTx(tx, kp) {
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

async function buildTx(kp, op) {
  const account = await server.getAccount(kp.publicKey());
  return new TransactionBuilder(account, {
    fee: String(Number(BASE_FEE) * 100),
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(op)
    .setTimeout(60)
    .build();
}

let cachedWasmHash = null;

/**
 * Deploys a fresh simple_account contract owned by a new ed25519 key,
 * and funds it with `fundXlm` so it can pay entry fees.
 * Returns { address: "C...", secret: "S...", type: "contract" }.
 */
export async function deploySimpleAccount(fundXlm = 5) {
  if (!PAYOUT_SECRET) throw new Error("PAYOUT_SECRET required to deploy the demo contract account");
  const deployer = Keypair.fromSecret(PAYOUT_SECRET);
  const owner = Keypair.random(); // stands in for the wallet's passkey

  // 1. Upload the account-contract wasm (idempotent; cache the hash).
  const wasm = await readFile(WASM_PATH);
  if (!cachedWasmHash) {
    try {
      await submitTx(await buildTx(deployer, Operation.uploadContractWasm({ wasm })), deployer);
    } catch (err) {
      // Already uploaded is fine — the hash is content-addressed either way.
      if (!String(err).includes("Exists")) {
        // Some RPCs report re-upload as success, others as a benign failure;
        // only real problems reach here.
        console.warn("wasm upload note:", String(err).slice(0, 120));
      }
    }
    cachedWasmHash = hash(wasm);
  }

  // 2. Create the contract instance (deterministic id from deployer + salt).
  const salt = crypto.randomBytes(32);
  await submitTx(
    await buildTx(
      deployer,
      Operation.createCustomContract({
        address: new Address(deployer.publicKey()),
        wasmHash: cachedWasmHash,
        salt,
      }),
    ),
    deployer,
  );
  const preimage = xdr.HashIdPreimage.envelopeTypeContractId(
    new xdr.HashIdPreimageContractId({
      networkId: hash(Buffer.from(NETWORK_PASSPHRASE)),
      contractIdPreimage: xdr.ContractIdPreimage.contractIdPreimageFromAddress(
        new xdr.ContractIdPreimageFromAddress({
          address: new Address(deployer.publicKey()).toScAddress(),
          salt,
        }),
      ),
    }),
  );
  const contractId = StrKey.encodeContract(hash(preimage.toXDR()));

  // 3. Register the owner key: init(public_key: BytesN<32>).
  await submitTx(
    await buildTx(
      deployer,
      new Contract(contractId).call("init", nativeToScVal(owner.rawPublicKey(), { type: "bytes" })),
    ),
    deployer,
  );

  // 4. Fund the contract account so it can pay 0.5 XLM entry fees.
  const funding = await sendXlm(contractId, fundXlm, "wallet funding");
  if (funding.status !== "paid") throw new Error("funding failed: " + JSON.stringify(funding));

  return { address: contractId, secret: owner.secret(), type: "contract" };
}

/**
 * x402 "exact" scheme client for a contract-account payer.
 * Mirrors @x402/stellar's ExactStellarScheme, but signs the auth entry the
 * way simple_account's __check_auth expects: signature = raw Bytes(64).
 */
export class ContractAccountScheme {
  constructor(contractId, ownerKeypair) {
    this.scheme = "exact";
    this.contractId = contractId;
    this.owner = ownerKeypair;
  }

  async createPaymentPayload(x402Version, requirements) {
    const { payTo, asset, amount, maxTimeoutSeconds, extra } = requirements;
    if (!extra?.areFeesSponsored) throw new Error("Exact scheme requires areFeesSponsored");

    const latest = await server.getLatestLedger();
    const maxLedger = latest.sequence + Math.ceil((maxTimeoutSeconds ?? 300) / 5);

    // Build + simulate the SEP-41 transfer with the CONTRACT as `from`.
    const tx = await contract.AssembledTransaction.build({
      contractId: asset,
      method: "transfer",
      args: [
        nativeToScVal(this.contractId, { type: "address" }), // from: the smart wallet
        nativeToScVal(payTo, { type: "address" }),
        nativeToScVal(amount, { type: "i128" }),
      ],
      networkPassphrase: NETWORK_PASSPHRASE,
      rpcUrl: RPC_URL,
      parseResultXdr: (r) => r,
    });

    // Sign every auth entry that belongs to our contract address.
    const op = tx.built.operations[0];
    const entries = op.auth ?? [];
    let signedAny = false;
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (entry.credentials().switch() !== xdr.SorobanCredentialsType.sorobanCredentialsAddress()) continue;
      const entryAddr = Address.fromScAddress(entry.credentials().address().address()).toString();
      if (entryAddr !== this.contractId) continue;

      const clone = xdr.SorobanAuthorizationEntry.fromXDR(entry.toXDR());
      const creds = clone.credentials().address();
      creds.signatureExpirationLedger(maxLedger);

      const preimage = xdr.HashIdPreimage.envelopeTypeSorobanAuthorization(
        new xdr.HashIdPreimageSorobanAuthorization({
          networkId: hash(Buffer.from(NETWORK_PASSPHRASE)),
          nonce: creds.nonce(),
          signatureExpirationLedger: maxLedger,
          invocation: clone.rootInvocation(),
        }),
      );
      const payloadHash = hash(preimage.toXDR());
      // In Meridian Pay this is where the passkey (WebAuthn) signature happens.
      creds.signature(xdr.ScVal.scvBytes(this.owner.sign(payloadHash)));
      entries[i] = clone;
      signedAny = true;
    }
    if (!signedAny) throw new Error(`no auth entries found for ${this.contractId}`);

    // Re-simulate with signed auth (preserved by the SDK) to finalize resources.
    await tx.simulate();
    const missing = tx.needsNonInvokerSigningBy();
    if (missing.length > 0) throw new Error(`unexpected signers still required: ${missing.join(", ")}`);

    return { x402Version, payload: { transaction: tx.built.toXDR() } };
  }
}
