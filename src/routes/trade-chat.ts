// ── Trade Chat — NIP-44 Encrypted Messages Between Escrow Participants ──
import { Router, Request, Response } from "express";
import * as DB from "../db";

const router = Router();

// ── Auth middleware (same as marketplace — Bearer token + NIP-98 fallback) ──
const SESSION_SECRET = process.env.ESCROW_ENCRYPTION_KEY || "dev-session-secret";

function extractPubkey(req: AuthenticatedRequest, res: Response, next: Function) {
  const authHeader = req.headers.authorization;
  
  if (authHeader && authHeader.startsWith("Bearer ")) {
    try {
      const token = authHeader.slice(7);
      const decoded = Buffer.from(token, "base64").toString("utf8");
      const parts = decoded.split(":");
      if (parts.length === 3) {
        const [pubkey, expiresStr, hmac] = parts;
        if (parseInt(expiresStr) > Date.now()) {
          const crypto = require("crypto");
          const expected = crypto.createHmac("sha256", SESSION_SECRET).update(pubkey + ":" + expiresStr).digest("hex");
          if (hmac === expected) { req.pubkey = pubkey; return next(); }
        }
      }
    } catch {}
  }

  if (authHeader && authHeader.startsWith("Nostr ")) {
    try {
      const { verifyEvent } = require("nostr-tools");
      const json = Buffer.from(authHeader.slice(6), "base64").toString("utf8");
      const event = JSON.parse(json);
      if (event.kind === 27235 && event.pubkey?.length === 64) {
        const now = Math.floor(Date.now() / 1000);
        if (Math.abs(now - event.created_at) <= 120 && verifyEvent(event)) {
          req.pubkey = event.pubkey;
          return next();
        }
      }
    } catch {}
  }

  return res.status(401).json({ error: "Authentication required" });
}

router.use(extractPubkey);

interface AuthenticatedRequest extends Request {
  pubkey?: string;
}

// Helper: get role in escrow
function getRoleByPubkey(escrow: any, pk: string): string | null {
  if (escrow.seller_pubkey === pk) return "seller";
  if (escrow.buyer_pubkey === pk) return "buyer";
  if (escrow.arbiter_pubkey === pk) return "arbiter";
  return null;
}

// ── POST /:escrowId/messages — Send encrypted message ────────────────
router.post("/:escrowId/messages", (req: AuthenticatedRequest, res: Response) => {
  try {
    const escrow = DB.getEscrow(req.params.escrowId);
    if (!escrow) return res.status(404).json({ error: "Escrow not found" });

    const pk = req.pubkey!;
    const role = getRoleByPubkey(escrow, pk);
    if (!role) return res.status(403).json({ error: "Not a participant" });

    const { encrypted } = req.body;
    if (!encrypted || typeof encrypted !== "string" || encrypted.length < 1) {
      return res.status(400).json({ error: "Missing encrypted message" });
    }
    if (encrypted.length > 5000) {
      return res.status(400).json({ error: "Message too long" });
    }

    // Store the encrypted message
    const msgId = "msg_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
    DB.addChatMessage(req.params.escrowId, msgId, pk, role, encrypted);

    res.json({ success: true, messageId: msgId, timestamp: Date.now() });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /:escrowId/messages — Get all messages for this escrow ───────
router.get("/:escrowId/messages", (req: AuthenticatedRequest, res: Response) => {
  try {
    const escrow = DB.getEscrow(req.params.escrowId);
    if (!escrow) return res.status(404).json({ error: "Escrow not found" });

    const pk = req.pubkey!;
    const role = getRoleByPubkey(escrow, pk);
    if (!role) return res.status(403).json({ error: "Not a participant" });

    const after = parseInt(req.query.after as string) || 0;
    const messages = DB.getChatMessages(req.params.escrowId, after);
    console.log("[chat]", req.method, req.params.escrowId, "role:", role, "pubkey:", pk.substring(0,8), "after:", after, "msgs:", messages.length);

    res.json({
      escrowId: req.params.escrowId,
      messages,
      participants: {
        seller: escrow.seller_pubkey,
        buyer: escrow.buyer_pubkey,
        arbiter: escrow.arbiter_pubkey,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
