#!/usr/bin/env python3
"""
v2.46.14 — Refactor Step 3: Extract BillPayView into marketplace/BillPayView.jsx
Removes ~331 lines from Marketplace.jsx, creates a new standalone component.

Run from your VPS:
  python3 refactor_step3_billpayview.py
  cd ~/federated-escrow/escrow-ui && npx vite build
  cd ~/federated-escrow && git add -A && git commit -m "v2.46.14 — refactor step 3: extract BillPayView.jsx (335 lines)"
  git push origin main && git tag v2.46.14 && git push origin v2.46.14
"""

import os

BASE = "/home/satoshi/federated-escrow/escrow-ui/src/pages"
MKT = os.path.join(BASE, "Marketplace.jsx")
BPV = os.path.join(BASE, "marketplace", "BillPayView.jsx")

with open(MKT, "r") as f:
    content = f.read()

lines = content.splitlines(True)
original_len = len(lines)
changes = 0

# ═══════════════════════════════════════════════════════════════════
# 1. Find and extract BillPayView function body
# ═══════════════════════════════════════════════════════════════════

start_marker = 'function BillPayView({ listings, loading, pubkey, onBack, onCreate, onOpen, onOrders, onRefresh, fiatRates, showToast, subdomain, activeOrderCount }) {'
end_marker_prefix = '// ═══════════════════════════════════════════════════════════════════════\n// ORDERS VIEW'

start_idx = None
end_idx = None

for i, line in enumerate(lines):
    if start_marker in line and start_idx is None:
        start_idx = i
    if start_idx is not None and i > start_idx:
        if "ORDERS VIEW" in line:
            end_idx = i - 1  # the ═══ line before ORDERS VIEW
            break

if start_idx is None or end_idx is None:
    print(f"❌ Could not find BillPayView boundaries (start={start_idx}, end={end_idx})")
    exit(1)

# Walk backwards to skip blank lines
func_end = end_idx
while func_end > start_idx and lines[func_end - 1].strip() == "":
    func_end -= 1

billpay_body_lines = lines[start_idx:func_end]
billpay_body = "".join(billpay_body_lines)

# Verify
assert "function BillPayView" in billpay_body_lines[0], f"Bad start: {billpay_body_lines[0]}"
last_content = ""
for bl in reversed(billpay_body_lines):
    if bl.strip():
        last_content = bl.strip()
        break
assert last_content == "}", f"Bad end: {last_content}"

print(f"✅ 1/5 — Found BillPayView: lines {start_idx+1}–{func_end} ({func_end - start_idx} lines)")

# ═══════════════════════════════════════════════════════════════════
# 2. Create marketplace/BillPayView.jsx
# ═══════════════════════════════════════════════════════════════════

updated_body = billpay_body.replace(
    'function BillPayView({ listings, loading, pubkey, onBack, onCreate, onOpen, onOrders, onRefresh, fiatRates, showToast, subdomain, activeOrderCount }) {',
    'export default function BillPayView({ listings, loading, pubkey, onBack, onCreate, onOpen, onOrders, onRefresh, fiatRates, showToast, subdomain, activeOrderCount, mapi, isDevMode }) {'
)

billpay_file = f'''import {{ useState, useEffect, useMemo }} from "react";
import {{ BILL_TYPES, PAYMENT_METHODS }} from "./constants";

{updated_body}
'''

os.makedirs(os.path.dirname(BPV), exist_ok=True)
with open(BPV, "w") as f:
    f.write(billpay_file)

bpv_lines = len(billpay_file.splitlines())
changes += 1
print(f"✅ 2/5 — Created marketplace/BillPayView.jsx ({bpv_lines} lines)")

# ═══════════════════════════════════════════════════════════════════
# 3. Add import for BillPayView in Marketplace.jsx
# ═══════════════════════════════════════════════════════════════════

import_anchor = 'import M from "./marketplace/styles";'
new_import = 'import M from "./marketplace/styles";\nimport BillPayView from "./marketplace/BillPayView";'

if import_anchor in content:
    content = content.replace(import_anchor, new_import, 1)
    changes += 1
    print("✅ 3/5 — Added BillPayView import to Marketplace.jsx")
else:
    print("❌ 3/5 — Could not find import anchor")

# ═══════════════════════════════════════════════════════════════════
# 4. Add mapi + isDevMode props to BillPayView call site
# ═══════════════════════════════════════════════════════════════════

old_callsite = '''          activeOrderCount={orders.filter(o => o.status === "pending" || o.status === "active").length}
        />'''

new_callsite = '''          activeOrderCount={orders.filter(o => o.status === "pending" || o.status === "active").length}
          mapi={mapi} isDevMode={isDevMode}
        />'''

if old_callsite in content:
    content = content.replace(old_callsite, new_callsite, 1)
    changes += 1
    print("✅ 4/5 — Added mapi + isDevMode props to BillPayView call site")
else:
    print("❌ 4/5 — Could not find BillPayView call site")

# ═══════════════════════════════════════════════════════════════════
# 5. Remove BillPayView function from Marketplace.jsx
# ═══════════════════════════════════════════════════════════════════

lines = content.splitlines(True)
start_idx2 = None
end_idx2 = None
for i, line in enumerate(lines):
    if start_marker in line and start_idx2 is None:
        start_idx2 = i
    if start_idx2 is not None and i > start_idx2:
        if "ORDERS VIEW" in line:
            end_idx2 = i - 1
            break

if start_idx2 is not None and end_idx2 is not None:
    del lines[start_idx2:end_idx2]
    content = "".join(lines)
    removed = end_idx2 - start_idx2
    changes += 1
    print(f"✅ 5/5 — Removed BillPayView function body ({removed} lines)")
else:
    print(f"❌ 5/5 — Could not re-find BillPayView for removal (start={start_idx2}, end={end_idx2})")

# ═══════════════════════════════════════════════════════════════════
# Write
# ═══════════════════════════════════════════════════════════════════

with open(MKT, "w") as f:
    f.write(content)

final_len = len(content.splitlines())

print(f"\n{'='*60}")
print(f"Done! {changes}/5 patches applied")
print(f"Marketplace.jsx: {original_len} → {final_len} lines (removed {original_len - final_len})")
print(f"New file: marketplace/BillPayView.jsx ({bpv_lines} lines)")
print(f"\nNext steps:")
print(f"  cd ~/federated-escrow/escrow-ui && npx vite build")
print(f'  cd ~/federated-escrow && git add -A && git commit -m "v2.46.14 — refactor step 3: extract BillPayView.jsx ({bpv_lines} lines)"')
print(f"  git push origin main && git tag v2.46.14 && git push origin v2.46.14")
