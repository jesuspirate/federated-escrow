import { useState, useEffect, useMemo } from "react";
import { CATEGORIES, CONDITION_KEYS, PAYMENT_METHODS, LEARN_DISMISSED_KEY } from "./constants";
import { fmtSats, fmtSatsShort, getFedInfo, isBillPay, isLending, isSatsForFiat, isSpecialCategory } from "./helpers";
import { t, getAvailableLocales } from "../i18n";
import { Icons } from "./components";
import M from "./styles";

function NewToFediBanner({ _isFediRuntime }) {
  const inFedi = _isFediRuntime ? _isFediRuntime() : false;
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(LEARN_DISMISSED_KEY) === "1"; } catch { return false; }
  });
  const [expanded, setExpanded] = useState(false);

  if (dismissed) return null;
  if (inFedi) return null;

  return (
    <div style={{
      marginBottom: 14, borderRadius: 12, overflow: "hidden",
      background: "linear-gradient(145deg, rgba(245,158,11,0.04), rgba(17,24,39,0.95))",
      border: "1px solid rgba(245,158,11,0.2)",
      borderLeft: "3px solid #f59e0b",
    }}>
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          width: "100%", padding: "12px 14px", background: "transparent",
          border: "none", color: "#e2e8f0", cursor: "pointer", textAlign: "left",
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 16 }}>💡</span>
          {inFedi ? "Join Our Community!" : "New to Bitcoin or Fedi?"}
        </span>
        <span style={{ fontSize: 11, color: "#f59e0b", fontWeight: 600, transform: expanded ? "rotate(180deg)" : "rotate(0)", transition: "transform 0.2s" }}>▼</span>
      </button>

      {expanded && (
        <div style={{ padding: "0 14px 14px", animation: "slideUp 0.2s ease-out" }}>
          <div style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.7, marginBottom: 12 }}>
            {inFedi
              ? "Trade with real sats, secured by 2-of-3 escrow. Join our community to connect with other traders and get help."
              : "This marketplace runs on Bitcoin through the Fedi app. Trades are secured by 2-of-3 escrow — no trust needed between buyer and seller."}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {!inFedi && (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 14 }}>1️⃣</span>
                <a href="https://fedi.xyz/product" target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "8px 14px", borderRadius: 8, background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.2)", color: "#10b981", fontSize: 12, fontWeight: 600, textDecoration: "none" }}>📲 Download Fedi to trade real sats</a>
              </div>
            )}
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 14 }}>{inFedi ? "1️⃣" : "2️⃣"}</span>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <a href="fedi:community210v3xzat5dphhyhmsw43xketeygazyv33vvmnzvmxx5unqwpkxdnxxvfs893rjwfcvsukxcmzxsmkxcnyvf3kywpnxscxzdnyxq6rvcmpxuengvp4xdsn2wfcvymrgvpexesjytpzvdhk6mt4de5hg72lw46kjezldpjhsg36yfskyephv5cnqwpjvdnrqenrxpnrxvmrxs6nscfkxymnvdrpv4jngwpjvdskgce3xy6nvdf5vfjxyef4x9jrvceevejrvcenxcekydtrygkzyer9vde8jur5d9hkuhmtv4ujyw3zvymkvmr0gcu4wuth2eh9zkr9vdc8z3m4w4m56v60w3j9zwrpxdvhw3n9ga3kwcfcgc4kk0fz05fkv4p3" style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "6px 12px", borderRadius: 8, background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.15)", color: "#f59e0b", fontSize: 11, fontWeight: 600, textDecoration: "none" }}>🇬🇧 Join Community</a>
                <a href="fedi:community210v3xzat5dphhyhmsw43xketeygazyde5xf3kzvpnx9skzdnyxpjrvdm9xpskzc3kxucrxwpex33xxe3exvmnxvtxv9jryefexsmnqvty8yunvd35vgunywrzxvmrsvpj8q6jytpzvdhk6mt4de5hg72lw46kjezldpjhsg36yfnrqcf3vserxvfevyck2wtyxanxzvf5x9skgdfhvd3rwc3jv5crsetyx3jxvdesxserxerpvdskzcehxpjr2wf5vymkxenpx56kvwrpygkzyer9vde8jur5d9hkuhmtv4ujyw3zfphhy3t3vym8sd6vg4a9v6n2fsek7m6k23ux6v6ytp65jeekd4pkj5nzw39xcanh0pkrg0fz055t3dve" style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "6px 12px", borderRadius: 8, background: "rgba(59,130,246,0.06)", border: "1px solid rgba(59,130,246,0.15)", color: "#3b82f6", fontSize: 11, fontWeight: 600, textDecoration: "none" }}>🇫🇷 Rejoindre</a>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 14 }}>{inFedi ? "2️⃣" : "3️⃣"}</span>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <a href="fedi:room:!kENaQZKCKhRhawCjxf:m1.8fa.in:::" style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "6px 12px", borderRadius: 8, background: "rgba(139,92,246,0.06)", border: "1px solid rgba(139,92,246,0.15)", color: "#a78bfa", fontSize: 11, fontWeight: 600, textDecoration: "none" }}>💬 Support EN</a>
                <a href="fedi:room:!qHlVxBJBCKqUbetBnA:m1.8fa.in:::" style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "6px 12px", borderRadius: 8, background: "rgba(139,92,246,0.06)", border: "1px solid rgba(139,92,246,0.15)", color: "#a78bfa", fontSize: 11, fontWeight: 600, textDecoration: "none" }}>💬 Support FR</a>
              </div>
            </div>
            {!inFedi && (
              <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                <a href="https://bitcoin.org/en/getting-started" target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "6px 12px", borderRadius: 8, background: "rgba(247,147,26,0.06)", border: "1px solid rgba(247,147,26,0.15)", color: "#f7931a", fontSize: 11, fontWeight: 600, textDecoration: "none" }}>₿ Learn Bitcoin</a>
                <a href="https://www.fedi.xyz" target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "6px 12px", borderRadius: 8, background: "rgba(139,92,246,0.06)", border: "1px solid rgba(139,92,246,0.15)", color: "#a78bfa", fontSize: 11, fontWeight: 600, textDecoration: "none" }}>🛡️ Learn Fedi</a>
              </div>
            )}
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); try { localStorage.setItem(LEARN_DISMISSED_KEY, "1"); } catch {} setDismissed(true); }}
            style={{ marginTop: 12, background: "transparent", border: "none", color: "#475569", fontSize: 11, cursor: "pointer", padding: "4px 0" }}
          >
            Don't show this again
          </button>
        </div>
      )}
    </div>
  );
}

function GlobeLangPicker({ locale, onSwitchLocale }) {
  const [open, setOpen] = useState(false);
  
  const locales = getAvailableLocales();
  const current = locales.find(l => l.code === locale);
  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          width: 32, height: 32, borderRadius: 8,
          background: open ? "#1e293b" : "transparent",
          border: open ? "1px solid #334155" : "1px solid transparent",
          color: "#94a3b8", fontSize: 16, cursor: "pointer", lineHeight: 1,
          transition: "all 0.15s",
        }}
        title={current?.label || "Language"}
      >
        🌐
      </button>
      {open && (
        <div style={{
          position: "absolute", right: 0, top: 38, zIndex: 200,
          background: "#0f172a", border: "1px solid #1e293b",
          borderRadius: 10, padding: 6, minWidth: 140,
          boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
        }}
          onMouseLeave={() => setOpen(false)}
        >
          {locales.map(l => (
            <button
              key={l.code}
              onClick={() => { onSwitchLocale(l.code); setOpen(false); }}
              style={{
                display: "flex", alignItems: "center", gap: 8,
                width: "100%", padding: "7px 10px", borderRadius: 7,
                background: locale === l.code ? "#1e293b" : "transparent",
                border: "none", color: locale === l.code ? "#f8fafc" : "#64748b",
                fontSize: 13, fontWeight: locale === l.code ? 600 : 400,
                cursor: "pointer", textAlign: "left",
                transition: "all 0.1s",
              }}
            >
              <span style={{ fontSize: 16 }}>{l.flag}</span>
              <span>{l.label}</span>
              {locale === l.code && <span style={{ marginLeft: "auto", color: "#8b5cf6", fontSize: 12 }}>✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function BrowseView({ listings, loading, pubkey, searchQuery, setSearchQuery, onSearch, onOpen, onCreate, onOrders, activeOrderCount, onNotifications, onRefresh, onSwitchToEscrow, onProfile, locale, onSwitchLocale, onChapSmart, subdomain, myFederation, onArbiters, onFaq, showToast, onBillPay, fiatRates, mapi, isDevMode, _isFediRuntime, onHub, onBack }) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [activeCategory, setActiveCategory] = useState(() => { const h = window.location.hash.replace("#", ""); if (h === "billpay" && onBillPay) { setTimeout(() => onBillPay(), 100); } return "all"; });
  const [helpOpen, setHelpOpen] = useState(false);
  const [filterPayMethod, setFilterPayMethod] = useState(null);
  const [filterCurrency, setFilterCurrency] = useState(null);
  const p2pCount = useMemo(() => listings.filter(l => isSatsForFiat(l.category)).length, [listings]);
  const lendingCount = useMemo(() => listings.filter(l => isLending(l.category)).length, [listings]);

  // Fed-VIP: track revealed federation-only listings
  const [revealedVIP, setRevealedVIP] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem("sm_vip_revealed") || "{}"); } catch { return {}; }
  });
  const [probingVIP, setProbingVIP] = useState(null);

  const probeAndReveal = async (listing) => {
    if (revealedVIP[listing.id]) return onOpen(listing.id); // already revealed
    setProbingVIP(listing.id);
    try {
      if (isDevMode()) {
        // Sandbox: auto-reveal
        const next = { ...revealedVIP, [listing.id]: true };
        setRevealedVIP(next);
        try { sessionStorage.setItem("sm_vip_revealed", JSON.stringify(next)); } catch {}
        setProbingVIP(null);
        return;
      }
      // 1-sat probe to detect federation
      const _fedi = window.fedi || window.fediInternal; if (!_fedi?.generateEcash) throw new Error("Fedi wallet not available"); const probeNotes = await _fedi.generateEcash({ amount: 1 });
      const notePrefix = (typeof probeNotes === "string" ? probeNotes : probeNotes?.notes || "").substring(0, 10);
      // Auto-refund immediately
      try { await (window.fedi || window.fediInternal).receiveEcash(typeof probeNotes === "string" ? probeNotes : probeNotes?.notes); } catch {}
      // Check if federation matches
      const sellerPrefix = listing.sellerFedPrefix || "";
      const match = sellerPrefix && notePrefix === sellerPrefix;
      if (match || !sellerPrefix) {
        const next = { ...revealedVIP, [listing.id]: true };
        setRevealedVIP(next);
        try { sessionStorage.setItem("sm_vip_revealed", JSON.stringify(next)); } catch {}
      } else {
        const fi = getFedInfo(listing.sellerFedPrefix, listing.sellerFedDomain); showToast("This listing is for " + (fi?.name || "another federation") + " members only.", "error");
      }
    } catch (err) {
      showToast("Federation probe failed: " + (err.message || "try again"), "error");
    }
    setProbingVIP(null);
  };

  // Borrower lending level — filter listings above their level
  const [browseLevel, setBrowseLevel] = useState(null);
  useEffect(() => {
    if (subdomain !== "lending") return;
    (async () => {
      try {
        const data = await mapi("/lending-level/" + pubkey);
        if (!data.error) setBrowseLevel(data);
      } catch {}
    })();
  }, [pubkey, subdomain]);

  const subdomainFilter = (l) => {
    if (subdomain === "p2p") return isSatsForFiat(l.category) || isBillPay(l.category);
    if (subdomain === "lending") return isLending(l.category) || isBillPay(l.category);
    if (subdomain === "market") return !isSatsForFiat(l.category) && !isLending(l.category);
    return true; // legacy satoshimarket.app shows all
  };
  const mineCount = useMemo(() => listings.filter(l => l.sellerPubkey === pubkey).filter(subdomainFilter).length, [listings, pubkey, subdomain]);
  // Subdomain-based listing filter

  const filteredListings = (activeCategory === "all"
    ? listings.filter(subdomainFilter)
    : activeCategory === "mine"
    ? listings.filter(l => l.sellerPubkey === pubkey).filter(subdomainFilter)
    : listings.filter(l => {
        if (l.sellerPubkey === pubkey && activeCategory !== "bill-pay") return false;
        if (activeCategory === "sats-for-fiat") return isSatsForFiat(l.category);
        if (activeCategory === "lending") return isLending(l.category);
        if (activeCategory === "bill-pay") return isBillPay(l.category);
        if (isSpecialCategory(l.category)) return false;
        return l.category?.toLowerCase() === activeCategory;
      })
  ).filter(l => {
    if (!searchQuery.trim()) return true;
  }).filter(l => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase().trim();
    return (l.title || "").toLowerCase().includes(q)
      || (l.description || "").toLowerCase().includes(q)
      || (l.category || "").toLowerCase().includes(q)
      || (l.id || "").toLowerCase().includes(q);
  }).filter(l => {
    // Hide lending listings above borrower level (own listings always visible)
    if (!browseLevel || !isLending(l.category) || l.sellerPubkey === pubkey) return true;
    return Math.floor(l.priceMsats / 1000) <= browseLevel.maxSats;
  }).slice().sort((a, b) => {
  }).filter(l => {
    if (!filterPayMethod) return true;
    const methods = l.paymentMethods || [];
    return methods.includes(filterPayMethod);
    // Urgent (1 left) first, then available, then sold out
  }).filter(l => {
    if (!filterCurrency) return true;
    const terms = l.terms || "";
    const currMatch = terms.match(/Currency:\s*(\w+)/);
    const cur = currMatch ? currMatch[1] : l.fiatCurrency || null;
    return cur === filterCurrency;
    const rank = (l) => {
      if (l.status === "paused") return 3;
      if (l.quantity <= 0 || l.status === "sold") return 4;
      if (l.quantity === 1) return 0;
      return 1;
    };
    return rank(a) - rank(b);
  });

  return (
    <div style={{ ...M.container, display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
      {/* ══ PINNED HEADER SECTION ══ */}
      <div style={{ flexShrink: 0 }}>
        <div style={M.header}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {onHub && (
            )}
          </div>
          <div>
            <img src="/satoshimarket-logo.png" alt="SatoshiMarket" style={{ height: subdomain === "marketplace" ? 112 : 80, objectFit: "contain" }} />
            {subdomain !== "marketplace" && (
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, marginTop: 4,
                color: subdomain === "p2p" ? "#f59e0b" : subdomain === "lending" ? "#10b981" : subdomain === "market" ? "#a78bfa" : "#64748b"
              }}>
                {subdomain === "p2p" ? "₿ P2P Exchange" : subdomain === "lending" ? "🤝 Community Lending" : subdomain === "market" ? "🛒 Marketplace" : ""}
              </div>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <GlobeLangPicker locale={locale} onSwitchLocale={onSwitchLocale} />
            <button style={M.iconBtn} onClick={() => onProfile(pubkey)} title="My Profile"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></button>
            <button style={M.iconBtn} onClick={() => setSearchOpen(!searchOpen)}><Icons.Search /></button>
            <button style={M.iconBtn} onClick={onRefresh}><Icons.Refresh style={loading ? { animation: "pulse 1s infinite" } : {}} /></button>
          </div>
        </div>

        {/* ── Compact stats row ── */}
        {!searchOpen && listings.length > 0 && (
          <div style={{ display: "flex", gap: 12, padding: "0 0 10px", fontSize: 12, color: "#64748b" }}>
            <span><span style={{ fontWeight: 800, color: subdomain === "p2p" ? "#f59e0b" : subdomain === "lending" ? "#10b981" : "#a78bfa" }}>{filteredListings.filter(l => l.sellerPubkey !== pubkey).length}</span> listings</span>
            {mineCount > 0 && <span><span style={{ fontWeight: 800, color: "#f472b6" }}>{mineCount}</span> mine</span>}
            <span style={{ marginLeft: "auto", color: "#475569" }}>2-of-3 escrow</span>
          </div>
        )}

        {searchOpen && (
          <div style={{ display: "flex", gap: 8, marginBottom: 10, animation: "slideUp 0.2s ease-out" }}>
            <input style={M.input} placeholder={t("mkSearchPlaceholder") || "Search by title, description, or category..."} value={searchQuery} onChange={e => setSearchQuery(e.target.value)} autoFocus />
            {searchQuery && <button style={M.iconBtn} onClick={() => { setSearchQuery(""); onSearch(""); }}><Icons.X /></button>}
          </div>
        )}

        {/* Bill Pay prominent button */}
        {onBillPay && (
          <button onClick={onBillPay} style={{ width: "100%", padding: "12px 0", marginBottom: 10, borderRadius: 10, background: "linear-gradient(135deg, rgba(245,158,11,0.15), rgba(245,158,11,0.05))", border: "1.5px solid rgba(245,158,11,0.3)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
            <span style={{ fontSize: 16 }}>{"🧾"}</span>
            <span style={{ fontSize: 14, fontWeight: 700, color: "#f59e0b" }}>Pay a Bill with Bitcoin</span>
            <span style={{ color: "#f59e0b", fontSize: 14 }}>{"→"}</span>
          </button>
        )}

        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          <button style={{ ...M.primaryBtn, flex: 1, minWidth: 0, justifyContent: "center",
            ...(subdomain === "p2p" ? { background: "linear-gradient(135deg, #f59e0b, #d97706)" } :
                subdomain === "lending" ? { background: "linear-gradient(135deg, #10b981, #059669)" } :
                subdomain === "market" ? { background: "linear-gradient(135deg, #a78bfa, #7c3aed)" } : {})
          }} onClick={onCreate}><Icons.Plus /> {subdomain === "p2p" ? t("mkSellSats") || "Sell Sats" : subdomain === "lending" ? t("mkOfferLoan") || "Offer Loan" : subdomain === "market" ? t("mkListItem") || "List Item" : t("mkSell")}</button>
          <button style={{ ...M.secondaryBtn, flex: 1, minWidth: 0, justifyContent: "center", position: "relative", ...(activeOrderCount > 0 ? { borderColor: "rgba(245,158,11,0.4)", boxShadow: "0 0 12px rgba(245,158,11,0.15)", animation: "pulse 2s infinite" } : {}) }} onClick={onOrders}>
            <Icons.Package /> {t("mkOrders")}
            {activeOrderCount > 0 && (
              <span style={{ position: "absolute", top: -4, right: -4, width: 18, height: 18, borderRadius: "50%", background: "#f59e0b", color: "#0c0f17", fontSize: 10, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center" }}>{activeOrderCount}</span>
            )}
          </button>
        </div>

        {/* ── Category quick-filters ── */}
        <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 10, WebkitOverflowScrolling: "touch", scrollbarWidth: "none" }}>
        {CATEGORIES.filter(c => {
          if (subdomain === "p2p") return c.key === "all" || c.key === "mine" || c.key === "bill-pay";
          if (subdomain === "lending") return c.key === "all" || c.key === "mine" || c.key === "bill-pay";
          if (subdomain === "market") return c.key !== "sats-for-fiat" && c.key !== "lending";
          return true;
        }).map(c => (
          <button
            key={c.key}
            onClick={() => { if (c.key === "bill-pay" && onBillPay) { onBillPay(); } else { setActiveCategory(c.key); } }}
            style={{
              padding: "6px 12px", borderRadius: 20, fontSize: 11, fontWeight: 600,
              whiteSpace: "nowrap", cursor: "pointer", transition: "all 0.2s",
              border: activeCategory === c.key ? "1px solid " + (subdomain === "market" ? "rgba(139,92,246,0.4)" : subdomain === "lending" ? "rgba(16,185,129,0.4)" : "rgba(245,158,11,0.4)") : "1px solid #1e293b",
              background: activeCategory === c.key ? (subdomain === "market" ? "rgba(139,92,246,0.12)" : subdomain === "lending" ? "rgba(16,185,129,0.12)" : "rgba(245,158,11,0.12)") : "#111827",
              color: activeCategory === c.key ? (subdomain === "market" ? "#a78bfa" : subdomain === "lending" ? "#10b981" : "#fbbf24") : "#94a3b8",
            }}
          >
            {c.icon} {({"Public": t("mkPublic"), "Mine": t("mkMine"), "Bill Pay": t("mkBillPay")})[c.label] || c.label}
          </button>
        ))}
        </div>
      </div>


      {/* Payment method filter */}
      {(subdomain !== "escrow") && (
        <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 8, WebkitOverflowScrolling: "touch", scrollbarWidth: "none" }}>
          {filterPayMethod && <button onClick={() => setFilterPayMethod(null)} style={{ padding: "4px 10px", borderRadius: 14, fontSize: 10, fontWeight: 700, cursor: "pointer", border: "1px solid rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.1)", color: "#ef4444" }}>✕ Clear</button>}
          {PAYMENT_METHODS.filter(pm => listings.some(l => (l.paymentMethods || []).includes(pm.key))).map(pm => (
            <button key={pm.key} onClick={() => setFilterPayMethod(filterPayMethod === pm.key ? null : pm.key)} style={{ padding: "4px 10px", borderRadius: 14, fontSize: 10, fontWeight: 600, cursor: "pointer", border: filterPayMethod === pm.key ? "1px solid rgba(245,158,11,0.4)" : "1px solid #1e293b", background: filterPayMethod === pm.key ? "rgba(245,158,11,0.12)" : "#111827", color: filterPayMethod === pm.key ? "#f59e0b" : "#64748b", whiteSpace: "nowrap", flexShrink: 0 }}>{pm.icon} {pm.label}</button>
          ))}
        </div>
      )}

      {/* Currency filter */}
      {(subdomain !== "escrow") && (
        <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 8, WebkitOverflowScrolling: "touch", scrollbarWidth: "none" }}>
          {filterCurrency && <button onClick={() => setFilterCurrency(null)} style={{ padding: "4px 10px", borderRadius: 14, fontSize: 10, fontWeight: 700, cursor: "pointer", border: "1px solid rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.1)", color: "#ef4444" }}>✕ Clear</button>}
          {["USD","EUR","GBP","CFA","KES","TZS","NGN","BRL","INR"].filter(cur => listings.some(l => { const t = l.terms || ""; const m = t.match(/Currency:\s*(\w+)/); return (m ? m[1] : l.fiatCurrency) === cur; })).map(cur => (
            <button key={cur} onClick={() => setFilterCurrency(filterCurrency === cur ? null : cur)} style={{ padding: "4px 10px", borderRadius: 14, fontSize: 10, fontWeight: 600, cursor: "pointer", border: filterCurrency === cur ? "1px solid rgba(59,130,246,0.4)" : "1px solid #1e293b", background: filterCurrency === cur ? "rgba(59,130,246,0.12)" : "#111827", color: filterCurrency === cur ? "#3b82f6" : "#64748b", whiteSpace: "nowrap", flexShrink: 0 }}>{cur}</button>
          ))}
        </div>
      )}
      {/* ══ SCROLLABLE LISTINGS AREA ══ */}
      <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden", WebkitOverflowScrolling: "touch" }}>

      {/* ── ChapSmart banner — market subdomain only ── */}
      {(subdomain === "p2p" && activeCategory !== "bill-pay") && <button onClick={() => onChapSmart && onChapSmart()} style={{
        width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid rgba(59,130,246,0.2)",
        background: "linear-gradient(135deg, rgba(59,130,246,0.08), rgba(245,158,11,0.05))",
        display: "flex", alignItems: "center", gap: 10, cursor: "pointer", marginBottom: 10,
      }}>
        <span style={{ fontSize: 20 }}>🇹🇿</span>
        <div style={{ textAlign: "left" }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#f8fafc" }}><span style={{ color: "#3b82f6" }}>Chap</span><span style={{ color: "#f59e0b" }}>Smart</span> — Bitcoin → M-Pesa</div>
          <div style={{ fontSize: 10, color: "#64748b" }}>Send TZS, buy airtime, or buy sats</div>
        </div>
        <span style={{ marginLeft: "auto", fontSize: 16, color: "#64748b" }}>→</span>
      </button>}

      {/* ── New to Bitcoin / Fedi? ── */}
      <NewToFediBanner _isFediRuntime={_isFediRuntime} />

      {/* ── Browser sandbox banner ── */}
      {isDevMode() && listings.length === 0 && (
        <div style={{
          padding: "20px 18px", marginBottom: 14, borderRadius: 14, textAlign: "center",
          background: "linear-gradient(145deg, #111827, #0f1320)", border: "1px solid #1e293b",
        }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>🧪</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#f8fafc", marginBottom: 8 }}>Sandbox Mode</div>
          <div style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.7, marginBottom: 16 }}>
            You're exploring a demo marketplace. Create test listings, simulate trades, and see how escrow protects both parties.
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
            <button onClick={onCreate} style={{ ...M.primaryBtn, flex: "none", padding: "10px 20px", fontSize: 13 }}>
              <Icons.Plus /> Create a Listing
            </button>
            <a href="https://www.fedi.xyz" target="_blank" rel="noopener noreferrer" style={{
              display: "inline-flex", alignItems: "center", gap: 5, padding: "10px 16px",
              borderRadius: 12, background: "rgba(139,92,246,0.08)", border: "1px solid rgba(139,92,246,0.15)",
              color: "#a78bfa", fontSize: 13, fontWeight: 600, textDecoration: "none",
            }}>
              📲 Get Fedi for real trades
            </a>
          </div>
        </div>
      )}

      {filteredListings.length === 0 && !loading && listings.length > 0 && activeCategory !== "all" ? (
        <div style={M.emptyState}>
          <p style={{ color: "#64748b", fontSize: 14 }}>
            {activeCategory === "mine" ? "You haven't created any listings yet!" : "No listings in this category yet."}
          </p>
          {activeCategory === "mine" ? (
            <button onClick={onCreate} style={{ ...M.primaryBtn, flex: "none", marginTop: 8, padding: "8px 16px", fontSize: 12 }}>
              + Create your first listing
            </button>
          ) : (
            <button onClick={() => setActiveCategory("all")} style={{ ...M.secondaryBtn, flex: "none", marginTop: 8, padding: "8px 16px", fontSize: 12 }}>
              Show all listings
            </button>
          )}
        </div>
      ) : filteredListings.length === 0 ? (
        <div style={M.emptyState}>
          <Icons.Tag style={{ color: "#475569" }} />
          <p style={{ color: "#64748b", marginTop: 12, fontSize: 14 }}>
            {loading ? t("mkLoading") : searchQuery ? t("mkNoResults") : t("mkNoListings")}
          </p>
        </div>
      ) : loading && filteredListings.length === 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingBottom: 20 }}>
          {[1,2,3,4].map(i => (
            <div key={i} style={{ ...M.listingCard, pointerEvents: "none", animation: "pulse 1.5s ease-in-out infinite" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ width: "60%", height: 16, borderRadius: 6, background: "#1e293b" }} />
                <div style={{ width: 60, height: 16, borderRadius: 6, background: "#1e293b" }} />
              </div>
              <div style={{ width: "85%", height: 12, borderRadius: 4, background: "#1e293b", marginTop: 8 }} />
              <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
                <div style={{ width: 50, height: 18, borderRadius: 6, background: "#1e293b" }} />
                <div style={{ width: 70, height: 18, borderRadius: 6, background: "#1e293b" }} />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingBottom: 20 }}>
          {filteredListings.map(l =>
            l.federationOnly && !revealedVIP[l.id] && l.sellerPubkey !== pubkey ? (
              <button key={l.id} style={{ ...M.listingCard, position: "relative", overflow: "hidden", minHeight: 80, maxHeight: 100, borderColor: "rgba(139,92,246,0.3)", background: "linear-gradient(145deg, rgba(139,92,246,0.06), rgba(139,92,246,0.02))" }} onClick={() => probeAndReveal(l)}>
                <div style={{ filter: "blur(6px)", pointerEvents: "none" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={M.cardTitle}>{"●●●●●●"}</span>
                    <span style={M.cardPrice}><span style={{ color: "#a78bfa" }}>₿</span> ●●●</span>
                  </div>
                  <p style={M.cardDesc}>{"●●●●●● ●●●●● ●●●●●●●● ●●●●"}</p>
                </div>
                <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "rgba(15,20,32,0.6)", backdropFilter: "blur(2px)", borderRadius: 12 }}>
                  <div style={{ fontSize: 20, marginBottom: 6 }}>{probingVIP === l.id ? "⏳" : "🔒"}</div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#a78bfa", marginBottom: 2 }}>Federation VIP</div>
                  <div style={{ fontSize: 9, color: "#94a3b8" }}>{probingVIP === l.id ? "Verifying membership..." : "Tap to verify membership"}</div>
                  {(() => { const fi = getFedInfo(l.sellerFedPrefix, l.sellerFedDomain); return fi ? <div style={{ marginTop: 6, padding: "3px 10px", borderRadius: 6, fontSize: 10, fontWeight: 700, background: fi.color + "18", color: fi.color }}>{fi.emoji} {fi.name}</div> : null; })()}
                </div>
              </button>
            ) : (
            <button key={l.id} style={{ ...M.listingCard, ...(isBillPay(l.category) && l.quantity > 0 ? { borderColor: "rgba(245,158,11,0.4)", boxShadow: "0 0 14px rgba(245,158,11,0.12)" } : {}), ...(l.status === "paused" ? { opacity: 0.55, borderColor: "#334155" } : l.quantity <= 0 ? { opacity: 0.45, borderColor: "#334155" } : {}), ...(l.federationOnly && revealedVIP[l.id] ? { borderColor: "rgba(139,92,246,0.4)", boxShadow: "0 0 12px rgba(139,92,246,0.1)", animation: "vipReveal 0.5s ease-out" } : {}) }} onClick={() => l.federationOnly && revealedVIP[l.id] ? onOpen(l.id) : onOpen(l.id)}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={M.cardTitle}>{l.title}</span>
		<span style={M.cardPrice}>
                  <span style={{ color: "#f7931a", fontWeight: 800 }}>₿</span>
                  {l.minPriceSats && l.maxPriceSats && l.minPriceSats !== l.maxPriceSats
                    ? <>{fmtSatsShort(l.minPriceMsats)}<span style={{ color: "#475569", fontWeight: 400 }}>{" — "}</span>{fmtSatsShort(l.maxPriceMsats)}</>
                    : (() => {
                      if (isBillPay(l.category) && fiatRates && fiatRates.btcUsd) {
                        const fm = (l.terms || "").match(/Fiat needed:\s*(\w+)\s+([\d.]+)/);
                        const rm = (l.terms || "").match(/Rate:\s*(\d+)/);
                        if (fm) {
                          const fx = fiatRates.rates[fm[1]] || 1;
                          const usd = parseFloat(fm[2]) / fx;
                          const base = Math.floor((usd / fiatRates.btcUsd) * 100000000);
                          const prem = rm ? parseInt(rm[1]) : 0;
                          return Math.floor(base * (1 + prem / 100)).toLocaleString();
                        }
                      }
                      return fmtSats(l.priceMsats);
                    })()}
                </span>
              </div>
              {/* Single-line badges: premium + currency + description */}
              <div style={{ display: "flex", gap: 4, alignItems: "center", flexWrap: "nowrap", overflowX: "auto", overflowY: "hidden", marginBottom: 2, scrollbarWidth: "none", WebkitOverflowScrolling: "touch", msOverflowStyle: "none" }}>
                {(() => { const rm = (l.terms || "").match(/Rate:\s*(\d+)/); return rm ? <span style={{ padding: "2px 6px", borderRadius: 4, fontSize: 9, fontWeight: 700, background: "rgba(16,185,129,0.1)", color: "#10b981", flexShrink: 0 }}>📈 {rm[1]}%</span> : null; })()}
                {(() => { const cm = (l.terms || "").match(/Currency:\s*(\w+)/); return cm ? <span style={{ padding: "2px 6px", borderRadius: 4, fontSize: 9, fontWeight: 700, background: "rgba(245,158,11,0.1)", color: "#f59e0b", flexShrink: 0 }}>{cm[1]}</span> : null; })()}
                {l.paymentMethods && l.paymentMethods.length > 0 && l.paymentMethods.slice(0, 3).map(pm => { const m = PAYMENT_METHODS.find(p => p.key === pm); return m ? <span key={pm} style={{ padding: "2px 5px", borderRadius: 4, fontSize: 8, fontWeight: 600, background: "rgba(16,185,129,0.08)", color: "#10b981", flexShrink: 0, whiteSpace: "nowrap" }}>{m.icon}{m.label}</span> : null; })}
                {l.paymentMethods && l.paymentMethods.length > 3 && <span style={{ fontSize: 8, color: "#475569", flexShrink: 0 }}>+{l.paymentMethods.length - 3}</span>}
              </div>
              {l.description && <p style={M.cardDesc}>{l.description}</p>}
              <div style={M.cardMeta}>
              {isLending(l.category) && l.terms && (() => {
                const interestMatch = l.terms.match(/Interest:\s*(\d+)/);
                const repayMatch = l.terms.match(/Repayment:\s*(\d+\s*days?)/i);
                const interest = interestMatch ? interestMatch[1] : null;
                const repay = repayMatch ? repayMatch[1] : null;
                if (!interest && !repay) return null;
                return (
                  <div style={{ display: "flex", gap: 6, marginTop: 4, flexWrap: "wrap", alignItems: "center" }}>
                    {interest && <span style={{ padding: "2px 8px", borderRadius: 6, fontSize: 10, fontWeight: 700, background: "rgba(16,185,129,0.12)", color: "#10b981" }}>{interest}% interest</span>}
                    {repay && <span style={{ padding: "2px 8px", borderRadius: 6, fontSize: 10, fontWeight: 700, background: "rgba(59,130,246,0.12)", color: "#3b82f6" }}>{repay}</span>}
                    {interest && l.priceMsats && <span style={{ padding: "2px 8px", borderRadius: 6, fontSize: 10, fontWeight: 700, background: "rgba(245,158,11,0.12)", color: "#f59e0b" }}>Repay: ₿ {Math.ceil(Math.floor(l.priceMsats / 1000) * (1 + parseInt(interest) / 100)).toLocaleString()}</span>}
                  </div>
                );
              })()}
                <div style={{ display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
                  {l.status === "paused" && <span style={{ padding: "2px 8px", borderRadius: 6, fontSize: 10, fontWeight: 700, background: "rgba(100,116,139,0.2)", color: "#94a3b8", border: "1px solid #334155" }}>⏸ {t("mkStatusPaused")}</span>}
                  {l.condition && !isSatsForFiat(l.category) && !isLending(l.category) && !isBillPay(l.category) && l.status !== "paused" && <span style={M.conditionBadge}>{t(CONDITION_KEYS[l.condition] || l.condition)}</span>}
                  {l.category && !(subdomain === "p2p" && isSatsForFiat(l.category)) && !(subdomain === "lending" && isLending(l.category)) && <span style={{
                    ...M.categoryBadge,
                    ...(isSatsForFiat(l.category) ? { background: "rgba(245,158,11,0.15)", color: "#f59e0b", fontWeight: 700 } : isLending(l.category) ? { background: "rgba(16,185,129,0.15)", color: "#10b981", fontWeight: 700 } : isBillPay(l.category) ? { background: "rgba(245,158,11,0.15)", color: "#f59e0b", fontWeight: 700 } : {}),
                  }}>{isSatsForFiat(l.category) ? "₿ P2P Trade" : isLending(l.category) ? "🤝 Lending" : isBillPay(l.category) ? "🧾 Bill Pay" : l.category}</span>}
                  {(() => { const fi = getFedInfo(l.sellerFedPrefix, l.sellerFedDomain); return fi ? <span style={{ padding: "3px 10px", borderRadius: 6, fontSize: 10, fontWeight: 700, background: fi.color + "18", color: fi.color, border: "1px solid " + fi.color + "30", display: "inline-flex", alignItems: "center", gap: 3 }}>{fi.emoji} {fi.name}</span> : null; })()}
                  {l.federationOnly && <span style={{ padding: "3px 10px", borderRadius: 6, fontSize: 10, fontWeight: 700, background: "rgba(139,92,246,0.15)", color: "#a78bfa", border: "1px solid rgba(139,92,246,0.3)", display: "inline-flex", alignItems: "center", gap: 3 }}>🔒 Members</span>}
                  
                </div>
                <span style={{ fontSize: 12, fontWeight: 600, ...(l.status === "paused" ? { color: "#64748b" } : l.quantity > 1 ? { color: "#10b981" } : l.quantity === 1 ? { color: "#f59e0b", animation: "pulse 2s ease infinite" } : { color: "#ef4444" }) }}>
                  {l.status === "paused" ? "⏸ Paused" : l.quantity > 1 ? `🟢 ${t("mkQtyAvailable", { qty: l.quantity })}` : l.quantity === 1 ? `🔥 ${t("mkQtyOneLeft")}` : `❌ ${t("mkQtySoldOut")}`}
                </span>
              </div>

            </button>
            )
          )}
        </div>
      )}

      </div>{/* end scrollable */}

      {/* ── Floating Help Button ── */}
      {helpOpen && <div onClick={() => setHelpOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 998 }} />}
      {helpOpen && (
        <div style={{ position: "fixed", bottom: 130, right: 16, zIndex: 999, display: "flex", flexDirection: "column", gap: 8, animation: "slideUp 0.2s ease-out" }}>
          <button onClick={() => { setHelpOpen(false); onFaq(); }} style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 16px", borderRadius: 12, background: "#111827", border: "1px solid rgba(59,130,246,0.3)", color: "#3b82f6", fontSize: 13, fontWeight: 700, cursor: "pointer", boxShadow: "0 4px 20px rgba(0,0,0,0.3)" }}>{t("mkFaqHow") || "❓ FAQ — How it works"}</button>
          <button onClick={() => { setHelpOpen(false); onArbiters(); }} style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 16px", borderRadius: 12, background: "#111827", border: "1px solid rgba(245,158,11,0.3)", color: "#f59e0b", fontSize: 13, fontWeight: 700, cursor: "pointer", boxShadow: "0 4px 20px rgba(0,0,0,0.3)" }}>{t("mkBecomeArbiter") || "⚖️ Become an Arbiter"}</button>
          <a href="fedi:room:!kENaQZKCKhRhawCjxf:m1.8fa.in:::" style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 16px", borderRadius: 12, background: "#111827", border: "1px solid rgba(139,92,246,0.3)", color: "#a78bfa", fontSize: 13, fontWeight: 700, cursor: "pointer", boxShadow: "0 4px 20px rgba(0,0,0,0.3)", textDecoration: "none" }}>💬 Support (EN)</a>
          <a href="fedi:room:!qHlVxBJBCKqUbetBnA:m1.8fa.in:::" style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 16px", borderRadius: 12, background: "#111827", border: "1px solid rgba(139,92,246,0.3)", color: "#a78bfa", fontSize: 13, fontWeight: 700, cursor: "pointer", boxShadow: "0 4px 20px rgba(0,0,0,0.3)", textDecoration: "none" }}>💬 Support (FR)</a>
        </div>
      )}
      <button onClick={() => setHelpOpen(!helpOpen)} style={{ position: "fixed", bottom: 100, right: 16, zIndex: 999, width: 48, height: 48, borderRadius: "50%", background: helpOpen ? "#ef4444" : "linear-gradient(135deg, #f59e0b, #d97706)", border: "none", color: helpOpen ? "#fff" : "#0c0f17", fontSize: 20, fontWeight: 800, cursor: "pointer", boxShadow: "0 4px 24px rgba(245,158,11,0.3)", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.2s" }}>{helpOpen ? "✕" : "?"}</button>
      {/* ── Genesis footer — pinned at bottom ── */}
      {/* ── Genesis footer — pinned at bottom ── */}
      <div style={{
        flexShrink: 0, padding: "8px 16px", textAlign: "center",
        background: "#0c0f17",
        borderTop: "1px solid #1e293b20",
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
          <span style={{ fontSize: 10 }}>⚡</span>
          <span style={{ fontSize: 9, fontWeight: 700, color: "#475569", letterSpacing: 1.2 }}>EST. BLOCK 934,669</span>
          <span style={{ fontSize: 10 }}>🥜</span>
          <span style={{ color: "#1e293b" }}>·</span>
          <a href="https://github.com/jesuspirate/federated-escrow" target="_blank" rel="noopener noreferrer" style={{ fontSize: 9, color: "#6d28d9", textDecoration: "none", fontWeight: 600 }}>GitHub ↗</a>
        </div>
      </div>
    </div>
  );
}

