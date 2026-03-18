const { combine } = require('shamir-secret-sharing');
const Database = require('better-sqlite3');
const db = new Database('./data/escrow.db');

const rows = db.prepare("SELECT id, shamir_share_seller, shamir_share_buyer FROM escrows WHERE status = 'CLAIMED' AND locked_notes = 'SHAMIR'").all();

(async () => {
  for (const row of rows) {
    if (!row.shamir_share_seller || !row.shamir_share_buyer) {
      console.log(row.id + ': MISSING SHARES');
      continue;
    }
    try {
      const s1 = new Uint8Array(Buffer.from(row.shamir_share_seller, 'base64'));
      const s2 = new Uint8Array(Buffer.from(row.shamir_share_buyer, 'base64'));
      const result = await combine([s1, s2]);
      const notes = new TextDecoder().decode(result);
      console.log(row.id + ': prefix=' + notes.substring(0, 14) + ' length=' + notes.length);
    } catch(e) {
      console.log(row.id + ': ERROR ' + e.message);
    }
  }
})();
