import { WalletDirector } from '@fedimint/core';
import { createWasmWorkerTransport } from '@fedimint/transport-web';

const INVITE_CODE = "fed11qgqyj3mfwfhksw309ajrwvmxvenxgvpkvyursenxxvur2c3sv4jkxdfcxf3kgdmyvs6nzcehvc6xzctzxumrxdmr89jnwdtpv5enqwtpxqmrsvfh89skxv34qqqjpzytwrkr28r8mjas4ej467utd7excr7fapj7ukgc4ugacm6nu2u73k7ram";

function out(msg) {
  var el = document.getElementById('log');
  el.innerHTML += msg + '\n';
  el.scrollTop = el.scrollHeight;
}

async function run() {
  out('1. Environment:');
  out('   webln: ' + !!window.webln + ' | nostr: ' + !!window.nostr + ' | fediInternal: ' + !!window.fediInternal);

  var wallet;
  try {
    out('\n2. Init WASM...');
    var transport = createWasmWorkerTransport();
    var director = new WalletDirector(transport);
    await director.initialize();
    out('   OK');

    out('\n3. Mnemonic...');
    try { await director.generateMnemonic(); out('   New'); } catch(e) { out('   Existing'); }

    out('\n4. Wallet + Federation...');
    wallet = await director.createWallet();
    try {
      await wallet.open();
      out('   Opened existing client');
    } catch (e) {
      var joined = await wallet.joinFederation(INVITE_CODE);
      out('   Joined: ' + joined);
    }

    out('\n5. Balance...');
    var balance = await wallet.balance.getBalance();
    var balSats = Math.floor(balance / 1000);
    out('   ' + balSats + ' sats (' + balance + ' msats)');

    if (balSats >= 1) {
      out('\n=== WALLET HAS FUNDS! Testing e-cash ===');

      out('\n6. spendNotes(1000 sats)...');
      var spend = await wallet.mint.spendNotes(1000000, 300);
      out('   OK! Op: ' + spend.operation_id);
      out('   Notes (first 120): ' + spend.notes.substring(0, 120) + '...');

      out('\n7. Validate notes...');
      var amt = await wallet.mint.parseNotes(spend.notes);
      out('   Valid: ' + amt + ' msats (' + Math.floor(amt / 1000) + ' sats)');

      out('\n8. Cancel spend (return to wallet)...');
      await wallet.mint.tryCancelSpendNotes(spend.operation_id);
      out('   OK');

      var fb = await wallet.balance.getBalance();
      out('   Final balance: ' + Math.floor(fb / 1000) + ' sats');

      out('\n*** FULL E-CASH CYCLE COMPLETE! ***');
      return;
    }

    // Balance is 0 — create invoice and poll
    out('\n=== WALLET EMPTY — Creating invoice ===');
    out('\n6. Invoice for 2000 sats...');
    var inv = await wallet.lightning.createInvoice(2000000, 'WASM escrow test');
    out('   OK');

    // Show QR code via API
    var qrUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=' + encodeURIComponent(inv.invoice);
    document.getElementById('qr').innerHTML = '<img src="' + qrUrl + '" style="border-radius:12px;margin:12px 0;" />';
    out('   Invoice: ' + inv.invoice.substring(0, 60) + '...');
    out('\n   Scan the QR code above or copy the invoice.');
    out('   Will poll balance every 5 seconds...\n');

    // Poll balance until funded
    var attempts = 0;
    var maxAttempts = 60; // 5 min
    while (attempts < maxAttempts) {
      await new Promise(function(r) { setTimeout(r, 5000); });
      attempts++;
      var nb = await wallet.balance.getBalance();
      var ns = Math.floor(nb / 1000);
      if (ns > 0) {
        out('   PAYMENT RECEIVED! Balance: ' + ns + ' sats');

        out('\n7. spendNotes(1000 sats)...');
        var spend2 = await wallet.mint.spendNotes(1000000, 300);
        out('   OK! Op: ' + spend2.operation_id);
        out('   Notes: ' + spend2.notes.substring(0, 120) + '...');

        out('\n8. Validate...');
        var amt2 = await wallet.mint.parseNotes(spend2.notes);
        out('   Valid: ' + amt2 + ' msats');

        out('\n9. Cancel spend...');
        await wallet.mint.tryCancelSpendNotes(spend2.operation_id);
        var fb2 = await wallet.balance.getBalance();
        out('   Returned. Final: ' + Math.floor(fb2 / 1000) + ' sats');

        out('\n*** FULL E-CASH CYCLE COMPLETE! ***');
        return;
      }
      out('   Poll ' + attempts + '/' + maxAttempts + ': ' + ns + ' sats...');
    }
    out('   Timed out after 5 min. Refresh to check balance.');

  } catch (e) {
    out('\nERROR: ' + (e && e.message ? e.message : String(e)));
    out('   JSON: ' + JSON.stringify(e));
  }
}

document.addEventListener('DOMContentLoaded', run);
