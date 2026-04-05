#!/usr/bin/env python3
"""
v2.46.13 — Refactor Step 2: Wire imports from marketplace/{constants,helpers,styles}
Removes 181 lines of duplicate definitions from Marketplace.jsx.

Run from your VPS:
  python3 refactor_step2_wire_imports.py
  cd ~/federated-escrow/escrow-ui && npx vite build
  cd ~/federated-escrow && git add -A && git commit -m "v2.46.13 — refactor step 2: wire imports from marketplace/{constants,helpers,styles}, remove ~181 lines of duplicates"
  git push origin main && git tag v2.46.13 && git push origin v2.46.13
"""

path = "/home/satoshi/federated-escrow/escrow-ui/src/pages/Marketplace.jsx"

with open(path, "r") as f:
    content = f.read()

original_len = len(content.splitlines())
changes = 0

# ═══════════════════════════════════════════════════════════════════
# 1. Replace aliased imports with direct imports
# ═══════════════════════════════════════════════════════════════════

old_imports = '''// ── Extracted modules (refactor step 1) ──
import { MAPI as _MAPI, PAYMENT_METHODS as _PM, BILL_TYPES as _BT, CATEGORIES as _CAT, CONDITION_KEYS as _CK, FED_LIMITS as _FL, BILL_PAY as _BP, SATS_FOR_FIAT as _SFF, LENDING as _LN, CURRENCY_SYMBOLS as _CS, FED_NAMES_GLOBAL as _FNG, DEV_IDENTITIES as _DI, LEARN_DISMISSED_KEY as _LDK } from "./marketplace/constants";
import { isBillPay as _isBP, isSatsForFiat as _isSFF, isLending as _isLN, isSpecialCategory as _isSC, fmtSats as _fmtS, fmtSatsShort as _fmtSS, fmtVolume as _fmtV, fmtFiat as _fmtF, msatsToFiat as _m2f, truncPk as _tPk, getFedName as _gFN, getFedInfo as _gFI, recalcBillPaySats as _rBPS } from "./marketplace/helpers";
import { default as _M } from "./marketplace/styles";'''

new_imports = '''// ── Extracted modules ──
import { MAPI, PAYMENT_METHODS, BILL_TYPES, CATEGORIES, CONDITION_KEYS, FED_LIMITS, BILL_PAY, SATS_FOR_FIAT, LENDING, CURRENCY_SYMBOLS, FED_NAMES_GLOBAL, DEV_IDENTITIES, LEARN_DISMISSED_KEY } from "./marketplace/constants";
import { isBillPay, isSatsForFiat, isLending, isLenderTrade, isSpecialCategory, fmtSats, fmtSatsShort, fmtVolume, fmtFiat, msatsToFiat, truncPk, getFedName, getFedInfo, recalcBillPaySats } from "./marketplace/helpers";
import M from "./marketplace/styles";'''

if old_imports in content:
    content = content.replace(old_imports, new_imports, 1)
    changes += 1
    print("✅ 1/8 — Replaced aliased imports with direct imports")
else:
    print("❌ 1/8 — Could not find aliased imports block")

# ═══════════════════════════════════════════════════════════════════
# 2. Remove duplicate MAPI + FED_NAMES_GLOBAL + getFedName + DEV_IDENTITIES
# ═══════════════════════════════════════════════════════════════════

old_block2 = '''const MAPI = "/api/marketplace/listings";

// ── Auth ─────────────────────────────────────────────────────────────

const FED_NAMES_GLOBAL = {
  "AwEEiItw7A": { name: "Bitcoin Life", emoji: "🏛️", color: "#a78bfa" },
  "AwEEG8tk5g": { name: "Global Bitcoin Federation", emoji: "🏛️", color: "#f59e0b" },
  "AwEE_yhqbg": { name: "Afribit Kibera", emoji: "🏛️", color: "#10b981" },
};
function getFedName(prefix, domain) {
  if (domain && domain.toLowerCase().includes("bitsacco")) return "Bitsacco";
  if (prefix && FED_NAMES_GLOBAL[prefix]) return FED_NAMES_GLOBAL[prefix].name;
  if (domain) return domain.replace(/^m\\d+\\./, "").replace(/\\.in$/, "").replace(/\\.com$/, "");
  return domain || prefix || "Unknown";
}

const DEV_IDENTITIES = {
  seller:  "aa".repeat(32),
  buyer:   "bb".repeat(32),
  arbiter: "cc".repeat(32),
};'''

new_block2 = '''
// ── Auth ─────────────────────────────────────────────────────────────'''

if old_block2 in content:
    content = content.replace(old_block2, new_block2, 1)
    changes += 1
    print("✅ 2/8 — Removed MAPI, FED_NAMES_GLOBAL, getFedName, DEV_IDENTITIES")
else:
    print("❌ 2/8 — Could not find MAPI/FED_NAMES_GLOBAL/getFedName/DEV_IDENTITIES block")

# ═══════════════════════════════════════════════════════════════════
# 3. Remove duplicate formatting functions
# ═══════════════════════════════════════════════════════════════════

old_block3 = '''// ── Helpers ──────────────────────────────────────────────────────────

function msatsToFiat(msats, rates, currency = "USD") {
  if (!rates || !rates.btcUsd) return null;
  const btc = msats / 100_000_000_000;
  const usd = btc * rates.btcUsd;
  if (currency === "USD") return usd;
  const rate = rates.rates?.[currency];
  return rate ? usd * rate : null;
}

function fmtFiat(msats, rates, currency = "USD") {
  const val = msatsToFiat(msats, rates, currency);
  if (val === null) return null;
  const sym = { USD: "$", EUR: "€", GBP: "£", TZS: "TSh", KES: "KSh", NGN: "₦", UGX: "USh", GHS: "GH₵", XOF: "CFA", ZAR: "R", BRL: "R$", CAD: "CA$", AUD: "A$", JPY: "¥", CHF: "CHF", INR: "₹" }[currency] || currency + " ";
  if (val < 0.01) return sym + val.toFixed(4);
  if (val < 1000) return sym + val.toFixed(2);
  return sym + val.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function fmtSats(msats) { return Math.floor(msats / 1000).toLocaleString(); }
function fmtSatsShort(msats) {
  const sats = Math.floor(msats / 1000);
  if (sats >= 1000000) return (sats / 1000000).toFixed(1) + "M";
  if (sats >= 10000) return (sats / 1000).toFixed(0) + "K";
  if (sats >= 1000) return (sats / 1000).toFixed(1) + "K";
  return sats.toLocaleString();
}
function fmtVolume(msats) {
  const sats = Math.floor(msats / 1000);
  if (sats >= 1_000_000_000) return (sats / 1_000_000_000).toFixed(1) + "B";
  if (sats >= 1_000_000) return (sats / 1_000_000).toFixed(1) + "M";
  if (sats >= 100_000) return (sats / 1_000).toFixed(0) + "K";
  if (sats >= 1_000) return (sats / 1_000).toFixed(1) + "K";
  return sats.toLocaleString();
}

// ── BTC Price Hook'''

new_block3 = '''// ── BTC Price Hook'''

if old_block3 in content:
    content = content.replace(old_block3, new_block3, 1)
    changes += 1
    print("✅ 3/8 — Removed msatsToFiat, fmtFiat, fmtSats, fmtSatsShort, fmtVolume")
else:
    print("❌ 3/8 — Could not find formatting functions block")

# ═══════════════════════════════════════════════════════════════════
# 4. Remove CURRENCY_SYMBOLS + truncPk + trade type detection + PAYMENT_METHODS
# ═══════════════════════════════════════════════════════════════════

old_block4 = '''const CURRENCY_SYMBOLS = {
  USD: "$", EUR: "€", GBP: "£", CFA: "CFA ", KES: "KSh ", TZS: "TSh ", NGN: "₦",
  BRL: "R$", ARS: "ARS ", INR: "₹", ZAR: "R", CAD: "CA$", CHF: "CHF ", AUD: "A$", JPY: "¥",
};

// Old fmtFiat removed — using Yadio-based version above

function truncPk(hex) {
  if (!hex || hex.length < 16) return hex || "";
  return hex.slice(0, 8) + "…" + hex.slice(-8);
}

// ── Trade Type Detection ────────────────────────────────────────────
const SATS_FOR_FIAT = "sats-for-fiat";
const BILL_PAY = "bill-pay";
function isBillPay(category) { return category?.toLowerCase().trim() === BILL_PAY; }
const LENDING = "lending";

const PAYMENT_METHODS = [
  { key: "mpesa", label: "M-Pesa", icon: "📱", region: "East Africa" },
  { key: "airtel", label: "Airtel Money", icon: "📱", region: "East Africa" },
  { key: "mtn", label: "MTN MoMo", icon: "📱", region: "West Africa" },
  { key: "orange", label: "Orange Money", icon: "🟧", region: "West Africa" },
  { key: "wave", label: "Wave", icon: "🌊", region: "West Africa" },
  { key: "opay", label: "OPay", icon: "💚", region: "West Africa" },
  { key: "chipper", label: "Chipper Cash", icon: "💸", region: "Africa" },
  { key: "cashapp", label: "Cash App", icon: "💵", region: "US" },
  { key: "zelle", label: "Zelle", icon: "💸", region: "US" },
  { key: "venmo", label: "Venmo", icon: "💙", region: "US" },
  { key: "wise", label: "Wise", icon: "🌍", region: "Global" },
  { key: "paypal", label: "PayPal", icon: "🅿️", region: "Global" },
  { key: "bank", label: "Bank Transfer", icon: "🏦", region: "Global" },
  { key: "cash", label: "Cash (in person)", icon: "💰", region: "Local" },
  { key: "revolut", label: "Revolut", icon: "💳", region: "Europe" },
  { key: "pix", label: "PIX", icon: "🇧🇷", region: "Brazil" },
  { key: "upi", label: "UPI", icon: "🇮🇳", region: "India" },
  { key: "gcash", label: "GCash", icon: "📱", region: "Philippines" },
  { key: "ecocash", label: "EcoCash", icon: "📱", region: "Zimbabwe" },
];
function isSatsForFiat(category) { return category?.toLowerCase().trim() === SATS_FOR_FIAT; }
function isLending(category) { return category?.toLowerCase().trim() === LENDING; }
function isSpecialCategory(category) { return isSatsForFiat(category) || isLending(category) || isBillPay(category); }

// ── Nostr Profile Lookup'''

new_block4 = '''
// ── Nostr Profile Lookup'''

if old_block4 in content:
    content = content.replace(old_block4, new_block4, 1)
    changes += 1
    print("✅ 4/8 — Removed CURRENCY_SYMBOLS, truncPk, trade type constants, PAYMENT_METHODS")
else:
    print("❌ 4/8 — Could not find CURRENCY_SYMBOLS/truncPk/trade-type block")

# ═══════════════════════════════════════════════════════════════════
# 5. Remove CONDITION_KEYS
# ═══════════════════════════════════════════════════════════════════

old_block5 = '''const CONDITION_KEYS = { new: "mkCondNew", used: "mkCondUsed", digital: "mkCondDigital", service: "mkCondService" };

function OrderBadge'''

new_block5 = '''
function OrderBadge'''

if old_block5 in content:
    content = content.replace(old_block5, new_block5, 1)
    changes += 1
    print("✅ 5/8 — Removed CONDITION_KEYS")
else:
    print("❌ 5/8 — Could not find CONDITION_KEYS block")

# ═══════════════════════════════════════════════════════════════════
# 6. Remove CATEGORIES + LEARN_DISMISSED_KEY
# ═══════════════════════════════════════════════════════════════════

old_block6 = '''const CATEGORIES = [
  { key: "all", label: "Public", icon: "🌍" },
  { key: "mine", label: "Mine", icon: "🏠" },
  { key: "sats-for-fiat", label: "P2P", icon: "₿" },
  { key: "lending", label: "Lending", icon: "🤝" },
  { key: "electronics", label: "Electronics", icon: "📱" },
  { key: "services", label: "Services", icon: "🛠️" },
  { key: "digital", label: "Digital", icon: "💾" },
  { key: "clothing", label: "Clothing", icon: "👕" },
  { key: "shipping", label: "Shipping", icon: "📦" },
  { key: "other", label: "Other", icon: "🏷️" },
];

// ═══════════════════════════════════════════════════════════════════════
// NEW TO BITCOIN / FEDI — Collapsible education banner
// ═══════════════════════════════════════════════════════════════════════

const LEARN_DISMISSED_KEY = "fedi-mk-learn-dismissed";

function NewToFediBanner'''

new_block6 = '''// ═══════════════════════════════════════════════════════════════════════
// NEW TO BITCOIN / FEDI — Collapsible education banner
// ═══════════════════════════════════════════════════════════════════════

function NewToFediBanner'''

if old_block6 in content:
    content = content.replace(old_block6, new_block6, 1)
    changes += 1
    print("✅ 6/8 — Removed CATEGORIES, LEARN_DISMISSED_KEY")
else:
    print("❌ 6/8 — Could not find CATEGORIES/LEARN_DISMISSED_KEY block")

# ═══════════════════════════════════════════════════════════════════
# 7. Remove local FED_NAMES + getFedInfo inside component
# ═══════════════════════════════════════════════════════════════════

old_block7 = '''  }, [pubkey, subdomain]);
  // Federation prefix → friendly name mapping
  const FED_NAMES = {
    "AwEEiItw7A": { name: "Bitcoin Life", emoji: "🏛️", color: "#a78bfa" },
    "AwEEG8tk5g": { name: "Global Bitcoin Federation", emoji: "🏛️", color: "#f59e0b" },
    "AwEE_yhqbg": { name: "Afribit Kibera", emoji: "🏛️", color: "#10b981" },
  };
  const getFedInfo = (prefix, domain) => {
    if (prefix && FED_NAMES[prefix]) return FED_NAMES[prefix];
    if (domain) {
      // Derive from domain if prefix not mapped
      const short = domain.replace(/^m\\d+\\./, "").replace(/\\.in$/, "").replace(/\\.com$/, "");
      return { name: short, emoji: "🏛", color: "#64748b" };
    }
    return null;
  };

  const subdomainFilter'''

new_block7 = '''  }, [pubkey, subdomain]);

  const subdomainFilter'''

if old_block7 in content:
    content = content.replace(old_block7, new_block7, 1)
    changes += 1
    print("✅ 7/8 — Removed local FED_NAMES + getFedInfo (using imported version)")
else:
    print("❌ 7/8 — Could not find local FED_NAMES/getFedInfo block")

# ═══════════════════════════════════════════════════════════════════
# 8. Remove BILL_TYPES
# ═══════════════════════════════════════════════════════════════════

old_block8 = '''const BILL_TYPES = [
  { id: "electricity", icon: "⚡", label: "Electricity" },
  { id: "phone",       icon: "📱", label: "Phone / Airtime" },
  { id: "internet",    icon: "🌐", label: "Internet" },
  { id: "rent",        icon: "🏠", label: "Rent" },
  { id: "school",      icon: "🎓", label: "School Fees" },
  { id: "car",         icon: "🚗", label: "Car Payment" },
  { id: "water",       icon: "💧", label: "Water" },
  { id: "insurance",   icon: "🛡️", label: "Insurance" },
  { id: "other",       icon: "📋", label: "Other" },
];

function BillPayView'''

new_block8 = '''function BillPayView'''

if old_block8 in content:
    content = content.replace(old_block8, new_block8, 1)
    changes += 1
    print("✅ 8/8 — Removed BILL_TYPES")
else:
    print("❌ 8/8 — Could not find BILL_TYPES block")

# ═══════════════════════════════════════════════════════════════════
# 9. Remove const M = { ... } styles block (line-based splice)
# ═══════════════════════════════════════════════════════════════════

lines = content.splitlines(True)
m_start = None
m_end = None
for i, line in enumerate(lines):
    if line.strip().startswith("// STYLES") and i > 0 and "═══" in lines[i-1]:
        m_start = i - 1  # the ═══ line before "// STYLES"
    if m_start is not None and line.strip() == "const M = {":
        pass  # keep scanning for closing
    if m_start is not None and m_end is None and line.strip() == "};":
        # Check if this is the M closing brace (should be after const M = {)
        # Verify we're in the right block by checking a few lines back
        for j in range(max(0, i-35), i):
            if "const M = {" in lines[j]:
                m_end = i + 1  # include the }; line
                break

if m_start is not None and m_end is not None:
    # Also remove blank lines after
    while m_end < len(lines) and lines[m_end].strip() == "":
        m_end += 1
    del lines[m_start:m_end]
    content = "".join(lines)
    changes += 1
    print(f"✅ 9/9 — Removed const M styles block ({m_end - m_start} lines)")
else:
    print("❌ 9/9 — Could not find const M styles block")

# ═══════════════════════════════════════════════════════════════════
# Write result
# ═══════════════════════════════════════════════════════════════════

final_len = len(content.splitlines())
with open(path, "w") as f:
    f.write(content)

print(f"\n{'='*60}")
print(f"Done! {changes}/9 patches applied")
print(f"Lines: {original_len} → {final_len} (removed {original_len - final_len})")
print(f"\nNext steps:")
print(f"  cd ~/federated-escrow/escrow-ui && npx vite build")
print(f'  cd ~/federated-escrow && git add -A && git commit -m "v2.46.13 — refactor step 2: wire imports, remove ~180 lines of duplicates"')
print(f"  git push origin main && git tag v2.46.13 && git push origin v2.46.13")
