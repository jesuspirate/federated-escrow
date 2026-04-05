import { useState, useEffect, useRef } from "react";
import { fmtSats, fmtFiat } from "./helpers";
import { t } from "../i18n";
import { Icons } from "./components";
import M from "./styles";

const ORDER_STATUS_KEYS = {
  pending:   { color: "#8b5cf6", bg: "rgba(139,92,246,0.12)", key: "mkOrderPending" },
  active:    { color: "#f59e0b", bg: "rgba(245,158,11,0.12)", key: "mkOrderActive" },
  completed: { color: "#10b981", bg: "rgba(16,185,129,0.12)", key: "mkOrderCompleted" },
  expired:   { color: "#ef4444", bg: "rgba(239,68,68,0.12)", key: "mkOrderExpired" },
  cancelled: { color: "#64748b", bg: "rgba(100,116,139,0.12)", key: "mkOrderCancelled" },
};


function OrderBadge({ status }) {
  const c = ORDER_STATUS_KEYS[status] || ORDER_STATUS_KEYS.pending;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 10px", borderRadius: 99, fontSize: 11, fontWeight: 700, color: c.color, background: c.bg, letterSpacing: 0.3 }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: c.color }} />
      {t(c.key)}
    </span>
  );
}

export default function OrdersView({ orders, loading, pubkey, onBack, onRefresh, onOpenOrder, onProfile, fiatRates, initialFilter, onFilterConsumed, subdomain }) {
  const [orderSearch, setOrderSearch] = useState("");
  const activeCount = orders.filter(o => o.status === "active" || o.status === "pending").length;
  const needsRatingCount = orders.filter(o => o.needsRating).length;
  const defaultFilter = initialFilter || (activeCount > 0 ? "active" : "all");
  const [orderFilter, setOrderFilter] = useState(defaultFilter);
  useEffect(() => { if (initialFilter) { setOrderFilter(initialFilter); if (onFilterConsumed) onFilterConsumed(); } }, [initialFilter]);
  // Sort: needs-rating first, then by date
  const sorted = [...orders].filter(o => {
    // Status filter
    // Hide repayment orders from non-lending subdomains
    if (orderFilter === "active") return (o.status === "active" || o.status === "pending" );
    if (orderFilter === "completed") return o.status === "completed" && !o.isLoanActive;
    if (orderFilter === "cancelled") return o.status === "cancelled" || o.status === "expired";
    return true;
    return true;
  }).filter(o => {
    if (!orderSearch.trim()) return true;
    const q = orderSearch.toLowerCase().trim();
    return (o.id || "").toLowerCase().includes(q)
      || (o.escrowId || "").toLowerCase().includes(q)
      || (o.listingTitle || "").toLowerCase().includes(q)
      || (o.status || "").toLowerCase().includes(q);
  }).sort((a, b) => {
    const priority = (o) => {
      if (o.needsRating) return 0;
      if (o.status === "active") return 1;
      if (o.status === "pending") return 2;
      if (o.status === "completed") return 3;
      if (o.status === "expired") return 4;
      if (o.status === "cancelled") return 5;
      return 6;
    };
    return priority(a) - priority(b) || new Date(b.createdAt) - new Date(a.createdAt);
  });

  return (
    <div style={M.container}>
      <div style={M.viewHeader}>
        <button style={M.iconBtn} onClick={onBack}><Icons.Back /></button>
        <h2 style={M.viewTitle}>{t("mkMyOrders")}</h2>
        <button style={M.iconBtn} onClick={onRefresh}><Icons.Refresh style={loading ? { animation: "pulse 1s infinite" } : {}} /></button>
      </div>
      <div style={{ marginBottom: 8 }}>
        <input style={{ ...M.input, fontSize: 13 }} placeholder={t("mkSearchOrders") || "Search orders…"} value={orderSearch} onChange={e => setOrderSearch(e.target.value)} />
      </div>
      <div style={{ display: "flex", gap: 6, marginBottom: 12, overflowX: "auto" }}>
        {[
          { key: "all", label: "All", count: orders.length },
          { key: "active", label: subdomain === "lending" ? t("mkInProgress") || "In Progress" : t("mkActive") || "Active", count: orders.filter(o => (o.status === "active" || o.status === "pending") ).length },
          { key: "completed", label: t("mkDone") || "Done", count: orders.filter(o => o.status === "completed" && !o.isLoanActive).length },
          ...(subdomain !== "lending" ? [{ key: "cancelled", label: t("mkClosed") || "Closed", count: orders.filter(o => (o.status === "cancelled" || o.status === "expired")).length }] : []),
        ].map(f => (
          <button key={f.key} onClick={() => setOrderFilter(f.key)} style={{
            padding: "6px 12px", borderRadius: 99, border: "1px solid",
            fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
            background: orderFilter === f.key ? "rgba(139,92,246,0.15)" : "transparent",
            color: orderFilter === f.key ? "#a78bfa" : "#64748b",
            borderColor: orderFilter === f.key ? "rgba(139,92,246,0.3)" : "#1e293b",
          }}>
            {f.label} {f.count > 0 ? "(" + f.count + ")" : ""}
          </button>
        ))}
      </div>

      {sorted.length === 0 ? (
        <div style={M.emptyState}>
          <Icons.Package style={{ color: "#475569" }} />
          <p style={{ color: "#64748b", marginTop: 12, fontSize: 14 }}>
            {loading ? t("mkLoading") : t("mkNoOrders")}
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingBottom: 20 }}>
          {sorted.map(o => (
            <button key={o.id} style={{
              ...M.listingCard,
              ...(o.listingCategory === "bill-pay" && (o.status === "pending" || o.status === "active") ? { borderColor: "rgba(245,158,11,0.4)", boxShadow: "0 0 14px rgba(245,158,11,0.12)" } : {}), ...(o.needsRating ? { borderColor: "rgba(245,158,11,0.3)", boxShadow: "0 0 12px rgba(245,158,11,0.08)" } : {}),
              /* opacity removed for cleaner look */
              ...(o.status === "expired" || o.status === "cancelled" ? { opacity: 0.35 } : {}),
              ...(o.isRepayment && (o.status === "active" || o.status === "pending") ? { borderColor: "rgba(245,158,11,0.5)", boxShadow: "0 0 16px rgba(245,158,11,0.15)", animation: "pulse 2s infinite" } : {}),
            }} onClick={() => onOpenOrder(o)}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={M.cardTitle}>{o.listingTitle || "(deleted)"}</span>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  {o.needsRating && (
                    <span style={{
                      display: "inline-flex", alignItems: "center", gap: 3,
                      padding: "2px 8px", borderRadius: 99, fontSize: 10, fontWeight: 700,
                      color: "#f59e0b", background: "rgba(245,158,11,0.12)",
                      animation: "pulse 2s infinite",
                    }}>
                      ⭐ Rate
                    </span>
                  )}
                  {o.isRepayment && (o.status === "active" || o.status === "pending") && (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 3, padding: "2px 8px", borderRadius: 99, fontSize: 10, fontWeight: 700, color: "#f59e0b", background: "rgba(245,158,11,0.12)", animation: "pulse 2s infinite" }}>💰 Repay</span>
                  )}
                  <OrderBadge status={o.status} />
                </div>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6 }}>
		<span style={{ fontSize: 15, fontWeight: 600, color: "#f8fafc" }}><span style={{ color: "#f7931a", fontWeight: 800 }}>₿</span>{fmtSats(o.amountMsats)}</span>
                    {fiatRates && <span style={{ fontSize: 10, color: "#64748b", marginLeft: 6 }}>≈ {fmtFiat(o.amountMsats, fiatRates, "USD")}</span>}
                <span style={{ fontSize: 11, color: "#475569" }}>
                  {o.buyerPubkey === pubkey ? `🛒 ${t("buyer")}` : `🏠 ${t("seller")}`}
                </span>
              </div>
              <div style={{ fontSize: 11, fontFamily: "monospace", color: "#334155", marginTop: 4 }}>
                {o.id} → {o.escrowId}
                <span style={{ marginLeft: 6, padding: "1px 6px", borderRadius: 4, fontSize: 9, fontWeight: 700, background: o.listingCategory === "bill-pay" ? "rgba(245,158,11,0.15)" : o.tradeType === "lending" ? "rgba(16,185,129,0.12)" : o.tradeType === "sats-for-fiat" ? "rgba(245,158,11,0.12)" : "rgba(139,92,246,0.12)", color: o.listingCategory === "bill-pay" ? "#f59e0b" : o.tradeType === "lending" ? "#10b981" : o.tradeType === "sats-for-fiat" ? "#f59e0b" : "#a78bfa" }}>{o.listingCategory === "bill-pay" ? "🧾 bill pay" : o.tradeType === "lending" ? "lending" : o.tradeType === "sats-for-fiat" ? "p2p" : "market"}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

