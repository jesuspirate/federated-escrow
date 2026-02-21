// src/server.ts
import express from "express";
import cors from "cors";
import path from "path";
import ecashEscrowRoutes from "./routes/ecash-escrow";

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

// Serve UI static files from escrow-ui/dist
const distPath = path.join(__dirname, "..", "escrow-ui", "dist");
app.use(express.static(distPath));
app.get("/{0,}", (_req, res) => {
  res.sendFile(path.join(distPath, "index.html"));
});

app.listen(PORT, () => {
  console.log(`🚀 Escrow API running at http://localhost:${PORT}`);
  console.log(`📱 UI served from ${distPath}`);
});
