// src/routes/ecash-escrow.ts — v5.0 with fedimint-clientd integration
//
// Lock flow:  GET /invoice → seller pays via WebLN → POST /lock (confirms)
// Claim flow: POST /claim → POST /payout (winner submits invoice, server pays)
// Manual fallback for dev testing (NODE_ENV !== 'production')

// ═══════════════════════════════════════════════════════════════════════
// ARBITER ALLOWLIST — Backend Patch
// Add this to src/routes/ecash-escrow.ts
// ═══════════════════════════════════════════════════════════════════════
//
// This enforces that only pre-approved npubs can join as arbiters.
// Set ALLOWED_ARBITERS as a comma-separated list of hex pubkeys.
//
// Example in .env or environment:
//   ALLOWED_ARBITERS=abc123def456...,789abc012def...
//
// If not set, arbiter joins are OPEN (for dev/testing only).
// ═══════════════════════════════════════════════════════════════════════

// ── Step 1: Add this near the top of ecash-escrow.ts ────────────────

const ALLOWED_ARBITERS: Set<string> | null = (() => {
  const raw = process.env.ALLOWED_ARBITERS;
  if (!raw || raw.trim() === "") return null; // null = open mode (dev only)
  const list = raw.split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
  console.log(`[arbiter] Allowlist loaded: ${list.length} approved arbiters`);
  return new Set(list);
})();

function isArbiterAllowed(pubkey: string): boolean {
  if (!ALLOWED_ARBITERS) return true; // open mode
  return ALLOWED_ARBITERS.has(pubkey.toLowerCase());
}

// Also expose an endpoint so the frontend can check:
// GET /api/ecash-escrows/arbiter-check
// Returns { allowed: boolean, mode: "allowlist" | "open" }

// ── Step 2: Add this route ──────────────────────────────────────────

// router.get("/arbiter-check", (req, res) => {
//   const pubkey = req.headers["x-dev-pubkey"] as string
//     || extractNip98Pubkey(req.headers["authorization"] as string);
//   if (!pubkey) return res.json({ allowed: false, mode: ALLOWED_ARBITERS ? "allowlist" : "open" });
//   res.json({
//     allowed: isArbiterAllowed(pubkey),
//     mode: ALLOWED_ARBITERS ? "allowlist" : "open",
//   });
// });

// ── Step 3: Guard the join endpoint ─────────────────────────────────
// In your existing POST /:id/join handler, add this check
// BEFORE inserting the arbiter into the escrow:

// if (role === "arbiter") {
//   const pubkey = req.headers["x-dev-pubkey"] as string
//     || extractNip98Pubkey(req.headers["authorization"] as string);
//   if (!isArbiterAllowed(pubkey)) {
//     return res.status(403).json({
//       error: "Arbiter not authorized. Only pre-approved community arbiters can join trades."
//     });
//   }
// }

// ═══════════════════════════════════════════════════════════════════════
// That's it. Three additions:
//   1. Allowlist parsing from env var
//   2. /arbiter-check endpoint for frontend
//   3. Guard in /:id/join
//
// Set the env var in your .env or in the systemd service:
//   Environment=ALLOWED_ARBITERS=npub1abc...,npub2def...
// ═══════════════════════════════════════════════════════════════════════

import { Router, Request, Response, NextFunction } from "express";
import { verifyEvent } from "nostr-tools/pure";
import * as DB from "../db";
import * as Notify from "../notifications";
import * as FM from "../fedimint";
import { matrixBot } from "./matrix-bot";
import { splitNotes, combineShares, validateReconstructedNotes } from "../shamir";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);
const FM_CLI = process.env.FEDIMINT_CLI_PATH || "/usr/bin/fedimint-cli";
const PLATFORM_FEE_BPS = parseInt(process.env.PLATFORM_FEE_BPS || "0");
const PLATFORM_WALLET_BASE = process.env.PLATFORM_WALLET_DIR || "/home/satoshi/federated-escrow/platform-wallet";

// Map e-cash note prefixes to federation wallet data dirs
const FED_PREFIX_TO_WALLET: Record<string, string> = {
  "AwEEiItw7A": "bitcoin-life",
  "AwEEG8tk5g": "global-bitcoin-federation",
  "AwEE_yhqbg": "afribit-kibera",
};

async function fmCli(walletDir: string, ...args: string[]): Promise<string> {
  const dataDir = PLATFORM_WALLET_BASE + "/" + walletDir;
  const { stdout } = await execFileAsync(FM_CLI, ["--data-dir", dataDir, ...args], {
    timeout: 60000,
    env: { ...process.env, RUST_LOG: "warn" },
  });
  return stdout.trim();
}

async function collectFee(notes: string, amountMsats: number, escrowId: string, fedPrefix: string): Promise<{ winnerNotes: string; feeMsats: number } | null> {
  if (PLATFORM_FEE_BPS <= 0) return null;
  
  const walletDir = FED_PREFIX_TO_WALLET[fedPrefix];
  if (!walletDir) {
    console.warn("[fee] Unknown federation prefix:", fedPrefix, "— skipping fee collection for", escrowId);
    return null;
  }
  
  const feeMsats = Math.floor(amountMsats * PLATFORM_FEE_BPS / 10000);
  const winnerMsats = amountMsats - feeMsats;
  
  if (feeMsats < 1000) {
    // Fee less than 1 sat — not worth collecting
    console.log("[fee] Fee too small (" + feeMsats + " msats) for", escrowId, "— skipping");
    return null;
  }
  
  try {
    // Step 1: Reissue (receive) the original notes into platform wallet
    console.log("[fee] Reissuing", amountMsats, "msats for", escrowId, "via", walletDir);
    await fmCli(walletDir, "reissue", notes);
    
    // Step 2: Spend (generate) new notes for the winner (amount minus fee)
    console.log("[fee] Spending", winnerMsats, "msats for winner of", escrowId);
    const spendResult = await fmCli(walletDir, "spend", String(winnerMsats), "--allow-overpay");
    
    // Parse the spend result — it returns JSON with "notes" field
    let winnerNotes: string;
    try {
      const parsed = JSON.parse(spendResult);
      winnerNotes = parsed.notes || parsed;
    } catch {
      winnerNotes = spendResult;
    }
    
    if (!winnerNotes || winnerNotes.length < 10) {
      throw new Error("Spend returned invalid notes");
    }
    
    console.log("[fee] \u2705 Fee collected for", escrowId, ":", feeMsats, "msats (" + (PLATFORM_FEE_BPS / 100) + "%). Winner gets", winnerMsats, "msats");
    return { winnerNotes, feeMsats };
  } catch (err: any) {
    console.error("[fee] \u274c Fee collection FAILED for", escrowId, ":", err.message);
    console.error("[fee] Returning original notes to winner (no fee deducted)");
    return null; // Fail gracefully — winner gets full amount
  }
}

type Role = "buyer" | "seller" | "arbiter";
type Outcome = "release" | "refund";

interface AuthenticatedRequest extends Request {
  pubkey?: string;
}

// ── Rate Limiter (per pubkey) ─────────────────────────────────────────────

const rateLimits = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = Number(process.env.RATE_LIMIT_PER_MIN) || 30;
const RATE_WINDOW_MS = 60_000;

function rateLimit(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const pk = req.pubkey!;
  const now = Date.now();
  let entry = rateLimits.get(pk);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + RATE_WINDOW_MS };
    rateLimits.set(pk, entry);
  }
  entry.count++;
  if (entry.count > RATE_LIMIT) {
    return res.status(429).json({ error: `Rate limit exceeded (${RATE_LIMIT}/min). Try again later.` });
  }
  next();
}

// ── NIP-98 Auth Middleware ────────────────────────────────────────────────

// ── Session tokens — reduces NIP-98 auth to one-time per session ──────────
const SESSION_SECRET = process.env.ESCROW_ENCRYPTION_KEY || "dev-session-secret";
const activeSessions: Map<string, { pubkey: string, expiresAt: number }> = new Map();

function createSessionToken(pubkey: string): string {
  const expiresAt = Date.now() + 30 * 60 * 1000; // 30 minutes
  const payload = pubkey + ":" + expiresAt;
  const hmac = require("crypto").createHmac("sha256", SESSION_SECRET).update(payload).digest("hex");
  const token = Buffer.from(payload + ":" + hmac).toString("base64");
  activeSessions.set(token, { pubkey, expiresAt });
  // Clean expired sessions periodically
  if (activeSessions.size > 1000) {
    const now = Date.now();
    for (const [k, v] of activeSessions) { if (v.expiresAt < now) activeSessions.delete(k); }
  }
  return token;
}

function validateSessionToken(token: string): string | null {
  const session = activeSessions.get(token);
  if (session && session.expiresAt > Date.now()) return session.pubkey;
  // Verify HMAC if not in cache (server restart)
  try {
    const decoded = Buffer.from(token, "base64").toString("utf8");
    const parts = decoded.split(":");
    if (parts.length !== 3) return null;
    const [pubkey, expiresStr, hmac] = parts;
    const expiresAt = parseInt(expiresStr);
    if (expiresAt < Date.now()) return null;
    const expectedHmac = require("crypto").createHmac("sha256", SESSION_SECRET).update(pubkey + ":" + expiresStr).digest("hex");
    if (hmac !== expectedHmac) return null;
    activeSessions.set(token, { pubkey, expiresAt });
    return pubkey;
  } catch { return null; }
}

function extractPubkey(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  DB.processExpiredEscrows();
  console.log("[extractPubkey] path:", req.path, "method:", req.method, "auth:", req.headers.authorization?.substring(0, 30) || "NONE");
  // Process arbiter dispute timeouts (4h rotation)
  const arbiterList = ALLOWED_ARBITERS ? [...ALLOWED_ARBITERS] : [];
  DB.processDisputeTimeouts(arbiterList, (escrow, oldArbiter, newArbiter) => {
    // Notify old arbiter they've been replaced
    if (!isDevPubkey(escrow.seller_pubkey)) {
      Notify.notifyArbiterReplaced(escrow.id, oldArbiter, newArbiter, escrow.amount_msats, escrow.community_link || "", escrow.seller_pubkey, escrow.buyer_pubkey);
    }
  });

  const authHeader = req.headers.authorization;

  // Session token auth (Bearer) — fast path, no NIP-98 needed
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    const pubkey = validateSessionToken(token);
    if (pubkey) {
      req.pubkey = pubkey;
      return next();
    } else {
      console.log("[escrow-auth] Bearer token REJECTED, token length:", token.length, "first 20:", token.substring(0, 20));
    }
    // Token expired/invalid — fall through to NIP-98
  }

  if (authHeader && authHeader.startsWith("Nostr ")) {
    try {
      const json = Buffer.from(authHeader.slice(6), "base64").toString("utf8");
      const event = JSON.parse(json);

      if (event.kind !== 27235) return res.status(401).json({ error: "Invalid auth event kind (expected 27235)" });

      const now = Math.floor(Date.now() / 1000);
      if (Math.abs(now - event.created_at) > 120) return res.status(401).json({ error: "Auth event expired (>120s)" });

      const methodTag = event.tags?.find((t: string[]) => t[0] === "method");
      if (methodTag && methodTag[1] !== req.method) return res.status(401).json({ error: "Auth method mismatch" });

      if (!event.pubkey || typeof event.pubkey !== "string" || event.pubkey.length !== 64)
        return res.status(401).json({ error: "Invalid pubkey in auth event" });

      if (!verifyEvent(event))
        return res.status(401).json({ error: "Invalid signature — Schnorr verification failed" });

      req.pubkey = event.pubkey;
      return next();
    } catch {
      return res.status(401).json({ error: "Malformed NIP-98 auth header" });
    }
  }

  const devPubkey = req.headers["x-dev-pubkey"] as string;
  if (devPubkey && process.env.ALLOW_DEV_PUBKEY === "true") {
    // SECURITY: Only accept sandbox identities, never arbitrary pubkeys
    const SANDBOX_IDS = new Set(["aa".repeat(32), "bb".repeat(32), "cc".repeat(32)]);
    if (typeof devPubkey === "string" && devPubkey.length === 64 && SANDBOX_IDS.has(devPubkey)) {
      req.pubkey = devPubkey;
      return next();
    }
    return res.status(401).json({ error: "Invalid dev pubkey — only sandbox identities accepted" });
  }

  return res.status(401).json({ error: "Authentication required. Send NIP-98 Authorization header or X-Dev-Pubkey (dev mode only)." });
}

// ── Helpers ───────────────────────────────────────────────────────────────

function getRoleByPubkey(row: DB.EscrowRow, pk: string): Role | null {
  if (pk === row.seller_pubkey) return "seller";
  if (pk === row.buyer_pubkey) return "buyer";
  if (pk === row.arbiter_pubkey) return "arbiter";
  return null;
}

// ═══════════════════════════════════════════════════════════════════════
// BACKEND PATCH 2 — Sandbox Isolation
// Apply to ~/federated-escrow/src/routes/ecash-escrow.ts
// ═══════════════════════════════════════════════════════════════════════

// ────────────────────────────────────────────────────────────────────────
// ADD this helper near the other helpers (after getRoleByPubkey):
// ────────────────────────────────────────────────────────────────────────

// DEV_PUBKEYS matches the frontend sandbox identities

const DEV_PUBKEYS = new Set([
  "aa".repeat(32),  // seller
  "bb".repeat(32),  // buyer
  "cc".repeat(32),  // arbiter
]);
function isDevPubkey(pk: string): boolean { return DEV_PUBKEYS.has(pk); }

// ────────────────────────────────────────────────────────────────────────
// FIX: In POST / (create) — tag sandbox escrows
// ────────────────────────────────────────────────────────────────────────
//
// After the escrow is created, if the seller has a dev pubkey,
// the escrow is implicitly a sandbox trade (seller_pubkey is aaa...).
// No extra tagging needed — we detect it at join time.

function tallyVotes(votes: DB.VoteRow[]) {
  const release = votes.filter(v => v.outcome === "release").length;
  const refund = votes.filter(v => v.outcome === "refund").length;
  return { releaseCount: release, refundCount: refund, outcome: (release >= 2 ? "release" : refund >= 2 ? "refund" : null) as Outcome | null };
}

function hexToNpub(hex: string): string {
  const C = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  function polymod(v: number[]) { let c = 1; for (const x of v) { const b = c >> 25; c = ((c & 0x1ffffff) << 5) ^ x; for (let i = 0; i < 5; i++) if ((b >> i) & 1) c ^= GEN[i]; } return c; }
  const hrp = [0, 0, 0, 0, 14, 16, 21, 2];
  const bytes: number[] = []; for (let i = 0; i < hex.length; i += 2) bytes.push(parseInt(hex.substring(i, i + 2), 16));
  const words: number[] = []; let acc = 0, bits = 0;
  for (const b of bytes) { acc = (acc << 8) | b; bits += 8; while (bits >= 5) { bits -= 5; words.push((acc >> bits) & 31); } }
  if (bits > 0) words.push((acc << (5 - bits)) & 31);
  const pm = polymod(hrp.concat(words).concat([0, 0, 0, 0, 0, 0])) ^ 1;
  const cs: number[] = []; for (let i = 0; i < 6; i++) cs.push((pm >> (5 * (5 - i))) & 31);
  return "npub1" + words.concat(cs).map(d => C[d]).join("");
}

function truncPk(hex: string): string { return hex.slice(0, 8) + "..." + hex.slice(-8); }
function isValidCommunityLink(l: string): boolean { return /^fedi:room:![a-zA-Z0-9]+:[a-zA-Z0-9.-]+:::$/.test(l.trim()); }
function extractFederationId(l: string): string | null { const m = l.match(/^fedi:room:![a-zA-Z0-9]+:([a-zA-Z0-9.-]+):::$/); return m ? m[1] : null; }
function participantInfo(pk: string | null) { return pk ? { pubkey: truncPk(pk), npub: hexToNpub(pk), isFull: true } : { isFull: false }; }

function isExpired(row: DB.EscrowRow): boolean {
  return row.status === "EXPIRED" || (row.expires_at !== null && Date.now() > row.expires_at);
}

function formatExpiry(ms: number | null): string | null {
  if (!ms) return null;
  const remaining = ms - Date.now();
  if (remaining <= 0) return "expired";
  const hours = Math.floor(remaining / 3600000);
  const mins = Math.floor((remaining % 3600000) / 60000);
  return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
}

// ── In-memory invoice tracking ────────────────────────────────────────────
const pendingInvoices = new Map<string, { invoice: string; operationId: string; createdAt: number }>();

// ── Router ────────────────────────────────────────────────────────────────

const router = Router();
// ── POST /auth/session — Exchange NIP-98 for a session token ──────────────
router.post("/auth/session", (req: AuthenticatedRequest, res: Response) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Nostr ")) {
    return res.status(401).json({ error: "NIP-98 auth required to create session" });
  }
  try {
    const json = Buffer.from(authHeader.slice(6), "base64").toString("utf8");
    const event = JSON.parse(json);
    if (event.kind !== 27235) return res.status(401).json({ error: "Invalid auth event kind" });
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - event.created_at) > 120) return res.status(401).json({ error: "Auth event expired" });
    if (!event.pubkey || event.pubkey.length !== 64) return res.status(401).json({ error: "Invalid pubkey" });
    if (!verifyEvent(event)) return res.status(401).json({ error: "Invalid signature" });
    
    const token = createSessionToken(event.pubkey);
    console.log("[auth] Session created for", event.pubkey.substring(0, 8) + "...");
    res.json({ token, pubkey: event.pubkey, expiresIn: 1800 });
  } catch (err: any) {
    res.status(401).json({ error: "Auth failed: " + err.message });
  }
});

router.use(extractPubkey);
router.use(rateLimit);

// ── GET /health — Fedimint connectivity check ────────────────────────────

router.get("/health", async (_req: AuthenticatedRequest, res: Response) => {
  const fmAvailable = await FM.isClientdAvailable();
  const walletInfo = fmAvailable ? await FM.getWalletInfo() : null;
  res.json({
    server: "ok",
    fedimintClientd: fmAvailable ? "connected" : "unavailable",
    walletBalance: walletInfo?.totalAmountMsat || null,
    lockMode: fmAvailable ? "webln (fedimint-clientd)" : "manual (dev only)",
  });
});

// ── POST / — Create ──────────────────────────────────────────────────────

router.post("/", (req: AuthenticatedRequest, res: Response) => {
  try {
    const { amountMsats, description = "", terms = "", communityLink = "" } = req.body;
    const pk = req.pubkey!;

    if (!amountMsats || typeof amountMsats !== "number" || amountMsats <= 0)
      return res.status(400).json({ error: "amountMsats is required (positive integer)" });
    if (amountMsats < 1_000) return res.status(400).json({ error: "Minimum 1 sat (1,000,000 msats) for Lightning routing" });
    if (!terms || typeof terms !== "string" || terms.trim().length < 5)
      return res.status(400).json({ error: "Trade terms are required (minimum 5 characters)." });
    if (!communityLink || !isValidCommunityLink(communityLink))
      return res.status(400).json({ error: 'communityLink is required (format: "fedi:room:!roomId:federation.domain:::").' });

    const federationId = extractFederationId(communityLink);
    if (!federationId) return res.status(400).json({ error: "Could not extract federation ID from community link" });

    const id = DB.getNextId();
    const row = DB.createEscrow({ id, amountMsats, description, terms, communityLink, federationId, sellerPubkey: pk });

    res.status(201).json({
      id: row.id, status: row.status, amountMsats: row.amount_msats, amountSats: Math.floor(row.amount_msats / 1000),
      description: row.description, terms: row.terms, communityLink: row.community_link, federationId: row.federation_id,
      seller: { pubkey: truncPk(pk), npub: hexToNpub(pk) },
      createdAt: row.created_at, expiresIn: formatExpiry(row.expires_at), yourRole: "seller",
      nextStep: "Share the escrow ID in your Fedi community chat. Buyer and arbiter need to join.",
    });
  } catch (err: any) { console.error("POST / error:", err); res.status(500).json({ error: err.message }); }
});

// ── GET /arbiter-check ───────────────────────────────────────────────────
router.get("/arbiter-check", (req: AuthenticatedRequest, res: Response) => {
  const pk = req.pubkey!;
  res.json({
    allowed: isArbiterAllowed(pk) || !!req.headers["x-dev-pubkey"],
    mode: ALLOWED_ARBITERS ? "allowlist" : "open",
  });
});
// ── POST /:id/join ───────────────────────────────────────────────────────

router.post("/:id/join", (req: AuthenticatedRequest, res: Response) => {
  try {
    const row = DB.getEscrow(req.params.id);
    if (!row) return res.status(404).json({ error: "Escrow not found" });
    if (isExpired(row)) return res.status(400).json({ error: "This escrow has expired" });

    const pk = req.pubkey!;

// Sandbox isolation: prevent dev pubkeys from joining real trades and vice versa

    const sellerIsDev = isDevPubkey(row.seller_pubkey);
    const joinerIsDev = isDevPubkey(pk);
    if (sellerIsDev && !joinerIsDev) {
      return res.status(403).json({ error: "This is a sandbox trade." });
}
if (!sellerIsDev && joinerIsDev) {
  return res.status(403).json({ error: "Sandbox identities cannot join real trades." });
}

    const { role } = req.body;
    if (role !== "buyer" && role !== "arbiter") return res.status(400).json({ error: 'role must be "buyer" or "arbiter"' });
    const isDevRequest = !!req.headers["x-dev-pubkey"];
    if (role === "arbiter" && !isArbiterAllowed(pk) && !isDevRequest) {
      return res.status(403).json({ error: "Arbiter not authorized. Only pre-approved community arbiters can join trades." });
    }

    const existing = getRoleByPubkey(row, pk);
    if (existing) return res.status(400).json({ error: `You are already the ${existing} in this escrow` });
    if (role === "buyer" && row.buyer_pubkey) return res.status(400).json({ error: "Buyer slot is already filled" });
    if (role === "arbiter" && row.arbiter_pubkey) return res.status(400).json({ error: "Arbiter slot is already filled" });
    if (row.status !== "CREATED" && row.status !== "FUNDED") return res.status(400).json({ error: `Cannot join in ${row.status} state` });

    const willHaveBuyer = role === "buyer" ? pk : row.buyer_pubkey;
    const willHaveArbiter = role === "arbiter" ? pk : row.arbiter_pubkey;
    const newStatus = (row.seller_pubkey && willHaveBuyer && willHaveArbiter) ? "FUNDED" : row.status;

    if (role === "buyer") DB.joinAsBuyer(row.id, pk, newStatus);
    else DB.joinAsArbiter(row.id, pk, newStatus);

    const updated = DB.getEscrow(row.id)!;

    const otherPks = [updated.seller_pubkey, updated.buyer_pubkey, updated.arbiter_pubkey].filter(Boolean) as string[];
    if (updated.status === "FUNDED") {
      if (false && !isDevPubkey(updated.seller_pubkey)) matrixBot.notifyJoin({ id: updated.id, amountMsats: updated.amount_msats, description: updated.description, communityLink: updated.community_link, sellerPubkey: updated.seller_pubkey, buyerPubkey: updated.buyer_pubkey, arbiterPubkey: updated.arbiter_pubkey }, role);
      // Nostr DM: detailed private notification to other participants
      if (!isDevPubkey(updated.seller_pubkey)) {
        const otherPks = [updated.seller_pubkey, updated.buyer_pubkey, updated.arbiter_pubkey].filter(Boolean);
        Notify.notifyEscrowJoin(updated.id, pk, role, otherPks);
        if (updated.status === "FUNDED") {
          Notify.notifyEscrowFunded(updated.id, updated.seller_pubkey, updated.buyer_pubkey, updated.arbiter_pubkey, updated.amount_msats, updated.description);
        }
      }
    }

    res.json({
      id: updated.id, status: updated.status, yourRole: role,
      participants: { seller: truncPk(updated.seller_pubkey), buyer: updated.buyer_pubkey ? truncPk(updated.buyer_pubkey) : null, arbiter: updated.arbiter_pubkey ? truncPk(updated.arbiter_pubkey) : null },
      allJoined: updated.status === "FUNDED",
      message: updated.status === "FUNDED"
        ? "All parties have joined! Seller: tap Lock to pay the escrow invoice."
        : `Joined as ${role}. Waiting for ${!updated.buyer_pubkey ? "buyer" : ""}${!updated.buyer_pubkey && !updated.arbiter_pubkey ? " and " : ""}${!updated.arbiter_pubkey ? "arbiter" : ""} to join.`,
    });
  } catch (err: any) { console.error("POST /join error:", err); res.status(500).json({ error: err.message }); }
});

// ── GET / — List ─────────────────────────────────────────────────────────

router.get("/", (req: AuthenticatedRequest, res: Response) => {
  const pk = req.pubkey!;
  const rows = DB.listEscrowsByPubkey(pk);
  res.json(rows.map(r => ({
    id: r.id, status: r.status, amountMsats: r.amount_msats, amountSats: Math.floor(r.amount_msats / 1000),
    description: r.description, terms: r.terms, communityLink: r.community_link, federationId: r.federation_id,
    yourRole: getRoleByPubkey(r, pk),
    participants: { seller: truncPk(r.seller_pubkey), buyer: r.buyer_pubkey ? truncPk(r.buyer_pubkey) : null, arbiter: r.arbiter_pubkey ? truncPk(r.arbiter_pubkey) : null },
    resolvedOutcome: r.resolved_outcome, claimedBy: r.claimed_by, arbiterFeeMsats: r.arbiter_fee_msats || 0,
    createdAt: r.created_at, updatedAt: r.updated_at, expiresIn: formatExpiry(r.expires_at),
  })));
});

// ── GET /:id — Detail ────────────────────────────────────────────────────

router.get("/:id", (req: AuthenticatedRequest, res: Response) => {
  const row = DB.getEscrow(req.params.id);
  if (!row) return res.status(404).json({ error: "Escrow not found" });

  const pk = req.pubkey!;
  const role = getRoleByPubkey(row, pk);
  const votes = DB.getVotes(row.id);
  const tally = tallyVotes(votes);

  res.json({
    id: row.id, status: row.status, amountMsats: row.amount_msats, amountSats: Math.floor(row.amount_msats / 1000),
    description: row.description, terms: row.terms, communityLink: row.community_link, federationId: row.federation_id,
    participants: { seller: participantInfo(row.seller_pubkey), buyer: participantInfo(row.buyer_pubkey), arbiter: participantInfo(row.arbiter_pubkey) },
    lockedAt: row.locked_at, lockMode: row.lock_mode, lock_role: row.lock_role || "seller", seller_fed_prefix: row.seller_fed_prefix || null,
    loanParentId: row.loan_parent_id || null, loanRepaymentId: row.loan_repayment_id || null, loanStatus: row.loan_status || null, loanDueAt: row.loan_due_at || null, loanInterestBps: row.loan_interest_bps || 0,
    votes: { release: tally.releaseCount, refund: tally.refundCount, voters: votes.map(v => ({ role: v.role, outcome: v.outcome })) },
    resolvedOutcome: row.resolved_outcome, resolvedAt: row.resolved_at, claimedBy: row.claimed_by, claimedAt: row.claimed_at,
    createdAt: row.created_at, updatedAt: row.updated_at, expiresIn: formatExpiry(row.expires_at),
    ...(role && { yourRole: role }),
    ...(role && { canClaim: row.status === "APPROVED" && (() => {
      const lr = row.lock_role || "seller";
      const releaseWinner = lr === "seller" ? "buyer" : "seller";
      const refundWinner = lr;
      return (row.resolved_outcome === "release" && role === releaseWinner) || (row.resolved_outcome === "refund" && role === refundWinner);
    })() }),
    disputeStartedAt: row.dispute_started_at || null,
    arbiterFeeMsats: row.arbiter_fee_msats || 0,
    arbiterFeeSats: Math.floor((row.arbiter_fee_msats || 0) / 1000),
    arbiterRotations: row.arbiter_rotations || 0,
  });
});

// ── GET /:id/invoice — Generate BOLT-11 via fedimint-clientd ─────────────

router.get("/:id/invoice", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const row = DB.getEscrow(req.params.id);
    if (!row) return res.status(404).json({ error: "Escrow not found" });
    if (isExpired(row)) return res.status(400).json({ error: "This escrow has expired" });
    if (row.status !== "FUNDED") return res.status(400).json({ error: `Cannot generate invoice in ${row.status} state` });

    const pk = req.pubkey!;
    const lockRole2 = row.lock_role || "seller";
    if (getRoleByPubkey(row, pk) !== lockRole2) return res.status(403).json({ error: "Only the " + lockRole2 + " can request the lock invoice" });

    const fmAvailable = await FM.isClientdAvailable();
    if (!fmAvailable) {
      if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEV_PUBKEY !== "true") {
        return res.status(503).json({ error: "Fedimint payment service unavailable. Try again later." });
      }
      return res.json({
        escrowId: row.id, amountMsats: row.amount_msats, amountSats: Math.floor(row.amount_msats / 1000),
        invoice: null, mode: "manual",
        message: "fedimint-clientd not available. Use manual lock (POST /lock with notes).",
      });
    }

    const { invoice, operationId } = await FM.createLockInvoice(row.id, row.amount_msats);
    pendingInvoices.set(row.id, { invoice, operationId, createdAt: Date.now() });

    // ── AUTO-LOCK: Background listener ────────────────────────────────
    // If the seller pays the invoice but the frontend never calls POST /lock
    // (network glitch, app closed, etc.), this ensures the escrow still locks.
    // The POST /lock endpoint also locks, so we check status to avoid double-lock.
    FM.awaitLockPayment(operationId).then(({ paid }) => {
      if (!paid) {
        console.error(`⚠️ Auto-lock: payment NOT confirmed for ${row.id}`);
        return;
      }
      // Re-fetch to check if POST /lock already handled it
      const current = DB.getEscrow(row.id);
      if (!current || current.status !== "FUNDED") {
        console.log(`ℹ️ Auto-lock: ${row.id} already ${current?.status || "gone"}, skipping`);
        return;
      }
      const receipt = JSON.stringify({
        type: "webln_auto_receipt",
        escrowId: row.id,
        amountMsats: row.amount_msats,
        operationId,
        lockedAt: Date.now(),
        sellerPubkey: pk,
      });
      const shippingExpiry = /shipping|physical|ship/i.test(row.description || "") ? DB.EXPIRY_SHIPPING_MS : undefined;
      DB.lockNotes(row.id, receipt, "webln", operationId, shippingExpiry);
      pendingInvoices.delete(row.id);
      console.log(`🔒 Auto-lock: ${row.id} locked via background listener (frontend missed POST /lock)`);
    }).catch(err => {
      console.error(`⚠️ Auto-lock error for ${row.id}:`, err.message);
    });

    res.json({
      escrowId: row.id, amountMsats: row.amount_msats, amountSats: Math.floor(row.amount_msats / 1000),
      invoice, mode: "webln", expiresIn: formatExpiry(row.expires_at),
      instructions: "Pay this invoice in Fedi. The app will handle it automatically via WebLN.",
    });
  } catch (err: any) { console.error("GET /invoice error:", err); res.status(500).json({ error: err.message }); }
});

// ── POST /:id/lock ───────────────────────────────────────────────────────

// ── POST /:id/lock-ecash — Lock via e-cash notes (WASM wallet) ───────────
//
// The buyer/seller's browser WASM wallet calls mint.spendNotes() and sends
// the e-cash string here. Server validates the amount and stores the notes.
// On payout, the winner redeems the notes via mint.redeemEcash() in their browser.

router.post("/:id/lock-ecash", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const row = DB.getEscrow(req.params.id);
    if (!row) return res.status(404).json({ error: "Escrow not found" });
    if (isExpired(row)) return res.status(400).json({ error: "This escrow has expired" });

    const pk = req.pubkey!;
    const lockRole = row.lock_role || "seller";
    const callerRole = getRoleByPubkey(row, pk);
    console.log("[lock-ecash] escrow:", row.id, "caller:", pk.substring(0,8), "callerRole:", callerRole, "lockRole:", lockRole);
    if (callerRole !== lockRole) return res.status(403).json({ error: "Only the " + lockRole + " can lock sats in this escrow" });

    if (row.status !== "FUNDED") {
      if (row.status === "CREATED")
        return res.status(400).json({ error: "All parties must join before locking." });
      return res.status(400).json({ error: `Cannot lock in ${row.status} state` });
    }

    const { notes, lockerFederation } = req.body;
    if (!notes || typeof notes !== "string" || notes.length < 20)
      return res.status(400).json({ error: "Invalid e-cash notes" });
    
    // Store the locker's actual federation if provided
    if (lockerFederation && typeof lockerFederation === "string") {
      DB.updateFederationId(row.id, lockerFederation);
      console.log("[lock-ecash] Updated federation_id to", lockerFederation, "for", row.id);
    }

    // ── SHAMIR: Split notes into 2-of-3 shares ──
    const shippingExpiry = /shipping|physical|ship/i.test(row.description || "") ? DB.EXPIRY_SHIPPING_MS : undefined;
    const shares = await splitNotes(notes);

    // Encrypt each share to each participant's Nostr pubkey using NIP-44 on server
    // For now, store shares as base64 — client will retrieve and hold their share
    // Server stores encrypted shares only, never the full notes
    DB.lockNotesWithShamir(
      row.id,
      shares.seller_share,
      shares.buyer_share,
      shares.arbiter_share,
      "ecash",
      shippingExpiry
    );
    console.log("  🔑 Shamir: notes split into 3 shares (2-of-3 threshold) for", row.id);

    const updated = DB.getEscrow(row.id)!;

    // Notify parties
    if (!isDevPubkey(row.seller_pubkey)) {
      Notify.notifyEscrowLocked(row.id, row.seller_pubkey, row.buyer_pubkey, row.arbiter_pubkey, row.amount_msats, row.description || "");
    }

    // Matrix notification
    if (false && !isDevPubkey(row.seller_pubkey)) matrixBot.notifyLocked({ id: row.id, amountMsats: row.amount_msats, description: row.description, communityLink: row.community_link, sellerPubkey: row.seller_pubkey, buyerPubkey: row.buyer_pubkey, arbiterPubkey: row.arbiter_pubkey });

    console.log("  \u{1F512} E-cash lock: " + row.id + " — " + Math.floor(row.amount_msats / 1000) + " sats locked via browser WASM wallet");

    res.json({
      escrowId: row.id, status: updated.status,
      amountMsats: row.amount_msats, amountSats: Math.floor(row.amount_msats / 1000),
      mode: "ecash",
      message: "E-cash notes locked in escrow!",
    });
  } catch (err: any) {
    console.error("[ecash-escrow] POST /:id/lock-ecash error:", err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/:id/lock", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const row = DB.getEscrow(req.params.id);
    if (!row) return res.status(404).json({ error: "Escrow not found" });
    if (isExpired(row)) return res.status(400).json({ error: "This escrow has expired" });

    const pk = req.pubkey!;
    const lockRoleM = row.lock_role || "seller";
    if (getRoleByPubkey(row, pk) !== lockRoleM) return res.status(403).json({ error: "Only the " + lockRoleM + " can lock sats" });

    if (row.status !== "FUNDED") {
      if (row.status === "CREATED")
        return res.status(400).json({ error: `All three parties must join before locking. Missing: ${!row.buyer_pubkey ? "buyer " : ""}${!row.arbiter_pubkey ? "arbiter" : ""}`.trim() });
      return res.status(400).json({ error: `Cannot lock notes in ${row.status} state` });
    }

    const mode = req.body.mode || "manual";

    if (mode === "webln") {
      const pending = pendingInvoices.get(row.id);
      if (!pending) {
        return res.status(400).json({ error: "No pending invoice. Call GET /:id/invoice first, then pay it via WebLN." });
      }

      // Don't block on await-invoice — WebLN sendPayment() already succeeded
      // on the client, so the payment is in-flight. Confirm lock immediately
      // and verify receipt in the background.
      FM.awaitLockPayment(pending.operationId).then(({ paid }) => {
        if (paid) {
          console.log(`✅ Lock payment confirmed for ${row.id}`);
        } else {
          console.error(`⚠️ Lock payment NOT confirmed for ${row.id} — may need manual recovery`);
        }
      }).catch(err => {
        console.error(`⚠️ await-invoice error for ${row.id}:`, err.message);
      });

      const receipt = JSON.stringify({
        type: "webln_receipt",
        escrowId: row.id,
        amountMsats: row.amount_msats,
        operationId: pending.operationId,
        lockedAt: Date.now(),
        sellerPubkey: pk,
      });

      const shippingExpiry2 = /shipping|physical|ship/i.test(row.description || "") ? DB.EXPIRY_SHIPPING_MS : undefined;
      DB.lockNotes(row.id, receipt, "webln", pending.operationId, shippingExpiry2);
      pendingInvoices.delete(row.id);

    } else {
      const { notes } = req.body;
      if (!notes || typeof notes !== "string" || notes.length < 10)
        return res.status(400).json({ error: "Invalid e-cash notes string (minimum 10 chars)" });

      if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEV_PUBKEY !== "true")
        return res.status(400).json({ error: "Manual note locking is disabled in production. Use WebLN mode." });

      const shippingExpiry3 = /shipping|physical|ship/i.test(row.description || "") ? DB.EXPIRY_SHIPPING_MS : undefined;
      DB.lockNotes(row.id, notes, "manual", undefined, shippingExpiry3);
    }

    const updated = DB.getEscrow(row.id)!;

    if (updated.buyer_pubkey && updated.arbiter_pubkey) {
      if (false && !isDevPubkey(updated.seller_pubkey)) matrixBot.notifyLocked({ id: updated.id, amountMsats: updated.amount_msats, description: updated.description, communityLink: updated.community_link, sellerPubkey: updated.seller_pubkey, buyerPubkey: updated.buyer_pubkey, arbiterPubkey: updated.arbiter_pubkey });
      // Nostr DM: notify buyer + arbiter that sats are locked
      if (!isDevPubkey(updated.seller_pubkey)) {
        Notify.notifyEscrowLocked(updated.id, updated.seller_pubkey, updated.buyer_pubkey, updated.arbiter_pubkey, updated.amount_msats, updated.description);
      }
    }

    res.json({
      id: updated.id, status: updated.status, lockedAt: updated.locked_at,
      lockMode: updated.lock_mode, amountMsats: updated.amount_msats,
      expiresIn: formatExpiry(updated.expires_at),
      message: "E-cash locked in escrow. Buyer: complete your side of the trade, then vote to release.",
    });
  } catch (err: any) { console.error("POST /lock error:", err); res.status(500).json({ error: err.message }); }
});

// ── GET /:id/my-share — Retrieve your Shamir share ───────────────────────
router.get("/:id/my-share", (req: AuthenticatedRequest, res: Response) => {
  try {
    const row = DB.getEscrow(req.params.id);
    if (!row) return res.status(404).json({ error: "Escrow not found" });
    const pk = req.pubkey!;
    const role = getRoleByPubkey(row, pk);
    if (!role) return res.status(403).json({ error: "Not a participant" });
    
    const share = DB.getEncryptedShare(row.id, role);
    if (!share) return res.status(404).json({ error: "No share available — escrow may not be locked yet" });
    
    res.json({ share, role, escrowId: row.id });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /:id/approve ────────────────────────────────────────────────────

router.post("/:id/approve", (req: AuthenticatedRequest, res: Response) => {
  console.log("[approve] HIT — escrow:", req.params.id, "pubkey:", req.pubkey, "auth:", req.headers.authorization?.substring(0, 30));
  try {
    const row = DB.getEscrow(req.params.id);
    if (!row) return res.status(404).json({ error: "Escrow not found" });
    if (isExpired(row)) return res.status(400).json({ error: "This escrow has expired" });
    if (row.status !== "LOCKED") return res.status(400).json({ error: `Cannot vote in ${row.status} state` });

    const pk = req.pubkey!;
    const role = getRoleByPubkey(row, pk);
    if (!role) return res.status(403).json({ error: "You are not a participant in this escrow" });

    const { outcome } = req.body;
    if (outcome !== "release" && outcome !== "refund") return res.status(400).json({ error: 'outcome must be "release" or "refund"' });

    const votes = DB.getVotes(row.id);
    const existingVote = votes.find(v => v.role === role);
    if (existingVote) return res.status(400).json({ error: `${role} has already voted (${existingVote.outcome})` });

    const buyerVote = votes.find(v => v.role === "buyer");
    const sellerVote = votes.find(v => v.role === "seller");

    if (role === "buyer" && outcome !== "release")
      return res.status(400).json({ error: 'Buyer can only vote "release".' });
    // Marketplace: seller votes first (confirms shipment). P2P/Lending: buyer votes first.
    const isMarketplaceTrade = (row.description || "").startsWith("Marketplace");
    if (role === "seller" && !buyerVote && !isMarketplaceTrade)
      return res.status(403).json({ error: "Buyer must vote first." });
    if (role === "buyer" && !sellerVote && isMarketplaceTrade)
      return res.status(403).json({ error: "Seller must confirm shipment first." });
    if (role === "arbiter") {
      if (!buyerVote || !sellerVote)
        return res.status(403).json({ error: `Arbiter can only vote after both buyer and seller. Buyer ${buyerVote ? "voted" : "pending"}, seller ${sellerVote ? "voted" : "pending"}.` });
      if (buyerVote.outcome === sellerVote.outcome)
        return res.status(400).json({ error: "Buyer and seller agree — no dispute to arbitrate." });
    }

    // Store decrypted Shamir share if provided
    const { share } = req.body;
    if (share && typeof share === "string" && share.length > 10) {
      DB.storeDecryptedShare(row.id, role, share);
      console.log("  🔑 Shamir share received from", role, "for", row.id);
    }
    
    DB.addVote(row.id, role, outcome, pk);
    const updatedVotes = DB.getVotes(row.id);
    const tally = tallyVotes(updatedVotes);

    // Detect dispute: both voted but disagree → start arbiter timer + set fee
    if (!tally.outcome && updatedVotes.length >= 2) {
      const bv = updatedVotes.find(v => v.role === "buyer");
      const sv = updatedVotes.find(v => v.role === "seller");
      if (bv && sv && bv.outcome !== sv.outcome && !row.dispute_started_at) {
        DB.startDispute(row.id);
        // 1% arbiter fee
        const feeMsats = Math.floor(row.amount_msats * 0.01);
        DB.setArbiterFee(row.id, feeMsats);
        console.log(`  ⚖️ Dispute started: ${row.id} — arbiter has 4h to vote (fee: ${feeMsats} msats)`);
        // Notify arbiter urgently
        if (!isDevPubkey(row.seller_pubkey) && row.arbiter_pubkey) {
          Notify.notifyArbiterDispute(row.id, row.arbiter_pubkey, row.amount_msats, row.description || "", row.community_link || "", row.seller_pubkey, row.buyer_pubkey);
        }
      }
    }

    if (tally.outcome) DB.resolveEscrow(row.id, tally.outcome);

    const allPks = [row.seller_pubkey, row.buyer_pubkey, row.arbiter_pubkey].filter(Boolean) as string[];
    if (tally.outcome) {
      const isDispute = updatedVotes.some(v => v.role === "arbiter"); if (isDispute && !isDevPubkey(row.seller_pubkey)) matrixBot.notifyResolved({ id: row.id, amountMsats: row.amount_msats, description: row.description, communityLink: row.community_link, sellerPubkey: row.seller_pubkey, buyerPubkey: row.buyer_pubkey, arbiterPubkey: row.arbiter_pubkey }, tally.outcome);
      // Nostr DM: detailed resolution notification to all participants
      if (!isDevPubkey(row.seller_pubkey)) {
        const voterPks = [row.seller_pubkey, row.buyer_pubkey, row.arbiter_pubkey].filter(Boolean);
        Notify.notifyEscrowVote(row.id, pk, role, voterPks);
        if (tally.outcome) {
          Notify.notifyEscrowResolved(row.id, tally.outcome, row.seller_pubkey, row.buyer_pubkey, row.arbiter_pubkey, row.amount_msats);
        }
      }
    }

    const lr = row.lock_role || "seller";
    const winner = tally.outcome === "release" ? (lr === "seller" ? "buyer" : "seller") : tally.outcome === "refund" ? lr : null;

    res.json({
      id: row.id, status: tally.outcome ? "APPROVED" : "LOCKED", yourRole: role, yourVote: outcome,
      votes: { release: tally.releaseCount, refund: tally.refundCount, voters: updatedVotes.map(v => ({ role: v.role, outcome: v.outcome })) },
      resolved: !!tally.outcome, resolvedOutcome: tally.outcome, winner,
      message: tally.outcome
        ? `Escrow resolved: ${tally.outcome} to ${winner}. ${winner} can now claim.`
        : `Vote recorded. ${tally.releaseCount} for release, ${tally.refundCount} for refund. Need 2-of-3.`,
    });
  } catch (err: any) { console.error("POST /approve error:", err); res.status(500).json({ error: err.message }); }
});

// ── POST /:id/claim ──────────────────────────────────────────────────────

router.post("/:id/claim", (req: AuthenticatedRequest, res: Response) => {
  try {
    const row = DB.getEscrow(req.params.id);
    if (!row) return res.status(404).json({ error: "Escrow not found" });

    // Expired + locked → seller reclaims
    if (row.status === "EXPIRED" && row.locked_notes) {
      const pk = req.pubkey!;
      if (getRoleByPubkey(row, pk) !== "seller")
        return res.status(403).json({ error: "Only the locking party can reclaim from an expired escrow" });

      const notes = DB.claimEscrow(row.id, "seller");
      if (!notes) return res.status(500).json({ error: "No notes found" });

      let isWebln = false;
      try { isWebln = JSON.parse(notes).type === "webln_receipt"; } catch {}

      if (isWebln) {
        return res.json({
          id: row.id, status: "CLAIMED", claimedBy: "seller",
          payoutReady: true, amountMsats: row.amount_msats, amountSats: Math.floor(row.amount_msats / 1000),
          message: "Escrow expired. Tap Receive to get your sats back.",
          nextStep: "POST /:id/payout with your invoice",
        });
      }
      return res.json({ id: row.id, status: "CLAIMED", claimedBy: "seller", notes, message: "Escrow expired — notes returned." });
    }

    if (row.status !== "APPROVED") return res.status(400).json({ error: `Cannot claim in ${row.status} state` });

    const pk = req.pubkey!;
    const role = getRoleByPubkey(row, pk);
    if (!role) return res.status(403).json({ error: "You are not a participant in this escrow" });

    const lr3 = row.lock_role || "seller";
    const winner = row.resolved_outcome === "release" ? (lr3 === "seller" ? "buyer" : "seller") : lr3;
    if (role !== winner) return res.status(403).json({ error: `Only the ${winner} can claim. Escrow resolved as "${row.resolved_outcome}".` });

    // For Shamir escrows, claim just marks status — notes reconstructed at ecash-payout
    if (row.locked_notes === "SHAMIR") {
      DB.claimEscrowShamir(row.id, role);
      return res.json({
        id: row.id, status: "CLAIMED", claimedBy: role,
        payoutReady: false, // Notes come from /ecash-payout via Shamir reconstruction
        lockMode: "ecash",
        amountMsats: row.arbiter_fee_msats ? row.amount_msats - row.arbiter_fee_msats : row.amount_msats,
        amountSats: Math.floor((row.arbiter_fee_msats ? row.amount_msats - row.arbiter_fee_msats : row.amount_msats) / 1000),
        message: "Claimed! Tap Receive to get your e-cash.",
      });
    }

    const notes = DB.claimEscrow(row.id, role);
    if (!notes) return res.status(500).json({ error: "No notes found in escrow" });

    let isWebln = false;
    try { isWebln = JSON.parse(notes).type === "webln_receipt"; } catch {}

    if (isWebln) {
      return res.json({
        id: row.id, status: "CLAIMED", claimedBy: role,
        payoutReady: true,
        amountMsats: row.arbiter_fee_msats ? row.amount_msats - row.arbiter_fee_msats : row.amount_msats,
        amountSats: Math.floor((row.arbiter_fee_msats ? row.amount_msats - row.arbiter_fee_msats : row.amount_msats) / 1000),
        arbiterFeeMsats: row.arbiter_fee_msats || 0,
        arbiterFeeSats: Math.floor((row.arbiter_fee_msats || 0) / 1000),
        message: row.arbiter_fee_msats
          ? `Escrow resolved! ${Math.floor((row.arbiter_fee_msats || 0) / 1000)} sats arbiter fee deducted. Tap Receive for your payout.`
          : "Escrow resolved in your favor! Tap Receive to generate an invoice — server pays you immediately.",
        nextStep: "POST /:id/payout with { invoice: '<BOLT-11>' }",
      });
    }

    res.json({ id: row.id, status: "CLAIMED", claimedBy: role, notes, message: "E-cash notes claimed." });
  } catch (err: any) { console.error("POST /claim error:", err); res.status(500).json({ error: err.message }); }
});

// ── GET /:id/ecash-payout — Retrieve e-cash notes for the winner ─────────
//
// If the escrow was locked with e-cash notes (mode: "ecash"), the winner
// retrieves the notes string here and redeems them in their browser WASM wallet
// via mint.redeemEcash(notes). Instant, zero Lightning routing.

router.get("/:id/ecash-payout", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const row = DB.getEscrow(req.params.id);
    if (!row) return res.status(404).json({ error: "Escrow not found" });

    if (row.status !== "CLAIMED" && row.status !== "COMPLETED")
      return res.status(400).json({ error: "Escrow not yet resolved" });

    // Check if this was an e-cash lock
    if (row.lock_mode !== "ecash")
      return res.json({ mode: "lightning", message: "This escrow uses Lightning payout, not e-cash." });

    const pk = req.pubkey!;
    const role = getRoleByPubkey(row, pk);
    const lr4 = row.lock_role || "seller";
    const expectedWinner = row.resolved_outcome === "release" ? (lr4 === "seller" ? "buyer" : "seller") : lr4;

    if (role !== expectedWinner)
      return res.status(403).json({ error: "Only the winning party can retrieve e-cash notes" });

    // Reconstruct e-cash notes from Shamir shares
    if (!row.locked_notes) return res.status(400).json({ error: "E-cash notes already retrieved and confirmed. If you didn't receive them, contact the arbiter." });
    
    let notes: string;
    if (row.locked_notes === "SHAMIR") {
      // Reconstruct from 2 decrypted shares submitted during voting
      const shares = DB.getShamirShares(row.id);
      const availableShares: string[] = [];
      if (shares.share_seller) availableShares.push(shares.share_seller);
      if (shares.share_buyer) availableShares.push(shares.share_buyer);
      // Also check if arbiter submitted a share (dispute case)
      // Arbiter share comes through vote too
      
      if (availableShares.length < 2) {
        return res.status(400).json({ error: "Not enough Shamir shares to reconstruct. Need 2 votes with shares." });
      }
      
      try {
        notes = await combineShares(availableShares[0], availableShares[1]);
        if (!validateReconstructedNotes(notes)) {
          return res.status(500).json({ error: "Shamir reconstruction failed — notes invalid" });
        }
        console.log("[ecash-payout] 🔑 Shamir: reconstructed notes for", row.id, "length:", notes.length);
      } catch (shamirErr: any) {
        console.error("[ecash-payout] Shamir combine failed:", shamirErr);
        return res.status(500).json({ error: "Failed to reconstruct e-cash notes from shares" });
      }
    } else {
      // Legacy: direct encrypted notes (pre-Shamir escrows)
      notes = DB.decryptNotes(row.locked_notes);
    }
    
    // ── FEE COLLECTION ──────────────────────────────────────────────
    let finalNotes = notes;
    let feeMsats = 0;
    
    if (PLATFORM_FEE_BPS > 0) {
      // Determine federation from the note prefix
      const fedPrefix = notes.substring(0, 10);
      const feeResult = await collectFee(notes, row.amount_msats, row.id, fedPrefix);
      if (feeResult) {
        finalNotes = feeResult.winnerNotes;
        feeMsats = feeResult.feeMsats;
      }
    }
    
    const winnerAmountMsats = row.amount_msats - feeMsats;

    // DON'T complete here — wait for confirm-ecash-received

    res.json({
      escrowId: row.id, mode: "ecash",
      notes: finalNotes,
      amountMsats: winnerAmountMsats, amountSats: Math.floor(winnerAmountMsats / 1000),
      originalAmountMsats: row.amount_msats,
      platformFeeMsats: feeMsats,
      platformFeeBps: PLATFORM_FEE_BPS,
      message: feeMsats > 0
        ? "Platform fee of " + Math.floor(feeMsats / 1000) + " sats (" + (PLATFORM_FEE_BPS / 100) + "%) deducted. Redeem your " + Math.floor(winnerAmountMsats / 1000) + " sats."
        : "Redeem these notes in your wallet using mint.redeemEcash()",
    });
  } catch (err: any) {
    console.error("[ecash-escrow] GET /:id/ecash-payout error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /:id/confirm-ecash-received — Winner confirms successful redemption ──
router.post("/:id/confirm-ecash-received", (req: AuthenticatedRequest, res: Response) => {
  try {
    const row = DB.getEscrow(req.params.id);
    if (!row) return res.status(404).json({ error: "Escrow not found" });
    if (row.lock_mode !== "ecash") return res.status(400).json({ error: "Not an e-cash escrow" });
    if (row.status !== "CLAIMED") return res.status(400).json({ error: "Escrow status is " + row.status + ", expected CLAIMED" });

    const pk = req.pubkey!;
    const role = getRoleByPubkey(row, pk);
    const lr5 = row.lock_role || "seller";
    const expectedWinner = row.resolved_outcome === "release" ? (lr5 === "seller" ? "buyer" : "seller") : lr5;
    if (role !== expectedWinner)
      return res.status(403).json({ error: "Only the winning party can confirm receipt" });

    // Now safe to complete and wipe notes
    DB.completeEscrow(row.id);
    // Wipe the encrypted notes from DB
    try { db.prepare("UPDATE escrows SET locked_notes = NULL WHERE id = ?").run(row.id); } catch(e) {}


    // ── Auto-create repayment escrow for lending trades ──
    let autoRepaymentId = null;
    if ((row.description || "").startsWith("Lending:") && !row.loan_repayment_id) {
      try {
        const order = db.prepare("SELECT * FROM orders WHERE escrow_id = ?").get(row.id) as any;
        const listing = order ? db.prepare("SELECT * FROM listings WHERE id = ?").get(order.listing_id) as any : null;
        if (order && listing) {
          const terms = listing.terms || "";
          const intMatch = terms.match(/Interest:\s*(\d+)/);
          const repMatch = terms.match(/Repayment:\s*(\d+)\s*days?/i) || terms.match(/(\d+)\s*day/i);
          const intBps = intMatch ? parseInt(intMatch[1]) * 100 : 0;
          const repDays = repMatch ? parseInt(repMatch[1]) : 14;
          const principalMs = order.amount_msats;
          const interestMs = Math.floor(principalMs * intBps / 10000);
          const repayMs = principalMs + interestMs;
          const repMethodMatch = terms.match(/Repayment method:\s*(.+)/i);
          const isFiat = repMethodMatch ? repMethodMatch[1].trim().toLowerCase() === "fiat" : false;
          const finalMs = isFiat ? 0 : repayMs;
          const dueAt = new Date(Date.now() + repDays * 24 * 60 * 60 * 1000).toISOString();
          const maxId = db.prepare("SELECT MAX(CAST(SUBSTR(id, 7) AS INTEGER)) as m FROM escrows").get() as any;
          const repId = "ecash_" + ((maxId?.m || 0) + 1);
          const now2 = new Date().toISOString();
          db.prepare("INSERT INTO escrows (id, status, created_at, updated_at, amount_msats, description, terms, community_link, federation_id, seller_pubkey, buyer_pubkey, arbiter_pubkey, lock_role, loan_parent_id, loan_status, loan_due_at, loan_interest_bps, seller_fed_prefix) VALUES (?, 'FUNDED', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'buyer', ?, 'active', ?, ?, ?)").run(
            repId, now2, now2, finalMs,
            isFiat ? "Loan Repayment (Fiat): " + listing.title : "Loan Repayment: " + listing.title,
            "Repayment of " + Math.floor(principalMs/1000) + " + " + Math.floor(interestMs/1000) + " interest. Due: " + new Date(dueAt).toLocaleDateString(),
            listing.community_link || "", listing.seller_fed_domain || "",
            order.seller_pubkey, order.buyer_pubkey, order.arbiter_pubkey,
            row.id, dueAt, intBps, listing.seller_fed_prefix || null
          );
          db.prepare("UPDATE escrows SET loan_repayment_id = ?, loan_status = 'disbursed' WHERE id = ?").run(repId, row.id);
          const repOrdId = "ord_" + Date.now().toString(36) + Math.random().toString(36).slice(2,6);
          db.prepare("INSERT INTO orders (id, listing_id, escrow_id, buyer_pubkey, seller_pubkey, arbiter_pubkey, amount_msats, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', datetime('now'), datetime('now'))").run(
            repOrdId, order.listing_id, repId, order.buyer_pubkey, order.seller_pubkey, order.arbiter_pubkey, repayMs
          );
          autoRepaymentId = repId;
          console.log("[lending] Auto-created repayment escrow:", repId, "for loan", row.id);
        }
      } catch (autoErr: any) { console.error("[lending] Auto-repayment creation failed:", autoErr.message); }
    }
    console.log("[ecash-escrow] E-cash confirmed received for", row.id, "by", role);
    res.json({ success: true, escrowId: row.id, status: "COMPLETED", autoRepaymentId });
  } catch (err: any) {
    console.error("[ecash-escrow] POST /:id/confirm-ecash-received error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /:id/payout — Pay the winner via LN ────────────────────────────
//
// Winner calls webln.makeInvoice({ amount }) in Fedi to generate a receive
// invoice, then the app submits it here. Server pays via fedimint-clientd.

const inFlightPayouts = new Set<string>();

router.post("/:id/payout", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const row = DB.getEscrow(req.params.id);
    if (!row) return res.status(404).json({ error: "Escrow not found" });

    // Block duplicates
    // REPLACE with:
    if (row.status === "COMPLETED") {
	  return res.json({
	    id: row.id, status: "COMPLETED",
	    amountMsats: row.amount_msats, amountSats: Math.floor(row.amount_msats / 1000),
	    message: "Already paid — check your Fedi wallet balance.",
	  });
	}
    // E-cash escrows must use the e-cash payout path, not Lightning
    if (row.lock_mode === "ecash" && !(req.body.type === "arbiter_fee")) {
      return res.status(400).json({ error: "This is an e-cash escrow. Use the e-cash claim button — no Lightning invoice needed." });
    }
    if (inFlightPayouts.has(row.id)) {
      return res.status(409).json({ error: "Payout already in progress. Check your wallet." });
    }
    if (row.status !== "CLAIMED" && !(role === "arbiter" && req.body.type === "arbiter_fee" && (row.status === "CLAIMED" || row.status === "COMPLETED"))) {
      return res.status(400).json({ error: `Cannot payout in ${row.status} state` });
    }

    const pk = req.pubkey!;
    const role = getRoleByPubkey(row, pk);
    const isArbiterFeeClaim = role === "arbiter" && req.body.type === "arbiter_fee";
    const lrP = row.lock_role || "seller";
    const expectedWinner = row.resolved_outcome === "release" ? (lrP === "seller" ? "buyer" : "seller") : lrP;

    if (isArbiterFeeClaim) {
      // Arbiter claiming their dispute fee
      if (!row.arbiter_fee_msats || row.arbiter_fee_msats <= 0) {
        return res.status(400).json({ error: "No arbiter fee on this escrow (happy path trade)." });
      }
      // Check if already claimed (use a simple flag — fee set to negative after claim)
      if (row.arbiter_fee_msats < 0) {
        return res.json({ id: row.id, status: "COMPLETED", message: "Arbiter fee already claimed." });
      }
    } else if (role !== expectedWinner && !(row.resolved_outcome === "refund" && role === "seller")) {
      return res.status(403).json({ error: "Only the winning party can request payout" });
    }

    // Sandbox mode: skip real Lightning payout, just mark complete

    const { invoice } = req.body;
    if (process.env.ALLOW_DEV_PUBKEY === "true" && invoice && !invoice.startsWith("ln")) {
      DB.completeEscrow(row.id);
      return res.json({
        id: row.id, status: "COMPLETED",
        amountMsats: row.amount_msats, amountSats: Math.floor(row.amount_msats / 1000),
        message: "🧪 Sandbox payout complete!",
      });
    }
    if (!invoice || typeof invoice !== "string" || !invoice.startsWith("ln")) {
      return res.status(400).json({ error: "A valid BOLT-11 invoice is required. In Fedi, the app generates this automatically." });
    }

    if (!invoice || typeof invoice !== "string" || !invoice.startsWith("ln")) {
      return res.status(400).json({ error: "A valid BOLT-11 invoice is required. In Fedi, the app generates this automatically." });
    }

    const fmAvailable = await FM.isClientdAvailable();
    if (!fmAvailable) {
      return res.status(503).json({ error: "Fedimint payment service unavailable. Try again later." });
    }

    // Determine payout amount (arbiter fee or full escrow amount)
    const payoutAmountMsats = isArbiterFeeClaim ? row.arbiter_fee_msats : (row.arbiter_fee_msats ? row.amount_msats - row.arbiter_fee_msats : row.amount_msats);

    // Mark in-flight BEFORE paying to prevent double-spend
    inFlightPayouts.add(row.id);

    // ── BOLT-11 invoice amount validation ──────────────────────────────
    // Decode amount from BOLT-11 human-readable part to prevent mismatched invoices
    const bolt11AmountMsats = (() => {
      try {
        // BOLT-11 format: ln[bc|tb|...][amount][multiplier]1[data]
        const lower = invoice.toLowerCase();
        const match = lower.match(/^ln\w+?(\d+)([munp])1/);
        if (!match) return null; // no amount encoded (zero-amount invoice)
        const num = parseInt(match[1]);
        const multiplier: Record<string, number> = { m: 100_000_000, u: 100_000, n: 100, p: 0.1 };
        return Math.round(num * (multiplier[match[2]] || 0));
      } catch { return null; }
    })();

    if (bolt11AmountMsats !== null && bolt11AmountMsats !== payoutAmountMsats) {
      inFlightPayouts.delete(row.id);
      const expectedSats = Math.floor(payoutAmountMsats / 1000);
      const invoiceSats = Math.floor(bolt11AmountMsats / 1000);
      return res.status(400).json({
        error: `Invoice amount mismatch: invoice is for ${invoiceSats} sats but payout is ${expectedSats} sats. Create a new invoice for the correct amount.`
      });
    }

    const payment = await FM.payoutToWinner(invoice);
    if (!payment.success) {
      inFlightPayouts.delete(row.id);
      return res.status(500).json({ error: `Payout failed: ${payment.error}` });
    }

    // Mark COMPLETED (or mark fee claimed for arbiter)
    if (isArbiterFeeClaim) {
      // Mark fee as claimed by setting to negative
      DB.setArbiterFee(row.id, -Math.abs(row.arbiter_fee_msats));
      console.log("  " + String.fromCodePoint(0x1F4B0) + " Arbiter fee paid for " + row.id + ": " + row.arbiter_fee_msats + " msats");
    } else {
      DB.completeEscrow(row.id);
    }

    // Arbiter fee: log if dispute occurred
    if (row.arbiter_fee_msats && row.arbiter_fee_msats > 0) {
      console.log(`  💰 Arbiter fee for ${row.id}: ${row.arbiter_fee_msats} msats (${Math.floor(row.arbiter_fee_msats / 1000)} sats)`);
    }

    // Nostr DM: payout complete
    if (!isDevPubkey(row.seller_pubkey)) {
      const lrN = row.lock_role || "seller";
      const winnerPk = row.resolved_outcome === "release" ? (lrN === "seller" ? row.buyer_pubkey : row.seller_pubkey) : (lrN === "seller" ? row.seller_pubkey : row.buyer_pubkey);
      Notify.notifyEscrowCompleted(row.id, winnerPk, row.amount_msats);
    }


    // Confirm in background
    FM.awaitPayout(payment.operationId!).then(result => {
      inFlightPayouts.delete(row.id);
      if (result.success) {
        console.log(`✅ Payout confirmed for ${row.id}, preimage: ${result.preimage}`);
      } else {
        console.error(`⚠️ Payout await failed for ${row.id} — payment may still settle`);
      }
    }).catch(err => {
      inFlightPayouts.delete(row.id);
      console.error(`⚠️ await-ln-pay error for ${row.id}:`, err.message);
    });

    res.json({
      id: row.id, status: "COMPLETED",
      amountMsats: row.amount_msats, amountSats: Math.floor(row.amount_msats / 1000),
      operationId: payment.operationId,
      message: "Payout sent! Sats are on the way to your Fedi wallet.",
    });
  } catch (err: any) { console.error("POST /payout error:", err); res.status(500).json({ error: err.message }); }
});

export { validateSessionToken };
export default router;
