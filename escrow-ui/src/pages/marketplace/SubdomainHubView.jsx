const BACK_SVG = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="15 18 9 12 15 6"/>
  </svg>
);

const HUB_CONFIG = {
  market: {
    icon: "🛒", title: "Marketplace",
    tagline: "Buy anything with Bitcoin · Secured by 2-of-3 escrow",
    color: "#a78bfa",
    cards: [
      { icon: "🛍️", iconBg: "rgba(167,139,250,0.15)", title: "Browse & Buy", titleColor: "#a78bfa",
        desc: "Find items, pay with sats. Escrow protects every purchase.", action: "browse" },
      { icon: "📦", iconBg: "rgba(16,185,129,0.15)", title: "Sell Something", titleColor: "#10b981",
        desc: "List your item. Buyer pays with sats. Ship when escrow locks.", action: "create" },
    ],
    howItWorks: [
      { icon: "📦", label: "List", desc: "Post your item", color: "#a78bfa" },
      { icon: "🔒", label: "Lock", desc: "Sats held safe", color: "#f59e0b" },
      { icon: "🚚", label: "Ship", desc: "Send the item", color: "#10b981" },
      { icon: "✅", label: "Done", desc: "Confirm & release", color: "#3b82f6" },
    ],
    listingLabel: "Items Listed",
  },
  p2p: {
    icon: "₿", title: "P2P Exchange",
    tagline: "Buy & sell Bitcoin · No middleman · Non-custodial",
    color: "#f59e0b",
    billPayHero: {
      icon: "🧾",
      title: "Pay a Bill",
      desc: "Need fiat? Lock your sats. Your community pays the bill and claims the sats.",
      ctaLabel: "Get My Bill Paid →",
      action: "billpay",
    },
    cards: [
      { icon: "₿", iconBg: "rgba(245,158,11,0.1)", title: "Buy Bitcoin", titleColor: "#f59e0b",
        desc: "Send fiat · get sats from escrow", action: "browse" },
      { icon: "🏠", iconBg: "rgba(16,185,129,0.1)", title: "Sell Bitcoin", titleColor: "#10b981",
        desc: "Lock sats · receive fiat · release", action: "create" },
    ],
    howItWorks: [
      { icon: "🔒", label: "Lock", desc: "Seller locks sats", color: "#f59e0b" },
      { icon: "💸", label: "Send", desc: "Buyer sends fiat", color: "#a78bfa" },
      { icon: "✅", label: "Confirm", desc: "Both vote", color: "#10b981" },
      { icon: "⚡", label: "Done", desc: "Sats released", color: "#3b82f6" },
    ],
    listingLabel: "Live Offers",
  },
  lending: {
    icon: "🤝", title: "Community Lending",
    tagline: "Bitcoin loans · Secured by escrow · Community trust",
    color: "#10b981",
    cards: [
      { icon: "🙋", iconBg: "rgba(16,185,129,0.15)", title: "Borrow Sats", titleColor: "#10b981",
        desc: "Find a lender in your community. Agree terms. Receive sats.", action: "browse" },
      { icon: "💼", iconBg: "rgba(167,139,250,0.15)", title: "Lend & Earn", titleColor: "#a78bfa",
        desc: "Lock sats. Set your terms. Earn interest from your community.", action: "create" },
    ],
    howItWorks: [
      { icon: "📋", label: "Agree", desc: "Set loan terms", color: "#10b981" },
      { icon: "🔒", label: "Lock", desc: "Lender locks sats", color: "#f59e0b" },
      { icon: "💸", label: "Receive", desc: "Borrower gets sats", color: "#a78bfa" },
      { icon: "🔄", label: "Repay", desc: "Return + interest", color: "#3b82f6" },
    ],
    listingLabel: "Active Loans",
  },
};


// Ensure pulse animation is available
const pulseStyle = typeof document !== "undefined" && !document.getElementById("sm-pulse-kf") ? (() => {
  const s = document.createElement("style"); s.id = "sm-pulse-kf";
  s.textContent = "@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.6} }";
  document.head.appendChild(s); return true;
})() : true;

export default function SubdomainHubView({ subdomain, onBrowse, onCreate, onOrders, onBillPay, listingCount, activeOrderCount }) {
  const cfg = HUB_CONFIG[subdomain] || HUB_CONFIG.market;
  const isP2P = subdomain === "p2p";

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, overflowY: "auto", maxWidth: 480, margin: "0 auto", width: "100%", boxSizing: "border-box" }}>
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", padding: "16px 16px 4px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <span style={{ fontSize: 18 }}>{cfg.icon}</span>
          <span style={{ fontSize: 17, fontWeight: 600, color: "#f8fafc" }}>{cfg.title}</span>
        </div>
      </div>
      <div style={{ textAlign: "center", fontSize: 12, color: "#475569", padding: "2px 16px 14px", lineHeight: 1.4 }}>{cfg.tagline}</div>
      <div style={{ margin: "16px 16px 8px", padding: "16px", borderRadius: 14, background: "#111827", border: "1px solid #1e293b", textAlign: "center" }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 14 }}>How it works</div>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "center", gap: 0 }}>
          {cfg.howItWorks.map((s, i, arr) => (
            <div key={s.label} style={{ display: "flex", alignItems: "flex-start" }}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 5, minWidth: 64 }}>
                <div style={{ width: 38, height: 38, borderRadius: 11, background: s.color + "18", border: "1px solid " + s.color + "35", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17 }}>{s.icon}</div>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#f8fafc" }}>{s.label}</div>
                <div style={{ fontSize: 9, color: "#475569", lineHeight: 1.3 }}>{s.desc}</div>
              </div>
              {i < arr.length - 1 && <div style={{ color: "#334155", fontSize: 14, paddingTop: 12, flexShrink: 0 }}>{"→"}</div>}
            </div>
          ))}
        </div>
      </div>
      <div style={{ padding: "0 16px", display: "flex", flexDirection: "column", gap: 10 }}>
        {/* ── Hero card: Pay a Bill (p2p only) ── */}
        {cfg.billPayHero && (
          <button onClick={onBillPay}
            style={{ display: "flex", flexDirection: "column", padding: "18px 16px", borderRadius: 16, background: "rgba(245,158,11,0.08)", border: "1.5px solid rgba(245,158,11,0.3)", cursor: "pointer", textAlign: "left", width: "100%", marginBottom: 2 }}
            onMouseEnter={e => e.currentTarget.style.borderColor = "rgba(245,158,11,0.5)"}
            onMouseLeave={e => e.currentTarget.style.borderColor = "rgba(245,158,11,0.3)"}
          >
            <div style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.22)", borderRadius: 99, padding: "3px 9px", fontSize: 10, fontWeight: 700, color: "#f59e0b", letterSpacing: 0.4, marginBottom: 10 }}>
              ⭐ FEATURED
            </div>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 12 }}>
              <div style={{ width: 50, height: 50, borderRadius: 14, background: "rgba(245,158,11,0.15)", border: "1px solid rgba(245,158,11,0.25)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, flexShrink: 0 }}>
                {cfg.billPayHero.icon}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 18, fontWeight: 700, color: "#fbbf24", marginBottom: 4, letterSpacing: -0.3 }}>{cfg.billPayHero.title}</div>
                <div style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.5 }}>{cfg.billPayHero.desc}</div>
              </div>
            </div>
            <div style={{ width: "100%", padding: "10px", borderRadius: 10, background: "linear-gradient(135deg, #f59e0b, #d97706)", color: "#0c0f17", fontSize: 13, fontWeight: 700, textAlign: "center", letterSpacing: 0.2 }}>
              {cfg.billPayHero.ctaLabel}
            </div>
          </button>
        )}

        {/* ── Mini pair: Buy / Sell ── */}
        {cfg.billPayHero ? (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {cfg.cards.map((card) => (
              <button key={card.action} onClick={card.action === "browse" ? onBrowse : card.action === "create" ? onCreate : null}
                style={{ display: "flex", flexDirection: "column", gap: 4, padding: "10px 11px", borderRadius: 12, background: "rgba(15,23,42,0.5)", border: "1px solid #1e293b", cursor: "pointer", textAlign: "left" }}
                onMouseEnter={e => e.currentTarget.style.borderColor = "#334155"}
                onMouseLeave={e => e.currentTarget.style.borderColor = "#1e293b"}
              >
                <div style={{ width: 28, height: 28, borderRadius: 8, background: card.iconBg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15 }}>{card.icon}</div>
                <div style={{ fontSize: 12, fontWeight: 600, color: card.titleColor }}>{card.title}</div>
                <div style={{ fontSize: 10, color: "#64748b", lineHeight: 1.4 }}>{card.desc}</div>
                <div style={{ fontSize: 10, color: "#334155", alignSelf: "flex-end" }}>→</div>
              </button>
            ))}
          </div>
        ) : (
          cfg.cards.map((card) => (
            <button key={card.action} onClick={card.action === "browse" ? onBrowse : card.action === "create" ? onCreate : card.action === "billpay" ? onBillPay : null}
              style={{ display: "flex", alignItems: "center", gap: 14, padding: "16px 14px", borderRadius: 14, background: "rgba(15,23,42,0.5)", border: "1px solid #1e293b", cursor: "pointer", textAlign: "left", width: "100%" }}
              onMouseEnter={e => e.currentTarget.style.borderColor = "#334155"}
              onMouseLeave={e => e.currentTarget.style.borderColor = "#1e293b"}
            >
              <div style={{ width: 46, height: 46, borderRadius: 12, background: card.iconBg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, flexShrink: 0 }}>{card.icon}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: card.titleColor, marginBottom: 3 }}>{card.title}</div>
                <div style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.4 }}>{card.desc}</div>
              </div>
              <div style={{ fontSize: 18, color: "#475569", flexShrink: 0 }}>→</div>
            </button>
          ))
        )}
      </div>
      <div style={{ display: "flex", gap: 10, margin: "16px 16px 0" }}>
        <div style={{ flex: 1, padding: "14px 12px", borderRadius: 12, background: "#111827", border: "1px solid #1e293b", textAlign: "center" }}>
          <div style={{ fontSize: 22, fontWeight: 900, color: cfg.color }}>{listingCount || 0}</div>
          <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 2 }}>{cfg.listingLabel}</div>
        </div>
        <button onClick={onOrders} style={{ flex: 1, padding: "14px 12px", borderRadius: 12, background: "#111827", border: activeOrderCount > 0 ? "1px solid rgba(245,158,11,0.4)" : "1px solid #1e293b", textAlign: "center", cursor: "pointer", WebkitTapHighlightColor: "transparent", boxShadow: activeOrderCount > 0 ? "0 0 12px rgba(245,158,11,0.15)" : "none", animation: activeOrderCount > 0 ? "pulse 2s infinite" : "none" }}>
          <div style={{ fontSize: 22, fontWeight: 900, color: "#10b981" }}>{activeOrderCount || 0}</div>
          <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 2 }}>Your Trades ↗</div>
        </button>
      </div>
      <div style={{ textAlign: "center", padding: "0 16px 16px" }}>
        <button onClick={onBrowse} style={{ background: "none", border: "none", color: "#334155", fontSize: 11, cursor: "pointer", textDecoration: "underline", textUnderlineOffset: 2 }}>
          Advanced mode — browse & create custom offers →
        </button>
      </div>
    </div>
  );
}
