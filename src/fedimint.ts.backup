// src/fedimint.ts — Fedimint CLI integration
//
// Wraps `fedimint-cli` commands for escrow operations.
// Uses the CLI instead of fedimint-clientd REST API because:
//   - Supports iroh transport (v0.7+ federations)
//   - Built from the main fedimint repo, always version-compatible
//   - Same Fedimint client library underneath
//
// Operations:
//   LOCK:  Create LN invoice → seller pays via WebLN → server confirms
//   CLAIM: Winner generates invoice via WebLN → server pays it out
//   INFO:  Wallet balance and federation status
//
// Config via env:
//   FEDIMINT_CLI_PATH  — path to fedimint-cli binary (default: ~/fedimint/target/release/fedimint-cli)
//   FEDIMINT_DATA_DIR  — path to FM client data dir (default: ./data/fm-cli)

import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import { existsSync } from "fs";

const execFileAsync = promisify(execFile);

const CLI_PATH = process.env.FEDIMINT_CLI_PATH
  || path.join(process.env.HOME || "~", "fedimint", "target", "release", "fedimint-cli");

const DATA_DIR = process.env.FEDIMINT_DATA_DIR
  || path.join(process.cwd(), "data", "fm-cli");

// ── CLI Runner ────────────────────────────────────────────────────────────

async function fm(...args: string[]): Promise<any> {
  try {
    const { stdout, stderr } = await execFileAsync(CLI_PATH, ["--data-dir", DATA_DIR, ...args], {
      timeout: 60_000, // 60s timeout for most operations
      env: { ...process.env, RUST_LOG: "warn" }, // suppress debug noise
    });

    if (stderr && !stderr.includes("WARN") && !stderr.includes("INFO")) {
      console.error("fedimint-cli stderr:", stderr.slice(0, 200));
    }

    const trimmed = stdout.trim();
    if (!trimmed) return null;

    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed; // Some commands return plain strings
    }
  } catch (err: any) {
    // If the binary doesn't exist or isn't executable
    if (err.code === "ENOENT") {
      throw new Error(`fedimint-cli not found at ${CLI_PATH}. Build with: cd ~/fedimint && cargo build --release --bin fedimint-cli`);
    }
    // Timeout
    if (err.killed) {
      throw new Error("fedimint-cli timed out");
    }
    // CLI returned an error
    const msg = err.stderr || err.message || "Unknown CLI error";
    throw new Error(`fedimint-cli error: ${msg.slice(0, 300)}`);
  }
}

// Long-running commands (await-invoice, await-pay) need longer timeouts
async function fmLong(...args: string[]): Promise<any> {
  try {
    const { stdout, stderr } = await execFileAsync(CLI_PATH, ["--data-dir", DATA_DIR, ...args], {
      timeout: 300_000, // 5 min timeout for payment awaits
      env: { ...process.env, RUST_LOG: "warn" },
    });

    const trimmed = stdout.trim();
    if (!trimmed) return null;
    try { return JSON.parse(trimmed); } catch { return trimmed; }
  } catch (err: any) {
    if (err.killed) throw new Error("fedimint-cli await timed out (5min)");
    throw new Error(`fedimint-cli error: ${(err.stderr || err.message || "").slice(0, 300)}`);
  }
}

// ── Health Check ──────────────────────────────────────────────────────────

export async function getWalletInfo(): Promise<{
  totalAmountMsat: number;
  federationId: string;
  meta: Record<string, string>;
  network: string;
} | null> {
  try {
    const info = await fm("info");
    if (!info || !info.federation_id) return null;
    return {
      totalAmountMsat: info.total_amount_msat || 0,
      federationId: info.federation_id,
      meta: info.meta || {},
      network: info.network || "unknown",
    };
  } catch {
    return null;
  }
}

export async function isClientdAvailable(): Promise<boolean> {
  // Check that both the binary exists and a federation is joined
  if (!existsSync(CLI_PATH)) return false;
  const info = await getWalletInfo();
  return info !== null;
}

// ── Lock Flow: Create Invoice ─────────────────────────────────────────────
//
// Creates a BOLT-11 invoice for the exact escrow amount.
// The seller's Fedi wallet pays this via webln.sendPayment().

export async function createLockInvoice(
  escrowId: string,
  amountMsats: number,
): Promise<{
  invoice: string;
  operationId: string;
}> {
  const amountSats = Math.floor(amountMsats / 1000);
  const description = `Escrow ${escrowId} lock ${amountSats} sats`;

  // fedimint-cli module ln invoice <amount_msat> --description <desc>
  const result = await fm("module", "ln", "invoice", String(amountMsats), "--description", description);

  // Result format: { "invoice": "lnbc...", "operation_id": "..." }
  if (!result || !result.invoice) {
    throw new Error("Failed to create invoice: " + JSON.stringify(result));
  }

  return {
    invoice: result.invoice,
    operationId: result.operation_id,
  };
}

// ── Lock Flow: Wait for Payment ───────────────────────────────────────────
//
// Blocks until the invoice is paid. Call after webln.sendPayment() succeeds.

export async function awaitLockPayment(operationId: string): Promise<{
  paid: boolean;
}> {
  try {
    // fedimint-cli await-invoice <operation_id> (top-level, not under module ln)
    await fmLong("await-invoice", operationId);
    return { paid: true };
  } catch (err: any) {
    console.error("awaitLockPayment failed:", err.message);
    return { paid: false };
  }
}

// ── Claim Flow: Pay Out to Winner ─────────────────────────────────────────
//
// Winner generates invoice via webln.makeInvoice(), submits it here.
// Server pays via fedimint-cli.

export async function payoutToWinner(
  invoice: string,
): Promise<{
  success: boolean;
  operationId?: string;
  error?: string;
}> {
  try {
    // fedimint-cli module ln pay <invoice>
    const result = await fm("module", "ln", "pay", invoice);
    return {
      success: true,
      operationId: result?.operation_id,
    };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

// ── Claim Flow: Wait for Payout ───────────────────────────────────────────

export async function awaitPayout(operationId: string): Promise<{
  success: boolean;
  preimage?: string;
}> {
  try {
    // fedimint-cli await-ln-pay <operation_id> (top-level, not under module ln)
    const result = await fmLong("await-ln-pay", operationId);
    return { success: true, preimage: result?.preimage };
  } catch (err: any) {
    console.error("awaitPayout failed:", err.message);
    return { success: false };
  }
}

// ── Gateway Check ─────────────────────────────────────────────────────────

export async function listGateways(): Promise<any[]> {
  try {
    return await fm("module", "ln", "list-gateways");
  } catch {
    return [];
  }
}

// ── E-cash Operations (for future direct e-cash mode) ─────────────────────

export async function spendNotes(amountMsats: number): Promise<string | null> {
  try {
    // fedimint-cli module mint spend <amount_msat>
    const result = await fm("module", "mint", "spend", String(amountMsats));
    return result?.notes || result;
  } catch {
    return null;
  }
}

export async function reissueNotes(notes: string): Promise<boolean> {
  try {
    // fedimint-cli module mint reissue <notes>
    await fm("module", "mint", "reissue", notes);
    return true;
  } catch {
    return false;
  }
}

export async function validateNotes(notes: string): Promise<{ valid: boolean; amountMsat?: number }> {
  try {
    // fedimint-cli module mint validate <notes>
    const result = await fm("module", "mint", "validate", notes);
    return { valid: true, amountMsat: result?.total_amount_msat };
  } catch {
    return { valid: false };
  }
}

export default {
  getWalletInfo,
  isClientdAvailable,
  createLockInvoice,
  awaitLockPayment,
  payoutToWinner,
  awaitPayout,
  listGateways,
  spendNotes,
  reissueNotes,
  validateNotes,
};
