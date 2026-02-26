import { useState, useEffect, useCallback, useRef } from "react";
import { t, getLocale, getAvailableLocales, setLocale } from "./i18n";

// ═══════════════════════════════════════════════════════════════════════
// Marketplace UI — Browse, Buy, Manage Orders
// i18n via shared i18n.js • NIP-98 Nostr auth • Fedi + browser sandbox
// ═══════════════════════════════════════════════════════════════════════

const MAPI = "/api/marketplace/listings";

// ── Auth ─────────────────────────────────────────────────────────────

const DEV_IDENTITIES = {
  seller:  "aa".repeat(32),
  buyer:   "bb".repeat(32),
  arbiter: "cc".repeat(32),
};

function _detectFediApp() {
  if (typeof window === "undefined") return false;
  if (!window.webln) return false;
  const ua = navigator.userAgent || "";
  const isAndroidWebView = /Android/.test(ua) && /wv\)/.test(ua);
  const isIOSWebView = /iPhone|iPad|iPod/.test(ua) && !/Safari\//.test(ua);
  const isDesktop = !/Android|iPhone|iPad|iPod|Mobile/.test(ua);
  if (isDesktop) return false;
  if (isAndroidWebView || isIOSWebView) return true;
  return false;
}

const _isFediApp = _detectFediApp();
const _forceDevMode = typeof location !== "undefined"
  && (!_isFediApp || new URLSearchParams(location.search).has("dev"));

let _devPubkey = null;

function isDevMode() { return !!_devPubkey || _forceDevMode; }

class NostrRejectedError extends Error {
  constructor(action) { super(`Nostr permission denied — ${action}`); this.name = "NostrRejectedError"; }
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("Auth timeout")), ms)),
  ]);
}

async function makeNip98Header(url, method) {
  if (_devPubkey || _forceDevMode) return null;
  if (!window.nostr) return null;
  const event = {
    kind: 27235,
    created_at: Math.floor(Date.now() / 1000),
    tags: [["u", url], ["method", method]],
    content: "",
  };
  try {
    const signed = await withTimeout(window.nostr.signEvent(event), 8000);
    return "Nostr " + btoa(JSON.stringify(signed));
  } catch (err) {
    if (err.message === "Auth timeout") {
      console.warn("[marketplace-ui] NIP-98 sign timeout");
      return null; // proceed without auth — server will 401 if needed
    }
    throw new NostrRejectedError("please approve the signing request to continue");
  }
}

async function mapi(path, opts = {}, _retries = 1) {
  const method = opts.method || "GET";
  const url = `${location.origin}${MAPI}${path}`;
  const headers = { "Content-Type": "application/json" };

  // Public GET routes (browse, detail) don't need auth.
  const needsAuth = method !== "GET" || path.includes("/orders");

  if (needsAuth) {
    try {
      const nip98 = await makeNip98Header(url, method);
      if (nip98) headers["Authorization"] = nip98;
      else if (_devPubkey) headers["X-Dev-Pubkey"] = _devPubkey;
    } catch (err) {
      if (err.name === "NostrRejectedError" && _retries > 0) return mapi(path, opts, _retries - 1);
      throw err;
    }
  } else if (_devPubkey) {
    headers["X-Dev-Pubkey"] = _devPubkey;
  }

  let res;
  try {
    res = await fetch(url, { ...opts, headers });
  } catch (err) {
    throw new Error(t("mkNetworkError"));
  }
  if ((res.status === 401 || res.status === 403) && _retries > 0) return mapi(path, opts, _retries - 1);
  if (res.status === 401 || res.status === 403) throw new Error(t("mkAuthRequired"));
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { error: text || `HTTP ${res.status}` }; }
}

// ── Helpers ──────────────────────────────────────────────────────────

function fmtSats(msats) { return Math.floor(msats / 1000).toLocaleString(); }
function truncPk(hex) {
  if (!hex || hex.length < 16) return hex || "";
  return hex.slice(0, 8) + "\u2026" + hex.slice(-8);
}

// ── Trade Type Detection ────────────────────────────────────────────
const SATS_FOR_FIAT = "sats-for-fiat";
function isSatsForFiat(category) { return category?.toLowerCase().trim() === SATS_FOR_FIAT; }

// ── Nostr Profile Lookup (client-side, no server relay needed) ────────

const _nostrProfileCache = new Map(); // pubkey → { name, picture, about, nip05, fetched }
const NOSTR_RELAYS = ["wss://relay.damus.io", "wss://nos.lol", "wss://relay.nostr.band"];

async function fetchNostrProfile(pubkey) {
  if (_nostrProfileCache.has(pubkey)) return _nostrProfileCache.get(pubkey);

  // Mark as fetching to avoid duplicate requests
  const placeholder = { name: null, picture: null, about: null, nip05: null, fetched: false };
  _nostrProfileCache.set(pubkey, placeholder);

  return new Promise((resolve) => {
    let resolved = false;
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        placeholder.fetched = true;
        resolve(placeholder);
      }
    }, 4000);

    // Try first relay that responds
    for (const relay of NOSTR_RELAYS) {
      try {
        const ws = new WebSocket(relay);
        const subId = "p_" + pubkey.slice(0, 8);

        ws.onopen = () => {
          ws.send(JSON.stringify(["REQ", subId, { kinds: [0], authors: [pubkey], limit: 1 }]));
        };

        ws.onmessage = (e) => {
          try {
            const msg = JSON.parse(e.data);
            if (msg[0] === "EVENT" && msg[2]?.kind === 0) {
              const meta = JSON.parse(msg[2].content);
              const profile = {
                name: meta.name || meta.display_name || null,
                picture: meta.picture || null,
                about: meta.about || null,
                nip05: meta.nip05 || null,
                fetched: true,
              };
              _nostrProfileCache.set(pubkey, profile);
              if (!resolved) { resolved = true; clearTimeout(timeout); resolve(profile); }
            }
            if (msg[0] === "EOSE") {
              ws.close();
              if (!resolved) {
                resolved = true;
                clearTimeout(timeout);
                placeholder.fetched = true;
                resolve(placeholder);
              }
            }
          } catch {}
        };

        ws.onerror = () => ws.close();
        // Only try first relay, move to next on failure
        ws.onclose = () => {};
        break; // only connect to first relay
      } catch {}
    }
  });
}

// Hook: useNostrProfile — returns { name, picture, about, loading }
function useNostrProfile(pubkey) {
  const [profile, setProfile] = useState(() => _nostrProfileCache.get(pubkey) || null);

  useEffect(() => {
    if (!pubkey || pubkey.length !== 64) return;
    let cancelled = false;
    fetchNostrProfile(pubkey).then(p => { if (!cancelled) setProfile(p); });
    return () => { cancelled = true; };
  }, [pubkey]);

  return {
    name: profile?.name || null,
    picture: profile?.picture || null,
    about: profile?.about || null,
    nip05: profile?.nip05 || null,
    loading: !profile?.fetched,
  };
}

// ── SellerName component — tappable, shows Nostr name or truncated pk ──

function SellerName({ pubkey, onTap, style }) {
  const { name, loading } = useNostrProfile(pubkey);
  const displayName = name || truncPk(pubkey);
  return (
    <span
      onClick={onTap ? (e) => { e.stopPropagation(); onTap(pubkey); } : undefined}
      style={{
        fontFamily: name ? "inherit" : "monospace",
        fontSize: name ? 13 : 12,
        color: onTap ? "#a78bfa" : "#cbd5e1",
        cursor: onTap ? "pointer" : "default",
        textDecoration: onTap ? "underline" : "none",
        textDecorationColor: "rgba(167,139,250,0.3)",
        ...style,
      }}
    >
      {loading ? "…" : displayName}
    </span>
  );
}

// ── StarRating — display or input ──

function StarRating({ score, onChange, size = 18 }) {
  const stars = [1, 2, 3, 4, 5];
  return (
    <span style={{ display: "inline-flex", gap: 2 }}>
      {stars.map(s => (
        <span
          key={s}
          onClick={onChange ? () => onChange(s) : undefined}
          style={{
            cursor: onChange ? "pointer" : "default",
            fontSize: size,
            color: s <= score ? "#f59e0b" : "#334155",
            transition: "color 0.15s",
          }}
        >★</span>
      ))}
    </span>
  );
}

// ── Icons ────────────────────────────────────────────────────────────

const Icons = {
  Back: (p) => <svg {...p} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>,
  Search: (p) => <svg {...p} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>,
  Plus: (p) => <svg {...p} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>,
  Tag: (p) => <svg {...p} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>,
  Package: (p) => <svg {...p} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="16.5" y1="9.4" x2="7.5" y2="4.21"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>,
  Refresh: (p) => <svg {...p} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>,
  X: (p) => <svg {...p} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
  Clock: (p) => <svg {...p} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
};

// ── Status Badge ─────────────────────────────────────────────────────

const ORDER_STATUS_KEYS = {
  pending:   { color: "#8b5cf6", bg: "rgba(139,92,246,0.12)", key: "mkOrderPending" },
  active:    { color: "#f59e0b", bg: "rgba(245,158,11,0.12)", key: "mkOrderActive" },
  completed: { color: "#10b981", bg: "rgba(16,185,129,0.12)", key: "mkOrderCompleted" },
  expired:   { color: "#ef4444", bg: "rgba(239,68,68,0.12)", key: "mkOrderExpired" },
  cancelled: { color: "#64748b", bg: "rgba(100,116,139,0.12)", key: "mkOrderCancelled" },
};

const CONDITION_KEYS = { new: "mkCondNew", used: "mkCondUsed", digital: "mkCondDigital", service: "mkCondService" };

function OrderBadge({ status }) {
  const c = ORDER_STATUS_KEYS[status] || ORDER_STATUS_KEYS.pending;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 10px", borderRadius: 99, fontSize: 11, fontWeight: 700, color: c.color, background: c.bg, letterSpacing: 0.3 }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: c.color }} />
      {t(c.key)}
    </span>
  );
}

// ── Toast ────────────────────────────────────────────────────────────

function Toast({ msg, type, visible }) {
  if (!visible) return null;
  return (
    <div style={{ position: "fixed", bottom: 90, left: 16, right: 16, padding: "12px 16px", borderRadius: 12, background: type === "error" ? "#7f1d1d" : "#064e3b", color: "#fff", fontSize: 13, fontWeight: 500, zIndex: 1000, textAlign: "center", animation: "slideUp 0.25s ease-out", boxShadow: "0 8px 32px rgba(0,0,0,0.4)" }}>
      {msg}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// MAIN MARKETPLACE COMPONENT
// Per-view loading states prevent cross-contamination between views.
// ═══════════════════════════════════════════════════════════════════════

export default function Marketplace({ pubkey, devRole, onSwitchToEscrow }) {
  const [onboarded, setOnboarded] = useState(() => {
    try { return localStorage.getItem(MK_ONBOARDING_KEY) === "1"; } catch { return false; }
  });
  const [view, setView] = useState("browse");
  const [listings, setListings] = useState([]);
  const [selected, setSelected] = useState(null);
  const [orders, setOrders] = useState([]);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [profilePubkey, setProfilePubkey] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [toast, setToast] = useState({ msg: "", type: "ok", visible: false });
  const [locale, setLocaleState] = useState(getLocale);
  const toastTimer = useRef(null);

  useEffect(() => {
    if (devRole && isDevMode()) _devPubkey = DEV_IDENTITIES[devRole];
  }, [devRole]);

  const showToast = useCallback((msg, type = "ok") => {
    clearTimeout(toastTimer.current);
    setToast({ msg, type, visible: true });
    toastTimer.current = setTimeout(() => setToast(prev => ({ ...prev, visible: false })), 3000);
  }, []);

  const switchLocale = useCallback((code) => {
    setLocale(code);
    setLocaleState(code);
  }, []);

  // ── Data loading (isolated loading states) ──────────────────────

  const loadListings = useCallback(async (query) => {
    setBrowseLoading(true);
    try {
      const path = query ? `/?q=${encodeURIComponent(query)}` : "/";
      const data = await mapi(path);
      if (data.error) throw new Error(data.error);
      setListings(data.listings || []);
    } catch (err) {
      console.error("[marketplace-ui] loadListings:", err);
      setListings([]);
    }
    setBrowseLoading(false);
  }, []);

  const loadOrders = useCallback(async () => {
    setOrdersLoading(true);
    try {
      // Fetch independently — if one fails, still show the other
      let buyerOrders = [], sellerOrders = [];
      try { const b = await mapi("/orders/mine?role=buyer"); buyerOrders = b.orders || []; } catch (e) { console.warn("[marketplace-ui] buyer orders:", e.message); }
      try { const s = await mapi("/orders/mine?role=seller"); sellerOrders = s.orders || []; } catch (e) { console.warn("[marketplace-ui] seller orders:", e.message); }
      const all = [...buyerOrders, ...sellerOrders];
      const seen = new Set();
      const unique = all.filter(o => { if (seen.has(o.id)) return false; seen.add(o.id); return true; });
      unique.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      setOrders(unique);
    } catch (err) {
      console.error("[marketplace-ui] loadOrders:", err);
    }
    setOrdersLoading(false);
  }, []);

  // Re-load listings every time we switch TO browse view
  useEffect(() => {
    if (view === "browse") loadListings(searchQuery);
  }, [view]);

  const openListing = async (id) => {
    setView("detail");
    setSelected(null);
    setActionLoading(true);
    try {
      const data = await mapi(`/${id}`);
      if (data.error) throw new Error(data.error);
      setSelected(data);
    } catch (err) { showToast(err.message, "error"); }
    setActionLoading(false);
  };

  const openOrders = () => { setView("orders"); loadOrders(); };

  const openProfile = (pk) => {
    setProfilePubkey(pk);
    setView("profile");
  };

  // ── Onboarding gate ─────────────────────────────────────────────
  if (!onboarded) return <MarketplaceOnboarding onComplete={() => setOnboarded(true)} />;

  return (
    <div style={M.root}>
      <style>{`
        @keyframes slideUp { from { transform: translateY(16px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
      <Toast {...toast} />

      {view === "browse" && (
        <BrowseView
          listings={listings} loading={browseLoading} pubkey={pubkey}
          searchQuery={searchQuery} setSearchQuery={setSearchQuery}
          onSearch={(q) => { setSearchQuery(q); loadListings(q); }}
          onOpen={openListing}
          onCreate={() => setView("create")}
          onOrders={openOrders}
          onRefresh={() => loadListings(searchQuery)}
          onSwitchToEscrow={onSwitchToEscrow}
          onProfile={openProfile}
          locale={locale} onSwitchLocale={switchLocale}
        />
      )}
      {view === "detail" && selected && (
        <ListingDetail
          listing={selected} pubkey={pubkey}
          onBack={() => { setSelected(null); setView("browse"); }}
          onProfile={openProfile}
          showToast={showToast} loading={actionLoading} setLoading={setActionLoading}
        />
      )}
      {view === "detail" && !selected && (
        <div style={{ display: "flex", justifyContent: "center", paddingTop: "30vh" }}>
          <div style={{ width: 20, height: 20, border: "2px solid #1e293b", borderTopColor: "#475569", borderRadius: "50%", animation: "spin 0.6s linear infinite" }} />
        </div>
      )}
      {view === "create" && (
        <CreateListingView
          pubkey={pubkey}
          onBack={() => setView("browse")}
          onCreated={(id) => { openListing(id); }}
          showToast={showToast} loading={actionLoading} setLoading={setActionLoading}
        />
      )}
      {view === "orders" && (
        <OrdersView
          orders={orders} loading={ordersLoading} pubkey={pubkey}
          onBack={() => setView("browse")}
          onRefresh={loadOrders}
          onOpenOrder={(order) => { setSelected(order); setView("orderDetail"); }}
          onProfile={openProfile}
        />
      )}
      {view === "orderDetail" && selected && (
        <OrderDetailView
          order={selected} pubkey={pubkey}
          onBack={() => { setSelected(null); openOrders(); }}
          onProfile={openProfile}
          onSwitchToEscrow={onSwitchToEscrow}
          showToast={showToast} loading={actionLoading} setLoading={setActionLoading}
        />
      )}
      {view === "profile" && profilePubkey && (
        <SellerProfileView
          pubkey={profilePubkey} myPubkey={pubkey}
          onBack={() => { setProfilePubkey(null); setView("browse"); }}
          onOpen={openListing}
          showToast={showToast}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// MARKETPLACE ONBOARDING — First-time welcome + how it works
// ═══════════════════════════════════════════════════════════════════════

const MK_ONBOARDING_KEY = "fedi-marketplace-onboarded";

function MarketplaceOnboarding({ onComplete }) {
  const [step, setStep] = useState(0);
  const isBrowser = isDevMode();

  const steps = [
    {
      icon: "🏪",
      title: "Welcome to the Market",
      desc: isBrowser
        ? "A Bitcoin-native marketplace powered by federated e-cash. Browse, buy, and sell — all secured by escrow."
        : "Buy and sell anything with your community. Every trade is protected by 2-of-3 escrow — no trust needed.",
    },
    {
      icon: "🔒",
      title: "Escrow Protects You",
      desc: "When you buy, sats are locked in escrow. When you sell, you don't ship until payment is locked. If there's a dispute, the community arbiter resolves it.",
    },
    {
      icon: "⚡",
      title: isBrowser ? "Try it in Sandbox" : "Start Trading",
      desc: isBrowser
        ? "This is a demo — explore listings, create test trades, and see how escrow works. For real trades, use the Fedi app."
        : "List something for sale, browse what's available, or start a P2P sats-for-fiat trade. Welcome to the community economy.",
    },
  ];

  const s = steps[step];
  const isLast = step === steps.length - 1;

  const handleNext = () => {
    if (isLast) { try { localStorage.setItem(MK_ONBOARDING_KEY, "1"); } catch {} onComplete(); }
    else setStep(step + 1);
  };

  return (
    <div style={{ ...M.root, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", padding: "40px 24px", textAlign: "center", minHeight: "100vh" }}>
      <style>{`@keyframes obFadeUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }`}</style>

      {isBrowser && (
        <div style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 14px", borderRadius: 99, background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.2)", marginBottom: 24 }}>
          <span style={{ fontSize: 12 }}>🧪</span>
          <span style={{ fontSize: 11, fontWeight: 700, color: "#f59e0b", letterSpacing: 0.5 }}>SANDBOX MODE</span>
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginBottom: 48 }}>
        {steps.map((_, i) => (
          <div key={i} style={{ width: i === step ? 24 : 8, height: 8, borderRadius: 4, background: i <= step ? "#f59e0b" : "#1e293b", transition: "all 0.3s ease" }} />
        ))}
      </div>

      <div key={step} style={{ fontSize: 56, marginBottom: 24, animation: "obFadeUp 0.4s ease-out" }}>{s.icon}</div>

      <div key={`t-${step}`} style={{ animation: "obFadeUp 0.4s ease-out 0.1s both", maxWidth: 320 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "#f8fafc", margin: "0 0 12px", letterSpacing: -0.5 }}>{s.title}</h1>
        <p style={{ fontSize: 14, color: "#94a3b8", lineHeight: 1.7, margin: 0 }}>{s.desc}</p>
      </div>

      <div style={{ marginTop: 48, width: "100%", maxWidth: 320 }}>
        <button onClick={handleNext} style={{ width: "100%", padding: "14px 0", borderRadius: 12, background: isLast ? "#f59e0b" : "transparent", border: isLast ? "none" : "1.5px solid #334155", color: isLast ? "#0c0f17" : "#f8fafc", fontSize: 15, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
          {isLast ? (isBrowser ? "🧪 Explore Demo" : "🏪 Enter Market") : "Next →"}
        </button>
        {!isLast && (
          <button onClick={() => { try { localStorage.setItem(MK_ONBOARDING_KEY, "1"); } catch {} onComplete(); }}
            style={{ width: "100%", padding: "12px 0", marginTop: 8, background: "transparent", border: "none", color: "#475569", fontSize: 13, cursor: "pointer" }}>
            Skip
          </button>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// CATEGORY QUICK-FILTERS
// ═══════════════════════════════════════════════════════════════════════

const CATEGORIES = [
  { key: "all", label: "All", icon: "🏪" },
  { key: "sats-for-fiat", label: "₿ P2P", icon: "₿" },
  { key: "electronics", label: "Electronics", icon: "📱" },
  { key: "services", label: "Services", icon: "🛠️" },
  { key: "digital", label: "Digital", icon: "💾" },
  { key: "clothing", label: "Clothing", icon: "👕" },
  { key: "other", label: "Other", icon: "📦" },
];

// ═══════════════════════════════════════════════════════════════════════
// BROWSE VIEW — Community homepage with hero + categories
// ═══════════════════════════════════════════════════════════════════════

function BrowseView({ listings, loading, pubkey, searchQuery, setSearchQuery, onSearch, onOpen, onCreate, onOrders, onRefresh, onSwitchToEscrow, onProfile, locale, onSwitchLocale }) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [activeCategory, setActiveCategory] = useState("all");

  const filteredListings = activeCategory === "all"
    ? listings
    : listings.filter(l => {
        if (activeCategory === "sats-for-fiat") return isSatsForFiat(l.category);
        return l.category?.toLowerCase() === activeCategory;
      });

  return (
    <div style={M.container}>
      <div style={M.header}>
        <div>
          <h1 style={M.title}>🏪 {t("mkTitle")}</h1>
          <p style={M.subtitle}>{t("mkListingCount", { count: listings.length })}</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{ display: "flex", gap: 2 }}>
            {getAvailableLocales().map(l => (
              <button key={l.code} onClick={() => onSwitchLocale(l.code)} style={{ padding: "4px 6px", borderRadius: 6, background: locale === l.code ? "#1e293b" : "transparent", color: locale === l.code ? "#f8fafc" : "#475569", fontSize: 14, border: locale === l.code ? "1px solid #334155" : "1px solid transparent", cursor: "pointer", lineHeight: 1 }}>{l.flag}</button>
            ))}
          </div>
          <button style={M.iconBtn} onClick={() => setSearchOpen(!searchOpen)}><Icons.Search /></button>
          <button style={M.iconBtn} onClick={onRefresh}><Icons.Refresh style={loading ? { animation: "pulse 1s infinite" } : {}} /></button>
        </div>
      </div>

      {/* ── Hero banner — community vibe ── */}
      {!searchOpen && listings.length > 0 && (
        <div style={{
          padding: "16px 18px", marginBottom: 14, borderRadius: 14,
          background: "linear-gradient(135deg, rgba(245,158,11,0.08), rgba(139,92,246,0.06))",
          border: "1px solid rgba(245,158,11,0.12)",
        }}>
          <div style={{ display: "flex", justifyContent: "space-around", textAlign: "center" }}>
            <div>
              <div style={{ fontSize: 22, fontWeight: 900, color: "#f59e0b" }}>{listings.length}</div>
              <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 2 }}>Listings</div>
            </div>
            <div style={{ width: 1, background: "#1e293b" }} />
            <div>
              <div style={{ fontSize: 22, fontWeight: 900, color: "#a78bfa" }}>{listings.filter(l => isSatsForFiat(l.category)).length}</div>
              <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 2 }}>P2P Trades</div>
            </div>
            <div style={{ width: 1, background: "#1e293b" }} />
            <div>
              <div style={{ fontSize: 22, fontWeight: 900, color: "#10b981" }}>2-of-3</div>
              <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 2 }}>Escrow</div>
            </div>
          </div>
        </div>
      )}

      {searchOpen && (
        <div style={{ display: "flex", gap: 8, marginBottom: 12, animation: "slideUp 0.2s ease-out" }}>
          <input style={M.input} placeholder={t("mkSearchPlaceholder")} value={searchQuery} onChange={e => setSearchQuery(e.target.value)} onKeyDown={e => e.key === "Enter" && onSearch(searchQuery)} autoFocus />
          {searchQuery && <button style={M.iconBtn} onClick={() => onSearch("")}><Icons.X /></button>}
        </div>
      )}

      <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
        <button style={M.primaryBtn} onClick={onCreate}><Icons.Plus /> {t("mkSell")}</button>
        <button style={M.secondaryBtn} onClick={onOrders}><Icons.Package /> {t("mkOrders")}</button>
        <button style={M.secondaryBtn} onClick={() => onSwitchToEscrow()}>⚖️ {t("escrow")}</button>
      </div>

      {/* ── Category quick-filters ── */}
      <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 12, WebkitOverflowScrolling: "touch", scrollbarWidth: "none" }}>
        {CATEGORIES.map(c => (
          <button
            key={c.key}
            onClick={() => setActiveCategory(c.key)}
            style={{
              padding: "6px 12px", borderRadius: 20, fontSize: 11, fontWeight: 600,
              whiteSpace: "nowrap", cursor: "pointer", transition: "all 0.2s",
              border: activeCategory === c.key ? "1px solid rgba(245,158,11,0.4)" : "1px solid #1e293b",
              background: activeCategory === c.key ? "rgba(245,158,11,0.12)" : "#111827",
              color: activeCategory === c.key ? "#fbbf24" : "#94a3b8",
            }}
          >
            {c.icon} {c.label}
          </button>
        ))}
      </div>

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
            No listings in this category yet.
          </p>
          <button onClick={() => setActiveCategory("all")} style={{ ...M.secondaryBtn, flex: "none", marginTop: 8, padding: "8px 16px", fontSize: 12 }}>
            Show all listings
          </button>
        </div>
      ) : filteredListings.length === 0 ? (
        <div style={M.emptyState}>
          <Icons.Tag style={{ color: "#475569" }} />
          <p style={{ color: "#64748b", marginTop: 12, fontSize: 14 }}>
            {loading ? t("mkLoading") : searchQuery ? t("mkNoResults") : t("mkNoListings")}
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingBottom: 20 }}>
          {filteredListings.map(l => (
            <button key={l.id} style={M.listingCard} onClick={() => onOpen(l.id)}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={M.cardTitle}>{l.title}</span>
                <span style={M.cardPrice}>{fmtSats(l.priceMsats)} <span style={{ color: "#64748b", fontWeight: 400, fontSize: 12 }}>{t("sats")}</span></span>
              </div>
              {l.description && <p style={M.cardDesc}>{l.description}</p>}
              <div style={M.cardMeta}>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  {l.condition && <span style={M.conditionBadge}>{t(CONDITION_KEYS[l.condition] || l.condition)}</span>}
                  {l.category && <span style={{
                    ...M.categoryBadge,
                    ...(isSatsForFiat(l.category) ? { background: "rgba(245,158,11,0.15)", color: "#f59e0b", fontWeight: 700 } : {}),
                  }}>{isSatsForFiat(l.category) ? "₿ P2P Trade" : l.category}</span>}
                </div>
                <span style={{ fontSize: 11, color: "#475569" }}>
                  {l.quantity > 1 ? t("mkQtyAvailable", { qty: l.quantity }) : l.quantity === 1 ? t("mkQtyOneLeft") : t("mkQtySoldOut")}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// LISTING DETAIL
// ═══════════════════════════════════════════════════════════════════════

function ListingDetail({ listing: l, pubkey, onBack, onProfile, showToast, loading, setLoading }) {
  const isSeller = l.sellerPubkey === pubkey;
  const canBuy = !isSeller && l.status === "active" && l.quantity > 0;
  const isP2P = isSatsForFiat(l.category);

  const handleBuy = async () => {
    setLoading(true);
    try {
      const res = await mapi(`/${l.id}/buy`, { method: "POST" });
      if (res.error) throw new Error(res.error);
      showToast(isP2P ? t("mkTradeStarted") || "Trade started!" : t("mkBuySuccess"));
      onBack();
    } catch (err) { showToast(err.message, "error"); }
    setLoading(false);
  };

  return (
    <div style={M.container}>
      <div style={M.viewHeader}>
        <button style={M.iconBtn} onClick={onBack}><Icons.Back /></button>
        <h2 style={M.viewTitle}>{t("mkListing")}</h2>
        <div style={{ width: 36 }} />
      </div>

      <div style={{ paddingBottom: 20 }}>
        <div style={{ marginBottom: 16 }}>
          <h2 style={{ fontSize: 22, fontWeight: 700, color: "#f8fafc", margin: "0 0 8px", lineHeight: 1.3 }}>{l.title}</h2>
          <div style={{ fontSize: 32, fontWeight: 900, color: "#f59e0b", letterSpacing: -1 }}>
            {fmtSats(l.priceMsats)} <span style={{ fontSize: 16, fontWeight: 500, color: "#64748b" }}>{t("sats")}</span>
          </div>
        </div>

        {/* Trade type indicator */}
        {isP2P && (
          <div style={{ ...M.infoBanner, borderColor: "rgba(245,158,11,0.3)", background: "rgba(245,158,11,0.06)", marginBottom: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
              <span style={{ fontSize: 14 }}>₿</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#f59e0b" }}>P2P Sats-for-Fiat Trade</span>
            </div>
            <div style={{ fontSize: 11, color: "#94a3b8", lineHeight: 1.5 }}>
              Seller locks sats in escrow. You send fiat (or other payment) externally. Once both confirm, you receive the sats.
            </div>
          </div>
        )}

        {canBuy && (
          <button style={{ ...M.actionBtn, background: isP2P ? "linear-gradient(135deg, #f59e0b, #d97706)" : "linear-gradient(135deg, #10b981, #059669)", boxShadow: isP2P ? "0 4px 24px rgba(245,158,11,0.3)" : "0 4px 24px rgba(16,185,129,0.3)", color: isP2P ? "#0c0f17" : "#fff", marginBottom: 16 }} onClick={handleBuy} disabled={loading}>
            {loading
              ? (isP2P ? "Starting trade…" : t("mkBuying"))
              : isP2P
                ? `₿ Start Trade — ${fmtSats(l.priceMsats)} sats`
                : `⚡ ${t("mkBuyFor", { amount: fmtSats(l.priceMsats) })}`
            }
          </button>
        )}

        {/* Marketplace buyer info */}
        {canBuy && !isP2P && (
          <div style={{ ...M.infoBanner, borderColor: "rgba(16,185,129,0.2)", background: "rgba(16,185,129,0.04)", marginBottom: 14 }}>
            <div style={{ fontSize: 11, color: "#94a3b8", lineHeight: 1.5 }}>
              You'll lock <strong style={{ color: "#10b981" }}>{fmtSats(l.priceMsats)} sats</strong> as payment. Once the seller ships and you confirm receipt, the sats release to the seller.
            </div>
          </div>
        )}

        {isSeller && (
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
        )}

        {l.status !== "active" && (
          <div style={{ ...M.infoBanner, borderColor: "rgba(239,68,68,0.2)", background: "rgba(239,68,68,0.06)" }}>
            <span style={{ color: "#f87171", fontSize: 13, fontWeight: 600 }}>
              {l.status === "sold" ? t("mkQtySoldOut") : l.status === "paused" ? t("mkStatusPaused") : l.status === "deleted" ? t("mkStatusDeleted") : l.status}
            </span>
          </div>
        )}

        {l.description && (
          <div style={M.section}>
            <div style={M.sectionLabel}>{t("description")}</div>
            <div style={M.sectionValue}>{l.description}</div>
          </div>
        )}

        {l.terms && (
          <div style={M.section}>
            <div style={M.sectionLabel}>{t("tradeTerms")}</div>
            <div style={M.sectionValue}>{l.terms}</div>
          </div>
        )}

        <div style={{ display: "flex", gap: 12, marginBottom: 14 }}>
          {l.condition && (
            <div style={{ flex: 1 }}>
              <div style={M.sectionLabel}>{t("mkCondition")}</div>
              <div style={M.sectionValue}>{t(CONDITION_KEYS[l.condition] || l.condition)}</div>
            </div>
          )}
          {l.category && (
            <div style={{ flex: 1 }}>
              <div style={M.sectionLabel}>{t("mkCategory")}</div>
              <div style={M.sectionValue}>{l.category}</div>
            </div>
          )}
          <div style={{ flex: 1 }}>
            <div style={M.sectionLabel}>{t("mkAvailable")}</div>
            <div style={M.sectionValue}>{l.quantity}</div>
          </div>
        </div>

        <div style={M.section}>
          <div style={M.sectionLabel}>{t("seller")}</div>
          <SellerName pubkey={l.sellerPubkey} onTap={onProfile} />
        </div>

        {l.communityLink && (
          <div style={M.section}>
            <div style={M.sectionLabel}>{t("communityLink")}</div>
            <a href={l.communityLink} target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "8px 16px", borderRadius: 8, background: "rgba(139,92,246,0.12)", color: "#a78bfa", fontSize: 12, fontWeight: 600, border: "1px solid rgba(139,92,246,0.2)", textDecoration: "none" }}>
              💬 {t("openCommunity")}
            </a>
          </div>
        )}

        <div style={{ fontSize: 11, color: "#334155", marginTop: 8, fontFamily: "monospace" }}>
          ID: {l.id}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// CREATE LISTING VIEW
// ═══════════════════════════════════════════════════════════════════════

function CreateListingView({ pubkey, onBack, onCreated, showToast, loading, setLoading }) {
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [price, setPrice] = useState("");
  const [terms, setTerms] = useState("");
  const [category, setCategory] = useState("");
  const [condition, setCondition] = useState("new");
  const [quantity, setQuantity] = useState("1");
  const locale = getLocale();
  const FEDI_ROOMS = {
    en: "fedi:room:!kENaQZKCKhRhawCjxf:m1.8fa.in:::",
    fr: "fedi:room:!qHlVxBJBCKqUbetBnA:m1.8fa.in:::",
  };
  const [community, setCommunity] = useState(() => isDevMode() ? (FEDI_ROOMS[locale] || FEDI_ROOMS.en) : "");

  const handleCreate = async () => {
    const sats = parseInt(price);
    if (!title.trim()) return showToast(t("mkTitleRequired"), "error");
    if (!sats || sats <= 0) return showToast(t("mkPriceRequired"), "error");
    if (sats > 2_000_000) return showToast(t("mkPriceExceeds"), "error");

    setLoading(true);
    try {
      const res = await mapi("/", {
        method: "POST",
        body: JSON.stringify({
          title: title.trim(),
          description: desc.trim() || undefined,
          priceMsats: sats * 1000,
          terms: terms.trim() || undefined,
          category: category.trim() || undefined,
          condition,
          communityLink: community.trim() || undefined,
          quantity: parseInt(quantity) || 1,
        }),
      });
      if (res.error) throw new Error(res.error);
      showToast(t("mkListingCreated"));
      onCreated(res.id);
    } catch (err) { showToast(err.message, "error"); }
    setLoading(false);
  };

  return (
    <div style={M.container}>
      <div style={M.viewHeader}>
        <button style={M.iconBtn} onClick={onBack}><Icons.Back /></button>
        <h2 style={M.viewTitle}>{t("mkNewListing")}</h2>
        <div style={{ width: 36 }} />
      </div>

      <div style={M.formGroup}><label style={M.label}>{t("mkFieldTitle")} *</label><input style={M.input} placeholder={t("mkFieldTitleHint")} value={title} onChange={e => setTitle(e.target.value)} /></div>
      <div style={M.formGroup}><label style={M.label}>{t("mkFieldPrice")} *</label><input style={M.input} type="number" placeholder="25000" value={price} onChange={e => setPrice(e.target.value)} /><p style={M.hint}>{t("maxFedLimit", { limit: "2,000,000" })}</p></div>
      <div style={M.formGroup}><label style={M.label}>{t("description")}</label><textarea style={{ ...M.input, minHeight: 72, resize: "vertical" }} placeholder={t("mkFieldDescHint")} value={desc} onChange={e => setDesc(e.target.value)} /></div>
      <div style={M.formGroup}><label style={M.label}>{t("tradeTerms")}</label><textarea style={{ ...M.input, minHeight: 60, resize: "vertical" }} placeholder={t("mkFieldTermsHint")} value={terms} onChange={e => setTerms(e.target.value)} /></div>

      <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
        <div style={{ flex: 1 }}>
          <label style={M.label}>{t("mkCondition")}</label>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {["new", "used", "digital", "service"].map(c => (
              <button key={c} onClick={() => setCondition(c)} style={{ ...M.chipBtn, ...(condition === c ? M.chipBtnActive : {}) }}>
                {t(CONDITION_KEYS[c])}
              </button>
            ))}
          </div>
        </div>
        <div style={{ width: 80 }}>
          <label style={M.label}>{t("mkFieldQty")}</label>
          <input style={M.input} type="number" min="1" value={quantity} onChange={e => setQuantity(e.target.value)} />
        </div>
      </div>

      <div style={M.formGroup}>
        <label style={M.label}>{t("mkCategory")}</label>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
          {[
            { value: SATS_FOR_FIAT, label: "₿ Sats for Fiat", color: "#f59e0b", bg: "rgba(245,158,11,0.12)" },
            { value: "electronics", label: "Electronics" },
            { value: "clothing", label: "Clothing" },
            { value: "art", label: "Art" },
            { value: "services", label: "Services" },
          ].map(cat => {
            const active = category === cat.value;
            return (
              <button key={cat.value} onClick={() => setCategory(cat.value)} style={{
                ...M.chipBtn,
                ...(active ? { ...M.chipBtnActive, borderColor: cat.color || "#f59e0b", color: cat.color || "#f8fafc", background: cat.bg || "rgba(245,158,11,0.12)" } : {}),
              }}>
                {cat.label}
              </button>
            );
          })}
        </div>
        <input style={M.input} placeholder={t("mkFieldCategoryHint")} value={category} onChange={e => setCategory(e.target.value)} />
        {isSatsForFiat(category) && (
          <div style={{ ...M.infoBanner, borderColor: "rgba(245,158,11,0.3)", background: "rgba(245,158,11,0.06)", marginTop: 8 }}>
            <span style={{ fontSize: 12, color: "#f59e0b", fontWeight: 600 }}>₿ P2P Trade Mode</span>
            <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4, lineHeight: 1.5 }}>
              You will lock your sats in escrow. The buyer sends you fiat (or other payment) externally. Once confirmed, sats release to the buyer.
            </div>
          </div>
        )}
      </div>
      <div style={M.formGroup}><label style={M.label}>{t("communityLink")}</label><input style={M.input} placeholder="fedi:room:!roomId:federation.domain:::" value={community} onChange={e => setCommunity(e.target.value)} /><p style={M.hint}>{t("mkCommunityHint")}</p></div>

      <button style={{ ...M.primaryBtn, width: "100%", marginTop: 8, padding: "14px 0" }} onClick={handleCreate} disabled={loading}>
        {loading ? t("creating") : t("mkCreateListing")}
      </button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// ORDERS VIEW
// ═══════════════════════════════════════════════════════════════════════

function OrdersView({ orders, loading, pubkey, onBack, onRefresh, onOpenOrder, onProfile }) {
  return (
    <div style={M.container}>
      <div style={M.viewHeader}>
        <button style={M.iconBtn} onClick={onBack}><Icons.Back /></button>
        <h2 style={M.viewTitle}>{t("mkMyOrders")}</h2>
        <button style={M.iconBtn} onClick={onRefresh}><Icons.Refresh style={loading ? { animation: "pulse 1s infinite" } : {}} /></button>
      </div>

      {orders.length === 0 ? (
        <div style={M.emptyState}>
          <Icons.Package style={{ color: "#475569" }} />
          <p style={{ color: "#64748b", marginTop: 12, fontSize: 14 }}>
            {loading ? t("mkLoading") : t("mkNoOrders")}
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingBottom: 20 }}>
          {orders.map(o => (
            <button key={o.id} style={M.listingCard} onClick={() => onOpenOrder(o)}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={M.cardTitle}>{o.listingTitle}</span>
                <OrderBadge status={o.status} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6 }}>
                <span style={{ fontSize: 15, fontWeight: 600, color: "#f59e0b" }}>{fmtSats(o.amountMsats)} {t("sats")}</span>
                <span style={{ fontSize: 11, color: "#475569" }}>
                  {o.buyerPubkey === pubkey ? `🛒 ${t("buyer")}` : `🏠 ${t("seller")}`}
                </span>
              </div>
              <div style={{ fontSize: 11, fontFamily: "monospace", color: "#334155", marginTop: 4 }}>
                {o.id} → {o.escrowId}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// ORDER DETAIL VIEW
// ═══════════════════════════════════════════════════════════════════════

function OrderDetailView({ order: o, pubkey, onBack, onProfile, onSwitchToEscrow, showToast, loading, setLoading }) {
  const [detail, setDetail] = useState(null);
  const [rateScore, setRateScore] = useState(0);
  const [rateComment, setRateComment] = useState("");
  const [showRating, setShowRating] = useState(false);
  const [rated, setRated] = useState(false);
  const isBuyer = o.buyerPubkey === pubkey;
  const canCancel = isBuyer && (o.status === "pending");

  useEffect(() => {
    (async () => {
      try {
        const data = await mapi(`/orders/${o.id}`);
        if (!data.error) setDetail(data);
      } catch {}
    })();
  }, [o.id]);

  const handleCancel = async () => {
    const listingId = detail?.order?.listingId || o.listingId;
    if (!listingId) return;
    setLoading(true);
    try {
      const res = await mapi(`/${listingId}/cancel`, { method: "POST" });
      if (res.error) throw new Error(res.error);
      showToast(t("mkOrderCancelledToast"));
      onBack();
    } catch (err) { showToast(err.message, "error"); }
    setLoading(false);
  };

  const handleRate = async () => {
    if (rateScore < 1) return showToast("Select a rating (1-5 stars)", "error");
    const otherPubkey = isBuyer ? o.sellerPubkey : o.buyerPubkey;
    setLoading(true);
    try {
      const res = await mapi(`/profile/${otherPubkey}/rate`, {
        method: "POST",
        body: JSON.stringify({ orderId: o.id, score: rateScore, comment: rateComment || undefined }),
      });
      if (res.error) throw new Error(res.error);
      showToast("Rating submitted!");
      setRated(true);
      setShowRating(false);
    } catch (err) { showToast(err.message, "error"); }
    setLoading(false);
  };

  const escrow = detail?.escrow;
  const status = detail?.order?.status || o.status;
  const canRate = status === "completed" && !rated;
  const otherPubkey = isBuyer ? o.sellerPubkey : o.buyerPubkey;
  const isP2P = detail?.tradeType === "sats-for-fiat" || isSatsForFiat(detail?.listing?.category);

  return (
    <div style={M.container}>
      <div style={M.viewHeader}>
        <button style={M.iconBtn} onClick={onBack}><Icons.Back /></button>
        <h2 style={M.viewTitle}>{t("mkOrder")} {o.id}</h2>
        <div style={{ width: 36 }} />
      </div>

      <div style={{ paddingBottom: 20 }}>
        <div style={{ textAlign: "center", marginBottom: 16 }}>
          <OrderBadge status={status} />
          {isP2P && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 10px", borderRadius: 99, fontSize: 11, fontWeight: 700, color: "#f59e0b", background: "rgba(245,158,11,0.12)", marginLeft: 6 }}>
              ₿ P2P Trade
            </span>
          )}
          <div style={{ fontSize: 32, fontWeight: 900, color: "#f8fafc", marginTop: 12, letterSpacing: -1 }}>
            {fmtSats(o.amountMsats)} <span style={{ fontSize: 16, color: "#64748b", fontWeight: 500 }}>{t("sats")}</span>
          </div>
          <div style={{ fontSize: 13, color: "#64748b", marginTop: 4 }}>
            {o.listingTitle || detail?.listing?.title || "—"}
          </div>
        </div>

        {canCancel && (
          <button style={{ ...M.actionBtn, background: "linear-gradient(135deg, #dc2626, #b91c1c)", marginBottom: 16 }} onClick={handleCancel} disabled={loading}>
            {loading ? t("mkCancelling") : t("mkCancelOrder")}
          </button>
        )}

        {escrow && (
          <div style={{ ...M.infoBanner, borderColor: "rgba(139,92,246,0.2)", background: "rgba(139,92,246,0.06)", marginBottom: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
              <div>
                <div style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2 }}>{t("escrow")}</div>
                <div style={{ fontSize: 13, fontFamily: "monospace", color: "#a78bfa" }}>{escrow.id}</div>
              </div>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 10px", borderRadius: 99, fontSize: 11, fontWeight: 700, color: "#a78bfa", background: "rgba(139,92,246,0.15)" }}>
                {escrow.status}
              </span>
            </div>
            {escrow.resolvedOutcome && (
              <div style={{ fontSize: 12, color: escrow.resolvedOutcome === "release" ? "#10b981" : "#f59e0b", marginTop: 8, fontWeight: 600 }}>
                {escrow.resolvedOutcome === "release"
                  ? isP2P ? "✓ Sats released to buyer" : "✓ Payment released to seller"
                  : isP2P ? "↩ Sats refunded to seller" : "↩ Payment refunded to buyer"
                }
              </div>
            )}
            {onSwitchToEscrow && (
              <button
                onClick={() => onSwitchToEscrow(escrow.id)}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                  width: "100%", padding: "10px 0", marginTop: 10,
                  borderRadius: 8, border: "1px solid rgba(139,92,246,0.3)",
                  background: "rgba(139,92,246,0.1)", color: "#a78bfa",
                  fontSize: 13, fontWeight: 700, cursor: "pointer",
                }}
              >
                ⚡ Open Escrow — {escrow.status === "FUNDED" ? "Lock Sats" : escrow.status === "LOCKED" ? "Vote" : escrow.status === "APPROVED" ? "Claim Sats" : "View Details"}
              </button>
            )}
          </div>
        )}

        <div style={M.section}>
          <div style={M.sectionLabel}>{t("mkParticipants")}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={M.participantRow}><span style={{ color: "#f59e0b" }}>🏠 {t("seller")}</span><SellerName pubkey={o.sellerPubkey} onTap={onProfile} /></div>
            <div style={M.participantRow}><span style={{ color: "#8b5cf6" }}>🛒 {t("buyer")}</span><SellerName pubkey={o.buyerPubkey} onTap={onProfile} /></div>
            {o.arbiterPubkey && <div style={M.participantRow}><span style={{ color: "#64748b" }}>⚖️ {t("arbiter")}</span><span style={{ fontFamily: "monospace", fontSize: 11, color: "#475569" }}>{truncPk(o.arbiterPubkey)}</span></div>}
          </div>
        </div>

        {status === "pending" && (
          <div style={{ textAlign: "center", padding: "14px 0", fontSize: 13 }}>
            {isP2P ? (
              <div>
                <Icons.Clock style={{ display: "inline", verticalAlign: "middle", marginRight: 6, color: "#f59e0b" }} />
                <span style={{ color: "#f59e0b" }}>
                  {isBuyer
                    ? "Waiting for seller to lock sats in escrow…"
                    : "You need to lock your sats in escrow to begin the trade."
                  }
                </span>
              </div>
            ) : (
              <div>
                <Icons.Clock style={{ display: "inline", verticalAlign: "middle", marginRight: 6, color: "#64748b" }} />
                <span style={{ color: "#64748b" }}>
                  {isBuyer
                    ? "You need to lock your sats as payment."
                    : "Waiting for buyer to lock sats as payment…"
                  }
                </span>
              </div>
            )}
          </div>
        )}
        {status === "active" && (
          <div style={{ textAlign: "center", padding: "14px 0", fontSize: 13 }}>
            {isP2P ? (
              <span style={{ color: "#f59e0b" }}>
                ₿ {isBuyer
                  ? "Sats are locked! Send fiat to the seller, then confirm."
                  : "Sats are locked! Waiting for buyer to send fiat."
                }
              </span>
            ) : (
              <span style={{ color: "#f59e0b" }}>
                ⚡ {isBuyer
                  ? "Payment locked! Waiting for seller to ship."
                  : "Buyer paid! Ship the item, then both confirm."
                }
              </span>
            )}
          </div>
        )}
        {status === "completed" && (
          <div style={{ textAlign: "center", padding: "14px 0", color: "#10b981", fontSize: 13, fontWeight: 600 }}>
            ✓ {isP2P ? "Trade complete — sats released!" : t("tradeComplete")}
          </div>
        )}

        {/* ── Primary action: Go to Escrow (for pending/active orders) ── */}
        {onSwitchToEscrow && (status === "pending" || status === "active") && (o.escrowId || escrow?.id) && (
          <button
            onClick={() => onSwitchToEscrow(escrow?.id || o.escrowId)}
            style={{
              ...M.actionBtn,
              background: "linear-gradient(135deg, #7c3aed, #6d28d9)",
              boxShadow: "0 4px 24px rgba(124,58,237,0.3)",
              marginTop: 8, marginBottom: 8,
            }}
          >
            ⚡ {status === "pending"
              ? (isP2P
                  ? (isBuyer ? "View Escrow" : "Lock Sats in Escrow")
                  : (isBuyer ? "Lock Sats in Escrow" : "View Escrow"))
              : "Open Escrow — Vote"
            }
          </button>
        )}

        {/* Rate button — after completed trades */}
        {canRate && !showRating && (
          <button
            style={{ ...M.actionBtn, background: "linear-gradient(135deg, #f59e0b, #d97706)", color: "#0c0f17", marginTop: 8 }}
            onClick={() => setShowRating(true)}
          >
            ⭐ Rate {isBuyer ? "Seller" : "Buyer"}
          </button>
        )}
        {rated && (
          <div style={{ textAlign: "center", padding: "10px 0", color: "#10b981", fontSize: 13, fontWeight: 600 }}>
            ✓ Rating submitted
          </div>
        )}

        {/* Rating form */}
        {showRating && (
          <div style={{ ...M.infoBanner, borderColor: "rgba(245,158,11,0.2)", background: "rgba(245,158,11,0.04)", marginTop: 12 }}>
            <div style={{ marginBottom: 10, fontSize: 13, fontWeight: 600, color: "#f8fafc" }}>
              Rate your trade with <SellerName pubkey={otherPubkey} />
            </div>
            <div style={{ marginBottom: 12, textAlign: "center" }}>
              <StarRating score={rateScore} onChange={setRateScore} size={28} />
            </div>
            <textarea
              value={rateComment}
              onChange={(e) => setRateComment(e.target.value)}
              placeholder="Optional comment (max 500 chars)"
              maxLength={500}
              style={{ ...M.input, minHeight: 60, resize: "vertical", marginBottom: 10 }}
            />
            <div style={{ display: "flex", gap: 8 }}>
              <button style={{ ...M.secondaryBtn, flex: 1 }} onClick={() => { setShowRating(false); setRateScore(0); setRateComment(""); }}>
                Cancel
              </button>
              <button style={{ ...M.primaryBtn, flex: 1, opacity: rateScore ? 1 : 0.5 }} onClick={handleRate} disabled={loading || !rateScore}>
                {loading ? "Submitting…" : "Submit Rating"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// SELLER PROFILE VIEW
// ═══════════════════════════════════════════════════════════════════════

function SellerProfileView({ pubkey: pk, myPubkey, onBack, onOpen, showToast }) {
  const profile = useNostrProfile(pk);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const data = await mapi(`/profile/${pk}`);
        if (!data.error) setStats(data);
      } catch (err) { console.warn("[profile]", err.message); }
      setLoading(false);
    })();
  }, [pk]);

  const isMe = pk === myPubkey;
  const ts = stats?.tradeStats || {};
  const rs = stats?.ratings || {};

  // Generate avatar from pubkey
  const avatarColors = ["#f59e0b", "#10b981", "#8b5cf6", "#ef4444", "#3b82f6", "#ec4899"];
  const avatarColor = avatarColors[parseInt(pk.slice(0, 2), 16) % avatarColors.length];
  const avatarLetter = (profile.name || pk.slice(0, 1)).charAt(0).toUpperCase();

  return (
    <div style={M.container}>
      <div style={M.viewHeader}>
        <button style={M.iconBtn} onClick={onBack}><Icons.Back /></button>
        <h2 style={M.viewTitle}>Profile</h2>
        <div style={{ width: 36 }} />
      </div>

      <div style={{ paddingBottom: 20 }}>
        {/* Avatar + Name */}
        <div style={{ textAlign: "center", marginBottom: 20 }}>
          {profile.picture ? (
            <img
              src={profile.picture}
              alt=""
              style={{ width: 64, height: 64, borderRadius: "50%", objectFit: "cover", border: "2px solid #1e293b" }}
              onError={(e) => { e.target.style.display = "none"; }}
            />
          ) : (
            <div style={{
              width: 64, height: 64, borderRadius: "50%", margin: "0 auto",
              background: `linear-gradient(135deg, ${avatarColor}, ${avatarColor}88)`,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 28, fontWeight: 700, color: "#fff",
            }}>
              {avatarLetter}
            </div>
          )}
          <div style={{ fontSize: 18, fontWeight: 700, color: "#f8fafc", marginTop: 10 }}>
            {profile.loading ? "…" : profile.name || truncPk(pk)}
          </div>
          {profile.nip05 && (
            <div style={{ fontSize: 12, color: "#a78bfa", marginTop: 2 }}>✓ {profile.nip05}</div>
          )}
          {isMe && (
            <span style={{ display: "inline-block", marginTop: 6, padding: "2px 10px", borderRadius: 99, fontSize: 11, fontWeight: 600, color: "#f59e0b", background: "rgba(245,158,11,0.12)" }}>
              You
            </span>
          )}
          <div style={{ fontFamily: "monospace", fontSize: 11, color: "#475569", marginTop: 6 }}>
            {truncPk(pk)}
          </div>
          {profile.about && (
            <div style={{ fontSize: 13, color: "#94a3b8", marginTop: 8, lineHeight: 1.5, maxWidth: 320, margin: "8px auto 0" }}>
              {profile.about.length > 200 ? profile.about.slice(0, 200) + "…" : profile.about}
            </div>
          )}
        </div>

        {loading ? (
          <div style={{ textAlign: "center", padding: "40px 0" }}>
            <div style={{ width: 20, height: 20, margin: "0 auto", border: "2px solid #1e293b", borderTopColor: "#475569", borderRadius: "50%", animation: "spin 0.6s linear infinite" }} />
          </div>
        ) : stats && (
          <>
            {/* Trade Stats */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 16 }}>
              {[
                { label: "Trades", value: ts.totalTrades || 0 },
                { label: "Sells", value: ts.completedSells || 0 },
                { label: "Buys", value: ts.completedBuys || 0 },
              ].map(s => (
                <div key={s.label} style={{ textAlign: "center", padding: "12px 8px", background: "rgba(30,41,59,0.5)", borderRadius: 10, border: "1px solid #1e293b" }}>
                  <div style={{ fontSize: 22, fontWeight: 800, color: "#f8fafc" }}>{s.value}</div>
                  <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 2 }}>{s.label}</div>
                </div>
              ))}
            </div>

            {/* Volume + Active */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 16 }}>
              <div style={{ padding: "12px 14px", background: "rgba(30,41,59,0.5)", borderRadius: 10, border: "1px solid #1e293b" }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: "#f59e0b" }}>{fmtSats(ts.sellVolumeMsats || 0)}</div>
                <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 2 }}>Volume (sats)</div>
              </div>
              <div style={{ padding: "12px 14px", background: "rgba(30,41,59,0.5)", borderRadius: 10, border: "1px solid #1e293b" }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: "#10b981" }}>{ts.activeListings || 0}</div>
                <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 2 }}>Active Listings</div>
              </div>
            </div>

            {/* Rating Summary */}
            {rs.total > 0 && (
              <div style={{ ...M.infoBanner, borderColor: "rgba(245,158,11,0.2)", background: "rgba(245,158,11,0.04)", marginBottom: 16 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                  <StarRating score={Math.round(rs.avgScore || 0)} size={18} />
                  <span style={{ fontSize: 20, fontWeight: 800, color: "#f59e0b" }}>{rs.avgScore}</span>
                  <span style={{ fontSize: 12, color: "#64748b" }}>({rs.total} review{rs.total !== 1 ? "s" : ""})</span>
                </div>
                <div style={{ display: "flex", gap: 12, fontSize: 12 }}>
                  <span style={{ color: "#10b981" }}>👍 {rs.positive} positive</span>
                  <span style={{ color: "#ef4444" }}>👎 {rs.negative} negative</span>
                </div>
              </div>
            )}
            {rs.total === 0 && (
              <div style={{ textAlign: "center", padding: "12px 0", color: "#475569", fontSize: 12, marginBottom: 16 }}>
                No ratings yet
              </div>
            )}

            {/* Recent Reviews */}
            {stats.recentRatings?.length > 0 && (
              <div style={M.section}>
                <div style={M.sectionLabel}>Recent Reviews</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {stats.recentRatings.map(r => (
                    <div key={r.id} style={{ padding: "10px 12px", background: "rgba(30,41,59,0.3)", borderRadius: 10, border: "1px solid #1e293b" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                        <StarRating score={r.score} size={14} />
                        <span style={{ fontSize: 11, color: "#475569" }}>
                          {new Date(r.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                      {r.comment && (
                        <div style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.4 }}>{r.comment}</div>
                      )}
                      <div style={{ fontSize: 10, fontFamily: "monospace", color: "#334155", marginTop: 4 }}>
                        by {truncPk(r.raterPubkey)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Member since */}
            {stats.memberSince && (
              <div style={{ textAlign: "center", fontSize: 11, color: "#475569", marginTop: 8 }}>
                Member since {new Date(stats.memberSince).toLocaleDateString()}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// STYLES
// ═══════════════════════════════════════════════════════════════════════

const M = {
  root: { background: "#0c0f17", color: "#e2e8f0", minHeight: "100vh", fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', fontSize: 14, lineHeight: 1.5 },
  container: { width: "100%", maxWidth: 480, margin: "0 auto", padding: "0 16px 20px", overflowX: "hidden" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "20px 0 16px" },
  title: { fontSize: 24, fontWeight: 700, color: "#f8fafc", margin: 0, letterSpacing: -0.5 },
  subtitle: { fontSize: 12, color: "#64748b", margin: "2px 0 0" },
  viewHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 0 12px" },
  viewTitle: { fontSize: 17, fontWeight: 600, color: "#f8fafc", margin: 0 },
  iconBtn: { background: "transparent", color: "#94a3b8", padding: 8, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", border: "none", cursor: "pointer" },
  primaryBtn: { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, background: "linear-gradient(135deg, #f59e0b, #d97706)", color: "#0c0f17", fontWeight: 700, fontSize: 14, padding: "12px 20px", borderRadius: 12, flex: 1, border: "none", cursor: "pointer", boxShadow: "0 2px 12px rgba(245,158,11,0.2)" },
  secondaryBtn: { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, background: "linear-gradient(145deg, #1e293b, #1a2332)", color: "#e2e8f0", fontWeight: 600, fontSize: 14, padding: "12px 20px", borderRadius: 12, flex: 1, border: "1px solid #334155", cursor: "pointer" },
  actionBtn: { display: "flex", alignItems: "center", justifyContent: "center", gap: 8, width: "100%", padding: "16px 0", borderRadius: 14, color: "#fff", fontSize: 15, fontWeight: 800, letterSpacing: -0.3, border: "none", cursor: "pointer" },
  input: { width: "100%", padding: "12px 14px", borderRadius: 10, border: "1px solid #1e293b", background: "#111827", color: "#f8fafc", fontSize: 14, outline: "none", boxSizing: "border-box" },
  formGroup: { marginBottom: 16 },
  label: { display: "block", fontSize: 12, fontWeight: 600, color: "#94a3b8", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 },
  hint: { fontSize: 11, color: "#475569", marginTop: 4 },
  section: { marginBottom: 14 },
  sectionLabel: { fontSize: 11, fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 },
  sectionValue: { fontSize: 13, color: "#cbd5e1", lineHeight: 1.6 },
  emptyState: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "60px 20px", textAlign: "center" },
  listingCard: { background: "linear-gradient(145deg, #111827, #0f1320)", border: "1px solid #1e293b", borderRadius: 14, padding: "14px 16px", textAlign: "left", color: "#e2e8f0", width: "100%", cursor: "pointer", transition: "all 0.2s ease" },
  cardTitle: { fontSize: 15, fontWeight: 600, color: "#f8fafc", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 },
  cardPrice: { fontSize: 15, fontWeight: 700, color: "#f59e0b", whiteSpace: "nowrap", marginLeft: 8 },
  cardDesc: { fontSize: 12, color: "#94a3b8", margin: "6px 0 0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  cardMeta: { display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 },
  conditionBadge: { padding: "2px 8px", borderRadius: 6, fontSize: 10, fontWeight: 700, background: "rgba(139,92,246,0.1)", color: "#a78bfa", letterSpacing: 0.3 },
  categoryBadge: { padding: "2px 8px", borderRadius: 6, fontSize: 10, fontWeight: 600, background: "rgba(100,116,139,0.1)", color: "#94a3b8" },
  chipBtn: { padding: "6px 12px", borderRadius: 8, background: "#111827", color: "#94a3b8", fontSize: 12, fontWeight: 500, border: "1px solid #1e293b", cursor: "pointer" },
  chipBtnActive: { background: "#1e293b", color: "#f8fafc", borderColor: "#f59e0b" },
  infoBanner: { padding: "10px 14px", border: "1px solid", borderRadius: 10, marginBottom: 12 },
  participantRow: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", fontSize: 13 },
};
