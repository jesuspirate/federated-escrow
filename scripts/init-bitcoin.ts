import { bitcoinRpc, initWallet, mineBlocks, getBalance, getBlockchainInfo } from '../src/lib/bitcoin';

async function main() {
  console.log("--- Connecting to Bitcoin Node ---");
  
  try {
    const info = await getBlockchainInfo();
    console.log(`Connected! Chain: ${info.chain}, Blocks: ${info.blocks}`);

    // Create a wallet for our app
    await initWallet('escrow_wallet');

    // In Bitcoin, Coinbase rewards (mining rewards) take 100 blocks to mature.
    // So we need to mine 101 blocks to have spendable coins.
    console.log("--- Mining 101 Blocks (this may take a second) ---");
    await mineBlocks(101);

    const balance = await getBalance();
    console.log(`\n💰 Current Wallet Balance: ${balance} BTC`);
    
    if (balance > 0) {
        console.log("✅ SUCCESS! Your backend is rich (in Regtest coins).");
    } else {
        console.log("❌ Something is wrong, balance is 0.");
    }

  } catch (error) {
    console.error("Failed to connect:", error);
  }
}

main();
