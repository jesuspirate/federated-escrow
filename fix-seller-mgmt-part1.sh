#!/usr/bin/env python3
import sys

filepath = "escrow-ui/src/pages/Marketplace.jsx"
with open(filepath, "r") as f:
    src = f.read()

# ── Step 1: Replace the seller banner with seller banner + management buttons ──
OLD_BANNER = '''        {isSeller && (
          <div style={{ ...M.infoBanner, borderColor: "rgba(245,158,11,0.2)", background: "rgba(245,158,11,0.06)" }}>
            <span style={{ color: "#f59e0b", fontSize: 13, fontWeight: 600 }}>
              {isP2P ? "₿ Your P2P Trade Listing" : `🏠 ${t("mkYourListing")}`}
            </span>
            {isP2P && isSeller && (
              <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4, lineHeight: 1.5 }}>
                When someone starts this trade, you'll lock your sats in escrow. The buyer sends you fiat externally.
              </div>
            )}
          </div>
        )}'''

NEW_BANNER = '''        {isSeller && (
          <div style={{ ...M.infoBanner, borderColor: "rgba(245,158,11,0.2)", background: "rgba(245,158,11,0.06)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <span style={{ color: "#f59e0b", fontSize: 13, fontWeight: 600 }}>
                {isP2P ? "₿ Your P2P Trade Listing" : `🏠 ${t("mkYourListing")}`}
              </span>
              {l.status !== "deleted" && (
                <div style={{ display: "flex", gap: 6 }}>
                  <button onClick={() => onEdit(l)} style={{ padding: "4px 10px", borderRadius: 8, border: "1px solid rgba(245,158,11,0.3)", background: "rgba(245,158,11,0.1)", color: "#f59e0b", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>✏️ Edit</button>
                  {l.status === "active" && (
                    <button onClick={() => onPause(l.id)} style={{ padding: "4px 10px", borderRadius: 8, border: "1px solid rgba(100,116,139,0.3)", background: "rgba(100,116,139,0.1)", color: "#94a3b8", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>⏸ Pause</button>
                  )}
                  {l.status === "paused" && (
                    <button onClick={() => onUnpause(l.id)} style={{ padding: "4px 10px", borderRadius: 8, border: "1px solid rgba(16,185,129,0.3)", background: "rgba(16,185,129,0.1)", color: "#10b981", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>▶ Resume</button>
                  )}
                  <button onClick={() => onDelete(l.id)} style={{ padding: "4px 10px", borderRadius: 8, border: "1px solid rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.1)", color: "#f87171", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>🗑 Delete</button>
                </div>
              )}
            </div>
            {isP2P && (
              <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4, lineHeight: 1.5 }}>
                When someone starts this trade, you'll lock your sats in escrow. The buyer sends you fiat externally.
              </div>
            )}
          </div>
        )}'''

if OLD_BANNER in src:
    src = src.replace(OLD_BANNER, NEW_BANNER)
    print("✅ Seller banner + management buttons added")
else:
    print("❌ Seller banner pattern not found")
    sys.exit(1)

# ── Step 2: Add onEdit/onPause/onUnpause/onDelete to ListingDetail props ──
old_sig = "function ListingDetail({ listing: l, pubkey, onBack, onProfile, showToast, loading, setLoading }) {"
new_sig = "function ListingDetail({ listing: l, pubkey, onBack, onProfile, showToast, loading, setLoading, onEdit, onPause, onUnpause, onDelete }) {"

if old_sig in src:
    src = src.replace(old_sig, new_sig)
    print("✅ ListingDetail props updated")
else:
    print("❌ ListingDetail signature not found")

with open(filepath, "w") as f:
    f.write(src)

print("Step 1 complete — now injecting EditListingView component and wiring up Marketplace")
