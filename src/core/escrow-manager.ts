import { EventEmitter } from 'events';

// Data Models
export interface EscrowTransaction {
  id: string;
  amount: number;
  btcAmount?: number;
  status: 'pending' | 'completed' | 'expired' | 'failed';
  createdAt: number;
  timelock: number;
}

export class EscrowManager extends EventEmitter {
  private escrows: Map<string, EscrowTransaction>;
  private federationClient: any; // Mocked for now

  // THIS IS THE CONSTRUCTOR YOU WERE MISSING
  constructor() {
    super();
    this.escrows = new Map();
    this.federationClient = null;
  }

  // initialize method called by server.ts
  public async initialize(config: any): Promise<void> {
    console.log('Initializing Escrow Manager with config:', config);
    
    // Mock the federation client to prevent the other error you were seeing
    this.federationClient = {
      initialize: async () => console.log('✅ Federation Client (Mock) initialized'),
      status: () => 'connected'
    };
    
    await this.federationClient.initialize();
  }

  public async createEscrow(amount: number): Promise<EscrowTransaction> {
    const id = `escrow-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    
    const newEscrow: EscrowTransaction = {
      id,
      amount,
      btcAmount: amount / 100000000, // Satoshis to BTC
      status: 'pending',
      createdAt: Date.now(),
      timelock: Date.now() + 86400000 // 24 hours
    };

    this.escrows.set(id, newEscrow);
    console.log(`Created escrow: ${id}`);
    return newEscrow;
  }

  public getEscrow(id: string): EscrowTransaction | undefined {
    return this.escrows.get(id);
  }

  public getAllEscrows(): EscrowTransaction[] {
    return Array.from(this.escrows.values());
  }
}

// CRITICAL: Export a Singleton Instance
export const escrowManager = new EscrowManager();
