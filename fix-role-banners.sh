#!/usr/bin/env bash
# fix-role-banners.sh — Fix role display language + add rating prompt
# Run from: ~/federated-escrow
set -euo pipefail

ESCROW="escrow-ui/src/pages/EcashEscrow.jsx"

cp "$ESCROW" "backups/pre-fixes/EcashEscrow-pre-rolebanner.jsx"
echo "✅ Backed up"

# ── Step 1: Replace the role banners block ────────────────────────────
python3 - <<'PYEOF'
import sys

filepath = "escrow-ui/src/pages/EcashEscrow.jsx"
with open(filepath, "r") as f:
    src = f.read()

OLD = '''        {role && (
          <div style={S.roleBanner}>
            <SvgArbiter size={16} color="#f59e0b" />
            <span>{t("youAreThe")} <strong style={{ textTransform: "capitalize" }}>{t(role)}</strong></span>
          </div>
        )}

        {/* ── Marketplace context — explain the role mapping ── */}
        {e.description?.startsWith("Marketplace:") && role === "seller" && (
          <div style={{ padding: "10px 14px", background: "rgba(16,185,129,0.06)", border: "1px solid rgba(16,185,129,0.15)", borderRadius: 10, fontSize: 12, color: "#94a3b8", lineHeight: 1.6, marginBottom: 12 }}>
            <strong style={{ color: "#10b981" }}>🛒 Marketplace Purchase</strong><br/>
            You are locking sats as payment. Once the seller ships and you both confirm, sats release to them.
          </div>
        )}
        {e.description?.startsWith("Marketplace:") && role === "buyer" && (
          <div style={{ padding: "10px 14px", background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.15)", borderRadius: 10, fontSize: 12, color: "#94a3b8", lineHeight: 1.6, marginBottom: 12 }}>
            <strong style={{ color: "#f59e0b" }}>🏠 You're the Seller</strong><br/>
            The buyer locked sats as payment. Ship your item, then both confirm to release payment to you.
          </div>
        )}
        {/* ── P2P Trade context ── */}
        {e.description?.startsWith("P2P Trade:") && role === "seller" && (
          <div style={{ padding: "10px 14px", background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.15)", borderRadius: 10, fontSize: 12, color: "#94a3b8", lineHeight: 1.6, marginBottom: 12 }}>
            <strong style={{ color: "#f59e0b" }}>₿ Sats-for-Fiat Trade</strong><br/>
            Lock your sats in escrow. Once the buyer sends fiat and you both confirm, sats release to the buyer.
          </div>
        )}
        {e.description?.startsWith("P2P Trade:") && role === "buyer" && (
          <div style={{ padding: "10px 14px", background: "rgba(16,185,129,0.06)", border: "1px solid rgba(16,185,129,0.15)", borderRadius: 10, fontSize: 12, color: "#94a3b8", lineHeight: 1.6, marginBottom: 12 }}>
            <strong style={{ color: "#10b981" }}>₿ Sats-for-Fiat Trade</strong><br/>
            Send fiat to the seller as agreed. Once you both confirm, the sats release to you.
          </div>
        )}'''

NEW = '''        {/* ══ Role context banner — plain language, not raw escrow-role language ══
             P2P (sats-for-fiat): seller locks sats, buyer sends fiat → normal flow
             Marketplace (all else): buyer locks sats as payment, seller ships & receives
             The escrow "seller" role in marketplace = the real-world BUYER locking payment
             The escrow "buyer" role in marketplace  = the real-world SELLER receiving payment */}

        {role === "arbiter" && (
          <div style={{ ...S.roleBanner, borderColor: "rgba(139,92,246,0.2)", background: "rgba(139,92,246,0.06)" }}>
            <SvgArbiter size={16} color="#a78bfa" />
            <span style={{ color: "#a78bfa" }}>⚖️ <strong>You are the Arbiter</strong> — cast the deciding vote if there's a dispute</span>
          </div>
        )}

        {/* P2P: escrow roles = real-world roles, no translation needed */}
        {e.description?.startsWith("P2P Trade:") && role === "seller" && (
          <div style={{ padding: "10px 14px", background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.2)", borderRadius: 10, fontSize: 12, color: "#94a3b8", lineHeight: 1.6, marginBottom: 12 }}>
            <strong style={{ color: "#f59e0b" }}>₿ You are the Seller — Sats-for-Fiat</strong><br/>
            Lock your sats in escrow. The buyer sends you fiat externally. Once you both confirm, sats release to the buyer.
          </div>
        )}
        {e.description?.startsWith("P2P Trade:") && role === "buyer" && (
          <div style={{ padding: "10px 14px", background: "rgba(16,185,129,0.06)", border: "1px solid rgba(16,185,129,0.2)", borderRadius: 10, fontSize: 12, color: "#94a3b8", lineHeight: 1.6, marginBottom: 12 }}>
            <strong style={{ color: "#10b981" }}>₿ You are the Buyer — Sats-for-Fiat</strong><br/>
            Send fiat to the seller as agreed externally. Once you both confirm, the sats release to you.
          </div>
        )}

        {/* Marketplace: escrow roles are FLIPPED vs real-world roles
            escrow "seller" = real-world buyer  (locks sats as payment)
            escrow "buyer"  = real-world seller (ships item, receives sats) */}
        {e.description?.startsWith("Marketplace:") && role === "seller" && (
          <div style={{ padding: "10px 14px", background: "rgba(16,185,129,0.06)", border: "1px solid rgba(16,185,129,0.2)", borderRadius: 10, fontSize: 12, color: "#94a3b8", lineHeight: 1.6, marginBottom: 12 }}>
            <strong style={{ color: "#10b981" }}>🛒 You are the Buyer</strong><br/>
            Lock your sats as payment. Once the seller ships and you both confirm, sats release to them.
          </div>
        )}
        {e.description?.startsWith("Marketplace:") && role === "buyer" && (
          <div style={{ padding: "10px 14px", background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.2)", borderRadius: 10, fontSize: 12, color: "#94a3b8", lineHeight: 1.6, marginBottom: 12 }}>
            <strong style={{ color: "#f59e0b" }}>🏠 You are the Seller</strong><br/>
            The buyer locked sats as payment. Ship your item, then both confirm to release payment to you.
          </div>
        )}

        {/* ══ RATING PROMPT — prominent, replaces context boxes after trade completes ══ */}
        {(status === "APPROVED" || status === "CLAIMED") && role !== "arbiter" && (
          <RatingPromptInline escrowId={e.id} role={role} description={e.description} showToast={showToast} />
        )}'''

if OLD in src:
    src = src.replace(OLD, NEW)
    print("✅ Role banners replaced")
else:
    print("❌ Pattern not found")
    sys.exit(1)

with open(filepath, "w") as f:
    f.write(src)
PYEOF

# ── Step 2: Inject RatingPromptInline component ───────────────────────
python3 - <<'PYEOF'
filepath = "escrow-ui/src/pages/EcashEscrow.jsx"
with open(filepath, "r") as f:
    src = f.read()

COMPONENT = '''
// ═══════════════════════════════════════════════════════════════════════
// RATING PROMPT — shown in escrow detail after APPROVED/CLAIMED
// Lets marketplace buyers/sellers rate each other without leaving escrow
// ═══════════════════════════════════════════════════════════════════════
function RatingPromptInline({ escrowId, role, description, showToast }) {
  const [score, setScore] = useState(0);
  const [comment, setComment] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  // Derive the order context from the escrow to find the right order/pubkeys
  // We call the marketplace orders endpoint to find the order linked to this escrow
  const [orderInfo, setOrderInfo] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        // Marketplace orders endpoint allows lookup by escrow id via query
        const res = await fetch(`/api/marketplace/listings/orders/by-escrow/${escrowId}`);
        if (res.ok) {
          const data = await res.json();
          setOrderInfo(data);
        }
      } catch {}
    })();
  }, [escrowId]);

  if (submitted) {
    return (
      <div style={{ textAlign: "center", padding: "16px", background: "rgba(16,185,129,0.06)", border: "1px solid rgba(16,185,129,0.2)", borderRadius: 12, marginBottom: 12 }}>
        <div style={{ fontSize: 24, marginBottom: 6 }}>⭐</div>
        <div style={{ color: "#10b981", fontWeight: 700, fontSize: 14 }}>Rating submitted — thank you!</div>
      </div>
    );
  }

  // If no marketplace order linked, or already rated, don't show
  if (!orderInfo || orderInfo.myRating) return null;

  // For marketplace: escrow seller = real buyer, escrow buyer = real seller
  const isMarketplace = description?.startsWith("Marketplace:");
  const isP2P = description?.startsWith("P2P Trade:");
  const otherPartyLabel = isMarketplace
    ? (role === "seller" ? "Seller" : "Buyer")   // escrow seller = real buyer rates real seller
    : (role === "seller" ? "Buyer" : "Seller");    // P2P normal

  const handleRate = async () => {
    if (!score) return showToast("Select a star rating first", "error");
    setLoading(true);
    try {
      const otherPubkey = orderInfo.otherPubkey;
      const res = await api(`/../../marketplace/listings/profile/${otherPubkey}/rate`, {
        method: "POST",
        body: JSON.stringify({ orderId: orderInfo.orderId, score, comment: comment || undefined }),
      }, 0);
      if (res.error) throw new Error(res.error);
      setSubmitted(true);
      showToast("⭐ Rating submitted!");
    } catch (err) {
      showToast(err.message, "error");
    }
    setLoading(false);
  };

  return (
    <div style={{ padding: "16px", background: "linear-gradient(135deg, rgba(245,158,11,0.08), rgba(245,158,11,0.03))", border: "1px solid rgba(245,158,11,0.25)", borderRadius: 12, marginBottom: 12 }}>
      <div style={{ textAlign: "center", marginBottom: 12 }}>
        <div style={{ fontSize: 22, marginBottom: 4 }}>⭐</div>
        <div style={{ fontSize: 14, fontWeight: 700, color: "#f8fafc" }}>Rate your {otherPartyLabel}</div>
        <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>Help build trust in the community</div>
      </div>
      <div style={{ display: "flex", justifyContent: "center", gap: 8, marginBottom: 12 }}>
        {[1,2,3,4,5].map(s => (
          <button key={s} onClick={() => setScore(s)} style={{
            fontSize: 26, background: "none", border: "none", cursor: "pointer",
            opacity: s <= score ? 1 : 0.3, transition: "opacity 0.15s, transform 0.1s",
            transform: s <= score ? "scale(1.15)" : "scale(1)",
          }}>★</button>
        ))}
      </div>
      <textarea
        value={comment}
        onChange={e => setComment(e.target.value)}
        placeholder="Optional comment (max 500 chars)"
        maxLength={500}
        style={{ width: "100%", minHeight: 52, padding: "8px 10px", borderRadius: 8, border: "1px solid #1e293b", background: "#0c0f17", color: "#f8fafc", fontSize: 12, resize: "vertical", boxSizing: "border-box", marginBottom: 10, fontFamily: "inherit" }}
      />
      <button
        onClick={handleRate}
        disabled={loading || !score}
        style={{ width: "100%", padding: "12px 0", borderRadius: 10, border: "none", background: score ? "linear-gradient(135deg, #f59e0b, #d97706)" : "#1e293b", color: score ? "#0c0f17" : "#475569", fontWeight: 700, fontSize: 14, cursor: score ? "pointer" : "not-allowed", transition: "all 0.2s" }}
      >
        {loading ? "Submitting…" : `Submit Rating`}
      </button>
    </div>
  );
}

'''

# Inject before DetailView
marker = "// ═══════════════════════════════════════════════════════════════════════\n// DETAIL VIEW"
if marker in src:
    src = src.replace(marker, COMPONENT + marker, 1)
    print("✅ RatingPromptInline component injected")
else:
    print("⚠️  Could not find DETAIL VIEW marker — injecting before DetailView function")
    marker2 = "function DetailView("
    if marker2 in src:
        src = src.replace(marker2, COMPONENT + marker2, 1)
        print("✅ RatingPromptInline injected before DetailView")
    else:
        print("❌ Could not inject component")

with open(filepath, "w") as f:
    f.write(src)
PYEOF

# ── Step 3: Add backend route for order lookup by escrow ID ──────────
python3 - <<'PYEOF'
filepath = "src/routes/marketplace.ts"
with open(filepath, "r") as f:
    src = f.read()

# Add a lookup route: GET /orders/by-escrow/:escrowId
NEW_ROUTE = '''
// ── GET /orders/by-escrow/:escrowId — Escrow-to-order lookup (for rating from escrow UI) ──
router.get("/orders/by-escrow/:escrowId", ...requireAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const pk = req.pubkey!;
    const order = stmts.getOrderByEscrow.get(req.params.escrowId) as OrderRow | undefined;
    if (!order) return res.status(404).json({ error: "No order linked to this escrow" });

    // Must be a participant
    if (order.buyer_pubkey !== pk && order.seller_pubkey !== pk)
      return res.status(403).json({ error: "Not a participant in this order" });

    const otherPubkey = order.buyer_pubkey === pk ? order.seller_pubkey : order.buyer_pubkey;
    const myRating = stmts.getRatingByOrderAndRater.get(order.id, pk) as RatingRow | undefined;

    res.json({
      orderId: order.id,
      otherPubkey,
      myRating: myRating || null,
      status: order.status,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

'''

# Inject before the parameterized /:id route section
marker = "// ── GET /:id — Listing detail ────────────────────────────────────────────"
if marker in src:
    src = src.replace(marker, NEW_ROUTE + marker, 1)
    print("✅ /orders/by-escrow/:escrowId route added")
else:
    print("⚠️  Injection marker not found for backend route")

with open(filepath, "w") as f:
    f.write(src)
PYEOF

# ── Step 4: Fix canBuyerVote label for marketplace buyers ─────────────
# In marketplace: escrow seller = real buyer. The confirm button says
# "Confirm — release → to me" which is correct for P2P buyer but for
# marketplace escrow-seller (real buyer) it should say "Confirm payment sent"
python3 - <<'PYEOF'
filepath = "escrow-ui/src/pages/EcashEscrow.jsx"
with open(filepath, "r") as f:
    src = f.read()

old = '''            {loading ? t("voting") : `✓ ${t("confirm")} — ${t("release")} ➜ ${t("toMe")}`}'''
new = '''            {loading ? t("voting") : (
              e.description?.startsWith("Marketplace:") && role === "seller"
                ? "✓ Confirm — Payment sent, release to seller"
                : `✓ ${t("confirm")} — ${t("release")} ➜ ${t("toMe")}`
            )}'''

if old in src:
    src = src.replace(old, new)
    print("✅ canBuyerVote label fixed for marketplace")
else:
    print("⚠️  canBuyerVote label not found — skipping")

with open(filepath, "w") as f:
    f.write(src)
PYEOF

# ── Build + restart ───────────────────────────────────────────────────
echo ""
echo "→ Building..."
cd escrow-ui && npm run build 2>&1 | tail -5
cd ..
sudo systemctl restart fedi-escrow
sleep 2
systemctl is-active --quiet fedi-escrow && echo "✅ Service running" || echo "❌ Service failed"
echo ""
echo "Done. Changes:"
echo "  • Role banners now use plain-language (buyer/seller, not escrow roles)"
echo "  • Arbiter banner styled distinctly in purple"
echo "  • Rating prompt appears prominently on APPROVED/CLAIMED status"
echo "  • Marketplace buyer confirm button says 'release to seller' not 'to me'"
echo "  • Backend: /orders/by-escrow/:id route for escrow→rating lookup"
