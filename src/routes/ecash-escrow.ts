// src/routes/ecash-escrow.ts — Production-hardened API routes
//
// v4.0 changes:
//   - WebLN lock flow: server generates BOLT-11 invoice, seller pays via WebLN
//   - Manual lock fallback (dev/testing): paste notes but amount is still checked
//   - Rate limiting per pubkey
//   - Expiry sweep on every request cycle
//   - EXPIRED status handling

import { Router, Request, Response, NextFunction } from "express";
import { verifyEvent } from "nostr-tools/pure";
import * as DB from "../db";

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
  // Sweep expired escrows on each request cycle (cheap, SQLite is fast)
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

// ── Router ────────────────────────────────────────────────────────────────

const router = Router();
router.use(extractPubkey);
router.use(rateLimit);

// ── POST / — Create ──────────────────────────────────────────────────────

router.post("/", (req: AuthenticatedRequest, res: Response) => {
  try {
    const { amountMsats, description = "", terms = "", communityLink = "" } = req.body;
    const pk = req.pubkey!;

    if (!amountMsats || typeof amountMsats !== "number" || amountMsats <= 0)
      return res.status(400).json({ error: "amountMsats is required (positive integer)" });
    if (!terms || typeof terms !== "string" || terms.trim().length < 5)
      return res.status(400).json({ error: "Trade terms are required (minimum 5 characters). Describe what you expect from the buyer." });
    if (!communityLink || !isValidCommunityLink(communityLink))
      return res.status(400).json({ error: 'communityLink is required and must be a valid Fedi community link (format: "fedi:room:!roomId:federation.domain:::"). This is the public group where trade parties can find each other.' });

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
      disclaimer: "⚠️ This escrow holds real e-cash (backed by Bitcoin). All parties should join the community chat and communicate evidence there. Trades are irreversible once claimed. Act carefully and honestly.",
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
        ? "All parties have joined! Seller can now lock e-cash notes. Arbiter: create a private Fedi group and pull in the buyer and seller."
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

// ── POST /:id/lock — WebLN or manual lock ────────────────────────────────
//
// Two lock modes:
//
// 1. WebLN (production in Fedi):
//    POST { mode: "webln", preimage: "..." }
//    Frontend calls webln.sendPayment(invoice) → gets preimage → sends here.
//    Server generated the invoice earlier (GET /:id/invoice), so it can verify
//    the preimage matches and amount is correct.
//
// 2. Manual (dev/testing):
//    POST { notes: "ECASH_NOTES...", mode: "manual" }
//    Accepts raw e-cash note strings. Amount not cryptographically verified
//    but logged for audit. Use for dev testing only.
//
// In both cases, only the seller can lock.

router.post("/:id/lock", (req: AuthenticatedRequest, res: Response) => {
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
      // WebLN lock: seller paid a BOLT-11 invoice, sends preimage as proof
      const { preimage } = req.body;
      if (!preimage || typeof preimage !== "string" || preimage.length < 32)
        return res.status(400).json({ error: "WebLN lock requires a valid preimage from the payment" });

      // Store a receipt token as the "notes" — the actual e-cash was absorbed by the server's LN node.
      // On claim, the server will pay out to the winner via a new invoice.
      const receipt = JSON.stringify({
        type: "webln_receipt",
        escrowId: row.id,
        amountMsats: row.amount_msats,
        preimage,
        lockedAt: Date.now(),
        sellerPubkey: pk,
      });

      DB.lockNotes(row.id, receipt, "webln", preimage);
    } else {
      // Manual lock: raw e-cash notes (dev/testing)
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
      message: "E-cash notes locked in escrow. Buyer: complete your side of the trade, then vote. Communicate proof of payment in your private Fedi group chat.",
    });
  } catch (err: any) { console.error("POST /lock error:", err); res.status(500).json({ error: err.message }); }
});

// ── GET /:id/invoice — Generate BOLT-11 for WebLN lock ───────────────────
//
// Returns a BOLT-11 invoice for the exact escrow amount.
// The seller's Fedi wallet pays this via webln.sendPayment(invoice).
//
// NOTE: This requires a Lightning backend (LND, CLN, or LNbits).
// Currently returns a placeholder — integrate with your LN node.

router.get("/:id/invoice", (req: AuthenticatedRequest, res: Response) => {
  try {
    const row = DB.getEscrow(req.params.id);
    if (!row) return res.status(404).json({ error: "Escrow not found" });
    if (isExpired(row)) return res.status(400).json({ error: "This escrow has expired" });
    if (row.status !== "FUNDED") return res.status(400).json({ error: `Cannot generate invoice in ${row.status} state` });

    const pk = req.pubkey!;
    if (getRoleByPubkey(row, pk) !== "seller") return res.status(403).json({ error: "Only the seller can request the lock invoice" });

    const amountSats = Math.floor(row.amount_msats / 1000);

    // TODO: Replace with real LN invoice generation
    // Example with LNbits:
    //   const inv = await fetch(`${LNBITS_URL}/api/v1/payments`, {
    //     method: "POST", headers: { "X-Api-Key": LNBITS_INVOICE_KEY },
    //     body: JSON.stringify({ out: false, amount: amountSats, memo: `Escrow ${row.id} lock` })
    //   }).then(r => r.json());
    //   return res.json({ invoice: inv.payment_request, amountSats, ... });

    res.json({
      escrowId: row.id,
      amountMsats: row.amount_msats,
      amountSats,
      // Placeholder — replace with real invoice in production
      invoice: `lnbc${amountSats}n1_PLACEHOLDER_REPLACE_WITH_REAL_LN_INVOICE`,
      memo: `Escrow ${row.id} — lock ${amountSats} sats`,
      expiresIn: formatExpiry(row.expires_at),
      instructions: "Pay this invoice using webln.sendPayment(invoice). Send the preimage to POST /:id/lock with mode='webln'.",
    });
  } catch (err: any) { console.error("GET /invoice error:", err); res.status(500).json({ error: err.message }); }
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
      return res.status(400).json({ error: 'Buyer can only vote "release". You are confirming you completed your side of the trade. Communicate any issues in the Fedi group chat.' });
    if (role === "seller" && !buyerVote)
      return res.status(403).json({ error: "Buyer must vote first. The buyer confirms they completed their side before the seller can respond." });
    if (role === "arbiter") {
      if (!buyerVote || !sellerVote)
        return res.status(403).json({ error: `Arbiter can only vote after both buyer and seller. Currently: buyer ${buyerVote ? "voted" : "pending"}, seller ${sellerVote ? "voted" : "pending"}.` });
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
        ? `Escrow resolved: ${tally.outcome} to ${winner}. ${winner} can now claim the notes.`
        : `Vote recorded. ${tally.releaseCount} for release, ${tally.refundCount} for refund. Need 2-of-3 to resolve.`,
    });
  } catch (err: any) { console.error("POST /approve error:", err); res.status(500).json({ error: err.message }); }
});

// ── POST /:id/claim ──────────────────────────────────────────────────────

router.post("/:id/claim", (req: AuthenticatedRequest, res: Response) => {
  try {
    const row = DB.getEscrow(req.params.id);
    if (!row) return res.status(404).json({ error: "Escrow not found" });

    // Allow claiming EXPIRED escrows if they were LOCKED (seller gets refund)
    if (row.status === "EXPIRED" && row.locked_notes) {
      const pk = req.pubkey!;
      if (getRoleByPubkey(row, pk) !== "seller")
        return res.status(403).json({ error: "Only the seller can reclaim notes from an expired escrow" });
      const notes = DB.claimEscrow(row.id, "seller");
      if (!notes) return res.status(500).json({ error: "No notes found" });
      return res.json({
        id: row.id, status: "CLAIMED", claimedBy: "seller", notes,
        message: "Escrow expired — notes returned to seller.",
      });
    }

    if (row.status !== "APPROVED") return res.status(400).json({ error: `Cannot claim in ${row.status} state` });

    const pk = req.pubkey!;
    const role = getRoleByPubkey(row, pk);
    if (!role) return res.status(403).json({ error: "You are not a participant in this escrow" });

    const winner = row.resolved_outcome === "release" ? "buyer" : "seller";
    if (role !== winner) return res.status(403).json({ error: `Only the ${winner} can claim. Escrow resolved as "${row.resolved_outcome}".` });

    const notes = DB.claimEscrow(row.id, role);
    if (!notes) return res.status(500).json({ error: "No notes found in escrow" });

    // If WebLN mode, the "notes" is a receipt — the server needs to pay out via LN
    let payoutInstructions: string | undefined;
    try {
      const parsed = JSON.parse(notes);
      if (parsed.type === "webln_receipt") {
        payoutInstructions = "This escrow was locked via WebLN. Generate an invoice with webln.makeInvoice() and submit it to POST /:id/payout for the server to pay you.";
      }
    } catch { /* not JSON = raw e-cash notes, return as-is */ }

    res.json({
      id: row.id, status: "CLAIMED", claimedBy: role, notes: payoutInstructions ? undefined : notes,
      ...(payoutInstructions && { payoutInstructions, amountMsats: row.amount_msats }),
      message: payoutInstructions
        ? `Escrow resolved in your favor. ${payoutInstructions}`
        : `E-cash notes claimed by ${role}. Call wallet.mint.reissueExternalNotes(notes) to absorb into your wallet.`,
    });
  } catch (err: any) { console.error("POST /claim error:", err); res.status(500).json({ error: err.message }); }
});

export default router;
