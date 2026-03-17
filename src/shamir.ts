// ── Shamir Secret Sharing — Non-Custodial Escrow Layer ──────────────────
// Split e-cash notes into 2-of-3 shares, NIP-44 encrypted to each participant.
// Server never holds full notes after splitting. Payout requires 2 shares.

import { split, combine } from "shamir-secret-sharing";

export interface ShamirShares {
  seller_share: string;   // base64 encoded share
  buyer_share: string;    // base64 encoded share
  arbiter_share: string;  // base64 encoded share
}

/**
 * Split e-cash notes into 3 Shamir shares (2-of-3 threshold)
 * Returns base64-encoded shares assigned to each role
 */
export async function splitNotes(notes: string): Promise<ShamirShares> {
  const secret = new TextEncoder().encode(notes);
  const shares = await split(secret, 3, 2);  // 3 shares, threshold 2
  return {
    seller_share: Buffer.from(shares[0]).toString("base64"),
    buyer_share: Buffer.from(shares[1]).toString("base64"),
    arbiter_share: Buffer.from(shares[2]).toString("base64"),
  };
}

/**
 * Reconstruct e-cash notes from any 2 Shamir shares
 * @param share1 - base64 encoded share
 * @param share2 - base64 encoded share
 * @returns original e-cash notes string
 */
export async function combineShares(share1: string, share2: string): Promise<string> {
  const s1 = new Uint8Array(Buffer.from(share1, "base64"));
  const s2 = new Uint8Array(Buffer.from(share2, "base64"));
  const reconstructed = await combine([s1, s2]);
  return new TextDecoder().decode(reconstructed);
}

/**
 * Validate that shares reconstruct to valid e-cash notes
 * (sanity check — notes should start with known prefix)
 */
export function validateReconstructedNotes(notes: string): boolean {
  // E-cash notes are base64 strings starting with "AwEE"
  return typeof notes === "string" && notes.length > 100 && notes.startsWith("AwEE");
}
