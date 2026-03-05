#!/usr/bin/env python3
"""Patch marketplace.ts:
1. Auto-set status='active' when quantity increased above 0 on a 'sold' listing
2. Better browse sorting: in-stock first, then by recency
"""
import sys

f = open('src/routes/marketplace.ts', 'r'); t = f.read(); f.close()

# 1. After the generic UPDATE in the edit handler, add auto-activate logic
# Find: res.json(formatListing(updated));
# at the end of the update handler, before res.json
# We need to add it after the community_link auto-populate block

old = """    res.json(formatListing(updated));

  } catch (err: any) {
    console.error("[marketplace] POST /:id/update error:", err);"""

new = """    // Auto-activate: if quantity was increased on a sold listing, set active
    if (updated.status === "sold" && updated.quantity > 0) {
      db.prepare(\`UPDATE listings SET status = 'active', updated_at = datetime('now') WHERE id = ?\`).run(req.params.id);
      updated = stmts.getById.get(req.params.id) as ListingRow;
      console.log(\`[marketplace] Auto-activated listing \${req.params.id} (quantity: \${updated.quantity})\`);
    }

    res.json(formatListing(updated));

  } catch (err: any) {
    console.error("[marketplace] POST /:id/update error:", err);"""

if old in t:
    t = t.replace(old, new)
    print("✅ Patch 1: Auto-activate on quantity increase")
else:
    print("⚠️  Patch 1: Could not find target — check manually")

# 2. Better browse sorting: in-stock items first, then by updated_at DESC
old_sort = "SELECT * FROM listings WHERE status = ? ORDER BY created_at DESC LIMIT ? OFFSET ?"
new_sort = "SELECT * FROM listings WHERE status = ? ORDER BY CASE WHEN quantity > 0 THEN 0 ELSE 1 END, updated_at DESC LIMIT ? OFFSET ?"

if old_sort in t:
    t = t.replace(old_sort, new_sort)
    print("✅ Patch 2: Browse sort — in-stock first, then recency")
else:
    print("⚠️  Patch 2: Could not find sort target")

# 3. Better search sorting too
old_search = """    SELECT * FROM listings WHERE status = 'active'
    AND (title LIKE ? OR description LIKE ? OR category LIKE ?)
    ORDER BY created_at DESC LIMIT ? OFFSET ?"""
new_search = """    SELECT * FROM listings WHERE status = 'active'
    AND (title LIKE ? OR description LIKE ? OR category LIKE ?)
    ORDER BY CASE WHEN quantity > 0 THEN 0 ELSE 1 END, updated_at DESC LIMIT ? OFFSET ?"""

if old_search in t:
    t = t.replace(old_search, new_search)
    print("✅ Patch 3: Search sort — in-stock first")
else:
    print("⚠️  Patch 3: Could not find search sort target")

f = open('src/routes/marketplace.ts', 'w'); f.write(t); f.close()
print("Done!")
