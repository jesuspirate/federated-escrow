import {
  createParticipant,
  createEscrowWallet,
  getWalletInfo,
} from "../src/escrow/multisig";

import {
  setupFunding,
  fundEscrow,
  getEscrowUtxo,
  buildReleaseTx,
  broadcastTx,
} from "../src/escrow/transactions";

async function main() {
  console.log("=== FULL ESCROW FLOW TEST ===\n");

  // PHASE 1: Setup
  console.log("--- Phase 1: Setup ---\n");

  console.log("Creating participants...");
  const buyer = createParticipant("buyer");
  const seller = createParticipant("seller");
  const arbiter = createParticipant("arbiter");

  console.log("Creating 2-of-3 multisig escrow...");
  const escrow = createEscrowWallet(buyer, seller, arbiter);
  const info = getWalletInfo(escrow);
  console.log("Escrow address:", info.address);

  // PHASE 2: Fund
  console.log("\n--- Phase 2: Funding ---\n");

  console.log("Setting up regtest funder wallet...");
  await setupFunding();

  const escrowAmount = 0.01; // 0.01 BTC = 1,000,000 sats
  console.log("Funding escrow with", escrowAmount, "BTC...");
  const fundingTxid = await fundEscrow(escrow.address, escrowAmount);
  console.log("Funding txid:", fundingTxid);

  // PHASE 3: Verify
  console.log("\n--- Phase 3: Verify UTXO ---\n");

  const utxo = await getEscrowUtxo(escrow.address, fundingTxid);
  console.log("UTXO found:");
  console.log("  txid:", utxo.txid);
  console.log("  vout:", utxo.vout);
  console.log("  value:", utxo.value, "satoshis");

  // PHASE 4: Happy Path — Buyer + Seller release to seller
  console.log("\n--- Phase 4: Happy Path Release ---\n");

  // Generate a destination address for the seller to receive funds
  const sellerDestination = "bcrt1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080";

  // In production this would be the seller's actual wallet address
  // For regtest we need a valid address from our node
  const axios = require("axios");
  const rpcCall = async (method: string, params: any[] = []) => {
    const response = await axios.post(
      "http://127.0.0.1:18443",
      { jsonrpc: "1.0", id: "test", method, params },
      { auth: { username: "escrow", password: "escrow123" } }
    );
    return response.data.result;
  };
  const sellerAddress = await rpcCall("getnewaddress");
  console.log("Seller destination:", sellerAddress);

  console.log("Building release transaction (buyer + seller sign)...");
  const rawTx = buildReleaseTx(
    escrow,
    utxo,
    sellerAddress,
    buyer,   // Signer 1: Buyer approves
    seller,  // Signer 2: Seller co-signs
    1000     // Fee: 1000 sats
  );
  console.log("Raw TX hex:", rawTx.substring(0, 64) + "...");

  console.log("Broadcasting release transaction...");
  const releaseTxid = await broadcastTx(rawTx);
  console.log("Release txid:", releaseTxid);

  // Verify final balance
  const finalBalance = await rpcCall("getreceivedbyaddress", [sellerAddress, 1]);
  console.log("\nSeller received:", finalBalance, "BTC");

  console.log("\n=== ESCROW FLOW COMPLETE ===");
  console.log("Buyer approved + Seller co-signed = Funds released to seller");
  console.log("This is the HAPPY PATH of a 2-of-3 multisig escrow!");
}

main().catch(console.error);
