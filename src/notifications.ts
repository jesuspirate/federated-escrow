// src/notifications.ts — Notification Templates & Trigger Logic
//
// Maps escrow and marketplace state transitions to Nostr DM messages.
//
// Design principles:
//   1. Fire-and-forget — notifications never block the main request
//   2. Respect opt-outs — check preferences table before sending
//   3. Rich details in DMs — amounts, descriptions, next steps (encrypted via NIP-17)
//   4. Idempotent — duplicate sends are harmless (each Nostr event has unique ID)

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

const APP = "https://satoshimarket.app";

function shouldNotify(pubkey: string, category: "escrow" | "order" | "listing"): boolean {
  const prefs = getPreferences(pubkey);
  if (!prefs.dmEnabled) return false;
  if (category === "escrow") return prefs.escrowUpdates;
  if (category === "order") return prefs.orderUpdates;
  if (category === "listing") return prefs.listingSold;
  return true;
}

function fmtSats(msats: number): string {
  const sats = Math.floor(msats / 1000);
  return sats >= 1_000_000 ? `${(sats / 1_000_000).toFixed(1)}M` : sats.toLocaleString();
}

function truncPk(hex: string): string {
  return hex.slice(0, 8) + "…";
}

// ══════════════════════════════════════════════════════════════════════════
// ESCROW NOTIFICATION TRIGGERS
// ══════════════════════════════════════════════════════════════════════════

/** Someone joined an escrow — notify the other participants. */
export function notifyEscrowJoin(
  escrowId: string, joinerPubkey: string, joinerRole: string, otherPubkeys: string[]
): void {
  const recipients = otherPubkeys
    .filter(pk => pk && pk !== joinerPubkey && shouldNotify(pk, "escrow"))
    .map(pk => ({
      pubkey: pk,
      message: `🤝 SatoshiMarket — New participant\n\nA ${joinerRole} joined your trade ${escrowId}.\n\nOpen your Fedi app to continue.`,
    }));
  if (recipients.length > 0) sendDMBatch(recipients).catch(() => {});
}

/** All 3 participants joined — escrow is FUNDED. */
export function notifyEscrowFunded(
  escrowId: string, sellerPk: string, buyerPk: string, arbiterPk: string,
  amountMsats?: number, description?: string
): void {
  const amt = amountMsats ? `\n₿ ${fmtSats(amountMsats)} sats` : "";
  const desc = description ? `\n"${description}"` : "";
  const all = [sellerPk, buyerPk, arbiterPk];
  const recipients = all
    .filter(pk => pk && shouldNotify(pk, "escrow"))
    .map(pk => {
      const isSeller = pk === sellerPk;
      return {
        pubkey: pk,
        message: isSeller
          ? `✅ SatoshiMarket — All parties joined!\n\nTrade ${escrowId}${amt}${desc}\n\n🔒 Open Fedi and lock your sats to start the trade.`
          : `✅ SatoshiMarket — All parties joined!\n\nTrade ${escrowId}${amt}${desc}\n\nWaiting for the seller to lock sats.`,
      };
    });
  if (recipients.length > 0) sendDMBatch(recipients).catch(() => {});
}

/** Sats locked in escrow — trade is live. */
export function notifyEscrowLocked(
  escrowId: string, sellerPk: string, buyerPk: string, arbiterPk: string,
  amountMsats?: number, description?: string
): void {
  const amt = amountMsats ? ` (₿ ${fmtSats(amountMsats)})` : "";
  const desc = description ? `\n"${description}"` : "";

  const recipients: Array<{ pubkey: string; message: string }> = [];

  if (buyerPk && shouldNotify(buyerPk, "escrow")) {
    recipients.push({
      pubkey: buyerPk,
      message: `🔒 SatoshiMarket — Sats locked!\n\nTrade ${escrowId}${amt}${desc}\n\nThe seller locked sats in escrow. Complete your side of the deal, then open Fedi to vote and release the sats.`,
    });
  }
  if (arbiterPk && shouldNotify(arbiterPk, "escrow")) {
    recipients.push({
      pubkey: arbiterPk,
      message: `🔒 SatoshiMarket — Trade is live\n\nTrade ${escrowId}${amt}${desc}\n\nSats are locked. You'll be notified if the parties disagree and need your vote.`,
    });
  }
  if (recipients.length > 0) sendDMBatch(recipients).catch(() => {});
}

/** Vote cast — notify the other participants. */
export function notifyEscrowVote(
  escrowId: string, voterPk: string, voterRole: string, otherPubkeys: string[]
): void {
  const recipients = otherPubkeys
    .filter(pk => pk && pk !== voterPk && shouldNotify(pk, "escrow"))
    .map(pk => ({
      pubkey: pk,
      message: `🗳️ SatoshiMarket — Vote cast\n\nThe ${voterRole} voted on trade ${escrowId}.\n\nOpen Fedi to check the status and vote if needed.`,
    }));
  if (recipients.length > 0) sendDMBatch(recipients).catch(() => {});
}

/** 2-of-3 consensus reached — escrow resolved. */
export function notifyEscrowResolved(
  escrowId: string, outcome: "release" | "refund",
  sellerPk: string, buyerPk: string, arbiterPk: string,
  amountMsats?: number
): void {
  const winnerPk = outcome === "release" ? buyerPk : sellerPk;
  const amt = amountMsats ? ` (₿ ${fmtSats(amountMsats)})` : "";
  const all = [sellerPk, buyerPk, arbiterPk];
  const recipients = all
    .filter(pk => pk && shouldNotify(pk, "escrow"))
    .map(pk => ({
      pubkey: pk,
      message: pk === winnerPk
        ? `🎉 SatoshiMarket — You won!\n\nTrade ${escrowId}${amt} resolved: ${outcome}.\n\n⚡ Open Fedi now to claim your sats!`
        : `📋 SatoshiMarket — Trade resolved\n\nTrade ${escrowId}${amt} resolved: ${outcome}.\n\nThe winning party can now claim their sats.`,
    }));
  if (recipients.length > 0) sendDMBatch(recipients).catch(() => {});
}

/** Payout complete — winner got their sats. */
export function notifyEscrowCompleted(escrowId: string, winnerPk: string, amountMsats?: number): void {
  const amt = amountMsats ? ` ₿ ${fmtSats(amountMsats)}` : "";
  if (winnerPk && shouldNotify(winnerPk, "escrow")) {
    sendDM(winnerPk, `⚡ SatoshiMarket — Payout complete!\n\nTrade ${escrowId}:${amt} sent to your Lightning wallet.\n\nCheck your Fedi balance. Thank you for trading! 🥜`).catch(() => {});
  }
}

// ══════════════════════════════════════════════════════════════════════════
// MARKETPLACE NOTIFICATION TRIGGERS
// ══════════════════════════════════════════════════════════════════════════

/** Listing purchased — notify seller + buyer. */
export function notifyListingPurchased(
  listingId: string, listingTitle: string,
  sellerPk: string, buyerPk: string, escrowId: string,
  amountMsats?: number
): void {
  const title = listingTitle.length > 50 ? listingTitle.slice(0, 47) + "…" : listingTitle;
  const amt = amountMsats ? `\n₿ ${fmtSats(amountMsats)} sats` : "";

  if (sellerPk && shouldNotify(sellerPk, "listing")) {
    sendDM(sellerPk, `🛒 SatoshiMarket — Item sold!\n\n"${title}"${amt}\nEscrow: ${escrowId}\n\n🔒 Open Fedi and lock your sats to start the trade.`).catch(() => {});
  }
  if (buyerPk && shouldNotify(buyerPk, "order")) {
    sendDM(buyerPk, `✅ SatoshiMarket — Purchase confirmed!\n\n"${title}"${amt}\nEscrow: ${escrowId}\n\nWaiting for the seller to lock sats. You'll be notified when it's time to vote.`).catch(() => {});
  }
}

/** Order status changed. */
export function notifyOrderStatusChange(
  orderId: string, newStatus: string, buyerPk: string, sellerPk: string
): void {
  const msgs: Record<string, string> = {
    active: "🔒 Sats locked — the trade is live. Open Fedi to continue.",
    completed: "🎉 Trade completed! Open Fedi to leave a rating for your partner.",
    expired: "⏰ Trade expired. The escrow has been auto-refunded.",
    cancelled: "❌ Order cancelled.",
  };
  const msg = msgs[newStatus];
  if (!msg) return;

  const recipients: Array<{ pubkey: string; message: string }> = [];
  if (buyerPk && shouldNotify(buyerPk, "order"))
    recipients.push({ pubkey: buyerPk, message: `📦 SatoshiMarket — Order ${orderId}\n\n${msg}` });
  if (sellerPk && shouldNotify(sellerPk, "order"))
    recipients.push({ pubkey: sellerPk, message: `📦 SatoshiMarket — Order ${orderId}\n\n${msg}` });
  if (recipients.length > 0) sendDMBatch(recipients).catch(() => {});
}

/** New rating received. */
export function notifyNewRating(ratedPk: string, score: number, raterPk: string): void {
  if (ratedPk && shouldNotify(ratedPk, "order")) {
    const stars = "⭐".repeat(score);
    sendDM(ratedPk, `${stars} SatoshiMarket — New rating!\n\nYou received a ${score}/5 rating from ${truncPk(raterPk)}.\n\nOpen Fedi to view your profile.`).catch(() => {});
  }
}
