import { WalletDirector } from '@fedimint/core';
import { createWasmWorkerTransport } from '@fedimint/transport-web';

const log = [];
function out(msg) { log.push(msg); render(); }
function render() { document.getElementById('log').innerText = log.join('\n'); }

async function run() {
  out('1. Environment:');
  out(`   webln: ${!!window.webln}`);
  out(`   nostr: ${!!window.nostr}`);
  out(`   fediInternal: ${!!window.fediInternal}`);

  try {
    out('\n2. Creating WebTransport...');
    const transport = createWasmWorkerTransport();
    out('   ✅ WasmWorkerTransport created');

    out('\n3. Creating WalletDirector...');
    const director = new WalletDirector(transport);
    out('   ✅ WalletDirector created');

    out('\n4. Initializing WASM...');
    await director.initialize();
    out('   ✅ WASM initialized!');

    out('\n5. Creating wallet...');
    const wallet = await director.createWallet();
    out('   ✅ FedimintWallet created!');
    out(`   Services: balance=${!!wallet.balance}, lightning=${!!wallet.lightning}, mint=${!!wallet.mint}`);

    out('\n🎉 Fedimint WASM SDK is fully operational!');
  } catch (e) {
    out(`\n❌ Error: ${e.message}`);
    out(`   Stack: ${e.stack?.split('\n').slice(0,3).join('\n   ')}`);
  }
}

document.addEventListener('DOMContentLoaded', run);
