// escrow-ui/src/services/webln-escrow.ts
//
// WebLN-based payment service for the Fedi Mini-App escrow.
//
// When your app runs inside Fedi as a Mini-App (Site), Fedi injects
// the WebLN provider into window.webln. This gives your app access to:
//   - window.webln.sendPayment(invoice)  → pay a Lightning invoice
//   - window.webln.makeInvoice(amount)   → create a Lightning invoice
//   - window.webln.getInfo()             → get wallet info
//
// This means we DON'T need @fedimint/core WASM at all.
// Fedi handles all the Fedimint wallet operations natively.
//
// Escrow flow with WebLN:
//   1. Create escrow on server → server generates a Lightning invoice
//   2. Seller pays the invoice via WebLN → server confirms payment
//   3. 2-of-3 vote on outcome
//   4. Winner receives payout → server pays a Lightning invoice to winner
//
// This also works standalone (outside Fedi) with any WebLN wallet
// like Alby, BlueWallet, etc.

// ── Types ─────────────────────────────────────────────────────────────────

interface WebLNProvider {
  enable(): Promise<void>;
  getInfo(): Promise<{ node: { alias: string; pubkey: string } }>;
  sendPayment(paymentRequest: string): Promise<{ preimage: string }>;
  makeInvoice(args: {
    amount: number | string;
    defaultMemo?: string;
  }): Promise<{ paymentRequest: string }>;
  signMessage?(message: string): Promise<{ signature: string }>;
}

declare global {
  interface Window {
    webln?: WebLNProvider;
  }
}

export interface EscrowPaymentResult {
  success: boolean;
  preimage?: string;
  error?: string;
}

// ── WebLN Service ─────────────────────────────────────────────────────────

class WeblnEscrowService {
  private enabled = false;

  /**
   * Check if WebLN is available (injected by Fedi or another wallet).
   */
  isAvailable(): boolean {
    return typeof window !== "undefined" && !!window.webln;
  }

  /**
   * Enable the WebLN provider.
   * Must be called before any payment operations.
   * In Fedi, this is typically auto-approved.
   */
  async enable(): Promise<boolean> {
    if (!this.isAvailable()) {
      console.warn("[WebLN] No WebLN provider detected");
      return false;
    }

    try {
      await window.webln!.enable();
      this.enabled = true;
      console.log("[WebLN] Provider enabled");
      return true;
    } catch (err) {
      console.error("[WebLN] Enable failed:", err);
      return false;
    }
  }

  /**
   * Get wallet info from the WebLN provider.
   */
  async getInfo(): Promise<{ alias: string; pubkey: string } | null> {
    if (!this.enabled) await this.enable();
    if (!this.enabled) return null;

    try {
      const info = await window.webln!.getInfo();
      return info.node;
    } catch {
      return null;
    }
  }

  /**
   * Pay a Lightning invoice (used by seller to fund escrow).
   * Fedi will show a confirmation dialog to the user.
   */
  async payInvoice(bolt11: string): Promise<EscrowPaymentResult> {
    if (!this.enabled) await this.enable();
    if (!this.enabled) {
      return { success: false, error: "WebLN not available" };
    }

    try {
      const result = await window.webln!.sendPayment(bolt11);
      return { success: true, preimage: result.preimage };
    } catch (err: any) {
      return {
        success: false,
        error: err.message || "Payment failed or was rejected",
      };
    }
  }

  /**
   * Create a Lightning invoice (used by winner to receive payout).
   * Fedi will generate the invoice from the user's federation wallet.
   */
  async createInvoice(
    amountSats: number,
    memo = "Escrow payout"
  ): Promise<string | null> {
    if (!this.enabled) await this.enable();
    if (!this.enabled) return null;

    try {
      const result = await window.webln!.makeInvoice({
        amount: amountSats,
        defaultMemo: memo,
      });
      return result.paymentRequest;
    } catch (err) {
      console.error("[WebLN] createInvoice failed:", err);
      return null;
    }
  }
}

// ── API Client ────────────────────────────────────────────────────────────

const API_BASE =
  typeof window !== "undefined" && window.location.hostname === "localhost"
    ? "http://localhost:3000/api"
    : "/api"; // In production, same origin

export interface CreateEscrowParams {
  amountSats: number;
  description?: string;
}

export interface EscrowDetails {
  id: string;
  status: string;
  amountSats: number;
  description: string;
  fundingInvoice?: string;
  fundingPaid?: boolean;
  votes: {
    release: number;
    refund: number;
    voters: { role: string; outcome: string }[];
  };
  resolvedOutcome: string | null;
  claimedBy: string | null;
  yourRole?: string;
  canClaim?: boolean;
  createdAt: number;
}

async function apiCall(path: string, opts: RequestInit = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || "Request failed");
  }
  return res.json();
}

/**
 * Full escrow client that combines WebLN payments with the escrow API.
 */
class EscrowClient {
  webln = new WeblnEscrowService();

  // ── Escrow CRUD ─────────────────────────────────────────────────────

  async createEscrow(params: CreateEscrowParams) {
    return apiCall("/ecash-escrows", {
      method: "POST",
      body: JSON.stringify({
        amountMsats: params.amountSats * 1000,
        description: params.description || "",
      }),
    });
  }

  async getEscrow(id: string, token?: string) {
    const query = token ? `?token=${token}` : "";
    return apiCall(`/ecash-escrows/${id}${query}`);
  }

  async listEscrows() {
    return apiCall("/ecash-escrows");
  }

  // ── Funding (Seller pays Lightning invoice) ─────────────────────────

  /**
   * Lock funds in escrow.
   *
   * For the Fedi Mini-App flow:
   *   1. Server generates a Lightning invoice for the escrow amount
   *   2. Seller pays via WebLN (Fedi shows payment dialog)
   *   3. Server confirms payment and locks the escrow
   *
   * For the e-cash note flow (standalone/direct):
   *   1. Seller spends notes client-side
   *   2. Posts note string to server
   */
  async fundEscrowViaLightning(id: string, token: string) {
    // Step 1: Tell server to generate a funding invoice
    const { invoice } = await apiCall(`/ecash-escrows/${id}/invoice`, {
      method: "POST",
      body: JSON.stringify({ token }),
    });

    // Step 2: Pay via WebLN (Fedi shows confirmation)
    const payResult = await this.webln.payInvoice(invoice);
    if (!payResult.success) {
      throw new Error(payResult.error || "Payment failed");
    }

    // Step 3: Confirm payment to server
    return apiCall(`/ecash-escrows/${id}/lock`, {
      method: "POST",
      body: JSON.stringify({
        token,
        notes: `lightning:${payResult.preimage}`,
      }),
    });
  }

  /**
   * Lock funds using e-cash notes directly (non-Lightning path).
   */
  async fundEscrowWithNotes(id: string, token: string, notes: string) {
    return apiCall(`/ecash-escrows/${id}/lock`, {
      method: "POST",
      body: JSON.stringify({ token, notes }),
    });
  }

  // ── Voting ──────────────────────────────────────────────────────────

  async vote(id: string, token: string, outcome: "release" | "refund") {
    return apiCall(`/ecash-escrows/${id}/approve`, {
      method: "POST",
      body: JSON.stringify({ token, outcome }),
    });
  }

  // ── Claiming ────────────────────────────────────────────────────────

  /**
   * Claim the escrow funds.
   *
   * For Fedi Mini-App:
   *   1. Winner generates a Lightning invoice via WebLN
   *   2. Server pays the invoice (sends funds to winner)
   *
   * For e-cash note flow:
   *   1. Server returns the note string
   *   2. Winner reissues into their wallet
   */
  async claimEscrow(id: string, token: string) {
    return apiCall(`/ecash-escrows/${id}/claim`, {
      method: "POST",
      body: JSON.stringify({ token }),
    });
  }
}

// ── Singleton Export ──────────────────────────────────────────────────────

export const escrowClient = new EscrowClient();
export default escrowClient;
