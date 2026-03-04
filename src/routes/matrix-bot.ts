// src/matrix-bot.ts — SatoshiMarket Matrix Notification Bot
//
// Posts trade notifications to a community room via the Fedi Matrix homeserver.
// Fedi suppresses DMs from bots, so we post to the shared room instead.
//
// Configure via .env:
//   MATRIX_ACCESS_TOKEN=syt_...
//   MATRIX_HOMESERVER=https://m1.8fa.in
//   MATRIX_ROOM_ID=!kENaQZKCKhRhawCjxf:m1.8fa.in
//
// To change rooms later, just update MATRIX_ROOM_ID and restart.

// ── Configuration ─────────────────────────────────────────────────────

const MATRIX_HOMESERVER = process.env.MATRIX_HOMESERVER || "https://m1.8fa.in";
const MATRIX_ACCESS_TOKEN = process.env.MATRIX_ACCESS_TOKEN || "";
const MATRIX_ROOM_ID = process.env.MATRIX_ROOM_ID || "!kENaQZKCKhRhawCjxf:m1.8fa.in";
const BOT_ENABLED = !!MATRIX_ACCESS_TOKEN && !!MATRIX_ROOM_ID;

// ── Core Matrix API ───────────────────────────────────────────────────

async function matrixFetch(path: string, opts: RequestInit = {}): Promise<any> {
  const url = `${MATRIX_HOMESERVER}/_matrix/client/v3${path}`;
  const res = await fetch(url, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${MATRIX_ACCESS_TOKEN}`,
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error(`[matrix-bot] ${res.status} ${path}: ${text}`);
    return null;
  }
  return res.json();
}

async function post(body: string): Promise<boolean> {
  if (!BOT_ENABLED) return false;
  try {
    const txnId = `m${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const encodedRoom = encodeURIComponent(MATRIX_ROOM_ID);
    const data = await matrixFetch(`/rooms/${encodedRoom}/send/m.room.message/${txnId}`, {
      method: "PUT",
      body: JSON.stringify({ msgtype: "m.text", body }),
    });
    const ok = !!data?.event_id;
    console.log(`[matrix-bot] ${ok ? "posted ✅" : "FAILED ❌"}: ${body.slice(0, 80)}...`);
    return ok;
  } catch (err) {
    console.error("[matrix-bot] post error:", err);
    return false;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────

function fmtSats(msats: number): string {
  return Math.floor(msats / 1000).toLocaleString();
}

// ── Escrow event notifications ────────────────────────────────────────

interface EscrowInfo {
  id: string;
  amountMsats: number;
  description?: string;
  sellerPubkey: string;
  buyerPubkey?: string | null;
  arbiterPubkey?: string | null;
}

const bot = {

  // Trade created / someone joined
  async notifyJoin(escrow: EscrowInfo, joinerRole: "buyer" | "arbiter") {
    if (!BOT_ENABLED) return;
    console.log(`[matrix-bot] notifyJoin — escrow=${escrow.id}, role=${joinerRole}`);

    const amount = fmtSats(escrow.amountMsats);
    const desc = escrow.description || "Trade";
    const allIn = escrow.buyerPubkey && escrow.arbiterPubkey;

    await post(
      `🤝 New trade: ${desc}\n` +
      `Escrow ${escrow.id} — ₿ ${amount}\n` +
      (allIn
        ? "All 3 participants joined — seller can now lock sats!"
        : `Waiting for ${!escrow.buyerPubkey ? "buyer" : ""}${!escrow.buyerPubkey && !escrow.arbiterPubkey ? " and " : ""}${!escrow.arbiterPubkey ? "arbiter" : ""} to join.`)
    );
  },

  // Sats locked in escrow
  async notifyLocked(escrow: EscrowInfo) {
    if (!BOT_ENABLED) return;
    console.log(`[matrix-bot] notifyLocked — escrow=${escrow.id}`);

    const amount = fmtSats(escrow.amountMsats);
    await post(`🔒 ₿ ${amount} locked in escrow ${escrow.id}. Trade is live — waiting for votes.`);
  },

  // Escrow resolved (2-of-3 agree)
  async notifyResolved(escrow: EscrowInfo, outcome: "release" | "refund") {
    if (!BOT_ENABLED) return;
    console.log(`[matrix-bot] notifyResolved — escrow=${escrow.id}, outcome=${outcome}`);

    const amount = fmtSats(escrow.amountMsats);
    const action = outcome === "release" ? "released to buyer" : "refunded to seller";
    await post(`✅ Escrow ${escrow.id} resolved — ₿ ${amount} ${action}.`);
  },

  // Payout completed
  async notifyPayout(escrow: EscrowInfo) {
    if (!BOT_ENABLED) return;

    const amount = fmtSats(escrow.amountMsats);
    await post(`⚡ ₿ ${amount} paid out from escrow ${escrow.id}. Trade complete!`);
  },

  // Escrow expired
  async notifyExpired(escrow: EscrowInfo) {
    if (!BOT_ENABLED) return;

    const amount = fmtSats(escrow.amountMsats);
    await post(`⏰ Escrow ${escrow.id} (₿ ${amount}) has expired. Sats auto-refunded.`);
  },
};

// ── Startup ───────────────────────────────────────────────────────────

if (BOT_ENABLED) {
  console.log(`[matrix-bot] ✅ Bot enabled — room: ${MATRIX_ROOM_ID}`);
} else {
  console.log("[matrix-bot] ⚠️  Bot disabled — set MATRIX_ACCESS_TOKEN and MATRIX_ROOM_ID in .env");
}

export { bot as matrixBot };
export default bot;
