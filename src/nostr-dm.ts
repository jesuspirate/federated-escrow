// src/nostr-dm.ts — Nostr DM Notification System (NIP-17 Gift Wrap)
//
// Uses NIP-17 (Gift Wrap) with NIP-44 encryption for private DMs.
// This is the modern standard supported by all major Nostr clients:
//   Amethyst, 0xchat, Primal, Damus, Yakihonne, etc.
//
// Protocol: kind:14 (sealed DM) wrapped in kind:1059 (gift wrap)
// Encryption: NIP-44 (ChaCha20 + HMAC-SHA256) — per Fedi's recommendation
//
// The server holds a dedicated notification bot keypair (NOSTR_BOT_PRIVKEY).
// When escrow/marketplace events occur, this module wraps a message
// using NIP-17 Gift Wrap and publishes the kind:1059 event to relays.
//
// Users receive DMs in any Nostr client that supports NIP-17.

import { getPublicKey } from "nostr-tools/pure";
import { wrapEvent } from "nostr-tools/nip17";
import WebSocket from "ws";

// ── Configuration ─────────────────────────────────────────────────────────

const BOT_PRIVKEY_HEX = process.env.NOSTR_BOT_PRIVKEY || "";
const RELAY_URLS = (process.env.NOSTR_RELAYS || "wss://relay.primal.net,wss://nos.lol,wss://relay.nostr.band")
  .split(",").map(s => s.trim()).filter(Boolean);
const DM_ENABLED = BOT_PRIVKEY_HEX.length === 64;

// Derive bot keypair
let BOT_SK: Uint8Array = new Uint8Array(32);
let BOT_PUBKEY = "";

if (DM_ENABLED) {
  try {
    BOT_SK = new Uint8Array(32);
    for (let i = 0; i < 64; i += 2) {
      BOT_SK[i / 2] = parseInt(BOT_PRIVKEY_HEX.substring(i, i + 2), 16);
    }
    BOT_PUBKEY = getPublicKey(BOT_SK);
    console.log(`📨 Nostr DM notifications enabled (NIP-17 Gift Wrap) — bot: ${BOT_PUBKEY.slice(0, 12)}…`);
    console.log(`📡 Relays: ${RELAY_URLS.join(", ")}`);
  } catch (err) {
    console.error("❌ Invalid NOSTR_BOT_PRIVKEY — DM notifications disabled");
  }
}

if (!DM_ENABLED) {
  console.log("ℹ️  Nostr DM notifications disabled (set NOSTR_BOT_PRIVKEY to enable)");
}

// ── Dev pubkey filter ─────────────────────────────────────────────────────

const DEV_PUBKEYS = new Set([
  "aa".repeat(32),
  "bb".repeat(32),
  "cc".repeat(32),
]);

// ── Relay Publishing ──────────────────────────────────────────────────────

const RELAY_TIMEOUT_MS = 8000;

interface NostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

function publishToRelay(relayUrl: string, event: NostrEvent): Promise<boolean> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      try { ws.close(); } catch {}
      resolve(false);
    }, RELAY_TIMEOUT_MS);

    let ws: WebSocket;
    try {
      ws = new WebSocket(relayUrl);
    } catch {
      clearTimeout(timeout);
      resolve(false);
      return;
    }

    ws.on("open", () => {
      ws.send(JSON.stringify(["EVENT", event]));
    });

    ws.on("message", (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg[0] === "OK" && msg[1] === event.id) {
          clearTimeout(timeout);
          ws.close();
          resolve(msg[2] === true);
        }
      } catch {}
    });

    ws.on("error", () => {
      clearTimeout(timeout);
      resolve(false);
    });

    ws.on("close", () => {
      clearTimeout(timeout);
    });
  });
}

async function publishToRelays(event: NostrEvent): Promise<{ successes: number; failures: number }> {
  const results = await Promise.allSettled(
    RELAY_URLS.map(url => publishToRelay(url, event))
  );

  let successes = 0;
  let failures = 0;
  results.forEach((r, i) => {
    if (r.status === "fulfilled" && r.value) {
      successes++;
    } else {
      failures++;
      console.warn(`  ⚠️ Relay ${RELAY_URLS[i]}: failed`);
    }
  });

  return { successes, failures };
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Send a NIP-17 Gift Wrapped DM to a Nostr pubkey.
 * Creates kind:14 (sealed) inside kind:1059 (gift wrap).
 * Fire-and-forget: failures are logged but never throw.
 */
export async function sendDM(recipientPubkey: string, message: string): Promise<boolean> {
  if (!DM_ENABLED) return false;
  if (!recipientPubkey || recipientPubkey.length !== 64) return false;

  // Skip dev/sandbox pubkeys
  if (DEV_PUBKEYS.has(recipientPubkey)) return false;

  try {
    // NIP-17 Gift Wrap: creates kind:1059 event with NIP-44 encrypted kind:14 inside
    const wrappedEvent = wrapEvent(
      BOT_SK,
      { publicKey: recipientPubkey },
      message,
      "SatoshiMarket" // conversationTitle
    );

    console.log(`📨 DM → ${recipientPubkey.slice(0, 8)}… (${message.length} chars, NIP-17 Gift Wrap)`);
    const { successes, failures } = await publishToRelays(wrappedEvent as unknown as NostrEvent);
    console.log(`  ✅ ${successes}/${successes + failures} relays accepted`);

    return successes > 0;
  } catch (err: any) {
    console.error(`❌ DM failed → ${recipientPubkey.slice(0, 8)}…:`, err.message);
    return false;
  }
}

/**
 * Send DMs to multiple recipients.
 * Each recipient gets their own Gift Wrapped event.
 */
export async function sendDMBatch(
  recipients: Array<{ pubkey: string; message: string }>
): Promise<void> {
  if (!DM_ENABLED) return;
  await Promise.allSettled(
    recipients.map(({ pubkey, message }) => sendDM(pubkey, message))
  );
}

/** Check if DM notifications are configured and operational. */
export function isDMEnabled(): boolean { return DM_ENABLED; }

/** Get the bot's public key (for display in notification settings). */
export function getBotPubkey(): string { return BOT_PUBKEY; }

/** Get configured relay URLs. */
export function getRelayUrls(): string[] { return [...RELAY_URLS]; }
