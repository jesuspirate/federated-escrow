import "dotenv/config";
const Client = require("bitcoin-core");
async function main() {
const port = Number(process.env.BITCOIN_RPC_PORT) || 18443;
console.log("Connecting to Bitcoin Core via RPC...");
console.log("Port:", port);
const client = new Client({
network: "regtest",
host: "http://127.0.0.1:" + port,
username: process.env.BITCOIN_RPC_USER || "escrow",
password: process.env.BITCOIN_RPC_PASSWORD || "escrow123",
});
try {
const info = await client.getBlockchainInfo();
console.log("SUCCESS: Connected to Bitcoin Core!");
console.log("Chain:", info.chain);
console.log("Blocks:", info.blocks);
console.log("Headers:", info.headers);
} catch (err) {
console.error("ERROR: Could not connect to Bitcoin Core.");
console.error("Details:", err);
}
}
main();
