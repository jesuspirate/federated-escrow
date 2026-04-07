import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { t, getLocale, getAvailableLocales, setLocale } from "./i18n";

// ── Extracted modules ──
import { MAPI, PAYMENT_METHODS, BILL_TYPES, CATEGORIES, CONDITION_KEYS, FED_LIMITS, BILL_PAY, SATS_FOR_FIAT, LENDING, CURRENCY_SYMBOLS, FED_NAMES_GLOBAL, DEV_IDENTITIES, LEARN_DISMISSED_KEY } from "./marketplace/constants";
import { isBillPay, isSatsForFiat, isLending, isLenderTrade, isSpecialCategory, fmtSats, fmtSatsShort, fmtVolume, fmtFiat, msatsToFiat, truncPk, getFedName, getFedInfo, recalcBillPaySats } from "./marketplace/helpers";
import M from "./marketplace/styles";
import BillPayView from "./marketplace/BillPayView";
import OrdersView from "./marketplace/OrdersView";
import ChapSmartView from "./marketplace/ChapSmartView";
import ArbiterRecruitmentView from "./marketplace/ArbiterRecruitmentView";
import FAQView from "./marketplace/FAQView";
import { useNostrProfile, SellerName, StarRating, Icons, Toast, fetchNostrProfile, _nostrProfileCache } from "./marketplace/components";
import OrderDetailView from "./marketplace/OrderDetailView";
import CreateListingView from "./marketplace/CreateListingView";
import SellerProfileView from "./marketplace/SellerProfileView";
import BrowseView from "./marketplace/BrowseView";
import SubdomainHubView from "./marketplace/SubdomainHubView";
import EditListingView from "./marketplace/EditListingView";
import ListingDetail from "./marketplace/ListingDetail";
// FUTURE: Re-enable for PWA/Start9/Umbrel push notifications
//import NotificationSettings, { NotifBellIcon } from "./NotificationSettings";

// ═══════════════════════════════════════════════════════════════════════
// Fedi Mini-App: Marketplace v2.0
// Community homepage • Onboarding • Category filters • Deep-link escrow
// NIP-98 Nostr auth • Fedi + browser sandbox
// ═══════════════════════════════════════════════════════════════════════

// ── Auth ─────────────────────────────────────────────────────────────

function _detectFediApp() {
  if (typeof window === "undefined") return false;
  if (!window.webln) return false;
  const ua = navigator.userAgent || "";
  const isAndroidWebView = /Android/.test(ua) && (/wv\)/.test(ua) || !!window.webln);
  const isIOSWebView = /iPhone|iPad|iPod/.test(ua) && !/Safari\//.test(ua);
  const isDesktop = !/Android|iPhone|iPad|iPod|Mobile/.test(ua);
  if (isDesktop) return false;
  if (isAndroidWebView || isIOSWebView) return true;
  return false;
}

let _devPubkey = null;

let _fediConfirmed = false;
function _isFediRuntime() {
  if (_fediConfirmed) return true;
  if (_detectFediApp()) { _fediConfirmed = true; return true; }
  if (typeof window !== "undefined" && window.fediInternal) { _fediConfirmed = true; return true; }
  // Only trust window.webln on mobile (desktop could be Alby/other extension)
  const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || "");
  if (isMobile && typeof window !== "undefined" && window.webln) { _fediConfirmed = true; return true; }
  return false;
}

function isDevMode() {
  if (_devPubkey) return true;
  if (typeof location !== "undefined" && new URLSearchParams(location.search).has("dev")) return true;
  if (!_isFediRuntime()) return true;
  return false;
}

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
  if (_devPubkey || isDevMode()) return null;
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

// Cache NIP-98 headers for 30s to avoid re-signing for rapid sequential calls
const _nip98Cache = new Map();
const NIP98_CACHE_TTL = 30_000;

async function getCachedNip98Header(url, method) {
  const key = `${method}:${url}`;
  const cached = _nip98Cache.get(key);
  if (cached && Date.now() - cached.ts < NIP98_CACHE_TTL) return cached.header;
  const header = await makeNip98Header(url, method);
  if (header) _nip98Cache.set(key, { header, ts: Date.now() });
  return header;
}

// ── Session token management (shared with escrow) ─────────────────────
// Session token — shared via window global with proper mutex
async function getMSessionToken() {
  // Fast path: token already cached and valid
  if (window.__smToken && window.__smTokenExpiry > Date.now() + 60000) return window.__smToken;
  // If another call is already fetching, wait for THAT promise (not a new one)
  if (window.__smTokenPromise) {
    try { await window.__smTokenPromise; } catch {}
    return window.__smToken || null;
  }
  // Create the fetch promise and store it SYNCHRONOUSLY before any await
  const fetchPromise = (async () => {
    const url = location.origin + "/api/ecash-escrows/auth/session";
    const nip98 = await getCachedNip98Header(url, "POST");
    if (!nip98) return null;
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "Authorization": nip98 } });
    const data = await res.json();
    if (data.token) { window.__smToken = data.token; window.__smTokenExpiry = Date.now() + 1800000; }
    return window.__smToken || null;
  })();
  window.__smTokenPromise = fetchPromise;
  try { await fetchPromise; } catch {}
  window.__smTokenPromise = null;
  return window.__smToken || null;
}

async function mapi(path, opts = {}, _retries = 1) {
  const method = opts.method || "GET";
  const url = `${location.origin}${MAPI}${path}`;
  const headers = { "Content-Type": "application/json" };

  // Public GET routes (browse, detail) don't need auth.
  const needsAuth = method !== "GET" || path.includes("/orders");

  if (needsAuth) {
    // Get or create session token — blocks until ready, NO NIP-98 fallback
    const token = await getMSessionToken();
    if (token) {
      headers["Authorization"] = "Bearer " + token;
    } else if (_devPubkey) {
      headers["X-Dev-Pubkey"] = _devPubkey;
    } else {
      try {
        const nip98 = await getCachedNip98Header(url, method);
        if (nip98) headers["Authorization"] = nip98;
        else throw new Error("Authentication required");
      } catch (err) {
        if (err.name === "NostrRejectedError") {
          if (method !== "GET") throw err;
          if (_retries > 0) return mapi(path, opts, _retries - 1);
        }
        throw err;
      }
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
  if ((res.status === 401 || res.status === 403) && _retries > 0) {
    window.__smToken = null; window.__smTokenExpiry = 0; window.__smTokenPromise = null;
    // Re-create session before retry
    await getMSessionToken();
    return mapi(path, opts, _retries - 1);
  }
  if (res.status === 401 || res.status === 403) throw new Error(t("mkAuthRequired"));
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { error: text || `HTTP ${res.status}` }; }
}

// ── BTC Price Hook — fetches from mempool.space + forex conversion ──
let _btcPrices = null; // { USD, EUR, GBP, ... }
let _forexRates = null; // { CFA: 615, KES: 129, ... } per 1 USD
let _btcPriceLastFetch = 0;

// Approximate forex rates (USD → local) — updated from ExchangeRate-API
const FALLBACK_FOREX = {
  XOF: 615, KES: 129, TZS: 2650, NGN: 1550, BRL: 5.0, ARS: 900, INR: 83, ZAR: 18.5,
  EUR: 0.92, GBP: 0.79, CAD: 1.36, CHF: 0.88, AUD: 1.53, JPY: 150,
};
// Map our display codes to ISO codes
const FOREX_CODE_MAP = { CFA: "XOF" };
let _forexFetched = false;

async function fetchForexRates() {
  if (_forexFetched) return;
  try {
    const res = await fetch("https://open.er-api.com/v6/latest/USD");
    const data = await res.json();
    if (data.result === "success" && data.rates) {
      for (const [code, fallbackRate] of Object.entries(FALLBACK_FOREX)) {
        const isoCode = FOREX_CODE_MAP[code] || code;
        if (data.rates[isoCode]) FALLBACK_FOREX[code] = data.rates[isoCode];
      }
      _forexFetched = true;
      console.log("[forex] Updated rates from ExchangeRate-API");
    }
  } catch { /* use fallback rates */ }
}

async function fetchBtcPrice() {
  const now = Date.now();
  if (_btcPrices && now - _btcPriceLastFetch < 5 * 60 * 1000) return _btcPrices;
  try {
    const res = await fetch("https://mempool.space/api/v1/prices");
    const data = await res.json();
    _btcPrices = data;
    _btcPriceLastFetch = now;
    // Update forex from mempool's own rates where available
    if (data.EUR && data.USD) FALLBACK_FOREX.EUR = data.EUR / data.USD;
    if (data.GBP && data.USD) FALLBACK_FOREX.GBP = data.GBP / data.USD;
    if (data.CAD && data.USD) FALLBACK_FOREX.CAD = data.CAD / data.USD;
    if (data.CHF && data.USD) FALLBACK_FOREX.CHF = data.CHF / data.USD;
    if (data.AUD && data.USD) FALLBACK_FOREX.AUD = data.AUD / data.USD;
    if (data.JPY && data.USD) FALLBACK_FOREX.JPY = data.JPY / data.USD;
    return _btcPrices;
  } catch { return _btcPrices; }
}

function useBtcPrice() {
  const [prices, setPrices] = useState(_btcPrices);
  useEffect(() => {
    fetchBtcPrice().then(p => { if (p) setPrices(p); });
    fetchForexRates();
  }, []);
  return prices;
}

// ═══════════════════════════════════════════════════════════════════════
// MAIN MARKETPLACE COMPONENT
// Per-view loading states prevent cross-contamination between views.
// ═══════════════════════════════════════════════════════════════════════

export default function Marketplace({ pubkey, devRole, subdomain, onSwitchToEscrow, initialEscrowId, onOpened , goHomeSignal}) {
  const [sessionReady, setSessionReady] = useState(isDevMode());
  const [lightMode, setLightMode] = useState(() => { try { return localStorage.getItem("sm_lightmode") === "1"; } catch { return false; } });
  useEffect(() => {
    if (sessionReady) return;
    if (!pubkey) return;
    getMSessionToken().then(() => setSessionReady(true)).catch(() => setSessionReady(true));
  }, [pubkey]);
  // Auto-blur buttons on touch to prevent persistent focus rectangles in WebView
  useEffect(() => {
    const handler = (e) => {
      const btn = e.target?.closest ? e.target.closest("button") : null;
      if (btn) setTimeout(() => btn.blur(), 50);
    };
    document.addEventListener("touchend", handler, true);
    return () => document.removeEventListener("touchend", handler, true);
  }, []);

  const [onboarded, setOnboarded] = useState(() => {
    try { return localStorage.getItem(MK_ONBOARDING_KEY) === "1"; } catch { return false; }
  });
  const [view, setView] = useState(() => { const h = window.location.hash.replace("#", ""); if (["faq", "arbiters"].includes(h)) return h; if (["market", "p2p", "lending"].includes(subdomain)) return "hub"; return "browse"; });
  const [prevView, setPrevView] = useState("hub");
  const navigateTo = (next) => { setPrevView(view); setView(next); };
  const [listings, setListings] = useState([]);
  const [fiatRates, setFiatRates] = useState(null);
  const [selected, setSelected] = useState(null);
  const [orderFilterHint, setOrderFilterHint] = useState(null);
  const [editingListing, setEditingListing] = useState(null);
  const [orders, setOrders] = useState([]);
  // Cached active order count for glow badge on cold start (no auth needed)
  const [cachedOrderCount] = useState(() => { try { return parseInt(localStorage.getItem("sm_active_orders") || "0"); } catch { return 0; } });

  // Detect user's active federation
  const [myFederation, setMyFederation] = useState(null);
  useEffect(() => {
    (async () => {
      try {
        if (window.fediInternal && window.fediInternal.getAuthenticatedMember) {
          const member = await window.fediInternal.getAuthenticatedMember();
          if (member && member.id) {
            const parts = member.id.split(":");
            if (parts.length >= 2) setMyFederation(parts[parts.length - 1]);
          }
        }
      } catch {}
    })();
  }, []);

  // Deep-link: if arriving from escrow with an escrowId, find the linked order and open it
  useEffect(() => {
    if (!sessionReady || !initialEscrowId || !pubkey) return;
    if (initialEscrowId === "__HUB__") { setView("hub"); if (onOpened) onOpened(); return; }

    // Special marker: go directly to orders list (no API lookup)
    if (initialEscrowId === "__ORDERS__") {
    if (initialEscrowId === "__ORDERS_ALL__") {
      setView("orders");
      loadOrders();
      if (onOpened) onOpened();
      return;
    }
      setView("orders"); setOrderFilterHint("active");
      loadOrders();
      if (onOpened) onOpened();
      return;
    }

    (async () => {
      try {
        const data = await mapi(`/orders/by-escrow/${initialEscrowId}`);
        if (data.orderId) {
          const orderData = await mapi(`/orders/${data.orderId}`);
          if (orderData?.order) {
            setSelected(orderData.order);
            setView("orderDetail");
          } else {
            setView("orders");
          }
          loadOrders();
        } else {
          setView("orders");
          loadOrders();
        }
      } catch {
        setView("orders");
        loadOrders();
      }
      if (onOpened) onOpened();
    })();
  }, [initialEscrowId, pubkey, sessionReady]);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [profilePubkey, setProfilePubkey] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [toast, setToast] = useState({ msg: "", type: "ok", visible: false });
  const [locale, setLocaleState] = useState(getLocale);
  const toastTimer = useRef(null);

  useEffect(() => {
    if (devRole && isDevMode()) {
      _devPubkey = DEV_IDENTITIES[devRole];
      // Reload data for new role
      if (sessionReady) { loadListings(); loadOrders(); }
    }
  }, [devRole]);

  const showToast = useCallback((msg, type = "ok") => {
    clearTimeout(toastTimer.current);
    setToast({ msg, type, visible: true });
    const isFedError = type === "error" && (msg.includes("federation") || msg.includes("Federation"));
    const duration = isFedError ? 20000 : type === "error" ? 6000 : 3000;
    toastTimer.current = setTimeout(() => setToast(prev => ({ ...prev, visible: false })), duration);
  }, []);

  const switchLocale = useCallback((code) => {
    setLocale(code);

  // Watch for go-home signal from AppNavigator retap
  useEffect(() => {
    if (goHomeSignal > 0) setView("hub");
  }, [goHomeSignal]);

  // Fallback: listen for global go-home event
  useEffect(() => {
    const handler = () => setView("hub");
    window.addEventListener("sm-go-home", handler);
    return () => window.removeEventListener("sm-go-home", handler);
  }, []);

    setLocaleState(code);
  }, []);

  // ── Data loading (isolated loading states) ──────────────────────

  const loadListings = useCallback(async (query) => {
    // Show cached listings instantly while fetching fresh data
    const cacheKey = "sm_listings_cache";
    if (!query && listings.length === 0) {
      try {
        const cached = sessionStorage.getItem(cacheKey);
        if (cached) setListings(JSON.parse(cached));
      } catch {}
    }
    setBrowseLoading(true);
    try {
      const path = query ? `/?q=${encodeURIComponent(query)}` : "/";
      const [data, myData] = await Promise.all([
        mapi(path),
        mapi(`/?seller=${encodeURIComponent(pubkey)}&status=paused`).catch(() => ({ listings: [] })),
      ]);
      if (data.error) throw new Error(data.error);
      const active = data.listings || [];
      // Merge seller's own non-active listings (paused/deleted) that aren't already in results
      const myOwn = (myData.listings || []).filter(l => l.status !== "active" && l.status !== "deleted");
      const ids = new Set(active.map(l => l.id));
      const merged = [...active, ...myOwn.filter(l => !ids.has(l.id))];
      setListings(merged);
      // Cache for instant display on next visit
      if (!query) { try { sessionStorage.setItem(cacheKey, JSON.stringify(merged)); } catch {} }
    } catch (err) {
      console.error("[marketplace-ui] loadListings:", err);
      setListings([]);
    }
    setBrowseLoading(false);
  }, []);

  const loadOrders = useCallback(async () => {
    await getMSessionToken(); // ensure session before loading

    setOrdersLoading(true);
    try {
      // Fetch independently — if one fails, still show the other
      let buyerOrders = [], sellerOrders = [];
      try { const b = await mapi("/orders/mine?role=buyer"); buyerOrders = b.orders || []; } catch (e) { console.warn("[marketplace-ui] buyer orders FAILED:", e.message); ; }
      try { const s = await mapi("/orders/mine?role=seller"); sellerOrders = s.orders || []; } catch (e) { console.warn("[marketplace-ui] seller orders FAILED:", e.message); }
      const all = [...buyerOrders, ...sellerOrders];
      const seen = new Set();
      const unique = all.filter(o => { if (seen.has(o.id)) return false; seen.add(o.id); return true; });
      unique.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      const enriched = unique.map(o => ({
        ...o,
        isRepayment: (o.escrowDescription || "").startsWith("Loan Repayment:") || !!o.loanParentId,
        isLoanActive: (o.tradeType === "lending" || (o.listingTitle || "").includes("Lending:")) && o.status === "completed" && !o.loanFullyRepaid,
      }));
      setOrders(enriched);
      // Cache active count for glow badge on next cold start
      try { const ac = unique.filter(o => o.status === "pending" || o.status === "active").length; localStorage.setItem("sm_active_orders", String(ac)); } catch {}
    } catch (err) {
      console.error("[marketplace-ui] loadOrders:", err);
    }
    setOrdersLoading(false);
  }, []);

  // Auto-refresh orders every 30 seconds
  useEffect(() => {
    if (!sessionReady) return;
    const interval = setInterval(() => { loadOrders(); }, 30000);
    return () => clearInterval(interval);
  }, [sessionReady, loadOrders]);

  // Fetch fiat rates on mount (no auth needed)
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(MAPI + "/rates");
        if (r.ok) { const d = await r.json(); setFiatRates(d); }
      } catch {}
    })();
  }, []);

  // Re-load listings every time we switch TO browse view
  // Only refetch if stale (>30s) or empty
  const lastBrowseLoad = useRef(0);
  useEffect(() => {
    if (!sessionReady) return;
    // Load orders in background for badge count
    if (view === "browse" && orders.length === 0) {
      loadOrders();
    }
    if (view === "browse") {
      const now = Date.now();
      if (now - lastBrowseLoad.current > 30_000 || listings.length === 0) {
        lastBrowseLoad.current = now;
        loadListings(searchQuery);
      }
    }
  }, [view, sessionReady]);

  const openListing = async (id) => {
    const dest = "detail"; setPrevView(prev => prev === "billpay" ? "billpay" : view); setView(dest);
    setSelected(null);
    setActionLoading(true);
    try {
      const data = await mapi(`/${id}`);
      if (data.error) throw new Error(data.error);
      setSelected(data);
    } catch (err) { showToast(err.message, "error"); }
    setActionLoading(false);
  };

  const openOrders = async () => { navigateTo("orders"); loadOrders(); };

  const handleEdit = (listing) => { setEditingListing(listing); setView("edit"); };

  const handlePause = async (id) => {
    try {
      const res = await mapi(`/${id}/update`, { method: "POST", body: JSON.stringify({ status: "paused" }) });
      if (res.error) throw new Error(res.error);
      showToast("⏸ Listing paused");
      loadListings();
      setView("browse");
    } catch (err) { showToast(err.message, "error"); }
  };

  const handleUnpause = async (id) => {
    try {
      const FEDI_ROOMS = {
        en: "fedi:room:!kENaQZKCKhRhawCjxf:m1.8fa.in:::",
        fr: "fedi:room:!qHlVxBJBCKqUbetBnA:m1.8fa.in:::",
        };
      const body = { status: "active", communityLink: FEDI_ROOMS[getLocale()] || FEDI_ROOMS.en };
      const res = await mapi(`/${id}/update`, { method: "POST", body: JSON.stringify(body) });
      if (res.error) throw new Error(res.error);
      showToast("▶ Listing resumed");
      loadListings();
      setView("browse");
    } catch (err) { showToast(err.message, "error"); }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this listing? This cannot be undone.")) return;
    try {
      const res = await mapi(`/${id}/delete`, { method: "POST" });
      if (res.error) throw new Error(res.error);
      showToast("🗑 Listing deleted");
      loadListings();
      setView("browse");
    } catch (err) { showToast(err.message, "error"); }
  };

  const openProfile = (pk) => {
    setPrevView(view);
    setProfilePubkey(pk);
    setView("profile");
  };

  // ── Onboarding gate ─────────────────────────────────────────────
  if (!onboarded) return <MarketplaceOnboarding subdomain={subdomain} onComplete={() => setOnboarded(true)} />;

  return (
    <div className={lightMode ? "sm-light" : ""} style={M.root}>
      <style>{`
        *, *::before, *::after { -webkit-tap-highlight-color: rgba(0,0,0,0) !important; -webkit-touch-callout: none; box-sizing: border-box; }
        .sm-light { filter: invert(1) hue-rotate(180deg); }
        .sm-light img, .sm-light svg, .sm-light video, .sm-light canvas { filter: invert(1) hue-rotate(180deg); }
        button, a, input, select, textarea, [role="button"], div[onclick], span[onclick] {
          -webkit-tap-highlight-color: rgba(0,0,0,0) !important;
          -webkit-touch-callout: none !important;
          -webkit-appearance: none !important;
          outline: none !important;
          -webkit-user-select: none;
          user-select: none;
        }
        button:focus, button:active, button:focus-visible,
        a:focus, a:active, a:focus-visible,
        input:focus, input:focus-visible,
        select:focus, select:focus-visible {
          outline: none !important;
          box-shadow: none !important;
          -webkit-tap-highlight-color: rgba(0,0,0,0) !important;
        }
        button::-moz-focus-inner { border: 0 !important; }
        input, textarea { -webkit-user-select: auto; user-select: auto; }
        @keyframes slideUp { from { transform: translateY(16px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
        @keyframes vipReveal { 0% { filter: blur(8px); opacity: 0.5; transform: scale(0.95); } 100% { filter: blur(0); opacity: 1; transform: scale(1); } }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>

      {/* Light/Dark mode toggle */}
      <button onClick={() => { const next = !lightMode; setLightMode(next); try { localStorage.setItem("sm_lightmode", next ? "1" : "0"); } catch {} }} style={{ position: "fixed", top: 12, right: 12, width: 32, height: 32, borderRadius: "50%", border: "1px solid #334155", background: lightMode ? "#f8fafc" : "#1e293b", color: lightMode ? "#1e293b" : "#f8fafc", fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", zIndex: 999, boxShadow: "0 2px 8px rgba(0,0,0,0.3)" }}>
        {lightMode ? "☀️" : "🌙"}
      </button>
      <Toast {...toast} />

      {view === "hub" && ["market", "p2p", "lending"].includes(subdomain) && (
        <SubdomainHubView
          subdomain={subdomain}
          onBrowse={() => { setPrevView("hub"); setView("browse"); }}
          onCreate={() => { setPrevView("hub"); setView("create"); }}
          onOrders={() => { setPrevView("hub"); openOrders(); }}
          onBillPay={subdomain === "p2p" ? () => setView("billpay") : null}
          listingCount={listings.filter(l => l.sellerPubkey !== pubkey).length}
          activeOrderCount={orders.filter(o => o.status === "pending" || o.status === "active").length}
        />
      )}
      {view === "browse" && (
        <BrowseView
          listings={listings} loading={browseLoading} pubkey={pubkey}
          searchQuery={searchQuery} setSearchQuery={setSearchQuery}
          onSearch={(q) => { setSearchQuery(q); loadListings(q); }}
          onOpen={openListing}
          onCreate={() => { setPrevView("browse"); setView("create"); }}
          onOrders={openOrders}
          activeOrderCount={orders.length > 0 ? orders.filter(o => (o.status === "pending" || o.status === "active") && !o.isRepayment).length : cachedOrderCount}
          onRefresh={() => { loadListings(searchQuery); loadOrders(); }}
          onSwitchToEscrow={onSwitchToEscrow}
          onProfile={openProfile}
          locale={locale} onSwitchLocale={switchLocale}
          onChapSmart={() => setView("chapsmart")}
          subdomain={subdomain}
          myFederation={myFederation}
          onArbiters={() => setView("arbiters")}
          onFaq={() => setView("faq")}
          showToast={showToast}
        
          onBillPay={() => setView("billpay")} fiatRates={fiatRates}
          onHub={["market", "p2p", "lending"].includes(subdomain) ? () => setView("hub") : null}
          mapi={mapi} isDevMode={isDevMode} _isFediRuntime={_isFediRuntime}
        />
      )}
      {view === "edit" && editingListing && (
        <EditListingView
          listing={editingListing}
          onBack={(updated) => {
            setEditingListing(null);
            if (updated) { loadListings(); setSelected(updated.listing || updated); setView("detail"); }
            else setView("detail");
          }}
          showToast={showToast} loading={actionLoading} setLoading={setActionLoading}
         subdomain={subdomain} mapi={mapi}/>
      )}
      {view === "detail" && selected && (
        <ListingDetail
          listing={selected} pubkey={pubkey}
          onBack={() => { setSelected(null); setView(prevView || "hub"); }}
          onProfile={openProfile}
          onEdit={handleEdit}
          onPause={handlePause}
          onUnpause={handleUnpause}
          onDelete={handleDelete}
          onOrderCreated={(order) => { setSelected(order); setView("orderDetail"); }}
          showToast={showToast} loading={actionLoading} setLoading={setActionLoading}
          fiatRates={fiatRates}
         subdomain={subdomain} mapi={mapi} isDevMode={isDevMode}/>
      )}
      {view === "detail" && !selected && (
        <div style={M.container}>
          <div style={M.viewHeader}>
            <button style={M.iconBtn} onClick={() => setView("browse")}><Icons.Back /></button>
            <h2 style={M.viewTitle}>{t("mkListing")}</h2>
            <div style={{ width: 36 }} />
          </div>
          <div style={{ display: "flex", justifyContent: "center", paddingTop: "20vh" }}>
            <div style={{ width: 20, height: 20, border: "2px solid #1e293b", borderTopColor: "#475569", borderRadius: "50%", animation: "spin 0.6s linear infinite" }} />
          </div>
        </div>
      )}
            {view === "billpay" && (
        <BillPayView
          listings={listings} loading={browseLoading} pubkey={pubkey}
          onBack={() => setView(["market","p2p","lending"].includes(subdomain) ? "hub" : "browse")}

          onBrowse={() => { setPrevView("hub"); setView("browse"); }}
          onCreate={() => { setPrevView("billpay"); setView("create"); }}
          onOpen={(id) => { setPrevView("billpay"); openListing(id); }}
          onOrders={() => { setPrevView("billpay"); navigateTo("orders"); loadOrders(); }}
          onRefresh={() => { loadListings(); }}
          fiatRates={fiatRates} showToast={showToast} subdomain={subdomain}
          activeOrderCount={orders.filter(o => o.status === "pending" || o.status === "active").length}
          mapi={mapi} isDevMode={isDevMode}
        />
      )}
      {view === "create" && (
        <CreateListingView
          pubkey={pubkey}
          subdomain={subdomain}
          myFederation={myFederation}
          onBack={() => setView(["market","p2p","lending"].includes(subdomain) ? (prevView === "billpay" ? "billpay" : "hub") : "browse")}
          onCreated={(id) => { setPrevView(prevView); openListing(id); }}
          showToast={showToast} loading={actionLoading} setLoading={setActionLoading}
          mapi={mapi} isDevMode={isDevMode}
        />
      )}
      {view === "orders" && (
        <OrdersView
          orders={orders} loading={ordersLoading} pubkey={pubkey}
          onBack={() => setView(["market","p2p","lending"].includes(subdomain) ? (prevView === "billpay" ? "billpay" : "hub") : "browse")}
          onRefresh={loadOrders}
          onOpenOrder={(order) => { setSelected(order); navigateTo("orderDetail"); }}
          onProfile={openProfile}
          fiatRates={fiatRates}
          initialFilter={orderFilterHint}
          onFilterConsumed={() => setOrderFilterHint(null)} subdomain={subdomain}
        />
      )}
      {view === "orderDetail" && selected && (
        <OrderDetailView
          order={selected} pubkey={pubkey}
          onBack={() => { const s = selected?.status; setSelected(null); if (prevView === "billpay") { setView("billpay"); } else { openOrders(); if (s === "completed") setTimeout(() => setOrderFilter("completed"), 50); else if (s === "cancelled" || s === "expired") setTimeout(() => setOrderFilter("cancelled"), 50); } }}
          onProfile={openProfile}
          onSwitchToEscrow={onSwitchToEscrow}
          showToast={showToast} loading={actionLoading} setLoading={setActionLoading}
          fiatRates={fiatRates}
         subdomain={subdomain} mapi={mapi}/>
      )}
      {view === "chapsmart" && (
        <ChapSmartView
          onBack={() => setView("browse")}
          showToast={showToast}
          pubkey={pubkey}
        />
      )}
      {view === "arbiters" && (
        <ArbiterRecruitmentView pubkey={pubkey} onBack={() => setView("browse")} showToast={showToast} mapi={mapi} />
      )}
      {view === "faq" && (
        <FAQView onBack={() => setView("browse")} />
      )}
      {view === "profile" && profilePubkey && (
        <SellerProfileView
          pubkey={profilePubkey} myPubkey={pubkey}
          onBack={() => { setProfilePubkey(null); setView(prevView || "browse"); }}
          onOpen={openListing}
          showToast={showToast} mapi={mapi}
        />
      )}
      {/* FUTURE: Re-enable notifications for PWA/Start9/Umbrel */}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// MARKETPLACE ONBOARDING — First-time welcome + how it works
// ═══════════════════════════════════════════════════════════════════════

const MK_ONBOARDING_KEY = "fedi-marketplace-onboarded";

function MarketplaceOnboarding({ onComplete, subdomain }) {
  const [step, setStep] = useState(0);
  const isBrowser = isDevMode();

  const steps = [
    {
      icon: "🏪",
      title: subdomain === "p2p" ? "Welcome to P2P Exchange"
        : subdomain === "market" ? "Welcome to the Marketplace"
        : subdomain === "lending" ? "Welcome to Community Lending"
        : "Welcome to SatoshiMarket",
      desc: isBrowser
        ? subdomain === "p2p" ? "Buy and sell Bitcoin peer-to-peer. Secured by 2-of-3 escrow."
        : subdomain === "lending" ? "Community lending powered by Bitcoin. Loan and borrow with escrow protection."
        : "A Bitcoin-native marketplace powered by federated e-cash. Browse, buy, and sell — all secured by escrow."
        : subdomain === "p2p" ? "Trade Bitcoin for fiat with your community. Every trade protected by 2-of-3 escrow."
        : subdomain === "lending" ? "Lend and borrow Bitcoin within your community. Escrow protects both parties."
        : "Buy and sell anything with your community. Every trade is protected by 2-of-3 escrow — no trust needed.",
    },
    {
      icon: "🔒",
      title: subdomain === "lending" ? "Your Sats Are Protected" : subdomain === "p2p" ? "Trade With Confidence" : "The Escrow Protects You",
      desc: subdomain === "lending"
        ? "When you borrow, the lender locks sats in escrow. When you lend, the borrower cannot run away. Automatic repayment tracking and trust-based lending levels keep everyone honest."
        : subdomain === "p2p"
        ? "When you trade, sats are locked in escrow until fiat payment is confirmed. Neither party can cheat. If there is a dispute, a community arbiter resolves it."
        : "When you buy, sats are locked in escrow. When you sell, you do not ship until payment is locked. If there is a dispute, the community arbiter resolves it.",
    },
    {
      icon: "⚡",
      title: isBrowser ? "Try it in Sandbox" : "You're Ready!",
      desc: isBrowser
        ? "This is a demo — explore listings, create test trades, and see how escrow works. For real trades, download the Fedi app!"
        : "Pay a bill, trade sats, buy something, or lend to your community. Need help? Tap Support below.",
    },
  ];

  const s = steps[step];
  const isLast = step === steps.length - 1;

  const handleNext = () => {
    if (isLast) { try { localStorage.setItem(MK_ONBOARDING_KEY, "1"); } catch {} onComplete(); }
    else setStep(step + 1);
  };

  return (
    <div style={{ ...M.root, display: "flex", flexDirection: "column", alignItems: "center", padding: "0 24px", textAlign: "center", flex: 1, overflow: "auto" }}>
      <style>{`@keyframes obFadeUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }`}</style>

      {/* ── Center content ── */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", flex: 1, width: "100%", maxWidth: 340, minHeight: 0 }}>
        {isBrowser && (
          <div style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 14px", borderRadius: 99, background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.2)", marginBottom: 16 }}>
            <span style={{ fontSize: 12 }}>🧪</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: "#f59e0b", letterSpacing: 0.5 }}>SANDBOX MODE</span>
          </div>
        )}

        <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
          {steps.map((_, i) => (
            <div key={i} style={{ width: i === step ? 24 : 8, height: 8, borderRadius: 4, background: i <= step ? "#f59e0b" : "#1e293b", transition: "all 0.3s ease" }} />
          ))}
        </div>

        <div key={step} style={{ marginBottom: 14, animation: "obFadeUp 0.4s ease-out" }}>
          {step === 0
            ? <img src="/satoshimarket-logo.png" alt="SatoshiMarket" style={{ height: 96, objectFit: "contain" }} />
            : <span style={{ fontSize: 44 }}>{s.icon}</span>
          }
        </div>

        <div key={`t-${step}`} style={{ animation: "obFadeUp 0.4s ease-out 0.1s both" }}>
          <h1 style={{ fontSize: 19, fontWeight: 700, color: "#f8fafc", margin: "0 0 8px", letterSpacing: -0.5 }}>{s.title}</h1>
          <p style={{ fontSize: 13, color: "#94a3b8", lineHeight: 1.6, margin: 0 }}>{s.desc}</p>
          {isLast && (
            <div style={{ marginTop: 16, textAlign: "center", width: "100%" }}>
              {isBrowser ? (
                <>
                  {/* Step 1 */}
                  <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", marginBottom: 10, borderRadius: 10, background: "rgba(16,185,129,0.06)", border: "1px solid rgba(16,185,129,0.15)", textAlign: "left" }}>
                    <span style={{ fontSize: 22, flexShrink: 0 }}>1️⃣</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: "#10b981", marginBottom: 6 }}>Download Fedi (free)</div>
                      <a href="https://fedi.xyz/product" target="_blank" rel="noopener noreferrer" style={{
                        display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 8,
                        background: "linear-gradient(135deg, #10b981, #059669)", color: "#fff", fontSize: 12, fontWeight: 700, textDecoration: "none",
                      }}>📲 Get Fedi</a>
                    </div>
                  </div>
                  {/* Step 2 — the magic link */}
                  <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderRadius: 10, background: "rgba(245,158,11,0.06)", border: "1.5px solid rgba(245,158,11,0.25)", textAlign: "left" }}>
                    <span style={{ fontSize: 22, flexShrink: 0 }}>2️⃣</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: "#f59e0b", marginBottom: 2 }}>Come back and tap below</div>
                      <div style={{ fontSize: 10, color: "#64748b", marginBottom: 8 }}>Don't even open Fedi — just tap this</div>
                      <a href="https://app.fedi.xyz/link#screen=join&id=fed11qgqyj3mfwfhksw309ajrwvmxvenxgvpkvyursenxxvur2c3sv4jkxdfcxf3kgdmyvs6nzcehvc6xzctzxumrxdmr89jnwdtpv5enqwtpxqmrsvfh89skxv34qqqjpzytwrkr28r8mjas4ej467utd7excr7fapj7ukgc4ugacm6nu2u73k7ram" target="_blank" rel="noopener noreferrer" style={{
                        display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: 8,
                        background: "linear-gradient(135deg, #f59e0b, #d97706)", color: "#0c0f17", fontSize: 12, fontWeight: 800, textDecoration: "none",
                      }}>⚡ Join Bitcoin Life</a>
                      <div style={{ fontSize: 9, color: "#475569", marginTop: 6 }}>Wallet · federation · community · SatoshiMarket</div>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div style={{ fontSize: 13, color: "#10b981", fontWeight: 700, textAlign: "center", marginBottom: 12 }}>{"🎉"} You're in! No registration needed.</div>
                  <div style={{ fontSize: 11, color: "#94a3b8", textAlign: "center", marginBottom: 16, lineHeight: 1.5 }}>Your wallet is ready. Your community is connected. Start exploring.</div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#a78bfa", marginBottom: 4 }}>Need help? We're one tap away</div>
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "center", marginTop: 8 }}>
                    <a href="fedi:room:!kENaQZKCKhRhawCjxf:m1.8fa.in:::" style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "8px 14px", borderRadius: 8, background: "rgba(139,92,246,0.08)", border: "1px solid rgba(139,92,246,0.2)", color: "#a78bfa", fontSize: 12, fontWeight: 600, textDecoration: "none" }}>{"💬"} Support (EN)</a>
                    <a href="fedi:room:!qHlVxBJBCKqUbetBnA:m1.8fa.in:::" style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "8px 14px", borderRadius: 8, background: "rgba(139,92,246,0.08)", border: "1px solid rgba(139,92,246,0.2)", color: "#a78bfa", fontSize: 12, fontWeight: 600, textDecoration: "none" }}>{"💬"} Support (FR)</a>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

      </div>

      {/* ── Buttons — pinned above genesis footer, always visible ── */}
      <div style={{ width: "100%", maxWidth: 340, padding: "20px 0 0", flexShrink: 0 }}>
          <button onClick={handleNext} style={{ width: "100%", padding: "14px 0", borderRadius: 12, background: isLast ? "#f59e0b" : "transparent", border: isLast ? "none" : "1.5px solid #334155", color: isLast ? "#0c0f17" : "#f8fafc", fontSize: 15, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
            {isLast ? (isBrowser ? "🧪 Explore Demo" : subdomain === "p2p" ? "₿ Start Trading" : subdomain === "lending" ? "🤝 Start Lending" : subdomain === "market" ? "🛒 Enter Market" : "🏪 Enter Market") : "Next →"}
          </button>
          {!isLast && (
            <button onClick={() => { try { localStorage.setItem(MK_ONBOARDING_KEY, "1"); } catch {} onComplete(); }}
              style={{ width: "100%", padding: "8px 0", marginTop: 4, background: "transparent", border: "none", color: "#475569", fontSize: 13, cursor: "pointer" }}>
              Skip
            </button>
          )}
      </div>

      {/* ── Genesis mark — hidden in browser (sandbox bar already takes space) ── */}
      {!isBrowser && <div style={{ flexShrink: 0, padding: "10px 0", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
        <span style={{ fontSize: 9 }}>⚡</span>
        <span style={{ fontSize: 8, fontWeight: 600, color: "#334155", letterSpacing: 1.2 }}>EST. BLOCK 934,669</span>
        <span style={{ fontSize: 9 }}>🥜</span>
        <span style={{ color: "#1e293b" }}>·</span>
        <span style={{ fontSize: 8, color: "#1e293b" }}>Open source</span>
        <a href="https://github.com/jesuspirate/federated-escrow" target="_blank" rel="noopener noreferrer" style={{ fontSize: 8, color: "#4c1d95", textDecoration: "none", fontWeight: 600 }}>GitHub ↗</a>
      </div>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// CATEGORY QUICK-FILTERS
// ═══════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════
// GLOBE LANG PICKER — collapses 4 flag buttons into a single globe icon
// ═══════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════
// EDIT LISTING VIEW — seller can update title, description, price, qty
// ═══════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════
// LISTING DETAIL
// ═══════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════
// CREATE LISTING VIEW
// ═══════════════════════════════════════════════════════════════════════

// =====================================================================
// BILL PAY VIEW - Simplified two-door flow
// "I need fiat for a bill" / "I want to buy sats"
// =====================================================================

// ═══════════════════════════════════════════════════════════════════════
// SELLER PROFILE VIEW
// ═══════════════════════════════════════════════════════════════════════

