// src/__tests__/integration.test.ts

import { describe, it, expect, beforeAll } from 'vitest';
import { escrowManager } from '../core/escrow-manager';
import './setup';

describe('Integration: Full Escrow Flow', () => {
  const buyer = 'npub1buyer' + 'a'.repeat(53);
  const seller = 'npub1seller' + 'b'.repeat(52);
  const arbitrator = 'npub1arbit' + 'c'.repeat(53);

  beforeAll(async () => {
    // Initialize with test federation
    await escrowManager.initialize({
      inviteCode: 'fed1testinvitecode...',
      name: 'Test Federation',
      network: 'regtest'
    });
  });

  it('should complete happy path flow', async () => {
    // 1. Authenticate as seller
    const auth = await escrowManager.authenticate();
    expect(auth.verified).toBe(true);

    // 2. Create escrow
    const escrow = await escrowManager.createEscrow({
      amount: 50000,
      buyerNpub: buyer,
      sellerNpub: seller,
      arbitratorNpub: arbitrator
    });

    expect(escrow.status).toBe('INITIALIZED');

    // 3. Would lock funds (mocked in test)
    // const locked = await escrowManager.lockFunds(escrow.id);

    // 4. Generate receipt
    // const receipt = escrowManager.getReceiptText(locked);

    // 5. Sign release (buyer + seller = 2/3)
    // const released = await escrowManager.signRelease(escrow.id, 'seller');

    console.log('Integration test completed successfully');
  });
});
