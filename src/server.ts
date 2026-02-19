// src/server.ts
import express from "express";
import cors from "cors";
import ecashEscrowRoutes from "./routes/ecash-escrow";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(cors({
  origin: "*",
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type"],
}));

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: Date.now() });
});

app.use("/api/ecash-escrows", ecashEscrowRoutes);

app.listen(PORT, () => {
  console.log(`🚀 Escrow API running at http://localhost:${PORT}`);
});
