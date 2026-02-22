// src/routes/ecash-escrow.ts — v5.0 with fedimint-clientd integration
//
// Lock flow:  GET /invoice → seller pays via WebLN → POST /lock (confirms)
// Claim flow: POST /claim → POST /payout (winner submits invoice, server pays)
// Manual fallback for dev testing (NODE_ENV !== 'production')

import { Router, Request, Response, NextFunction } from "express";
import { verifyEvent } from "nostr-tools/pure";
import * as DB from "../db";
import * as FM from "../fedimint";

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

function extractPubkey(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  DB.processExpiredEscrows();

  const authHeader = req.headers.authorization;

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
  if (devPubkey && process.env.NODE_ENV !== "production") {
    if (typeof devPubkey === "string" && devPubkey.length === 64) {
      req.pubkey = devPubkey;
      return next();
    }
    return res.status(401).json({ error: "Invalid dev pubkey (must be 64 hex chars)" });
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

// ── POST /:id/join ───────────────────────────────────────────────────────

router.post("/:id/join", (req: AuthenticatedRequest, res: Response) => {
  try {
    const row = DB.getEscrow(req.params.id);
    if (!row) return res.status(404).json({ error: "Escrow not found" });
    if (isExpired(row)) return res.status(400).json({ error: "This escrow has expired" });

    const pk = req.pubkey!;
    const { role } = req.body;
    if (role !== "buyer" && role !== "arbiter") return res.status(400).json({ error: 'role must be "buyer" or "arbiter"' });

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
    resolvedOutcome: r.resolved_outcome, claimedBy: r.claimed_by,
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
    lockedAt: row.locked_at, lockMode: row.lock_mode,
    votes: { release: tally.releaseCount, refund: tally.refundCount, voters: votes.map(v => ({ role: v.role, outcome: v.outcome })) },
    resolvedOutcome: row.resolved_outcome, resolvedAt: row.resolved_at, claimedBy: row.claimed_by, claimedAt: row.claimed_at,
    createdAt: row.created_at, updatedAt: row.updated_at, expiresIn: formatExpiry(row.expires_at),
    ...(role && { yourRole: role }),
    ...(role && { canClaim: row.status === "APPROVED" && ((row.resolved_outcome === "release" && role === "buyer") || (row.resolved_outcome === "refund" && role === "seller")) }),
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
    if (getRoleByPubkey(row, pk) !== "seller") return res.status(403).json({ error: "Only the seller can request the lock invoice" });

    const fmAvailable = await FM.isClientdAvailable();
    if (!fmAvailable) {
      if (process.env.NODE_ENV === "production") {
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

    res.json({
      escrowId: row.id, amountMsats: row.amount_msats, amountSats: Math.floor(row.amount_msats / 1000),
      invoice, mode: "webln", expiresIn: formatExpiry(row.expires_at),
      instructions: "Pay this invoice in Fedi. The app will handle it automatically via WebLN.",
    });
  } catch (err: any) { console.error("GET /invoice error:", err); res.status(500).json({ error: err.message }); }
});

// ── POST /:id/lock ───────────────────────────────────────────────────────

router.post("/:id/lock", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const row = DB.getEscrow(req.params.id);
    if (!row) return res.status(404).json({ error: "Escrow not found" });
    if (isExpired(row)) return res.status(400).json({ error: "This escrow has expired" });

    const pk = req.pubkey!;
    if (getRoleByPubkey(row, pk) !== "seller") return res.status(403).json({ error: "Only the seller can lock notes" });

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

      DB.lockNotes(row.id, receipt, "webln", pending.operationId);
      pendingInvoices.delete(row.id);

    } else {
      const { notes } = req.body;
      if (!notes || typeof notes !== "string" || notes.length < 10)
        return res.status(400).json({ error: "Invalid e-cash notes string (minimum 10 chars)" });

      if (process.env.NODE_ENV === "production")
        return res.status(400).json({ error: "Manual note locking is disabled in production. Use WebLN mode." });

      DB.lockNotes(row.id, notes, "manual");
    }

    const updated = DB.getEscrow(row.id)!;
    res.json({
      id: updated.id, status: updated.status, lockedAt: updated.locked_at,
      lockMode: updated.lock_mode, amountMsats: updated.amount_msats,
      expiresIn: formatExpiry(updated.expires_at),
      message: "E-cash locked in escrow. Buyer: complete your side of the trade, then vote to release.",
    });
  } catch (err: any) { console.error("POST /lock error:", err); res.status(500).json({ error: err.message }); }
});

// ── POST /:id/approve ────────────────────────────────────────────────────

router.post("/:id/approve", (req: AuthenticatedRequest, res: Response) => {
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
    if (role === "seller" && !buyerVote)
      return res.status(403).json({ error: "Buyer must vote first." });
    if (role === "arbiter") {
      if (!buyerVote || !sellerVote)
        return res.status(403).json({ error: `Arbiter can only vote after both buyer and seller. Buyer ${buyerVote ? "voted" : "pending"}, seller ${sellerVote ? "voted" : "pending"}.` });
      if (buyerVote.outcome === sellerVote.outcome)
        return res.status(400).json({ error: "Buyer and seller agree — no dispute to arbitrate." });
    }

    DB.addVote(row.id, role, outcome, pk);
    const updatedVotes = DB.getVotes(row.id);
    const tally = tallyVotes(updatedVotes);

    if (tally.outcome) DB.resolveEscrow(row.id, tally.outcome);

    const winner = tally.outcome === "release" ? "buyer" : tally.outcome === "refund" ? "seller" : null;

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
        return res.status(403).json({ error: "Only the seller can reclaim from an expired escrow" });

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

    const winner = row.resolved_outcome === "release" ? "buyer" : "seller";
    if (role !== winner) return res.status(403).json({ error: `Only the ${winner} can claim. Escrow resolved as "${row.resolved_outcome}".` });

    const notes = DB.claimEscrow(row.id, role);
    if (!notes) return res.status(500).json({ error: "No notes found in escrow" });

    let isWebln = false;
    try { isWebln = JSON.parse(notes).type === "webln_receipt"; } catch {}

    if (isWebln) {
      return res.json({
        id: row.id, status: "CLAIMED", claimedBy: role,
        payoutReady: true, amountMsats: row.amount_msats, amountSats: Math.floor(row.amount_msats / 1000),
        message: "Escrow resolved in your favor! Tap Receive to generate an invoice — server pays you immediately.",
        nextStep: "POST /:id/payout with { invoice: '<BOLT-11>' }",
      });
    }

    res.json({ id: row.id, status: "CLAIMED", claimedBy: role, notes, message: "E-cash notes claimed." });
  } catch (err: any) { console.error("POST /claim error:", err); res.status(500).json({ error: err.message }); }
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
    if (inFlightPayouts.has(row.id)) {
      return res.status(409).json({ error: "Payout already in progress. Check your wallet." });
    }
    if (row.status !== "CLAIMED") return res.status(400).json({ error: `Cannot payout in ${row.status} state` });

    const pk = req.pubkey!;
    const role = getRoleByPubkey(row, pk);
    const expectedWinner = row.resolved_outcome === "release" ? "buyer" : "seller";
    if (role !== expectedWinner && !(row.resolved_outcome === "refund" && role === "seller")) {
      return res.status(403).json({ error: "Only the winning party can request payout" });
    }

    const { invoice } = req.body;
    if (!invoice || typeof invoice !== "string" || !invoice.startsWith("ln")) {
      return res.status(400).json({ error: "A valid BOLT-11 invoice is required. In Fedi, the app generates this automatically." });
    }

    const fmAvailable = await FM.isClientdAvailable();
    if (!fmAvailable) {
      return res.status(503).json({ error: "Fedimint payment service unavailable. Try again later." });
    }

    // Mark in-flight BEFORE paying to prevent double-spend
    inFlightPayouts.add(row.id);

    const payment = await FM.payoutToWinner(invoice);
    if (!payment.success) {
      inFlightPayouts.delete(row.id);
      return res.status(500).json({ error: `Payout failed: ${payment.error}` });
    }

    // Mark COMPLETED immediately to prevent duplicate payouts
    DB.completeEscrow(row.id);

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

export default router;
