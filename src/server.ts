// src/server.ts
import express from "express";
import cors from "cors";
import path from "path";
import db from "./db";
import ecashEscrowRoutes from "./routes/ecash-escrow";
import marketplaceRoutes from "./routes/marketplace";
import chapsmartRoutes from "./routes/chapsmart";
import tradeChatRoutes from "./routes/trade-chat";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(cors({
  origin: "*",
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Dev-Pubkey"],
}));

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: Date.now() });
});

app.use("/api/ecash-escrows", ecashEscrowRoutes);
app.use("/api/marketplace/listings", marketplaceRoutes);
app.use("/api/chapsmart", chapsmartRoutes);
app.use("/api/chat", tradeChatRoutes);

// Serve UI static files from escrow-ui/dist — no cache on HTML, fingerprinted assets cached
const distPath = path.join(__dirname, "..", "escrow-ui", "dist");

// Landing page for root domain — must come BEFORE static middleware
app.get("/", (req, res, next) => {
  const host = req.hostname || "";
  if (!host.startsWith("escrow.") && !host.startsWith("p2p.") && !host.startsWith("market.") && !host.startsWith("lending.") && !host.startsWith("sandbox.")) {
    const fs = require("fs");
    const landingPath = path.join(distPath, "landing.html");
    if (fs.existsSync(landingPath)) {
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      return res.sendFile(landingPath);
    }
  }
  next();
});

// French landing page
app.get("/fr", (req: any, res: any) => {
  const fs = require("fs");
  const frPath = path.join(distPath, "fr.html");
  if (fs.existsSync(frPath)) {
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    return res.sendFile(frPath);
  }
  res.redirect("/");
});

// Spanish landing page
app.get("/es", (req: any, res: any) => {
  const fs = require("fs");
  const esPath = path.join(distPath, "es.html");
  if (fs.existsSync(esPath)) {
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    return res.sendFile(esPath);
  }
  res.redirect("/");
});

app.use(express.static(distPath, {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith(".html")) {
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    } else if (filePath.includes("/assets/")) {
      res.setHeader("Cache-Control", "public, max-age=86400");
    }
  }
}));
app.get("/{0,}", (req, res) => {
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  // Serve landing page for root domain (satoshimarket.app)
  const host = req.hostname || "";
  if (!host.startsWith("escrow.") && !host.startsWith("p2p.") && !host.startsWith("market.") && !host.startsWith("lending.") && !host.startsWith("sandbox.")) {
    const landingPath = path.join(distPath, "landing.html");
    if (require("fs").existsSync(landingPath)) {
      return res.sendFile(landingPath);
    }
  }
  res.sendFile(path.join(distPath, "index.html"));
});

app.listen(PORT, () => {
  console.log(`🚀 Escrow API running at http://localhost:${PORT}`);
  console.log(`📱 UI served from ${distPath}`);
});

// ── Cleanup: expire stale escrows ──
const runCleanup = () => {
  try {
    const now = Date.now();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    const fourteenDaysMs = 14 * 24 * 60 * 60 * 1000;
    const stale = db.prepare("UPDATE escrows SET status = 'EXPIRED', updated_at = ? WHERE status IN ('CREATED', 'FUNDED') AND CAST(created_at AS INTEGER) < ?").run(String(now), now - sevenDaysMs);
    if (stale.changes > 0) console.log("[cleanup] Expired " + stale.changes + " stale CREATED/FUNDED escrows");
    const orphaned = db.prepare("UPDATE escrows SET status = 'EXPIRED', updated_at = ? WHERE status = 'LOCKED' AND (seller_fed_prefix IS NULL OR seller_fed_prefix = '') AND CAST(created_at AS INTEGER) < ?").run(String(now), now - fourteenDaysMs);
    if (orphaned.changes > 0) console.log("[cleanup] Expired " + orphaned.changes + " orphaned LOCKED escrows (no fed prefix)");
  } catch (err) { console.error("[cleanup] Error:", err); }
};
runCleanup(); // Run once on startup
setInterval(runCleanup, 6 * 60 * 60 * 1000); // Then every 6 hours
