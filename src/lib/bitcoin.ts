import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const RPC_URL = process.env.BITCOIN_RPC_URL || 'http://127.0.0.1:18443';
const RPC_USER = process.env.BITCOIN_RPC_USER || 'admin';
const RPC_PASS = process.env.BITCOIN_RPC_PASS || 'admin';

// Helper to disable axios errors on 400/500 so we can handle them manually
const client = axios.create({
  baseURL: RPC_URL,
  auth: { username: RPC_USER, password: RPC_PASS },
  validateStatus: () => true, 
});

interface RpcResponse {
  result: any;
  error: any;
  id: string;
}

export const bitcoinRpc = async (method: string, params: any[] = []) => {
  const payload = {
    jsonrpc: '1.0',
    id: 'curltext',
    method,
    params,
  };

  try {
    const { data } = await client.post<RpcResponse>('/', payload);
    if (data.error) {
      throw new Error(`Bitcoin RPC Error: ${JSON.stringify(data.error)}`);
    }
    return data.result;
  } catch (err: any) {
    console.error(`RPC Fail [${method}]:`, err.message);
    throw err;
  }
};

// ACTIONS

// 1. Get Blockchain Info
export const getBlockchainInfo = async () => {
  return await bitcoinRpc('getblockchaininfo');
};

// 2. Create a new Wallet (if it doesn't exist)
export const initWallet = async (walletName: string) => {
  try {
    await bitcoinRpc('createwallet', [walletName]);
    console.log(`Wallet ${walletName} created.`);
  } catch (e: any) {
    // Error code -4 means wallet already exists, which is fine
    if (e.message.includes('Database already exists')) {
      console.log(`Wallet ${walletName} loaded.`);
      await bitcoinRpc('loadwallet', [walletName]);
    }
  }
};

// 3. Generate an Address
export const getNewAddress = async () => {
  return await bitcoinRpc('getnewaddress');
};

// 4. Mine Blocks (CRITICAL for Regtest)
// In Regtest, nothing happens until you mine blocks.
// We mine to a specific address so we have funds.
export const mineBlocks = async (count: number) => {
  const address = await getNewAddress(); 
  return await bitcoinRpc('generatetoaddress', [count, address]);
};

// 5. Get Balance
export const getBalance = async () => {
  return await bitcoinRpc('getbalance');
};
