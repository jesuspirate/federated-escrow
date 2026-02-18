// src/index.ts

export { EscrowManager, escrowManager } from './core/escrow-manager';
export { SignatureCoordinator, signatureCoordinator } from './core/signature-coordinator';
export { FederationClient, federationClient } from './services/federation-client';
export { NostrAuthService, nostrAuth } from './services/nostr-auth';

export type {
  EscrowState,
  EscrowStatus,
  EscrowParticipant,
  MultisigPolicy,
  CreateEscrowParams,
  EscrowReceipt,
  PartialSignature,
  ResolutionTarget
} from './types/escrow';

export type {
  FederationConfig,
  FederationBalance,
  PendingTransaction
} from './types/federation';

export {
  ValidationError,
  validateAmount,
  validateNpub
} from './utils/validation';

export {
  generateEscrowId,
  hashPolicy,
  deriveEcashPubkey
} from './utils/crypto';

// Expose to window for Fedi Mini-App
if (typeof window !== 'undefined') {
  (window as any).FederatedEscrow = {
    manager: escrowManager,
    federation: federationClient,
    auth: nostrAuth,
    signatures: signatureCoordinator
  };
}
