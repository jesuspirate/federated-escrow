// src/utils/validation.ts

import type { CreateEscrowParams, EscrowState } from '../types/escrow';

export const MIN_ESCROW_AMOUNT = 1000n; // 1000 sats minimum
export const MAX_ESCROW_AMOUNT = 100_000_000n; // 1 BTC maximum
export const DEFAULT_EXPIRATION_HOURS = 72;

export class ValidationError extends Error {
  constructor(
    message: string,
    public readonly field?: string,
    public readonly code?: string
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}

export const validateNpub = (npub: string, field: string): void => {
  if (!npub || typeof npub !== 'string') {
    throw new ValidationError(`${field} is required`, field, 'REQUIRED');
  }
  if (!npub.startsWith('npub1') || npub.length !== 63) {
    throw new ValidationError(`Invalid ${field} format`, field, 'INVALID_FORMAT');
  }
};

export const validateAmount = (amount: number): void => {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new ValidationError('Amount must be a positive integer', 'amount', 'INVALID_AMOUNT');
  }
  if (BigInt(amount) < MIN_ESCROW_AMOUNT) {
    throw new ValidationError(
      `Amount must be at least ${MIN_ESCROW_AMOUNT} sats`,
      'amount',
      'AMOUNT_TOO_LOW'
    );
  }
  if (BigInt(amount) > MAX_ESCROW_AMOUNT) {
    throw new ValidationError(
      `Amount must be at most ${MAX_ESCROW_AMOUNT} sats`,
      'amount',
      'AMOUNT_TOO_HIGH'
    );
  }
};

export const validateCreateParams = (params: CreateEscrowParams): void => {
  validateAmount(params.amount);
  validateNpub(params.buyerNpub, 'buyerNpub');
  validateNpub(params.sellerNpub, 'sellerNpub');
  validateNpub(params.arbitratorNpub, 'arbitratorNpub');

  const uniqueParties = new Set([
    params.buyerNpub,
    params.sellerNpub,
    params.arbitratorNpub
  ]);

  if (uniqueParties.size !== 3) {
    throw new ValidationError(
      'Buyer, seller, and arbitrator must be different parties',
      'participants',
      'DUPLICATE_PARTICIPANTS'
    );
  }
};

export const validateEscrowForSigning = (
  escrow: EscrowState,
  signerPubkey: string
): void => {
  if (escrow.status !== 'LOCKED' && escrow.status !== 'AWAITING_SIGNATURES') {
    throw new ValidationError(
      `Cannot sign escrow in ${escrow.status} state`,
      'status',
      'INVALID_STATE'
    );
  }

  const authorizedKeys = [
    escrow.buyer.ecashPubkey,
    escrow.seller.ecashPubkey,
    escrow.arbitrator.ecashPubkey
  ];

  if (!authorizedKeys.includes(signerPubkey)) {
    throw new ValidationError(
      'Signer is not authorized for this escrow',
      'signer',
      'UNAUTHORIZED'
    );
  }

  const existingSig = escrow.signatures.find(s => s.signer === signerPubkey);
  if (existingSig) {
    throw new ValidationError(
      'Signer has already signed this escrow',
      'signer',
      'ALREADY_SIGNED'
    );
  }
};
