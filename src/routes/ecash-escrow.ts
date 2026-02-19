// src/routes/ecash-escrow.ts
//
// E-Cash Escrow API — Nostr-authenticated, Fedi-native
//
// Authentication: NIP-98 (kind 27235 signed events in Authorization header)
// Identity: Nostr npubs (hex pubkeys) — auto-detected from Fedi's window.nostr
// Community: Required fedi:room: link ties escrow to a federation
//
// Endpoints:
//   GET    /api/health                     Health check
//   POST   /api/ecash-escrows              Create a new escrow
//   GET    /api/ecash-escrows              List all escrows
//   GET    /api/ecash-escrows/:id          Get escrow details
//   POST   /api/ecash-escrows/:id/join     Join as buyer or arbiter
//   POST   /api/ecash-escrows/:id/lock     Lock e-cash notes (seller deposits)
//   POST   /api/ecash-escrows/:id/approve  Vote on outcome (2-of-3 required)
//   POST   /api/ecash-escrows/:id/claim    Claim the notes (winning party)
//
// Trade flow:
//   1. Seller creates escrow (their npub = seller), sets terms + community link
//   2. Buyer joins → their npub registered as buyer
//   3. Arbiter joins → their npub registered as arbiter
//   4. Seller locks e-cash notes
//   5. Buyer votes "release" (only option — not their sats)
//   6. Seller votes "release" or "refund"
//   7. If disagree → arbiter breaks tie
//   8. Winner claims notes

import { Router, Request, Response, NextFunction } from "express";

// ── Types ─────────────────────────────────────────────────────────────────

type EscrowStatus =
  | "CREATED"    // Awaiting participants to join
  | "FUNDED"     // All 3 joined, awaiting seller lock
  | "LOCKED"     // Notes deposited, awaiting votes
  | "APPROVED"   // 2-of-3 votes reached, awaiting claim
  | "CLAIMED"    // Notes claimed by winning party
  | "EXPIRED"    // Timed out (future)
  | "CANCELLED";

type Outcome = "release" | "refund";
type Role = "buyer" | "seller" | "arbiter";

interface Vote {
  role: Role;
  outcome: Outcome;
  timestamp: number;
  pubkey: string;
}

interface EcashEscrow {
  id: string;
  status: EscrowStatus;
  createdAt: number;
  updatedAt: number;

  // Terms
  amountMsats: number;
  description: string;
  terms: string;

  // Community — ties escrow to a Fedi federation
  communityLink: string;     // fedi:room:!xxx:federation.domain:::
  federationId: string;      // extracted from community link (e.g. "m1.8fa.in")

  // Participant npubs (hex pubkeys)
  sellerPubkey: string;           // set at creation (creator = seller)
  buyerPubkey: string | null;     // set when buyer joins
  arbiterPubkey: string | null;   // set when arbiter joins

  // Locked funds
  lockedNotes: string | null;
  lockedAt: number | null;

  // Approval votes
  votes: Vote[];

  // Resolution
  resolvedOutcome: Outcome | null;
  resolvedAt: number | null;
  claimedBy: Role | null;
  claimedAt: number | null;
}

// ── Store ─────────────────────────────────────────────────────────────────

const escrows = new Map<string, EcashEscrow>();
let nextId = 1;

// ── NIP-98 Auth Middleware ────────────────────────────────────────────────
//
// Verifies the Authorization: Nostr <base64> header on every request.
// Extracts the caller's pubkey and attaches it to req.
//
// NIP-98 event structure:
//   kind: 27235
//   tags: [["u", "<url>"], ["method", "<HTTP method>"], ["payload", "<sha256>"]]
//   content: ""
//   + id, pubkey, sig (added by signer)
//
// In production: verify Schnorr signature over the event ID.
// For now: we trust the signed event structure (Fedi's signer is trusted).
// Full sig verification requires secp256k1 — added when we add nostr-tools.

interface AuthenticatedRequest extends Request {
  pubkey?: string;
}

function extractPubkey(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  // Check for NIP-98 Authorization header
  const authHeader = req.headers.authorization;

  if (authHeader && authHeader.startsWith("Nostr ")) {
    try {
      const base64 = authHeader.slice(6);
      const json = atob(base64);
      const event = JSON.parse(json);

      // Validate NIP-98 event structure
      if (event.kind !== 27235) {
        return res.status(401).json({ error: "Invalid auth event kind (expected 27235)" });
      }

      // Check timestamp (within 120 seconds)
      const now = Math.floor(Date.now() / 1000);
      if (Math.abs(now - event.created_at) > 120) {
        return res.status(401).json({ error: "Auth event expired (>120s)" });
      }

      // Check method tag
      const methodTag = event.tags?.find((t: string[]) => t[0] === "method");
      if (methodTag && methodTag[1] !== req.method) {
        return res.status(401).json({ error: "Auth method mismatch" });
      }

      // Extract pubkey
      if (!event.pubkey || typeof event.pubkey !== "string" || event.pubkey.length !== 64) {
        return res.status(401).json({ error: "Invalid pubkey in auth event" });
      }

      // TODO: Verify Schnorr signature when nostr-tools is added
      // For now, we trust the event structure. In Fedi's webview,
      // window.nostr.signEvent() produces valid signatures.
      // Production: import { verifyEvent } from '@nostr/tools' and call verifyEvent(event)

      req.pubkey = event.pubkey;
      return next();
    } catch (err) {
      return res.status(401).json({ error: "Malformed NIP-98 auth header" });
    }
  }

  // Dev mode: accept X-Dev-Pubkey header (non-production only)
  const devPubkey = req.headers["x-dev-pubkey"] as string;
  if (devPubkey && process.env.NODE_ENV !== "production") {
    if (typeof devPubkey === "string" && devPubkey.length === 64) {
      req.pubkey = devPubkey;
      return next();
    }
    return res.status(401).json({ error: "Invalid dev pubkey (must be 64 hex chars)" });
  }

  // No auth provided
  return res.status(401).json({
    error: "Authentication required. Send NIP-98 Authorization header or X-Dev-Pubkey (dev mode only).",
  });
}

function getRoleByPubkey(escrow: EcashEscrow, pubkey: string): Role | null {
  if (pubkey === escrow.sellerPubkey) return "seller";
  if (pubkey === escrow.buyerPubkey) return "buyer";
  if (pubkey === escrow.arbiterPubkey) return "arbiter";
  return null;
}

function tallyVotes(votes: Vote[]): {
  releaseCount: number;
  refundCount: number;
  outcome: Outcome | null;
} {
  const release = votes.filter((v) => v.outcome === "release").length;
  const refund = votes.filter((v) => v.outcome === "refund").length;
  return {
    releaseCount: release,
    refundCount: refund,
    outcome: release >= 2 ? "release" : refund >= 2 ? "refund" : null,
  };
}

// Minimal bech32 npub encoding for API responses
function hexToNpub(hex: string): string {
  const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

  function polymod(values: number[]): number {
    let chk = 1;
    for (const v of values) {
      const b = chk >> 25;
      chk = ((chk & 0x1ffffff) << 5) ^ v;
      for (let i = 0; i < 5; i++) if ((b >> i) & 1) chk ^= GEN[i];
    }
    return chk;
  }

  const hrpExpanded = [0, 0, 0, 0, 14, 16, 21, 2]; // "npub" expanded

  const bytes: number[] = [];
  for (let i = 0; i < hex.length; i += 2)
    bytes.push(parseInt(hex.substring(i, i + 2), 16));

  // Convert 8-bit to 5-bit
  const words: number[] = [];
  let acc = 0, bits = 0;
  for (const b of bytes) {
    acc = (acc << 8) | b;
    bits += 8;
    while (bits >= 5) { bits -= 5; words.push((acc >> bits) & 31); }
  }
  if (bits > 0) words.push((acc << (5 - bits)) & 31);

  const checksum: number[] = [];
  const pm = polymod(hrpExpanded.concat(words).concat([0, 0, 0, 0, 0, 0])) ^ 1;
  for (let i = 0; i < 6; i++) checksum.push((pm >> (5 * (5 - i))) & 31);

  return "npub1" + words.concat(checksum).map((d) => CHARSET[d]).join("");
}

function isValidCommunityLink(link: string): boolean {
  return /^fedi:room:![a-zA-Z0-9]+:[a-zA-Z0-9.-]+:::$/.test(link.trim());
}

function extractFederationId(communityLink: string): string | null {
  const match = communityLink.match(/^fedi:room:![a-zA-Z0-9]+:([a-zA-Z0-9.-]+):::$/);
  return match ? match[1] : null;
}

function truncatePubkey(hex: string): string {
  return hex.slice(0, 8) + "..." + hex.slice(-8);
}

// ── Router ────────────────────────────────────────────────────────────────

const router = Router();

// All routes require authentication
router.use(extractPubkey);

// ── POST / — Create a new escrow ─────────────────────────────────────────
//
// Creator = seller. Their npub is auto-detected from the auth header.
// Body: { amountMsats, description, terms, communityLink }

router.post("/", (req: AuthenticatedRequest, res: Response) => {
  try {
    const { amountMsats, description = "", terms = "", communityLink = "" } = req.body;
    const sellerPubkey = req.pubkey!;

    if (!amountMsats || typeof amountMsats !== "number" || amountMsats <= 0) {
      return res.status(400).json({ error: "amountMsats is required (positive integer)" });
    }

    if (!terms || typeof terms !== "string" || terms.trim().length < 5) {
      return res.status(400).json({
        error: "Trade terms are required (minimum 5 characters). Describe what you expect from the buyer.",
      });
    }

    if (!communityLink || !isValidCommunityLink(communityLink)) {
      return res.status(400).json({
        error:
          'communityLink is required and must be a valid Fedi community link ' +
          '(format: "fedi:room:!roomId:federation.domain:::"). This is the public group ' +
          "where trade parties can find each other.",
      });
    }

    const federationId = extractFederationId(communityLink);
    if (!federationId) {
      return res.status(400).json({ error: "Could not extract federation ID from community link" });
    }

    const id = `ecash_${nextId++}`;
    const now = Date.now();

    const escrow: EcashEscrow = {
      id,
      status: "CREATED",
      createdAt: now,
      updatedAt: now,
      amountMsats,
      description,
      terms,
      communityLink,
      federationId,
      sellerPubkey,
      buyerPubkey: null,
      arbiterPubkey: null,
      lockedNotes: null,
      lockedAt: null,
      votes: [],
      resolvedOutcome: null,
      resolvedAt: null,
      claimedBy: null,
      claimedAt: null,
    };

    escrows.set(id, escrow);

    res.status(201).json({
      id: escrow.id,
      status: escrow.status,
      amountMsats: escrow.amountMsats,
      amountSats: Math.floor(escrow.amountMsats / 1000),
      description: escrow.description,
      terms: escrow.terms,
      communityLink: escrow.communityLink,
      federationId: escrow.federationId,
      seller: {
        pubkey: truncatePubkey(sellerPubkey),
        npub: hexToNpub(sellerPubkey),
      },
      createdAt: escrow.createdAt,
      yourRole: "seller",
      nextStep: "Share the escrow ID in your Fedi community chat. Buyer and arbiter need to join.",
      disclaimer:
        "⚠️ This escrow holds real e-cash (backed by Bitcoin). " +
        "All parties should join the community chat and communicate evidence there. " +
        "Trades are irreversible once claimed. Act carefully and honestly.",
    });
  } catch (err: any) {
    console.error("POST /api/ecash-escrows error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /:id/join — Join an escrow as buyer or arbiter ──────────────────
//
// Body: { role: "buyer" | "arbiter" }
// The caller's npub is auto-detected from auth.

router.post("/:id/join", (req: AuthenticatedRequest, res: Response) => {
  try {
    const escrow = escrows.get(req.params.id);
    if (!escrow) return res.status(404).json({ error: "Escrow not found" });

    const pubkey = req.pubkey!;
    const { role } = req.body;

    if (role !== "buyer" && role !== "arbiter") {
      return res.status(400).json({ error: 'role must be "buyer" or "arbiter"' });
    }

    // Can't join if already a participant
    const existingRole = getRoleByPubkey(escrow, pubkey);
    if (existingRole) {
      return res.status(400).json({
        error: `You are already the ${existingRole} in this escrow`,
      });
    }

    // Check if role is already taken
    if (role === "buyer" && escrow.buyerPubkey) {
      return res.status(400).json({ error: "Buyer slot is already filled" });
    }
    if (role === "arbiter" && escrow.arbiterPubkey) {
      return res.status(400).json({ error: "Arbiter slot is already filled" });
    }

    // Can only join in CREATED or partially filled states
    if (escrow.status !== "CREATED" && escrow.status !== "FUNDED") {
      return res.status(400).json({
        error: `Cannot join in ${escrow.status} state`,
      });
    }

    // Assign role
    if (role === "buyer") {
      escrow.buyerPubkey = pubkey;
    } else {
      escrow.arbiterPubkey = pubkey;
    }
    escrow.updatedAt = Date.now();

    // Check if all 3 parties are now present
    if (escrow.sellerPubkey && escrow.buyerPubkey && escrow.arbiterPubkey) {
      escrow.status = "FUNDED";
    }

    const participants = {
      seller: escrow.sellerPubkey ? truncatePubkey(escrow.sellerPubkey) : null,
      buyer: escrow.buyerPubkey ? truncatePubkey(escrow.buyerPubkey) : null,
      arbiter: escrow.arbiterPubkey ? truncatePubkey(escrow.arbiterPubkey) : null,
    };

    res.json({
      id: escrow.id,
      status: escrow.status,
      yourRole: role,
      participants,
      allJoined: escrow.status === "FUNDED",
      message: escrow.status === "FUNDED"
        ? "All parties have joined! Seller can now lock e-cash notes. " +
          "Arbiter: create a private Fedi group and pull in the buyer and seller."
        : `Joined as ${role}. Waiting for ${!escrow.buyerPubkey ? "buyer" : ""}${!escrow.buyerPubkey && !escrow.arbiterPubkey ? " and " : ""}${!escrow.arbiterPubkey ? "arbiter" : ""} to join.`,
    });
  } catch (err: any) {
    console.error("POST /join error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET / — List all escrows ─────────────────────────────────────────────
//
// Returns escrows the authenticated user is part of.

router.get("/", (req: AuthenticatedRequest, res: Response) => {
  const pubkey = req.pubkey!;

  const list = Array.from(escrows.values())
    .filter(
      (e) =>
        e.sellerPubkey === pubkey ||
        e.buyerPubkey === pubkey ||
        e.arbiterPubkey === pubkey
    )
    .map((e) => ({
      id: e.id,
      status: e.status,
      amountMsats: e.amountMsats,
      amountSats: Math.floor(e.amountMsats / 1000),
      description: e.description,
      terms: e.terms,
      communityLink: e.communityLink,
      federationId: e.federationId,
      yourRole: getRoleByPubkey(e, pubkey),
      participants: {
        seller: e.sellerPubkey ? truncatePubkey(e.sellerPubkey) : null,
        buyer: e.buyerPubkey ? truncatePubkey(e.buyerPubkey) : null,
        arbiter: e.arbiterPubkey ? truncatePubkey(e.arbiterPubkey) : null,
      },
      resolvedOutcome: e.resolvedOutcome,
      claimedBy: e.claimedBy,
      createdAt: e.createdAt,
      updatedAt: e.updatedAt,
    }));

  res.json(list);
});

// ── GET /:id — Get escrow details ────────────────────────────────────────

router.get("/:id", (req: AuthenticatedRequest, res: Response) => {
  const escrow = escrows.get(req.params.id);
  if (!escrow) return res.status(404).json({ error: "Escrow not found" });

  const pubkey = req.pubkey!;
  const role = getRoleByPubkey(escrow, pubkey);
  const votesSummary = tallyVotes(escrow.votes);

  res.json({
    id: escrow.id,
    status: escrow.status,
    amountMsats: escrow.amountMsats,
    amountSats: Math.floor(escrow.amountMsats / 1000),
    description: escrow.description,
    terms: escrow.terms,
    communityLink: escrow.communityLink,
    federationId: escrow.federationId,
    participants: {
      seller: escrow.sellerPubkey ? {
        pubkey: truncatePubkey(escrow.sellerPubkey),
        npub: hexToNpub(escrow.sellerPubkey),
        isFull: true,
      } : null,
      buyer: escrow.buyerPubkey ? {
        pubkey: truncatePubkey(escrow.buyerPubkey),
        npub: hexToNpub(escrow.buyerPubkey),
        isFull: true,
      } : { isFull: false },
      arbiter: escrow.arbiterPubkey ? {
        pubkey: truncatePubkey(escrow.arbiterPubkey),
        npub: hexToNpub(escrow.arbiterPubkey),
        isFull: true,
      } : { isFull: false },
    },
    lockedAt: escrow.lockedAt,
    votes: {
      release: votesSummary.releaseCount,
      refund: votesSummary.refundCount,
      voters: escrow.votes.map((v) => ({
        role: v.role,
        outcome: v.outcome,
      })),
    },
    resolvedOutcome: escrow.resolvedOutcome,
    resolvedAt: escrow.resolvedAt,
    claimedBy: escrow.claimedBy,
    claimedAt: escrow.claimedAt,
    createdAt: escrow.createdAt,
    updatedAt: escrow.updatedAt,
    // Role-specific info
    ...(role && { yourRole: role }),
    ...(role && {
      canClaim:
        escrow.status === "APPROVED" &&
        ((escrow.resolvedOutcome === "release" && role === "buyer") ||
          (escrow.resolvedOutcome === "refund" && role === "seller")),
    }),
  });
});

// ── POST /:id/lock — Seller locks e-cash notes ──────────────────────────
//
// Body: { notes: string }

router.post("/:id/lock", (req: AuthenticatedRequest, res: Response) => {
  try {
    const escrow = escrows.get(req.params.id);
    if (!escrow) return res.status(404).json({ error: "Escrow not found" });

    const pubkey = req.pubkey!;
    const role = getRoleByPubkey(escrow, pubkey);

    if (role !== "seller") {
      return res.status(403).json({ error: "Only the seller can lock notes" });
    }

    if (escrow.status !== "FUNDED") {
      if (escrow.status === "CREATED") {
        return res.status(400).json({
          error: "All three parties must join before locking. " +
            `Missing: ${!escrow.buyerPubkey ? "buyer " : ""}${!escrow.arbiterPubkey ? "arbiter" : ""}`.trim(),
        });
      }
      return res.status(400).json({ error: `Cannot lock notes in ${escrow.status} state` });
    }

    const { notes } = req.body;
    if (!notes || typeof notes !== "string" || notes.length < 10) {
      return res.status(400).json({ error: "Invalid e-cash notes string" });
    }

    const now = Date.now();
    escrow.lockedNotes = notes;
    escrow.lockedAt = now;
    escrow.status = "LOCKED";
    escrow.updatedAt = now;

    res.json({
      id: escrow.id,
      status: escrow.status,
      lockedAt: escrow.lockedAt,
      amountMsats: escrow.amountMsats,
      message:
        "E-cash notes locked in escrow. Buyer: complete your side of the trade, then vote. " +
        "Communicate proof of payment in your private Fedi group chat.",
    });
  } catch (err: any) {
    console.error("POST /lock error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /:id/approve — Vote on outcome ─────────────────────────────────
//
// Body: { outcome: "release" | "refund" }
//
// STRICT ordering:
//   1. BUYER votes first (can ONLY vote "release")
//   2. SELLER votes second ("release" or "refund")
//   3. ARBITER only if buyer+seller disagree

router.post("/:id/approve", (req: AuthenticatedRequest, res: Response) => {
  try {
    const escrow = escrows.get(req.params.id);
    if (!escrow) return res.status(404).json({ error: "Escrow not found" });

    if (escrow.status !== "LOCKED") {
      return res.status(400).json({ error: `Cannot vote in ${escrow.status} state` });
    }

    const pubkey = req.pubkey!;
    const role = getRoleByPubkey(escrow, pubkey);

    if (!role) {
      return res.status(403).json({ error: "You are not a participant in this escrow" });
    }

    const { outcome } = req.body;
    if (outcome !== "release" && outcome !== "refund") {
      return res.status(400).json({ error: 'outcome must be "release" or "refund"' });
    }

    // Check if already voted
    const existingVote = escrow.votes.find((v) => v.role === role);
    if (existingVote) {
      return res.status(400).json({
        error: `${role} has already voted (${existingVote.outcome})`,
      });
    }

    const buyerVote = escrow.votes.find((v) => v.role === "buyer");
    const sellerVote = escrow.votes.find((v) => v.role === "seller");

    // Buyer can only vote "release"
    if (role === "buyer" && outcome !== "release") {
      return res.status(400).json({
        error:
          'Buyer can only vote "release". You are confirming you completed ' +
          "your side of the trade. Communicate any issues in the Fedi group chat.",
      });
    }

    // Seller must wait for buyer
    if (role === "seller" && !buyerVote) {
      return res.status(403).json({
        error: "Buyer must vote first. The buyer confirms they completed their side before the seller can respond.",
      });
    }

    // Arbiter only when there's a real dispute
    if (role === "arbiter") {
      if (!buyerVote || !sellerVote) {
        return res.status(403).json({
          error: `Arbiter can only vote after both buyer and seller. Currently: buyer ${buyerVote ? "voted" : "pending"}, seller ${sellerVote ? "voted" : "pending"}.`,
        });
      }
      if (buyerVote.outcome === sellerVote.outcome) {
        return res.status(400).json({ error: "Buyer and seller agree — no dispute to arbitrate." });
      }
    }

    // Record vote
    escrow.votes.push({
      role,
      outcome,
      timestamp: Date.now(),
      pubkey,
    });
    escrow.updatedAt = Date.now();

    // Check 2-of-3 threshold
    const tally = tallyVotes(escrow.votes);

    if (tally.outcome) {
      escrow.status = "APPROVED";
      escrow.resolvedOutcome = tally.outcome;
      escrow.resolvedAt = Date.now();
      escrow.updatedAt = Date.now();
    }

    const winner = tally.outcome === "release" ? "buyer" : tally.outcome === "refund" ? "seller" : null;

    res.json({
      id: escrow.id,
      status: escrow.status,
      yourRole: role,
      yourVote: outcome,
      votes: {
        release: tally.releaseCount,
        refund: tally.refundCount,
        voters: escrow.votes.map((v) => ({ role: v.role, outcome: v.outcome })),
      },
      resolved: !!tally.outcome,
      resolvedOutcome: tally.outcome,
      winner,
      message: tally.outcome
        ? `Escrow resolved: ${tally.outcome} to ${winner}. ${winner} can now claim the notes.`
        : `Vote recorded. ${tally.releaseCount} for release, ${tally.refundCount} for refund. Need 2-of-3 to resolve.`,
    });
  } catch (err: any) {
    console.error("POST /approve error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /:id/claim — Claim the e-cash notes ────────────────────────────
//
// Body: {} (identity from auth header)

router.post("/:id/claim", (req: AuthenticatedRequest, res: Response) => {
  try {
    const escrow = escrows.get(req.params.id);
    if (!escrow) return res.status(404).json({ error: "Escrow not found" });

    if (escrow.status !== "APPROVED") {
      return res.status(400).json({ error: `Cannot claim in ${escrow.status} state` });
    }

    const pubkey = req.pubkey!;
    const role = getRoleByPubkey(escrow, pubkey);

    if (!role) {
      return res.status(403).json({ error: "You are not a participant in this escrow" });
    }

    const winner = escrow.resolvedOutcome === "release" ? "buyer" : "seller";
    if (role !== winner) {
      return res.status(403).json({
        error: `Only the ${winner} can claim. Escrow resolved as "${escrow.resolvedOutcome}".`,
      });
    }

    if (!escrow.lockedNotes) {
      return res.status(500).json({ error: "No notes found in escrow (this should not happen)" });
    }

    const notes = escrow.lockedNotes;

    escrow.status = "CLAIMED";
    escrow.claimedBy = role;
    escrow.claimedAt = Date.now();
    escrow.lockedNotes = null;
    escrow.updatedAt = Date.now();

    res.json({
      id: escrow.id,
      status: escrow.status,
      claimedBy: role,
      notes,
      message: `E-cash notes claimed by ${role}. Call wallet.mint.reissueExternalNotes(notes) to absorb into your wallet.`,
    });
  } catch (err: any) {
    console.error("POST /claim error:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
