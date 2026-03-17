// src/db.ts — Production-hardened SQLite persistence
//
// v4.0 changes:
//   - AES-256-GCM encryption of locked e-cash notes at rest
//   - Escrow expiry: auto-refund after configurable timeout
//   - Lock mode tracking (webln vs manual)
//   - Schema migration versioning
//   - Expiry sweep function (call on interval)

import Database from "better-sqlite3";
import path from "path";
import { mkdirSync } from "fs";
import crypto from "crypto";

// ── Database Setup ────────────────────────────────────────────────────────

const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), "data", "escrow.db");
mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");
db.pragma("foreign_keys = ON");

// ── Notes Encryption (AES-256-GCM) ───────────────────────────────────────
// Production: set ESCROW_ENCRYPTION_KEY as 64-char hex (32 bytes)
// Dev: auto-generates a deterministic key (NOT safe for real e-cash)

const ENC_KEY = (() => {
  const envKey = process.env.ESCROW_ENCRYPTION_KEY;
  if (envKey && envKey.length === 64) return Buffer.from(envKey, "hex");
  if (process.env.NODE_ENV === "production") {
    console.error("FATAL: ESCROW_ENCRYPTION_KEY required in production (64 hex chars)");
    process.exit(1);
  }
  console.warn("⚠️  No ESCROW_ENCRYPTION_KEY — using dev key. NOT safe for real e-cash.");
  return crypto.createHash("sha256").update("escrow-dev-key-NOT-FOR-PRODUCTION").digest();
})();

export function encryptNotes(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", ENC_KEY, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

export function decryptNotes(encrypted: string): string {
  const buf = Buffer.from(encrypted, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", ENC_KEY, iv);
  decipher.setAuthTag(tag);
  return decipher.update(enc, undefined, "utf8") + decipher.final("utf8");
}

// ── Schema ────────────────────────────────────────────────────────────────

db.exec(`CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY)`);
const currentVersion = (db.prepare("SELECT MAX(version) as v FROM schema_version").get() as any)?.v || 0;

const migrations: { version: number; sql: string }[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS escrows (
        id              TEXT PRIMARY KEY,
        status          TEXT NOT NULL DEFAULT 'CREATED',
        created_at      INTEGER NOT NULL,
        updated_at      INTEGER NOT NULL,
        amount_msats    INTEGER NOT NULL,
        description     TEXT NOT NULL DEFAULT '',
        terms           TEXT NOT NULL DEFAULT '',
        community_link  TEXT NOT NULL DEFAULT '',
        federation_id   TEXT NOT NULL DEFAULT '',
        seller_pubkey   TEXT NOT NULL,
        buyer_pubkey    TEXT,
        arbiter_pubkey  TEXT,
        locked_notes    TEXT,
        locked_at       INTEGER,
        lock_mode       TEXT DEFAULT 'manual',
        lock_preimage   TEXT,
        resolved_outcome TEXT,
        resolved_at     INTEGER,
        claimed_by      TEXT,
        claimed_at      INTEGER,
        expires_at      INTEGER
      );
      CREATE TABLE IF NOT EXISTS votes (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        escrow_id TEXT NOT NULL REFERENCES escrows(id),
        role      TEXT NOT NULL,
        outcome   TEXT NOT NULL,
        pubkey    TEXT NOT NULL,
        timestamp INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_escrows_seller  ON escrows(seller_pubkey);
      CREATE INDEX IF NOT EXISTS idx_escrows_buyer   ON escrows(buyer_pubkey);
      CREATE INDEX IF NOT EXISTS idx_escrows_arbiter ON escrows(arbiter_pubkey);
      CREATE INDEX IF NOT EXISTS idx_escrows_status  ON escrows(status);
      CREATE INDEX IF NOT EXISTS idx_escrows_expires ON escrows(expires_at);
      CREATE INDEX IF NOT EXISTS idx_votes_escrow    ON votes(escrow_id);
    `,
  },
];

const applyMigrations = db.transaction(() => {
  for (const m of migrations) {
    if (m.version > currentVersion) {
      db.exec(m.sql);
      db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(m.version);
      console.log(`  DB migration v${m.version} applied`);
    }
  }
});

// ── Migration: Add arbiter dispute columns ──
try {
  db.exec(`ALTER TABLE escrows ADD COLUMN dispute_started_at INTEGER`);
  console.log("[db] Added dispute_started_at column");
} catch {} // column already exists
try {
  db.exec(`ALTER TABLE escrows ADD COLUMN arbiter_fee_msats INTEGER DEFAULT 0`);
  console.log("[db] Added arbiter_fee_msats column");
} catch {} // column already exists
try {
  db.exec(`ALTER TABLE escrows ADD COLUMN arbiter_rotations INTEGER DEFAULT 0`);
  console.log("[db] Added arbiter_rotations column");
} catch {} // column already exists

applyMigrations();

// ── Types ─────────────────────────────────────────────────────────────────

export interface EscrowRow {
  id: string; status: string; created_at: number; updated_at: number;
  amount_msats: number; description: string; terms: string;
  community_link: string; federation_id: string;
  seller_pubkey: string; buyer_pubkey: string | null; arbiter_pubkey: string | null;
  locked_notes: string | null; locked_at: number | null;
  shamir_seller: string | null; shamir_buyer: string | null; shamir_arbiter: string | null;
  lock_role: string | null; // "seller" | "buyer" — who is responsible for locking sats
  shamir_share_seller: string | null; shamir_share_buyer: string | null;
  lock_mode: string | null; lock_preimage: string | null;
  resolved_outcome: string | null; resolved_at: number | null;
  claimed_by: string | null; claimed_at: number | null;
  expires_at: number | null;
  dispute_started_at: number | null;
  arbiter_fee_msats: number;
  arbiter_rotations: number;
}

export interface VoteRow {
  id: number; escrow_id: string; role: string;
  outcome: string; pubkey: string; timestamp: number;
}


  if (currentVersion < 2) {
    db.exec(`
      ALTER TABLE escrows ADD COLUMN shamir_seller TEXT;
      ALTER TABLE escrows ADD COLUMN shamir_buyer TEXT;
      ALTER TABLE escrows ADD COLUMN shamir_arbiter TEXT;
      ALTER TABLE escrows ADD COLUMN shamir_share_seller TEXT;
      ALTER TABLE escrows ADD COLUMN shamir_share_buyer TEXT;
    `);
    db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(2);
    console.log("[db] Migration 2: Shamir share columns added");
  }

  if (currentVersion < 3) {
    db.exec("ALTER TABLE escrows ADD COLUMN lock_role TEXT DEFAULT 'seller'");
    db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(3);
    console.log("[db] Migration 3: lock_role column added");
  }

// ── Prepared Statements ───────────────────────────────────────────────────

const stmts = {
  insertEscrow: db.prepare(`
    INSERT INTO escrows (id, status, created_at, updated_at, amount_msats, description, terms, community_link, federation_id, seller_pubkey, expires_at)
    VALUES (@id, @status, @created_at, @updated_at, @amount_msats, @description, @terms, @community_link, @federation_id, @seller_pubkey, @expires_at)
  `),
  getEscrow: db.prepare(`SELECT * FROM escrows WHERE id = ?`),
  listByPubkey: db.prepare(`
    SELECT * FROM escrows WHERE seller_pubkey = @pk OR buyer_pubkey = @pk OR arbiter_pubkey = @pk ORDER BY updated_at DESC
  `),
  updateBuyer: db.prepare(`UPDATE escrows SET buyer_pubkey = @buyer_pubkey, status = @status, updated_at = @updated_at WHERE id = @id`),
  updateArbiter: db.prepare(`UPDATE escrows SET arbiter_pubkey = @arbiter_pubkey, status = @status, updated_at = @updated_at WHERE id = @id`),
  lockNotes: db.prepare(`
    UPDATE escrows SET locked_notes = @locked_notes, locked_at = @locked_at, lock_mode = @lock_mode, lock_preimage = @lock_preimage, status = 'LOCKED', updated_at = @updated_at WHERE id = @id
  `),
  extendExpiry: db.prepare(`UPDATE escrows SET expires_at = ? WHERE id = ?`),
  resolve: db.prepare(`UPDATE escrows SET status = 'APPROVED', resolved_outcome = @resolved_outcome, resolved_at = @resolved_at, updated_at = @updated_at WHERE id = @id`),
  claim: db.prepare(`UPDATE escrows SET status = 'CLAIMED', claimed_by = @claimed_by, claimed_at = @claimed_at, updated_at = @updated_at WHERE id = @id`),
  insertVote: db.prepare(`INSERT INTO votes (escrow_id, role, outcome, pubkey, timestamp) VALUES (@escrow_id, @role, @outcome, @pubkey, @timestamp)`),
  getVotes: db.prepare(`SELECT * FROM votes WHERE escrow_id = ? ORDER BY timestamp ASC`),
  countEscrows: db.prepare(`SELECT COUNT(*) as count FROM escrows`),
  getExpired: db.prepare(`SELECT * FROM escrows WHERE status IN ('CREATED', 'FUNDED', 'LOCKED') AND expires_at IS NOT NULL AND expires_at <= ?`),
  getDisputes: db.prepare(`SELECT * FROM escrows WHERE status = 'LOCKED' AND dispute_started_at IS NOT NULL AND dispute_started_at > 0`),
  setDisputeStarted: db.prepare(`UPDATE escrows SET dispute_started_at = @dispute_started_at, updated_at = @updated_at WHERE id = @id`),
  setArbiterFee: db.prepare(`UPDATE escrows SET arbiter_fee_msats = @fee, updated_at = @updated_at WHERE id = @id`),
  reassignArbiter: db.prepare(`UPDATE escrows SET arbiter_pubkey = @new_arbiter, arbiter_rotations = arbiter_rotations + 1, updated_at = @updated_at WHERE id = @id`),
  updateStatus: db.prepare(`UPDATE escrows SET status = @status, updated_at = @updated_at WHERE id = @id`),
  expireEscrow: db.prepare(`UPDATE escrows SET status = 'EXPIRED', resolved_outcome = 'refund', resolved_at = @now, updated_at = @now WHERE id = @id AND status IN ('CREATED', 'FUNDED', 'LOCKED')`),
};

// ── Expiry Config ─────────────────────────────────────────────────────────

export const EXPIRY_UNFUNDED_MS = Number(process.env.ESCROW_EXPIRY_UNFUNDED_MS) || 24 * 60 * 60 * 1000;   // 24h
export const EXPIRY_LOCKED_MS   = Number(process.env.ESCROW_EXPIRY_LOCKED_MS)   || 72 * 60 * 60 * 1000;   // 72h

// ── Dispute Management ─────────────────────────────────────────────────

export function startDispute(id: string): void {
  stmts.setDisputeStarted.run({ id, dispute_started_at: Date.now(), updated_at: Date.now() });
}

export function setArbiterFee(id: string, feeMsats: number): void {
  stmts.setArbiterFee.run({ id, fee: feeMsats, updated_at: Date.now() });
}

export function reassignArbiter(id: string, newArbiterPk: string): void {
  // Remove old arbiter's vote if any
  try { db.prepare(`DELETE FROM votes WHERE escrow_id = ? AND role = 'arbiter'`).run(id); } catch {}
  stmts.reassignArbiter.run({ id, new_arbiter: newArbiterPk, updated_at: Date.now() });
}

export function getActiveDisputes(): EscrowRow[] {
  return stmts.getDisputes.all() as EscrowRow[];
}

export const ARBITER_TIMEOUT_MS = Number(process.env.ARBITER_TIMEOUT_MS) || 4 * 60 * 60 * 1000; // 4 hours

export function processDisputeTimeouts(allowedArbiters: string[], onReassign: (escrow: EscrowRow, oldArbiter: string, newArbiter: string) => void): number {
  const now = Date.now();
  const disputes = getActiveDisputes();
  let count = 0;
  for (const e of disputes) {
    if (!e.dispute_started_at) continue;
    const elapsed = now - e.dispute_started_at;
    if (elapsed < ARBITER_TIMEOUT_MS) continue;

    // Find next available arbiter (not buyer, seller, or current arbiter)
    const exclude = new Set([e.seller_pubkey, e.buyer_pubkey, e.arbiter_pubkey].filter(Boolean).map(pk => pk!.toLowerCase()));
    const eligible = allowedArbiters.filter(pk => !exclude.has(pk.toLowerCase()));

    if (eligible.length > 0) {
      const newArbiter = eligible[Math.floor(Math.random() * eligible.length)];
      const oldArbiter = e.arbiter_pubkey!;
      reassignArbiter(e.id, newArbiter);
      // Reset dispute timer for new arbiter
      startDispute(e.id);
      onReassign(e, oldArbiter, newArbiter);
      count++;
      console.log(`  ⚖️ Arbiter timeout: ${e.id} — rotated ${oldArbiter.slice(0,8)}… → ${newArbiter.slice(0,8)}… (rotation #${(e.arbiter_rotations || 0) + 1})`);
    } else {
      // No more arbiters available — auto-refund to seller (safest default)
      stmts.resolve.run({ id: e.id, resolved_outcome: "refund", resolved_at: now, updated_at: now });
      count++;
      console.log(`  ⚠️ All arbiters exhausted for ${e.id} — auto-refund to seller`);
    }
  }
  return count;
}

export function processExpiredEscrows(): number {
  const now = Date.now();
  const expired = stmts.getExpired.all(now) as EscrowRow[];
  let count = 0;
  for (const e of expired) {
    stmts.expireEscrow.run({ id: e.id, now });
    count++;
    console.log(`  ⏰ Escrow ${e.id} expired (was ${e.status}) → auto-refund`);
  }
  return count;
}

// ── Public API ────────────────────────────────────────────────────────────

export function getNextId(): string {
  const { count } = stmts.countEscrows.get() as { count: number };
  return `ecash_${count + 1}`;
}

export function createEscrow(p: {
  id: string; amountMsats: number; description: string; terms: string;
  communityLink: string; federationId: string; sellerPubkey: string; lockRole?: string;
}): EscrowRow {
  const now = Date.now();
  stmts.insertEscrow.run({
    id: p.id, status: "CREATED", created_at: now, updated_at: now,
    amount_msats: p.amountMsats, description: p.description, terms: p.terms,
    community_link: p.communityLink, federation_id: p.federationId,
    seller_pubkey: p.sellerPubkey, expires_at: now + EXPIRY_UNFUNDED_MS,
  });
  // Set lock_role if specified (default is "seller")
  if (p.lockRole && p.lockRole !== "seller") {
    db.prepare("UPDATE escrows SET lock_role = ? WHERE id = ?").run(p.lockRole, p.id);
  }
  return stmts.getEscrow.get(p.id) as EscrowRow;
}

export function getEscrow(id: string): EscrowRow | undefined {
  return stmts.getEscrow.get(id) as EscrowRow | undefined;
}

export function listEscrowsByPubkey(pubkey: string): EscrowRow[] {
  return stmts.listByPubkey.all({ pk: pubkey }) as EscrowRow[];
}

export function joinAsBuyer(id: string, buyerPubkey: string, newStatus: string): void {
  stmts.updateBuyer.run({ id, buyer_pubkey: buyerPubkey, status: newStatus, updated_at: Date.now() });
}

export function joinAsArbiter(id: string, arbiterPubkey: string, newStatus: string): void {
  stmts.updateArbiter.run({ id, arbiter_pubkey: arbiterPubkey, status: newStatus, updated_at: Date.now() });
}

export const EXPIRY_SHIPPING_MS = Number(process.env.ESCROW_EXPIRY_SHIPPING_MS) || 14 * 24 * 60 * 60 * 1000; // 14 days

export function lockNotes(id: string, notes: string, mode: "webln" | "manual", preimage?: string, expiryMs?: number): void {
  const now = Date.now();
  stmts.lockNotes.run({
    id, locked_notes: encryptNotes(notes), locked_at: now,
    lock_mode: mode, lock_preimage: preimage || null, updated_at: now,
  });
  stmts.extendExpiry.run(now + (expiryMs || EXPIRY_LOCKED_MS), id);
}

export function lockNotesWithShamir(id: string, sellerShare: string, buyerShare: string, arbiterShare: string, mode: string, expiryMs?: number): void {
  const now = Date.now();
  db.prepare(`UPDATE escrows SET shamir_seller = @shamir_seller, shamir_buyer = @shamir_buyer, shamir_arbiter = @shamir_arbiter,
    locked_notes = 'SHAMIR', locked_at = @locked_at, lock_mode = @lock_mode, updated_at = @updated_at, status = 'LOCKED'
    WHERE id = @id`).run({
    id, shamir_seller: sellerShare, shamir_buyer: buyerShare, shamir_arbiter: arbiterShare,
    locked_at: now, lock_mode: mode, updated_at: now,
  });
  stmts.extendExpiry.run(now + (expiryMs || EXPIRY_LOCKED_MS), id);
}

export function storeDecryptedShare(id: string, role: string, share: string): void {
  // In dispute case, arbiter's share replaces the losing party's column
  // We always need exactly 2 shares to reconstruct
  const col = role === "seller" ? "shamir_share_seller" : role === "buyer" ? "shamir_share_buyer" : "shamir_share_buyer";
  // Arbiter goes into buyer slot if seller already has one, or seller slot otherwise
  db.prepare(`UPDATE escrows SET ${col} = @share, updated_at = @updated_at WHERE id = @id`).run({
    id, share, updated_at: Date.now(),
  });
}

export function getShamirShares(id: string): { seller?: string, buyer?: string, arbiter?: string, share_seller?: string, share_buyer?: string } {
  const row = db.prepare("SELECT shamir_seller, shamir_buyer, shamir_arbiter, shamir_share_seller, shamir_share_buyer FROM escrows WHERE id = ?").get(id) as any;
  if (!row) return {};
  return {
    seller: row.shamir_seller, buyer: row.shamir_buyer, arbiter: row.shamir_arbiter,
    share_seller: row.shamir_share_seller, share_buyer: row.shamir_share_buyer,
  };
}

export function getEncryptedShare(id: string, role: string): string | null {
  const col = role === "seller" ? "shamir_seller" : role === "buyer" ? "shamir_buyer" : "shamir_arbiter";
  const row = db.prepare(`SELECT ${col} as share FROM escrows WHERE id = ?`).get(id) as any;
  return row?.share || null;
}

export function clearShamirShares(id: string): void {
  db.prepare("UPDATE escrows SET shamir_seller = NULL, shamir_buyer = NULL, shamir_arbiter = NULL, shamir_share_seller = NULL, shamir_share_buyer = NULL, locked_notes = NULL, updated_at = @updated_at WHERE id = @id").run({
    id, updated_at: Date.now(),
  });
}

export function addVote(escrowId: string, role: string, outcome: string, pubkey: string): void {
  stmts.insertVote.run({ escrow_id: escrowId, role, outcome, pubkey, timestamp: Date.now() });
}

export function getVotes(escrowId: string): VoteRow[] {
  return stmts.getVotes.all(escrowId) as VoteRow[];
}

export function resolveEscrow(id: string, outcome: string): void {
  const now = Date.now();
  stmts.resolve.run({ id, resolved_outcome: outcome, resolved_at: now, updated_at: now });
}

export function claimEscrow(id: string, claimedBy: string): string | null {
  const escrow = getEscrow(id);
  if (!escrow || !escrow.locked_notes) return null;
  const notes = decryptNotes(escrow.locked_notes);
  stmts.claim.run({ id, claimed_by: claimedBy, claimed_at: Date.now(), updated_at: Date.now() });
  return notes;
}

export function claimEscrowShamir(id: string, claimedBy: string): void {
  const now = Date.now();
  stmts.claim.run({ id, claimed_by: claimedBy, claimed_at: now, updated_at: now });
}

export function completeEscrow(id: string): void {
  stmts.updateStatus.run({ id, status: "COMPLETED", updated_at: Date.now() });
}

export function closeDb(): void { db.close(); }
export default db;
