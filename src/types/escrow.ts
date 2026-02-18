// src/types/escrow.ts

export type EscrowStatus = 
  | 'INITIALIZED'
  | 'LOCKED'
  | 'AWAITING_SIGNATURES'
  | 'RELEASED'
  | 'DISPUTED'
  | 'RESOLVED'
  | 'EXPIRED'
  | 'CANCELLED';

export type ResolutionTarget = 'buyer' | 'seller';

export interface MultisigPolicy {
  readonly threshold: 2;
  readonly keys: readonly [string, string, string];
  readonly timelock?: number;
}

export interface EscrowParticipant {
  readonly npub: string;
  readonly ecashPubkey: string;
  readonly role: 'buyer' | 'seller' | 'arbitrator';
  readonly verified: boolean;
}

export interface PartialSignature {
  readonly escrowId: string;
  readonly signer: string;
  readonly signature: string;
  readonly timestamp: number;
  readonly resolveTo: ResolutionTarget;
}

export interface EscrowState {
  readonly id: string;
  readonly amount: number;
  readonly buyer: EscrowParticipant;
  readonly seller: EscrowParticipant;
  readonly arbitrator: EscrowParticipant;
  readonly policy: MultisigPolicy;
  readonly status: EscrowStatus;
  readonly created: number;
  readonly updated: number;
  readonly txid?: string;
  readonly signatures: readonly PartialSignature[];
  readonly receipt?: string;
  readonly expiresAt?: number;
}

export interface CreateEscrowParams {
  readonly amount: number;
  readonly buyerNpub: string;
  readonly sellerNpub: string;
  readonly arbitratorNpub: string;
  readonly expirationHours?: number;
}

export interface EscrowReceipt {
  readonly escrowId: string;
  readonly txid: string;
  readonly policyHash: string;
  readonly timestamp: number;
  readonly signature: string;
}
