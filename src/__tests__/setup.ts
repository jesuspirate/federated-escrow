// src/__tests__/setup.ts
import { vi } from 'vitest';

// 1. Mock @fedimint/core
// This prevents the "FedimintWallet is not a constructor" error
vi.mock('@fedimint/core', () => {
  return {
    FedimintWallet: class MockFedimintWallet {
      waitForOpen = vi.fn().mockResolvedValue(undefined);
      open = vi.fn().mockResolvedValue(undefined);
      balance = {
        getBalance: vi.fn().mockResolvedValue(100000)
      };
      lightning = {
        createInvoice: vi.fn().mockResolvedValue('lnbc1fakeinvoice')
      };
    }
  };
});

// 2. Mock nostr-tools
// This prevents "Nostr signature verification failed"
// We force verifyEvent to always return TRUE so we don't need real crypto keys
vi.mock('nostr-tools', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as object),
    verifyEvent: vi.fn().mockReturnValue(true) // Always say the signature is valid
  };
});

// 3. Mock window.nostr (Browser Extension)
const mockNostr = {
  getPublicKey: vi.fn().mockResolvedValue('0000000000000000000000000000000000000000000000000000000000000000'), // Valid 32-byte hex
  signEvent: vi.fn().mockImplementation(async (event) => ({
    ...event,
    id: 'mock_event_id',
    pubkey: '0000000000000000000000000000000000000000000000000000000000000000',
    sig: 'mock_valid_signature_string'
  })),
  nip04: {
    encrypt: vi.fn().mockResolvedValue('encrypted'),
    decrypt: vi.fn().mockResolvedValue('decrypted')
  }
};

// 4. Mock window.webln
const mockWebln = {
  enable: vi.fn().mockResolvedValue(true),
  sendPayment: vi.fn().mockResolvedValue({ preimage: 'mock_preimage' }),
  makeInvoice: vi.fn().mockResolvedValue({ paymentRequest: 'lnbc...' })
};

// Apply mocks to global window object
Object.defineProperty(global, 'window', {
  value: {
    nostr: mockNostr,
    webln: mockWebln,
    crypto: {
      getRandomValues: (arr: Uint8Array) => {
        // Deterministic random for tests
        for (let i = 0; i < arr.length; i++) {
          arr[i] = 1; 
        }
        return arr;
      },
      randomUUID: () => '12345678-1234-1234-1234-123456789abc'
    }
  },
  writable: true
});

export { mockNostr, mockWebln };
