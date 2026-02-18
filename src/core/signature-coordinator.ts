// src/core/signature-coordinator.ts

import type { 
  EscrowState, 
  PartialSignature, 
  ResolutionTarget 
} from '../types/escrow';
import { federationClient } from '../services/federation-client';
import { ValidationError, validateEscrowForSigning } from '../utils/validation';

interface SignatureStore {
  [escrowId: string]: PartialSignature[];
}

export class SignatureCoordinator {
  private signatures: SignatureStore = {};

  async addSignature(
    escrow: EscrowState,
    signerPubkey: string,
    signature: string,
    resolveTo: ResolutionTarget
  ): Promise<{ added: boolean; thresholdMet: boolean }> {
    validateEscrowForSigning(escrow, signerPubkey);

    const partialSig: PartialSignature = {
      escrowId: escrow.id,
      signer: signerPubkey,
      signature,
      timestamp: Date.now(),
      resolveTo
    };

    // Initialize array if needed
    if (!this.signatures[escrow.id]) {
      this.signatures[escrow.id] = [];
    }

    // Verify all signatures resolve to same target
    const existingSigs = this.signatures[escrow.id];
    if (existingSigs.length > 0 && existingSigs[0].resolveTo !== resolveTo) {
      throw new ValidationError(
        'Signature resolution target mismatch',
        'resolveTo',
        'RESOLUTION_MISMATCH'
      );
    }

    // Submit to federation
    const submitted = await federationClient.submitPartialSignature(
      escrow.txid!,
      signature,
      signerPubkey
    );

    if (!submitted) {
      throw new ValidationError(
        'Failed to submit signature to federation',
        'signature',
        'SUBMISSION_FAILED'
      );
    }

    this.signatures[escrow.id].push(partialSig);

    const thresholdMet = this.signatures[escrow.id].length >= 2;

    return { added: true, thresholdMet };
  }

  getSignatures(escrowId: string): readonly PartialSignature[] {
    return this.signatures[escrowId] ?? [];
  }

  getSignatureCount(escrowId: string): number {
    return this.signatures[escrowId]?.length ?? 0;
  }

  async finalize(escrow: EscrowState): Promise<boolean> {
    const sigs = this.signatures[escrow.id];
    
    if (!sigs || sigs.length < 2) {
      throw new ValidationError(
        'Insufficient signatures for finalization',
        'signatures',
        'INSUFFICIENT_SIGNATURES'
      );
    }

    const combinedSigs = sigs.map(s => s.signature);
    
    return federationClient.broadcastFinalTransaction(
      escrow.txid!,
      combinedSigs
    );
  }

  clearSignatures(escrowId: string): void {
    delete this.signatures[escrowId];
  }
}

export const signatureCoordinator = new SignatureCoordinator();
