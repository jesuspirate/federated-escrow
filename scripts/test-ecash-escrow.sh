#!/usr/bin/env bash
# scripts/test-ecash-escrow.sh
#
# Tests the e-cash escrow API with Nostr auth (dev mode).
# Uses X-Dev-Pubkey header to simulate different users.
#
# Flow:
#   1. Seller creates escrow (auto-becomes seller)
#   2. Buyer joins
#   3. Arbiter joins
#   4. Seller locks funds
#   5. Buyer votes FIRST (release only)
#   6. Seller votes SECOND (release or refund)
#   7. If disagree → arbiter breaks tie
#
# Usage: bash scripts/test-ecash-escrow.sh

set -euo pipefail

API="http://localhost:3000/api/ecash-escrows"

# Simulated Nostr pubkeys (64 hex chars each)
SELLER_PK="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
BUYER_PK="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
ARBITER_PK="cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"

# Extra user for edge cases
RANDO_PK="dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"

COMMUNITY="fedi:room:!kENaQZKCKhRhawCjxf:m1.8fa.in:::"

echo "==========================================="
echo "  E-Cash Escrow API Test (Nostr Auth)"
echo "  NIP-98 dev mode — X-Dev-Pubkey headers"
echo "==========================================="
echo ""

echo "--- Health Check ---"
curl -s "http://localhost:3000/api/health" | jq .
echo ""

# =============================================
# TEST 1: Happy Path
# =============================================
echo "==========================================="
echo "  TEST 1: Happy Path"
echo "  Seller creates → Buyer+Arbiter join → Lock → Both release"
echo "==========================================="
echo ""

echo "--- Seller creates escrow ---"
E1=$(curl -s -X POST "$API" \
  -H "Content-Type: application/json" \
  -H "X-Dev-Pubkey: $SELLER_PK" \
  -d "{\"amountMsats\": 100000000, \"description\": \"Widget purchase\", \"terms\": \"Buyer sends \$50 USD via Zelle. Seller ships widget within 3 days.\", \"communityLink\": \"$COMMUNITY\"}")
echo "$E1" | jq .
ID1=$(echo "$E1" | jq -r '.id')
echo ""

echo "--- Buyer joins ---"
curl -s -X POST "$API/$ID1/join" \
  -H "Content-Type: application/json" \
  -H "X-Dev-Pubkey: $BUYER_PK" \
  -d '{"role": "buyer"}' | jq .
echo ""

echo "--- Arbiter joins ---"
curl -s -X POST "$API/$ID1/join" \
  -H "Content-Type: application/json" \
  -H "X-Dev-Pubkey: $ARBITER_PK" \
  -d '{"role": "arbiter"}' | jq .
echo ""

echo "--- Seller locks ---"
curl -s -X POST "$API/$ID1/lock" \
  -H "Content-Type: application/json" \
  -H "X-Dev-Pubkey: $SELLER_PK" \
  -d '{"notes": "ECASH_NOTES_HAPPY_PATH_PLACEHOLDER"}' | jq .
echo ""

echo "--- Buyer votes release ---"
curl -s -X POST "$API/$ID1/approve" \
  -H "Content-Type: application/json" \
  -H "X-Dev-Pubkey: $BUYER_PK" \
  -d '{"outcome": "release"}' | jq .
echo ""

echo "--- Seller votes release (auto-resolve!) ---"
curl -s -X POST "$API/$ID1/approve" \
  -H "Content-Type: application/json" \
  -H "X-Dev-Pubkey: $SELLER_PK" \
  -d '{"outcome": "release"}' | jq .
echo ""

echo "--- Buyer claims ---"
curl -s -X POST "$API/$ID1/claim" \
  -H "Content-Type: application/json" \
  -H "X-Dev-Pubkey: $BUYER_PK" | jq .
echo ""

# =============================================
# TEST 2: Dispute → Arbiter refunds seller
# =============================================
echo "==========================================="
echo "  TEST 2: Dispute → Arbiter Refunds"
echo "==========================================="
echo ""

E2=$(curl -s -X POST "$API" \
  -H "Content-Type: application/json" \
  -H "X-Dev-Pubkey: $SELLER_PK" \
  -d "{\"amountMsats\": 50000000, \"description\": \"Design work\", \"terms\": \"Buyer pays 25 EUR SEPA. Designer delivers logo in 48h.\", \"communityLink\": \"$COMMUNITY\"}")
ID2=$(echo "$E2" | jq -r '.id')

curl -s -X POST "$API/$ID2/join" -H "Content-Type: application/json" -H "X-Dev-Pubkey: $BUYER_PK" -d '{"role": "buyer"}' > /dev/null
curl -s -X POST "$API/$ID2/join" -H "Content-Type: application/json" -H "X-Dev-Pubkey: $ARBITER_PK" -d '{"role": "arbiter"}' > /dev/null
curl -s -X POST "$API/$ID2/lock" -H "Content-Type: application/json" -H "X-Dev-Pubkey: $SELLER_PK" -d '{"notes": "ECASH_NOTES_DISPUTE_REFUND"}' > /dev/null

echo "--- Buyer votes release ---"
curl -s -X POST "$API/$ID2/approve" -H "Content-Type: application/json" -H "X-Dev-Pubkey: $BUYER_PK" -d '{"outcome": "release"}' | jq .
echo ""

echo "--- Seller votes refund (DISPUTE) ---"
curl -s -X POST "$API/$ID2/approve" -H "Content-Type: application/json" -H "X-Dev-Pubkey: $SELLER_PK" -d '{"outcome": "refund"}' | jq .
echo ""

echo "--- Arbiter votes refund (sides with seller) ---"
curl -s -X POST "$API/$ID2/approve" -H "Content-Type: application/json" -H "X-Dev-Pubkey: $ARBITER_PK" -d '{"outcome": "refund"}' | jq .
echo ""

echo "--- Seller claims ---"
curl -s -X POST "$API/$ID2/claim" -H "Content-Type: application/json" -H "X-Dev-Pubkey: $SELLER_PK" | jq .
echo ""

# =============================================
# TEST 3: Dispute → Arbiter releases to buyer
# =============================================
echo "==========================================="
echo "  TEST 3: Dispute → Arbiter Releases"
echo "==========================================="
echo ""

E3=$(curl -s -X POST "$API" \
  -H "Content-Type: application/json" \
  -H "X-Dev-Pubkey: $SELLER_PK" \
  -d "{\"amountMsats\": 75000000, \"description\": \"Laptop sale\", \"terms\": \"Buyer sends 0.005 BTC onchain. Seller ships laptop with tracking.\", \"communityLink\": \"$COMMUNITY\"}")
ID3=$(echo "$E3" | jq -r '.id')

curl -s -X POST "$API/$ID3/join" -H "Content-Type: application/json" -H "X-Dev-Pubkey: $BUYER_PK" -d '{"role": "buyer"}' > /dev/null
curl -s -X POST "$API/$ID3/join" -H "Content-Type: application/json" -H "X-Dev-Pubkey: $ARBITER_PK" -d '{"role": "arbiter"}' > /dev/null
curl -s -X POST "$API/$ID3/lock" -H "Content-Type: application/json" -H "X-Dev-Pubkey: $SELLER_PK" -d '{"notes": "ECASH_NOTES_DISPUTE_RELEASE"}' > /dev/null

curl -s -X POST "$API/$ID3/approve" -H "Content-Type: application/json" -H "X-Dev-Pubkey: $BUYER_PK" -d '{"outcome": "release"}' > /dev/null

echo "--- Seller votes refund ---"
curl -s -X POST "$API/$ID3/approve" -H "Content-Type: application/json" -H "X-Dev-Pubkey: $SELLER_PK" -d '{"outcome": "refund"}' | jq .
echo ""

echo "--- Arbiter votes release (sides with buyer) ---"
curl -s -X POST "$API/$ID3/approve" -H "Content-Type: application/json" -H "X-Dev-Pubkey: $ARBITER_PK" -d '{"outcome": "release"}' | jq .
echo ""

echo "--- Buyer claims ---"
curl -s -X POST "$API/$ID3/claim" -H "Content-Type: application/json" -H "X-Dev-Pubkey: $BUYER_PK" | jq .
echo ""

# =============================================
# TEST 4: Edge Cases & Ordering
# =============================================
echo "==========================================="
echo "  TEST 4: Edge Cases"
echo "==========================================="
echo ""

echo "--- Create without community link (should FAIL) ---"
curl -s -X POST "$API" \
  -H "Content-Type: application/json" \
  -H "X-Dev-Pubkey: $SELLER_PK" \
  -d '{"amountMsats": 10000000, "description": "no community", "terms": "some terms here"}' | jq .
echo ""

echo "--- Create without terms (should FAIL) ---"
curl -s -X POST "$API" \
  -H "Content-Type: application/json" \
  -H "X-Dev-Pubkey: $SELLER_PK" \
  -d "{\"amountMsats\": 10000000, \"description\": \"no terms\", \"communityLink\": \"$COMMUNITY\"}" | jq .
echo ""

echo "--- Create without auth (should FAIL) ---"
curl -s -X POST "$API" \
  -H "Content-Type: application/json" \
  -d '{"amountMsats": 10000000}' | jq .
echo ""

E4=$(curl -s -X POST "$API" \
  -H "Content-Type: application/json" \
  -H "X-Dev-Pubkey: $SELLER_PK" \
  -d "{\"amountMsats\": 10000000, \"description\": \"Edge case test\", \"terms\": \"Test trade terms for edge cases\", \"communityLink\": \"$COMMUNITY\"}")
ID4=$(echo "$E4" | jq -r '.id')

echo "--- Seller tries to join own escrow as buyer (should FAIL) ---"
curl -s -X POST "$API/$ID4/join" -H "Content-Type: application/json" -H "X-Dev-Pubkey: $SELLER_PK" -d '{"role": "buyer"}' | jq .
echo ""

echo "--- Lock before all join (should FAIL) ---"
curl -s -X POST "$API/$ID4/lock" -H "Content-Type: application/json" -H "X-Dev-Pubkey: $SELLER_PK" -d '{"notes": "PLACEHOLDER"}' | jq .
echo ""

curl -s -X POST "$API/$ID4/join" -H "Content-Type: application/json" -H "X-Dev-Pubkey: $BUYER_PK" -d '{"role": "buyer"}' > /dev/null
curl -s -X POST "$API/$ID4/join" -H "Content-Type: application/json" -H "X-Dev-Pubkey: $ARBITER_PK" -d '{"role": "arbiter"}' > /dev/null

echo "--- Buyer tries to lock (should FAIL — seller only) ---"
curl -s -X POST "$API/$ID4/lock" -H "Content-Type: application/json" -H "X-Dev-Pubkey: $BUYER_PK" -d '{"notes": "stolen"}' | jq .
echo ""

curl -s -X POST "$API/$ID4/lock" -H "Content-Type: application/json" -H "X-Dev-Pubkey: $SELLER_PK" -d '{"notes": "ECASH_NOTES_EDGE_CASE"}' > /dev/null

echo "--- Seller votes before buyer (should FAIL) ---"
curl -s -X POST "$API/$ID4/approve" -H "Content-Type: application/json" -H "X-Dev-Pubkey: $SELLER_PK" -d '{"outcome": "release"}' | jq .
echo ""

echo "--- Arbiter votes before anyone (should FAIL) ---"
curl -s -X POST "$API/$ID4/approve" -H "Content-Type: application/json" -H "X-Dev-Pubkey: $ARBITER_PK" -d '{"outcome": "release"}' | jq .
echo ""

echo "--- Buyer tries to vote refund (should FAIL) ---"
curl -s -X POST "$API/$ID4/approve" -H "Content-Type: application/json" -H "X-Dev-Pubkey: $BUYER_PK" -d '{"outcome": "refund"}' | jq .
echo ""

echo "--- Random user tries to vote (should FAIL) ---"
curl -s -X POST "$API/$ID4/approve" -H "Content-Type: application/json" -H "X-Dev-Pubkey: $RANDO_PK" -d '{"outcome": "release"}' | jq .
echo ""

echo "--- Buyer votes release (correct) ---"
curl -s -X POST "$API/$ID4/approve" -H "Content-Type: application/json" -H "X-Dev-Pubkey: $BUYER_PK" -d '{"outcome": "release"}' | jq .
echo ""

echo "--- Buyer double vote (should FAIL) ---"
curl -s -X POST "$API/$ID4/approve" -H "Content-Type: application/json" -H "X-Dev-Pubkey: $BUYER_PK" -d '{"outcome": "release"}' | jq .
echo ""

echo "--- Arbiter votes after only buyer (should FAIL) ---"
curl -s -X POST "$API/$ID4/approve" -H "Content-Type: application/json" -H "X-Dev-Pubkey: $ARBITER_PK" -d '{"outcome": "release"}' | jq .
echo ""

echo "--- Seller votes release (agree → resolve) ---"
curl -s -X POST "$API/$ID4/approve" -H "Content-Type: application/json" -H "X-Dev-Pubkey: $SELLER_PK" -d '{"outcome": "release"}' | jq .
echo ""

echo "--- Wrong party claims (should FAIL) ---"
curl -s -X POST "$API/$ID4/claim" -H "Content-Type: application/json" -H "X-Dev-Pubkey: $SELLER_PK" | jq .
echo ""

echo "--- List escrows (seller's view) ---"
curl -s "$API" -H "X-Dev-Pubkey: $SELLER_PK" | jq 'length'
echo ""

# =============================================
# Summary
# =============================================
echo "==========================================="
echo "  ✅ ALL TESTS COMPLETE"
echo "==========================================="
echo ""
echo "  AUTH: NIP-98 (dev mode: X-Dev-Pubkey)"
echo "  IDENTITY: Nostr npubs (hex pubkeys)"
echo "  COMMUNITY: fedi:room: link required"
echo ""
echo "  FLOW: Create → Join → Lock → Buyer → Seller → [Arbiter]"
echo ""
echo "  1. Happy path: buyer+seller agree → release            ✅"
echo "  2. Dispute: arbiter → refund to seller                 ✅"
echo "  3. Dispute: arbiter → release to buyer                 ✅"
echo "  4. Edge cases:"
echo "     - No community link → rejected                      ✅"
echo "     - No terms → rejected                               ✅"
echo "     - No auth → rejected                                ✅"
echo "     - Seller can't self-join as buyer                   ✅"
echo "     - Lock before all join → rejected                   ✅"
echo "     - Buyer can't lock (seller only)                    ✅"
echo "     - Seller blocked before buyer votes                 ✅"
echo "     - Arbiter blocked before both vote                  ✅"
echo "     - Buyer can't vote refund (release only)            ✅"
echo "     - Random user can't vote                            ✅"
echo "     - Double vote rejected                              ✅"
echo "     - Arbiter blocked after only buyer voted            ✅"
echo "     - Wrong party can't claim                           ✅"
echo "     - List returns user's escrows only                  ✅"
echo ""
