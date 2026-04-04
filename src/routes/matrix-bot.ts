// src/matrix-bot.ts — SatoshiMarket Matrix Notification Bot
//
// Posts trade notifications to community rooms via the Fedi Matrix homeserver.
// Automatically detects the correct room from the escrow's communityLink
// and posts in the appropriate language.
//
// Room → Language mapping:
//   !kENaQZKCKhRhawCjxf:m1.8fa.in → English (default)
//   !qHlVxBJBCKqUbetBnA:m1.8fa.in → French
//
// To add a new room/language, add it to ROOM_LANG below.

// ── Configuration ─────────────────────────────────────────────────────

const MATRIX_HOMESERVER = process.env.MATRIX_HOMESERVER || "https://m1.8fa.in";
const MATRIX_ACCESS_TOKEN = process.env.MATRIX_ACCESS_TOKEN || "";
const DEFAULT_ROOM = "!kENaQZKCKhRhawCjxf:m1.8fa.in";
const BOT_ENABLED = !!MATRIX_ACCESS_TOKEN;

// Room → language mapping (add new rooms here)
const ROOM_LANG: Record<string, string> = {
  "!kENaQZKCKhRhawCjxf:m1.8fa.in": "en",
  "!qHlVxBJBCKqUbetBnA:m1.8fa.in": "fr",
};

// ── i18n — notification messages ──────────────────────────────────────

interface MsgSet {
  join: (desc: string, id: string, amount: string, status: string) => string;
  locked: (amount: string, id: string) => string;
  resolved: (id: string, amount: string, action: string) => string;
  payout: (amount: string, id: string) => string;
  expired: (id: string, amount: string) => string;
  allIn: string;
  waitBuyer: string;
  waitArbiter: string;
  waitBoth: string;
  releasedToBuyer: string;
  refundedToSeller: string;
}

const messages: Record<string, MsgSet> = {
  en: {
    join: (desc, id, amount, status) =>
      `🤝 New trade: ${desc}\nEscrow ${id} — ₿ ${amount}\n${status}`,
    locked: (amount, id) =>
      `🔒 ₿ ${amount} locked in escrow ${id}. Trade is live — waiting for votes.`,
    resolved: (id, amount, action) =>
      `✅ Escrow ${id} resolved — ₿ ${amount} ${action}.`,
    payout: (amount, id) =>
      `⚡ ₿ ${amount} paid out from escrow ${id}. Trade complete!`,
    expired: (id, amount) =>
      `⏰ Escrow ${id} (₿ ${amount}) has expired. Sats auto-refunded.`,
    allIn: "All 3 participants joined — seller can now lock sats!",
    waitBuyer: "buyer",
    waitArbiter: "arbiter",
    waitBoth: "buyer and arbiter",
    releasedToBuyer: "released to buyer",
    refundedToSeller: "refunded to seller",
  },
  fr: {
    join: (desc, id, amount, status) =>
      `🤝 Nouveau trade : ${desc}\nEscrow ${id} — ₿ ${amount}\n${status}`,
    locked: (amount, id) =>
      `🔒 ₿ ${amount} verrouillé dans l'escrow ${id}. Le trade est en cours — en attente des votes.`,
    resolved: (id, amount, action) =>
      `✅ Escrow ${id} résolu — ₿ ${amount} ${action}.`,
    payout: (amount, id) =>
      `⚡ ₿ ${amount} versé depuis l'escrow ${id}. Trade terminé !`,
    expired: (id, amount) =>
      `⏰ Escrow ${id} (₿ ${amount}) a expiré. Sats remboursés automatiquement.`,
    allIn: "Les 3 participants sont là — le vendeur peut verrouiller les sats !",
    waitBuyer: "acheteur",
    waitArbiter: "arbitre",
    waitBoth: "acheteur et arbitre",
    releasedToBuyer: "libéré à l'acheteur",
    refundedToSeller: "remboursé au vendeur",
  },
};

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

async function postToRoom(roomId: string, body: string): Promise<boolean> {
  if (!BOT_ENABLED) return false;
  try {
    const txnId = `m${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const encodedRoom = encodeURIComponent(roomId);
    const data = await matrixFetch(`/rooms/${encodedRoom}/send/m.room.message/${txnId}`, {
      method: "PUT",
      body: JSON.stringify({ msgtype: "m.text", body }),
    });
    const ok = !!data?.event_id;
    console.log(`[matrix-bot] ${ok ? "posted ✅" : "FAILED ❌"} (${roomId.slice(0, 12)}): ${body.slice(0, 60)}...`);
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

// Extract Matrix room ID from Fedi community link
// "fedi:room:!kENaQZKCKhRhawCjxf:m1.8fa.in:::" → "!kENaQZKCKhRhawCjxf:m1.8fa.in"
function extractRoomId(communityLink?: string): string {
  if (!communityLink) return DEFAULT_ROOM;
  const m = communityLink.match(/^fedi:room:(![a-zA-Z0-9]+:[a-zA-Z0-9.-]+):::$/);
  return m ? m[1] : DEFAULT_ROOM;
}

function getLang(roomId: string): string {
  return ROOM_LANG[roomId] || "en";
}

function getMsg(roomId: string): MsgSet {
  return messages[getLang(roomId)] || messages.en;
}

// ── Escrow event notifications ────────────────────────────────────────

interface EscrowInfo {
  id: string;
  amountMsats: number;
  description?: string;
  communityLink?: string;
  sellerPubkey: string;
  buyerPubkey?: string | null;
  arbiterPubkey?: string | null;
}

const bot = {

  // Trade created / someone joined
  async notifyJoin(escrow: EscrowInfo, joinerRole: "buyer" | "arbiter") {
    if (!BOT_ENABLED) return;
    const roomId = extractRoomId(escrow.communityLink);
    const m = getMsg(roomId);
    console.log(`[matrix-bot] notifyJoin — escrow=${escrow.id}, room=${roomId.slice(0, 12)}, lang=${getLang(roomId)}`);

    const amount = fmtSats(escrow.amountMsats);
    const desc = escrow.description || "Trade";
    const allIn = escrow.buyerPubkey && escrow.arbiterPubkey;

    const status = allIn
      ? m.allIn
      : `Waiting for ${!escrow.buyerPubkey && !escrow.arbiterPubkey ? m.waitBoth : !escrow.buyerPubkey ? m.waitBuyer : m.waitArbiter} to join.`;

    await postToRoom(roomId, m.join(desc, escrow.id, amount, status));
  },

  // Sats locked in escrow
  async notifyLocked(escrow: EscrowInfo) {
    if (!BOT_ENABLED) return;
    const roomId = extractRoomId(escrow.communityLink);
    const m = getMsg(roomId);
    console.log(`[matrix-bot] notifyLocked — escrow=${escrow.id}, lang=${getLang(roomId)}`);

    await postToRoom(roomId, m.locked(fmtSats(escrow.amountMsats), escrow.id));
  },

  // Escrow resolved (2-of-3 agree)
  async notifyResolved(escrow: EscrowInfo, outcome: "release" | "refund") {
    if (!BOT_ENABLED) return;
    const roomId = extractRoomId(escrow.communityLink);
    const m = getMsg(roomId);
    console.log(`[matrix-bot] notifyResolved — escrow=${escrow.id}, outcome=${outcome}, lang=${getLang(roomId)}`);

    const action = outcome === "release" ? m.releasedToBuyer : m.refundedToSeller;
    await postToRoom(roomId, m.resolved(escrow.id, fmtSats(escrow.amountMsats), action));
  },

  // Payout completed
  async notifyPayout(escrow: EscrowInfo) {
    if (!BOT_ENABLED) return;
    const roomId = extractRoomId(escrow.communityLink);
    const m = getMsg(roomId);

    await postToRoom(roomId, m.payout(fmtSats(escrow.amountMsats), escrow.id));
  },

  // Escrow expired
  async notifyExpired(escrow: EscrowInfo) {
    if (!BOT_ENABLED) return;
    const roomId = extractRoomId(escrow.communityLink);
    const m = getMsg(roomId);

    await postToRoom(roomId, m.expired(escrow.id, fmtSats(escrow.amountMsats)));
  },

  // New listing created — broadcast to community rooms
  async notifyNewListing(listing: { id: string; title: string; priceMsats: number; minPriceMsats?: number; maxPriceMsats?: number; category: string; sellerFedPrefix?: string; sellerFedDomain?: string; federationOnly?: boolean; terms?: string; paymentMethods?: string[] }) {
    if (!BOT_ENABLED) return;
    const hasRange = listing.minPriceMsats && listing.maxPriceMsats && listing.minPriceMsats !== listing.maxPriceMsats;
    const amount = hasRange ? `${fmtSats(listing.minPriceMsats!)} — ${fmtSats(listing.maxPriceMsats!)}` : fmtSats(listing.priceMsats);
    const tag = listing.category === "bill-pay" ? "🧾 Bill Pay" : listing.category === "lending" ? "🤝 Lending" : listing.category === "sats-for-fiat" ? "₿ P2P Trade" : "🛒 " + (listing.category || "Item");
    const vip = listing.federationOnly ? " 🔒 Federation Only" : "";
    const rateMatch = (listing.terms || "").match(/Rate:\s*(\d+)/);
    const premium = rateMatch ? ` 📈 ${rateMatch[1]}% premium` : "";
    // Extract fiat info and payment methods from terms
    const fiatMatch = (listing.terms || "").match(/Fiat needed:\s*(\w+)\s+([\d.]+)/);
    const fiatLine = fiatMatch ? `\n💵 ${fiatMatch[1]} ${fiatMatch[2]}` : "";
    const pmMatch = (listing.terms || "").match(/Payment Methods?:\s*(.+)/i);
    const pmNames: Record<string,string> = { mpesa: "M-Pesa", airtel: "Airtel", mtn: "MTN", orange: "Orange", wave: "Wave", opay: "OPay", chipper: "Chipper", cashapp: "Cash App", zelle: "Zelle", venmo: "Venmo", wise: "Wise", paypal: "PayPal", bank: "Bank", cash: "Cash", revolut: "Revolut", pix: "PIX", upi: "UPI", gcash: "GCash", ecocash: "EcoCash" };
    const pmLine = (listing.paymentMethods || []).length > 0 ? `\n💳 ${(listing.paymentMethods || []).map((k: string) => pmNames[k] || k).join(", ")}` : "";
    const body = `📢 New listing: ${listing.title}\n${tag} — ₿ ${amount} sats${premium}${fiatLine}${pmLine}${vip}\n🔗 ID: ${listing.id}`;
    // Post to default rooms
    for (const roomId of Object.keys(ROOM_LANG)) {
      await postToRoom(roomId, body);
    }

    // Also post to arbiter community rooms matching this federation
    try {
      const db = (await import("../db")).default;
      const arbiters = db.prepare("SELECT community_room FROM arbiter_applications WHERE status = 'approved' AND community_room IS NOT NULL AND fed_ecash_prefix = ?").all(listing.sellerFedPrefix || "") as any[];
      for (const a of arbiters) {
        if (a.community_room) {
          // Extract Matrix room ID from fedi:community link if needed
          const roomId = extractRoomId(a.community_room) || DEFAULT_ROOM;
          if (roomId !== DEFAULT_ROOM && !ROOM_LANG[roomId]) {
            await postToRoom(roomId, body);
          }
        }
      }
    } catch (err) {
      console.error("[matrix-bot] arbiter room lookup error:", err);
    }
  },
};

// ── Startup ───────────────────────────────────────────────────────────

if (BOT_ENABLED) {
  const rooms = Object.entries(ROOM_LANG).map(([r, l]) => `${l}:${r.slice(0, 15)}`).join(", ");
  console.log(`[matrix-bot] ✅ Bot enabled — rooms: ${rooms}`);
} else {
  console.log("[matrix-bot] ⚠️  Bot disabled — set MATRIX_ACCESS_TOKEN in .env");
}

export { bot as matrixBot };
export default bot;
