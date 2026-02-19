// src/server.ts
//
// Express API server for the federated escrow system.
//
// Routes:
//   GET    /api/health               - Health check
//   POST   /api/escrows              - Create escrow (multisig wallet)
//   GET    /api/escrows              - List all escrows
//   GET    /api/escrows/:id          - Get escrow details
//   POST   /api/escrows/:id/fund     - Fund escrow (seller locks sats)
//   POST   /api/escrows/:id/release  - Release or refund (2-of-3 sign)
//   GET    /api/escrows/:id/utxo     - Check escrow UTXO

import express from "express";
import cors from "cors";
import escrowRoutes from "./routes/escrow";
import ecashEscrowRoutes from "./routes/ecash-escrow";

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type"],
  })
);

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: Date.now() });
});

// Mount escrow routes
app.use("/api/escrows", escrowRoutes);
app.use("/api/ecash-escrows", ecashEscrowRoutes);

// Start
app.listen(PORT, () => {
  console.log(`🚀 Escrow API running at http://localhost:${PORT}`);
  console.log(`   Health:  GET  http://localhost:${PORT}/api/health`);
  console.log(`   Escrows: POST http://localhost:${PORT}/api/escrows`);
  console.log(`   Fund:    POST http://localhost:${PORT}/api/escrows/:id/fund`);
  console.log(`   Release: POST http://localhost:${PORT}/api/escrows/:id/release`);
});
