// src/types/federation.ts

export interface FederationConfig {
  readonly inviteCode: string;
  readonly name?: string;
  readonly network: 'mainnet' | 'testnet' | 'signet' | 'regtest';
}

export interface FederationBalance {
  readonly totalMsats: bigint;
  readonly availableMsats: bigint;
  readonly lockedMsats: bigint;
}

export interface PendingTransaction {
  readonly txid: string;
  readonly amount: bigint;
  readonly policy: string;
  readonly partialSignatures: string[];
  readonly created: number;
}

export interface ReissueResult {
  readonly success: boolean;
  readonly txid?: string;
  readonly error?: string;
}
