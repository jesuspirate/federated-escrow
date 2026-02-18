import express from 'express';
import cors from 'cors';
import { escrowManager } from './core/escrow-manager';

const app = express();
const PORT = 3000;

// Enable JSON parsing
app.use(express.json());

// Enable CORS for your UI
app.use(cors({
  origin: '*', // Allow all for development
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type']
}));

// Initialize the Manager
console.log('Starting server initialization...');
try {
  escrowManager.initialize({
    network: 'testnet',
    federationUrl: 'mock-url'
  });
} catch (error) {
  console.error('Failed to initialize manager:', error);
}

// --- Routes ---

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// GET all escrows
app.get('/api/escrows', async (req, res) => {
  try {
    const escrows = escrowManager.getAllEscrows();
    res.json(escrows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET single escrow
app.get('/api/escrows/:id', async (req, res) => {
  const escrow = escrowManager.getEscrow(req.params.id);
  if (!escrow) {
    return res.status(404).json({ error: 'Escrow not found' });
  }
  res.json(escrow);
});

// POST create escrow
app.post('/api/escrows', async (req, res) => {
  try {
    const { amount } = req.body;
    if (!amount) return res.status(400).json({ error: 'Amount is required' });
    
    const escrow = await escrowManager.createEscrow(Number(amount));
    res.json(escrow);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Seed Test Data
app.post('/api/seed', async (req, res) => {
  await escrowManager.createEscrow(1000);
  await escrowManager.createEscrow(50000);
  res.json({ message: 'Seeded test data' });
});

// Start Server
app.listen(PORT, () => {
  console.log(`🚀 Backend running at http://localhost:${PORT}`);
  console.log(`Testing API available at http://localhost:${PORT}/api/health`);
});
