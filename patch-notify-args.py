#!/usr/bin/env python3
"""Update Notify calls in ecash-escrow.ts to pass amount and description for rich DMs."""

f = open('src/routes/ecash-escrow.ts', 'r'); t = f.read(); f.close()

# 1. Update join → funded notification to include amount/description
old = """        Notify.notifyEscrowJoin(updated.id, pk, role, otherPks);
        if (updated.status === "FUNDED") {
          Notify.notifyEscrowFunded(updated.id, updated.seller_pubkey, updated.buyer_pubkey, updated.arbiter_pubkey);
        }"""
new = """        Notify.notifyEscrowJoin(updated.id, pk, role, otherPks);
        if (updated.status === "FUNDED") {
          Notify.notifyEscrowFunded(updated.id, updated.seller_pubkey, updated.buyer_pubkey, updated.arbiter_pubkey, updated.amount_msats, updated.description);
        }"""
if old in t:
    t = t.replace(old, new)
    print('1. Added amount/desc to funded notification')
else:
    print('1. Could not find funded target')

# 2. Update lock notification
old = 'Notify.notifyEscrowLocked(updated.id, updated.seller_pubkey, updated.buyer_pubkey, updated.arbiter_pubkey);'
new = 'Notify.notifyEscrowLocked(updated.id, updated.seller_pubkey, updated.buyer_pubkey, updated.arbiter_pubkey, updated.amount_msats, updated.description);'
if old in t:
    t = t.replace(old, new)
    print('2. Added amount/desc to lock notification')
else:
    print('2. Could not find lock target')

# 3. Update resolve notification
old = """          Notify.notifyEscrowResolved(row.id, tally.outcome, row.seller_pubkey, row.buyer_pubkey, row.arbiter_pubkey);"""
new = """          Notify.notifyEscrowResolved(row.id, tally.outcome, row.seller_pubkey, row.buyer_pubkey, row.arbiter_pubkey, row.amount_msats);"""
if old in t:
    t = t.replace(old, new)
    print('3. Added amount to resolve notification')
else:
    print('3. Could not find resolve target')

# 4. Update payout complete notification
old = 'Notify.notifyEscrowCompleted(row.id, winnerPk);'
new = 'Notify.notifyEscrowCompleted(row.id, winnerPk, row.amount_msats);'
if old in t:
    t = t.replace(old, new)
    print('4. Added amount to payout notification')
else:
    print('4. Could not find payout target')

f = open('src/routes/ecash-escrow.ts', 'w'); f.write(t); f.close()
print('Done!')
