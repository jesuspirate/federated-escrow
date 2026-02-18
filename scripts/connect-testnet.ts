// scripts/connect-testnet.ts

import { escrowManager } from '../src';

const MUTINYNET_FEDERATION = {
  // Mutinynet is a Bitcoin signet with faster blocks
  inviteCode: 'fed11qgqzc2nhwden5te0vejkg6tdd9h8gepwvejkg6tdd9h8garhduhx6at5d9h8jmn9wshxxmmd9uqqzgxg6s3evnr6m',
  name: 'Mutinynet Test Federation',
  network: 'signet' as const
};

async function main() {
  console.log('Connecting to Mutinynet test federation...');
  
  await escrowManager.initialize(MUTINYNET_FEDERATION);
  
  console.log('Connected! Testing authentication...');
  
  // This requires a Nostr browser extension
  const auth = await escrowManager.authenticate();
  console.log('Authenticated as:', auth.npub);
  
  // Create test escrow
  const escrow = await escrowManager.createEscrow({
    amount: 10000, // 10k sats
    buyerNpub: 'npub1buyer...',
    sellerNpub: auth.npub, // Current user is seller
    arbitratorNpub: 'npub1arbit...'
  });
  
  console.log('Created escrow:', escrow.id);
  console.log('Status:', escrow.status);
}

main().catch(console.error);
