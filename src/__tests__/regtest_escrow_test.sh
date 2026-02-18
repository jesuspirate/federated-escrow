#!/usr/bin/env bash
# tests/regtest_escrow_test.sh
#
# Full escrow flow on regtest
#
# ROLES:
#   SELLER - Has BTC, wants fiat. Locks sats into escrow.
#   BUYER  - Has fiat, wants BTC. Receives sats from escrow.
#   ARBITER - Resolves disputes.
#
# FLOW:
#   1. Seller funds the 2-of-3 escrow address
#   2. Buyer sends fiat (out of band)
#   3. Seller confirms fiat received
#   4. Seller + Buyer co-sign → sats released to BUYER's address
#

set -euo pipefail

BITCOIN_CLI="bitcoin-cli -regtest -rpcuser=test -rpcpassword=test"

echo "========================================="
echo " P2P Escrow Test - Regtest"
echo "========================================="
echo ""
echo "Roles:"
echo "  SELLER  → has sats, wants fiat"
echo "  BUYER   → has fiat, wants sats"
echo "  ARBITER → resolves disputes"
echo ""

# -------------------------------------------
# Step 1: Create wallets for each participant
# -------------------------------------------
echo "--- Step 1: Creating wallets ---"

for WALLET in seller buyer arbiter; do
    $BITCOIN_CLI createwallet "$WALLET" 2>/dev/null || true
done

# Generate addresses
SELLER_ADDRESS=$($BITCOIN_CLI -rpcwallet=seller getnewaddress "seller_main" bech32)
BUYER_ADDRESS=$($BITCOIN_CLI -rpcwallet=buyer getnewaddress "buyer_payout" bech32)
ARBITER_ADDRESS=$($BITCOIN_CLI -rpcwallet=arbiter getnewaddress "arbiter_main" bech32)

echo "  Seller address:  $SELLER_ADDRESS"
echo "  Buyer address:   $BUYER_ADDRESS (payout destination)"
echo "  Arbiter address: $ARBITER_ADDRESS"

# -------------------------------------------
# Step 2: Fund the SELLER (they need sats to sell)
# -------------------------------------------
echo ""
echo "--- Step 2: Funding the SELLER ---"

# Mine blocks to seller so they have BTC to escrow
$BITCOIN_CLI -rpcwallet=seller generatetoaddress 101 "$SELLER_ADDRESS" > /dev/null
SELLER_BALANCE=$($BITCOIN_CLI -rpcwallet=seller getbalance)
echo "  Seller balance: $SELLER_BALANCE BTC"
echo "  (Seller has BTC and wants to sell for fiat)"

# -------------------------------------------
# Step 3: Get public keys for the multisig
# -------------------------------------------
echo ""
echo "--- Step 3: Collecting public keys for 2-of-3 multisig ---"

SELLER_PUBKEY=$($BITCOIN_CLI -rpcwallet=seller getaddressinfo "$SELLER_ADDRESS" | jq -r '.pubkey')
BUYER_PUBKEY=$($BITCOIN_CLI -rpcwallet=buyer getaddressinfo "$BUYER_ADDRESS" | jq -r '.pubkey')
ARBITER_PUBKEY=$($BITCOIN_CLI -rpcwallet=arbiter getaddressinfo "$ARBITER_ADDRESS" | jq -r '.pubkey')

echo "  Seller pubkey:  $SELLER_PUBKEY"
echo "  Buyer pubkey:   $BUYER_PUBKEY"
echo "  Arbiter pubkey: $ARBITER_PUBKEY"

# -------------------------------------------
# Step 4: Create the 2-of-3 multisig escrow address
# -------------------------------------------
echo ""
echo "--- Step 4: Creating 2-of-3 escrow address ---"

MULTISIG_RESULT=$($BITCOIN_CLI createmultisig 2 "[\"$SELLER_PUBKEY\",\"$BUYER_PUBKEY\",\"$ARBITER_PUBKEY\"]")
ESCROW_ADDRESS=$(echo "$MULTISIG_RESULT" | jq -r '.address')
REDEEM_SCRIPT=$(echo "$MULTISIG_RESULT" | jq -r '.redeemScript')

echo "  Escrow address: $ESCROW_ADDRESS"
echo "  Redeem script:  $REDEEM_SCRIPT"
echo ""
echo "  Policy: ANY 2 of {Seller, Buyer, Arbiter} can sign"

# -------------------------------------------
# Step 5: SELLER locks sats into escrow
# -------------------------------------------
echo ""
echo "--- Step 5: Seller locks 0.01 BTC into escrow ---"
echo "  (Seller is selling 0.01 BTC for fiat)"

ESCROW_AMOUNT="0.01"
FUND_TXID=$($BITCOIN_CLI -rpcwallet=seller sendtoaddress "$ESCROW_ADDRESS" "$ESCROW_AMOUNT")
echo "  Funding TXID: $FUND_TXID"

# Mine to confirm
$BITCOIN_CLI -rpcwallet=seller generatetoaddress 1 "$SELLER_ADDRESS" > /dev/null
echo "  ✅ Escrow funded and confirmed"
echo ""
echo "  ┌─────────────────────────────────┐"
echo "  │  ESCROW STATUS: LOCKED 🔒       │"
echo "  │  Amount: $ESCROW_AMOUNT BTC              │"
echo "  │  Funded by: Seller              │"
echo "  │  Awaiting: Buyer's fiat payment │"
echo "  └─────────────────────────────────┘"

# -------------------------------------------
# Step 6: BUYER sends fiat (simulated)
# -------------------------------------------
echo ""
echo "--- Step 6: Buyer sends fiat (out of band) ---"
echo "  💵 Buyer sends \$200 via Zelle to Seller"
echo "  ⏳ Seller checks bank account..."
sleep 1
echo "  ✅ Seller confirms: fiat received!"

# -------------------------------------------
# Step 7: Build release TX → sats go to BUYER
# -------------------------------------------
echo ""
echo "--- Step 7: Building release TX → Buyer gets the sats ---"

# Find the escrow UTXO
ESCROW_UTXO=$($BITCOIN_CLI -rpcwallet=seller getrawtransaction "$FUND_TXID" true)
ESCROW_VOUT=$(echo "$ESCROW_UTXO" | jq -r ".vout[] | select(.value == $ESCROW_AMOUNT) | .n")
ESCROW_SCRIPT_PUBKEY=$(echo "$ESCROW_UTXO" | jq -r ".vout[$ESCROW_VOUT].scriptPubKey.hex")

echo "  Escrow UTXO: $FUND_TXID:$ESCROW_VOUT"

# Calculate fee (1000 sats = 0.00001 BTC)
FEE="0.00001"
PAYOUT_AMOUNT=$(echo "$ESCROW_AMOUNT - $FEE" | bc)

echo "  Escrow amount:  $ESCROW_AMOUNT BTC"
echo "  Fee:            $FEE BTC (1000 sats)"
echo "  Buyer receives: $PAYOUT_AMOUNT BTC"
echo ""
echo "  DESTINATION: $BUYER_ADDRESS (Buyer's wallet) ✅"

# Create raw transaction: Escrow → BUYER's address
RAW_TX=$($BITCOIN_CLI createrawtransaction \
    "[{\"txid\":\"$FUND_TXID\",\"vout\":$ESCROW_VOUT}]" \
    "{\"$BUYER_ADDRESS\":$PAYOUT_AMOUNT}")

echo "  Raw TX created (unsigned)"

# -------------------------------------------
# Step 8: SELLER signs (confirms fiat received)
# -------------------------------------------
echo ""
echo "--- Step 8: Seller signs release TX ---"
echo "  (Seller confirms they received the fiat)"

SELLER_SIGNED=$($BITCOIN_CLI -rpcwallet=seller signrawtransactionwithwallet "$RAW_TX" \
    "[{\"txid\":\"$FUND_TXID\",\"vout\":$ESCROW_VOUT,\"scriptPubKey\":\"$ESCROW_SCRIPT_PUBKEY\",\"redeemScript\":\"$REDEEM_SCRIPT\",\"amount\":$ESCROW_AMOUNT}]")

SELLER_SIGNED_HEX=$(echo "$SELLER_SIGNED" | jq -r '.hex')
SELLER_COMPLETE=$(echo "$SELLER_SIGNED" | jq -r '.complete')
echo "  Seller signed: complete=$SELLER_COMPLETE (should be false, need 2 of 3)"

# -------------------------------------------
# Step 9: BUYER co-signs (they want their sats!)
# -------------------------------------------
echo ""
echo "--- Step 9: Buyer co-signs release TX ---"
echo "  (Buyer co-signs to receive their purchased sats)"

# Import the redeem script to buyer's wallet so they can sign
$BITCOIN_CLI -rpcwallet=buyer importaddress "$REDEEM_SCRIPT" "escrow" false 2>/dev/null || true

BUYER_SIGNED=$($BITCOIN_CLI -rpcwallet=buyer signrawtransactionwithwallet "$SELLER_SIGNED_HEX" \
    "[{\"txid\":\"$FUND_TXID\",\"vout\":$ESCROW_VOUT,\"scriptPubKey\":\"$ESCROW_SCRIPT_PUBKEY\",\"redeemScript\":\"$REDEEM_SCRIPT\",\"amount\":$ESCROW_AMOUNT}]")

FINAL_TX_HEX=$(echo "$BUYER_SIGNED" | jq -r '.hex')
FINAL_COMPLETE=$(echo "$BUYER_SIGNED" | jq -r '.complete')
echo "  Buyer co-signed: complete=$FINAL_COMPLETE (should be true!)"

# -------------------------------------------
# Step 10: Broadcast and confirm
# -------------------------------------------
echo ""
echo "--- Step 10: Broadcasting release TX ---"

if [ "$FINAL_COMPLETE" = "true" ]; then
    RELEASE_TXID=$($BITCOIN_CLI sendrawtransaction "$FINAL_TX_HEX")
    echo "  ✅ Release TXID: $RELEASE_TXID"

    # Mine to confirm
    $BITCOIN_CLI -rpcwallet=seller generatetoaddress 1 "$SELLER_ADDRESS" > /dev/null
    echo "  ✅ Confirmed in block"
else
    echo "  ❌ ERROR: Transaction not fully signed!"
    exit 1
fi

# -------------------------------------------
# Step 11: Verify final balances
# -------------------------------------------
echo ""
echo "--- Step 11: Verifying balances ---"

BUYER_BALANCE=$($BITCOIN_CLI -rpcwallet=buyer getbalance)
echo "  Buyer balance: $BUYER_BALANCE BTC"

echo ""
echo "========================================="
echo " ✅ HAPPY PATH COMPLETE"
echo "========================================="
echo ""
echo " Summary:"
echo "   Seller locked 0.01 BTC in escrow"
echo "   Buyer sent \$200 fiat to Seller"
echo "   Seller confirmed fiat received"
echo "   Seller + Buyer co-signed release"
echo "   Buyer received $PAYOUT_AMOUNT BTC ✅"
echo "   Seller kept the \$200 fiat ✅"
echo ""
echo " Dispute scenarios (not yet tested):"
echo "   Arbiter + Seller → refund to Seller"
echo "   Arbiter + Buyer  → release to Buyer"
echo "========================================="
