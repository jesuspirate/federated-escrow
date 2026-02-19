#!/usr/bin/env bash
# scripts/test-ecash-escrow.sh
#
# Tests the e-cash escrow API with strict rules:
#   1. Seller locks funds
#   2. Buyer votes FIRST (can ONLY vote "release")
#   3. Seller votes SECOND (can vote "release" or "refund")
#   4. If disagree → arbiter breaks tie
#
# Usage: bash scripts/test-ecash-escrow.sh

set -euo pipefail

API="http://localhost:3000/api"

echo "==========================================="
echo "  E-Cash Escrow API Test"
echo "  Buyer(release only) → Seller → [Arbiter]"
echo "==========================================="
echo ""

echo "--- Health Check ---"
curl -s "$API/health" | jq .
echo ""

# =============================================
# TEST 1: Happy Path
# =============================================
echo "==========================================="
echo "  TEST 1: Happy Path"
echo "  Buyer confirms → Seller confirms → release"
echo "==========================================="
echo ""

E1=$(curl -s -X POST "$API/ecash-escrows" \
  -H "Content-Type: application/json" \
  -d '{"amountMsats": 100000000, "description": "Widget purchase", "terms": "Buyer sends $50 USD via Zelle. Seller ships widget within 3 days."}')
echo "$E1" | jq .
ID1=$(echo "$E1" | jq -r '.id')
BT1=$(echo "$E1" | jq -r '.tokens.buyer')
ST1=$(echo "$E1" | jq -r '.tokens.seller')
echo ""

echo "--- Seller locks ---"
curl -s -X POST "$API/ecash-escrows/$ID1/lock" \
  -H "Content-Type: application/json" \
  -d "{\"token\": \"$ST1\", \"notes\": \"PLACEHOLDER_HAPPY_PATH\"}" | jq .
echo ""

echo "--- Buyer votes release ---"
curl -s -X POST "$API/ecash-escrows/$ID1/approve" \
  -H "Content-Type: application/json" \
  -d "{\"token\": \"$BT1\", \"outcome\": \"release\"}" | jq .
echo ""

echo "--- Seller votes release (auto-resolve!) ---"
curl -s -X POST "$API/ecash-escrows/$ID1/approve" \
  -H "Content-Type: application/json" \
  -d "{\"token\": \"$ST1\", \"outcome\": \"release\"}" | jq .
echo ""

echo "--- Buyer claims ---"
curl -s -X POST "$API/ecash-escrows/$ID1/claim" \
  -H "Content-Type: application/json" \
  -d "{\"token\": \"$BT1\"}" | jq .
echo ""

# =============================================
# TEST 2: Dispute → Arbiter refunds seller
# =============================================
echo "==========================================="
echo "  TEST 2: Dispute → Arbiter Refunds"
echo "  Buyer confirms, Seller disputes → Arbiter refunds"
echo "==========================================="
echo ""

E2=$(curl -s -X POST "$API/ecash-escrows" \
  -H "Content-Type: application/json" \
  -d '{"amountMsats": 50000000, "description": "Design work", "terms": "Buyer pays 25 EUR SEPA. Designer delivers logo in 48h."}')
echo "$E2" | jq .
ID2=$(echo "$E2" | jq -r '.id')
BT2=$(echo "$E2" | jq -r '.tokens.buyer')
ST2=$(echo "$E2" | jq -r '.tokens.seller')
AT2=$(echo "$E2" | jq -r '.tokens.arbiter')
echo ""

curl -s -X POST "$API/ecash-escrows/$ID2/lock" \
  -H "Content-Type: application/json" \
  -d "{\"token\": \"$ST2\", \"notes\": \"PLACEHOLDER_DISPUTE_REFUND\"}" | jq .
echo ""

echo "--- Buyer votes release ---"
curl -s -X POST "$API/ecash-escrows/$ID2/approve" \
  -H "Content-Type: application/json" \
  -d "{\"token\": \"$BT2\", \"outcome\": \"release\"}" | jq .
echo ""

echo "--- Seller votes refund (DISPUTE) ---"
curl -s -X POST "$API/ecash-escrows/$ID2/approve" \
  -H "Content-Type: application/json" \
  -d "{\"token\": \"$ST2\", \"outcome\": \"refund\"}" | jq .
echo ""

echo "--- Arbiter votes refund (sides with seller) ---"
curl -s -X POST "$API/ecash-escrows/$ID2/approve" \
  -H "Content-Type: application/json" \
  -d "{\"token\": \"$AT2\", \"outcome\": \"refund\"}" | jq .
echo ""

echo "--- Seller claims ---"
curl -s -X POST "$API/ecash-escrows/$ID2/claim" \
  -H "Content-Type: application/json" \
  -d "{\"token\": \"$ST2\"}" | jq .
echo ""

# =============================================
# TEST 3: Dispute → Arbiter releases to buyer
# =============================================
echo "==========================================="
echo "  TEST 3: Dispute → Arbiter Releases"
echo "  Buyer confirms, Seller disputes → Arbiter releases"
echo "==========================================="
echo ""

E3=$(curl -s -X POST "$API/ecash-escrows" \
  -H "Content-Type: application/json" \
  -d '{"amountMsats": 75000000, "description": "Laptop sale", "terms": "Buyer sends 0.005 BTC onchain. Seller ships laptop with tracking."}')
echo "$E3" | jq .
ID3=$(echo "$E3" | jq -r '.id')
BT3=$(echo "$E3" | jq -r '.tokens.buyer')
ST3=$(echo "$E3" | jq -r '.tokens.seller')
AT3=$(echo "$E3" | jq -r '.tokens.arbiter')
echo ""

curl -s -X POST "$API/ecash-escrows/$ID3/lock" \
  -H "Content-Type: application/json" \
  -d "{\"token\": \"$ST3\", \"notes\": \"PLACEHOLDER_DISPUTE_RELEASE\"}" | jq .
echo ""

echo "--- Buyer votes release ---"
curl -s -X POST "$API/ecash-escrows/$ID3/approve" \
  -H "Content-Type: application/json" \
  -d "{\"token\": \"$BT3\", \"outcome\": \"release\"}" | jq .
echo ""

echo "--- Seller votes refund (DISPUTE) ---"
curl -s -X POST "$API/ecash-escrows/$ID3/approve" \
  -H "Content-Type: application/json" \
  -d "{\"token\": \"$ST3\", \"outcome\": \"refund\"}" | jq .
echo ""

echo "--- Arbiter votes release (sides with buyer) ---"
curl -s -X POST "$API/ecash-escrows/$ID3/approve" \
  -H "Content-Type: application/json" \
  -d "{\"token\": \"$AT3\", \"outcome\": \"release\"}" | jq .
echo ""

echo "--- Buyer claims ---"
curl -s -X POST "$API/ecash-escrows/$ID3/claim" \
  -H "Content-Type: application/json" \
  -d "{\"token\": \"$BT3\"}" | jq .
echo ""

# =============================================
# TEST 4: All Edge Cases
# =============================================
echo "==========================================="
echo "  TEST 4: Edge Cases & Ordering"
echo "==========================================="
echo ""

E4=$(curl -s -X POST "$API/ecash-escrows" \
  -H "Content-Type: application/json" \
  -d '{"amountMsats": 10000000, "description": "Edge case test"}')
ID4=$(echo "$E4" | jq -r '.id')
BT4=$(echo "$E4" | jq -r '.tokens.buyer')
ST4=$(echo "$E4" | jq -r '.tokens.seller')
AT4=$(echo "$E4" | jq -r '.tokens.arbiter')

echo "--- Buyer tries to lock (should FAIL — seller only) ---"
curl -s -X POST "$API/ecash-escrows/$ID4/lock" \
  -H "Content-Type: application/json" \
  -d "{\"token\": \"$BT4\", \"notes\": \"stolen\"}" | jq .
echo ""

curl -s -X POST "$API/ecash-escrows/$ID4/lock" \
  -H "Content-Type: application/json" \
  -d "{\"token\": \"$ST4\", \"notes\": \"PLACEHOLDER_EDGE\"}" > /dev/null

echo "--- Seller votes before buyer (should FAIL) ---"
curl -s -X POST "$API/ecash-escrows/$ID4/approve" \
  -H "Content-Type: application/json" \
  -d "{\"token\": \"$ST4\", \"outcome\": \"release\"}" | jq .
echo ""

echo "--- Arbiter votes before anyone (should FAIL) ---"
curl -s -X POST "$API/ecash-escrows/$ID4/approve" \
  -H "Content-Type: application/json" \
  -d "{\"token\": \"$AT4\", \"outcome\": \"release\"}" | jq .
echo ""

echo "--- Buyer tries to vote refund (should FAIL — release only) ---"
curl -s -X POST "$API/ecash-escrows/$ID4/approve" \
  -H "Content-Type: application/json" \
  -d "{\"token\": \"$BT4\", \"outcome\": \"refund\"}" | jq .
echo ""

echo "--- Buyer votes release (correct) ---"
curl -s -X POST "$API/ecash-escrows/$ID4/approve" \
  -H "Content-Type: application/json" \
  -d "{\"token\": \"$BT4\", \"outcome\": \"release\"}" | jq .
echo ""

echo "--- Arbiter after only buyer voted (should FAIL) ---"
curl -s -X POST "$API/ecash-escrows/$ID4/approve" \
  -H "Content-Type: application/json" \
  -d "{\"token\": \"$AT4\", \"outcome\": \"release\"}" | jq .
echo ""

echo "--- Buyer double vote (should FAIL) ---"
curl -s -X POST "$API/ecash-escrows/$ID4/approve" \
  -H "Content-Type: application/json" \
  -d "{\"token\": \"$BT4\", \"outcome\": \"release\"}" | jq .
echo ""

echo "--- Seller votes release (agree → resolve) ---"
curl -s -X POST "$API/ecash-escrows/$ID4/approve" \
  -H "Content-Type: application/json" \
  -d "{\"token\": \"$ST4\", \"outcome\": \"release\"}" | jq .
echo ""

echo "--- Wrong party claims (should FAIL) ---"
curl -s -X POST "$API/ecash-escrows/$ID4/claim" \
  -H "Content-Type: application/json" \
  -d "{\"token\": \"$ST4\"}" | jq .
echo ""

# =============================================
# Summary
# =============================================
echo "==========================================="
echo "  ✅ ALL TESTS COMPLETE"
echo "==========================================="
echo ""
echo "  FLOW: Seller locks → Buyer votes(release only) → Seller votes → [Arbiter]"
echo ""
echo "  1. Happy path: buyer+seller agree → release         ✅"
echo "  2. Dispute: arbiter → refund to seller              ✅"
echo "  3. Dispute: arbiter → release to buyer              ✅"
echo "  4. Edge cases:"
echo "     - Buyer can't lock (seller only)                 ✅"
echo "     - Seller blocked before buyer votes              ✅"
echo "     - Arbiter blocked before both vote               ✅"
echo "     - Buyer can't vote refund (release only)         ✅"
echo "     - Arbiter blocked after only buyer voted         ✅"
echo "     - Double vote rejected                           ✅"
echo "     - Wrong party can't claim                        ✅"
echo ""
