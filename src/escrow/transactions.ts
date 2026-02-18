import * as bitcoin from "bitcoinjs-lib";
import * as ecc from "tiny-secp256k1";
import ECPairFactory, { ECPairInterface } from "ecpair";
import axios from "axios";
import { EscrowWallet, Participant } from "./multisig";

const ECPair = ECPairFactory(ecc);
const network = bitcoin.networks.regtest;

const RPC_URL = "http://127.0.0.1:18443";
const RPC_USER = "escrow";
const RPC_PASS = "escrow123";

/**
 * Bitcoin RPC helper
 */

async function rpc(method: string, params: any[] = []) {
  const response = await axios.post(
    RPC_URL,
    { jsonrpc: "1.0", id: "escrow", method, params },
    {
      auth: { username: RPC_USER, password: RPC_PASS },
      headers: { "Content-Type": "application/json" },
      validateStatus: () => true,
    }
  );
  if (response.data.error) {
    throw new Error(response.data.error.message);
  }
  return response.data.result;
}

/**
 * Create a wallet and mine blocks to get funds
 */

export async function setupFunding() {
  // Try to create wallet, ignore if it already exists
  try {
    await rpc("createwallet", ["escrow_funder"]);
    console.log("Created wallet: escrow_funder");
  } catch (e: any) {
    if (e.message.includes("already exists")) {
      console.log("Wallet already exists, loading...");
      try {
        await rpc("loadwallet", ["escrow_funder"]);
      } catch (loadErr: any) {
        if (loadErr.message.includes("already loaded")) {
          console.log("Wallet already loaded");
        } else {
          throw loadErr;
        }
      }
    } else {
      throw e;
    }
  }

  // Check current balance
  let balance = await rpc("getbalance");
  console.log("Current balance:", balance, "BTC");

  // Only mine if we need funds
  if (balance < 1) {
    console.log("Mining blocks for funds...");
    const minerAddress = await rpc("getnewaddress");
    await rpc("generatetoaddress", [101, minerAddress]);
    balance = await rpc("getbalance");
    console.log("New balance:", balance, "BTC");
  }

  return balance;
}

/**
 * Fund the escrow address from the regtest wallet
 */
export async function fundEscrow(
  escrowAddress: string,
  amountBTC: number
): Promise<string> {
  const txid = await rpc("sendtoaddress", [escrowAddress, amountBTC]);
  console.log("Funded escrow with", amountBTC, "BTC, txid:", txid);

  // Mine a block to confirm the funding tx
  const minerAddress = await rpc("getnewaddress");
  await rpc("generatetoaddress", [1, minerAddress]);

  return txid;
}

/**
 * Get the UTXO details for the escrow address
 */
export async function getEscrowUtxo(
  escrowAddress: string,
  fundingTxid: string
) {
  const txHex = await rpc("getrawtransaction", [fundingTxid, false]);
  const tx = bitcoin.Transaction.fromHex(txHex);

  // Find the output that pays to our escrow address
  let escrowVout = -1;
  let escrowValue = 0;

  for (let i = 0; i < tx.outs.length; i++) {
    try {
      const outAddress = bitcoin.address.fromOutputScript(tx.outs[i].script, network);
      if (outAddress === escrowAddress) {
        escrowVout = i;
        escrowValue = tx.outs[i].value;
        break;
      }
    } catch (e) {
      continue;
    }
  }

  if (escrowVout === -1) {
    throw new Error("Could not find escrow output in funding transaction");
  }

  return {
    txid: fundingTxid,
    vout: escrowVout,
    value: escrowValue,
    txHex,
  };
}

/**
 * Build and sign a release transaction (2-of-3 multisig spend)
 * This sends funds from the escrow to a destination address
 */
export function buildReleaseTx(
  escrowWallet: EscrowWallet,
  utxo: { txid: string; vout: number; value: number; txHex: string },
  destinationAddress: string,
  signer1: Participant,
  signer2: Participant,
  feeSats: number = 1000
): string {
  const sendAmount = utxo.value - feeSats;

  if (sendAmount <= 0) {
    throw new Error("Escrow balance too low to cover fee");
  }

  // Sort public keys the same way as when creating the address
  const pubkeys = [
    escrowWallet.buyer.publicKey,
    escrowWallet.seller.publicKey,
    escrowWallet.arbiter.publicKey,
  ].sort((a, b) => a.compare(b));

  // Recreate the P2MS and P2SH payment objects
  const p2ms = bitcoin.payments.p2ms({
    m: 2,
    pubkeys,
    network,
  });

  const p2sh = bitcoin.payments.p2sh({
    redeem: p2ms,
    network,
  });

  // Build the transaction
  const psbt = new bitcoin.Psbt({ network });

  psbt.addInput({
    hash: utxo.txid,
    index: utxo.vout,
    nonWitnessUtxo: Buffer.from(utxo.txHex, "hex"),
    redeemScript: p2sh.redeem!.output!,
  });

  psbt.addOutput({
    address: destinationAddress,
    value: sendAmount,
  });

  // Wrap keyPairs to ensure publicKey is a Buffer (not Uint8Array)
  const wrapSigner = (keyPair: ECPairInterface) => ({
    publicKey: Buffer.from(keyPair.publicKey),
    sign: (hash: Buffer): Buffer => {
      return Buffer.from(keyPair.sign(hash));
    },
  });

  // Sign with two of the three participants
  psbt.signInput(0, wrapSigner(signer1.keyPair));
  psbt.signInput(0, wrapSigner(signer2.keyPair));

  // Finalize
  psbt.finalizeAllInputs();

  // Extract and return the raw transaction hex
  const rawTx = psbt.extractTransaction().toHex();
  return rawTx;
}

/**
 * Broadcast a raw transaction to the network
 */
export async function broadcastTx(rawTxHex: string): Promise<string> {
  const txid = await rpc("sendrawtransaction", [rawTxHex]);
  console.log("Transaction broadcast! txid:", txid);

  // Mine a block to confirm
  const minerAddress = await rpc("getnewaddress");
  await rpc("generatetoaddress", [1, minerAddress]);

  return txid;
}
