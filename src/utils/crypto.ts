// src/utils/crypto.ts

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import * as secp256k1 from '@noble/secp256k1';

export const generateEscrowId = (): string => {
  const randomBytes = crypto.getRandomValues(new Uint8Array(16));
  return bytesToHex(randomBytes).slice(0, 24);
};

export const hashPolicy = (policy: object): string => {
  const encoded = new TextEncoder().encode(JSON.stringify(policy));
  return bytesToHex(sha256(encoded));
};

export const deriveEcashPubkey = async (npub: string): Promise<string> => {
  const decoded = decodeNpub(npub);
  const derived = sha256(new TextEncoder().encode(`ecash:${decoded}`));
  return `ecash_${bytesToHex(derived).slice(0, 64)}`;
};

export const decodeNpub = (npub: string): string => {
  if (!npub.startsWith('npub1')) {
    throw new Error('Invalid npub format');
  }
  // Simplified bech32 decode - in production use proper bech32 library
  return npub.slice(5);
};

export const createReceiptSignature = async (
  escrowId: string,
  txid: string,
  policyHash: string,
  privateKey: Uint8Array
): Promise<string> => {
  const message = `${escrowId}:${txid}:${policyHash}`;
  const messageHash = sha256(new TextEncoder().encode(message));
  const signature = await secp256k1.signAsync(messageHash, privateKey);
  return bytesToHex(signature.toCompactRawBytes());
};

export const verifyReceiptSignature = async (
  escrowId: string,
  txid: string,
  policyHash: string,
  signature: string,
  publicKey: string
): Promise<boolean> => {
  const message = `${escrowId}:${txid}:${policyHash}`;
  const messageHash = sha256(new TextEncoder().encode(message));
  const sig = secp256k1.Signature.fromCompact(hexToBytes(signature));
  return secp256k1.verify(sig, messageHash, hexToBytes(publicKey));
};
