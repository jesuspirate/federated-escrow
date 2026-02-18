// src/__tests__/escrow-manager.test.ts

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EscrowManager } from '../core/escrow-manager';
import { ValidationError } from '../utils/validation';
import './setup';

describe('EscrowManager', () => {
  let manager: EscrowManager;

  const testFederationConfig = {
    inviteCode: 'fed1test...',
    name: 'Test Federation',
    network: 'regtest' as const
  };

  const validParams = {
    amount: 50000,
    buyerNpub: 'npub1buyer' + 'x'.repeat(53),
    sellerNpub: 'npub1seller' + 'x'.repeat(52),
    arbitratorNpub: 'npub1arbit' + 'x'.repeat(53)
  };

  beforeEach(() => {
    manager = new EscrowManager();
  });

  describe('createEscrow', () => {
    it('should reject without authentication', async () => {
      await expect(manager.createEscrow(validParams))
        .rejects
        .toThrow(ValidationError);
    });

    it('should reject invalid amount', async () => {
      await manager.authenticate();
      
      await expect(manager.createEscrow({ ...validParams, amount: 100 }))
        .rejects
        .toThrow('Amount must be at least');
    });

    it('should reject duplicate participants', async () => {
      await manager.authenticate();
      
      await expect(manager.createEscrow({
        ...validParams,
        buyerNpub: validParams.sellerNpub
      }))
        .rejects
        .toThrow('must be different parties');
    });

    it('should create valid escrow', async () => {
      await manager.authenticate();
      
      const escrow = await manager.createEscrow(validParams);
      
      expect(escrow.id).toBeDefined();
      expect(escrow.amount).toBe(50000);
      expect(escrow.status).toBe('INITIALIZED');
      expect(escrow.policy.threshold).toBe(2);
      expect(escrow.policy.keys).toHaveLength(3);
    });
  });

  describe('getReceiptText', () => {
    it('should generate formatted receipt', async () => {
      await manager.authenticate();
      
      const escrow = await manager.createEscrow(validParams);
      
      // Mock locked state
      const lockedEscrow = {
        ...escrow,
        status: 'LOCKED' as const,
        txid: 'abc123def456'
      };
      
      // Inject for testing
      (manager as any).escrows.set(escrow.id, lockedEscrow);
      
      const receipt = manager.getReceiptText(lockedEscrow);
      
      expect(receipt).toContain('FEDERATED ESCROW RECEIPT');
      expect(receipt).toContain(escrow.id);
      expect(receipt).toContain('50000 sats');
    });
  });
});

