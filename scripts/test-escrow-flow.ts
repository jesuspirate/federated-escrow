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

import axios from "axios";

// RPC helper for address generation
async function rpcCall(method: string, params: any[] = []) {
  const response = await axios.post(
    "http://127.0.0.1:18443",
    { jsonrpc: "1.0", id: "test", method, params },
    {
      auth: { username: "escrow", password: "escrow123" },
      validateStatus: () => true,
    }
  );
  if (response.data.error) {
    throw new Error(response.data.error.message);
  }
  return response.data.result;
}

async function main() {
  console.log("=== FULL ESCROW FLOW TEST ===");
  console.log("");
  console.log("ROLES:");
  console.log("  SELLER - Has sats, wants fiat. Locks sats into escrow.");
  console.log("  BUYER  - Has fiat, wants sats. Receives sats from escrow.");
  console.log("  ARBITER - Resolves disputes (not needed in happy path).");
  console.log("");

  // =============================================
  // PHASE 1: Setup participants
  // =============================================
  console.log("--- Phase 1: Setup ---");
  console.log("");

  console.log("Creating participants...");
  const buyer = createParticipant("buyer");
  const seller = createParticipant("seller");
  const arbiter = createParticipant("arbiter");

  console.log("  Buyer pubkey:", buyer.publicKey.toString("hex").substring(0, 16) + "...");
  console.log("  Seller pubkey:", seller.publicKey.toString("hex").substring(0, 16) + "...");
  console.log("  Arbiter pubkey:", arbiter.publicKey.toString("hex").substring(0, 16) + "...");

  console.log("");
  console.log("Creating 2-of-3 multisig escrow...");
  const escrow = createEscrowWallet(buyer, seller, arbiter);
  const info = getWalletInfo(escrow);
  console.log("  Escrow address:", info.address);

  // =============================================
  // PHASE 2: Seller funds the escrow
  // =============================================
  console.log("");
  console.log("--- Phase 2: Seller Locks Sats ---");
  console.log("");

  console.log("Setting up regtest funder wallet...");
  await setupFunding();

  const escrowAmount = 0.01; // 0.01 BTC = 1,000,000 sats
  console.log("Seller locks", escrowAmount, "BTC into escrow...");
  console.log("  (Seller is selling BTC for fiat)");
  const fundingTxid = await fundEscrow(escrow.address, escrowAmount);
  console.log("  Funding txid:", fundingTxid);

  // =============================================
  // PHASE 3: Verify UTXO
  // =============================================
  console.log("");
  console.log("--- Phase 3: Verify Escrow UTXO ---");
  console.log("");

  const utxo = await getEscrowUtxo(escrow.address, fundingTxid);
  console.log("  UTXO found:");
  console.log("    txid:", utxo.txid);
  console.log("    vout:", utxo.vout);
  console.log("    value:", utxo.value, "satoshis");
  console.log("");
  console.log("  +----------------------------------+");
  console.log("  |  ESCROW STATUS: LOCKED           |");
  console.log("  |  Amount:", utxo.value, "sats          |");
  console.log("  |  Funded by: SELLER               |");
  console.log("  |  Awaiting: Buyer fiat payment     |");
  console.log("  +----------------------------------+");

  // =============================================
  // PHASE 4: Buyer sends fiat (simulated)
  // =============================================
  console.log("");
  console.log("--- Phase 4: Buyer Sends Fiat (Simulated) ---");
  console.log("");
  console.log("  Buyer sends $200 via Zelle to Seller...");
  console.log("  Seller checks bank account...");
  console.log("  Seller confirms: fiat received!");

  // =============================================
  // PHASE 5: Happy Path Release -> Sats go to BUYER
  // =============================================
  console.log("");
  console.log("--- Phase 5: Happy Path Release ---");
  console.log("");

  // Generate a destination address for the BUYER to receive sats
  const buyerAddress = await rpcCall("getnewaddress");
  console.log("  Buyer destination:", buyerAddress);
  console.log("  (This is where the BUYER receives sats after paying fiat)");

  console.log("");
  console.log("  Building release transaction...");
  console.log("    Signer 1: SELLER (confirms fiat received)");
  console.log("    Signer 2: BUYER (co-signs to receive sats)");
  console.log("    Destination: BUYER address");

  const rawTx = buildReleaseTx(
    escrow,
    utxo,
    buyerAddress,   // BUYER receives the sats
    seller,         // Signer 1: Seller confirms fiat received
    buyer,          // Signer 2: Buyer co-signs
    1000            // Fee: 1000 sats
  );
  console.log("  Raw TX hex:", rawTx.substring(0, 64) + "...");

  console.log("");
  console.log("  Broadcasting release transaction...");
  const releaseTxid = await broadcastTx(rawTx);
  console.log("  Release txid:", releaseTxid);

  // =============================================
  // PHASE 6: Verify final state
  // =============================================
  console.log("");
  console.log("--- Phase 6: Verify Final State ---");
  console.log("");

  const buyerReceived = await rpcCall("getreceivedbyaddress", [buyerAddress, 1]);
  console.log("  Buyer received:", buyerReceived, "BTC");

  const expectedSats = utxo.value - 1000;
  const expectedBTC = expectedSats / 100000000;
  console.log("  Expected:", expectedBTC, "BTC (", expectedSats, "sats )");

  console.log("");
  console.log("===========================================");
  console.log("  HAPPY PATH COMPLETE");
  console.log("===========================================");
  console.log("");
  console.log("  Summary:");
  console.log("    1. Seller locked 0.01 BTC in escrow");
  console.log("    2. Buyer sent $200 fiat to Seller");
  console.log("    3. Seller confirmed fiat received");
  console.log("    4. Seller + Buyer co-signed release");
  console.log("    5. Buyer received", buyerReceived, "BTC");
  console.log("    6. Seller kept the $200 fiat");
  console.log("");
  console.log("  Dispute scenarios (not tested here):");
  console.log("    Arbiter + Seller -> refund to Seller");
  console.log("    Arbiter + Buyer  -> release to Buyer");
  console.log("===========================================");
}

main().catch(console.error);
