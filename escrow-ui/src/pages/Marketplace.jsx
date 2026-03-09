import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { t, getLocale, getAvailableLocales, setLocale } from "./i18n";
// FUTURE: Re-enable for PWA/Start9/Umbrel push notifications
//import NotificationSettings, { NotifBellIcon } from "./NotificationSettings";

// ═══════════════════════════════════════════════════════════════════════
// Fedi Mini-App: Marketplace v2.0
// Community homepage • Onboarding • Category filters • Deep-link escrow
// NIP-98 Nostr auth • Fedi + browser sandbox
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

async function mapi(path, opts = {}, _retries = 1) {
  const method = opts.method || "GET";
  const url = `${location.origin}${MAPI}${path}`;
  const headers = { "Content-Type": "application/json" };

  // Public GET routes (browse, detail) don't need auth.
  const needsAuth = method !== "GET" || path.includes("/orders");

  if (needsAuth) {
    try {
      const nip98 = await getCachedNip98Header(url, method);
      if (nip98) headers["Authorization"] = nip98;
      else if (_devPubkey) headers["X-Dev-Pubkey"] = _devPubkey;
    } catch (err) {
      if (err.name === "NostrRejectedError") {
        if (method !== "GET") throw err;
        if (_retries > 0) return mapi(path, opts, _retries - 1);
      }
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
function fmtVolume(msats) {
  const sats = Math.floor(msats / 1000);
  if (sats >= 1_000_000_000) return `${(sats / 1_000_000_000).toFixed(1)}B`;
  if (sats >= 1_000_000) return `${(sats / 1_000_000).toFixed(1)}M`;
  if (sats >= 100_000) return `${(sats / 1_000).toFixed(0)}K`;
  if (sats >= 10_000) return `${(sats / 1_000).toFixed(1)}K`;
  if (sats >= 1_000) return `${(sats / 1_000).toFixed(1)}K`;
  return sats.toLocaleString();
}
function truncPk(hex) {
  if (!hex || hex.length < 16) return hex || "";
  return hex.slice(0, 8) + "\u2026" + hex.slice(-8);
}

// ── Trade Type Detection ────────────────────────────────────────────
const SATS_FOR_FIAT = "sats-for-fiat";
const LENDING = "lending";
function isSatsForFiat(category) { return category?.toLowerCase().trim() === SATS_FOR_FIAT; }
function isLending(category) { return category?.toLowerCase().trim() === LENDING; }
function isSpecialCategory(category) { return isSatsForFiat(category) || isLending(category); }

// ── Nostr Profile Lookup (client-side, no server relay needed) ────────

const _nostrProfileCache = new Map(); // pubkey → { name, picture, about, nip05, fetched }

// Seed from sessionStorage — profiles survive navigation without re-fetching
try {
  const stored = sessionStorage.getItem("nostr_profile_cache");
  if (stored) Object.entries(JSON.parse(stored)).forEach(([k, v]) => _nostrProfileCache.set(k, v));
} catch {}

const _pendingFetches = new Map(); // dedup simultaneous fetches for same pubkey
const NOSTR_RELAYS = ["wss://relay.damus.io", "wss://nos.lol", "wss://relay.nostr.band"];

async function fetchNostrProfile(pubkey) {
  if (_nostrProfileCache.has(pubkey)) return _nostrProfileCache.get(pubkey);

  // Mark as fetching to avoid duplicate requests
  const placeholder = { name: null, picture: null, about: null, nip05: null, fetched: false };
  _nostrProfileCache.set(pubkey, placeholder);

  const fetchPromise = _doFetchNostrProfile(pubkey);
  _pendingFetches.set(pubkey, fetchPromise);
  fetchPromise.finally(() => _pendingFetches.delete(pubkey));
  return fetchPromise;
}

async function _doFetchNostrProfile(pubkey) {
  const placeholder = _nostrProfileCache.get(pubkey);

  return new Promise((resolve) => {
    let resolved = false;
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        placeholder.fetched = true;
        resolve(placeholder);
      }
    }, 4000);

    // Use only the first relay with a hard 3s timeout to avoid blocking renders
    for (const relay of NOSTR_RELAYS.slice(0, 1)) {
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
              // Persist to sessionStorage for fast re-use across navigation
              try {
                const existing = JSON.parse(sessionStorage.getItem("nostr_profile_cache") || "{}");
                existing[pubkey] = profile;
                sessionStorage.setItem("nostr_profile_cache", JSON.stringify(existing));
              } catch {}
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
    // If already cached with a real name, use it immediately
    if (_nostrProfileCache.has(pubkey) && _nostrProfileCache.get(pubkey).name) {
      setProfile(_nostrProfileCache.get(pubkey));
      return;
    }
    let cancelled = false;
    // Delay 400ms — prevents N simultaneous WebSockets on initial render
    const timer = setTimeout(() => {
      fetchNostrProfile(pubkey).then(p => { if (!cancelled) setProfile(p); });
    }, 400);
    return () => { cancelled = true; clearTimeout(timer); };
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

export default function Marketplace({ pubkey, devRole, onSwitchToEscrow, initialEscrowId, onOpened }) {
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
  const [view, setView] = useState("browse");
  const [listings, setListings] = useState([]);
  const [selected, setSelected] = useState(null);
  const [editingListing, setEditingListing] = useState(null);
  const [orders, setOrders] = useState([]);

  // Deep-link: if arriving from escrow with an escrowId, find the linked order and open it
  useEffect(() => {
    if (!initialEscrowId || !pubkey) return;
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
  }, [initialEscrowId, pubkey]);
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
      loadListings();
      loadOrders();
    }
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
  // Only refetch if stale (>30s) or empty
  const lastBrowseLoad = useRef(0);
  useEffect(() => {
    if (view === "browse") {
      const now = Date.now();
      if (now - lastBrowseLoad.current > 30_000 || listings.length === 0) {
        lastBrowseLoad.current = now;
        loadListings(searchQuery);
      }
    }
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
    setProfilePubkey(pk);
    setView("profile");
  };

  // ── Onboarding gate ─────────────────────────────────────────────
  if (!onboarded) return <MarketplaceOnboarding onComplete={() => setOnboarded(true)} />;

  return (
    <div style={M.root}>
      <style>{`
        *, *::before, *::after { -webkit-tap-highlight-color: rgba(0,0,0,0) !important; -webkit-touch-callout: none; box-sizing: border-box; }
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
      {view === "edit" && editingListing && (
        <EditListingView
          listing={editingListing}
          onBack={(updated) => {
            setEditingListing(null);
            if (updated) { loadListings(); setView("browse"); }
            else setView("detail");
          }}
          showToast={showToast} loading={actionLoading} setLoading={setActionLoading}
        />
      )}
      {view === "detail" && selected && (
        <ListingDetail
          listing={selected} pubkey={pubkey}
          onBack={() => { setSelected(null); setView("browse"); }}
          onProfile={openProfile}
          onEdit={handleEdit}
          onPause={handlePause}
          onUnpause={handleUnpause}
          onDelete={handleDelete}
          onOrderCreated={(order) => { setSelected(order); setView("orderDetail"); loadOrders(); }}
          showToast={showToast} loading={actionLoading} setLoading={setActionLoading}
        />
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
      {/* FUTURE: Re-enable notifications for PWA/Start9/Umbrel */}
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
    <div style={{ ...M.root, display: "flex", flexDirection: "column", alignItems: "center", padding: "0 24px", textAlign: "center", height: "100dvh", maxHeight: "100vh", overflow: "hidden" }}>
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

        <div key={step} style={{ fontSize: 44, marginBottom: 14, animation: "obFadeUp 0.4s ease-out" }}>{s.icon}</div>

        <div key={`t-${step}`} style={{ animation: "obFadeUp 0.4s ease-out 0.1s both" }}>
          <h1 style={{ fontSize: 19, fontWeight: 700, color: "#f8fafc", margin: "0 0 8px", letterSpacing: -0.5 }}>{s.title}</h1>
          <p style={{ fontSize: 13, color: "#94a3b8", lineHeight: 1.6, margin: 0 }}>{s.desc}</p>
        </div>

        {/* ── Buttons right under content ── */}
        <div style={{ width: "100%", marginTop: 28 }}>
          <button onClick={handleNext} style={{ width: "100%", padding: "14px 0", borderRadius: 12, background: isLast ? "#f59e0b" : "transparent", border: isLast ? "none" : "1.5px solid #334155", color: isLast ? "#0c0f17" : "#f8fafc", fontSize: 15, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
            {isLast ? (isBrowser ? "🧪 Explore Demo" : "🏪 Enter Market") : "Next →"}
          </button>
          {!isLast && (
            <button onClick={() => { try { localStorage.setItem(MK_ONBOARDING_KEY, "1"); } catch {} onComplete(); }}
              style={{ width: "100%", padding: "8px 0", marginTop: 4, background: "transparent", border: "none", color: "#475569", fontSize: 13, cursor: "pointer" }}>
              Skip
            </button>
          )}
        </div>
      </div>

      {/* ── Genesis mark — pinned at bottom ── */}
      <div style={{ flexShrink: 0, padding: "10px 0", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
        <span style={{ fontSize: 9 }}>⚡</span>
        <span style={{ fontSize: 8, fontWeight: 600, color: "#334155", letterSpacing: 1.2 }}>EST. BLOCK 934,669</span>
        <span style={{ fontSize: 9 }}>🥜</span>
        <span style={{ color: "#1e293b" }}>·</span>
        <span style={{ fontSize: 8, color: "#1e293b" }}>Open source</span>
        <a href="https://github.com/jesuspirate/federated-escrow" target="_blank" rel="noopener noreferrer" style={{ fontSize: 8, color: "#4c1d95", textDecoration: "none", fontWeight: 600 }}>GitHub ↗</a>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// CATEGORY QUICK-FILTERS
// ═══════════════════════════════════════════════════════════════════════

const CATEGORIES = [
  { key: "all", label: "All", icon: "🏪" },
  { key: "sats-for-fiat", label: "P2P", icon: "₿" },
  { key: "lending", label: "Lending", icon: "🤝" },
  { key: "electronics", label: "Electronics", icon: "📱" },
  { key: "services", label: "Services", icon: "🛠️" },
  { key: "digital", label: "Digital", icon: "💾" },
  { key: "clothing", label: "Clothing", icon: "👕" },
  { key: "other", label: "Other", icon: "📦" },
];

// ═══════════════════════════════════════════════════════════════════════
// NEW TO BITCOIN / FEDI — Collapsible education banner
// ═══════════════════════════════════════════════════════════════════════

const LEARN_DISMISSED_KEY = "fedi-mk-learn-dismissed";

function NewToFediBanner() {
  if (_isFediApp) return null;  // User is already in Fedi
  // ... rest unchanged
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(LEARN_DISMISSED_KEY) === "1"; } catch { return false; }
  });
  const [expanded, setExpanded] = useState(false);

  if (dismissed) return null;

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
          New to Bitcoin or Fedi?
        </span>
        <span style={{ fontSize: 11, color: "#f59e0b", fontWeight: 600, transform: expanded ? "rotate(180deg)" : "rotate(0)", transition: "transform 0.2s" }}>▼</span>
      </button>

      {expanded && (
        <div style={{ padding: "0 14px 14px", animation: "slideUp 0.2s ease-out" }}>
          <div style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.7, marginBottom: 12 }}>
            This marketplace runs on Bitcoin through the Fedi app. Trades are secured by <strong style={{ color: "#f59e0b" }}>2-of-3 escrow</strong> — no trust needed between buyer and seller.
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <a href="https://bitcoin.org/en/getting-started" target="_blank" rel="noopener noreferrer" style={{
              display: "inline-flex", alignItems: "center", gap: 5, padding: "8px 14px", borderRadius: 8,
              background: "rgba(247,147,26,0.06)", border: "1px solid rgba(247,147,26,0.15)",
              color: "#f7931a", fontSize: 12, fontWeight: 600, textDecoration: "none",
            }}>
              ₿ What is Bitcoin?
            </a>
            <a href="https://www.fedi.xyz" target="_blank" rel="noopener noreferrer" style={{
              display: "inline-flex", alignItems: "center", gap: 5, padding: "8px 14px", borderRadius: 8,
              background: "rgba(139,92,246,0.06)", border: "1px solid rgba(139,92,246,0.15)",
              color: "#a78bfa", fontSize: 12, fontWeight: 600, textDecoration: "none",
            }}>
              🛡️ What is Fedi?
            </a>
            <a href="https://fedi.xyz/product" target="_blank" rel="noopener noreferrer" style={{
              display: "inline-flex", alignItems: "center", gap: 5, padding: "8px 14px", borderRadius: 8,
              background: "rgba(16,185,129,0.06)", border: "1px solid rgba(16,185,129,0.15)",
              color: "#10b981", fontSize: 12, fontWeight: 600, textDecoration: "none",
            }}>
              📲 Download Fedi
            </a>
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


// ═══════════════════════════════════════════════════════════════════════
// GLOBE LANG PICKER — collapses 4 flag buttons into a single globe icon
// ═══════════════════════════════════════════════════════════════════════
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

// ═══════════════════════════════════════════════════════════════════════
// BROWSE VIEW — Community homepage with hero + categories
// ═══════════════════════════════════════════════════════════════════════

function BrowseView({ listings, loading, pubkey, searchQuery, setSearchQuery, onSearch, onOpen, onCreate, onOrders, onNotifications, onRefresh, onSwitchToEscrow, onProfile, locale, onSwitchLocale }) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [activeCategory, setActiveCategory] = useState("all");
  const p2pCount = useMemo(() => listings.filter(l => isSatsForFiat(l.category)).length, [listings]);
  const lendingCount = useMemo(() => listings.filter(l => isLending(l.category)).length, [listings]);
  const filteredListings = (activeCategory === "all"
    ? listings
    : listings.filter(l => {
        if (activeCategory === "sats-for-fiat") return isSatsForFiat(l.category);
        if (activeCategory === "lending") return isLending(l.category);
	// Exclude special categories from other category matches
        if (isSpecialCategory(l.category)) return false;
        return l.category?.toLowerCase() === activeCategory;
      })
  ).slice().sort((a, b) => {
    // Urgent (1 left) first, then available, then sold out
    const rank = (l) => l.quantity === 1 ? 0 : l.quantity > 1 ? 1 : 2;
    return rank(a) - rank(b);
  });

  return (
    <div style={{ ...M.container, display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
      {/* ══ PINNED HEADER SECTION ══ */}
      <div style={{ flexShrink: 0 }}>
        <div style={M.header}>
          <div>
            <h1 style={M.title}>🏪 {t("mkTitle")}</h1>
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
            <span><span style={{ fontWeight: 800, color: "#a78bfa" }}>{listings.length - p2pCount - lendingCount}</span> listings</span>
            {p2pCount > 0 && <span><span style={{ fontWeight: 800, color: "#f59e0b" }}>{p2pCount}</span> P2P</span>}
            {lendingCount > 0 && <span><span style={{ fontWeight: 800, color: "#10b981" }}>{lendingCount}</span> loans</span>}
            <span style={{ marginLeft: "auto", color: "#475569" }}>2-of-3 escrow</span>
          </div>
        )}

        {searchOpen && (
          <div style={{ display: "flex", gap: 8, marginBottom: 10, animation: "slideUp 0.2s ease-out" }}>
            <input style={M.input} placeholder={t("mkSearchPlaceholder") || "Search by title, description, or category..."} value={searchQuery} onChange={e => setSearchQuery(e.target.value)} onKeyDown={e => e.key === "Enter" && onSearch(searchQuery)} autoFocus />
            {searchQuery && <button style={M.iconBtn} onClick={() => { setSearchQuery(""); onSearch(""); }}><Icons.X /></button>}
          </div>
        )}

        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          <button style={{ ...M.primaryBtn, flex: 1, minWidth: 0, justifyContent: "center" }} onClick={onCreate}><Icons.Plus /> {t("mkSell")}</button>
          <button style={{ ...M.secondaryBtn, flex: 1, minWidth: 0, justifyContent: "center" }} onClick={onOrders}><Icons.Package /> {t("mkOrders")}</button>
        </div>

        {/* ── Category quick-filters ── */}
        <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 10, WebkitOverflowScrolling: "touch", scrollbarWidth: "none" }}>
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
      </div>

      {/* ══ SCROLLABLE LISTINGS AREA ══ */}
      <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden", WebkitOverflowScrolling: "touch" }}>

      {/* ── New to Bitcoin / Fedi? ── */}
      <NewToFediBanner />

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
          {filteredListings.map(l => (
            <button key={l.id} style={{ ...M.listingCard, ...(l.status === "paused" ? { opacity: 0.55, borderColor: "#334155" } : l.quantity <= 0 ? { opacity: 0.45, borderColor: "#334155" } : {}) }} onClick={() => onOpen(l.id)}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={M.cardTitle}>{l.title}</span>
		<span style={M.cardPrice}><span style={{ color: "#f7931a", fontSize: 14 }}>₿</span> {fmtSats(l.priceMsats)}</span>
              </div>
              {l.description && <p style={M.cardDesc}>{l.description}</p>}
              <div style={M.cardMeta}>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  {l.status === "paused" && <span style={{ padding: "2px 8px", borderRadius: 6, fontSize: 10, fontWeight: 700, background: "rgba(100,116,139,0.2)", color: "#94a3b8", border: "1px solid #334155" }}>⏸ {t("mkStatusPaused")}</span>}
                  {l.condition && !isSatsForFiat(l.category) && !isLending(l.category) && l.status !== "paused" && <span style={M.conditionBadge}>{t(CONDITION_KEYS[l.condition] || l.condition)}</span>}
                  {l.category && <span style={{
                    ...M.categoryBadge,
                    ...(isSatsForFiat(l.category) ? { background: "rgba(245,158,11,0.15)", color: "#f59e0b", fontWeight: 700 } : isLending(l.category) ? { background: "rgba(16,185,129,0.15)", color: "#10b981", fontWeight: 700 } : {}),
                  }}>{isSatsForFiat(l.category) ? "₿ P2P Trade" : isLending(l.category) ? "🤝 Lending" : l.category}</span>}
                </div>
                <span style={{ fontSize: 12, fontWeight: 600, ...(l.status === "paused" ? { color: "#64748b" } : l.quantity > 1 ? { color: "#10b981" } : l.quantity === 1 ? { color: "#f59e0b", animation: "pulse 2s ease infinite" } : { color: "#ef4444" }) }}>
                  {l.status === "paused" ? "⏸ Paused" : l.quantity > 1 ? `🟢 ${t("mkQtyAvailable", { qty: l.quantity })}` : l.quantity === 1 ? `🔥 ${t("mkQtyOneLeft")}` : `❌ ${t("mkQtySoldOut")}`}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}

      </div>{/* end scrollable */}

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
          <button onClick={() => onSwitchToEscrow()} style={{ fontSize: 9, color: "#334155", background: "none", border: "none", cursor: "pointer", padding: 0, textDecoration: "none" }}>⚖️ Advanced</button>
          <span style={{ color: "#1e293b" }}>·</span>
          <a href="https://github.com/jesuspirate/federated-escrow" target="_blank" rel="noopener noreferrer" style={{ fontSize: 9, color: "#6d28d9", textDecoration: "none", fontWeight: 600 }}>GitHub ↗</a>
        </div>
      </div>
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════════
// EDIT LISTING VIEW — seller can update title, description, price, qty
// ═══════════════════════════════════════════════════════════════════════
function EditListingView({ listing: l, onBack, showToast, loading, setLoading }) {
  const [title, setTitle] = useState(l.title || "");
  const [description, setDescription] = useState(l.description || "");
  const [price, setPrice] = useState(l.priceMsats ? Math.floor(l.priceMsats / 1000) : "");
  const [terms, setTerms] = useState(l.terms || "");
  const [quantity, setQuantity] = useState(l.quantity ?? 1);

  const handleSave = async () => {
    if (!title.trim()) return showToast("Title is required", "error");
    if (!price || Number(price) <= 0) return showToast("Price must be positive", "error");
    setLoading(true);
    try {
      const res = await mapi(`/${l.id}/update`, {
        method: "POST",
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          priceMsats: Number(price) * 1000,
          terms: terms.trim(),
          quantity: Number(quantity),
        }),
      });
      if (res.error) throw new Error(res.error);
      showToast("✅ Listing updated!");
      onBack(res); // pass updated listing back
    } catch (err) {
      showToast(err.message, "error");
    }
    setLoading(false);
  };

  return (
    <div style={M.container}>
      <div style={M.header}>
        <button style={M.backBtn} onClick={() => onBack(null)}>←</button>
        <span style={M.headerTitle}>Edit Listing</span>
        <div style={{ width: 32 }} />
      </div>

      <div style={{ padding: "0 0 100px" }}>
        <div style={{ marginBottom: 14 }}>
          <div style={M.sectionLabel}>Title *</div>
          <input style={M.input} value={title} onChange={e => setTitle(e.target.value)} placeholder="What are you selling?" maxLength={120} />
        </div>

        <div style={{ marginBottom: 14 }}>
          <div style={M.sectionLabel}>Description</div>
          <textarea style={{ ...M.input, minHeight: 80, resize: "vertical" }} value={description} onChange={e => setDescription(e.target.value)} placeholder="Describe your item..." maxLength={2000} />
        </div>

        <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
          <div style={{ flex: 1 }}>
            <div style={M.sectionLabel}>Price (sats) *</div>
            <input style={M.input} type="number" value={price} onChange={e => setPrice(e.target.value)} placeholder="e.g. 5000" min={1} />
          </div>
          <div style={{ width: 90 }}>
            <div style={M.sectionLabel}>Quantity</div>
            <input style={M.input} type="number" value={quantity} onChange={e => setQuantity(e.target.value)} min={1} max={999} />
          </div>
        </div>

        <div style={{ marginBottom: 20 }}>
          <div style={M.sectionLabel}>Trade Terms</div>
          <textarea style={{ ...M.input, minHeight: 60, resize: "vertical" }} value={terms} onChange={e => setTerms(e.target.value)} placeholder="Terms and conditions..." maxLength={1000} />
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          <button style={{ ...M.secondaryBtn, flex: 1 }} onClick={() => onBack(null)}>Cancel</button>
          <button style={{ ...M.primaryBtn, flex: 2 }} onClick={handleSave} disabled={loading}>
            {loading ? "Saving…" : "💾 Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// LISTING DETAIL
// ═══════════════════════════════════════════════════════════════════════

function ListingDetail({ listing: l, pubkey, onBack, onProfile, onOrderCreated, showToast, loading, setLoading, onEdit, onPause, onUnpause, onDelete }) {
  const isSeller = l.sellerPubkey === pubkey;
  const canBuy = !isSeller && l.status === "active" && l.quantity > 0;
  const isP2P = isSatsForFiat(l.category);

  const handleBuy = async () => {
    setLoading(true);
    try {
      const res = await mapi(`/${l.id}/buy`, { method: "POST" });
      if (res.error) throw new Error(res.error);
      showToast(isP2P ? t("mkTradeStarted") || "Trade started!" : t("mkBuySuccess"));
      setLoading(false);
      // Navigate directly to the new order detail
      if (onOrderCreated && res.order) {
        onOrderCreated({
          id: res.order.id,
          listingId: res.order.listingId,
          escrowId: res.order.escrowId,
          buyerPubkey: pubkey,
          sellerPubkey: l.sellerPubkey,
          arbiterPubkey: res.order.arbiterPubkey,
          amountMsats: l.priceMsats,
          listingTitle: l.title,
          status: "pending",
        });
      } else {
        onBack();
      }
    } catch (err) { showToast(err.message, "error"); setLoading(false); }
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
          <div style={{ fontSize: 32, fontWeight: 900, color: "#f8fafc", letterSpacing: -1 }}>
	  <span style={{ color: "#f7931a", fontSize: 22 }}>₿</span> {fmtSats(l.priceMsats)}
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
		: `⚡ Buy for ₿ ${fmtSats(l.priceMsats)}`
            }
          </button>
        )}

        {/* Marketplace buyer info */}
        {canBuy && !isP2P && (
          <div style={{ ...M.infoBanner, borderColor: "rgba(16,185,129,0.2)", background: "rgba(16,185,129,0.04)", marginBottom: 14 }}>
            <div style={{ fontSize: 11, color: "#94a3b8", lineHeight: 1.5 }}>
		You'll lock <strong style={{ color: "#10b981" }}>₿ {fmtSats(l.priceMsats)}</strong> as payment.
            </div>
          </div>
        )}

        {isSeller && (
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
          {l.condition && !isP2P && (
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
  const [fiatCurrency, setFiatCurrency] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [ratePremium, setRatePremium] = useState("");
  const [interestRate, setInterestRate] = useState("");
  const [repaymentDays, setRepaymentDays] = useState("");
  const locale = getLocale();
  const FEDI_ROOMS = {
    en: "fedi:room:!kENaQZKCKhRhawCjxf:m1.8fa.in:::",
    fr: "fedi:room:!qHlVxBJBCKqUbetBnA:m1.8fa.in:::",
  };
  const [community, setCommunity] = useState(() => FEDI_ROOMS[locale] || FEDI_ROOMS.en);

  const isP2P = isSatsForFiat(category);
  const isLoan = isLending(category);
  const isSpecial = isP2P || isLoan;

  // Auto-set condition/qty when P2P or Lending is selected
  useEffect(() => {
    if (isP2P || isLoan) { setCondition("service"); setQuantity("1"); }
  }, [isP2P, isLoan]);

  const handleCreate = async () => {
    const sats = parseInt(price);
    if (!title.trim()) return showToast(t("mkTitleRequired"), "error");
    if (!sats || sats <= 0) return showToast(t("mkPriceRequired"), "error");
    if (sats > 2_000_000) return showToast(t("mkPriceExceeds"), "error");

    // Append P2P metadata to terms
    let finalTerms = terms.trim();
    if (isP2P) {
      const p2pMeta = [];
      if (fiatCurrency) p2pMeta.push(`Currency: ${fiatCurrency}`);
      if (paymentMethod) p2pMeta.push(`Payment: ${paymentMethod}`);
      if (ratePremium) p2pMeta.push(`Rate: ${ratePremium}`);
      if (p2pMeta.length) finalTerms = (finalTerms ? finalTerms + "\n\n" : "") + "--- P2P Details ---\n" + p2pMeta.join("\n");
    }

    // Append Lending metadata to terms
    if (isLoan) {
      const loanMeta = [];
      if (interestRate) loanMeta.push(`Interest: ${interestRate}`);
      if (repaymentDays) loanMeta.push(`Repayment: ${repaymentDays}`);
      if (paymentMethod) loanMeta.push(`Repayment method: ${paymentMethod}`);
      if (fiatCurrency) loanMeta.push(`Currency: ${fiatCurrency}`);
      if (loanMeta.length) finalTerms = (finalTerms ? finalTerms + "\n\n" : "") + "--- Loan Terms ---\n" + loanMeta.join("\n");
    }

    setLoading(true);
    try {
      const res = await mapi("/", {
        method: "POST",
        body: JSON.stringify({
          title: title.trim(),
          description: desc.trim() || undefined,
          priceMsats: sats * 1000,
          terms: finalTerms || undefined,
          category: category.trim() || undefined,
          condition: isSpecial ? "service" : condition,
          communityLink: community.trim() || undefined,
          quantity: isSpecial ? 1 : (parseInt(quantity) || 1),
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
        <h2 style={M.viewTitle}>{isP2P ? t("mkP2PSellTitle") : isLoan ? "New Loan" : t("mkNewListing")}</h2>
        <div style={{ width: 36 }} />
      </div>

      {/* ── Category selection (always visible at top) ── */}
      <div style={M.formGroup}>
        <label style={M.label}>{t("mkCategory")}</label>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
          {[
            { value: SATS_FOR_FIAT, label: "₿ Sats for Fiat", color: "#f59e0b", bg: "rgba(245,158,11,0.12)" },
            { value: LENDING, label: "🤝 Lending", color: "#10b981", bg: "rgba(16,185,129,0.12)" },
            { value: "electronics", label: "Electronics" },
            { value: "clothing", label: "Clothing" },
            { value: "art", label: "Art" },
            { value: "services", label: "Services" },
          ].map(cat => {
            const active = category === cat.value;
            const handleCatClick = () => {
              // Special categories (P2P, Lending) are exclusive
              if (cat.value === SATS_FOR_FIAT || cat.value === LENDING) {
                setCategory(active ? "" : cat.value);
                if (active) { setPaymentMethod && setPaymentMethod(""); setFiatCurrency && setFiatCurrency(""); }
              } else {
                // Deselect special categories if active
                if (isSpecialCategory(category)) setCategory(cat.value);
                else setCategory(active ? "" : cat.value);
              }
            };
            return (
              <button key={cat.value} onClick={handleCatClick} style={{
                ...M.chipBtn,
                ...(active ? { ...M.chipBtnActive, borderColor: cat.color || "#f59e0b", color: cat.color || "#f8fafc", background: cat.bg || "rgba(245,158,11,0.12)" } : { borderColor: "transparent", background: "#111827", color: "#94a3b8" }),
              }}>
                {cat.label}
              </button>
            );
          })}
        </div>
        {!isP2P && !isLoan && (
          <input style={M.input} placeholder={t("mkFieldCategoryHint")} value={category} onChange={e => setCategory(e.target.value)} />
        )}
      </div>

      {/* ── P2P mode banner ── */}
      {isP2P && (
        <div style={{ ...M.infoBanner, borderColor: "rgba(245,158,11,0.3)", background: "rgba(245,158,11,0.06)", marginBottom: 14, borderLeft: "3px solid #f59e0b" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
            <span style={{ fontSize: 15 }}>₿</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#f59e0b" }}>{t("mkP2PSellTitle")}</span>
          </div>
          <div style={{ fontSize: 11, color: "#94a3b8", lineHeight: 1.5 }}>
            {t("mkP2PNote")}
          </div>
        </div>
      )}

      {/* ── Lending mode banner ── */}
      {isLoan && (
        <div style={{ ...M.infoBanner, borderColor: "rgba(16,185,129,0.3)", background: "rgba(16,185,129,0.06)", marginBottom: 14, borderLeft: "3px solid #10b981" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
            <span style={{ fontSize: 15 }}>🤝</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#10b981" }}>Community Lending</span>
          </div>
          <div style={{ fontSize: 11, color: "#94a3b8", lineHeight: 1.5 }}>
            You lock sats in escrow as a loan. The borrower receives them and repays externally (fiat, goods, labor). The community arbiter verifies repayment.
          </div>
        </div>
      )}

      {/* ── Common fields: Title + Price ── */}
      <div style={M.formGroup}><label style={M.label}>{t("mkFieldTitle")} *</label><input style={M.input} placeholder={isP2P ? "e.g., Selling 50,000 sats for USD" : isLoan ? "e.g., Lending 50,000 sats — 14 day term" : t("mkFieldTitleHint")} value={title} onChange={e => setTitle(e.target.value)} /></div>
      <div style={M.formGroup}><label style={M.label}>{isLoan ? "LOAN AMOUNT (SATS) *" : t("mkFieldPrice") + " *"}</label><input style={M.input} type="number" placeholder="25000" value={price} onChange={e => setPrice(e.target.value)} /><p style={M.hint}>{t("maxFedLimit", { limit: "2,000,000" })}</p></div>

      {/* ── P2P-specific fields ── */}
      {isP2P && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={M.formGroup}>
            <label style={M.label}>{t("mkFiatCurrency")}</label>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {["USD", "EUR", "GBP", "CFA", "KES", "TZS", "NGN", "BRL", "ARS", "INR"].map(cur => (
                <button key={cur} onClick={() => setFiatCurrency(cur)} style={{
                  ...M.chipBtn, padding: "6px 12px", fontSize: 12, fontWeight: 600,
                  ...(fiatCurrency === cur ? { ...M.chipBtnActive, borderColor: "#f59e0b", color: "#f59e0b", background: "rgba(245,158,11,0.12)" } : { borderColor: "transparent", background: "#111827", color: "#94a3b8" }),
                }}>
                  {cur}
                </button>
              ))}
              <button onClick={() => setFiatCurrency("other")} style={{
                ...M.chipBtn, padding: "6px 12px", fontSize: 12,
                ...(fiatCurrency === "other" ? M.chipBtnActive : { borderColor: "transparent", background: "#111827", color: "#94a3b8" }),
              }}>
                {t("mkFiatOther")}
              </button>
            </div>
          </div>
          <div style={M.formGroup}>
            <label style={M.label}>{t("mkPaymentMethod")}</label>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {["Bank Transfer", "M-Pesa", "Orange Money", "Cash", "PayPal", "Wise", "Zelle", "Revolut"].map(pm => (
                <button key={pm} onClick={() => setPaymentMethod(pm)} style={{
                  ...M.chipBtn, padding: "6px 12px", fontSize: 12,
                  ...(paymentMethod === pm ? { ...M.chipBtnActive, borderColor: "#a78bfa", color: "#a78bfa", background: "rgba(139,92,246,0.12)" } : { borderColor: "transparent", background: "#111827", color: "#94a3b8" }),
                }}>
                  {pm}
                </button>
              ))}
              <button onClick={() => setPaymentMethod("other")} style={{
                ...M.chipBtn, padding: "6px 12px", fontSize: 12,
                ...(paymentMethod === "other" ? M.chipBtnActive : { borderColor: "transparent", background: "#111827", color: "#94a3b8" }),
              }}>
                {t("mkFiatOther")}
              </button>
            </div>
          </div>
          <div style={M.formGroup}>
            <label style={M.label}>{t("mkRatePremium")}</label>
            <input style={M.input} placeholder={t("mkRatePremiumHint")} value={ratePremium} onChange={e => setRatePremium(e.target.value)} />
          </div>
        </div>
      )}

      {/* ── Lending-specific fields ── */}
      {isLoan && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", gap: 12 }}>
            <div style={{ flex: 1 }}>
              <label style={M.label}>INTEREST RATE</label>
              <input style={M.input} placeholder="e.g., 5%" value={interestRate} onChange={e => setInterestRate(e.target.value)} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={M.label}>REPAYMENT PERIOD</label>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {["7 days", "14 days", "30 days", "60 days", "90 days"].map(d => (
                  <button key={d} onClick={() => setRepaymentDays(d)} style={{
                    ...M.chipBtn, padding: "6px 10px", fontSize: 11,
                    ...(repaymentDays === d ? { ...M.chipBtnActive, borderColor: "#10b981", color: "#10b981", background: "rgba(16,185,129,0.12)" } : { borderColor: "transparent", background: "#111827", color: "#94a3b8" }),
                  }}>
                    {d}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div style={M.formGroup}>
            <label style={M.label}>REPAYMENT METHOD</label>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {["Sats", "Fiat", "Goods/Labor", "Mixed"].map(rm => (
                <button key={rm} onClick={() => setPaymentMethod(rm)} style={{
                  ...M.chipBtn, padding: "6px 12px", fontSize: 12,
                  ...(paymentMethod === rm ? { ...M.chipBtnActive, borderColor: "#10b981", color: "#10b981", background: "rgba(16,185,129,0.12)" } : { borderColor: "transparent", background: "#111827", color: "#94a3b8" }),
                }}>
                  {rm}
                </button>
              ))}
            </div>
          </div>
          <div style={M.formGroup}>
            <label style={M.label}>{t("mkFiatCurrency")}</label>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {["USD", "EUR", "CFA", "KES", "TZS", "NGN", "BRL", "ARS"].map(cur => (
                <button key={cur} onClick={() => setFiatCurrency(cur)} style={{
                  ...M.chipBtn, padding: "6px 12px", fontSize: 12, fontWeight: 600,
                  ...(fiatCurrency === cur ? { ...M.chipBtnActive, borderColor: "#10b981", color: "#10b981", background: "rgba(16,185,129,0.12)" } : { borderColor: "transparent", background: "#111827", color: "#94a3b8" }),
                }}>
                  {cur}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Non-P2P/Lending fields: Condition + Quantity ── */}
      {!isP2P && !isLoan && (
        <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
          <div style={{ flex: 1 }}>
            <label style={M.label}>{t("mkCondition")}</label>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {["new", "used", "digital", "service"].map(c => (
                <button key={c} onClick={() => setCondition(c)} style={{ ...M.chipBtn, ...(condition === c ? { ...M.chipBtnActive, borderColor: "#8b5cf6", color: "#f8fafc", background: "rgba(139,92,246,0.15)" } : { borderColor: "transparent", background: "#111827", color: "#94a3b8" }) }}>
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
      )}

      {/* ── Common fields: Description + Terms + Community ── */}
      <div style={M.formGroup}><label style={M.label}>{t("description")}</label><textarea style={{ ...M.input, minHeight: 72, resize: "vertical" }} placeholder={isP2P ? "Any additional details about your trade..." : t("mkFieldDescHint")} value={desc} onChange={e => setDesc(e.target.value)} /></div>
      <div style={M.formGroup}><label style={M.label}>{t("tradeTerms")}</label><textarea style={{ ...M.input, minHeight: 60, resize: "vertical" }} placeholder={isP2P ? "Payment window, confirmation steps..." : t("mkFieldTermsHint")} value={terms} onChange={e => setTerms(e.target.value)} /></div>
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
  // Sort: needs-rating first, then by date
  const sorted = [...orders].sort((a, b) => {
    if (a.needsRating && !b.needsRating) return -1;
    if (!a.needsRating && b.needsRating) return 1;
    return 0; // preserve existing date order within groups
  });

  return (
    <div style={M.container}>
      <div style={M.viewHeader}>
        <button style={M.iconBtn} onClick={onBack}><Icons.Back /></button>
        <h2 style={M.viewTitle}>{t("mkMyOrders")}</h2>
        <button style={M.iconBtn} onClick={onRefresh}><Icons.Refresh style={loading ? { animation: "pulse 1s infinite" } : {}} /></button>
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
              ...(o.needsRating ? { borderColor: "rgba(245,158,11,0.3)", boxShadow: "0 0 12px rgba(245,158,11,0.08)" } : {}),
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
                  <OrderBadge status={o.status} />
                </div>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6 }}>
		<span style={{ fontSize: 15, fontWeight: 600, color: "#f8fafc" }}><span style={{ color: "#f7931a" }}>₿</span> {fmtSats(o.amountMsats)}</span>
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
  const [rated, setRated] = useState(false);
  const isBuyer = o.buyerPubkey === pubkey;
  const canCancel = isBuyer && (o.status === "pending");

  useEffect(() => {
    (async () => {
      try {
        const data = await mapi(`/orders/${o.id}`);
        if (!data.error) {
          setDetail(data);
          // API is source of truth for rating status
          if (data.order?.myRating != null) setRated(true);
        }
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
      showToast("⭐ Rating submitted — thank you!");
      setRated(true);
    } catch (err) { showToast(err.message, "error"); }
    setLoading(false);
  };

  const escrow = detail?.escrow;
  const status = detail?.order?.status || o.status;
  // Only show rating prompt AFTER detail loads AND confirms no rating exists
  const detailLoaded = detail != null;
  const needsRating = detailLoaded && status === "completed" && !rated;
  const otherPubkey = isBuyer ? o.sellerPubkey : o.buyerPubkey;
  const otherRole = isBuyer ? t("seller") : t("buyer");
  const isP2P = detail?.tradeType === "sats-for-fiat" || isSatsForFiat(detail?.listing?.category);
  const myExistingRating = detail?.order?.myRating;

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
	  <span style={{ color: "#f7931a", fontSize: 22 }}>₿</span> {fmtSats(o.amountMsats)}
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

        {/* ═══ RATING PROMPT — shown prominently for completed unrated trades ═══ */}
        {needsRating && (
          <div style={{
            borderRadius: 16, padding: 20, marginBottom: 16,
            background: "linear-gradient(135deg, rgba(245,158,11,0.08), rgba(245,158,11,0.03))",
            border: "1px solid rgba(245,158,11,0.2)",
          }}>
            <div style={{ textAlign: "center", marginBottom: 14 }}>
              <div style={{ fontSize: 28, marginBottom: 6 }}>⭐</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#f8fafc" }}>
                How was your trade?
              </div>
              <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 4 }}>
                Rate your {otherRole} to help the community
              </div>
            </div>
            <div style={{ textAlign: "center", marginBottom: 14 }}>
              <StarRating score={rateScore} onChange={setRateScore} size={32} />
            </div>
            {rateScore > 0 && (
              <>
                <textarea
                  value={rateComment}
                  onChange={(e) => setRateComment(e.target.value)}
                  placeholder={`Optional: tell others about trading with this ${otherRole}...`}
                  maxLength={500}
                  style={{ ...M.input, minHeight: 60, resize: "vertical", marginBottom: 12, fontSize: 13 }}
                />
                <button
                  style={{
                    ...M.actionBtn,
                    background: "linear-gradient(135deg, #f59e0b, #d97706)",
                    color: "#0c0f17",
                  }}
                  onClick={handleRate}
                  disabled={loading || !rateScore}
                >
                  {loading ? "Submitting…" : `⭐ Submit ${rateScore}-Star Rating`}
                </button>
              </>
            )}
          </div>
        )}

        {/* ═══ ALREADY RATED — show confirmation ═══ */}
        {rated && (
          <div style={{
            textAlign: "center", padding: "14px 16px", marginBottom: 16,
            borderRadius: 12, background: "rgba(16,185,129,0.06)",
            border: "1px solid rgba(16,185,129,0.15)",
          }}>
            <span style={{ color: "#10b981", fontSize: 13, fontWeight: 600 }}>
              ✓ You rated this trade {myExistingRating ? `${myExistingRating.score}/5` : rateScore ? `${rateScore}/5` : ""}
            </span>
          </div>
        )}

        {/* ═══ ESCROW STATUS CARD ═══ */}
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
            {onSwitchToEscrow && status !== "completed" && (
              <div style={{ fontSize: 11, color: "#64748b", marginTop: 8, textAlign: "center" }}>
                Use the button below to manage this escrow
              </div>
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

        {/* ── Primary action: Go to Escrow (right after participants for visibility) ── */}
        {onSwitchToEscrow && (status === "pending" || status === "active") && (o.escrowId || escrow?.id) && (
          <button
            onClick={() => onSwitchToEscrow(escrow?.id || o.escrowId)}
            style={{
              ...M.actionBtn,
              background: "linear-gradient(135deg, #7c3aed, #6d28d9)",
              boxShadow: "0 4px 24px rgba(124,58,237,0.3)",
              marginTop: 4, marginBottom: 14,
            }}
          >
            ⚡ {status === "pending"
              ? (isP2P
                  ? (isBuyer ? "View Escrow — Send Fiat" : "Lock Sats in Escrow")
                  : (isBuyer ? "Lock Sats in Escrow" : "View Escrow"))
              : "Open Escrow — Vote"
            }
          </button>
        )}

        {/* ═══ STATUS GUIDANCE ═══ */}
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
                <div style={{ fontSize: 16, fontWeight: 700, color: "#f59e0b" }}>₿ {fmtVolume(ts.sellVolumeMsats || 0)}</div>
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
  root: { background: "#0c0f17", color: "#e2e8f0", flex: 1, display: "flex", flexDirection: "column", minHeight: 0, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', fontSize: 14, lineHeight: 1.5 },
  container: { width: "100%", maxWidth: 480, margin: "0 auto", padding: "0 16px 20px", overflowX: "hidden", flex: 1, overflowY: "auto" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 0 12px", minHeight: 52 },
  title: { fontSize: 24, fontWeight: 700, color: "#f8fafc", margin: 0, letterSpacing: -0.5 },
  subtitle: { fontSize: 12, color: "#64748b", margin: "2px 0 0" },
  viewHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 0 12px" },
  viewTitle: { fontSize: 17, fontWeight: 600, color: "#f8fafc", margin: 0 },
  iconBtn: { background: "rgba(30,41,59,0.5)", color: "#cbd5e1", padding: 9, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid rgba(51,65,85,0.3)", cursor: "pointer", WebkitTapHighlightColor: "transparent", outline: "none", minWidth: 36, minHeight: 36 },
  primaryBtn: { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, background: "linear-gradient(135deg, #f59e0b, #d97706)", color: "#0c0f17", fontWeight: 700, fontSize: 15, padding: "14px 24px", borderRadius: 14, flex: 1, border: "none", cursor: "pointer", boxShadow: "0 2px 12px rgba(245,158,11,0.2)", WebkitTapHighlightColor: "transparent", outline: "none" },
  secondaryBtn: { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, background: "linear-gradient(145deg, #1e293b, #1a2332)", color: "#e2e8f0", fontWeight: 600, fontSize: 15, padding: "14px 24px", borderRadius: 14, flex: 1, border: "1px solid #334155", cursor: "pointer", WebkitTapHighlightColor: "transparent", outline: "none" },
  actionBtn: { display: "flex", alignItems: "center", justifyContent: "center", gap: 8, width: "100%", padding: "16px 0", borderRadius: 14, color: "#fff", fontSize: 15, fontWeight: 800, letterSpacing: -0.3, border: "none", cursor: "pointer", WebkitTapHighlightColor: "transparent", outline: "none" },
  input: { width: "100%", padding: "12px 14px", borderRadius: 10, border: "1px solid #1e293b", background: "#111827", color: "#f8fafc", fontSize: 14, outline: "none", boxSizing: "border-box" },
  formGroup: { marginBottom: 16 },
  label: { display: "block", fontSize: 12, fontWeight: 600, color: "#94a3b8", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 },
  hint: { fontSize: 11, color: "#475569", marginTop: 4 },
  section: { marginBottom: 14 },
  sectionLabel: { fontSize: 11, fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 },
  sectionValue: { fontSize: 13, color: "#cbd5e1", lineHeight: 1.6 },
  emptyState: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "60px 20px", textAlign: "center" },
  listingCard: { background: "linear-gradient(145deg, #111827, #0f1320)", border: "1px solid #1e293b", borderRadius: 14, padding: "16px 18px", textAlign: "left", color: "#e2e8f0", width: "100%", cursor: "pointer", transition: "all 0.2s ease" },
  cardTitle: { fontSize: 16, fontWeight: 600, color: "#f8fafc", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 },
  cardPrice: { fontSize: 16, fontWeight: 700, color: "#f8fafc", whiteSpace: "nowrap", marginLeft: 8 },
  cardDesc: { fontSize: 13, color: "#94a3b8", margin: "6px 0 0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  cardMeta: { display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10 },
  conditionBadge: { padding: "3px 10px", borderRadius: 6, fontSize: 11, fontWeight: 700, background: "rgba(139,92,246,0.1)", color: "#a78bfa", letterSpacing: 0.3 },
  categoryBadge: { padding: "3px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600, background: "rgba(100,116,139,0.1)", color: "#94a3b8" },
  chipBtn: { padding: "6px 12px", borderRadius: 8, background: "#111827", color: "#94a3b8", fontSize: 12, fontWeight: 500, border: "1px solid transparent", cursor: "pointer", WebkitTapHighlightColor: "rgba(0,0,0,0)", outline: "none" },
  chipBtnActive: { background: "#1e293b", color: "#f8fafc", borderColor: "#f59e0b" },
  infoBanner: { padding: "10px 14px", border: "1px solid", borderRadius: 10, marginBottom: 12 },
  participantRow: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", fontSize: 13 },
};
