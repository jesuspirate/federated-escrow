// src/server.ts
import express from "express";
import cors from "cors";
import path from "path";
import ecashEscrowRoutes from "./routes/ecash-escrow";
import marketplaceRoutes from "./routes/marketplace";
import chapsmartRoutes from "./routes/chapsmart";

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

// Serve UI static files from escrow-ui/dist — no cache on HTML, fingerprinted assets cached
const distPath = path.join(__dirname, "..", "escrow-ui", "dist");
app.use(express.static(distPath, {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith(".html")) {
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    } else if (filePath.includes("/assets/")) {
      res.setHeader("Cache-Control", "public, max-age=86400");
    }
  }
}));
app.get("/{0,}", (_req, res) => {
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.sendFile(path.join(distPath, "index.html"));
});

app.listen(PORT, () => {
  console.log(`🚀 Escrow API running at http://localhost:${PORT}`);
  console.log(`📱 UI served from ${distPath}`);
});
