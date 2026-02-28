// src/routes/notifications.ts — Notification Preferences API
//
// Phase 5: Let users manage their DM notification settings.
//
// Mount in server.ts:
//   import notificationRoutes from "./routes/notifications";
//   app.use("/api/notifications", notificationRoutes);
//
// Uses same NIP-98 auth middleware pattern as ecash-escrow.ts and marketplace.ts.

import { Router, Request, Response, NextFunction } from "express";
import { verifyEvent } from "nostr-tools/pure";
import { getPreferences, setPreferences } from "../notifications";
import { isDMEnabled, getBotPubkey, getRelayUrls, sendDM } from "../nostr-dm";

type AuthenticatedRequest = Request & { pubkey?: string };

// ── NIP-98 Auth Middleware (same as ecash-escrow.ts) ──────────────────────

function extractPubkey(req: AuthenticatedRequest, res: Response, next: NextFunction) {
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

  // Dev mode fallback (same as other route files)
  const devPubkey = req.headers["x-dev-pubkey"] as string;
  if (devPubkey && process.env.ALLOW_DEV_PUBKEY === "true") {
    if (typeof devPubkey === "string" && devPubkey.length === 64) {
      req.pubkey = devPubkey;
      return next();
    }
    return res.status(401).json({ error: "Invalid dev pubkey (must be 64 hex chars)" });
  }

  return res.status(401).json({ error: "Authentication required." });
}

const router = Router();

// ── GET /status — Check if DM notifications are available (no auth) ───────

router.get("/status", (_req: Request, res: Response) => {
  res.json({
    enabled: isDMEnabled(),
    encryption: "NIP-44",
    botPubkey: getBotPubkey() || null,
    relays: getRelayUrls(),
    message: isDMEnabled()
      ? "Nostr DM notifications are active (NIP-44 encrypted). Add the bot pubkey to your contacts to receive notifications."
      : "Nostr DM notifications are not configured on this server. Set NOSTR_BOT_PRIVKEY to enable.",
  });
});

// ── GET /preferences — Get user's notification preferences ────────────────

router.get("/preferences", extractPubkey, (req: AuthenticatedRequest, res: Response) => {
  try {
    const prefs = getPreferences(req.pubkey!);
    res.json({
      ...prefs,
      systemEnabled: isDMEnabled(),
      botPubkey: getBotPubkey() || null,
    });
  } catch (err: any) {
    console.error("[notifications] GET /preferences error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /preferences — Update user's notification preferences ────────────

router.post("/preferences", extractPubkey, (req: AuthenticatedRequest, res: Response) => {
  try {
    const pk = req.pubkey!;
    const { dmEnabled, escrowUpdates, orderUpdates, listingSold } = req.body;
    const current = getPreferences(pk);

    setPreferences({
      pubkey: pk,
      dmEnabled: typeof dmEnabled === "boolean" ? dmEnabled : current.dmEnabled,
      escrowUpdates: typeof escrowUpdates === "boolean" ? escrowUpdates : current.escrowUpdates,
      orderUpdates: typeof orderUpdates === "boolean" ? orderUpdates : current.orderUpdates,
      listingSold: typeof listingSold === "boolean" ? listingSold : current.listingSold,
    });

    res.json({ ...getPreferences(pk), message: "Notification preferences updated." });
  } catch (err: any) {
    console.error("[notifications] POST /preferences error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /test — Send a test DM to yourself ──────────────────────────────

router.post("/test", extractPubkey, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!isDMEnabled()) {
      return res.status(503).json({ error: "DM notifications are not configured. Set NOSTR_BOT_PRIVKEY." });
    }

    const success = await sendDM(
      req.pubkey!,
      `🔔 Test notification from Satoshi Market! NIP-44 encrypted. If you can read this, DM notifications are working. satoshimarket.app`
    );

    res.json({
      sent: success,
      encryption: "NIP-44",
      message: success
        ? "Test DM sent! Check your Nostr client (Damus, Amethyst, Primal, Fedi, etc.)"
        : "Failed to publish to relays. Check relay connectivity.",
    });
  } catch (err: any) {
    console.error("[notifications] POST /test error:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
