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
applyMigrations();

// ── Types ─────────────────────────────────────────────────────────────────

export interface EscrowRow {
  id: string; status: string; created_at: number; updated_at: number;
  amount_msats: number; description: string; terms: string;
  community_link: string; federation_id: string;
  seller_pubkey: string; buyer_pubkey: string | null; arbiter_pubkey: string | null;
  locked_notes: string | null; locked_at: number | null;
  lock_mode: string | null; lock_preimage: string | null;
  resolved_outcome: string | null; resolved_at: number | null;
  claimed_by: string | null; claimed_at: number | null;
  expires_at: number | null;
}

export interface VoteRow {
  id: number; escrow_id: string; role: string;
  outcome: string; pubkey: string; timestamp: number;
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
  claim: db.prepare(`UPDATE escrows SET status = 'CLAIMED', claimed_by = @claimed_by, claimed_at = @claimed_at, locked_notes = NULL, updated_at = @updated_at WHERE id = @id`),
  insertVote: db.prepare(`INSERT INTO votes (escrow_id, role, outcome, pubkey, timestamp) VALUES (@escrow_id, @role, @outcome, @pubkey, @timestamp)`),
  getVotes: db.prepare(`SELECT * FROM votes WHERE escrow_id = ? ORDER BY timestamp ASC`),
  countEscrows: db.prepare(`SELECT COUNT(*) as count FROM escrows`),
  getExpired: db.prepare(`SELECT * FROM escrows WHERE status IN ('CREATED', 'FUNDED', 'LOCKED') AND expires_at IS NOT NULL AND expires_at <= ?`),
  expireEscrow: db.prepare(`UPDATE escrows SET status = 'EXPIRED', resolved_outcome = 'refund', resolved_at = @now, updated_at = @now WHERE id = @id AND status IN ('CREATED', 'FUNDED', 'LOCKED')`),
};

// ── Expiry Config ─────────────────────────────────────────────────────────

export const EXPIRY_UNFUNDED_MS = Number(process.env.ESCROW_EXPIRY_UNFUNDED_MS) || 24 * 60 * 60 * 1000;   // 24h
export const EXPIRY_LOCKED_MS   = Number(process.env.ESCROW_EXPIRY_LOCKED_MS)   || 72 * 60 * 60 * 1000;   // 72h

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
  communityLink: string; federationId: string; sellerPubkey: string;
}): EscrowRow {
  const now = Date.now();
  stmts.insertEscrow.run({
    id: p.id, status: "CREATED", created_at: now, updated_at: now,
    amount_msats: p.amountMsats, description: p.description, terms: p.terms,
    community_link: p.communityLink, federation_id: p.federationId,
    seller_pubkey: p.sellerPubkey, expires_at: now + EXPIRY_UNFUNDED_MS,
  });
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

export function lockNotes(id: string, notes: string, mode: "webln" | "manual", preimage?: string): void {
  const now = Date.now();
  stmts.lockNotes.run({
    id, locked_notes: encryptNotes(notes), locked_at: now,
    lock_mode: mode, lock_preimage: preimage || null, updated_at: now,
  });
  stmts.extendExpiry.run(now + EXPIRY_LOCKED_MS, id);
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

export function closeDb(): void { db.close(); }
export default db;
