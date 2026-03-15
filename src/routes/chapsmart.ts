// ── ChapSmart Integration — Bitcoin-to-M-Pesa via SatoshiMarket Escrow ──
import { Router, Request, Response } from "express";

const router = Router();

const CHAPSMART_API = "https://backend.chapsmart.com";
const CHAPSMART_KEY = process.env.CHAPSMART_API_KEY || "";
const CHAPSMART_SECRET = process.env.CHAPSMART_API_SECRET || "";

// Shared headers for all ChapSmart API calls
function chapHeaders() {
  return {
    "X-API-Key": CHAPSMART_KEY,
    "X-API-Secret": CHAPSMART_SECRET,
    "Content-Type": "application/json",
  };
}

// ── POST /create-account — Create anonymous ChapSmart account ────────
router.post("/create-account", async (_req: Request, res: Response) => {
  try {
    const r = await fetch(`${CHAPSMART_API}/api/v1/auth/createAccount`, {
      method: "POST", headers: chapHeaders(), body: "{}",
    });
    const data = await r.json();
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /quote — Get price quote for TZS remittance ────────────────
router.post("/quote", async (req: Request, res: Response) => {
  try {
    const { amountTZS, phoneNumber, recipientName, accountNumber } = req.body;
    if (!amountTZS || !phoneNumber || !recipientName || !accountNumber) {
      return res.status(400).json({ success: false, error: "Missing required fields: amountTZS, phoneNumber, recipientName, accountNumber" });
    }
    const r = await fetch(`${CHAPSMART_API}/api/v1/invoices/quote`, {
      method: "POST", headers: chapHeaders(),
      body: JSON.stringify({ metadata: { amountTZS: parseInt(amountTZS), phoneNumber, recipientName, accountNumber } }),
    });
    const data = await r.json();
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /generate-invoice — Generate Lightning invoice from quote ───
router.post("/generate-invoice", async (req: Request, res: Response) => {
  try {
    const { quoteId } = req.body;
    if (!quoteId) return res.status(400).json({ success: false, error: "Missing quoteId" });
    const r = await fetch(`${CHAPSMART_API}/api/v1/invoices/generate`, {
      method: "POST", headers: chapHeaders(),
      body: JSON.stringify({ quoteId }),
    });
    const data = await r.json();
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /status/:invoiceId — Check payment & delivery status ─────────
router.get("/status/:invoiceId", async (req: Request, res: Response) => {
  try {
    const r = await fetch(`${CHAPSMART_API}/api/v1/invoices/status/${req.params.invoiceId}`, {
      headers: chapHeaders(),
    });
    const data = await r.json();
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /airtime/quote — Get airtime top-up quote ───────────────────
router.post("/airtime/quote", async (req: Request, res: Response) => {
  try {
    const { amountTZS, phoneNumber, accountNumber } = req.body;
    if (!amountTZS || !phoneNumber || !accountNumber) {
      return res.status(400).json({ success: false, error: "Missing required fields" });
    }
    const r = await fetch(`${CHAPSMART_API}/api/v1/airtime/quote`, {
      method: "POST", headers: chapHeaders(),
      body: JSON.stringify({ metadata: { amountTZS: parseInt(amountTZS), phoneNumber, accountNumber } }),
    });
    const data = await r.json();
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /airtime/generate — Generate airtime invoice ────────────────
router.post("/airtime/generate", async (req: Request, res: Response) => {
  try {
    const { quoteId } = req.body;
    if (!quoteId) return res.status(400).json({ success: false, error: "Missing quoteId" });
    const r = await fetch(`${CHAPSMART_API}/api/v1/airtime/generate`, {
      method: "POST", headers: chapHeaders(),
      body: JSON.stringify({ quoteId }),
    });
    const data = await r.json();
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /buy-sats/quote — Get buy sats quote ───────────────────────
router.post("/buy-sats/quote", async (req: Request, res: Response) => {
  try {
    const { amountTZS, accountNumber } = req.body;
    const r = await fetch(`${CHAPSMART_API}/api/v1/buy/quote`, {
      method: "POST", headers: chapHeaders(),
      body: JSON.stringify({ amountTZS: parseInt(amountTZS), accountNumber }),
    });
    const data = await r.json();
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /buy-sats/send — Submit M-Pesa payment and receive sats ────
router.post("/buy-sats/send", async (req: Request, res: Response) => {
  try {
    const { quoteId, mpesaId, bolt11 } = req.body;
    const r = await fetch(`${CHAPSMART_API}/api/v1/buy/send-sats`, {
      method: "POST", headers: chapHeaders(),
      body: JSON.stringify({ quoteId, mpesaId, bolt11 }),
    });
    const data = await r.json();
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /nostr/signup — Create ChapSmart account with Nostr ─────────
router.post("/nostr/signup", async (req: Request, res: Response) => {
  try {
    const { signedEvent } = req.body;
    if (!signedEvent) return res.status(400).json({ success: false, error: "Missing signedEvent" });
    const r = await fetch(`${CHAPSMART_API}/api/v1/auth/nostr/signup`, {
      method: "POST", headers: chapHeaders(),
      body: JSON.stringify({ signedEvent }),
    });
    const data = await r.json();
    res.status(r.status).json(data);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /nostr/login — Login with existing Nostr-linked account ─────
router.post("/nostr/login", async (req: Request, res: Response) => {
  try {
    const { signedEvent } = req.body;
    if (!signedEvent) return res.status(400).json({ success: false, error: "Missing signedEvent" });
    const r = await fetch(`${CHAPSMART_API}/api/v1/auth/nostr/login`, {
      method: "POST", headers: chapHeaders(),
      body: JSON.stringify({ signedEvent }),
    });
    const data = await r.json();
    res.status(r.status).json(data);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /nostr/link — Link Nostr key to existing account ────────────
router.post("/nostr/link", async (req: Request, res: Response) => {
  try {
    const { accountNumber, signedEvent } = req.body;
    if (!accountNumber || !signedEvent) return res.status(400).json({ success: false, error: "Missing accountNumber or signedEvent" });
    const r = await fetch(`${CHAPSMART_API}/api/v1/auth/nostr/link`, {
      method: "POST", headers: chapHeaders(),
      body: JSON.stringify({ accountNumber, signedEvent }),
    });
    const data = await r.json();
    res.status(r.status).json(data);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

if (CHAPSMART_KEY) {
  console.log("[chapsmart] ✅ ChapSmart integration enabled");
} else {
  console.log("[chapsmart] ⚠️  ChapSmart disabled — set CHAPSMART_API_KEY in .env");
}

export default router;
