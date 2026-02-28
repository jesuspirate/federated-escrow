// src/routes/marketplace.ts — Listings CRUD + Purchase Flow + Order Sync + Profiles
//
// Phase 1: Listings CRUD (create, browse, update, delete)
// Phase 2: Purchase flow (buy → auto-create escrow → auto-join buyer + arbiter)
// Phase 3a: Order status sync (on-read sync with escrow state) + cancellation
// Phase 4: Seller profiles (trade stats + ratings)
//
// Mount in server.ts:
//   import marketplaceRoutes from "./routes/marketplace";
//   app.use("/api/marketplace/listings", marketplaceRoutes);

import { Router, Request, Response, NextFunction } from "express";
import { verifyEvent } from "nostr-tools/pure";
import db from "../db";
import * as DB from "../db";
import crypto from "crypto";
import * as Notify from "../notifications";

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

  const devPubkey = req.headers["x-dev-pubkey"] as string;
  if (devPubkey && process.env.ALLOW_DEV_PUBKEY === "true") {
    if (typeof devPubkey === "string" && devPubkey.length === 64) {
      req.pubkey = devPubkey;
      return next();
    }
    return res.status(401).json({ error: "Invalid dev pubkey (must be 64 hex chars)" });
  }

  return res.status(401).json({ error: "Authentication required. Send NIP-98 Authorization header or X-Dev-Pubkey (dev mode only)." });
}

// ── Rate Limiter (per pubkey, same pattern) ──────────────────────────────

const rateLimits = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = Number(process.env.RATE_LIMIT_PER_MIN) || 30;
const RATE_WINDOW_MS = 60_000;

function rateLimit(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const pk = req.pubkey!;
  const now = Date.now();
  let entry = rateLimits.get(pk);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + RATE_WINDOW_MS };
    rateLimits.set(pk, entry);
  }
  entry.count++;
  if (entry.count > RATE_LIMIT) {
    return res.status(429).json({ error: `Rate limit exceeded (${RATE_LIMIT}/min). Try again later.` });
  }
  next();
}

// ── Schema ────────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS listings (
    id              TEXT PRIMARY KEY,
    seller_pubkey   TEXT NOT NULL,
    title           TEXT NOT NULL,
    description     TEXT,
    price_msats     INTEGER NOT NULL,
    currency_display TEXT DEFAULT 'sats',
    category        TEXT,
    condition       TEXT,
    images          TEXT,
    terms           TEXT,
    community_link  TEXT,
    status          TEXT NOT NULL DEFAULT 'active',
    quantity        INTEGER DEFAULT 1,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_listings_seller ON listings(seller_pubkey);
  CREATE INDEX IF NOT EXISTS idx_listings_status ON listings(status);
  CREATE INDEX IF NOT EXISTS idx_listings_category ON listings(category);
  CREATE INDEX IF NOT EXISTS idx_listings_created ON listings(created_at DESC);

  CREATE TABLE IF NOT EXISTS orders (
    id              TEXT PRIMARY KEY,
    listing_id      TEXT NOT NULL REFERENCES listings(id),
    escrow_id       TEXT NOT NULL,
    buyer_pubkey    TEXT NOT NULL,
    seller_pubkey   TEXT NOT NULL,
    arbiter_pubkey  TEXT,
    amount_msats    INTEGER NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending',
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_orders_listing ON orders(listing_id);
  CREATE INDEX IF NOT EXISTS idx_orders_escrow ON orders(escrow_id);
  CREATE INDEX IF NOT EXISTS idx_orders_buyer ON orders(buyer_pubkey);
  CREATE INDEX IF NOT EXISTS idx_orders_seller ON orders(seller_pubkey);
  CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);

  CREATE TABLE IF NOT EXISTS ratings (
    id              TEXT PRIMARY KEY,
    order_id        TEXT NOT NULL REFERENCES orders(id),
    rater_pubkey    TEXT NOT NULL,
    rated_pubkey    TEXT NOT NULL,
    score           INTEGER NOT NULL CHECK(score >= 1 AND score <= 5),
    comment         TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(order_id, rater_pubkey)
  );
  CREATE INDEX IF NOT EXISTS idx_ratings_rated ON ratings(rated_pubkey);
  CREATE INDEX IF NOT EXISTS idx_ratings_rater ON ratings(rater_pubkey);
  CREATE INDEX IF NOT EXISTS idx_ratings_order ON ratings(order_id);
`);

// ── Migration: fix ratings UNIQUE constraint (allow both parties to rate) ──
// Old schema had UNIQUE(order_id) — new schema uses UNIQUE(order_id, rater_pubkey)
try {
  // Check if old unique constraint exists by trying to see column info
  const cols = db.prepare("PRAGMA index_list('ratings')").all() as any[];
  const hasOldUnique = cols.some((idx: any) => idx.unique && idx.name?.includes("order_id") && !idx.name?.includes("rater"));
  // Simpler approach: just recreate the table if it has the wrong constraint
  // SQLite doesn't support ALTER TABLE DROP CONSTRAINT, so we rename + recreate
  const tableInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='ratings'").get() as any;
  if (tableInfo?.sql && tableInfo.sql.includes("order_id") && tableInfo.sql.includes("UNIQUE") && !tableInfo.sql.includes("rater_pubkey")) {
    console.log("[marketplace] Migrating ratings table: UNIQUE(order_id) → UNIQUE(order_id, rater_pubkey)");
    db.exec(`
      ALTER TABLE ratings RENAME TO ratings_old;
      CREATE TABLE ratings (
        id              TEXT PRIMARY KEY,
        order_id        TEXT NOT NULL REFERENCES orders(id),
        rater_pubkey    TEXT NOT NULL,
        rated_pubkey    TEXT NOT NULL,
        score           INTEGER NOT NULL CHECK(score >= 1 AND score <= 5),
        comment         TEXT,
        created_at      TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(order_id, rater_pubkey)
      );
      INSERT INTO ratings SELECT * FROM ratings_old;
      DROP TABLE ratings_old;
      CREATE INDEX IF NOT EXISTS idx_ratings_rated ON ratings(rated_pubkey);
      CREATE INDEX IF NOT EXISTS idx_ratings_rater ON ratings(rater_pubkey);
      CREATE INDEX IF NOT EXISTS idx_ratings_order ON ratings(order_id);
    `);
    console.log("[marketplace] ✅ Ratings table migrated successfully");
  }
} catch (err: any) {
  // If migration fails (table doesn't exist yet or already correct), that's fine
  if (!err.message?.includes("no such table") && !err.message?.includes("already")) {
    console.warn("[marketplace] Ratings migration note:", err.message?.slice(0, 100));
  }
}

// ── Arbiter Allowlist ─────────────────────────────────────────────────────

const ALLOWED_ARBITERS: string[] = (() => {
  const raw = process.env.ALLOWED_ARBITERS;
  if (!raw || raw.trim() === "") return [];
  return raw.split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
})();

function pickArbiter(excludePubkeys: string[]): string | null {
  const exclude = new Set(excludePubkeys.map(pk => pk.toLowerCase()));
  const eligible = ALLOWED_ARBITERS.filter(pk => !exclude.has(pk));
  if (eligible.length === 0) return null;
  return eligible[Math.floor(Math.random() * eligible.length)];
}

// ── Prepared Statements ───────────────────────────────────────────────────

const stmts = {
  // Listings
  insert: db.prepare(`
    INSERT INTO listings (id, seller_pubkey, title, description, price_msats, currency_display, category, condition, images, terms, community_link, status, quantity)
    VALUES (@id, @seller_pubkey, @title, @description, @price_msats, @currency_display, @category, @condition, @images, @terms, @community_link, 'active', @quantity)
  `),
  getById: db.prepare(`SELECT * FROM listings WHERE id = ?`),
  listActive: db.prepare(`SELECT * FROM listings WHERE status = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`),
  listBySeller: db.prepare(`SELECT * FROM listings WHERE seller_pubkey = ? ORDER BY created_at DESC`),
  listByCategory: db.prepare(`SELECT * FROM listings WHERE status = 'active' AND category = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`),
  search: db.prepare(`
    SELECT * FROM listings WHERE status = 'active'
    AND (title LIKE ? OR description LIKE ? OR category LIKE ?)
    ORDER BY created_at DESC LIMIT ? OFFSET ?
  `),
  decrementQuantity: db.prepare(`UPDATE listings SET quantity = quantity - 1, updated_at = datetime('now') WHERE id = ? AND quantity > 0`),
  markSold: db.prepare(`UPDATE listings SET status = 'sold', updated_at = datetime('now') WHERE id = ? AND quantity <= 0`),

  // Orders
  insertOrder: db.prepare(`
    INSERT INTO orders (id, listing_id, escrow_id, buyer_pubkey, seller_pubkey, arbiter_pubkey, amount_msats, status)
    VALUES (@id, @listing_id, @escrow_id, @buyer_pubkey, @seller_pubkey, @arbiter_pubkey, @amount_msats, @status)
  `),
  getOrder: db.prepare(`SELECT * FROM orders WHERE id = ?`),
  getOrderByEscrow: db.prepare(`SELECT * FROM orders WHERE escrow_id = ?`),
  getOrdersByBuyer: db.prepare(`SELECT * FROM orders WHERE buyer_pubkey = ? ORDER BY created_at DESC`),
  getOrdersBySeller: db.prepare(`SELECT * FROM orders WHERE seller_pubkey = ? ORDER BY created_at DESC`),
  getOrdersByListing: db.prepare(`SELECT * FROM orders WHERE listing_id = ? ORDER BY created_at DESC`),
  updateOrderStatus: db.prepare(`UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ?`),

  // Ratings
  insertRating: db.prepare(`
    INSERT INTO ratings (id, order_id, rater_pubkey, rated_pubkey, score, comment)
    VALUES (@id, @order_id, @rater_pubkey, @rated_pubkey, @score, @comment)
  `),
  getRatingByOrder: db.prepare(`SELECT * FROM ratings WHERE order_id = ?`),
  getRatingByOrderAndRater: db.prepare(`SELECT * FROM ratings WHERE order_id = ? AND rater_pubkey = ?`),
  getRatingsByPubkey: db.prepare(`SELECT * FROM ratings WHERE rated_pubkey = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`),
  getRatingStats: db.prepare(`
    SELECT 
      COUNT(*) as total,
      ROUND(AVG(score), 1) as avg_score,
      SUM(CASE WHEN score >= 4 THEN 1 ELSE 0 END) as positive,
      SUM(CASE WHEN score <= 2 THEN 1 ELSE 0 END) as negative
    FROM ratings WHERE rated_pubkey = ?
  `),
};

// ── Helpers ───────────────────────────────────────────────────────────────

function generateListingId(): string {
  return "lst_" + crypto.randomBytes(4).toString("hex");
}

function generateOrderId(): string {
  return "ord_" + crypto.randomBytes(4).toString("hex");
}

const VALID_CONDITIONS = ["new", "used", "digital", "service"] as const;
const VALID_STATUSES = ["active", "paused", "sold", "deleted"] as const;

// ── Category-Based Escrow Role Assignment ────────────────────────────
//
// "sats-for-fiat" is the special P2P trade category where the listing
// seller locks their sats and the buyer sends fiat externally.
// ALL other categories use standard marketplace escrow where the buyer
// locks sats as payment and the seller ships the item.
//
const SATS_FOR_FIAT_CATEGORY = "sats-for-fiat";

function isSatsForFiat(category: string | null): boolean {
  return category?.toLowerCase().trim() === SATS_FOR_FIAT_CATEGORY;
}

function isValidCommunityLink(l: string): boolean {
  return /^fedi:room:![a-zA-Z0-9]+:[a-zA-Z0-9.-]+:::$/.test(l.trim());
}

function extractFederationId(l: string): string | null {
  const m = l.match(/^fedi:room:![a-zA-Z0-9]+:([a-zA-Z0-9.-]+):::$/);
  return m ? m[1] : null;
}

export interface ListingRow {
  id: string; seller_pubkey: string; title: string; description: string | null;
  price_msats: number; currency_display: string; category: string | null;
  condition: string | null; images: string | null; terms: string | null;
  community_link: string | null; status: string; quantity: number;
  created_at: string; updated_at: string;
}

export interface OrderRow {
  id: string; listing_id: string; escrow_id: string; buyer_pubkey: string;
  seller_pubkey: string; arbiter_pubkey: string | null; amount_msats: number;
  status: string; created_at: string; updated_at: string;
}

export interface RatingRow {
  id: string; order_id: string; rater_pubkey: string; rated_pubkey: string;
  score: number; comment: string | null; created_at: string;
}

function generateRatingId(): string {
  return "rat_" + crypto.randomBytes(4).toString("hex");
}

function formatListing(row: ListingRow) {
  return {
    id: row.id,
    sellerPubkey: row.seller_pubkey,
    title: row.title,
    description: row.description,
    priceMsats: row.price_msats,
    priceSats: Math.floor(row.price_msats / 1000),
    currencyDisplay: row.currency_display,
    category: row.category,
    condition: row.condition,
    images: row.images ? JSON.parse(row.images) : [],
    terms: row.terms,
    communityLink: row.community_link,
    status: row.status,
    quantity: row.quantity,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function formatOrder(row: OrderRow, opts?: { pubkey?: string; listingTitle?: string }) {
  const base: any = {
    id: row.id,
    listingId: row.listing_id,
    escrowId: row.escrow_id,
    buyerPubkey: row.buyer_pubkey,
    sellerPubkey: row.seller_pubkey,
    arbiterPubkey: row.arbiter_pubkey,
    amountMsats: row.amount_msats,
    amountSats: Math.floor(row.amount_msats / 1000),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };

  // Include listing title if provided
  if (opts?.listingTitle) base.listingTitle = opts.listingTitle;

  // Include rating status if pubkey provided and order is completed
  if (opts?.pubkey && row.status === "completed") {
    const myRating = stmts.getRatingByOrderAndRater.get(row.id, opts.pubkey) as RatingRow | undefined;
    base.myRating = myRating ? { score: myRating.score, comment: myRating.comment, createdAt: myRating.created_at } : null;
    base.needsRating = !myRating;
  }

  return base;
}

// ══════════════════════════════════════════════════════════════════════════
// PHASE 3a — Order Status Sync
// ══════════════════════════════════════════════════════════════════════════
//
// On-read sync: every time an order is fetched, check the linked escrow's
// status and update the order if it's changed. No background jobs needed.
//
// Escrow state → Order status mapping:
//   CREATED, FUNDED       → "pending"    (waiting for lock)
//   LOCKED, APPROVED      → "active"     (trade in progress)
//   CLAIMED, COMPLETED    → "completed"  (trade finished)
//   EXPIRED               → "expired"    (timed out)
//
// Also restores listing quantity if an order is cancelled or expired
// before the escrow was locked (no sats were at risk).

const ESCROW_TO_ORDER_STATUS: Record<string, string> = {
  CREATED:   "pending",
  FUNDED:    "pending",
  LOCKED:    "active",
  APPROVED:  "active",
  CLAIMED:   "completed",
  COMPLETED: "completed",
  EXPIRED:   "expired",
};

function syncOrderWithEscrow(order: OrderRow): OrderRow {
  // Only sync non-terminal orders
  if (order.status === "completed" || order.status === "cancelled") return order;

  const escrow = DB.getEscrow(order.escrow_id);
  if (!escrow) return order;

  const expectedStatus = ESCROW_TO_ORDER_STATUS[escrow.status] || order.status;

  if (expectedStatus !== order.status) {
    stmts.updateOrderStatus.run(expectedStatus, order.id);
    console.log(`[marketplace] Order ${order.id} synced: ${order.status} → ${expectedStatus} (escrow ${escrow.id} is ${escrow.status})`);

    // If escrow expired before lock (no sats at risk), restore listing quantity
    if (expectedStatus === "expired" && !escrow.locked_at) {
      const listing = stmts.getById.get(order.listing_id) as ListingRow | undefined;
      if (listing && (listing.status === "sold" || listing.quantity <= 0)) {
        db.prepare(`UPDATE listings SET quantity = quantity + 1, status = 'active', updated_at = datetime('now') WHERE id = ?`).run(order.listing_id);
        console.log(`[marketplace] Listing ${order.listing_id} quantity restored (expired before lock)`);
      } else if (listing) {
        db.prepare(`UPDATE listings SET quantity = quantity + 1, updated_at = datetime('now') WHERE id = ?`).run(order.listing_id);
      }
    }

    // Return updated order
    return { ...order, status: expectedStatus };
  }

  return order;
}

// Sync + format in one step (used by all order-reading routes)
function syncAndFormatOrder(order: OrderRow, pubkey?: string) {
  const synced = syncOrderWithEscrow(order);
  const listing = stmts.getById.get(synced.listing_id) as ListingRow | undefined;
  return formatOrder(synced, { pubkey, listingTitle: listing?.title });
}

// ══════════════════════════════════════════════════════════════════════════
// ROUTER — Route order matters! Literal paths first, then parameterized.
// ══════════════════════════════════════════════════════════════════════════

const router = Router();
// Auth + rate limit applied per-route. GET browse/detail are public.
// POST routes require auth. GET /orders/* requires auth.
const requireAuth = [extractPubkey, rateLimit];

// ──────────────────────────────────────────────────────────────────────────
// LITERAL ROUTES (must come before /:id to avoid Express matching "orders")
// ──────────────────────────────────────────────────────────────────────────

// ── POST / — Create listing ──────────────────────────────────────────────

router.post("/", ...requireAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const pk = req.pubkey!;
    const { title, description, priceMsats, currencyDisplay, category, condition, images, terms, communityLink, quantity } = req.body;

    if (!title || typeof title !== "string" || title.trim().length === 0)
      return res.status(400).json({ error: "title is required" });
    if (title.length > 200)
      return res.status(400).json({ error: "title must be 200 characters or fewer" });
    if (!priceMsats || typeof priceMsats !== "number" || priceMsats <= 0)
      return res.status(400).json({ error: "priceMsats is required (positive integer)" });
    if (priceMsats > 2_000_000_000_000)
      return res.status(400).json({ error: "priceMsats exceeds maximum (2M sats)" });
    if (condition && !VALID_CONDITIONS.includes(condition))
      return res.status(400).json({ error: `condition must be one of: ${VALID_CONDITIONS.join(", ")}` });
    if (images && (!Array.isArray(images) || images.length > 10))
      return res.status(400).json({ error: "images must be an array of up to 10 URLs" });
    if (communityLink && !isValidCommunityLink(communityLink))
      return res.status(400).json({ error: 'communityLink format: "fedi:room:!roomId:federation.domain:::"' });
    if (!communityLink || !isValidCommunityLink(communityLink))
      return res.status(400).json({ error: "communityLink is required. Paste your Fedi room link (fedi:room:!roomId:domain:::)." });

    const id = generateListingId();

    stmts.insert.run({
      id,
      seller_pubkey: pk,
      title: title.trim(),
      description: description?.trim() || null,
      price_msats: Math.floor(priceMsats),
      currency_display: currencyDisplay || "sats",
      category: category?.trim() || null,
      condition: condition || null,
      images: images ? JSON.stringify(images) : null,
      terms: terms?.trim() || null,
      community_link: communityLink?.trim() || null,
      quantity: quantity ?? 1,
    });

    const row = stmts.getById.get(id) as ListingRow;
    res.status(201).json(formatListing(row));
  } catch (err: any) {
    console.error("[marketplace] POST / error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET / — Browse/search listings ───────────────────────────────────────

// Well-known sandbox/dev pubkeys — never show these in production browse
const SANDBOX_PUBKEYS = new Set([
  "aa".repeat(32), // dev seller
  "bb".repeat(32), // dev buyer
  "cc".repeat(32), // dev arbiter
]);

const IS_PRODUCTION = process.env.NODE_ENV === "production";

router.get("/", (req: AuthenticatedRequest, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const offset = parseInt(req.query.offset as string) || 0;
    const search = req.query.q as string;
    const seller = req.query.seller as string;
    const category = req.query.category as string;

    let rows: ListingRow[];

    if (seller) {
      rows = stmts.listBySeller.all(seller) as ListingRow[];
    } else if (search) {
      const pattern = `%${search}%`;
      rows = stmts.search.all(pattern, pattern, pattern, limit, offset) as ListingRow[];
    } else if (category) {
      rows = stmts.listByCategory.all(category, limit, offset) as ListingRow[];
    } else {
      const status = (req.query.status as string) || "active";
      rows = stmts.listActive.all(status, limit, offset) as ListingRow[];
    }

    // Filter sandbox data from production browse
    if (IS_PRODUCTION) {
      rows = rows.filter(r => !SANDBOX_PUBKEYS.has(r.seller_pubkey));
    }

    res.json({
      listings: rows.map(formatListing),
      count: rows.length,
      limit,
      offset,
    });
  } catch (err: any) {
    console.error("[marketplace] GET / error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /orders/mine — My orders (as buyer or seller) ────────────────────

router.get("/orders/mine", ...requireAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const pk = req.pubkey!;
    const role = (req.query.role as string) || "buyer";

    let rows: OrderRow[];
    if (role === "seller") {
      rows = stmts.getOrdersBySeller.all(pk) as OrderRow[];
    } else {
      rows = stmts.getOrdersByBuyer.all(pk) as OrderRow[];
    }

    const orders = rows.map(order => syncAndFormatOrder(order, pk));

    res.json({ orders, count: orders.length });
  } catch (err: any) {
    console.error("[marketplace] GET /orders/mine error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /orders/:orderId — Order detail ──────────────────────────────────

router.get("/orders/:orderId", ...requireAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const pk = req.pubkey!;
    const order = stmts.getOrder.get(req.params.orderId) as OrderRow | undefined;
    if (!order) return res.status(404).json({ error: "Order not found" });

    if (pk !== order.buyer_pubkey && pk !== order.seller_pubkey && pk !== order.arbiter_pubkey)
      return res.status(403).json({ error: "You are not a participant in this order" });

    // Sync order status with escrow
    const synced = syncOrderWithEscrow(order);
    const listing = stmts.getById.get(synced.listing_id) as ListingRow | undefined;
    const escrow = DB.getEscrow(synced.escrow_id);

    res.json({
      order: formatOrder(synced, { pubkey: pk, listingTitle: listing?.title }),
      listing: listing ? formatListing(listing) : null,
      escrow: escrow ? {
        id: escrow.id,
        status: escrow.status,
        amountMsats: escrow.amount_msats,
        amountSats: Math.floor(escrow.amount_msats / 1000),
        lockedAt: escrow.locked_at,
        resolvedOutcome: escrow.resolved_outcome,
      } : null,
      tradeType: listing && isSatsForFiat(listing.category) ? "sats-for-fiat" : "marketplace",
    });
  } catch (err: any) {
    console.error("[marketplace] GET /orders/:id error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ──────────────────────────────────────────────────────────────────────────
// SELLER PROFILES & RATINGS
// ──────────────────────────────────────────────────────────────────────────

// ── GET /profile/:pubkey — Public seller profile (trade stats + ratings) ──

router.get("/profile/:pubkey", (req: AuthenticatedRequest, res: Response) => {
  try {
    const pk = req.params.pubkey;
    if (!pk || pk.length !== 64) return res.status(400).json({ error: "Invalid pubkey (must be 64 hex chars)" });

    // Trade stats from orders
    const sellerOrders = stmts.getOrdersBySeller.all(pk) as OrderRow[];
    const buyerOrders = stmts.getOrdersByBuyer.all(pk) as OrderRow[];

    const completedSells = sellerOrders.filter(o => o.status === "completed").length;
    const completedBuys = buyerOrders.filter(o => o.status === "completed").length;
    const totalTrades = completedSells + completedBuys;

    // Volume
    const sellVolume = sellerOrders
      .filter(o => o.status === "completed")
      .reduce((sum, o) => sum + o.amount_msats, 0);

    // Active listings count
    const activeListings = (stmts.listBySeller.all(pk) as ListingRow[])
      .filter(l => l.status === "active").length;

    // Rating stats
    const ratingStats = stmts.getRatingStats.get(pk) as {
      total: number; avg_score: number | null; positive: number; negative: number;
    } | undefined;

    // Recent ratings (last 10)
    const recentRatings = (stmts.getRatingsByPubkey.all(pk, 10, 0) as RatingRow[]).map(r => ({
      id: r.id,
      orderId: r.order_id,
      raterPubkey: r.rater_pubkey,
      score: r.score,
      comment: r.comment,
      createdAt: r.created_at,
    }));

    // Member since (earliest order or listing)
    const allDates = [
      ...sellerOrders.map(o => o.created_at),
      ...buyerOrders.map(o => o.created_at),
    ].filter(Boolean).sort();
    const memberSince = allDates[0] || null;

    res.json({
      pubkey: pk,
      tradeStats: {
        totalTrades,
        completedSells,
        completedBuys,
        sellVolumeMsats: sellVolume,
        sellVolumeSats: Math.floor(sellVolume / 1000),
        activeListings,
      },
      ratings: {
        total: ratingStats?.total || 0,
        avgScore: ratingStats?.avg_score || null,
        positive: ratingStats?.positive || 0,
        negative: ratingStats?.negative || 0,
      },
      recentRatings,
      memberSince,
    });
  } catch (err: any) {
    console.error("[marketplace] GET /profile/:pubkey error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /profile/:pubkey/rate — Rate a seller after completed trade ──

router.post("/profile/:pubkey/rate", ...requireAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const raterPubkey = req.pubkey!;
    const ratedPubkey = req.params.pubkey;
    const { orderId, score, comment } = req.body;

    // Validate inputs
    if (!ratedPubkey || ratedPubkey.length !== 64)
      return res.status(400).json({ error: "Invalid pubkey" });
    if (raterPubkey === ratedPubkey)
      return res.status(400).json({ error: "You cannot rate yourself" });
    if (!orderId || typeof orderId !== "string")
      return res.status(400).json({ error: "orderId is required" });
    if (typeof score !== "number" || score < 1 || score > 5 || !Number.isInteger(score))
      return res.status(400).json({ error: "score must be an integer 1-5" });
    if (comment && (typeof comment !== "string" || comment.length > 500))
      return res.status(400).json({ error: "comment must be 500 characters or fewer" });

    // Verify order exists and is completed
    const order = stmts.getOrder.get(orderId) as OrderRow | undefined;
    if (!order)
      return res.status(404).json({ error: "Order not found" });

    // Sync with escrow before checking status
    const synced = syncOrderWithEscrow(order);
    if (synced.status !== "completed")
      return res.status(400).json({ error: "Can only rate after a completed trade" });

    // Verify rater is a participant (buyer rates seller, seller rates buyer)
    const isParticipant =
      (raterPubkey === synced.buyer_pubkey && ratedPubkey === synced.seller_pubkey) ||
      (raterPubkey === synced.seller_pubkey && ratedPubkey === synced.buyer_pubkey);
    if (!isParticipant)
      return res.status(403).json({ error: "You can only rate the other party in your trade" });

    // Check for duplicate rating by THIS rater
    const existing = stmts.getRatingByOrderAndRater.get(orderId, raterPubkey) as RatingRow | undefined;
    if (existing)
      return res.status(409).json({ error: "You already rated this trade" });

    const id = generateRatingId();
    stmts.insertRating.run({
      id,
      order_id: orderId,
      rater_pubkey: raterPubkey,
      rated_pubkey: ratedPubkey,
      score,
      comment: comment?.trim() || null,
    });

    // Phase 5: DM notification — new rating
    Notify.notifyNewRating(ratedPubkey, score, raterPubkey);

    res.status(201).json({
      id,
      orderId,
      score,
      comment: comment?.trim() || null,
      message: "Rating submitted!",
    });
  } catch (err: any) {
    if (err.message?.includes("UNIQUE constraint"))
      return res.status(409).json({ error: "This order has already been rated" });
    console.error("[marketplace] POST /profile/:pubkey/rate error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ──────────────────────────────────────────────────────────────────────────
// PARAMETERIZED ROUTES (/:id comes after literal paths)
// ──────────────────────────────────────────────────────────────────────────

// ── GET /:id — Listing detail ────────────────────────────────────────────

router.get("/:id", (req: AuthenticatedRequest, res: Response) => {
  const row = stmts.getById.get(req.params.id) as ListingRow | undefined;
  if (!row) return res.status(404).json({ error: "Listing not found" });

  const orders = (stmts.getOrdersByListing.all(row.id) as OrderRow[]).map(syncOrderWithEscrow);

  res.json({
    ...formatListing(row),
    activeOrders: orders.filter(o => !["completed", "cancelled", "expired"].includes(o.status)).length,
  });
});

// ── POST /:id/update — Update listing (seller only) ─────────────────────

router.post("/:id/update", ...requireAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const pk = req.pubkey!;
    const row = stmts.getById.get(req.params.id) as ListingRow | undefined;
    if (!row) return res.status(404).json({ error: "Listing not found" });
    if (row.seller_pubkey !== pk)
      return res.status(403).json({ error: "Only the seller can update this listing" });

    const allowedFields: Record<string, string> = {
      title: "title", description: "description", priceMsats: "price_msats",
      currencyDisplay: "currency_display", category: "category", condition: "condition",
      images: "images", terms: "terms", communityLink: "community_link",
      quantity: "quantity", status: "status",
    };

    const sets: string[] = [];
    const values: any[] = [];

    for (const [bodyKey, dbCol] of Object.entries(allowedFields)) {
      if (req.body[bodyKey] !== undefined) {
        let val = req.body[bodyKey];

        if (bodyKey === "title" && (!val || typeof val !== "string" || val.trim().length === 0))
          return res.status(400).json({ error: "title cannot be empty" });
        if (bodyKey === "priceMsats" && (typeof val !== "number" || val <= 0))
          return res.status(400).json({ error: "priceMsats must be a positive number" });
        if (bodyKey === "condition" && val && !VALID_CONDITIONS.includes(val))
          return res.status(400).json({ error: `condition must be one of: ${VALID_CONDITIONS.join(", ")}` });
        if (bodyKey === "status" && !VALID_STATUSES.includes(val))
          return res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(", ")}` });
        if (bodyKey === "communityLink" && val && !isValidCommunityLink(val))
          return res.status(400).json({ error: 'communityLink format: "fedi:room:!roomId:federation.domain:::"' });
        if (bodyKey === "images") val = JSON.stringify(val);
        if (typeof val === "string" && ["title", "description", "terms", "category"].includes(bodyKey))
          val = val.trim();

        sets.push(`${dbCol} = ?`);
        values.push(val);
      }
    }

    if (sets.length === 0) return res.status(400).json({ error: "No valid fields to update" });

    sets.push("updated_at = datetime('now')");
    values.push(req.params.id);

    db.prepare(`UPDATE listings SET ${sets.join(", ")} WHERE id = ?`).run(...values);

    const updated = stmts.getById.get(req.params.id) as ListingRow;
    res.json(formatListing(updated));
  } catch (err: any) {
    console.error("[marketplace] POST /:id/update error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /:id/delete — Soft-delete listing (seller only) ─────────────────

router.post("/:id/delete", ...requireAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const pk = req.pubkey!;
    const row = stmts.getById.get(req.params.id) as ListingRow | undefined;
    if (!row) return res.status(404).json({ error: "Listing not found" });
    if (row.seller_pubkey !== pk)
      return res.status(403).json({ error: "Only the seller can delete this listing" });
    if (row.status === "deleted")
      return res.status(400).json({ error: "Listing is already deleted" });

    db.prepare(`UPDATE listings SET status = 'deleted', updated_at = datetime('now') WHERE id = ?`).run(req.params.id);
    res.json({ id: req.params.id, status: "deleted", message: "Listing deleted" });
  } catch (err: any) {
    console.error("[marketplace] POST /:id/delete error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════
// PHASE 2 — Purchase Flow
// ══════════════════════════════════════════════════════════════════════════

// ── POST /:id/cancel — Cancel an order (buyer only, before lock) ─────────
//
// Buyer can cancel if the escrow hasn't been locked yet (CREATED or FUNDED).
// This restores the listing quantity and marks the order as cancelled.
// The linked escrow will naturally expire via the 24h timeout.

router.post("/:id/cancel", ...requireAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const pk = req.pubkey!;

    // Find order by listing ID — the URL /:id refers to the listing
    const orders = stmts.getOrdersByListing.all(req.params.id) as OrderRow[];
    const order = orders.find(o => o.buyer_pubkey === pk && !["completed", "cancelled", "expired"].includes(o.status));

    if (!order)
      return res.status(404).json({ error: "No active order found for this listing" });

    // Check escrow state — can only cancel before lock
    const escrow = DB.getEscrow(order.escrow_id);
    if (escrow && (escrow.status === "LOCKED" || escrow.status === "APPROVED" || escrow.status === "CLAIMED" || escrow.status === "COMPLETED")) {
      return res.status(400).json({ error: `Cannot cancel — escrow is ${escrow.status}. Sats are already locked.` });
    }

    // Cancel the order
    stmts.updateOrderStatus.run("cancelled", order.id);

    // Restore listing quantity
    const listing = stmts.getById.get(order.listing_id) as ListingRow | undefined;
    if (listing) {
      db.prepare(`UPDATE listings SET quantity = quantity + 1, updated_at = datetime('now') WHERE id = ?`).run(order.listing_id);
      // If listing was marked sold, reactivate it
      if (listing.status === "sold") {
        db.prepare(`UPDATE listings SET status = 'active', updated_at = datetime('now') WHERE id = ?`).run(order.listing_id);
      }
    }

    res.json({
      order: { id: order.id, status: "cancelled" },
      message: "Order cancelled. Listing quantity restored.",
    });
  } catch (err: any) {
    console.error("[marketplace] POST /:id/cancel error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /:id/buy — Purchase a listing ───────────────────────────────────
//
// The marketplace → escrow bridge:
//   1. Validates the listing is buyable
//   2. Determines trade type from listing category
//   3. Creates an escrow with ROLE ASSIGNMENT based on category:
//      • "sats-for-fiat": listing seller = escrow seller (locks sats)
//      • All other categories: buyer = escrow seller (locks sats as payment)
//   4. Auto-joins the other party as escrow buyer
//   5. Auto-assigns a random arbiter via DB.joinAsArbiter()
//   6. Creates an order record linking listing ↔ escrow
//   7. Decrements listing quantity (marks sold if 0)
//
// Result: escrow is in FUNDED state — the locking party can proceed.

router.post("/:id/buy", ...requireAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const buyerPubkey = req.pubkey!;
    const listing = stmts.getById.get(req.params.id) as ListingRow | undefined;

    // ── Validate ──────────────────────────────────────────────────────

    if (!listing)
      return res.status(404).json({ error: "Listing not found" });

    if (listing.status !== "active")
      return res.status(400).json({ error: `Listing is ${listing.status} — cannot purchase` });

    if (listing.quantity <= 0)
      return res.status(400).json({ error: "Listing is out of stock" });

    if (listing.seller_pubkey === buyerPubkey)
      return res.status(400).json({ error: "You cannot buy your own listing" });

    if (!listing.community_link || !isValidCommunityLink(listing.community_link))
      return res.status(400).json({ error: "Listing has no valid community link — seller must update it before purchases are possible" });

    const federationId = extractFederationId(listing.community_link);
    if (!federationId)
      return res.status(400).json({ error: "Could not extract federation ID from listing's community link" });

    // ── Pick arbiter ──────────────────────────────────────────────────

    const arbiterPubkey = pickArbiter([listing.seller_pubkey, buyerPubkey]);
    if (!arbiterPubkey)
      return res.status(503).json({ error: "No eligible arbiter available. Try again later or contact the community." });

    // ── Create escrow (direct DB calls — no HTTP round-trip) ──────────
    //
    // Role assignment depends on listing category:
    //
    // "sats-for-fiat" (P2P trade):
    //   Listing seller → escrow seller (locks sats, wants fiat)
    //   Buyer → escrow buyer (sends fiat externally, receives sats)
    //   Flow: Seller locks sats → Buyer sends fiat → Both confirm → Buyer gets sats
    //
    // Every other category (marketplace):
    //   Buyer → escrow seller role (locks sats as payment)
    //   Listing seller → escrow buyer role (receives sats on release)
    //   Flow: Buyer locks sats → Seller ships item → Both confirm → Seller gets sats

    const escrowId = DB.getNextId();
    const isP2PTrade = isSatsForFiat(listing.category);

    // Who takes which escrow role?
    const escrowSellerPubkey = isP2PTrade ? listing.seller_pubkey : buyerPubkey;
    const escrowBuyerPubkey  = isP2PTrade ? buyerPubkey : listing.seller_pubkey;

    DB.createEscrow({
      id: escrowId,
      amountMsats: listing.price_msats,
      description: isP2PTrade 
        ? `P2P Trade: ${listing.title}`
        : `Marketplace: ${listing.title}`,
      terms: listing.terms || "Standard marketplace terms apply.",
      communityLink: listing.community_link,
      federationId,
      sellerPubkey: escrowSellerPubkey,
    });

    // Join escrow buyer (status stays CREATED — arbiter not yet joined)
    DB.joinAsBuyer(escrowId, escrowBuyerPubkey, "CREATED");

    // Join arbiter — all 3 present → FUNDED
    DB.joinAsArbiter(escrowId, arbiterPubkey, "FUNDED");

    // ── Create order ──────────────────────────────────────────────────

    const orderId = generateOrderId();

    stmts.insertOrder.run({
      id: orderId,
      listing_id: listing.id,
      escrow_id: escrowId,
      buyer_pubkey: buyerPubkey,
      seller_pubkey: listing.seller_pubkey,
      arbiter_pubkey: arbiterPubkey,
      amount_msats: listing.price_msats,
      status: "pending",
    });

    // ── Update listing quantity ────────────────────────────────────────

    stmts.decrementQuantity.run(listing.id);
    const updated = stmts.getById.get(listing.id) as ListingRow;
    if (updated.quantity <= 0) {
      stmts.markSold.run(listing.id);
    }

    // ── Response ──────────────────────────────────────────────────────

    const escrow = DB.getEscrow(escrowId);

    // Phase 5: DM notification — listing purchased
    Notify.notifyListingPurchased(listing.id, listing.title, listing.seller_pubkey, buyerPubkey, escrowId);

    const nextStepMsg = isP2PTrade
      ? `Seller opens escrow ${escrowId} and locks sats. Buyer sends fiat.`
      : `Buyer opens escrow ${escrowId} and locks sats as payment.`;

    const responseMsg = isP2PTrade
      ? "P2P trade initiated! Seller: lock your sats. Buyer: prepare fiat payment."
      : "Purchase initiated! Buyer: lock your sats as payment. Seller: prepare to ship.";

    res.status(201).json({
      order: {
        id: orderId,
        listingId: listing.id,
        escrowId,
        arbiterPubkey,
        status: "pending",
      },
      escrow: {
        id: escrowId,
        status: escrow?.status || "FUNDED",
        amountMsats: listing.price_msats,
        amountSats: Math.floor(listing.price_msats / 1000),
      },
      listing: {
        id: listing.id,
        title: listing.title,
        remainingQuantity: Math.max(0, listing.quantity - 1),
      },
      tradeType: isP2PTrade ? "sats-for-fiat" : "marketplace",
      escrowRoles: {
        locksats: isP2PTrade ? "listing_seller" : "buyer",
        receivesats: isP2PTrade ? "buyer" : "listing_seller",
        escrowSellerPubkey,
        escrowBuyerPubkey,
      },
      message: responseMsg,
      nextStep: nextStepMsg,
    });
  } catch (err: any) {
    console.error("[marketplace] POST /:id/buy error:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
