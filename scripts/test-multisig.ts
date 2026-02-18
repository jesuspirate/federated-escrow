import {
  createParticipant,
  createEscrowWallet,
  restoreParticipant,
  getWalletInfo,
} from "../src/escrow/multisig";

async function main() {
  console.log("=== Federated Escrow: Multisig Wallet Creation ===\n");

  // Step 1: Generate keypairs for all three participants
  console.log("1. Generating keypairs for buyer, seller, and arbiter...\n");
  const buyer = createParticipant("buyer");
  const seller = createParticipant("seller");
  const arbiter = createParticipant("arbiter");

  console.log("  Buyer  pubkey:", buyer.publicKey.toString("hex"));
  console.log("  Seller pubkey:", seller.publicKey.toString("hex"));
  console.log("  Arbiter pubkey:", arbiter.publicKey.toString("hex"));

  // Step 2: Create the 2-of-3 multisig escrow wallet
  console.log("\n2. Creating 2-of-3 multisig escrow address...\n");
  const escrow = createEscrowWallet(buyer, seller, arbiter);
  const info = getWalletInfo(escrow);

  console.log("  Escrow Address:", info.address);
  console.log("  Redeem Script:", info.redeemScript);
  console.log("  Required Sigs:", info.requiredSignatures);

  // Step 3: Verify determinism — recreating from same keys gives same address
  console.log("\n3. Verifying deterministic address generation...\n");
  const buyerRestored = restoreParticipant("buyer", buyer.wif);
  const sellerRestored = restoreParticipant("seller", seller.wif);
  const arbiterRestored = restoreParticipant("arbiter", arbiter.wif);

  const escrow2 = createEscrowWallet(buyerRestored, sellerRestored, arbiterRestored);

  if (escrow.address === escrow2.address) {
    console.log("  ✅ Deterministic: same keys produce same address");
  } else {
    console.log("  ❌ ERROR: addresses don't match!");
  }

  // Step 4: Store WIFs (in production these would be encrypted)
  console.log("\n4. Private keys (WIF format — keep secret!):\n");
  console.log("  Buyer  WIF:", buyer.wif);
  console.log("  Seller WIF:", seller.wif);
  console.log("  Arbiter WIF:", arbiter.wif);

  console.log("\n=== Multisig wallet created successfully! ===");
}

main().catch(console.error);
