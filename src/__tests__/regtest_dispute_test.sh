#!/usr/bin/env bash
# tests/regtest_dispute_test.sh
#
# Dispute scenario: Seller claims buyer never sent fiat
# Arbiter investigates and sides with SELLER → sats refunded to seller
#

set -euo pipefail

BITCOIN_CLI="bitcoin-cli -regtest -rpcuser=test -rpcpassword=test"

echo "========================================="
echo " Dispute Test: Refund to Seller"
echo "========================================="
echo ""
echo " Scenario: Buyer claims they sent fiat, but Seller"
echo " says they never received it. Arbiter investigates"
echo " and sides with Seller."
echo ""

# ... (wallet setup same as before) ...

# The key difference: release TX goes to SELLER's address (refund)

echo "--- Building REFUND TX → Sats return to Seller ---"

SELLER_REFUND_ADDRESS=$($BITCOIN_CLI -rpcwallet=seller getnewaddress "seller_refund" bech32)

RAW_TX=$($BITCOIN_CLI createrawtransaction \
    "[{\"txid\":\"$FUND_TXID\",\"vout\":$ESCROW_VOUT}]" \
    "{\"$SELLER_REFUND_ADDRESS\":$PAYOUT_AMOUNT}")

echo "  DESTINATION: $SELLER_REFUND_ADDRESS (Seller's wallet - REFUND) ✅"

# Arbiter signs
echo "--- Arbiter signs (sided with Seller) ---"
# ... arbiter signs ...

# Seller co-signs (wants their refund)
echo "--- Seller co-signs (getting refund) ---"
# ... seller signs ...

echo ""
echo " Summary:"
echo "   Arbiter investigated the dispute"
echo "   Arbiter sided with Seller"
echo "   Arbiter + Seller co-signed refund TX"
echo "   Sats returned to Seller ✅"
echo "   Buyer gets nothing (they lied about fiat) ❌"
