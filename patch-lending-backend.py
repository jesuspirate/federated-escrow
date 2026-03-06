#!/usr/bin/env python3
"""Add lending category support to marketplace.ts backend.
Lending uses same escrow role mapping as P2P: lender = escrow seller (locks sats)."""

f = open('src/routes/marketplace.ts', 'r'); t = f.read(); f.close()

# 1. Update isSatsForFiat to also detect lending for escrow role mapping
old = 'function isSatsForFiat(category: string | null): boolean {'
idx = t.find(old)
if idx >= 0:
    end = t.find('}', idx) + 1
    old_func = t[idx:end]
    new_func = old_func + '\n\nfunction isLenderTrade(category: string | null): boolean {\n  return category?.toLowerCase().trim() === "lending";\n}\n\nfunction isP2PStyle(category: string | null): boolean {\n  return isSatsForFiat(category) || isLenderTrade(category);\n}'
    t = t.replace(old_func, new_func)
    print('1. Added isLenderTrade + isP2PStyle functions')
else:
    print('1. Could not find isSatsForFiat function')

# 2. Update the buy endpoint to use isP2PStyle for role assignment
t = t.replace(
    'const isP2PTrade = isSatsForFiat(listing.category);',
    'const isP2PTrade = isP2PStyle(listing.category);')
print('2. Updated buy endpoint role assignment')

# 3. Update escrow description for lending
t = t.replace(
    'description: isP2PTrade \n        ? `P2P Trade: ${listing.title}`\n        : `Marketplace: ${listing.title}`',
    'description: isLenderTrade(listing.category)\n        ? `Lending: ${listing.title}`\n        : isP2PTrade\n        ? `P2P Trade: ${listing.title}`\n        : `Marketplace: ${listing.title}`')
if 'Lending: ${listing.title}' in t:
    print('3. Updated escrow description for lending')
else:
    # Try alternate formatting
    t2 = t.replace(
        "isP2PTrade \n        ? `P2P Trade: ${listing.title}`",
        "isLenderTrade(listing.category)\n        ? `Lending: ${listing.title}`\n        : isP2PTrade\n        ? `P2P Trade: ${listing.title}`")
    if t2 != t:
        t = t2
        print('3. Updated escrow description (alt format)')
    else:
        print('3. Could not find description target - will need manual check')

# 4. Update tradeType in order detail response
old_tt = 'tradeType: listing && isSatsForFiat(listing.category) ? "sats-for-fiat" : "marketplace"'
new_tt = 'tradeType: listing && isP2PStyle(listing.category) ? (isLenderTrade(listing.category) ? "lending" : "sats-for-fiat") : "marketplace"'
t = t.replace(old_tt, new_tt)
print('4. Updated tradeType response')

f = open('src/routes/marketplace.ts', 'w'); f.write(t); f.close()
print('Done!')
