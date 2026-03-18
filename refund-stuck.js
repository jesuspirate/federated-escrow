const { combine } = require('shamir-secret-sharing');
const Database = require('better-sqlite3');
const db = new Database('./data/escrow.db');

// For each stuck escrow, output the notes so they can be redeemed manually
(async () => {
  const rows = db.prepare("SELECT id, shamir_share_seller, shamir_share_buyer, lock_role, seller_pubkey, buyer_pubkey FROM escrows WHERE status = 'CLAIMED' AND locked_notes = 'SHAMIR'").all();
  
  for (const row of rows) {
    if (!row.shamir_share_seller || !row.shamir_share_buyer) {
      console.log(row.id + ': MISSING SHARES - cannot recover');
      continue;
    }
    const s1 = new Uint8Array(Buffer.from(row.shamir_share_seller, 'base64'));
    const s2 = new Uint8Array(Buffer.from(row.shamir_share_buyer, 'base64'));
    const result = await combine([s1, s2]);
    const notes = new TextDecoder().decode(result);
    
    const lockerRole = row.lock_role || 'seller';
    const lockerPk = lockerRole === 'seller' ? row.seller_pubkey : row.buyer_pubkey;
    
    console.log('---');
    console.log('Escrow:', row.id);
    console.log('Locker:', lockerRole, '(' + lockerPk.substring(0,8) + ')');
    console.log('Notes prefix:', notes.substring(0, 14));
    console.log('Notes length:', notes.length);
    console.log('');
    
    // Flip to refund so locker can reclaim
    db.prepare("UPDATE escrows SET resolved_outcome = 'refund', status = 'APPROVED', claimed_by = NULL, claimed_at = NULL, updated_at = ? WHERE id = ?").run(Date.now(), row.id);
    console.log('→ Flipped to REFUND — locker can now claim');
  }
  
  console.log('\n=== Done. Lockers can now claim their sats back via the app. ===');
})();
