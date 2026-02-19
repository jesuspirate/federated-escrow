// src/routes/ecash-escrow.ts
//
// E-Cash Escrow API — holds Fedimint e-cash notes in escrow
// with 2-of-3 approval logic for release.
//
// Endpoints:
//   POST   /api/ecash-escrows              Create a new escrow
//   GET    /api/ecash-escrows              List all escrows
//   GET    /api/ecash-escrows/:id          Get escrow details
//   POST   /api/ecash-escrows/:id/lock     Lock e-cash notes (seller deposits)
//   POST   /api/ecash-escrows/:id/approve  Vote on outcome (2-of-3 required)
//   POST   /api/ecash-escrows/:id/claim    Claim the notes (winning party)
//
// E-cash escrow flow:
//   1. Create escrow with amount and participant identifiers
//   2. Seller spends e-cash notes via Fedimint SDK → posts note string here
//   3. Two of three parties vote: release to buyer OR refund to seller
//   4. Winner claims the note string → reissues into their Fedimint wallet

import { Router, Request, Response } from "express";

// ── Types ─────────────────────────────────────────────────────────────────

type EscrowStatus =
  | "CREATED"   // Awaiting note deposit
  | "LOCKED"    // Notes deposited, awaiting votes
  | "APPROVED"  // 2-of-3 votes reached, awaiting claim
  | "CLAIMED"   // Notes claimed by winning party
  | "EXPIRED"   // Timed out (future: implement expiry)
  | "CANCELLED";

type Outcome = "release" | "refund";

interface Vote {
  role: "buyer" | "seller" | "arbiter";
  outcome: Outcome;     // release = to buyer, refund = to seller
  timestamp: number;
  token: string;        // auth token (simplified — use real auth in production)
}

interface EcashEscrow {
  id: string;
  status: EscrowStatus;
  createdAt: number;
  updatedAt: number;

  // Terms
  amountMsats: number;  // Expected amount in millisatoshis
  description: string;
  terms: string;        // Seller's trade terms (payment method, expectations, etc.)

  // Participant tokens (simplified auth — production would use proper auth)
  // Each participant gets a random token on creation to identify themselves
  buyerToken: string;
  sellerToken: string;
  arbiterToken: string;

  // Locked funds
  lockedNotes: string | null;  // The actual e-cash note string
  lockedBy: "seller" | null;
  lockedAt: number | null;

  // Approval votes
  votes: Vote[];

  // Resolution
  resolvedOutcome: Outcome | null;     // "release" or "refund"
  resolvedAt: number | null;
  claimedBy: "buyer" | "seller" | null;
  claimedAt: number | null;
}

// ── Store ─────────────────────────────────────────────────────────────────

const escrows = new Map<string, EcashEscrow>();
let nextId = 1;

function genToken(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function getRoleByToken(
  escrow: EcashEscrow,
  token: string
): "buyer" | "seller" | "arbiter" | null {
  if (token === escrow.buyerToken) return "buyer";
  if (token === escrow.sellerToken) return "seller";
  if (token === escrow.arbiterToken) return "arbiter";
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

// ── Router ────────────────────────────────────────────────────────────────

const router = Router();

// ── POST / — Create a new e-cash escrow ──────────────────────────────────
//
// Body: { amountMsats: number, description?: string }
// Returns: escrow details + participant tokens
//
// The creator distributes the tokens to each party out-of-band.
// In production, you'd use proper identity/auth (e.g. Nostr npubs).

router.post("/", (req: Request, res: Response) => {
  try {
    const { amountMsats, description = "", terms = "" } = req.body;

    if (!amountMsats || typeof amountMsats !== "number" || amountMsats <= 0) {
      return res
        .status(400)
        .json({ error: "amountMsats is required (positive integer)" });
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
      buyerToken: genToken(),
      sellerToken: genToken(),
      arbiterToken: genToken(),
      lockedNotes: null,
      lockedBy: null,
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
      createdAt: escrow.createdAt,
      // Tokens — distribute these to the respective parties
      // In production, use Nostr DMs or another secure channel
      tokens: {
        buyer: escrow.buyerToken,
        seller: escrow.sellerToken,
        arbiter: escrow.arbiterToken,
      },
      disclaimer:
        "⚠️ IMPORTANT: This escrow holds real e-cash (backed by Bitcoin). " +
        "Before proceeding: (1) All parties must join a Fedi group chat for communication " +
        "and evidence sharing. (2) The seller must clearly state trade terms before locking funds. " +
        "(3) The buyer must complete their obligation before voting. " +
        "(4) All proof of payment, screenshots, and communication should be shared in the group chat. " +
        "(5) Trades are irreversible once claimed. Act carefully and honestly.",
      flow: {
        step1: "Seller locks e-cash notes in escrow",
        step2: "Buyer completes their side (sends fiat, delivers goods/service), then votes",
        step3: "Seller confirms receipt and votes",
        step4: "If both agree → auto-release. If they disagree → arbiter reviews evidence and decides.",
      },
      message:
        "Escrow created. Share tokens with participants via Fedi DM. " +
        "Create a Fedi group chat with all 3 parties for communication. " +
        "Seller: set clear terms, then lock your e-cash.",
    });
  } catch (err: any) {
    console.error("POST /api/ecash-escrows error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET / — List all escrows ─────────────────────────────────────────────

router.get("/", (_req: Request, res: Response) => {
  const list = Array.from(escrows.values()).map((e) => ({
    id: e.id,
    status: e.status,
    amountMsats: e.amountMsats,
    amountSats: Math.floor(e.amountMsats / 1000),
    description: e.description,
    terms: e.terms,
    lockedAt: e.lockedAt,
    resolvedOutcome: e.resolvedOutcome,
    claimedBy: e.claimedBy,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  }));
  res.json(list);
});

// ── GET /:id — Get escrow details ────────────────────────────────────────
//
// Query: ?token=xxx (optional — if provided, shows role-specific info)

router.get("/:id", (req: Request, res: Response) => {
  const escrow = escrows.get(req.params.id);
  if (!escrow) return res.status(404).json({ error: "Escrow not found" });

  const token = req.query.token as string | undefined;
  const role = token ? getRoleByToken(escrow, token) : null;

  const votesSummary = tallyVotes(escrow.votes);

  res.json({
    id: escrow.id,
    status: escrow.status,
    amountMsats: escrow.amountMsats,
    amountSats: Math.floor(escrow.amountMsats / 1000),
    description: escrow.description,
    terms: escrow.terms,
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
    // Show role if authenticated
    ...(role && { yourRole: role }),
    // Show if this role can claim
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
// Body: { token: string, notes: string }
//
// The seller calls wallet.mint.spendNotes() in the browser to get the
// note string, then POSTs it here. The server holds the notes in escrow.

router.post("/:id/lock", (req: Request, res: Response) => {
  try {
    const escrow = escrows.get(req.params.id);
    if (!escrow) return res.status(404).json({ error: "Escrow not found" });

    if (escrow.status !== "CREATED") {
      return res
        .status(400)
        .json({ error: `Cannot lock notes in ${escrow.status} state` });
    }

    const { token, notes } = req.body;

    if (!token || !notes) {
      return res
        .status(400)
        .json({ error: "token and notes are required" });
    }

    const role = getRoleByToken(escrow, token);
    if (role !== "seller") {
      return res
        .status(403)
        .json({ error: "Only the seller can lock notes" });
    }

    if (typeof notes !== "string" || notes.length < 10) {
      return res
        .status(400)
        .json({ error: "Invalid e-cash notes string" });
    }

    const now = Date.now();
    escrow.lockedNotes = notes;
    escrow.lockedBy = "seller";
    escrow.lockedAt = now;
    escrow.status = "LOCKED";
    escrow.updatedAt = now;

    res.json({
      id: escrow.id,
      status: escrow.status,
      lockedAt: escrow.lockedAt,
      amountMsats: escrow.amountMsats,
      message:
        "E-cash notes locked in escrow. Buyer: complete your side of the trade, then cast your vote. " +
        "All communication and proof of payment should happen in your Fedi group chat.",
    });
  } catch (err: any) {
    console.error("POST /lock error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /:id/approve — Vote on outcome ─────────────────────────────────
//
// Body: { token: string, outcome: "release" | "refund" }
//
// STRICT vote ordering:
//   Step 1: BUYER votes first (after seller locks funds).
//           Buyer has completed their side (sent fiat, delivered service, etc.)
//           and confirms by voting "release". Buyer can ONLY vote "release" —
//           those are not their sats to refund.
//   Step 2: SELLER votes second (after buyer has voted).
//           Seller confirms they received what was promised. If yes → "release"
//           (happy path). If no → "refund" (triggers dispute).
//   Step 3: ARBITER votes ONLY if buyer and seller DISAGREE.
//           Arbiter reviews evidence in the Fedi group chat and casts tiebreaker.
//
//   If buyer + seller agree → auto-resolve, no arbiter needed.
//   "release" = notes to buyer. "refund" = notes back to seller.

router.post("/:id/approve", (req: Request, res: Response) => {
  try {
    const escrow = escrows.get(req.params.id);
    if (!escrow) return res.status(404).json({ error: "Escrow not found" });

    if (escrow.status !== "LOCKED") {
      return res
        .status(400)
        .json({ error: `Cannot vote in ${escrow.status} state` });
    }

    const { token, outcome } = req.body;

    if (!token || !outcome) {
      return res
        .status(400)
        .json({ error: 'token and outcome ("release" or "refund") are required' });
    }

    if (outcome !== "release" && outcome !== "refund") {
      return res
        .status(400)
        .json({ error: 'outcome must be "release" or "refund"' });
    }

    const role = getRoleByToken(escrow, token);
    if (!role) {
      return res.status(403).json({ error: "Invalid token" });
    }

    // Check if this role already voted
    const existingVote = escrow.votes.find((v) => v.role === role);
    if (existingVote) {
      return res.status(400).json({
        error: `${role} has already voted (${existingVote.outcome})`,
      });
    }

    const buyerVote = escrow.votes.find((v) => v.role === "buyer");
    const sellerVote = escrow.votes.find((v) => v.role === "seller");

    // ── Buyer can only vote "release" ────────────────────────────────
    // The buyer is confirming they completed their side of the trade.
    // They have no reason to refund — those aren't their sats.
    if (role === "buyer" && outcome !== "release") {
      return res.status(400).json({
        error:
          "Buyer can only vote \"release\". You are confirming you completed " +
          "your side of the trade. If there is an issue, communicate with " +
          "the seller in your Fedi group chat.",
      });
    }

    // ── Strict ordering: buyer must vote FIRST ───────────────────────
    if (role === "seller" && !buyerVote) {
      return res.status(403).json({
        error:
          "Buyer must vote first. The buyer confirms they have completed " +
          "their side of the trade (sent payment, delivered goods/service) " +
          "before the seller can respond.",
      });
    }

    // ── Arbiter restriction ──────────────────────────────────────────
    // Arbiter can only vote when there is an actual dispute:
    // both buyer and seller have voted, and they disagree.
    if (role === "arbiter") {
      if (!buyerVote || !sellerVote) {
        return res.status(403).json({
          error:
            "Arbiter can only vote after both buyer and seller have voted. " +
            `Currently: buyer ${buyerVote ? "voted" : "pending"}, seller ${sellerVote ? "voted" : "pending"}.`,
        });
      }

      if (buyerVote.outcome === sellerVote.outcome) {
        return res.status(400).json({
          error:
            "Buyer and seller already agree — no dispute to arbitrate.",
        });
      }
    }

    // Record vote
    const vote: Vote = {
      role,
      outcome,
      timestamp: Date.now(),
      token,
    };
    escrow.votes.push(vote);
    escrow.updatedAt = Date.now();

    // Check if 2-of-3 threshold reached
    const tally = tallyVotes(escrow.votes);

    if (tally.outcome) {
      escrow.status = "APPROVED";
      escrow.resolvedOutcome = tally.outcome;
      escrow.resolvedAt = Date.now();
      escrow.updatedAt = Date.now();
    }

    const winner =
      tally.outcome === "release"
        ? "buyer"
        : tally.outcome === "refund"
        ? "seller"
        : null;

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
// Body: { token: string }
//
// Only the winning party can claim. Returns the e-cash note string
// which can be reissued into their Fedimint wallet via
// wallet.mint.reissueExternalNotes(notes).

router.post("/:id/claim", (req: Request, res: Response) => {
  try {
    const escrow = escrows.get(req.params.id);
    if (!escrow) return res.status(404).json({ error: "Escrow not found" });

    if (escrow.status !== "APPROVED") {
      return res
        .status(400)
        .json({ error: `Cannot claim in ${escrow.status} state` });
    }

    const { token } = req.body;
    if (!token) {
      return res.status(400).json({ error: "token is required" });
    }

    const role = getRoleByToken(escrow, token);
    if (!role) {
      return res.status(403).json({ error: "Invalid token" });
    }

    // Verify this is the winning party
    const winner =
      escrow.resolvedOutcome === "release" ? "buyer" : "seller";

    if (role !== winner) {
      return res.status(403).json({
        error: `Only the ${winner} can claim. Escrow resolved as "${escrow.resolvedOutcome}".`,
      });
    }

    if (!escrow.lockedNotes) {
      return res
        .status(500)
        .json({ error: "No notes found in escrow (this should not happen)" });
    }

    // Release the notes
    const notes = escrow.lockedNotes;

    escrow.status = "CLAIMED";
    escrow.claimedBy = role;
    escrow.claimedAt = Date.now();
    escrow.lockedNotes = null; // Clear notes from server
    escrow.updatedAt = Date.now();

    res.json({
      id: escrow.id,
      status: escrow.status,
      claimedBy: role,
      notes, // THE E-CASH NOTES — reissue these into your wallet
      message: `E-cash notes claimed by ${role}. Call wallet.mint.reissueExternalNotes(notes) to absorb into your wallet.`,
    });
  } catch (err: any) {
    console.error("POST /claim error:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
