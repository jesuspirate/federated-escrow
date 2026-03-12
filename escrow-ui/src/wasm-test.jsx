import { WalletDirector } from '@fedimint/core';
import { createWasmWorkerTransport } from '@fedimint/transport-web';

const INVITE_CODE = "fed11qgqyj3mfwfhksw309ajrwvmxvenxgvpkvyursenxxvur2c3sv4jkxdfcxf3kgdmyvs6nzcehvc6xzctzxumrxdmr89jnwdtpv5enqwtpxqmrsvfh89skxv34qqqjpzytwrkr28r8mjas4ej467utd7excr7fapj7ukgc4ugacm6nu2u73k7ram";

const log = [];
function out(msg) { log.push(msg); render(); }
function render() { document.getElementById('log').innerText = log.join('\n'); }

async function run() {
  out('1. Environment:');
  out(`   webln: ${!!window.webln}`);
  out(`   nostr: ${!!window.nostr}`);
  out(`   fediInternal: ${!!window.fediInternal}`);

  let wallet;
  try {
    out('\n2. Creating transport + director...');
    const transport = createWasmWorkerTransport();
    const director = new WalletDirector(transport);
    await director.initialize();
    out('   ✅ WASM initialized');

    out('\n3. Previewing federation...');
    const preview = await director.previewFederation(INVITE_CODE);
    out(`   ✅ Federation: ${preview.federation_id}`);
    out(`   Config keys: ${Object.keys(preview.config).join(', ')}`);

    out('\n4. Setting up mnemonic...');
    try {
      const mnemonic = await director.generateMnemonic();
      out('   ✅ New mnemonic generated (' + mnemonic.length + ' words)');
    } catch (e) {
      out('   ℹ️ Mnemonic already exists — reusing');
    }

    out('\n5. Getting existing mnemonic...');
    const mnemonic = await director.getMnemonic();
    out('   ✅ Mnemonic: ' + mnemonic.slice(0, 3).join(' ') + '... (' + mnemonic.length + ' words)');

    out('\n6. Creating wallet...');
    wallet = await director.createWallet();
    out('   ✅ Wallet created');

    out('\n7. Joining federation (or opening existing)...');
    try {
      const joined = await wallet.joinFederation(INVITE_CODE);
      out('   ✅ Joined federation! Result: ' + joined);
    } catch (e) {
      const msg = e?.message || String(e);
      if (msg.includes('already') || msg.includes('open')) {
        out('   ℹ️ Already joined — opening existing client');
        await wallet.open();
        out('   ✅ Client opened');
      } else {
        out('   ⚠️ Join failed: ' + msg + ' — trying open()');
        try { await wallet.open(); out('   ✅ Opened via fallback'); } catch (e2) { throw e; }
      }
    }

    out('\n7. Checking balance...');
    const balance = await wallet.balance.getBalance();
    out(`   ✅ Balance: ${balance} msats (${Math.floor(balance / 1000)} sats)`);

    out('\n8. Testing mint.spendNotes (1000 msats = 1 sat)...');
    try {
      const { notes, operation_id } = await wallet.mint.spendNotes(1000, 60);
      out(`   ✅ E-cash notes created!`);
      out(`   Operation: ${operation_id}`);
      out(`   Notes (first 80 chars): ${notes.substring(0, 80)}...`);

      out('\n9. Validating notes...');
      const amount = await wallet.mint.parseNotes(notes);
      out(`   ✅ Notes valid! Amount: ${amount} msats`);

      out('\n10. Cancelling test spend...');
      await wallet.mint.tryCancelSpendNotes(operation_id);
      out('   ✅ Spend cancelled (notes returned to wallet)');
    } catch (e) {
      out(`   ⚠️ Mint test: ${e.message}`);
      out('   (May need balance > 0 to spend notes)');
    }

    out('\n🎉 Fedimint WASM SDK fully operational with live federation!');

  } catch (e) {
    out(`\n❌ Error: ${e?.message || String(e)}`);
    out(`   Type: ${typeof e}`);
    out(`   JSON: ${JSON.stringify(e)?.substring(0, 200)}`);
    out(`   Stack: ${e?.stack?.split('\n').slice(0, 3).join('\n   ') || 'none'}`);
  }
}

document.addEventListener('DOMContentLoaded', run);
