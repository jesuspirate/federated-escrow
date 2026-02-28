// src/nostr-dm.ts — Nostr DM Notification System (NIP-44)
//
// Phase 5: Server-side encrypted DM notifications via Nostr relays.
//
// Uses NIP-44 (ChaCha20 + HMAC-SHA256) per Fedi's recommendation:
//   "We strongly recommend you use NIP-44 since NIP-04 is NOT considered
//    secure for production usage."
//   — https://fedibtc.github.io/fedi-docs/docs/miniapps/developers/miniapp-integration
//
// The server holds a dedicated notification bot keypair (NOSTR_BOT_PRIVKEY).
// When escrow/marketplace events occur, this module encrypts a message
// using NIP-44 and publishes a kind:4 event to configured relays.
//
// Users receive DMs in any Nostr client that supports NIP-44 decryption
// (Damus, Amethyst, Primal, Fedi, etc.)

import { finalizeEvent, getPublicKey } from "nostr-tools/pure";
import { v2 as nip44 } from "nostr-tools/nip44";
import WebSocket from "ws";

// ── Configuration ─────────────────────────────────────────────────────────

const BOT_PRIVKEY_HEX = process.env.NOSTR_BOT_PRIVKEY || "";
const RELAY_URLS = (process.env.NOSTR_RELAYS || "wss://relay.damus.io,wss://relay.primal.net,wss://nos.lol")
  .split(",").map(s => s.trim()).filter(Boolean);
const DM_ENABLED = BOT_PRIVKEY_HEX.length === 64;

// Derive bot keypair from hex privkey
// nostr-tools: generateSecretKey() returns Uint8Array(32)
//              getPublicKey() takes Uint8Array, returns hex string
//              finalizeEvent() takes Uint8Array sk
//              nip44.utils.getConversationKey() takes Uint8Array sk + hex pubkey

let BOT_SK: Uint8Array = new Uint8Array(32);
let BOT_PUBKEY = "";

if (DM_ENABLED) {
  try {
    // Convert hex privkey to Uint8Array
    BOT_SK = new Uint8Array(32);
    for (let i = 0; i < 64; i += 2) {
      BOT_SK[i / 2] = parseInt(BOT_PRIVKEY_HEX.substring(i, i + 2), 16);
    }
    BOT_PUBKEY = getPublicKey(BOT_SK);
    console.log(`📨 Nostr DM notifications enabled (NIP-44) — bot: ${BOT_PUBKEY.slice(0, 12)}…`);
    console.log(`📡 Relays: ${RELAY_URLS.join(", ")}`);
  } catch (err) {
    console.error("❌ Invalid NOSTR_BOT_PRIVKEY — DM notifications disabled");
  }
}

if (!DM_ENABLED) {
  console.log("ℹ️  Nostr DM notifications disabled (set NOSTR_BOT_PRIVKEY to enable)");
}

// ── Dev pubkey filter ─────────────────────────────────────────────────────
// Same sandbox pubkeys used in ecash-escrow.ts and Marketplace.jsx

const DEV_PUBKEYS = new Set([
  "aa".repeat(32),  // seller
  "bb".repeat(32),  // buyer
  "cc".repeat(32),  // arbiter
]);

// ── NIP-44 Encryption ─────────────────────────────────────────────────────
//
// NIP-44 uses ChaCha20 + HMAC-SHA256, replacing NIP-04's AES-256-CBC.
// Benefits over NIP-04:
//   - Authenticated encryption (HMAC prevents tampering)
//   - Message length padding (reduces metadata leakage)
//   - Audited spec (Cure53 audit, Dec 2023)
//   - ~5x faster than NIP-04 in benchmarks
//
// nostr-tools API:
//   const convKey = nip44.utils.getConversationKey(privkeyBytes, pubkeyHex)
//   const ciphertext = nip44.encrypt(plaintext, convKey)
//   const plaintext = nip44.decrypt(ciphertext, convKey)

function nip44Encrypt(recipientPubkeyHex: string, plaintext: string): string {
  const conversationKey = nip44.utils.getConversationKey(BOT_SK, recipientPubkeyHex);
  return nip44.encrypt(plaintext, conversationKey);
}

// ── Event Construction & Signing ──────────────────────────────────────────
//
// Uses nostr-tools/pure.finalizeEvent() which:
//   1. Serializes the event per NIP-01
//   2. SHA256 hashes to get the event ID
//   3. Schnorr-signs with the bot's private key
//   4. Returns a complete, publishable NostrEvent

function createSignedDMEvent(recipientPubkeyHex: string, encryptedContent: string) {
  return finalizeEvent({
    kind: 4,
    created_at: Math.floor(Date.now() / 1000),
    tags: [["p", recipientPubkeyHex]],
    content: encryptedContent,
  }, BOT_SK);
}

// ── Relay Publishing ──────────────────────────────────────────────────────
//
// Publishes events directly via WebSocket (ws package).
// Each relay gets an 8-second timeout. We publish to all relays in parallel
// and consider the send successful if at least 1 relay accepts.

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
        // Nostr relay response: ["OK", event_id, accepted, message]
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
 * Send a NIP-44 encrypted DM to a Nostr pubkey.
 * Fire-and-forget: failures are logged but never throw.
 */
export async function sendDM(recipientPubkey: string, message: string): Promise<boolean> {
  if (!DM_ENABLED) return false;
  if (!recipientPubkey || recipientPubkey.length !== 64) return false;

  // Skip dev/sandbox pubkeys
  if (DEV_PUBKEYS.has(recipientPubkey)) return false;

  try {
    const encrypted = nip44Encrypt(recipientPubkey, message);
    const event = createSignedDMEvent(recipientPubkey, encrypted);

    console.log(`📨 DM → ${recipientPubkey.slice(0, 8)}… (${message.length} chars, NIP-44)`);
    const { successes, failures } = await publishToRelays(event);
    console.log(`  ✅ ${successes}/${successes + failures} relays accepted`);

    return successes > 0;
  } catch (err: any) {
    console.error(`❌ DM failed → ${recipientPubkey.slice(0, 8)}…:`, err.message);
    return false;
  }
}

/**
 * Send DMs to multiple recipients (e.g., all escrow participants).
 * Each recipient gets their own encrypted event (NIP-44 is per-recipient).
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
