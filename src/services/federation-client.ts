// src/services/federation-client.ts
export class FederationClient {
  private initialized = false;

  async initialize(inviteCode: string, network: string): Promise<void> {
    console.log('✅ Federation client MOCK initialized:', { inviteCode, network });
    this.initialized = true;
  }

  async getBalance(): Promise<number> {
    return 100000; // Mock 0.001 BTC (100k sats)
  }

  async deposit(amountSats: number): Promise<string> {
    console.log(`💰 Mock deposit: ${amountSats} sats`);
    return `mock-txid-${Date.now()}`;
  }

  isConnected(): boolean {
    return this.initialized;
  }
}
