import * as bitcoin from "bitcoinjs-lib";
import * as ecc from "tiny-secp256k1";
import ECPairFactory from "ecpair";

const ECPair = ECPairFactory(ecc);

// Use regtest network
const network = bitcoin.networks.regtest;

export interface Participant {
  role: "buyer" | "seller" | "arbiter";
  keyPair: ReturnType<typeof ECPair.makeRandom>;
  publicKey: Buffer;
  wif: string;
}

export interface EscrowWallet {
  buyer: Participant;
  seller: Participant;
  arbiter: Participant;
  redeemScript: Buffer;
  address: string;
  requiredSignatures: number;
}

/**
 * Generate a new participant keypair
 */
export function createParticipant(role: "buyer" | "seller" | "arbiter"): Participant {
  const keyPair = ECPair.makeRandom({ network });
  return {
    role,
    keyPair,
    publicKey: Buffer.from(keyPair.publicKey),
    wif: keyPair.toWIF(),
  };
}

/**
 * Restore a participant from a WIF private key
 */
export function restoreParticipant(
  role: "buyer" | "seller" | "arbiter",
  wif: string
): Participant {
  const keyPair = ECPair.fromWIF(wif, network);
  return {
    role,
    keyPair,
    publicKey: Buffer.from(keyPair.publicKey),
    wif,
  };
}

/**
 * Create a 2-of-3 multisig escrow wallet from three participants
 */
export function createEscrowWallet(
  buyer: Participant,
  seller: Participant,
  arbiter: Participant
): EscrowWallet {
  // Public keys MUST be sorted for deterministic multisig addresses
  const pubkeys = [buyer.publicKey, seller.publicKey, arbiter.publicKey].sort(
    (a, b) => a.compare(b)
  );

  // Create 2-of-3 P2SH multisig
  const p2ms = bitcoin.payments.p2ms({
    m: 2,
    pubkeys,
    network,
  });

  const p2sh = bitcoin.payments.p2sh({
    redeem: p2ms,
    network,
  });

  if (!p2sh.address || !p2sh.redeem?.output) {
    throw new Error("Failed to generate multisig address");
  }

  return {
    buyer,
    seller,
    arbiter,
    redeemScript: Buffer.from(p2sh.redeem.output),
    address: p2sh.address,
    requiredSignatures: 2,
  };
}

/**
 * Display wallet info (safe for logging — no private keys)
 */
export function getWalletInfo(wallet: EscrowWallet) {
  return {
    address: wallet.address,
    redeemScript: wallet.redeemScript.toString("hex"),
    requiredSignatures: wallet.requiredSignatures,
    participants: {
      buyer: wallet.buyer.publicKey.toString("hex"),
      seller: wallet.seller.publicKey.toString("hex"),
      arbiter: wallet.arbiter.publicKey.toString("hex"),
    },
  };
}
