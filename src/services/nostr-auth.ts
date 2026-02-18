// src/services/nostr-auth.ts

import { verifyEvent, type Event as NostrEvent } from 'nostr-tools';
import { ValidationError } from '../utils/validation';

declare global {
  interface Window {
    nostr?: {
      getPublicKey(): Promise<string>;
      signEvent(event: Partial<NostrEvent>): Promise<NostrEvent>;
      nip04?: {
        encrypt(pubkey: string, plaintext: string): Promise<string>;
        decrypt(pubkey: string, ciphertext: string): Promise<string>;
      };
    };
  }
}

export interface AuthResult {
  readonly npub: string;
  readonly pubkeyHex: string;
  readonly verified: boolean;
  readonly timestamp: number;
}

export interface FediProfile {
  readonly id: string;
  readonly username?: string;
  readonly nostr?: {
    readonly npub: string;
    readonly relays?: string[];
  };
}

export class NostrAuthService {
  private cachedAuth: AuthResult | null = null;

  async authenticate(): Promise<AuthResult> {
    if (!window.nostr) {
      throw new ValidationError(
        'Nostr extension not found. Please install Fedi, Alby or nos2x.',
        'nostr',
        'EXTENSION_NOT_FOUND'
      );
    }

    try {
      const pubkeyHex = await window.nostr.getPublicKey();
      const npub = this.hexToNpub(pubkeyHex);

      // Create and sign verification event
      const verificationEvent = await this.createVerificationEvent(pubkeyHex);
      const isValid = verifyEvent(verificationEvent);

      if (!isValid) {
        throw new ValidationError(
          'Nostr signature verification failed',
          'signature',
          'INVALID_SIGNATURE'
        );
      }

      this.cachedAuth = {
        npub,
        pubkeyHex,
        verified: true,
        timestamp: Date.now()
      };

      return this.cachedAuth;
    } catch (error) {
      if (error instanceof ValidationError) throw error;
      throw new ValidationError(
        `Authentication failed: ${(error as Error).message}`,
        'auth',
        'AUTH_FAILED'
      );
    }
  }

  async verifyFediProfile(
    npub: string,
    profile: FediProfile
  ): Promise<boolean> {
    if (!profile.nostr?.npub) {
      return false;
    }
    return profile.nostr.npub === npub;
  }

  async signMessage(message: string): Promise<string> {
    if (!window.nostr) {
      throw new ValidationError(
        'Nostr extension not available',
        'nostr',
        'EXTENSION_NOT_FOUND'
      );
    }

    const event = await window.nostr.signEvent({
      kind: 22242, // NIP-42 auth kind
      created_at: Math.floor(Date.now() / 1000),
      tags: [['message', message]],
      content: message
    });

    return event.sig;
  }

  getCachedAuth(): AuthResult | null {
    if (!this.cachedAuth) return null;

    // Invalidate after 1 hour
    const ONE_HOUR = 60 * 60 * 1000;
    if (Date.now() - this.cachedAuth.timestamp > ONE_HOUR) {
      this.cachedAuth = null;
      return null;
    }

    return this.cachedAuth;
  }

  clearAuth(): void {
    this.cachedAuth = null;
  }

  private async createVerificationEvent(pubkey: string): Promise<NostrEvent> {
    if (!window.nostr) {
      throw new Error('Nostr extension not available');
    }

    return window.nostr.signEvent({
      kind: 22242,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['challenge', crypto.randomUUID()]],
      content: 'Federated Escrow Authentication'
    });
  }

  private hexToNpub(hex: string): string {
    // Simplified - in production use proper bech32 encoding
    return `npub1${hex.slice(0, 58)}`;
  }
}

export const nostrAuth = new NostrAuthService();
