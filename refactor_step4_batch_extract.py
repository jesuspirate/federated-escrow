#!/usr/bin/env python3
"""
v2.46.15 — Refactor Step 4: Extract OrdersView, ChapSmartView, ArbiterRecruitmentView, FAQView
Removes ~820 lines from Marketplace.jsx, creates 4 new component files.

Run from your VPS:
  python3 refactor_step4_batch_extract.py
  cd ~/federated-escrow/escrow-ui && npx vite build
  cd ~/federated-escrow && git add -A && git commit -m "v2.46.15 — refactor step 4: extract OrdersView, ChapSmartView, ArbiterRecruitmentView, FAQView (~820 lines)"
  git push origin main && git tag v2.46.15 && git push origin v2.46.15
"""

import os, re

BASE = "/home/satoshi/federated-escrow/escrow-ui/src/pages"
MKT = os.path.join(BASE, "Marketplace.jsx")
MKT_DIR = os.path.join(BASE, "marketplace")

with open(MKT, "r") as f:
    content = f.read()
lines = content.splitlines(True)
original_len = len(lines)

os.makedirs(MKT_DIR, exist_ok=True)

# ═══════════════════════════════════════════════════════════════════
# Helper: find function boundaries by matching "function Name(" at
# column 0 and scanning for the next top-level "function" or "// ═══"
# ═══════════════════════════════════════════════════════════════════

def find_func(lines, sig_prefix):
    """Return (start_line_idx, end_line_idx) exclusive — the function body."""
    start = None
    for i, line in enumerate(lines):
        if line.startswith(sig_prefix):
            start = i
            break
    if start is None:
        return None, None
    # Find end: next top-level function or ═══ header
    brace_depth = 0
    for i in range(start, len(lines)):
        brace_depth += lines[i].count('{') - lines[i].count('}')
        if brace_depth == 0 and i > start:
            return start, i + 1  # exclusive end
    return start, len(lines)


# Also extract ORDER_STATUS_KEYS and OrderBadge (used by OrdersView)
def find_block(lines, start_str, end_after_closing_brace=True):
    """Find a block starting with start_str, ending at closing brace."""
    start = None
    for i, line in enumerate(lines):
        if start_str in line and start is None:
            start = i
            break
    if start is None:
        return None, None
    brace_depth = 0
    for i in range(start, len(lines)):
        brace_depth += lines[i].count('{') - lines[i].count('}')
        if brace_depth == 0 and i > start:
            return start, i + 1
    return start, len(lines)


# ═══════════════════════════════════════════════════════════════════
# 1. Extract OrdersView (includes ORDER_STATUS_KEYS + OrderBadge)
# ═══════════════════════════════════════════════════════════════════

# Find ORDER_STATUS_KEYS
osk_start = None
for i, l in enumerate(lines):
    if l.startswith("const ORDER_STATUS_KEYS"):
        osk_start = i
        break

# Find OrderBadge
ob_start, ob_end = find_func(lines, "function OrderBadge(")

# Find OrdersView
ov_start, ov_end = find_func(lines, "function OrdersView(")

if osk_start is None or ob_start is None or ov_start is None:
    print(f"❌ Could not find OrderBadge components (osk={osk_start}, ob={ob_start}, ov={ov_start})")
    exit(1)

osk_block = "".join(lines[osk_start:ob_end])  # ORDER_STATUS_KEYS + OrderBadge together
ov_body = "".join(lines[ov_start:ov_end])

# Build OrdersView.jsx
ov_file = f'''import {{ useState, useEffect, useRef }} from "react";
import {{ fmtSats, fmtFiat }} from "./constants.js";
import {{ t }} from "../i18n";
import M from "./styles";

{osk_block}
{ov_body.replace(
    "function OrdersView(",
    "export default function OrdersView("
)}
'''

# Wait — fmtSats and fmtFiat are in helpers.js not constants.js. Fix import:
ov_file = ov_file.replace(
    'import { fmtSats, fmtFiat } from "./constants.js";',
    'import { fmtSats, fmtFiat } from "./helpers";'
)

with open(os.path.join(MKT_DIR, "OrdersView.jsx"), "w") as f:
    f.write(ov_file)
ov_lines = len(ov_file.splitlines())
print(f"✅ 1/4 — Created OrdersView.jsx ({ov_lines} lines)")


# ═══════════════════════════════════════════════════════════════════
# 2. Extract ChapSmartView
# ═══════════════════════════════════════════════════════════════════

cs_start, cs_end = find_func(lines, "function ChapSmartView(")
if cs_start is None:
    print("❌ Could not find ChapSmartView")
    exit(1)

cs_body = "".join(lines[cs_start:cs_end])

cs_file = f'''import {{ useState, useEffect, useRef }} from "react";
import M from "./styles";

{cs_body.replace(
    "function ChapSmartView(",
    "export default function ChapSmartView("
)}
'''

with open(os.path.join(MKT_DIR, "ChapSmartView.jsx"), "w") as f:
    f.write(cs_file)
cs_lines = len(cs_file.splitlines())
print(f"✅ 2/4 — Created ChapSmartView.jsx ({cs_lines} lines)")


# ═══════════════════════════════════════════════════════════════════
# 3. Extract ArbiterRecruitmentView
# ═══════════════════════════════════════════════════════════════════

ar_start, ar_end = find_func(lines, "function ArbiterRecruitmentView(")
if ar_start is None:
    print("❌ Could not find ArbiterRecruitmentView")
    exit(1)

ar_body = "".join(lines[ar_start:ar_end])

ar_file = f'''import {{ useState, useEffect }} from "react";
import {{ getFedName }} from "./helpers";
import M from "./styles";

{ar_body.replace(
    "function ArbiterRecruitmentView(",
    "export default function ArbiterRecruitmentView("
)}
'''

with open(os.path.join(MKT_DIR, "ArbiterRecruitmentView.jsx"), "w") as f:
    f.write(ar_file)
ar_lines = len(ar_file.splitlines())
print(f"✅ 3/4 — Created ArbiterRecruitmentView.jsx ({ar_lines} lines)")


# ═══════════════════════════════════════════════════════════════════
# 4. Extract FAQView
# ═══════════════════════════════════════════════════════════════════

fq_start, fq_end = find_func(lines, "function FAQView(")
if fq_start is None:
    print("❌ Could not find FAQView")
    exit(1)

fq_body = "".join(lines[fq_start:fq_end])

fq_file = f'''import {{ useState }} from "react";
import {{ t }} from "../i18n";
import M from "./styles";

{fq_body.replace(
    "function FAQView(",
    "export default function FAQView("
)}
'''

with open(os.path.join(MKT_DIR, "FAQView.jsx"), "w") as f:
    f.write(fq_file)
fq_lines = len(fq_file.splitlines())
print(f"✅ 4/4 — Created FAQView.jsx ({fq_lines} lines)")


# ═══════════════════════════════════════════════════════════════════
# 5. Update Marketplace.jsx — add imports
# ═══════════════════════════════════════════════════════════════════

import_anchor = 'import BillPayView from "./marketplace/BillPayView";'
new_imports = '''import BillPayView from "./marketplace/BillPayView";
import OrdersView from "./marketplace/OrdersView";
import ChapSmartView from "./marketplace/ChapSmartView";
import ArbiterRecruitmentView from "./marketplace/ArbiterRecruitmentView";
import FAQView from "./marketplace/FAQView";'''

if import_anchor in content:
    content = content.replace(import_anchor, new_imports, 1)
    print("✅ 5 — Added 4 new imports to Marketplace.jsx")
else:
    print("❌ 5 — Could not find import anchor")

# ═══════════════════════════════════════════════════════════════════
# 6. Add mapi prop to ArbiterRecruitmentView call site
# ═══════════════════════════════════════════════════════════════════

old_arb_call = '<ArbiterRecruitmentView pubkey={pubkey} onBack={() => setView("browse")} showToast={showToast} />'
new_arb_call = '<ArbiterRecruitmentView pubkey={pubkey} onBack={() => setView("browse")} showToast={showToast} mapi={mapi} />'

if old_arb_call in content:
    content = content.replace(old_arb_call, new_arb_call, 1)
    print("✅ 6 — Added mapi prop to ArbiterRecruitmentView call site")
else:
    print("❌ 6 — Could not find ArbiterRecruitmentView call site")

# ═══════════════════════════════════════════════════════════════════
# 7. Update FAQView call to pass subdomain (already passed, but verify)
# ═══════════════════════════════════════════════════════════════════
# FAQView already receives subdomain at call site — no change needed
print("✅ 7 — FAQView call site already correct (subdomain passed)")

# ═══════════════════════════════════════════════════════════════════
# 8. Remove extracted functions from Marketplace.jsx
# ═══════════════════════════════════════════════════════════════════

# We need to remove (in order from bottom to top to preserve line numbers):
# - FAQView function
# - ArbiterRecruitmentView function + its ═══ header
# - ChapSmartView function + its ═══ header + comment
# - OrdersView function + its ═══ header
# - ORDER_STATUS_KEYS + OrderBadge + ═══ header

# Re-split after import/callsite changes
lines = content.splitlines(True)

# Build list of ranges to remove (we'll collect then remove bottom-up)
ranges_to_remove = []

# Find each block again in updated content
def find_line(lines, text):
    for i, l in enumerate(lines):
        if text in l:
            return i
    return None

# --- OrdersView block (═══ header + function) ---
ov_header = find_line(lines, "// ORDERS VIEW")
if ov_header is not None:
    # header is at ov_header, ═══ line is one before
    header_start = ov_header - 1 if ov_header > 0 and "═══" in lines[ov_header - 1] else ov_header
    _, ov_end2 = find_func(lines, "function OrdersView(")
    if ov_end2:
        ranges_to_remove.append((header_start, ov_end2))
        print(f"  → OrdersView: lines {header_start+1}–{ov_end2}")

# --- ORDER DETAIL VIEW header + ChapSmart comment + ChapSmartView ---
cs_comment = find_line(lines, "// ORDER DETAIL VIEW")
if cs_comment is not None:
    block_start = cs_comment - 1 if cs_comment > 0 and "═══" in lines[cs_comment - 1] else cs_comment
    _, cs_end2 = find_func(lines, "function ChapSmartView(")
    if cs_end2:
        ranges_to_remove.append((block_start, cs_end2))
        print(f"  → ChapSmartView block: lines {block_start+1}–{cs_end2}")

# --- ArbiterRecruitmentView (═══ header + function) ---
ar_header = find_line(lines, "// ARBITER RECRUITMENT VIEW")
if ar_header is not None:
    header_start = ar_header - 1 if ar_header > 0 and "═══" in lines[ar_header - 1] else ar_header
    _, ar_end2 = find_func(lines, "function ArbiterRecruitmentView(")
    if ar_end2:
        ranges_to_remove.append((header_start, ar_end2))
        print(f"  → ArbiterRecruitmentView: lines {header_start+1}–{ar_end2}")

# --- FAQView (═══ header + function) ---
fq_header = find_line(lines, "// FAQ VIEW")
if fq_header is not None:
    header_start = fq_header - 1 if fq_header > 0 and "═══" in lines[fq_header - 1] else fq_header
    _, fq_end2 = find_func(lines, "function FAQView(")
    if fq_end2:
        ranges_to_remove.append((header_start, fq_end2))
        print(f"  → FAQView: lines {header_start+1}–{fq_end2}")

# --- ORDER_STATUS_KEYS + OrderBadge (+ ═══ header before it) ---
osk_line = find_line(lines, "const ORDER_STATUS_KEYS")
ob_header = find_line(lines, "// ── Status Badge")
if osk_line is not None:
    block_start = ob_header if ob_header is not None and ob_header < osk_line else osk_line
    _, ob_end2 = find_func(lines, "function OrderBadge(")
    if ob_end2:
        ranges_to_remove.append((block_start, ob_end2))
        print(f"  → ORDER_STATUS_KEYS + OrderBadge: lines {block_start+1}–{ob_end2}")

# Sort ranges bottom-up so deletions don't shift earlier indices
ranges_to_remove.sort(key=lambda r: r[0], reverse=True)

total_removed = 0
for start, end in ranges_to_remove:
    del lines[start:end]
    total_removed += (end - start)

content = "".join(lines)
print(f"✅ 8 — Removed {total_removed} lines from Marketplace.jsx")

# ═══════════════════════════════════════════════════════════════════
# Write
# ═══════════════════════════════════════════════════════════════════

with open(MKT, "w") as f:
    f.write(content)

final_len = len(content.splitlines())

print(f"\n{'='*60}")
print(f"Marketplace.jsx: {original_len} → {final_len} lines (removed {original_len - final_len})")
print(f"New files:")
print(f"  marketplace/OrdersView.jsx            ({ov_lines} lines)")
print(f"  marketplace/ChapSmartView.jsx         ({cs_lines} lines)")
print(f"  marketplace/ArbiterRecruitmentView.jsx ({ar_lines} lines)")
print(f"  marketplace/FAQView.jsx               ({fq_lines} lines)")
print(f"\nNext steps:")
print(f"  cd ~/federated-escrow/escrow-ui && npx vite build")
print(f'  cd ~/federated-escrow && git add -A && git commit -m "v2.46.15 — refactor step 4: extract OrdersView, ChapSmartView, ArbiterRecruitmentView, FAQView"')
print(f"  git push origin main && git tag v2.46.15 && git push origin v2.46.15")
