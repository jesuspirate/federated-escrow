#!/usr/bin/env tsx
// scripts/test-ecash-escrow.ts — v5.0 fedimint-clientd integration tests
//
// Tests in two modes:
//   1. Manual mode (always runs) — dev testing without fedimint-clientd
//   2. WebLN mode (runs if fedimint-clientd is available) — full lock/payout flow
//
// Usage: npx tsx scripts/test-ecash-escrow.ts

import { generateSecretKey, getPublicKey, finalizeEvent } from "nostr-tools/pure";

const API = "http://localhost:3000/api/ecash-escrows";
const COMMUNITY = "fedi:room:!kENaQZKCKhRhawCjxf:m1.8fa.in:::";

const sellerSk = generateSecretKey();
const buyerSk = generateSecretKey();
const arbiterSk = generateSecretKey();
const randoSk = generateSecretKey();

const sellerPk = getPublicKey(sellerSk);
const buyerPk = getPublicKey(buyerSk);
const arbiterPk = getPublicKey(arbiterSk);

// ── NIP-98 signed fetch ───────────────────────────────────────────────────

async function nip98(url: string, sk: Uint8Array, opts: RequestInit = {}): Promise<any> {
  const method = (opts.method || "GET").toUpperCase();
  const tags: string[][] = [["u", url], ["method", method]];
  if (opts.body && ["POST", "PUT", "PATCH"].includes(method)) {
    const h = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(opts.body)));
    tags.push(["payload", Array.from(new Uint8Array(h)).map(b => b.toString(16).padStart(2, "0")).join("")]);
  }
  const ev = finalizeEvent({ created_at: Math.floor(Date.now() / 1000), kind: 27235, tags, content: "" }, sk);
  const b64 = Buffer.from(JSON.stringify(ev)).toString("base64");
  return (await fetch(url, { ...opts, headers: { "Content-Type": "application/json", "Authorization": `Nostr ${b64}` } })).json();
}

let passed = 0, failed = 0;
function ok(cond: boolean, label: string, d?: any) {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else { console.log(`  ❌ ${label}`); if (d) console.log(`     →`, JSON.stringify(d).slice(0, 200)); failed++; }
}

async function main() {

console.log("==============================================");
console.log("  E-Cash Escrow v5.0 — Fedimint Integration  ");
console.log("  Schnorr + SQLite + fedimint-clientd + WebLN");
console.log("==============================================\n");

// ── Check fedimint-clientd availability ───────────────────────────────────
const health = await nip98(`${API}/health`, sellerSk);
const fmConnected = health.fedimintClientd === "connected";
console.log(`  Fedimint-clientd: ${fmConnected ? "✅ connected" : "⚠️  unavailable (manual mode only)"}`);
if (fmConnected) console.log(`  Server wallet balance: ${health.walletBalance} msats`);
console.log("");

// ═══ TEST 1: Happy Path (manual lock) ═══
console.log("═══ TEST 1: Happy Path (manual lock) ═══");

const e1 = await nip98(API, sellerSk, { method: "POST", body: JSON.stringify({ amountMsats: 100000000, description: "Widget purchase", terms: "Buyer sends $50 via Zelle. Seller ships within 3 days.", communityLink: COMMUNITY }) });
ok(e1.id && e1.status === "CREATED", "Seller creates escrow", e1);
ok(!!e1.expiresIn, "Escrow has expiry: " + e1.expiresIn, e1);
const id1 = e1.id;

await nip98(`${API}/${id1}/join`, buyerSk, { method: "POST", body: JSON.stringify({ role: "buyer" }) });
const j1a = await nip98(`${API}/${id1}/join`, arbiterSk, { method: "POST", body: JSON.stringify({ role: "arbiter" }) });
ok(j1a.allJoined === true, "All 3 joined → FUNDED", j1a);

const l1 = await nip98(`${API}/${id1}/lock`, sellerSk, { method: "POST", body: JSON.stringify({ notes: "ECASH_NOTES_HAPPY_PATH_12345", mode: "manual" }) });
ok(l1.status === "LOCKED" && l1.lockMode === "manual", "Seller locks (manual mode)", l1);
ok(!!l1.expiresIn, "Lock extends expiry: " + l1.expiresIn, l1);

await nip98(`${API}/${id1}/approve`, buyerSk, { method: "POST", body: JSON.stringify({ outcome: "release" }) });
const v1s = await nip98(`${API}/${id1}/approve`, sellerSk, { method: "POST", body: JSON.stringify({ outcome: "release" }) });
ok(v1s.resolved && v1s.resolvedOutcome === "release", "Both release → resolved", v1s);

const c1 = await nip98(`${API}/${id1}/claim`, buyerSk, { method: "POST", body: "{}" });
ok(c1.status === "CLAIMED" && c1.notes === "ECASH_NOTES_HAPPY_PATH_12345", "Buyer claims decrypted notes", c1);

console.log("");

// ═══ TEST 2: Dispute → Arbiter Refunds ═══
console.log("═══ TEST 2: Dispute → Arbiter Refunds ═══");

const e2 = await nip98(API, sellerSk, { method: "POST", body: JSON.stringify({ amountMsats: 50000000, description: "Design work", terms: "Buyer pays 25 EUR SEPA.", communityLink: COMMUNITY }) });
const id2 = e2.id;
await nip98(`${API}/${id2}/join`, buyerSk, { method: "POST", body: JSON.stringify({ role: "buyer" }) });
await nip98(`${API}/${id2}/join`, arbiterSk, { method: "POST", body: JSON.stringify({ role: "arbiter" }) });
await nip98(`${API}/${id2}/lock`, sellerSk, { method: "POST", body: JSON.stringify({ notes: "ECASH_DISPUTE_REFUND", mode: "manual" }) });

await nip98(`${API}/${id2}/approve`, buyerSk, { method: "POST", body: JSON.stringify({ outcome: "release" }) });
await nip98(`${API}/${id2}/approve`, sellerSk, { method: "POST", body: JSON.stringify({ outcome: "refund" }) });
const v2a = await nip98(`${API}/${id2}/approve`, arbiterSk, { method: "POST", body: JSON.stringify({ outcome: "refund" }) });
ok(v2a.resolved && v2a.resolvedOutcome === "refund", "Arbiter sides with seller", v2a);

const c2 = await nip98(`${API}/${id2}/claim`, sellerSk, { method: "POST", body: "{}" });
ok(c2.claimedBy === "seller" && c2.notes === "ECASH_DISPUTE_REFUND", "Seller claims refund", c2);

console.log("");

// ═══ TEST 3: Dispute → Arbiter Releases ═══
console.log("═══ TEST 3: Dispute → Arbiter Releases ═══");

const e3 = await nip98(API, sellerSk, { method: "POST", body: JSON.stringify({ amountMsats: 75000000, description: "Laptop", terms: "BTC onchain. Ship with tracking.", communityLink: COMMUNITY }) });
const id3 = e3.id;
await nip98(`${API}/${id3}/join`, buyerSk, { method: "POST", body: JSON.stringify({ role: "buyer" }) });
await nip98(`${API}/${id3}/join`, arbiterSk, { method: "POST", body: JSON.stringify({ role: "arbiter" }) });
await nip98(`${API}/${id3}/lock`, sellerSk, { method: "POST", body: JSON.stringify({ notes: "ECASH_DISPUTE_RELEASE", mode: "manual" }) });

await nip98(`${API}/${id3}/approve`, buyerSk, { method: "POST", body: JSON.stringify({ outcome: "release" }) });
await nip98(`${API}/${id3}/approve`, sellerSk, { method: "POST", body: JSON.stringify({ outcome: "refund" }) });
const v3a = await nip98(`${API}/${id3}/approve`, arbiterSk, { method: "POST", body: JSON.stringify({ outcome: "release" }) });
ok(v3a.resolved && v3a.resolvedOutcome === "release", "Arbiter sides with buyer", v3a);

const c3 = await nip98(`${API}/${id3}/claim`, buyerSk, { method: "POST", body: "{}" });
ok(c3.claimedBy === "buyer", "Buyer claims", c3);

console.log("");

// ═══ TEST 4: Invoice & WebLN Flow ═══
console.log("═══ TEST 4: Invoice & WebLN Lock Flow ═══");

const e4 = await nip98(API, sellerSk, { method: "POST", body: JSON.stringify({ amountMsats: 25000000, description: "WebLN test", terms: "Testing WebLN lock flow.", communityLink: COMMUNITY }) });
const id4 = e4.id;
await nip98(`${API}/${id4}/join`, buyerSk, { method: "POST", body: JSON.stringify({ role: "buyer" }) });
await nip98(`${API}/${id4}/join`, arbiterSk, { method: "POST", body: JSON.stringify({ role: "arbiter" }) });

const inv = await nip98(`${API}/${id4}/invoice`, sellerSk);
ok(inv.amountSats === 25000, "Invoice for exact amount: 25,000 sats", inv);

if (fmConnected && inv.mode === "webln") {
  ok(typeof inv.invoice === "string" && inv.invoice.startsWith("ln"), "Real BOLT-11 invoice from fedimint-clientd", inv);

  // In a real Fedi app, the seller would call webln.sendPayment(inv.invoice) here.
  // The test can't simulate that without a funded wallet, so we verify the flow exists.
  console.log("  ℹ️  WebLN payment requires Fedi wallet — skipping actual payment in test");

  // Verify lock without payment fails correctly
  const lockFail = await nip98(`${API}/${id4}/lock`, sellerSk, { method: "POST", body: JSON.stringify({ mode: "webln" }) });
  ok(lockFail.error && (lockFail.error.includes("not yet paid") || lockFail.error.includes("not running")), "WebLN lock before payment → rejected", lockFail);
} else {
  ok(inv.mode === "manual" || inv.invoice === null, "No fedimint-clientd → manual mode fallback", inv);
  // Lock manually for remaining tests
  const l4 = await nip98(`${API}/${id4}/lock`, sellerSk, { method: "POST", body: JSON.stringify({ notes: "ECASH_WEBLN_FALLBACK_TEST", mode: "manual" }) });
  ok(l4.status === "LOCKED", "Manual lock fallback works", l4);

  // Complete the trade to test claim flow
  await nip98(`${API}/${id4}/approve`, buyerSk, { method: "POST", body: JSON.stringify({ outcome: "release" }) });
  await nip98(`${API}/${id4}/approve`, sellerSk, { method: "POST", body: JSON.stringify({ outcome: "release" }) });
  const c4 = await nip98(`${API}/${id4}/claim`, buyerSk, { method: "POST", body: "{}" });
  ok(c4.status === "CLAIMED" && c4.notes === "ECASH_WEBLN_FALLBACK_TEST", "Manual claim returns raw notes", c4);
}

// Buyer can't get lock invoice
ok(!!(await nip98(`${API}/${id4}/invoice`, buyerSk)).error, "Buyer can't get lock invoice", {});

console.log("");

// ═══ TEST 5: Payout endpoint ═══
console.log("═══ TEST 5: Payout Endpoint ═══");

const e5p = await nip98(API, sellerSk, { method: "POST", body: JSON.stringify({ amountMsats: 10000000, description: "Payout test", terms: "Test payout flow.", communityLink: COMMUNITY }) });
const id5p = e5p.id;
await nip98(`${API}/${id5p}/join`, buyerSk, { method: "POST", body: JSON.stringify({ role: "buyer" }) });
await nip98(`${API}/${id5p}/join`, arbiterSk, { method: "POST", body: JSON.stringify({ role: "arbiter" }) });
await nip98(`${API}/${id5p}/lock`, sellerSk, { method: "POST", body: JSON.stringify({ notes: "ECASH_PAYOUT_TEST", mode: "manual" }) });
await nip98(`${API}/${id5p}/approve`, buyerSk, { method: "POST", body: JSON.stringify({ outcome: "release" }) });
await nip98(`${API}/${id5p}/approve`, sellerSk, { method: "POST", body: JSON.stringify({ outcome: "release" }) });
await nip98(`${API}/${id5p}/claim`, buyerSk, { method: "POST", body: "{}" });

// Payout requires CLAIMED status — our manual lock claim already returned notes directly
// so payout is only for webln-locked escrows. Verify the endpoint rejects bad state.
const payoutBadInvoice = await nip98(`${API}/${id5p}/payout`, buyerSk, { method: "POST", body: JSON.stringify({ invoice: "not-a-bolt11" }) });
// Status is already past CLAIMED for manual lock, but check the endpoint exists and validates
ok(!!payoutBadInvoice.error, "Payout validates invoice format or state", payoutBadInvoice);

// Payout on non-claimed escrow
const payoutWrongState = await nip98(`${API}/${id1}/payout`, buyerSk, { method: "POST", body: JSON.stringify({ invoice: "lnbc1000n1test" }) });
ok(!!payoutWrongState.error, "Payout on wrong state → rejected", payoutWrongState);

console.log("");

// ═══ TEST 6: Edge Cases ═══
console.log("═══ TEST 6: Edge Cases ═══");

const noCom = await nip98(API, sellerSk, { method: "POST", body: JSON.stringify({ amountMsats: 10000, terms: "some terms" }) });
ok(!!noCom.error, "No community link → rejected", noCom);

const noTerms = await nip98(API, sellerSk, { method: "POST", body: JSON.stringify({ amountMsats: 10000, communityLink: COMMUNITY }) });
ok(!!noTerms.error, "No terms → rejected", noTerms);

const noAuth = await (await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).json();
ok(!!noAuth.error, "No auth → rejected", noAuth);

const e6 = await nip98(API, sellerSk, { method: "POST", body: JSON.stringify({ amountMsats: 10000000, description: "Edge test", terms: "Edge case terms here", communityLink: COMMUNITY }) });
const id6 = e6.id;

ok(!!(await nip98(`${API}/${id6}/join`, sellerSk, { method: "POST", body: JSON.stringify({ role: "buyer" }) })).error, "Seller can't self-join", {});
ok(!!(await nip98(`${API}/${id6}/lock`, sellerSk, { method: "POST", body: JSON.stringify({ notes: "TEST123456", mode: "manual" }) })).error, "Lock before all join → rejected", {});

await nip98(`${API}/${id6}/join`, buyerSk, { method: "POST", body: JSON.stringify({ role: "buyer" }) });
await nip98(`${API}/${id6}/join`, arbiterSk, { method: "POST", body: JSON.stringify({ role: "arbiter" }) });

ok(!!(await nip98(`${API}/${id6}/lock`, buyerSk, { method: "POST", body: JSON.stringify({ notes: "STOLEN12345", mode: "manual" }) })).error, "Buyer can't lock", {});

await nip98(`${API}/${id6}/lock`, sellerSk, { method: "POST", body: JSON.stringify({ notes: "ECASH_EDGE_12345", mode: "manual" }) });

ok(!!(await nip98(`${API}/${id6}/approve`, sellerSk, { method: "POST", body: JSON.stringify({ outcome: "release" }) })).error, "Seller blocked before buyer", {});
ok(!!(await nip98(`${API}/${id6}/approve`, arbiterSk, { method: "POST", body: JSON.stringify({ outcome: "release" }) })).error, "Arbiter blocked before both", {});
ok(!!(await nip98(`${API}/${id6}/approve`, buyerSk, { method: "POST", body: JSON.stringify({ outcome: "refund" }) })).error, "Buyer can't vote refund", {});
ok(!!(await nip98(`${API}/${id6}/approve`, randoSk, { method: "POST", body: JSON.stringify({ outcome: "release" }) })).error, "Rando can't vote", {});

await nip98(`${API}/${id6}/approve`, buyerSk, { method: "POST", body: JSON.stringify({ outcome: "release" }) });
ok(!!(await nip98(`${API}/${id6}/approve`, buyerSk, { method: "POST", body: JSON.stringify({ outcome: "release" }) })).error, "Double vote rejected", {});
ok(!!(await nip98(`${API}/${id6}/approve`, arbiterSk, { method: "POST", body: JSON.stringify({ outcome: "release" }) })).error, "Arbiter blocked (only buyer voted)", {});

const v6s = await nip98(`${API}/${id6}/approve`, sellerSk, { method: "POST", body: JSON.stringify({ outcome: "release" }) });
ok(v6s.resolved && v6s.winner === "buyer", "Seller agrees → resolved", v6s);

ok(!!(await nip98(`${API}/${id6}/claim`, sellerSk, { method: "POST", body: "{}" })).error, "Wrong party can't claim", {});

const list = await nip98(API, sellerSk);
ok(Array.isArray(list) && list.length >= 5, `List returns ${list.length} escrows`, {});

// WebLN lock without pending invoice
const e6w = await nip98(API, sellerSk, { method: "POST", body: JSON.stringify({ amountMsats: 5000000, description: "no invoice", terms: "test test test", communityLink: COMMUNITY }) });
await nip98(`${API}/${e6w.id}/join`, buyerSk, { method: "POST", body: JSON.stringify({ role: "buyer" }) });
await nip98(`${API}/${e6w.id}/join`, arbiterSk, { method: "POST", body: JSON.stringify({ role: "arbiter" }) });
ok(!!(await nip98(`${API}/${e6w.id}/lock`, sellerSk, { method: "POST", body: JSON.stringify({ mode: "webln" }) })).error, "WebLN lock without invoice → rejected", {});

console.log("");

// ═══ Summary ═══
console.log("==============================================");
console.log(`  ${passed + failed} tests: ${passed} passed, ${failed} failed`);
console.log("==============================================");
console.log(`  AUTH: NIP-98 Schnorr (real secp256k1)`);
console.log(`  DB:   SQLite + AES-256-GCM encryption`);
console.log(`  LOCK: ${fmConnected ? "fedimint-clientd (WebLN)" : "manual (fedimint-clientd offline)"}`);
console.log(`  PAY:  ${fmConnected ? "fedimint-clientd LN payout" : "direct notes (dev)"}`);
console.log(`  HARDENING: rate limit, expiry, CORS-ready`);
console.log("==============================================\n");

if (failed > 0) process.exit(1);

} // end main

main().catch(err => { console.error("Fatal:", err); process.exit(1); });
