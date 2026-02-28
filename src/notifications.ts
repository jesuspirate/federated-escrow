// src/notifications.ts — Notification Templates & Trigger Logic
//
// Phase 5: Maps escrow and marketplace state transitions to DM messages.
//
// Design principles:
//   1. Fire-and-forget — notifications never block the main request
//   2. Respect opt-outs — check preferences table before sending
//   3. No sensitive data — messages contain IDs and status, not amounts/descriptions
//   4. Idempotent — duplicate sends are harmless (each Nostr event has unique ID)
//
// Uses the same `db` (better-sqlite3) instance from src/db.ts.

import { sendDM, sendDMBatch } from "./nostr-dm";
import db from "./db";

// ── Notification Preferences Table ────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS notification_preferences (
    pubkey          TEXT PRIMARY KEY,
    dm_enabled      INTEGER NOT NULL DEFAULT 1,
    escrow_updates  INTEGER NOT NULL DEFAULT 1,
    order_updates   INTEGER NOT NULL DEFAULT 1,
    listing_sold    INTEGER NOT NULL DEFAULT 1,
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

export interface NotificationPrefs {
  pubkey: string;
  dmEnabled: boolean;
  escrowUpdates: boolean;
  orderUpdates: boolean;
  listingSold: boolean;
}

const stmtGetPrefs = db.prepare(`SELECT * FROM notification_preferences WHERE pubkey = ?`);
const stmtUpsertPrefs = db.prepare(`
  INSERT INTO notification_preferences (pubkey, dm_enabled, escrow_updates, order_updates, listing_sold, updated_at)
  VALUES (@pubkey, @dm_enabled, @escrow_updates, @order_updates, @listing_sold, datetime('now'))
  ON CONFLICT(pubkey) DO UPDATE SET
    dm_enabled = @dm_enabled, escrow_updates = @escrow_updates,
    order_updates = @order_updates, listing_sold = @listing_sold,
    updated_at = datetime('now')
`);

export function getPreferences(pubkey: string): NotificationPrefs {
  const row = stmtGetPrefs.get(pubkey) as any;
  if (!row) return { pubkey, dmEnabled: true, escrowUpdates: true, orderUpdates: true, listingSold: true };
  return {
    pubkey: row.pubkey,
    dmEnabled: !!row.dm_enabled,
    escrowUpdates: !!row.escrow_updates,
    orderUpdates: !!row.order_updates,
    listingSold: !!row.listing_sold,
  };
}

export function setPreferences(prefs: NotificationPrefs): void {
  stmtUpsertPrefs.run({
    pubkey: prefs.pubkey,
    dm_enabled: prefs.dmEnabled ? 1 : 0,
    escrow_updates: prefs.escrowUpdates ? 1 : 0,
    order_updates: prefs.orderUpdates ? 1 : 0,
    listing_sold: prefs.listingSold ? 1 : 0,
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────

function shouldNotify(pubkey: string, category: "escrow" | "order" | "listing"): boolean {
  const prefs = getPreferences(pubkey);
  if (!prefs.dmEnabled) return false;
  if (category === "escrow") return prefs.escrowUpdates;
  if (category === "order") return prefs.orderUpdates;
  if (category === "listing") return prefs.listingSold;
  return true;
}

function truncPk(hex: string): string {
  return hex.slice(0, 8) + "…" + hex.slice(-4);
}

// ══════════════════════════════════════════════════════════════════════════
// ESCROW NOTIFICATION TRIGGERS
//
// Called from src/routes/ecash-escrow.ts at each state transition.
// All are fire-and-forget (async but not awaited by the caller).
// ══════════════════════════════════════════════════════════════════════════

/** Someone joined an escrow — notify the other participants. */
export function notifyEscrowJoin(
  escrowId: string, joinerPubkey: string, joinerRole: string, otherPubkeys: string[]
): void {
  const recipients = otherPubkeys
    .filter(pk => pk && pk !== joinerPubkey && shouldNotify(pk, "escrow"))
    .map(pk => ({
      pubkey: pk,
      message: `🤝 A ${joinerRole} (${truncPk(joinerPubkey)}) joined escrow ${escrowId}. Check your trades at satoshimarket.app`,
    }));
  if (recipients.length > 0) sendDMBatch(recipients).catch(() => {});
}

/** All 3 participants joined — escrow is FUNDED. */
export function notifyEscrowFunded(
  escrowId: string, sellerPk: string, buyerPk: string, arbiterPk: string
): void {
  const all = [sellerPk, buyerPk, arbiterPk];
  const recipients = all
    .filter(pk => pk && shouldNotify(pk, "escrow"))
    .map(pk => ({
      pubkey: pk,
      message: `✅ Escrow ${escrowId} is fully funded — all 3 participants joined. Seller: lock your sats to proceed. satoshimarket.app`,
    }));
  if (recipients.length > 0) sendDMBatch(recipients).catch(() => {});
}

/** Sats locked in escrow — notify buyer + arbiter. */
export function notifyEscrowLocked(
  escrowId: string, sellerPk: string, buyerPk: string, arbiterPk: string
): void {
  const recipients = [buyerPk, arbiterPk]
    .filter(pk => pk && shouldNotify(pk, "escrow"))
    .map(pk => ({
      pubkey: pk,
      message: `🔒 Sats locked in escrow ${escrowId}. The trade is live — fulfill obligations and vote when ready. satoshimarket.app`,
    }));
  if (recipients.length > 0) sendDMBatch(recipients).catch(() => {});
}

/** Vote cast — notify the other participants (don't reveal the vote). */
export function notifyEscrowVote(
  escrowId: string, voterPk: string, voterRole: string, otherPubkeys: string[]
): void {
  const recipients = otherPubkeys
    .filter(pk => pk && pk !== voterPk && shouldNotify(pk, "escrow"))
    .map(pk => ({
      pubkey: pk,
      message: `🗳️ The ${voterRole} voted on escrow ${escrowId}. Check status at satoshimarket.app`,
    }));
  if (recipients.length > 0) sendDMBatch(recipients).catch(() => {});
}

/** 2-of-3 consensus reached — escrow resolved. */
export function notifyEscrowResolved(
  escrowId: string, outcome: "release" | "refund",
  sellerPk: string, buyerPk: string, arbiterPk: string
): void {
  const winnerPk = outcome === "release" ? buyerPk : sellerPk;
  const all = [sellerPk, buyerPk, arbiterPk];
  const recipients = all
    .filter(pk => pk && shouldNotify(pk, "escrow"))
    .map(pk => ({
      pubkey: pk,
      message: pk === winnerPk
        ? `🎉 Escrow ${escrowId} resolved: ${outcome}. Claim your sats at satoshimarket.app`
        : `📋 Escrow ${escrowId} resolved: ${outcome}. Details at satoshimarket.app`,
    }));
  if (recipients.length > 0) sendDMBatch(recipients).catch(() => {});
}

/** Payout complete — winner got their sats. */
export function notifyEscrowCompleted(escrowId: string, winnerPk: string): void {
  if (winnerPk && shouldNotify(winnerPk, "escrow")) {
    sendDM(winnerPk, `⚡ Payout complete for escrow ${escrowId}. Sats sent to your Lightning invoice. satoshimarket.app`).catch(() => {});
  }
}

// ══════════════════════════════════════════════════════════════════════════
// MARKETPLACE NOTIFICATION TRIGGERS
//
// Called from src/routes/marketplace.ts at purchase, order sync, and rating.
// ══════════════════════════════════════════════════════════════════════════

/** Listing purchased — notify seller + buyer. */
export function notifyListingPurchased(
  listingId: string, listingTitle: string,
  sellerPk: string, buyerPk: string, escrowId: string
): void {
  const title = listingTitle.length > 40 ? listingTitle.slice(0, 37) + "…" : listingTitle;

  if (sellerPk && shouldNotify(sellerPk, "listing")) {
    sendDM(sellerPk, `🛒 "${title}" purchased! Escrow ${escrowId} created. Lock your sats to begin the trade. satoshimarket.app`).catch(() => {});
  }
  if (buyerPk && shouldNotify(buyerPk, "order")) {
    sendDM(buyerPk, `✅ Purchase confirmed: "${title}". Escrow ${escrowId} — waiting for seller to lock sats. satoshimarket.app`).catch(() => {});
  }
}

/** Order status changed (from sync with escrow state). */
export function notifyOrderStatusChange(
  orderId: string, newStatus: string, buyerPk: string, sellerPk: string
): void {
  const msgs: Record<string, string> = {
    active: "🔒 Sats locked — trade is live.",
    completed: "🎉 Trade completed! Leave a rating for your partner.",
    expired: "⏰ Trade expired.",
    cancelled: "❌ Order cancelled.",
  };
  const msg = msgs[newStatus];
  if (!msg) return;

  const recipients: Array<{ pubkey: string; message: string }> = [];
  if (buyerPk && shouldNotify(buyerPk, "order"))
    recipients.push({ pubkey: buyerPk, message: `Order ${orderId}: ${msg} satoshimarket.app` });
  if (sellerPk && shouldNotify(sellerPk, "order"))
    recipients.push({ pubkey: sellerPk, message: `Order ${orderId}: ${msg} satoshimarket.app` });
  if (recipients.length > 0) sendDMBatch(recipients).catch(() => {});
}

/** New rating received. */
export function notifyNewRating(ratedPk: string, score: number, raterPk: string): void {
  if (ratedPk && shouldNotify(ratedPk, "order")) {
    const stars = "⭐".repeat(score);
    sendDM(ratedPk, `${stars} New ${score}/5 rating from ${truncPk(raterPk)}. View profile at satoshimarket.app`).catch(() => {});
  }
}
