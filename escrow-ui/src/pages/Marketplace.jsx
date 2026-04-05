import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { t, getLocale, getAvailableLocales, setLocale } from "./i18n";

// ── Extracted modules (refactor step 1) ──
import { MAPI as _MAPI, PAYMENT_METHODS as _PM, BILL_TYPES as _BT, CATEGORIES as _CAT, CONDITION_KEYS as _CK, FED_LIMITS as _FL, BILL_PAY as _BP, SATS_FOR_FIAT as _SFF, LENDING as _LN, CURRENCY_SYMBOLS as _CS, FED_NAMES_GLOBAL as _FNG, DEV_IDENTITIES as _DI, LEARN_DISMISSED_KEY as _LDK } from "./marketplace/constants";
import { isBillPay as _isBP, isSatsForFiat as _isSFF, isLending as _isLN, isSpecialCategory as _isSC, fmtSats as _fmtS, fmtSatsShort as _fmtSS, fmtVolume as _fmtV, fmtFiat as _fmtF, msatsToFiat as _m2f, truncPk as _tPk, getFedName as _gFN, getFedInfo as _gFI, recalcBillPaySats as _rBPS } from "./marketplace/helpers";
import { default as _M } from "./marketplace/styles";
// FUTURE: Re-enable for PWA/Start9/Umbrel push notifications
//import NotificationSettings, { NotifBellIcon } from "./NotificationSettings";

// ═══════════════════════════════════════════════════════════════════════
// Fedi Mini-App: Marketplace v2.0
// Community homepage • Onboarding • Category filters • Deep-link escrow
// NIP-98 Nostr auth • Fedi + browser sandbox
// ═══════════════════════════════════════════════════════════════════════

const MAPI = "/api/marketplace/listings";

// ── Auth ─────────────────────────────────────────────────────────────

const FED_NAMES_GLOBAL = {
  "AwEEiItw7A": { name: "Bitcoin Life", emoji: "🏛️", color: "#a78bfa" },
  "AwEEG8tk5g": { name: "Global Bitcoin Federation", emoji: "🏛️", color: "#f59e0b" },
  "AwEE_yhqbg": { name: "Afribit Kibera", emoji: "🏛️", color: "#10b981" },
};
function getFedName(prefix, domain) {
  if (domain && domain.toLowerCase().includes("bitsacco")) return "Bitsacco";
  if (prefix && FED_NAMES_GLOBAL[prefix]) return FED_NAMES_GLOBAL[prefix].name;
  if (domain) return domain.replace(/^m\d+\./, "").replace(/\.in$/, "").replace(/\.com$/, "");
  return domain || prefix || "Unknown";
}

const DEV_IDENTITIES = {
  seller:  "aa".repeat(32),
  buyer:   "bb".repeat(32),
  arbiter: "cc".repeat(32),
};

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

// ── Helpers ──────────────────────────────────────────────────────────

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

const CURRENCY_SYMBOLS = {
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

// ── Nostr Profile Lookup (client-side, no server relay needed) ────────

const _nostrProfileCache = new Map(); // pubkey → { name, picture, about, nip05, fetched }

// Seed from sessionStorage — profiles survive navigation without re-fetching
try {
  const stored = localStorage.getItem("nostr_profile_cache");
  if (stored) Object.entries(JSON.parse(stored)).forEach(([k, v]) => _nostrProfileCache.set(k, v));
} catch {}

const _pendingFetches = new Map(); // dedup simultaneous fetches for same pubkey
const NOSTR_RELAYS = ["wss://relay.damus.io", "wss://nos.lol", "wss://relay.nostr.band", "wss://relay.primal.net", "wss://purplepag.es"];

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

    // Query all relays in parallel — first valid response wins
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
              // Persist to sessionStorage for fast re-use across navigation
              try {
                const existing = JSON.parse(localStorage.getItem("nostr_profile_cache") || "{}");
                existing[pubkey] = profile;
                localStorage.setItem("nostr_profile_cache", JSON.stringify(existing));
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
    <div style={{ position: "fixed", bottom: 120, left: 16, right: 16, padding: "12px 16px", borderRadius: 12, background: type === "error" ? "#7f1d1d" : "#064e3b", color: "#fff", fontSize: 13, fontWeight: 500, zIndex: 1000, textAlign: "center", animation: "slideUp 0.25s ease-out", boxShadow: "0 8px 32px rgba(0,0,0,0.4)", pointerEvents: "none" }}>
      {msg}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// MAIN MARKETPLACE COMPONENT
// Per-view loading states prevent cross-contamination between views.
// ═══════════════════════════════════════════════════════════════════════

export default function Marketplace({ pubkey, devRole, subdomain, onSwitchToEscrow, initialEscrowId, onOpened }) {
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
  const [view, setView] = useState(() => { const h = window.location.hash.replace("#", ""); return ["faq", "arbiters"].includes(h) ? h : "browse"; });
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
  const [prevView, setPrevView] = useState("browse");
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

  const openOrders = async () => { setView("orders"); loadOrders(); };

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

      {view === "browse" && (
        <BrowseView
          listings={listings} loading={browseLoading} pubkey={pubkey}
          searchQuery={searchQuery} setSearchQuery={setSearchQuery}
          onSearch={(q) => { setSearchQuery(q); loadListings(q); }}
          onOpen={openListing}
          onCreate={() => setView("create")}
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
        
          onBillPay={() => setView("billpay")}
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
         subdomain={subdomain}/>
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
          onOrderCreated={(order) => { setSelected(order); setView("orderDetail"); }}
          showToast={showToast} loading={actionLoading} setLoading={setActionLoading}
          fiatRates={fiatRates}
         subdomain={subdomain}/>
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
          onBack={() => setView("browse")}
          onCreate={() => { setView("create"); }}
          onOpen={openListing} onOrders={openOrders}
          onRefresh={() => { loadListings(); }}
          fiatRates={fiatRates} showToast={showToast} subdomain={subdomain}
          activeOrderCount={orders.filter(o => o.status === "pending" || o.status === "active").length}
        />
      )}
      {view === "create" && (
        <CreateListingView
          pubkey={pubkey}
          subdomain={subdomain}
          myFederation={myFederation}
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
          fiatRates={fiatRates}
          initialFilter={orderFilterHint}
          onFilterConsumed={() => setOrderFilterHint(null)} subdomain={subdomain}
        />
      )}
      {view === "orderDetail" && selected && (
        <OrderDetailView
          order={selected} pubkey={pubkey}
          onBack={() => { const s = selected?.status; setSelected(null); openOrders(); if (s === "completed") setTimeout(() => setOrderFilter("completed"), 50); else if (s === "cancelled" || s === "expired") setTimeout(() => setOrderFilter("cancelled"), 50); }}
          onProfile={openProfile}
          onSwitchToEscrow={onSwitchToEscrow}
          showToast={showToast} loading={actionLoading} setLoading={setActionLoading}
          fiatRates={fiatRates}
         subdomain={subdomain}/>
      )}
      {view === "chapsmart" && (
        <ChapSmartView
          onBack={() => setView("browse")}
          showToast={showToast}
          pubkey={pubkey}
        />
      )}
      {view === "arbiters" && (
        <ArbiterRecruitmentView pubkey={pubkey} onBack={() => setView("browse")} showToast={showToast} />
      )}
      {view === "faq" && (
        <FAQView onBack={() => setView("browse")} />
      )}
      {view === "profile" && profilePubkey && (
        <SellerProfileView
          pubkey={profilePubkey} myPubkey={pubkey}
          onBack={() => { setProfilePubkey(null); setView(prevView || "browse"); }}
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
                  <div style={{ padding: "12px 14px", marginBottom: 14, borderRadius: 10, background: "rgba(16,185,129,0.06)", border: "1px solid rgba(16,185,129,0.15)", textAlign: "left" }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#10b981", marginBottom: 8 }}>Get started in 30 seconds:</div>
                    <div style={{ fontSize: 11, color: "#cbd5e1", lineHeight: 2 }}>
                      <span style={{ color: "#f59e0b", fontWeight: 700 }}>1.</span> Install Fedi from your app store<br/>
                      <span style={{ color: "#f59e0b", fontWeight: 700 }}>2.</span> Tap <strong style={{ color: "#f8fafc" }}>Get Started</strong><br/>
                      <span style={{ color: "#f59e0b", fontWeight: 700 }}>3.</span> Tap <strong style={{ color: "#f8fafc" }}>Do it later</strong> at the bottom<br/>
                      <span style={{ color: "#f59e0b", fontWeight: 700 }}>4.</span> Come back here and join a community below
                    </div>
                  </div>
                  <a href="https://fedi.xyz/product" target="_blank" rel="noopener noreferrer" style={{
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 8, width: "100%", padding: "12px 0", marginBottom: 14, borderRadius: 10,
                    background: "linear-gradient(135deg, #10b981, #059669)", color: "#fff", fontSize: 14, fontWeight: 700, textDecoration: "none",
                  }}>{"📲"} Download Fedi (Free)</a>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 12, justifyContent: "center" }}>
                    <span style={{ fontSize: 18, lineHeight: 1 }}>5️⃣</span>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: "#f59e0b", marginBottom: 4 }}>Join our community inside Fedi</div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <a href="fedi:community210v3xzat5dphhyhmsw43xketeygazyv33vvmnzvmxx5unqwpkxdnxxvfs893rjwfcvsukxcmzxsmkxcnyvf3kywpnxscxzdnyxq6rvcmpxuengvp4xdsn2wfcvymrgvpexesjytpzvdhk6mt4de5hg72lw46kjezldpjhsg36yfskyephv5cnqwpjvdnrqenrxpnrxvmrxs6nscfkxymnvdrpv4jngwpjvdskgce3xy6nvdf5vfjxyef4x9jrvceevejrvcenxcekydtrygkzyer9vde8jur5d9hkuhmtv4ujyw3zvymkvmr0gcu4wuth2eh9zkr9vdc8z3m4w4m56v60w3j9zwrpxdvhw3n9ga3kwcfcgc4kk0fz05fkv4p3" style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "6px 12px", borderRadius: 8, background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.2)", color: "#f59e0b", fontSize: 11, fontWeight: 600, textDecoration: "none" }}>🇬🇧 English</a>
                        <a href="fedi:community210v3xzat5dphhyhmsw43xketeygazyde5xf3kzvpnx9skzdnyxpjrvdm9xpskzc3kxucrxwpex33xxe3exvmnxvtxv9jryefexsmnqvty8yunvd35vgunywrzxvmrsvpj8q6jytpzvdhk6mt4de5hg72lw46kjezldpjhsg36yfnrqcf3vserxvfevyck2wtyxanxzvf5x9skgdfhvd3rwc3jv5crsetyx3jxvdesxserxerpvdskzcehxpjr2wf5vymkxenpx56kvwrpygkzyer9vde8jur5d9hkuhmtv4ujyw3zfphhy3t3vym8sd6vg4a9v6n2fsek7m6k23ux6v6ytp65jeekd4pkj5nzw39xcanh0pkrg0fz055t3dve" style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "6px 12px", borderRadius: 8, background: "rgba(59,130,246,0.08)", border: "1px solid rgba(59,130,246,0.2)", color: "#3b82f6", fontSize: 11, fontWeight: 600, textDecoration: "none" }}>🇫🇷 Français</a>
                      </div>
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 10, justifyContent: "center" }}>
                    <span style={{ fontSize: 18, lineHeight: 1 }}>3️⃣</span>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: "#a78bfa", marginBottom: 4 }}>Need help? Chat with us</div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <a href="fedi:room:!kENaQZKCKhRhawCjxf:m1.8fa.in:::" style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "6px 12px", borderRadius: 8, background: "rgba(139,92,246,0.08)", border: "1px solid rgba(139,92,246,0.2)", color: "#a78bfa", fontSize: 11, fontWeight: 600, textDecoration: "none" }}>💬 Support (EN)</a>
                        <a href="fedi:room:!qHlVxBJBCKqUbetBnA:m1.8fa.in:::" style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "6px 12px", borderRadius: 8, background: "rgba(139,92,246,0.08)", border: "1px solid rgba(139,92,246,0.2)", color: "#a78bfa", fontSize: 11, fontWeight: 600, textDecoration: "none" }}>💬 Support (FR)</a>
                      </div>
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

        {/* ── Buttons right under content ── */}
        <div style={{ width: "100%", marginTop: 28 }}>
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

function NewToFediBanner() {
  const inFedi = _isFediRuntime();
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

function BrowseView({ listings, loading, pubkey, searchQuery, setSearchQuery, onSearch, onOpen, onCreate, onOrders, activeOrderCount, onNotifications, onRefresh, onSwitchToEscrow, onProfile, locale, onSwitchLocale, onChapSmart, subdomain, myFederation, onArbiters, onFaq, showToast, onBillPay }) {
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
      const short = domain.replace(/^m\d+\./, "").replace(/\.in$/, "").replace(/\.com$/, "");
      return { name: short, emoji: "🏛", color: "#64748b" };
    }
    return null;
  };

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
          }} onClick={onCreate}><Icons.Plus /> {subdomain === "p2p" ? t("mkSellSats") || "Sell Sats" : subdomain === "lending" ? "Offer Loan" : subdomain === "market" ? "List Item" : t("mkSell")}</button>
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


// ═══════════════════════════════════════════════════════════════════════
// EDIT LISTING VIEW — seller can update title, description, price, qty
// ═══════════════════════════════════════════════════════════════════════
function EditListingView({ listing: l, onBack, showToast, loading, setLoading, subdomain }) {
  const [title, setTitle] = useState(l.title || "");
  const [description, setDescription] = useState(l.description || "");
  const [price, setPrice] = useState(l.priceMsats ? Math.floor(l.priceMsats / 1000) : "");
  const [terms, setTerms] = useState(l.terms || "");
  const [quantity, setQuantity] = useState(l.quantity ?? 1);
  const [minPrice, setMinPrice] = useState(l.minPriceSats || "");
  const [maxPrice, setMaxPrice] = useState(l.maxPriceSats || "");
  const [editPremium, setEditPremium] = useState(() => { const m = (l.terms || "").match(/Rate:\s*(\d+)/); return m ? m[1] : ""; });
  const [editShipping, setEditShipping] = useState(l.shippingCostSats || "");
 const [editFedOnly, setEditFedOnly] = useState(!!l.federationOnly);
  const [editCurrency, setEditCurrency] = useState(() => { const m = (l.terms || "").match(/Currency:\s*(\w+)/); return m ? m[1] : ""; });
  const [editPaymentMethods, setEditPaymentMethods] = useState(l.paymentMethods || []);
  const isP2PEdit = isSatsForFiat(l.category);
  const isP2P = isSatsForFiat(l.category);
  const [editImages, setEditImages] = useState(l.images || []);
  const [editImgUploading, setEditImgUploading] = useState(false);
  const editFileRef = useRef(null);

  const uploadEditImage = async (file) => {
    if (!file || !file.type.startsWith("image/")) { showToast("Please select an image", "error"); return; }
    if (file.size > 20 * 1024 * 1024) { showToast("Image too large (max 20MB)", "error"); return; }
    if (editImages.length >= 4) { showToast("Maximum 4 images", "error"); return; }
    setEditImgUploading(true);
    try {
      const stripped = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement("canvas");
          const max = 1920;
          let w = img.width, h = img.height;
          if (w > max || h > max) {
            if (w > h) { h = Math.round(h * max / w); w = max; }
            else { w = Math.round(w * max / h); h = max; }
          }
          canvas.width = w; canvas.height = h;
          canvas.getContext("2d").drawImage(img, 0, 0, w, h);
          canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Canvas encode failed")), "image/jpeg", 0.85);
        };
        img.onerror = () => reject(new Error("Image load failed"));
        img.src = URL.createObjectURL(file);
      });
      const buf = await stripped.arrayBuffer();
      const hashBuf = await crypto.subtle.digest("SHA-256", buf);
      const sha256 = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, "0")).join("");
      if (!window.nostr) throw new Error("Nostr not available");
      const authEvent = {
        kind: 24242,
        created_at: Math.floor(Date.now() / 1000),
        tags: [["t", "upload"], ["x", sha256], ["expiration", String(Math.floor(Date.now() / 1000) + 300)]],
        content: "Upload listing image",
      };
      const signed = await window.nostr.signEvent(authEvent);
      const res = await fetch("https://blossom.band/upload", {
        method: "PUT",
        headers: { "Authorization": "Nostr " + btoa(JSON.stringify(signed)), "Content-Type": "image/jpeg" },
        body: stripped,
      });
      if (!res.ok) throw new Error("Upload failed (" + res.status + ")");
      const data = await res.json();
      const url = data.url || ("https://blossom.band/" + sha256);
      setEditImages(prev => [...prev, url]);
      showToast("Image uploaded!");
    } catch (err) {
      showToast("Upload failed: " + (err.message || ""), "error");
    }
    setEditImgUploading(false);
  };

  const handleSave = async () => {
    if (!title.trim()) return showToast("Title is required", "error");
    if (!price || Number(price) <= 0) return showToast("Price must be positive", "error");
    setLoading(true);
    try {
      const updatedTerms = (() => { let t = terms.trim().replace(/Rate:\s*\d+/, "").trim(); if (editPremium) t = (t ? t + " | " : "") + "Rate: " + editPremium; t = t.replace(/Currency:\s*\w+/, "").trim(); if (editCurrency) t = (t ? t + " | " : "") + "Currency: " + editCurrency; return t; })();
      const res = await mapi(`/${l.id}/update`, {
        method: "POST",
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          priceMsats: Number(price) * 1000,
          terms: updatedTerms,
          quantity: Number(quantity),
          minPriceMsats: minPrice ? Number(minPrice) * 1000 : null,
          maxPriceMsats: maxPrice ? Number(maxPrice) * 1000 : null,
          images: editImages.length > 0 ? editImages : [],
          shippingCostSats: editShipping ? parseInt(editShipping) : 0,
 federationOnly: editFedOnly, payment_methods: editPaymentMethods.length > 0 ? editPaymentMethods.join(",") : "",
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

        {!isP2P && (
          <div style={{ marginBottom: 14 }}>
            <div style={M.sectionLabel}>Photos</div>
            <input type="file" accept="image/*" ref={editFileRef} onChange={e => { if (e.target.files?.[0]) uploadEditImage(e.target.files[0]); e.target.value = ""; }} style={{ display: "none" }} />
            {editImages.length > 0 && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                {editImages.map((url, i) => (
                  <div key={i} style={{ position: "relative", width: 72, height: 72, borderRadius: 8, overflow: "hidden", border: "1px solid #1e293b" }}>
                    <img src={url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    <button onClick={() => setEditImages(prev => prev.filter((_, j) => j !== i))} style={{
                      position: "absolute", top: 2, right: 2, width: 18, height: 18, borderRadius: "50%",
                      background: "rgba(0,0,0,0.7)", color: "#fff", fontSize: 10, border: "none", cursor: "pointer",
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>✕</button>
                  </div>
                ))}
              </div>
            )}
            <button onClick={() => editFileRef.current?.click()} disabled={editImgUploading || editImages.length >= 4} style={{
              padding: "10px 16px", borderRadius: 10, border: "1px dashed #334155", background: "transparent",
              color: editImgUploading ? "#475569" : "#64748b", fontSize: 12, fontWeight: 600, cursor: "pointer", width: "100%",
            }}>
              {editImgUploading ? "Uploading..." : editImages.length > 0 ? "📷 Add photo (" + editImages.length + "/4)" : "📷 Add photos"}
            </button>
          </div>
        )}

        <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
          <div style={{ flex: 1 }}>
            <div style={M.sectionLabel}>{isP2P ? "Display Price (sats)" : "Price (sats) *"}</div>
            <input style={M.input} type="number" value={price} onChange={e => setPrice(e.target.value)} placeholder="e.g. 5000" min={1} />
          </div>
          <div style={{ width: 90 }}>
            <div style={M.sectionLabel}>Quantity</div>
            <input style={M.input} type="number" value={quantity} onChange={e => setQuantity(e.target.value)} min={1} max={999} />
          </div>
        </div>

        {!isP2P && !isBillPay(l.category) && (
          <div style={{ marginBottom: 14 }}>
            <div style={M.sectionLabel}>Shipping Cost (sats, optional)</div>
            <input style={M.input} type="number" placeholder="e.g., 500" value={editShipping} onChange={e => setEditShipping(e.target.value)} />
          </div>
        )}

        {isP2P && (
          <div style={{ marginBottom: 14 }}>
            <div style={M.sectionLabel}>Price Range (sats)</div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input style={{ ...M.input, flex: 1 }} type="number" placeholder="Min" value={minPrice} onChange={e => setMinPrice(e.target.value)} />
              <span style={{ color: "#64748b", fontSize: 13 }}>—</span>
              <input style={{ ...M.input, flex: 1 }} type="number" placeholder="Max" value={maxPrice} onChange={e => setMaxPrice(e.target.value)} />
            </div>
            <p style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>Buyers choose any amount in this range.</p>
          </div>
        )}

        <div style={{ marginBottom: 20 }}>
          <div style={M.sectionLabel}>Trade Terms</div>
          <textarea style={{ ...M.input, minHeight: 60, resize: "vertical" }} value={terms} onChange={e => setTerms(e.target.value)} placeholder="Terms and conditions..." maxLength={1000} />
        </div>

        {(isP2PEdit || isBillPay(l.category)) && (
          <div style={{ marginBottom: 20 }}>
            <div style={M.sectionLabel}>Rate Premium (%)</div>
            <input style={M.input} type="number" placeholder="e.g., 3" value={editPremium} onChange={e => setEditPremium(e.target.value)} />
            {editPremium && price && (() => {
              const rp = Number(editPremium) / 100;
              const adjMax = minPrice && maxPrice ? Math.ceil(Number(maxPrice) * (1 + rp)) : Math.ceil(Number(price) * (1 + rp));
              const adjMin = minPrice ? Math.ceil(Number(minPrice) * (1 + rp)) : adjMax;
              const exceeds = adjMax > 2_000_000;
              return <>
                <p style={{ fontSize: 11, color: exceeds ? "#ef4444" : "#f59e0b", fontWeight: 600, marginTop: 4 }}>
                  {minPrice && maxPrice
                    ? "Range with premium: ₿ " + adjMin.toLocaleString() + " — ₿ " + adjMax.toLocaleString() + " sats"
                    : "Total with premium: ₿ " + adjMax.toLocaleString() + " sats"
                  }
                </p>
                {exceeds && <p style={{ fontSize: 11, color: "#ef4444", fontWeight: 700, marginTop: 2 }}>⚠️ Exceeds 2M sats federation limit!</p>}
              </>;
            })()}
          </div>
        )}

        {/* Currency picker (edit) */}
        {(isP2PEdit || isBillPay(l.category)) && (
          <div style={{ marginBottom: 16 }}>
            <div style={M.sectionLabel}>{t("mkFiatCurrency") || "Fiat Currency"}</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {["USD","EUR","GBP","CFA","KES","TZS","NGN","BRL","INR","CAD","AUD"].map(cur => (
                <button key={cur} onClick={() => setEditCurrency(editCurrency === cur ? "" : cur)} style={{ padding: "5px 12px", borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: "pointer", border: editCurrency === cur ? "1.5px solid #f59e0b" : "1px solid #334155", background: editCurrency === cur ? "rgba(245,158,11,0.15)" : "#111827", color: editCurrency === cur ? "#f59e0b" : "#94a3b8" }}>{cur}</button>
              ))}
            </div>
          </div>
        )}

        {/* Payment methods (edit) */}
        {(isP2PEdit || isBillPay(l.category)) && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ ...M.sectionLabel, color: "#10b981" }}>{t("mkAcceptedPayment") || "Accepted Payment Methods"}</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {PAYMENT_METHODS.map(pm => {
                const active = editPaymentMethods.includes(pm.key);
                return <button key={pm.key} onClick={() => setEditPaymentMethods(prev => active ? prev.filter(k => k !== pm.key) : [...prev, pm.key])} style={{ padding: "5px 10px", borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: "pointer", border: active ? "1.5px solid #10b981" : "1px solid #334155", background: active ? "rgba(16,185,129,0.15)" : "#111827", color: active ? "#10b981" : "#94a3b8" }}>{pm.icon} {pm.label}</button>;
              })}
            </div>
          </div>
        )}
        {/* Federation-only toggle */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, padding: "10px 14px", borderRadius: 10, background: editFedOnly ? "rgba(139,92,246,0.1)" : "#111827", border: "1px solid " + (editFedOnly ? "rgba(139,92,246,0.3)" : "#1e293b"), cursor: "pointer" }} onClick={() => setEditFedOnly(!editFedOnly)}>
          <span style={{ fontSize: 18 }}>{editFedOnly ? "🔒" : "🌐"}</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: editFedOnly ? "#a78bfa" : "#94a3b8" }}>Federation Only</div>
            <div style={{ fontSize: 10, color: "#475569" }}>{editFedOnly ? "Only your federation members can see this" : "Visible to everyone"}</div>
          </div>
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

function ListingDetail({ listing: l, pubkey, onBack, onProfile, onOrderCreated, showToast, loading, setLoading, onEdit, onPause, onUnpause, onDelete, fiatRates, myFederation, subdomain }) {
  const isSeller = l.sellerPubkey === pubkey;
  const canBuy = !isSeller && l.status === "active" && l.quantity > 0;
  const isP2P = isSatsForFiat(l.category);
  const hasRange = l.minPriceSats && l.maxPriceSats && l.minPriceSats !== l.maxPriceSats;
  const [buyAmount, setBuyAmount] = useState(hasRange ? "" : "");


  // Lending level for borrower
  const [myLendingLevel, setMyLendingLevel] = useState(null);
  useEffect(() => {
    if (!isLending(l.category) || isSeller) return;
    (async () => {
      try {
        const data = await mapi("/lending-level/" + pubkey);
        if (!data.error) setMyLendingLevel(data);
      } catch {}
    })();
  }, [l.id, pubkey]);
  const handleBuy = async () => {
    // Federation probe: verify buyer is on same federation as seller
    const sellerPrefix = l.sellerFedPrefix;
    const _isSandbox = !window.fediInternal || isDevMode();
    if (!_isSandbox && sellerPrefix && window.fediInternal && window.fediInternal.generateEcash) {
      setLoading(true);
      try {
        showToast("Verifying your federation...");
        const probe = await window.fediInternal.generateEcash({ amount: 1 });
        if (!probe || probe.length <= 10) {
          showToast("Federation verification failed. Please try again and make sure to approve the prompt.", "error");
          setLoading(false);
          return;
        }
        const buyerPrefix = probe.substring(0, 10);
        try { await window.fediInternal.receiveEcash(probe); } catch {}
        if (buyerPrefix !== sellerPrefix) {
          showToast("This trade requires the same federation as the seller. Please switch to the correct federation in Fedi and try again. Your 1 sat probe has been returned.", "error");
          setLoading(false);
          return;
        }
      } catch {
        showToast("Federation verification failed. Please try again.", "error");
        setLoading(false);
        return;
      }
    } else if (!_isSandbox && sellerPrefix) {
      // No generateEcash available but listing has prefix — block trade
      showToast("Cannot verify your federation. Please update your Fedi app and try again.", "error");
      return;
    }
    setLoading(true);
    try {
      let customMsats = hasRange && buyAmount ? parseInt(buyAmount) * 1000 : undefined;
      // Apply premium at checkout (P2P range + bill pay/P2P fixed)
      const rateM = (l.terms || "").match(/Rate:\s*(\d+)/);
      const ratePct = rateM ? parseFloat(rateM[1]) : 0;
      if (isP2P && customMsats && ratePct > 0) {
        customMsats = Math.ceil(customMsats * (1 + ratePct / 100));
        if (customMsats > 2_000_000_000) { showToast("Total with premium exceeds 2M sats federation limit!", "error"); setLoading(false); return; }
      }
      if (!customMsats && ratePct > 0 && (isP2P || isBillPay(l.category))) {
        customMsats = Math.ceil(l.priceMsats * (1 + ratePct / 100));
        if (customMsats > 2_000_000_000) { showToast("Total with premium exceeds 2M sats federation limit!", "error"); setLoading(false); return; }
      }
      const res = await mapi(`/${l.id}/buy`, { method: "POST", body: JSON.stringify(customMsats ? { amountMsats: customMsats } : {}) });
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
          amountMsats: customMsats || l.priceMsats,
          listingTitle: l.title,
          status: "pending",
 listingCategory: l.category,
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
          {hasRange ? (
            <>
              <div style={{ fontSize: 24, fontWeight: 900, color: "#f8fafc", letterSpacing: -1 }}>
                <span style={{ color: "#f7931a", fontWeight: 800, fontSize: 22 }}>₿</span>{l.minPriceSats.toLocaleString()} — <span style={{ color: "#f7931a", fontWeight: 800, fontSize: 22 }}>₿</span>{l.maxPriceSats.toLocaleString()}
              </div>
              {fiatRates && <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>≈ {fmtFiat(l.minPriceMsats, fiatRates, "USD")} — {fmtFiat(l.maxPriceMsats, fiatRates, "USD")}</div>}
            </>
          ) : (
            <>
              <div style={{ fontSize: 32, fontWeight: 900, color: "#f8fafc", letterSpacing: -1 }}>
                <span style={{ color: "#f7931a", fontWeight: 800, fontSize: 30 }}>₿</span>{fmtSats(l.priceMsats)}
              </div>
              {fiatRates && <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>≈ {fmtFiat(l.priceMsats, fiatRates, "USD")}</div>}
            </>
          )}
        </div>

        {l.images && l.images.length > 0 && (
          <div style={{ display: "flex", gap: 8, overflowX: "auto", padding: "0 0 12px", WebkitOverflowScrolling: "touch" }}>
            {l.images.map((url, i) => (
              <a key={i} href={url} target="_blank" rel="noopener noreferrer" style={{ flexShrink: 0 }}>
                <img src={url} alt="" style={{ width: 120, height: 120, objectFit: "cover", borderRadius: 10, border: "1px solid #1e293b" }}
                  onError={e => { e.target.style.display = "none"; }}
                />
              </a>
            ))}
          </div>
        )}

        {/* Trade type indicator */}
        {isP2P && (() => {
          // Extract P2P details from terms
          const termsStr = l.terms || "";
          const p2pSection = termsStr.split("--- P2P Details ---")[1] || "";
          const getDetail = (key) => { const m = p2pSection.match(new RegExp(key + ":\\s*(.+)")); return m ? m[1].trim() : null; };
          const currency = getDetail("Currency");
          const payment = getDetail("Payment");
          const rate = getDetail("Rate");
          return (
            <div style={{ ...M.infoBanner, borderColor: "rgba(245,158,11,0.3)", background: "rgba(245,158,11,0.06)", marginBottom: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                <span style={{ fontSize: 14 }}>₿</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: "#f59e0b" }}>P2P Sats-for-Fiat Trade</span>
              </div>
              <div style={{ fontSize: 11, color: "#94a3b8", lineHeight: 1.5, marginBottom: 8 }}>
                Seller locks ₿ sats in escrow. You send fiat externally. Once both confirm, you receive the sats.
              </div>
              {(currency || payment || rate) && (
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                  {currency && <div style={{ padding: "4px 10px", borderRadius: 6, background: "rgba(245,158,11,0.12)", fontSize: 11, fontWeight: 700, color: "#f59e0b" }}>{currency}</div>}
                  {payment && <div style={{ padding: "4px 10px", borderRadius: 6, background: "rgba(139,92,246,0.12)", fontSize: 11, fontWeight: 700, color: "#a78bfa" }}>{payment}</div>}
                  {rate && rate !== "N/A" && <div style={{ padding: "4px 10px", borderRadius: 6, background: "rgba(16,185,129,0.12)", fontSize: 11, fontWeight: 700, color: "#10b981" }}>+{rate}% premium</div>}
                </div>
              )}
            </div>
          );
        })()}

        {/* Amount picker for P2P range listings */}
        {canBuy && hasRange && (
          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 11, color: "#f59e0b", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6, display: "block" }}>How many sats do you want to buy?</label>
            <input style={M.input} type="number" placeholder={l.minPriceSats.toLocaleString() + " — " + l.maxPriceSats.toLocaleString() + " sats"} value={buyAmount} onChange={e => setBuyAmount(e.target.value)} />
            {buyAmount && fiatRates && <div style={{ fontSize: 12, color: "#64748b", marginTop: 4, textAlign: "center" }}>≈ {fmtFiat(parseInt(buyAmount) * 1000 || 0, fiatRates, "USD")}</div>}
            {buyAmount && (() => {
              const termsStr = l.terms || "";
              const p2pBlock = termsStr.split("--- P2P Details ---")[1] || "";
              const rateMatch = p2pBlock.match(/Rate:\s*(.+)/);
              const ratePct = rateMatch ? parseFloat(rateMatch[1]) : 0;
              const base = parseInt(buyAmount) || 0;
              const premium = ratePct > 0 ? Math.ceil(base * ratePct / 100) : 0;
              const total = base + premium;
              if (!base) return null;
              return (
                <div style={{ marginTop: 8, padding: "10px 14px", borderRadius: 10, background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.15)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#94a3b8", marginBottom: 4 }}>
                    <span>Base amount</span>
                    <span>₿ {base.toLocaleString()} sats</span>
                  </div>
                  {premium > 0 && (
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#10b981", marginBottom: 4 }}>
                      <span>Premium ({ratePct}%)</span>
                      <span>+ ₿ {premium.toLocaleString()} sats</span>
                    </div>
                  )}
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 700, color: "#f8fafc", borderTop: "1px solid rgba(245,158,11,0.15)", paddingTop: 6, marginTop: 4 }}>
                    <span>Total</span>
                    <span>₿ {total.toLocaleString()} sats</span>
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {canBuy && (isP2P || isBillPay(l.category)) && !hasRange && fiatRates && (() => {
          const rateM = (l.terms || "").match(/Rate:\s*(\d+)/);
          const ratePct = rateM ? parseFloat(rateM[1]) : 0;
          const baseSats = Math.floor(l.priceMsats / 1000);
          const premiumSats = ratePct > 0 ? Math.ceil(baseSats * ratePct / 100) : 0;
          const totalSats = baseSats + premiumSats;
          const fiatAmount = fmtFiat(l.priceMsats, fiatRates, l.fiatCurrency || "USD");
          return (
            <div style={{ marginBottom: 10, padding: "12px 14px", borderRadius: 10, background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.15)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#94a3b8", marginBottom: 4 }}>
                <span>{isBillPay(l.category) ? t("mkBillAmount") || "Bill amount" : t("mkBaseAmount") || "Base amount"}</span>
                <span>{fiatAmount} ({baseSats.toLocaleString()} sats)</span>
              </div>
              {premiumSats > 0 && (
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#10b981", marginBottom: 4 }}>
                  <span>{t("mkVolunteerEarns") || "Volunteer earns"} ({ratePct}%)</span>
                  <span>+ {premiumSats.toLocaleString()} sats</span>
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, fontWeight: 700, color: "#f59e0b", borderTop: "1px solid rgba(245,158,11,0.15)", paddingTop: 6, marginTop: 4 }}>
                <span>{isBillPay(l.category) ? t("mkVolunteerReceives") || "Volunteer receives" : t("mkTotal") || "Total"}</span>
                <span>{totalSats.toLocaleString()} sats</span>
              </div>
            </div>
          );
        })()}
        {canBuy && (
          <button style={{ ...M.actionBtn, background: isP2P || isBillPay(l.category) ? "linear-gradient(135deg, #f59e0b, #d97706)" : "linear-gradient(135deg, #10b981, #059669)", boxShadow: isP2P || isBillPay(l.category) ? "0 4px 24px rgba(245,158,11,0.3)" : "0 4px 24px rgba(16,185,129,0.3)", color: (isP2P || isBillPay(l.category)) ? "#0c0f17" : "#fff", marginBottom: 16 }} onClick={() => { if (hasRange && (!buyAmount || parseInt(buyAmount) < l.minPriceSats || parseInt(buyAmount) > l.maxPriceSats)) { showToast("Pick an amount between " + l.minPriceSats.toLocaleString() + " and " + l.maxPriceSats.toLocaleString() + " sats", "error"); return; } handleBuy(); }} disabled={loading || (isLending(l.category) && myLendingLevel && Math.floor(l.priceMsats / 1000) > myLendingLevel.maxSats)}>
            {loading
              ? (isP2P ? "Starting trade…" : t("mkBuying"))
              : isP2P
                ? (hasRange ? ("Start Trade — ₿ " + (() => { const b = parseInt(buyAmount) || 0; const rm = (l.terms || "").match(/Rate:\s*(\d+)/); const rp = rm ? parseFloat(rm[1]) : 0; return rp > 0 ? (b + Math.ceil(b * rp / 100)).toLocaleString() : (buyAmount || "?"); })() + " sats") : ("Start Trade — ₿ " + fmtSats(l.priceMsats) + " sats"))
                : isLending(l.category) ? ("🤝 Accept Loan — ₿ " + fmtSats(l.priceMsats)) : isBillPay(l.category) ? ("🧾 Pay Bill — ₿ " + fmtSats(l.priceMsats)) : ("⚡ Buy for ₿ " + fmtSats(l.priceMsats + (l.shippingCostSats ? l.shippingCostSats * 1000 : 0)))
            }
          </button>
        )}

        {/* Marketplace buyer info */}
        {l.shippingCostSats > 0 && (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", marginBottom: 10, borderRadius: 10, background: "rgba(59,130,246,0.04)", border: "1px solid rgba(59,130,246,0.15)" }}>
            <span style={{ fontSize: 12, color: "#94a3b8" }}>📦 Shipping</span>
            <span style={{ fontSize: 14, fontWeight: 700, color: "#3b82f6" }}>₿ {l.shippingCostSats.toLocaleString()} sats</span>
          </div>
        )}
        {l.shippingCostSats > 0 && (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", marginBottom: 14, borderRadius: 10, background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.2)" }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#f59e0b" }}>Total</span>
            <span style={{ fontSize: 16, fontWeight: 900, color: "#f8fafc" }}>₿ {(Math.floor(l.priceMsats / 1000) + l.shippingCostSats).toLocaleString()} sats</span>
          </div>
        )}
        {l.platformFeeBps > 0 && (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 14px", marginBottom: 10, borderRadius: 10, background: "rgba(100,116,139,0.04)", border: "1px solid rgba(100,116,139,0.1)" }}>
            <span style={{ fontSize: 11, color: "#64748b" }}>{t("mkPlatformFee") || "Platform fee"}</span>
            <span style={{ fontSize: 11, fontWeight: 600, color: "#64748b" }}>{(l.platformFeeBps / 100)}% ({Math.ceil(Math.floor(l.priceMsats / 1000) * l.platformFeeBps / 10000).toLocaleString()} sats)</span>
          </div>
        )}
        {(l.sellerFedPrefix || l.sellerFedDomain) && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 14px", marginBottom: 10, borderRadius: 10, background: "rgba(139,92,246,0.06)", border: "1px solid rgba(139,92,246,0.15)" }}>
            <span style={{ fontSize: 14 }}>{"🏛️"}</span>
            <span style={{ fontSize: 12, fontWeight: 600, color: "#a78bfa" }}>Federation: {getFedName(l.sellerFedPrefix, l.sellerFedDomain)}</span>
            <span style={{ fontSize: 10, color: "#64748b", marginLeft: "auto" }}>Must match yours</span>
          </div>
        )}
        {isLending(l.category) && myLendingLevel && (
          <div style={{ padding: "10px 14px", borderRadius: 10, background: "rgba(139,92,246,0.08)", border: "1px solid rgba(139,92,246,0.2)", marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <span style={{ fontSize: 12, color: "#a78bfa", fontWeight: 700 }}>Your Lending Level</span>
                <div style={{ fontSize: 16, fontWeight: 800, color: "#f8fafc", marginTop: 2 }}>Level {myLendingLevel.level} — {myLendingLevel.name}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 11, color: "#64748b" }}>Max loan</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#a78bfa" }}>₿ {myLendingLevel.maxSats.toLocaleString()}</div>
              </div>
            </div>
            {Math.floor(l.priceMsats / 1000) > myLendingLevel.maxSats && (
              <div style={{ marginTop: 8, padding: "6px 10px", borderRadius: 8, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)", fontSize: 11, color: "#ef4444", fontWeight: 600 }}>
                ⚠️ This loan exceeds your Level {myLendingLevel.level} limit. Repay smaller loans on time to level up.
              </div>
            )}
          </div>
        )}
        {canBuy && !isP2P && (
          <div style={{ ...M.infoBanner, borderColor: "rgba(16,185,129,0.2)", background: "rgba(16,185,129,0.04)", marginBottom: 14 }}>
            <div style={{ fontSize: 11, color: "#94a3b8", lineHeight: 1.5 }}>
              {isLending(l.category) ? <span>The lender will lock <strong style={{ color: "#10b981" }}>{"₿"} {fmtSats(l.priceMsats)}</strong> for you to borrow.</span>
              : isBillPay(l.category) ? <div>
                  {(() => { const cm = (l.terms || "").match(/Currency:\s*(\w+)/); return cm ? <div style={{ marginBottom: 4 }}><span style={{ color: "#64748b" }}>{t("mkFiatCurrency") || "Currency"}:</span> <strong style={{ color: "#f59e0b" }}>{cm[1]}</strong></div> : null; })()}
                  {l.paymentMethods && l.paymentMethods.length > 0 && <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>{l.paymentMethods.map(pm => { const m = PAYMENT_METHODS.find(p => p.key === pm); return m ? <span key={pm} style={{ padding: "3px 8px", borderRadius: 6, fontSize: 10, fontWeight: 600, background: "rgba(16,185,129,0.1)", color: "#10b981", border: "1px solid rgba(16,185,129,0.2)" }}>{m.icon} {m.label}</span> : null; })}</div>}
                </div>
              : <span>You'll lock <strong style={{ color: "#10b981" }}>{"₿"} {fmtSats(l.priceMsats + (l.shippingCostSats ? l.shippingCostSats * 1000 : 0))}</strong> as payment.</span>}
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
                When someone starts this trade, you'll lock your ₿ sats in escrow. The buyer sends you fiat externally.
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
            <div style={M.sectionValue}>{l.description?.split("\n").map((line, i) => {
              const urlMatch = line.match(/(https?:\/\/[^\s]+)/);
              if (urlMatch) {
                const url = urlMatch[1];
                const before = line.slice(0, urlMatch.index);
                const after = line.slice(urlMatch.index + url.length);
                return <div key={i}>{before}<a href={url} target="_blank" rel="noopener noreferrer" style={{ color: "#3b82f6", textDecoration: "underline" }}>{url}</a>{after}</div>;
              }
              return <div key={i}>{line}</div>;
            })}</div>
          </div>
        )}

        {l.terms && isSeller && (
          <div style={M.section}>
            <div style={M.sectionLabel}>{t("tradeTerms")}</div>
            {(() => {
              const raw = l.terms || "";
              const parts = raw.split(/---\s*(P2P Details|Loan Terms|Bill Pay Details)\s*---/);
              const userTerms = (parts[0] || "").trim();
              const metaBlock = parts.length > 2 ? parts[2] : "";
              const metaLines = metaBlock.split("\n").map(ln => ln.trim()).filter(Boolean);
              const meta = {};
              metaLines.forEach(line => { const [k, ...v] = line.split(":"); if (k && v.length) meta[k.trim()] = v.join(":").trim(); });
              if (Object.keys(meta).length === 0) return <div style={M.sectionValue}>{raw}</div>;
              return <>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center", marginBottom: userTerms ? 10 : 0 }}>
                  {Object.entries(meta).map(([k, v]) => (
                    <div key={k} style={{ padding: "5px 12px", borderRadius: 8, background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.2)", fontSize: 12 }}>
                      <span style={{ color: "#94a3b8" }}>{k}: </span>
                      <span style={{ color: "#f8fafc", fontWeight: 600 }}>{(k === "Interest" || k === "Rate") && v && !String(v).includes("%") ? v + "%" : k === "Fiat needed" ? v : v}</span>
                    </div>
                  ))}
                </div>
                {userTerms && <div style={{ fontSize: 13, color: "#cbd5e1", lineHeight: 1.8, textAlign: "center", whiteSpace: "pre-line", marginTop: 6 }}>{userTerms}</div>}
              </>;
            })()}
          </div>
        )}
        {l.terms && !isSeller && (
          <div style={{ ...M.infoBanner, borderColor: "rgba(100,116,139,0.2)", background: "rgba(100,116,139,0.04)", marginBottom: 14 }}>
            <div style={{ fontSize: 12, color: "#64748b", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
              🔒 {t("mkTradeTermsHidden") || "Trade terms visible after purchase"}
            </div>
          </div>
        )}

        {/* ── Listing info grid ── */}
        {!isBillPay(l.category) && <div style={{ display: "flex", justifyContent: "space-around", padding: "12px 0", marginBottom: 14, borderRadius: 12, background: "rgba(15,23,42,0.5)", border: "1px solid #1e293b", textAlign: "center" }}>
          {l.condition && !isP2P && !isBillPay(l.category) && (
            <div>
              <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5 }}>{t("mkCondition")}</div>
              <div style={{ fontSize: 13, color: "#f8fafc", fontWeight: 600, marginTop: 2 }}>{t(CONDITION_KEYS[l.condition] || l.condition)}</div>
            </div>
          )}
          {l.category && !isBillPay(l.category) && (
            <div>
              <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5 }}>{t("mkCategory")}</div>
              <div style={{ fontSize: 13, color: "#f8fafc", fontWeight: 600, marginTop: 2 }}>{l.category}</div>
            </div>
          )}
          {!isBillPay(l.category) && <div>
            <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5 }}>{t("mkAvailable")}</div>
            <div style={{ fontSize: 13, color: "#10b981", fontWeight: 700, marginTop: 2 }}>{l.quantity}</div>
          </div>}
        </div>}

        {/* ── Seller ── */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, padding: "14px", marginBottom: 10, borderRadius: 10, background: "rgba(245,158,11,0.04)", border: "1px solid rgba(245,158,11,0.1)" }}>
          <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5 }}>{t("seller")}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 18 }}>🏠</span>
            <div onClick={() => onProfile(l.sellerPubkey)} style={{ cursor: "pointer" }}><SellerName pubkey={l.sellerPubkey} /></div>
          </div>
        </div>

        <div style={{ fontSize: 11, color: "#334155", textAlign: "center", fontFamily: "monospace" }}>
          ID: {l.id}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// CREATE LISTING VIEW
// ═══════════════════════════════════════════════════════════════════════

function CreateListingView({ pubkey, subdomain, myFederation, onBack, onCreated, showToast, loading, setLoading }) {
  const [title, setTitle] = useState(() => {
    try { const bp = JSON.parse(sessionStorage.getItem("sm_billpay_prefill") || "null"); if (bp && bp.billType) { sessionStorage.removeItem("sm_billpay_prefill"); return bp.billType.icon + " " + bp.billType.label + " bill - " + bp.fiatCurrency + " " + parseFloat(bp.fiatAmount).toFixed(2); } } catch(e) {}
    return "";
  });
  const [desc, setDesc] = useState("");
  const [price, setPrice] = useState(() => {
    try { const bp = JSON.parse(sessionStorage.getItem("sm_billpay_prefill_price") || "null"); if (bp) { sessionStorage.removeItem("sm_billpay_prefill_price"); return String(bp); } } catch(e) {}
    return "";
  });
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [terms, setTerms] = useState("");
  const [category, setCategory] = useState(() => {
    try { const bp = JSON.parse(sessionStorage.getItem("sm_billpay_prefill") || "null"); if (bp) return "bill-pay"; } catch(e) {}
    return subdomain === "p2p" ? "sats-for-fiat" : subdomain === "lending" ? "lending" : "";
  });
  const [condition, setCondition] = useState("new");
  const [quantity, setQuantity] = useState("1");
  const [fiatCurrency, setFiatCurrency] = useState("USD");
  const [paymentMethods, setPaymentMethods] = useState([]);
  const [paymentMethod, setPaymentMethod] = useState("");
  const [listingImages, setListingImages] = useState([]);
  const [imgUploading, setImgUploading] = useState(false);
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [shippingCost, setShippingCost] = useState("");
  const [federationOnly, setFederationOnly] = useState(false);
  const listingFileRef = useRef(null);

  const uploadListingImage = async (file) => {
    if (!file || !file.type.startsWith("image/")) { showToast("Please select an image", "error"); return; }
    if (file.size > 20 * 1024 * 1024) { showToast("Image too large (max 20MB)", "error"); return; }
    if (listingImages.length >= 4) { showToast("Maximum 4 images", "error"); return; }
    setImgUploading(true);
    try {
      // Strip EXIF metadata by re-encoding through canvas
      const stripped = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement("canvas");
          const max = 1920;
          let w = img.width, h = img.height;
          if (w > max || h > max) {
            if (w > h) { h = Math.round(h * max / w); w = max; }
            else { w = Math.round(w * max / h); h = max; }
          }
          canvas.width = w; canvas.height = h;
          canvas.getContext("2d").drawImage(img, 0, 0, w, h);
          canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Canvas encode failed")), "image/jpeg", 0.85);
        };
        img.onerror = () => reject(new Error("Image load failed"));
        img.src = URL.createObjectURL(file);
      });
      const buf = await stripped.arrayBuffer();
      const hashBuf = await crypto.subtle.digest("SHA-256", buf);
      const sha256 = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, "0")).join("");
      if (!window.nostr) throw new Error("Nostr not available");
      const authEvent = {
        kind: 24242,
        created_at: Math.floor(Date.now() / 1000),
        tags: [["t", "upload"], ["x", sha256], ["expiration", String(Math.floor(Date.now() / 1000) + 300)]],
        content: "Upload listing image",
      };
      const signed = await window.nostr.signEvent(authEvent);
      const res = await fetch("https://blossom.band/upload", {
        method: "PUT",
        headers: { "Authorization": "Nostr " + btoa(JSON.stringify(signed)), "Content-Type": "image/jpeg" },
        body: stripped,
      });
      if (!res.ok) throw new Error("Upload failed (" + res.status + ")");
      const data = await res.json();
      const url = data.url || ("https://blossom.band/" + sha256);
      setListingImages(prev => [...prev, url]);
      showToast("Image uploaded!");
    } catch (err) {
      showToast("Image upload failed: " + (err.message || ""), "error");
    }
    setImgUploading(false);
  };

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
  const isBill = isBillPay(category);
  const isShipping = category.toLowerCase().trim() === "shipping";
  const isSpecial = isP2P || isLoan;

  // Auto-set condition/qty when P2P or Lending is selected
  useEffect(() => {
    if (isP2P || isLoan) { setCondition("service"); setQuantity("1"); }
  }, [isP2P, isLoan]);

  const handleCreate = async () => {
    let sats, minSats, maxSats;

    if (isP2P) {
      // P2P: use bracket pricing (min/max range)
      minSats = parseInt(minPrice);
      maxSats = parseInt(maxPrice);
      if (!minSats || minSats <= 0) return showToast("Enter a minimum price", "error");
      if (!maxSats || maxSats <= 0) return showToast("Enter a maximum price", "error");
      if (minSats < 1) return showToast("Minimum ₿ 1 sat", "error");
      if (maxSats < minSats) return showToast("Max must be greater than min", "error");
      if (maxSats > 2_000_000) return showToast(t("mkPriceExceeds"), "error");
      sats = maxSats; // listing price = max (display price)
    } else {
      sats = parseInt(price);
    }

    if (!title.trim()) return showToast(t("mkTitleRequired"), "error");
    if (!category) return showToast("Please select a category", "error");
    if ((isP2P || isBill) && !fiatCurrency) return showToast("Please select a currency", "error");
    if (isLoan && (paymentMethod === "Fiat" || paymentMethod === "Mixed") && !fiatCurrency) return showToast("Please select a currency for fiat repayment", "error");
 if (isShipping && (!shippingCost || Number(shippingCost) <= 0)) return showToast("Shipping cost is required for shipping listings", "error");
    if (!sats || sats <= 0) return showToast(t("mkPriceRequired"), "error");
    if (sats < 1) return showToast("Minimum ₿ 1 sat", "error");
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
      // Federation probe: generate 1 sat to capture federation prefix
      let sellerFedPrefix = null;
      const _isSandbox = !window.fediInternal || isDevMode();
      if (!_isSandbox && window.fediInternal && window.fediInternal.generateEcash) {
        try {
          showToast("Detecting your federation...");
          const probe = await window.fediInternal.generateEcash({ amount: 1 });
          if (probe && probe.length > 10) {
            sellerFedPrefix = probe.substring(0, 10);
            // Return the 1 sat immediately
            try { await window.fediInternal.receiveEcash(probe); } catch {}
          }
        } catch { /* user cancelled probe */ }
      }

      // REQUIRE federation prefix — block listing if probe failed
      if (!sellerFedPrefix && !_isSandbox) {
        showToast("Federation detection failed — please try again. Make sure to select a federation when prompted.", "error");
        setLoading(false);
        return;
      }

      const res = await mapi("/", {
        method: "POST",
        body: JSON.stringify({
          title: title.trim(),
          description: (desc.trim() + (websiteUrl.trim() ? "\n\n\ud83c\udf10 " + websiteUrl.trim() : "")) || undefined,
          priceMsats: sats * 1000,
          minPriceMsats: minSats ? minSats * 1000 : undefined,
          maxPriceMsats: maxSats ? maxSats * 1000 : undefined,
          terms: finalTerms || undefined,
          category: category.trim() || undefined,
          condition: isSpecial ? "service" : condition,
          communityLink: community.trim() || undefined,
          sellerFedDomain: myFederation || undefined,
          sellerFedPrefix: sellerFedPrefix || undefined,
          quantity: parseInt(quantity) || 1,
          images: listingImages.length > 0 ? listingImages : undefined,
          shippingCostSats: shippingCost ? parseInt(shippingCost) : undefined,
          federationOnly: federationOnly,
          paymentMethods: paymentMethods.length > 0 ? paymentMethods : undefined,
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

      {/* ── Category: fixed badge on p2p/lending, full picker otherwise ── */}
      {subdomain === "p2p" && (
        <div style={{ padding: "10px 14px", borderRadius: 10, background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.2)", marginBottom: 14, fontSize: 13, fontWeight: 700, color: "#f59e0b", display: "flex", alignItems: "center", gap: 8 }}>₿ P2P Trade</div>
      )}
      {subdomain === "lending" && (
        <div style={{ padding: "10px 14px", borderRadius: 10, background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.2)", marginBottom: 14, fontSize: 13, fontWeight: 700, color: "#10b981", display: "flex", alignItems: "center", gap: 8 }}>🤝 Community Lending</div>
      )}
      {subdomain === "market" && (
        <div style={{ padding: "10px 14px", borderRadius: 10, background: "rgba(139,92,246,0.08)", border: "1px solid rgba(139,92,246,0.2)", marginBottom: 14, fontSize: 13, fontWeight: 700, color: "#a78bfa", display: "flex", alignItems: "center", gap: 8 }}>{"🛒"} Marketplace</div>
      )}
      {subdomain !== "p2p" && subdomain !== "lending" && (
      <div style={M.formGroup}>
        <label style={M.label}>{t("mkCategory")}</label>

        {/* Bitcoin categories — hidden on market subdomain */}
        {subdomain !== "market" && <><div style={{ fontSize: 10, color: "#f59e0b", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>₿ Bitcoin</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
          {[
            { value: SATS_FOR_FIAT, label: "₿ P2P Trade", color: "#f59e0b", bg: "rgba(245,158,11,0.12)" },
            { value: LENDING, label: "🤝 Lending", color: "#10b981", bg: "rgba(16,185,129,0.12)" },
          ].map(cat => {
            const active = category === cat.value;
            return (
              <button key={cat.value} onClick={() => {
                setCategory(active ? "" : cat.value);
                if (active) { setPaymentMethod && setPaymentMethod(""); setFiatCurrency && setFiatCurrency(""); }
              }} style={{
                ...M.chipBtn, padding: "8px 14px",
                ...(active ? { ...M.chipBtnActive, borderColor: cat.color, color: cat.color, background: cat.bg } : { borderColor: "transparent", background: "#111827", color: "#94a3b8" }),
              }}>
                {cat.label}
              </button>
            );
          })}
        </div>

        </>}

        {/* Marketplace categories — hidden on p2p/lending subdomain */}
        {subdomain !== "p2p" && subdomain !== "lending" && <><div style={{ fontSize: 10, color: "#a78bfa", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>🛒 Marketplace</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
          {[
            { value: "electronics", label: "📱 Electronics" },
            { value: "clothing", label: "👕 Clothing" },
            { value: "shipping", label: "📦 Shipping" },
            { value: "art", label: "🎨 Art" },
            { value: "services", label: "🛠 Services" },
            { value: "digital", label: "💾 Digital" },
          ].map(cat => {
            const active = category === cat.value;
            return (
              <button key={cat.value} onClick={() => {
                if (isSpecialCategory(category)) setCategory(cat.value);
                else setCategory(active ? "" : cat.value);
              }} style={{
                ...M.chipBtn,
                ...(active ? { ...M.chipBtnActive, borderColor: "#a78bfa", color: "#f8fafc", background: "rgba(139,92,246,0.12)" } : { borderColor: "transparent", background: "#111827", color: "#94a3b8" }),
              }}>
                {cat.label}
              </button>
            );
          })}
        </div>
        </>}
        {!isP2P && !isLoan && !isBill && (
          <input style={M.input} placeholder="Or type a custom category..." value={isSpecialCategory(category) ? "" : category} onChange={e => setCategory(e.target.value)} />
        )}
      </div>
      )}


      {/* Bill Pay button removed - now accessed via BillPayView */}
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

      {/* Old Bill Pay banner removed - now handled by BillPayView */}

      {/* ── Lending mode banner ── */}
      {isLoan && (
        <div style={{ ...M.infoBanner, borderColor: "rgba(16,185,129,0.3)", background: "rgba(16,185,129,0.06)", marginBottom: 14, borderLeft: "3px solid #10b981" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
            <span style={{ fontSize: 15 }}>🤝</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#10b981" }}>Community Lending</span>
          </div>
          <div style={{ fontSize: 11, color: "#94a3b8", lineHeight: 1.5 }}>
            You lock ₿ sats in escrow as a loan. The borrower receives them and repays externally (fiat, goods, labor). The community arbiter verifies repayment.
          </div>
        </div>
      )}

      {/* ── Market mode banner ── */}
      {!isP2P && !isBill && !isLoan && !isShipping && category && (
        <div style={{ ...M.infoBanner, borderColor: "rgba(139,92,246,0.3)", background: "rgba(139,92,246,0.06)", marginBottom: 14, borderLeft: "3px solid #a78bfa" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
            <span style={{ fontSize: 15 }}>{"🛒"}</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#a78bfa" }}>Marketplace</span>
          </div>
          <div style={{ fontSize: 11, color: "#94a3b8", lineHeight: 1.5 }}>
            List your item for sats. Buyers lock payment in escrow, you ship or deliver, both confirm, sats released to your wallet.
          </div>
        </div>
      )}

      {/* ── Shipping mode banner ── */}
      {isShipping && (
        <div style={{ ...M.infoBanner, borderColor: "rgba(59,130,246,0.3)", background: "rgba(59,130,246,0.06)", marginBottom: 14, borderLeft: "3px solid #3b82f6" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
            <span style={{ fontSize: 15 }}>📦</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#3b82f6" }}>Physical Item — Shipping</span>
          </div>
          <div style={{ fontSize: 11, color: "#94a3b8", lineHeight: 1.5 }}>
            14-day escrow window for shipping and inspection. Buyer confirms receipt, then both vote to release payment.
          </div>
        </div>
      )}

      {/* ── Common fields: Title + Price ── */}
      <div style={M.formGroup}><label style={M.label}>{t("mkFieldTitle")} *</label><input style={M.input} placeholder={isBill ? "e.g., Pay my $30 AT&T phone bill" : isP2P ? "e.g., Selling ₿ 50,000 sats for USD" : isLoan ? "e.g., Lending ₿ 50,000 sats — 14 day term" : t("mkFieldTitleHint")} value={title} onChange={e => setTitle(e.target.value)} /></div>
      {isP2P ? (
        <div style={M.formGroup}>
          <label style={M.label}>PRICE RANGE (SATS) *</label>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input style={{ ...M.input, flex: 1 }} type="number" placeholder="Min (e.g. 5000)" value={minPrice} onChange={e => setMinPrice(e.target.value)} />
            <span style={{ color: "#64748b", fontSize: 13 }}>—</span>
            <input style={{ ...M.input, flex: 1 }} type="number" placeholder="Max (e.g. 100000)" value={maxPrice} onChange={e => setMaxPrice(e.target.value)} />
          </div>
          <p style={M.hint}>Buyers choose any amount in this range. {t("maxFedLimit", { limit: "2,000,000" })}</p>
        </div>
      ) : (
        <div style={M.formGroup}><label style={M.label}>{isBill ? "BILL AMOUNT (SATS) *" : isLoan ? "LOAN AMOUNT (SATS) *" : t("mkFieldPrice") + " *"}</label><input style={M.input} type="number" placeholder="25000" value={price} onChange={e => setPrice(e.target.value)} /><p style={M.hint}>{t("maxFedLimit", { limit: "2,000,000" })}</p></div>
      )}

      {/* ── P2P + Bill Pay fields ── */}
      {(isP2P || isBill) && (
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
            <label style={M.label}>{t("mkRatePremium")} (%)</label>
            <input style={M.input} placeholder="e.g., 3" type="number" value={ratePremium} onChange={e => setRatePremium(e.target.value)} />
            {ratePremium && (minPrice || price) && (() => {
              const rp = Number(ratePremium) / 100;
              const adjMax = minPrice && maxPrice ? Math.ceil(Number(maxPrice) * (1 + rp)) : Math.ceil(Number(price) * (1 + rp));
              const adjMin = minPrice ? Math.ceil(Number(minPrice) * (1 + rp)) : adjMax;
              const exceeds = adjMax > 2_000_000;
              return <>
                <p style={{ ...M.hint, color: exceeds ? "#ef4444" : "#f59e0b", fontWeight: 600 }}>
                  {minPrice && maxPrice
                    ? "Range with premium: ₿ " + adjMin.toLocaleString() + " — ₿ " + adjMax.toLocaleString() + " sats"
                    : "Total with premium: ₿ " + adjMax.toLocaleString() + " sats"
                  }
                </p>
                {exceeds && <p style={{ ...M.hint, color: "#ef4444", fontWeight: 700 }}>⚠️ Exceeds 2M sats federation limit! Lower price or premium.</p>}
              </>;
            })()}
          </div>
        </div>
      )}

      {/* ── Lending-specific fields ── */}
      {isLoan && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", gap: 12 }}>
            <div style={{ flex: 1 }}>
              <label style={M.label}>INTEREST / PREMIUM (%)</label>
              <input style={M.input} placeholder="e.g., 5" type="number" value={interestRate} onChange={e => setInterestRate(e.target.value)} />
              {interestRate && price && (
                <p style={{ ...M.hint, color: "#10b981", fontWeight: 600 }}>
                  Total repayment: ₿ {Math.ceil(Number(price) * (1 + Number(interestRate) / 100)).toLocaleString()} sats
                </p>
              )}
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
            <label style={M.label}>REPAYMENT METHOD *</label>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {["Sats", "Fiat", "Goods/Labor", "Mixed"].map(rm => (
                <button key={rm} onClick={() => { setPaymentMethod(rm); if (rm === "Sats" || rm === "Goods/Labor") setFiatCurrency(""); }} style={{
                  ...M.chipBtn, padding: "6px 12px", fontSize: 12,
                  ...(paymentMethod === rm ? { ...M.chipBtnActive, borderColor: "#10b981", color: "#10b981", background: "rgba(16,185,129,0.12)" } : { borderColor: "transparent", background: "#111827", color: "#94a3b8" }),
                }}>
                  {rm}
                </button>
              ))}
            </div>
            {!paymentMethod && <p style={{ ...M.hint, color: "#f59e0b" }}>Please select a repayment method</p>}
          </div>
        </div>
      )}

      {/* ── P2P/Lending: Quantity (how many trades) ── */}
      {(isP2P || isLoan) && (
        <div style={{ marginBottom: 16 }}>
          <label style={M.label}>{t("mkHowManyTrades") || "How many trades will you accept?"}</label>
          <input style={{ ...M.input, width: 100 }} type="number" min="1" value={quantity} onChange={e => setQuantity(e.target.value)} placeholder="1" />
          <p style={M.hint}>Each buyer creates a separate trade within your price range.</p>
        </div>
      )}

      {/* ── Non-P2P/Lending fields: Condition + Quantity ── */}
      {!isP2P && !isLoan && !isBill && (
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

      {/* ── Payment Methods (P2P + Bill Pay) ── */}
      {(isP2P || isBill || (isLoan && (paymentMethod === "Fiat" || paymentMethod === "Mixed"))) && (
        <div style={{ marginBottom: 16 }}>
          <label style={{ ...M.label, color: "#10b981" }}>{"💳"} {t("mkAcceptedPayment") || "Accepted Payment Methods"}</label>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {PAYMENT_METHODS.map(pm => {
              const active = paymentMethods.includes(pm.key);
              return (
                <button key={pm.key} onClick={() => setPaymentMethods(prev => active ? prev.filter(k => k !== pm.key) : [...prev, pm.key])} style={{ padding: "5px 10px", borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: "pointer", border: active ? "1.5px solid #10b981" : "1px solid #334155", background: active ? "rgba(16,185,129,0.15)" : "#111827", color: active ? "#10b981" : "#94a3b8", transition: "all 0.15s" }}>
                  {pm.icon} {pm.label}
                </button>
              );
            })}
          </div>
          {paymentMethods.length > 0 && <div style={{ fontSize: 10, color: "#475569", marginTop: 4 }}>{paymentMethods.length} selected</div>}
        </div>
      )}

      {/* ── Common fields: Description + Terms + Community ── */}
      <div style={M.formGroup}><label style={M.label}>{t("description")}</label><textarea style={{ ...M.input, minHeight: 72, resize: "vertical" }} placeholder={isP2P ? "Any additional details about your trade..." : t("mkFieldDescHint")} value={desc} onChange={e => setDesc(e.target.value)} /></div>

      {!isP2P && !isLoan && !isBill && (
        <div style={M.formGroup}>
          <label style={M.label}>PHOTOS (optional)</label>
          <input type="file" accept="image/*" ref={listingFileRef} onChange={e => { if (e.target.files?.[0]) uploadListingImage(e.target.files[0]); e.target.value = ""; }} style={{ display: "none" }} />
          {listingImages.length > 0 && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
              {listingImages.map((url, i) => (
                <div key={i} style={{ position: "relative", width: 72, height: 72, borderRadius: 8, overflow: "hidden", border: "1px solid #1e293b" }}>
                  <img src={url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  <button onClick={() => setListingImages(prev => prev.filter((_, j) => j !== i))} style={{
                    position: "absolute", top: 2, right: 2, width: 18, height: 18, borderRadius: "50%",
                    background: "rgba(0,0,0,0.7)", color: "#fff", fontSize: 10, border: "none", cursor: "pointer",
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>✕</button>
                </div>
              ))}
            </div>
          )}
          <button onClick={() => listingFileRef.current?.click()} disabled={imgUploading || listingImages.length >= 4} style={{
            padding: "10px 16px", borderRadius: 10, border: "1px dashed #334155", background: "transparent",
            color: imgUploading ? "#475569" : "#64748b", fontSize: 12, fontWeight: 600, cursor: "pointer", width: "100%",
          }}>
            {imgUploading ? "Uploading..." : listingImages.length > 0 ? "📷 Add another photo (" + listingImages.length + "/4)" : "📷 Add photos of your item"}
          </button>
          <div style={{ marginTop: 8 }}>
            <input style={M.input} placeholder="https://your-shop.com (optional)" value={websiteUrl} onChange={e => setWebsiteUrl(e.target.value)} />
            <p style={{ fontSize: 10, color: "#475569", marginTop: 4 }}>Link to your shop, portfolio, or product page</p>
          </div>
          {!isBill && <div style={{ marginTop: 8 }}>
            <div style={M.sectionLabel}>SHIPPING COST (sats, optional)</div>
            <input style={M.input} type="number" placeholder="e.g., 500" value={shippingCost} onChange={e => setShippingCost(e.target.value)} />
            <p style={{ fontSize: 10, color: "#475569", marginTop: 4 }}>Added to the item price. Buyer pays item + shipping.</p>
          </div>}
        </div>
      )}

      <div style={M.formGroup}><label style={M.label}>{t("tradeTerms")}</label><textarea style={{ ...M.input, minHeight: 60, resize: "vertical" }} placeholder={isP2P ? "Payment window, confirmation steps..." : t("mkFieldTermsHint")} value={terms} onChange={e => setTerms(e.target.value)} /></div>



      {/* ── Federation-only toggle ── */}
      <div style={{ padding: "12px 14px", borderRadius: 10, background: "rgba(139,92,246,0.06)", border: "1px solid rgba(139,92,246,0.15)", marginTop: 8, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#a78bfa" }}>🏛️ Federation Only</div>
          <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>Only visible to users in your federation</div>
        </div>
        <button onClick={() => setFederationOnly(!federationOnly)} style={{ width: 44, height: 24, borderRadius: 12, border: "none", cursor: "pointer", background: federationOnly ? "#a78bfa" : "#334155", position: "relative", transition: "background 0.2s" }}>
          <div style={{ width: 18, height: 18, borderRadius: 9, background: "#fff", position: "absolute", top: 3, left: federationOnly ? 23 : 3, transition: "left 0.2s" }} />
        </button>
      </div>
      <button style={{ ...M.primaryBtn, width: "100%", marginTop: 8, padding: "14px 0" }} onClick={handleCreate} disabled={loading}>
        {loading ? t("creating") : t("mkCreateListing")}
      </button>
    </div>
  );
}


// =====================================================================
// BILL PAY VIEW - Simplified two-door flow
// "I need fiat for a bill" / "I want to buy sats"
// =====================================================================

const BILL_TYPES = [
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

function BillPayView({ listings, loading, pubkey, onBack, onCreate, onOpen, onOrders, onRefresh, fiatRates, showToast, subdomain, activeOrderCount }) {
  const [mode, setMode] = useState(null);
  const [posting, setPosting] = useState(false);
  const [billType, setBillType] = useState(null);
  const [fiatAmount, setFiatAmount] = useState("");
  const [fiatCurrency, setFiatCurrency] = useState("USD");
  const [note, setNote] = useState("");
  const [premiumPct, setPremiumPct] = useState("5");
  const [payMethods, setPayMethods] = useState([]);

  // Auto-refresh every 15 seconds
  useEffect(() => {
    if (onRefresh) onRefresh();
    const iv = setInterval(() => { if (onRefresh) onRefresh(); }, 15000);
    return () => clearInterval(iv);
  }, []);

  const billListings = useMemo(() =>
    listings.filter(l => l.category === "bill-pay" && l.status !== "sold" && l.status !== "paused"),
    [listings]
  );

  const satsFromFiat = (fiatAmt, currency) => {
    if (!fiatRates || !fiatRates.btcUsd || !fiatRates.rates || !fiatAmt) return 0;
    const fxRate = fiatRates.rates[currency];
    if (!fxRate) return 0;
    const usd = parseFloat(fiatAmt) / fxRate;
    return Math.floor((usd / fiatRates.btcUsd) * 100000000);
  };
  const fmtFiatBP = (msats, currency) => {
    if (!fiatRates || !msats) return "";
    const rate = fiatRates[currency || "USD"];
    if (!rate) return "";
    const fiat = ((msats / 1000) / 100000000) * rate;
    return fiat < 0.01 ? "<$0.01" : "$" + fiat.toFixed(2);
  };
  const totalSatsWithPremium = () => {
    const base = satsFromFiat(fiatAmount, fiatCurrency);
    const prem = parseFloat(premiumPct) || 0;
    return Math.floor(base * (1 + prem / 100));
  };

  // CHOOSER
  if (mode === null) {
    return (
      <div style={{ padding: "0 16px 80px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
          <button onClick={onBack} style={{ background: "none", border: "none", color: "#94a3b8", fontSize: 18, cursor: "pointer", padding: 4 }}>{"←"}</button>
          <div>
            <h2 style={{ fontSize: 20, fontWeight: 800, color: "#f8fafc", margin: 0 }}>{"🧾"} Bill Pay</h2>
            <p style={{ fontSize: 12, color: "#64748b", margin: "2px 0 0" }}>Community-powered bill payments</p>
          </div>
        </div>

        <button onClick={() => setMode("need")} style={{ width: "100%", padding: "20px 16px", marginBottom: 10, borderRadius: 14, background: "linear-gradient(135deg, rgba(245,158,11,0.08), rgba(245,158,11,0.02))", border: "1.5px solid rgba(245,158,11,0.25)", cursor: "pointer", textAlign: "left" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 48, height: 48, borderRadius: 12, background: "rgba(245,158,11,0.12)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24 }}>{"💸"}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: "#f59e0b" }}>I need fiat for a bill</div>
              <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2, lineHeight: 1.4 }}>Lock your sats. Someone sends you fiat. You pay your own bill.</div>
            </div>
            <span style={{ color: "#f59e0b", fontSize: 18 }}>{"→"}</span>
          </div>
        </button>

        <button onClick={() => setMode("earn")} style={{ width: "100%", padding: "20px 16px", marginBottom: 16, borderRadius: 14, background: "linear-gradient(135deg, rgba(16,185,129,0.08), rgba(16,185,129,0.02))", border: "1.5px solid rgba(16,185,129,0.25)", cursor: "pointer", textAlign: "left" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 48, height: 48, borderRadius: 12, background: "rgba(16,185,129,0.12)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24 }}>{"₿"}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: "#10b981" }}>I want to buy sats</div>
              <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2, lineHeight: 1.4 }}>Send fiat to someone. Earn sats at a premium. Easy on-ramp.</div>
            </div>
            <span style={{ color: "#10b981", fontSize: 18 }}>{"→"}</span>
          </div>
        </button>

        <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
          <div style={{ flex: 1, padding: "12px", borderRadius: 10, background: "#111827", border: "1px solid #1e293b", textAlign: "center" }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: "#f59e0b" }}>{billListings.length}</div>
            <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5 }}>Bills Posted</div>
          </div>
          <div style={{ flex: 1, padding: "12px", borderRadius: 10, background: "#111827", border: "1px solid #1e293b", textAlign: "center" }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: "#10b981" }}>{activeOrderCount || 0}</div>
            <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5 }}>Your Trades</div>
          </div>
        </div>

        <div style={{ padding: "14px", borderRadius: 12, background: "#111827", border: "1px solid #1e293b" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 }}>How it works</div>
          {[
            { step: "1", icon: "🧾", label: "Post your bill", desc: "Say what you need and how much", color: "#f59e0b" },
            { step: "2", icon: "🔒", label: "Sats are secured", desc: "Locked in escrow — safe for both sides", color: "#a78bfa" },
            { step: "3", icon: "💵", label: "Fiat is sent", desc: "Volunteer sends you fiat via your preferred method", color: "#10b981" },
            { step: "4", icon: "✅", label: "Confirm & done", desc: "Got the fiat? Tap confirm. Everyone's happy.", color: "#3b82f6" },
          ].map((s, i) => (
            <div key={s.step} style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: i < 3 ? 10 : 0 }}>
              <div style={{ width: 32, height: 32, borderRadius: 8, background: s.color + "15", border: "1px solid " + s.color + "30", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, flexShrink: 0 }}>{s.icon}</div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#f8fafc" }}>{s.label}</div>
                <div style={{ fontSize: 11, color: "#64748b", lineHeight: 1.3 }}>{s.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // "I NEED FIAT" form
  if (mode === "need") {
    const baseSats = satsFromFiat(fiatAmount, fiatCurrency);
    const totalSats = totalSatsWithPremium();
    const premiumSats = totalSats - baseSats;

    return (
      <div style={{ padding: "0 16px 160px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <button onClick={() => setMode(null)} style={{ background: "none", border: "none", color: "#94a3b8", fontSize: 18, cursor: "pointer", padding: 4 }}>{"←"}</button>
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 800, color: "#f8fafc", margin: 0 }}>{"💸"} I need fiat for a bill</h2>
            <p style={{ fontSize: 11, color: "#64748b", margin: "2px 0 0" }}>Lock sats, get fiat from your community</p>
          </div>
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5, display: "block", marginBottom: 6 }}>What is this for?</label>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {BILL_TYPES.map(bt => {
              const active = billType === bt.id;
              return (
                <button key={bt.id} onClick={() => setBillType(active ? null : bt.id)} style={{ padding: "6px 12px", borderRadius: 8, fontSize: 12, fontWeight: active ? 700 : 500, background: active ? "rgba(245,158,11,0.12)" : "#111827", color: active ? "#f59e0b" : "#94a3b8", border: active ? "1px solid rgba(245,158,11,0.3)" : "1px solid #1e293b", cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}>
                  {bt.icon} {bt.label}
                </button>
              );
            })}
          </div>
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5, display: "block", marginBottom: 6 }}>How much do you need?</label>
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ flex: 1, position: "relative" }}>
              <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", fontSize: 18, color: "#f59e0b", fontWeight: 700 }}>$</span>
              <input type="number" inputMode="decimal" placeholder="0.00" value={fiatAmount} onChange={e => setFiatAmount(e.target.value)} style={{ width: "100%", padding: "14px 14px 14px 32px", borderRadius: 10, border: "1.5px solid #334155", background: "#0f172a", color: "#f8fafc", fontSize: 22, fontWeight: 700, outline: "none", fontFamily: "inherit" }} />
            </div>
            <select value={fiatCurrency} onChange={e => setFiatCurrency(e.target.value)} style={{ padding: "14px 12px", borderRadius: 10, border: "1.5px solid #334155", background: "#0f172a", color: "#f8fafc", fontSize: 14, fontWeight: 600, outline: "none", cursor: "pointer", fontFamily: "inherit" }}>
              {["USD", "EUR", "GBP", "KES", "TZS", "NGN", "CFA", "BRL", "INR"].map(c => (<option key={c} value={c}>{c}</option>))}
            </select>
          </div>
          {fiatAmount && baseSats > 0 && (
            <div style={{ marginTop: 6, fontSize: 12, color: "#64748b" }}>
              {"≈"} {baseSats.toLocaleString()} sats + {premiumPct}% premium = <span style={{ color: "#f59e0b", fontWeight: 700 }}>{totalSats.toLocaleString()} sats</span> locked
            </div>
          )}
        </div>

        <div style={{ marginBottom: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
            <label style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5 }}>Volunteer premium</label>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#10b981" }}>{premiumPct}%</span>
          </div>
          <input type="range" min="0" max="20" step="1" value={premiumPct} onChange={e => setPremiumPct(e.target.value)} style={{ width: "100%", accentColor: "#10b981", height: 6, WebkitAppearance: "none", appearance: "none", background: "linear-gradient(to right, #10b981 " + (parseFloat(premiumPct) / 20 * 100) + "%, #1e293b " + (parseFloat(premiumPct) / 20 * 100) + "%)", borderRadius: 3, outline: "none" }} />
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#475569" }}>
            <span>0% (no bonus)</span><span>20% (generous)</span>
          </div>
          {premiumSats > 0 && (
            <div style={{ fontSize: 11, color: "#10b981", marginTop: 4 }}>Volunteer earns {premiumSats.toLocaleString()} bonus sats for helping you</div>
          )}
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5, display: "block", marginBottom: 6 }}>How should you be paid?</label>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {PAYMENT_METHODS.map(pm => {
              const active = payMethods.includes(pm.key);
              return (
                <button key={pm.key} onClick={() => setPayMethods(prev => active ? prev.filter(k => k !== pm.key) : [...prev, pm.key])} style={{ padding: "5px 10px", borderRadius: 8, fontSize: 11, fontWeight: active ? 700 : 500, background: active ? "rgba(16,185,129,0.12)" : "#111827", color: active ? "#10b981" : "#94a3b8", border: active ? "1px solid rgba(16,185,129,0.3)" : "1px solid #1e293b", cursor: "pointer", display: "flex", alignItems: "center", gap: 3 }}>
                  {pm.icon} {pm.label}
                </button>
              );
            })}
          </div>
          {payMethods.length > 0 && <div style={{ fontSize: 10, color: "#10b981", marginTop: 4 }}>{payMethods.length} method{payMethods.length > 1 ? "s" : ""} selected</div>}
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5, display: "block", marginBottom: 6 }}>Note (optional)</label>
          <div style={{ fontSize: 10, color: "#475569", marginBottom: 6, lineHeight: 1.4 }}>Your payment details (phone number, $cashtag, etc.) will be shared privately via encrypted chat after a volunteer accepts.</div>
          <input placeholder="e.g., Need this by Friday, rent is due" value={note} onChange={e => setNote(e.target.value)} style={{ width: "100%", padding: "12px 14px", borderRadius: 10, border: "1.5px solid #334155", background: "#0f172a", color: "#f8fafc", fontSize: 13, outline: "none", fontFamily: "inherit" }} />
        </div>

        {fiatAmount && baseSats > 0 && (
          <div style={{ padding: "14px", borderRadius: 12, background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.15)", marginBottom: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#f59e0b", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>Summary</div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}><span style={{ fontSize: 13, color: "#94a3b8" }}>You receive</span><span style={{ fontSize: 15, fontWeight: 700, color: "#f8fafc" }}>{fiatCurrency} {parseFloat(fiatAmount).toFixed(2)}</span></div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}><span style={{ fontSize: 13, color: "#94a3b8" }}>You lock</span><span style={{ fontSize: 15, fontWeight: 700, color: "#f59e0b" }}>{"₿"} {totalSats.toLocaleString()} sats</span></div>
            <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ fontSize: 13, color: "#94a3b8" }}>Volunteer earns</span><span style={{ fontSize: 13, fontWeight: 600, color: "#10b981" }}>+{premiumSats.toLocaleString()} sats ({premiumPct}%)</span></div>
          </div>
        )}

        <button onClick={async () => {
            if (!billType) return showToast("Pick a bill type", "error");
            if (!fiatAmount || parseFloat(fiatAmount) <= 0) return showToast("Enter the fiat amount you need", "error");
            if (payMethods.length === 0) return showToast("Select at least one payment method", "error");
            const bt = BILL_TYPES.find(b => b.id === billType);
            const totalSats = totalSatsWithPremium();
            if (totalSats <= 0) return showToast("Could not calculate sats amount - check fiat rates", "error");
            if (totalSats > 2000000) return showToast("Exceeds 2,000,000 sats federation limit", "error");

            const billTitle = bt.icon + " " + bt.label + " bill - " + fiatCurrency + " " + parseFloat(fiatAmount).toFixed(2);
            const billTerms = "--- Bill Pay Details ---\nType: " + bt.label + "\nFiat needed: " + fiatCurrency + " " + parseFloat(fiatAmount).toFixed(2) + "\nCurrency: " + fiatCurrency + "\nRate: " + premiumPct + (note ? "\n\n" + note : "");

            setPosting(true);
            try {
              let sellerFedPrefix = null;
              const _isSandbox = !window.fediInternal || isDevMode();
              if (!_isSandbox && window.fediInternal && window.fediInternal.generateEcash) {
                try {
                  showToast("Detecting your federation...");
                  const probe = await window.fediInternal.generateEcash({ amount: 1 });
                  if (probe && probe.length > 10) {
                    sellerFedPrefix = probe.substring(0, 10);
                    try { await window.fediInternal.receiveEcash(probe); } catch {}
                  }
                } catch {}
              }
              if (!sellerFedPrefix && !_isSandbox) {
                showToast("Federation detection failed. Please approve the prompt to continue.", "error");
                setPosting(false);
                return;
              }

              const res = await mapi("/", {
                method: "POST",
                body: JSON.stringify({
                  title: billTitle,
                  description: note || undefined,
                  priceMsats: totalSats * 1000,
                  terms: billTerms,
                  category: "bill-pay",
                  condition: "service",
                  communityLink: undefined,
                  sellerFedPrefix: sellerFedPrefix || undefined,
                  quantity: 1,
                  paymentMethods: payMethods.length > 0 ? payMethods : undefined,
                }),
              });
              if (res.error) throw new Error(res.error);
              showToast("Bill posted! Now lock your sats.");
              onOpen(res.id);
            } catch (err) { showToast(err.message, "error"); }
            setPosting(false);
          }} disabled={!billType || !fiatAmount || posting}
          style={{ width: "100%", padding: "16px 0", borderRadius: 12, background: (!billType || !fiatAmount) ? "#1e293b" : "linear-gradient(135deg, #f59e0b, #d97706)", color: (!billType || !fiatAmount) ? "#475569" : "#fff", fontSize: 16, fontWeight: 700, border: "none", cursor: "pointer", boxShadow: (billType && fiatAmount) ? "0 4px 24px rgba(245,158,11,0.3)" : "none", fontFamily: "inherit" }}>
          {posting ? "Posting..." : "🧾 Post My Bill"}
        </button>
      </div>
    );
  }

  // "I WANT TO BUY SATS" browse
  if (mode === "earn") {
    return (
      <div style={{ padding: "0 16px 80px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <button onClick={() => setMode(null)} style={{ background: "none", border: "none", color: "#94a3b8", fontSize: 18, cursor: "pointer", padding: 4 }}>{"←"}</button>
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 800, color: "#f8fafc", margin: 0 }}>{"₿"} Buy Sats</h2>
            <p style={{ fontSize: 11, color: "#64748b", margin: "2px 0 0" }}>Send fiat, earn sats at a premium</p>
          </div>
          <button onClick={onRefresh} style={{ marginLeft: "auto", background: "none", border: "none", color: "#64748b", fontSize: 16, cursor: "pointer" }}>{"↻"}</button>
        </div>

        {loading && (<div style={{ display: "flex", justifyContent: "center", padding: "40px 0" }}><div style={{ width: 20, height: 20, border: "2px solid #1e293b", borderTopColor: "#475569", borderRadius: "50%", animation: "spin 0.6s linear infinite" }} /></div>)}

        {!loading && billListings.length === 0 && (
          <div style={{ textAlign: "center", padding: "40px 16px" }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>{"🌟"}</div>
            <p style={{ fontSize: 15, fontWeight: 600, color: "#f8fafc", marginBottom: 6 }}>No bills posted yet</p>
            <p style={{ fontSize: 12, color: "#64748b", lineHeight: 1.5 }}>When someone needs fiat for a bill, it will show up here. Check back soon or post your own!</p>
          </div>
        )}

        {!loading && billListings.map((l, i) => {
          const sats = Math.floor((l.priceMsats || 0) / 1000);
          const termsCurrMatch = (l.terms || "").match(/Fiat needed:\s*(\w+)\s+([\d.]+)/);
          const fiatDisplay = termsCurrMatch ? termsCurrMatch[1] + " " + termsCurrMatch[2] : fmtFiatBP(l.priceMsats, "USD");
          const billIcon = BILL_TYPES.find(bt => (l.title || "").toLowerCase().includes(bt.id))?.icon || "🧾";
          const rateMatch = (l.terms || "").match(/Rate:\s*(\d+)/);
          const premium = rateMatch ? rateMatch[1] + "%" : null;

          return (
            <button key={l.id} onClick={() => onOpen(l.id)} style={{ width: "100%", padding: "14px", marginBottom: 8, borderRadius: 12, background: "#111827", border: "1px solid #1e293b", cursor: "pointer", textAlign: "left", animation: "slideUp 0.3s ease " + (i * 0.05) + "s both" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ width: 44, height: 44, borderRadius: 10, background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.15)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>{billIcon}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "#f8fafc", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{l.title}</div>
                  <div style={{ fontSize: 11, color: "#64748b", marginTop: 2, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    {premium && <span style={{ color: "#10b981", fontWeight: 600 }}>+{premium}</span>}
                    {(l.paymentMethods || []).slice(0, 3).map(pm => { const m = PAYMENT_METHODS.find(p => p.key === pm); return m ? <span key={pm} style={{ padding: "1px 5px", borderRadius: 4, fontSize: 9, background: "rgba(16,185,129,0.08)", color: "#10b981", border: "1px solid rgba(16,185,129,0.15)" }}>{m.icon} {m.label}</span> : null; })}
                    {(l.paymentMethods || []).length > 3 && <span style={{ fontSize: 9, color: "#475569" }}>+{(l.paymentMethods || []).length - 3}</span>}
                  </div>
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  {fiatDisplay && <div style={{ fontSize: 18, fontWeight: 800, color: "#f8fafc" }}>{fiatDisplay}</div>}
                  <div style={{ fontSize: 10, color: "#f59e0b", fontWeight: 600 }}>{"₿"} {(() => {
                    if (!fiatRates || !fiatRates.btcUsd) return sats.toLocaleString();
                    const fm = (l.terms || "").match(/Fiat needed:\s*(\w+)\s+([\d.]+)/);
                    const rm = (l.terms || "").match(/Rate:\s*(\d+)/);
                    if (!fm) return sats.toLocaleString();
                    const fx = fiatRates.rates[fm[1]] || 1;
                    const usd = parseFloat(fm[2]) / fx;
                    const base = Math.floor((usd / fiatRates.btcUsd) * 100000000);
                    const prem = rm ? parseInt(rm[1]) : 0;
                    return Math.floor(base * (1 + prem / 100)).toLocaleString();
                  })()} sats</div>
                </div>

              </div>

            </button>
          );
        })}

        {billListings.length > 0 && (<div style={{ textAlign: "center", padding: "12px 0", fontSize: 12, color: "#475569" }}>Tap a bill to send fiat and earn sats</div>)}
      </div>
    );
  }

  return null;
}


// ═══════════════════════════════════════════════════════════════════════
// ORDERS VIEW
// ═══════════════════════════════════════════════════════════════════════

function OrdersView({ orders, loading, pubkey, onBack, onRefresh, onOpenOrder, onProfile, fiatRates, initialFilter, onFilterConsumed, subdomain }) {
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

// ═══════════════════════════════════════════════════════════════════════
// ORDER DETAIL VIEW
// ═══════════════════════════════════════════════════════════════════════

// ── ChapSmart Integration View ──────────────────────────────────────────
// Bitcoin → M-Pesa remittance, airtime top-up, buy sats

function ChapSmartView({ onBack, showToast, pubkey }) {
  const [tab, setTab] = useState("send"); // send | airtime | buy
  const [step, setStep] = useState(0); // 0=form, 1=quote, 2=pay, 3=done
  const [loading, setLoading] = useState(false);
  const [account, setAccount] = useState(() => { try { return localStorage.getItem("sm_chap_account") || ""; } catch { return ""; } });

  // Form state
  const [amountTZS, setAmountTZS] = useState("");
  const [phone, setPhone] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [quote, setQuote] = useState(null);
  const [invoice, setInvoice] = useState(null);
  const [result, setResult] = useState(null);
  const [polling, setPolling] = useState(false);
  const [mpesaId, setMpesaId] = useState("");
  const pollRef = useRef(null);

  // Authenticate with ChapSmart via Nostr (auto signup/login)
  const ensureAccount = async () => {
    if (account) return account;
    // Try Nostr auth first
    if (window.nostr) {
      try {
        const pubkey = await window.nostr.getPublicKey();
        // Build NIP-98 event for login
        const event = {
          kind: 27235,
          created_at: Math.floor(Date.now() / 1000),
          tags: [["u", location.origin + "/api/chapsmart/nostr/login"], ["method", "POST"]],
          content: "",
        };
        const signedEvent = await window.nostr.signEvent(event);
        // Try login first
        const loginRes = await fetch("/api/chapsmart/nostr/login", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ signedEvent }),
        });
        const loginData = await loginRes.json();
        if (loginData.success && loginData.accountNumber) {
          setAccount(loginData.accountNumber);
          try { localStorage.setItem("sm_chap_account", loginData.accountNumber); } catch {}
          return loginData.accountNumber;
        }
        // If 404 (no account), signup
        if (loginRes.status === 404) {
          const signupEvent = {
            kind: 27235,
            created_at: Math.floor(Date.now() / 1000),
            tags: [["u", location.origin + "/api/chapsmart/nostr/signup"], ["method", "POST"]],
            content: "",
          };
          const signedSignup = await window.nostr.signEvent(signupEvent);
          const signupRes = await fetch("/api/chapsmart/nostr/signup", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ signedEvent: signedSignup }),
          });
          const signupData = await signupRes.json();
          if (signupData.success && signupData.accountNumber) {
            setAccount(signupData.accountNumber);
            try { localStorage.setItem("sm_chap_account", signupData.accountNumber); } catch {}
            return signupData.accountNumber;
          }
        }
      } catch (err) { console.warn("[chapsmart] Nostr auth failed, falling back:", err); }
    }
    // Fallback: anonymous account
    try {
      const res = await fetch("/api/chapsmart/create-account", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const data = await res.json();
      if (data.success && data.accountNumber) {
        setAccount(data.accountNumber);
        try { localStorage.setItem("sm_chap_account", data.accountNumber); } catch {}
        return data.accountNumber;
      }
    } catch {}
    showToast("Failed to create ChapSmart account", "error");
    return null;
  };

  const getQuote = async () => {
    if (!amountTZS || !phone) { showToast("Enter amount and phone number", "error"); return; }
    setLoading(true);
    const acct = await ensureAccount();
    if (!acct) { setLoading(false); return; }
    try {
      // Normalize phone: strip everything, ensure 0xxx format for Chapsmart
      let cleanPhone = phone.replace(/[^0-9]/g, "");
      // Strip country code variants
      if (cleanPhone.startsWith("255")) cleanPhone = "0" + cleanPhone.substring(3);
      if (cleanPhone.startsWith("0255")) cleanPhone = "0" + cleanPhone.substring(4);
      // Ensure starts with 0
      if (!cleanPhone.startsWith("0") && cleanPhone.length >= 9) cleanPhone = "0" + cleanPhone;
      // Validate: must be 10 digits starting with 0
      if (cleanPhone.length !== 10 || !cleanPhone.startsWith("0")) {
        showToast("Phone must be 10 digits starting with 0 (e.g. 0741000000)", "error");
        return;
      }

      const endpoint = tab === "airtime" ? "/api/chapsmart/airtime/quote" : "/api/chapsmart/quote";
      const body = tab === "airtime"
        ? { amountTZS, phoneNumber: cleanPhone, accountNumber: acct }
        : { amountTZS, phoneNumber: cleanPhone, recipientName: recipientName || "Recipient", accountNumber: acct };
      const res = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Quote failed");
      setQuote(data);
      setStep(1);
    } catch (err) { showToast(err.message, "error"); }
    setLoading(false);
  };

  const generateInvoice = async () => {
    setLoading(true);
    try {
      const endpoint = tab === "airtime" ? "/api/chapsmart/airtime/generate" : "/api/chapsmart/generate-invoice";
      const res = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ quoteId: quote.quoteId }) });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Invoice generation failed");
      setInvoice(data);
      setStep(2);
      // Start polling for payment status
      startPolling(data.invoiceId);
    } catch (err) { showToast(err.message, "error"); }
    setLoading(false);
  };

  const startPolling = (invoiceId) => {
    setPolling(true);
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch("/api/chapsmart/status/" + invoiceId);
        const data = await res.json();
        if (data.status === "completed" || data.status === "settled") {
          clearInterval(pollRef.current);
          setPolling(false);
          setResult({ amountTZS, phone, status: data.status });
          setStep(3);
          showToast(tab === "airtime" ? "Airtime delivered!" : "M-Pesa delivered!", "ok");
        } else if (data.status === "failed" || data.status === "expired") {
          clearInterval(pollRef.current);
          setPolling(false);
          showToast("Transaction " + data.status + ". " + (data.message || ""), "error");
        }
      } catch {}
    }, 5000);
  };

  useEffect(() => { return () => { if (pollRef.current) clearInterval(pollRef.current); }; }, []);

  const payWithWallet = async () => {
    if (!window.webln) { showToast("No Lightning wallet detected", "error"); return; }
    try {
      await window.webln.enable();
      await window.webln.sendPayment(invoice.bolt11);
      showToast("Payment sent! Waiting for delivery...");
      // Ensure polling is running after wallet payment
      if (!polling && invoice.invoiceId) startPolling(invoice.invoiceId);
    } catch (err) { showToast("Payment failed: " + (err.message || ""), "error"); }
  };

  const copyBolt11 = () => {
    navigator.clipboard.writeText(invoice.bolt11).then(
      () => showToast("Invoice copied!"),
      () => showToast("Copy failed", "error")
    );
  };

  const reset = () => { setStep(0); setQuote(null); setInvoice(null); setResult(null); setAmountTZS(""); setPhone(""); setRecipientName(""); };

  // Tab button style
  const tabStyle = (active) => ({
    flex: 1, padding: "10px 0", borderRadius: 10, border: "none", fontSize: 12, fontWeight: 700, cursor: "pointer",
    background: active ? "rgba(59,130,246,0.15)" : "transparent",
    color: active ? "#3b82f6" : "#64748b",
  });

  return (
    <div style={M.container}>
      {/* Header */}
      <div style={M.viewHeader}>
        <button style={M.iconBtn} onClick={onBack}><Icons.Back /></button>
        <h2 style={{ ...M.viewTitle, fontSize: 16 }}>
          <span style={{ color: "#3b82f6" }}>Chap</span><span style={{ color: "#f59e0b" }}>Smart</span>
        </h2>
        <span style={{ fontSize: 10, color: "#64748b", padding: "3px 8px", borderRadius: 99, border: "1px solid #1e293b" }}>TZ</span>
      </div>

      {/* Tabs */}
      {step === 0 && (
        <div style={{ display: "flex", gap: 4, marginBottom: 14, background: "#111827", borderRadius: 12, padding: 4 }}>
          <button style={tabStyle(tab === "send")} onClick={() => setTab("send")}>💸 Send TZS</button>
          <button style={tabStyle(tab === "airtime")} onClick={() => setTab("airtime")}>📱 Airtime</button>
          <button style={tabStyle(tab === "buy")} onClick={() => setTab("buy")}>₿ Buy Sats</button>
        </div>
      )}

      {/* Step 0: Form */}
      {step === 0 && (tab === "send" || tab === "airtime") && (
        <div style={{ ...M.card, padding: 16 }}>
          <div style={{ fontSize: 11, color: "#3b82f6", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 }}>
            {tab === "send" ? "Send Bitcoin → Receive M-Pesa" : "Buy Airtime with Bitcoin"}
          </div>

          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>Amount (TZS)</div>
            <input style={{ ...M.input, fontSize: 18, fontWeight: 700 }} type="number" value={amountTZS} onChange={e => setAmountTZS(e.target.value)}
              placeholder={tab === "send" ? "2,500 — 1,000,000" : "500 — 15,000"} />
          </div>

          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>{tab === "send" ? "Vodacom M-Pesa Number" : "Phone Number"}</div>
            <input style={M.input} value={phone} onChange={e => setPhone(e.target.value)} placeholder="07XXXXXXXX" />
          </div>

          {tab === "send" && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>Recipient Name</div>
              <input style={M.input} value={recipientName} onChange={e => setRecipientName(e.target.value)} placeholder="John Doe" />
            </div>
          )}

          <div style={{ padding: "8px 12px", borderRadius: 8, background: "rgba(59,130,246,0.08)", border: "1px solid rgba(59,130,246,0.15)", marginBottom: 14, fontSize: 11, color: "#94a3b8" }}>
            ⚡ Powered by ChapSmart × SatoshiMarket — Lightning fast, ~10s settlement
          </div>

          <button onClick={getQuote} disabled={loading || !amountTZS || !phone}
            style={{ ...M.actionBtn, background: "linear-gradient(135deg, #3b82f6, #2563eb)", color: "#fff", opacity: loading ? 0.6 : 1 }}>
            {loading ? "Getting quote..." : "⚡ Get Quote"}
          </button>
        </div>
      )}

      {/* Step 0: Buy Sats form */}
      {step === 0 && tab === "buy" && (
        <div style={{ ...M.card, padding: 16 }}>
          <div style={{ textAlign: "center", marginBottom: 16 }}>
            <div style={{ fontSize: 28, marginBottom: 4 }}>₿</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#f59e0b" }}>Buy Sats with M-Pesa</div>
            <div style={{ fontSize: 11, color: "#64748b" }}>Send TZS via M-Pesa, receive sats to your wallet</div>
          </div>
          <div style={{ marginBottom: 10 }}>
            <label style={{ fontSize: 11, color: "#94a3b8", fontWeight: 600 }}>Amount (TZS)</label>
            <input style={M.input} type="number" value={amountTZS} onChange={e => setAmountTZS(e.target.value)} placeholder="1,000 — 20,000" />
          </div>
          <button onClick={async () => {
            if (!amountTZS || parseInt(amountTZS) < 1000) { showToast("Minimum 1,000 TZS", "error"); return; }
            setLoading(true);
            try {
              const acct = account || await ensureAccount();
              const res = await fetch("/api/chapsmart/buy-sats/quote", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ amountTZS: parseInt(amountTZS), accountNumber: acct }),
              });
              const data = await res.json();
              if (data.success === false) { showToast(data.error || "Quote failed", "error"); setLoading(false); return; }
              setInvoice({ ...data, type: "buy" });
              setStep(1);
            } catch (err) { showToast("Failed to get quote", "error"); }
            setLoading(false);
          }} style={{ width: "100%", padding: "12px 0", borderRadius: 10, border: "none", cursor: "pointer", background: "linear-gradient(135deg, #f59e0b, #d97706)", color: "#0c0f17", fontSize: 14, fontWeight: 700 }} disabled={loading}>
            {loading ? "Getting quote..." : "Get Quote"}
          </button>
        </div>
      )}

      {/* Step 1: Buy Sats — show quote + M-Pesa payment */}
      {step === 1 && tab === "buy" && invoice?.type === "buy" && (
        <div style={{ ...M.card, padding: 16, textAlign: "center" }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>₿</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#f8fafc", marginBottom: 4 }}>
            You will receive: <span style={{ color: "#f59e0b" }}>{invoice.calculatedSats || invoice.amountSats || invoice.satsAmount || "?"} sats</span>
          </div>
          <div style={{ fontSize: 13, color: "#64748b", marginBottom: 16 }}>
            for {parseInt(amountTZS).toLocaleString()} TZS via M-Pesa
          </div>

          <div style={{ background: "#0f1629", borderRadius: 10, padding: 14, marginBottom: 14, textAlign: "left" }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#f59e0b", marginBottom: 6 }}>How it works:</div>
            <div style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.6 }}>
              1. Send <strong style={{ color: "#f8fafc" }}>{parseInt(amountTZS).toLocaleString()} TZS</strong> via M-Pesa<br/>
              2. Enter your M-Pesa transaction ID below<br/>
              3. Sats sent to your Fedi wallet instantly
            </div>
            <div style={{ marginTop: 10, padding: "10px 12px", borderRadius: 8, background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.15)" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#f59e0b", marginBottom: 6 }}>KUTOA M-Pesa:</div>
              <div style={{ fontSize: 11, color: "#cbd5e1", lineHeight: 1.8, fontFamily: "monospace" }}>
                1. Piga <strong style={{ color: "#f8fafc" }}>*150*00#</strong><br/>
                2. Chagua <strong>2</strong> – Kutoa Pesa<br/>
                3. Namba ya wakala: <strong style={{ color: "#f8fafc" }}>1228685</strong><br/>
                4. Kiasi: <strong style={{ color: "#f59e0b" }}>{parseInt(amountTZS).toLocaleString()} TZS</strong><br/>
                5. Jina: <strong style={{ color: "#f8fafc" }}>BRIAN</strong><br/>
                6. Weka PIN yako na uthibitishe
              </div>
            </div>
          </div>

          {invoice.mpesaNumber && (
            <div style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.2)", borderRadius: 10, padding: 12, marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: "#f59e0b", fontWeight: 600 }}>Send M-Pesa to:</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: "#f8fafc", marginTop: 4 }}>{invoice.mpesaNumber}</div>
            </div>
          )}

          <div style={{ marginBottom: 10, textAlign: "left" }}>
            <label style={{ fontSize: 11, color: "#94a3b8", fontWeight: 600 }}>M-Pesa Transaction ID</label>
            <input style={M.input} value={mpesaId || ""} onChange={e => setMpesaId(e.target.value)} placeholder="e.g. QK7B2XYZ99" />
          </div>

          <button onClick={async () => {
            if (!mpesaId || mpesaId.trim().length < 5) { showToast("Enter your M-Pesa transaction ID", "error"); return; }
            setLoading(true);
            try {
              let bolt11;
              if (window.webln) {
                await window.webln.enable();
                const inv = await window.webln.makeInvoice({ amount: invoice.calculatedSats || invoice.amountSats || invoice.satsAmount });
                bolt11 = inv.paymentRequest;
              } else {
                bolt11 = prompt("Paste a Lightning invoice for " + (invoice.calculatedSats || invoice.amountSats || invoice.satsAmount) + " sats:");
              }
              if (!bolt11) { setLoading(false); return; }
              const res = await fetch("/api/chapsmart/buy-sats/send", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ quoteId: invoice.quoteId || invoice.id, mpesaId: mpesaId.trim(), bolt11 }),
              });
              const data = await res.json();
              if (data.success === false) { showToast(data.error || "Failed", "error"); }
              else {
                setResult({ amountTZS, status: "completed", sats: invoice.calculatedSats || invoice.amountSats || invoice.satsAmount });
                setStep(3);
                showToast("Sats incoming! Check your wallet.", "ok");
              }
            } catch (err) { showToast("Failed: " + (err.message || ""), "error"); }
            setLoading(false);
          }} style={{ width: "100%", padding: "12px 0", borderRadius: 10, border: "none", cursor: "pointer", background: "linear-gradient(135deg, #f59e0b, #d97706)", color: "#0c0f17", fontSize: 14, fontWeight: 700 }} disabled={loading}>
            {loading ? "Processing..." : "⚡ Confirm & Receive Sats"}
          </button>

          <button onClick={() => { setStep(0); setInvoice(null); }} style={{ width: "100%", padding: 10, marginTop: 8, background: "transparent", border: "none", color: "#64748b", fontSize: 12, cursor: "pointer" }}>
            ← Back
          </button>
        </div>
      )}

      {/* Step 1: Quote */}
      {step === 1 && quote && (
        <div style={{ ...M.card, padding: 16 }}>
          <div style={{ textAlign: "center", marginBottom: 14 }}>
            <div style={{ fontSize: 11, color: "#3b82f6", textTransform: "uppercase", letterSpacing: 1 }}>Quote Ready</div>
            <div style={{ fontSize: 28, fontWeight: 800, marginTop: 4 }}>
              <span style={{ color: "#f59e0b" }}>₿</span> {quote.youPay.sats.toLocaleString()}
              <span style={{ fontSize: 13, color: "#94a3b8" }}> sats</span>
            </div>
            <div style={{ fontSize: 13, color: "#94a3b8", marginTop: 4 }}>
              → <span style={{ color: "#10b981", fontWeight: 700 }}>{Number(amountTZS).toLocaleString()} TZS</span> to {phone}
            </div>
          </div>

          <div style={{ height: 1, background: "#1e293b", margin: "12px 0" }} />

          <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 13 }}>
            <span style={{ color: "#64748b" }}>Fee ({quote.youPay.feePercent}%)</span>
            <span style={{ fontWeight: 600, color: "#f59e0b" }}>{quote.youPay.feeSats} sats</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 13 }}>
            <span style={{ color: "#64748b" }}>Tier</span>
            <span style={{ padding: "2px 8px", borderRadius: 99, fontSize: 10, fontWeight: 700, color: "#f59e0b", background: "rgba(245,158,11,0.12)" }}>{quote.userTier}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 13 }}>
            <span style={{ color: "#64748b" }}>Settlement</span>
            <span style={{ fontWeight: 600, color: "#10b981" }}>~10 seconds</span>
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
            <button onClick={() => { setStep(0); setQuote(null); }} style={{ ...M.secondaryBtn, flex: 1 }}>← Back</button>
            <button onClick={generateInvoice} disabled={loading}
              style={{ ...M.actionBtn, flex: 2, background: "linear-gradient(135deg, #3b82f6, #2563eb)", color: "#fff", opacity: loading ? 0.6 : 1 }}>
              {loading ? "Generating..." : "⚡ Pay with Lightning"}
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Pay Invoice */}
      {step === 2 && invoice && (
        <div style={{ ...M.card, padding: 16 }}>
          <div style={{ textAlign: "center", marginBottom: 14 }}>
            <div style={{ fontSize: 36, marginBottom: 6 }}>⚡</div>
            <div style={{ fontSize: 15, fontWeight: 700 }}>Pay Lightning Invoice</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: "#f59e0b", marginTop: 4 }}>
              {invoice.youPay.sats.toLocaleString()} sats
            </div>
          </div>

          {/* Checkout link */}
          {invoice.checkoutLink && (
            <a href={invoice.checkoutLink} target="_blank" rel="noopener noreferrer"
              style={{ display: "block", textAlign: "center", padding: "12px", borderRadius: 10, background: "rgba(59,130,246,0.08)", border: "1px solid rgba(59,130,246,0.2)", color: "#3b82f6", fontSize: 13, fontWeight: 600, textDecoration: "none", marginBottom: 12 }}>
              🔗 Open BTCPay Checkout
            </a>
          )}

          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <button onClick={copyBolt11} style={{ ...M.secondaryBtn, flex: 1, fontSize: 12 }}>📋 Copy Invoice</button>
            {window.webln && (
              <button onClick={payWithWallet} style={{ ...M.actionBtn, flex: 1, background: "linear-gradient(135deg, #10b981, #059669)", color: "#fff", fontSize: 12 }}>
                ⚡ Pay with Wallet
              </button>
            )}
          </div>

          {/* BOLT11 display */}
          <div style={{ padding: 10, borderRadius: 8, background: "#0f1629", fontSize: 10, color: "#64748b", wordBreak: "break-all", marginBottom: 12 }}>
            {invoice.bolt11}
          </div>

          {polling && (
            <div style={{ textAlign: "center", color: "#3b82f6", fontSize: 12, animation: "pulse 1.5s infinite" }}>
              Waiting for payment confirmation...
            </div>
          )}
        </div>
      )}

      {/* Step 3: Done */}
      {step === 3 && result && (
        <div style={{ ...M.card, padding: 16, borderColor: "rgba(16,185,129,0.3)", background: "linear-gradient(135deg, rgba(16,185,129,0.05), rgba(16,185,129,0.02))" }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 48, marginBottom: 8 }}>✅</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: "#10b981" }}>
              {tab === "airtime" ? "Airtime Delivered!" : "M-Pesa Sent!"}
            </div>
            <div style={{ fontSize: 14, color: "#94a3b8", marginTop: 8 }}>
              {Number(amountTZS).toLocaleString()} TZS sent to {phone}
            </div>
          </div>

          <div style={{ textAlign: "center", marginTop: 16, fontSize: 11, color: "#64748b" }}>
            Powered by <span style={{ color: "#3b82f6", fontWeight: 700 }}>ChapSmart</span> × <span style={{ color: "#f59e0b", fontWeight: 700 }}>SatoshiMarket</span>
          </div>

          <button onClick={reset} style={{ ...M.secondaryBtn, width: "100%", marginTop: 14 }}>← New Transaction</button>
        </div>
      )}
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════════
// ARBITER RECRUITMENT VIEW
// ═══════════════════════════════════════════════════════════════════════
function ArbiterRecruitmentView({ pubkey, onBack, showToast }) {
  const [fediProfile, setFediProfile] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [motivation, setMotivation] = useState("");
  const [communityRoom, setCommunityRoom] = useState("");
  const [fedPrefix, setFedPrefix] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [myStatus, setMyStatus] = useState(null);
  const [arbiters, setArbiters] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [statusRes, listRes] = await Promise.all([
          mapi("/arbiters/my-status"),
          mapi("/arbiters"),
        ]);
        if (statusRes && !statusRes.error) setMyStatus(statusRes);
        if (listRes && !listRes.error) setArbiters(listRes.arbiters || []);
      } catch {}
      setLoading(false);
    })();
  }, []);

  const handleApply = async () => {
    if (!displayName.trim()) return showToast("Enter your display name", "error");
    if (!communityRoom.trim() || !communityRoom.includes("fedi:community")) return showToast("Paste your Fedi community room link", "error");
    setSubmitting(true);
    try {
      const res = await mapi("/arbiters/apply", {
        method: "POST",
        body: JSON.stringify({ fediProfile, displayName, motivation, communityRoom, fedEcashPrefix: fedPrefix }),
      });
      if (res.error) throw new Error(res.error);
      showToast(res.message || "Application submitted!");
      setMyStatus({ status: res.status, communityRoom, displayName });
    } catch (err) { showToast(err.message, "error"); }
    setSubmitting(false);
  };

  const detectedFed = fediProfile.match(/:([a-zA-Z0-9._-]+\.[a-zA-Z]{2,})$/)?.[1] || fediProfile.match(/([a-zA-Z0-9._-]+\.[a-zA-Z]{2,})/)?.[1] || null;

  return (
    <div style={M.container}>
      <div style={M.viewHeader}>
        <button style={M.iconBtn} onClick={onBack}><Icons.Back /></button>
        <h2 style={M.viewTitle}>{"⚖️"} Become an Arbiter</h2>
        <div style={{ width: 36 }} />
      </div>

      <div style={{ padding: "0 4px 20px" }}>
        {/* Hero */}
        <div style={{ textAlign: "center", padding: "20px 16px", marginBottom: 16, borderRadius: 16, background: "linear-gradient(145deg, rgba(139,92,246,0.1), rgba(139,92,246,0.03))", border: "1px solid rgba(139,92,246,0.2)" }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>{"⚖️"}</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: "#f8fafc", marginBottom: 6 }}>Community Arbiters</div>
          <div style={{ fontSize: 13, color: "#94a3b8", lineHeight: 1.6 }}>
            Arbiters are trusted community members who resolve disputes in escrow trades. They protect buyers and sellers by casting the deciding vote when parties disagree.
          </div>
        </div>

        {/* Benefits */}
        <div style={{ padding: "14px 16px", borderRadius: 12, background: "rgba(16,185,129,0.06)", border: "1px solid rgba(16,185,129,0.15)", marginBottom: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#10b981", marginBottom: 8 }}>Why become an arbiter?</div>
          <div style={{ fontSize: 12, color: "#cbd5e1", lineHeight: 1.8 }}>
            {"🏆 Earn 1% fee on every dispute you resolve"}<br/>
            {"🏛️ Represent your federation as a community leader"}<br/>
            {"🔒 Get priority access to federation governance (Level 2)"}<br/>
            {"⏱️ 4-hour voting window with automatic rotation"}<br/>
            {"⭐ Build your reputation and trust score"}
          </div>
        </div>

        {/* Current status */}
        {myStatus && myStatus.status === "approved" && (
          <div style={{ padding: "14px 16px", borderRadius: 12, background: "rgba(16,185,129,0.1)", border: "2px solid rgba(16,185,129,0.3)", marginBottom: 16, textAlign: "center" }}>
            <div style={{ fontSize: 24, marginBottom: 4 }}>{"✅"}</div>
            <div style={{ fontSize: 15, fontWeight: 800, color: "#10b981" }}>You are an approved arbiter!</div>
          </div>
        )}
        {myStatus && myStatus.status === "pending" && (
          <div style={{ padding: "14px 16px", borderRadius: 12, background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.25)", marginBottom: 16, textAlign: "center" }}>
            <div style={{ fontSize: 24, marginBottom: 4 }}>{"⏳"}</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#f59e0b" }}>Application pending review</div>
            <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 4 }}>A community leader will review your application soon.</div>
          </div>
        )}

        {/* Application form */}
        {(!myStatus || myStatus.status === "none" || myStatus.status === "rejected") && (
          <div style={{ padding: "16px", borderRadius: 14, background: "linear-gradient(145deg, #111827, #0f1320)", border: "1px solid #1e293b", marginBottom: 16 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#f8fafc", marginBottom: 12 }}>Apply to become an arbiter</div>

            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, color: "#94a3b8", fontWeight: 600, display: "block", marginBottom: 4 }}>Display Name *</label>
              <input style={M.input} placeholder="How the community knows you" value={displayName} onChange={e => setDisplayName(e.target.value)} />
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, color: "#10b981", fontWeight: 600, display: "block", marginBottom: 4 }}>{"🏛️"} Community Room Link *</label>
              <input style={M.input} placeholder="fedi:community210v3xz..." value={communityRoom} onChange={e => setCommunityRoom(e.target.value)} />
              <div style={{ fontSize: 10, color: "#475569", marginTop: 3 }}>Open your Fedi community chat {"→"} tap share/invite {"→"} paste the link</div>
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, color: "#64748b", fontWeight: 600, display: "block", marginBottom: 4 }}>Fedi Profile Link (optional)</label>
              <input style={M.input} placeholder="@npub1...:server.domain" value={fediProfile} onChange={e => setFediProfile(e.target.value)} />
              {detectedFed && (
                <div style={{ marginTop: 6, padding: "4px 10px", borderRadius: 6, background: "rgba(139,92,246,0.1)", border: "1px solid rgba(139,92,246,0.2)", display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <span style={{ fontSize: 11, color: "#a78bfa", fontWeight: 600 }}>{"🏛️"} Detected: {getFedName(null, detectedFed)}</span>
                </div>
              )}
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, color: "#94a3b8", fontWeight: 600, display: "block", marginBottom: 4 }}>Why do you want to be an arbiter?</label>
              <textarea style={{ ...M.input, minHeight: 60, resize: "vertical" }} placeholder="Tell us about yourself and your community involvement..." value={motivation} onChange={e => setMotivation(e.target.value)} />
            </div>

            <button onClick={handleApply} disabled={submitting} style={{ ...M.actionBtn, width: "100%", background: "linear-gradient(135deg, #7c3aed, #6d28d9)", boxShadow: "0 4px 24px rgba(124,58,237,0.3)", padding: "14px 0", fontSize: 15 }}>
              {submitting ? "Submitting..." : "⚖️ Submit Application"}
            </button>
          </div>
        )}

        {/* Active arbiters */}
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#f8fafc", marginBottom: 10 }}>Active Arbiters ({arbiters.length})</div>
          {loading ? (
            <div style={{ textAlign: "center", padding: 20, color: "#475569" }}>Loading...</div>
          ) : arbiters.length === 0 ? (
            <div style={{ textAlign: "center", padding: 20, color: "#475569", fontSize: 13 }}>No approved arbiters yet. Be the first!</div>
          ) : arbiters.map(a => (
            <div key={a.id} style={{ padding: "12px 14px", borderRadius: 10, background: "#111827", border: "1px solid #1e293b", marginBottom: 8, display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 36, height: 36, borderRadius: "50%", background: "rgba(139,92,246,0.15)", border: "2px solid rgba(139,92,246,0.3)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 800, color: "#a78bfa", flexShrink: 0 }}>
                {(a.displayName || "?")[0].toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#f8fafc" }}>{a.displayName}</div>
                <div style={{ fontSize: 10, color: "#64748b", marginTop: 1 }}>
                  {a.communityRoom ? "🏛️ Community linked" : a.federationDomain ? getFedName(null, a.federationDomain) : "Independent"} · Since {new Date(a.since).toLocaleDateString()}
                </div>
              </div>
              <div style={{ fontSize: 18 }}>{"⚖️"}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// FAQ VIEW
// ═══════════════════════════════════════════════════════════════════════
function FAQView({ onBack, subdomain }) {
  const [openIdx, setOpenIdx] = useState(null);

  const faqs = [
    { category: "Getting Started", icon: "🚀", items: [
      { q: "What is SatoshiMarket?", a: "SatoshiMarket is a Bitcoin-native peer-to-peer marketplace built on Fedimint and Nostr. You can buy and sell items, exchange sats for fiat, and even borrow or lend Bitcoin — all secured by escrow." },
      { q: "How does escrow work?", a: "When a trade starts, the seller (or buyer, depending on the trade type) locks their sats in a secure escrow. Both parties must agree the trade is complete before sats are released. If there's a disagreement, a community arbiter casts the deciding vote." },
      { q: "Do I need a Fedi account?", a: "Yes! SatoshiMarket runs as a Fedi Mini-App. You need the Fedi app with a federation wallet. Your identity is your Nostr keypair managed by Fedi — no emails, no passwords." },
      { q: "Is there a fee?", a: "A small 0.5% platform fee is taken from each completed trade. Disputed trades also incur a 1% arbiter fee. There are no listing fees." },
    ]},
    { category: "Buying", icon: "🛒", items: [
      { q: "How do I buy something?", a: "Browse listings, tap one you like, and press the buy button. Your sats will be locked in escrow. Once the seller ships the item (or completes the service), you confirm receipt and the sats are released to them." },
      { q: "What if I don't receive my item?", a: "If the seller doesn't deliver, vote 'Dispute' instead of confirming. An arbiter will review the case and can refund your sats." },
      { q: "What does 'Lock Payment' mean?", a: "Locking means your sats are moved from your Fedi wallet into a secure escrow. They can't be spent by anyone until the trade is resolved. Think of it as putting money in a safe that needs two keys to open." },
    ]},
    { category: "Selling", icon: "🏪", items: [
      { q: "How do I list an item?", a: "Tap 'Create Listing', fill in the details (title, price, description, terms), and submit. Your listing goes live immediately. You can pause or delete it anytime." },
      { q: "How do I get paid?", a: "After the buyer locks payment and you deliver the item, both of you vote to release. The sats are then transferred to your Fedi wallet automatically." },
      { q: "What is 'Federation Only'?", a: "Toggling this on makes your listing visible only to users in your same federation. Great for community-only trades or local services." },
    ]},
    { category: "P2P Trading", icon: "💱", items: [
      { q: "What is P2P sats-for-fiat?", a: "You can sell Bitcoin for fiat currency (like KES, USD, CFA) or buy Bitcoin with fiat. The sats are locked in escrow while the fiat payment happens externally (M-Pesa, bank transfer, cash, etc)." },
      { q: "What's a rate premium?", a: "Sellers can add a percentage premium to the exchange rate. For example, a 3% premium on 10,000 sats means the buyer pays 10,300 sats worth. This compensates the seller for liquidity." },
      { q: "How does bracket pricing work?", a: "Instead of a fixed price, sellers can set a range (e.g., 5,000 — 50,000 sats). Buyers choose how much they want to trade within that range." },
    ]},
    { category: "Lending", icon: "🤝", items: [
      { q: "How do loans work?", a: "A lender creates a loan offer with terms (amount, interest, repayment period). A borrower accepts it, and the lender locks sats in escrow. After both confirm, the borrower receives the sats. A repayment escrow is automatically created." },
      { q: "What are Lending Levels?", a: "Your lending level determines the maximum loan you can borrow. Level 1 (Newcomer): up to 5,000 sats. Level 2 (Member): 25,000. Level 3 (Trusted): 100,000. Level 4 (Senior): 500,000. Level 5 (Elder): 2,000,000. You level up by repaying loans on time." },
      { q: "What happens if I don't repay?", a: "Your trust score drops, reducing your lending level. Future loans will be limited or unavailable. The lender can open a dispute, and overdue loans are flagged on your profile." },
      { q: "How is interest calculated?", a: "Interest is set by the lender as a percentage (e.g., 5%). It's calculated on the principal and added to the repayment amount. For a 5,000 sat loan at 5%, you repay 5,250 sats." },
    ]},
    { category: "Safety & Disputes", icon: "🛡️", items: [
      { q: "What if the other party cheats?", a: "Vote 'Dispute' in the escrow. A community arbiter — a trusted federation member — will review the evidence and cast the deciding vote. The arbiter has 4 hours to respond." },
      { q: "Can the platform steal my sats?", a: "No. Sats are locked as Fedimint e-cash in escrow. The platform cannot move funds unilaterally — it requires 2-of-3 agreement (buyer, seller, arbiter). We are building toward cryptographically enforced non-custodial escrow using Shamir Secret Sharing." },
      { q: "Who are the arbiters?", a: "Arbiters are trusted community members who applied and were approved. They earn a 1% fee for resolving disputes. You can apply to become one from the Arbiters page." },
    ]},
    { category: "Federations", icon: "🏛️", items: [
      { q: "What is a federation?", a: "A federation is a group of people who share a Fedimint wallet. Think of it as a community bank, but run by the community itself. Each federation has its own guardians and rules." },
      { q: "Why does my federation matter?", a: "Trades require both parties to be on the same federation. This is because the escrow locks e-cash that is specific to your federation. It also enables community governance — federation-only listings, local arbiters, and lending within your community." },
      { q: "How do I join a federation?", a: "Open Fedi, go to your home screen, and join a federation using an invite code. Currently supported federations include Bitcoin Life, Global Bitcoin Federation, Afribit Kibera, and Bitsacco." },
    ]},
  ];

  let globalIdx = 0;
  return (
    <div style={M.container}>
      <div style={M.viewHeader}>
        <button style={M.iconBtn} onClick={onBack}><Icons.Back /></button>
        <h2 style={M.viewTitle}>❓ FAQ</h2>
        <div style={{ width: 36 }} />
      </div>

      <div style={{ padding: "0 4px 20px" }}>
        <div style={{ textAlign: "center", marginBottom: 16 }}>
          <div style={{ fontSize: 13, color: "#94a3b8" }}>Everything you need to know about trading on SatoshiMarket</div>
        </div>

        {faqs.map((cat, ci) => (
          <div key={ci} style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
              <span style={{ fontSize: 16 }}>{cat.icon}</span>
              <span style={{ fontSize: 14, fontWeight: 700, color: "#f8fafc" }}>{cat.category}</span>
            </div>
            {cat.items.map((item, ii) => {
              const idx = globalIdx++;
              const isOpen = openIdx === idx;
              return (
                <button key={ii} onClick={() => setOpenIdx(isOpen ? null : idx)} style={{ width: "100%", textAlign: "left", padding: "12px 14px", marginBottom: 4, borderRadius: 10, background: isOpen ? "rgba(139,92,246,0.06)" : "#111827", border: isOpen ? "1px solid rgba(139,92,246,0.2)" : "1px solid #1e293b", cursor: "pointer", transition: "all 0.2s" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: isOpen ? "#a78bfa" : "#e2e8f0", flex: 1 }}>{item.q}</span>
                    <span style={{ fontSize: 14, color: "#475569", transform: isOpen ? "rotate(180deg)" : "none", transition: "transform 0.2s", flexShrink: 0, marginLeft: 8 }}>▼</span>
                  </div>
                  {isOpen && (
                    <div style={{ marginTop: 8, fontSize: 12, color: "#94a3b8", lineHeight: 1.7, borderTop: "1px solid #1e293b30", paddingTop: 8 }}>
                      {item.a}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function OrderDetailView({ order: o, pubkey, onBack, onProfile, onSwitchToEscrow, showToast, loading, setLoading, fiatRates, subdomain }) {
  const [detail, setDetail] = useState(null);
  const [rateScore, setRateScore] = useState(0);
  const [rateComment, setRateComment] = useState("");
  const [rated, setRated] = useState(false);
  const isBuyer = o.buyerPubkey === pubkey;
  const canCancel = isBuyer && (o.status === "pending");

  const loadOrderDetail = async () => {
    try {
      const data = await mapi(`/orders/${o.id}`);
      if (!data.error) {
        setDetail(data);
        if (data.order?.myRating != null) setRated(true);
        const repId = data.escrow?.loanRepaymentId;
        if (repId) {
          try {
            const repData = await fetch("/api/ecash-escrows/" + repId, {
              headers: window.__smToken ? { "Authorization": "Bearer " + window.__smToken } : {},
            }).then(r => r.json());
            if (repData && !repData.error) setRepaymentEscrow({ ...repData, repaymentEscrowId: repId, repaymentStatus: repData.status, repaymentSats: repData.amountSats || Math.floor((repData.amountMsats || 0) / 1000), dueAt: repData.loanDueAt, interestMsats: Math.floor((repData.amountMsats || 0) * (repData.loanInterestBps || 0) / 10000) });
          } catch {}
        }
      }
    } catch {}
  };
  useEffect(() => {
    loadOrderDetail();
    // Poll for lending orders to pick up auto-created repayment
    const isLoanOrder = subdomain === "lending" || (o.listingTitle || "").toLowerCase().includes("lend");
    if (isLoanOrder) {
      const iv = setInterval(loadOrderDetail, 10000);
      return () => clearInterval(iv);
    }
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

  const handleCreateRepayment = async () => {
    setRepaymentCreating(true);
    try {
      const res = await mapi(`/${o.id}/create-repayment`, { method: "POST" });
      if (res.error) throw new Error(res.error);
      setRepaymentEscrow(res);
      showToast("Repayment escrow created! Borrower must lock " + res.repaymentSats + " sats by " + new Date(res.dueAt).toLocaleDateString());
    } catch (err) { showToast(err.message, "error"); }
    setRepaymentCreating(false);
  };

  const escrow = detail?.escrow;
  const status = detail?.order?.status || o.status;
  // Only show rating prompt AFTER detail loads AND confirms no rating exists
  const detailLoaded = detail != null;
  const otherPubkey = isBuyer ? o.sellerPubkey : o.buyerPubkey;
  const isP2P = detail?.tradeType === "sats-for-fiat" || isSatsForFiat(detail?.listing?.category);
  const isLoan = detail?.tradeType === "lending" || isLending(detail?.listing?.category) || (escrow?.description || "").startsWith("Lending:") || (escrow?.description || "").startsWith("Loan Repayment");
  const isRepayment = (escrow?.description || "").startsWith("Loan Repayment") || (detail?.listing?.category === "lending" && escrow?.loanParentId);
  const needsRating = detailLoaded && status === "completed" && !rated && (!isLoan || isRepayment);
  const isLender = isLoan && o.sellerPubkey === pubkey;
  const isBorrower = isLoan && o.buyerPubkey === pubkey;
  const otherRole = isLoan ? (isBuyer ? "Lender" : "Borrower") : isBuyer ? t("seller") : t("buyer");
  const loanRepaymentId = escrow?.loanRepaymentId || null;
  const loanStatus = escrow?.loanStatus || null;
  const loanDueAt = escrow?.loanDueAt || null;
  const [repaymentCreating, setRepaymentCreating] = useState(false);
  const [repaymentEscrow, setRepaymentEscrow] = useState(null);
  const myExistingRating = detail?.order?.myRating;

  return (
    <div style={M.container}>
      <div style={M.viewHeader}>
        <button style={M.iconBtn} onClick={onBack}><Icons.Back /></button>
        <h2 style={M.viewTitle}>{o.listingTitle || detail?.listing?.title || t("mkOrder")}</h2>
        <div style={{ width: 36 }} />
      </div>

      <div style={{ paddingBottom: 20 }}>
        {/* ── Price + fiat ── */}
        <div style={{ textAlign: "center", marginBottom: 20, opacity: detail ? 1 : 0.5, transition: "opacity 0.3s" }}>
          <div style={{ fontSize: 36, fontWeight: 900, color: "#f8fafc", letterSpacing: -1 }}>
            <span style={{ color: "#f7931a", fontWeight: 800, fontSize: 34 }}>₿</span>{fmtSats(o.amountMsats)}
          </div>
          {detail?.listing?.shippingCostSats > 0 && (
            <div style={{ marginTop: 8, padding: "10px 14px", borderRadius: 10, background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.12)", maxWidth: 260, margin: "8px auto 0" }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#94a3b8", marginBottom: 4 }}>
                <span>Item price</span>
                <span>₿ {(Math.floor(o.amountMsats / 1000) - detail.listing.shippingCostSats).toLocaleString()} sats</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#3b82f6", marginBottom: 4 }}>
                <span>📦 Shipping</span>
                <span>+ ₿ {detail.listing.shippingCostSats.toLocaleString()} sats</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 700, color: "#f8fafc", borderTop: "1px solid rgba(245,158,11,0.15)", paddingTop: 6, marginTop: 4 }}>
                <span>Total</span>
                <span>₿ {fmtSats(o.amountMsats)} sats</span>
              </div>
            </div>
          )}
          {fiatRates && <div style={{ fontSize: 13, color: "#64748b", marginTop: 2 }}>≈ {fmtFiat(o.amountMsats, fiatRates, "USD")}</div>}
        </div>
        {/* ── Federation — shown high for picker visibility ── */}
        {(detail?.listing?.sellerFedDomain || escrow?.federationId) && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "8px 14px", marginBottom: 16, borderRadius: 10, background: "rgba(139,92,246,0.08)", border: "1px solid rgba(139,92,246,0.2)" }}>
            <span style={{ fontSize: 14 }}>🏛️</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#a78bfa" }}>{getFedName(detail?.listing?.sellerFedPrefix || escrow?.seller_fed_prefix, detail?.listing?.sellerFedDomain || escrow?.federationId)}</span>
            <span style={{ fontSize: 10, color: "#64748b", marginLeft: 4 }}>Federation</span>
          </div>
        )}

        {/* ── Participants ── */}
        <div style={{ display: "flex", justifyContent: "space-around", marginBottom: 20, padding: "14px 0", borderRadius: 12, background: "rgba(15,23,42,0.5)", border: "1px solid #1e293b" }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 22, marginBottom: 4 }}>🏠</div>
            <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5 }}>{t("seller")}</div>
            <div onClick={() => onProfile(o.sellerPubkey)} style={{ cursor: "pointer" }}><SellerName pubkey={o.sellerPubkey} /></div>
            {o.sellerPubkey === pubkey && <span style={{ fontSize: 9, color: "#f59e0b", fontWeight: 700, background: "rgba(245,158,11,0.12)", padding: "1px 6px", borderRadius: 4, marginTop: 2, display: "inline-block" }}>YOU</span>}
          </div>
          <div style={{ width: 1, background: "#1e293b" }} />
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 22, marginBottom: 4 }}>🛒</div>
            <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5 }}>{t("buyer")}</div>
            <div onClick={() => onProfile(o.buyerPubkey)} style={{ cursor: "pointer" }}><SellerName pubkey={o.buyerPubkey} /></div>
            {o.buyerPubkey === pubkey && <span style={{ fontSize: 9, color: "#8b5cf6", fontWeight: 700, background: "rgba(139,92,246,0.12)", padding: "1px 6px", borderRadius: 4, marginTop: 2, display: "inline-block" }}>YOU</span>}
          </div>
          {o.arbiterPubkey && (
            <>
              <div style={{ width: 1, background: "#1e293b" }} />
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 22, marginBottom: 4 }}>⚖️</div>
                <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5 }}>{t("arbiter")}</div>
                <div style={{ fontFamily: "monospace", fontSize: 10, color: "#475569" }}>{truncPk(o.arbiterPubkey)}</div>
              </div>
            </>
          )}
        </div>

        {/* ── Trade info (description + terms) ── */}
        {(detail?.listing?.description || detail?.listing?.terms || escrow?.terms) && (
          <div style={{ marginBottom: 16, padding: "12px 16px", borderRadius: 12, background: "rgba(245,158,11,0.04)", border: "1px solid rgba(245,158,11,0.12)" }}>
            {(detail?.listing?.description || escrow?.description) && (
              <div style={{ marginBottom: detail?.listing?.terms || escrow?.terms ? 20 : 0 }}>
                <div style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4, textAlign: "center" }}>Description</div>
                <div style={{ fontSize: 13, color: "#cbd5e1", lineHeight: 1.8, textAlign: "center", whiteSpace: "pre-line" }}>{detail?.listing?.description || escrow?.description}</div>
              </div>
            )}
            {(detail?.listing?.terms || escrow?.terms) && (
              <div>
                <div style={{ fontSize: 11, color: "#f59e0b", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8, display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>ⓘ Trade Terms</div>
                {(() => {
                  const raw = detail?.listing?.terms || escrow?.terms || "";
                  const parts = raw.split(/---\s*(P2P Details|Loan Terms|Bill Pay Details)\s*---/);
                  const userTerms = (parts[0] || "").trim();
                  const metaBlock = parts.length > 2 ? parts[2] : "";
                  const metaLines = metaBlock.split("\n").map(l => l.trim()).filter(Boolean);
                  const meta = {};
                  metaLines.forEach(line => { const [k, ...v] = line.split(":"); if (k && v.length) meta[k.trim()] = v.join(":").trim(); });
                  return <>
                    {Object.keys(meta).length > 0 && (
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center", marginBottom: userTerms ? 10 : 0 }}>
                        {Object.entries(meta).map(([k, v]) => (
                          <div key={k} style={{ padding: "5px 12px", borderRadius: 8, background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.2)", fontSize: 12 }}>
                            <span style={{ color: "#94a3b8" }}>{k}: </span>
                            <span style={{ color: "#f8fafc", fontWeight: 600 }}>{(k === "Interest" || k === "Rate") && v && !String(v).includes("%") ? v + "%" : v}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {userTerms && <div style={{ fontSize: 13, color: "#cbd5e1", lineHeight: 1.8, textAlign: "center", whiteSpace: "pre-line" }}>{userTerms}</div>}
                  </>;
                })()}
              </div>
            )}
          </div>
        )}


        {/* ── Accepted Payment Methods ── */}
        {detail?.listing?.paymentMethods && detail.listing.paymentMethods.length > 0 && (
          <div style={{ marginBottom: 16, padding: "10px 14px", borderRadius: 12, background: "rgba(16,185,129,0.04)", border: "1px solid rgba(16,185,129,0.12)" }}>
            <div style={{ fontSize: 10, color: "#10b981", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8, textAlign: "center" }}>{t("mkAcceptedPayment") || "Accepted Payment Methods"}</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "center" }}>
              {detail.listing.paymentMethods.map(pm => { const m = PAYMENT_METHODS.find(p => p.key === pm); return m ? <span key={pm} style={{ padding: "4px 10px", borderRadius: 8, fontSize: 11, fontWeight: 600, background: "rgba(16,185,129,0.1)", color: "#10b981", border: "1px solid rgba(16,185,129,0.2)" }}>{m.icon} {m.label}</span> : null; })}
            </div>
          </div>
        )}
        {/* ── ONE action button ── */}
        {onSwitchToEscrow && (status === "pending" || status === "active") && (o.escrowId || escrow?.id) && (
          <button
            onClick={() => onSwitchToEscrow(escrow?.id || o.escrowId)}
            style={{
              ...M.actionBtn,
              background: o.listingCategory === "bill-pay" ? "linear-gradient(135deg, #f59e0b, #d97706)" : status === "active"
                ? "linear-gradient(135deg, #f59e0b, #d97706)"
                : "linear-gradient(135deg, #7c3aed, #6d28d9)",
              boxShadow: o.listingCategory === "bill-pay" ? "0 4px 24px rgba(245,158,11,0.3)" : status === "active"
                ? "0 4px 24px rgba(245,158,11,0.3)"
                : "0 4px 24px rgba(124,58,237,0.3)",
              marginBottom: 8, fontSize: 16, padding: "16px 20px",
            }}
          >
            {status === "pending"
              ? (isP2P
                  ? (isBuyer ? (isRepayment ? "💰 Lock Repayment" : isLoan ? "✓ Accept Loan" : (fiatRates ? "💵 " + (t("mkPrepare") || "Prepare") + " " + fmtFiat(o.amountMsats, fiatRates, "USD") : t("mkViewTrade") || "View Trade")) : (isRepayment ? "🔍 View Repayment" : isLoan ? "🤝 Fund Loan" : "🔐 " + (t("mkLockEcash") || "Lock E-cash")))
: (isRepayment ? (isBuyer ? "💰 Lock Repayment" : "🔍 View Repayment") : isLoan ? (isBuyer ? "✓ Accept Loan" : "🤝 Fund Loan") : (o.listingCategory === "bill-pay" ? (isBuyer ? (fiatRates ? "💵 " + (t("mkPrepare") || "Prepare") + " " + (() => { const rm = (detail?.listing?.terms || "").match(/Rate:\s*(\d+)/); const rp = rm ? parseFloat(rm[1]) : 0; const base = rp > 0 ? Math.floor(o.amountMsats / (1 + rp / 100)) : o.amountMsats; return fmtFiat(base, fiatRates, "USD"); })() : "View Trade") : "🧾 " + (t("mkLockSats") || "Lock Sats")) : (isBuyer ? "🔐 " + (t("mkLockPayment") || "Lock Payment") : "View Trade"))))
              : isRepayment ? "💰 Open Repayment" : isLoan ? "🤝 Open Loan" : "⚡ Open Trade"
            }
          </button>
        )}

        {/* ── ONE status notification ── */}
        {status !== "completed" && status !== "cancelled" && status !== "expired" && (
          <div style={{ textAlign: "center", padding: "8px 0", fontSize: 12, color: "#64748b" }}>
            {status === "pending" && (
              isP2P
                ? (isBuyer ? "Waiting for seller to lock e-cash…" : ("🔐 Lock your e-cash to start the trade. Make sure you have ₿ " + fmtSats(o.amountMsats) + " sats in your federation wallet."))
                : (isRepayment ? (isBuyer ? "Lock your sats to repay the loan." : "Waiting for borrower to lock repayment sats…") : isLoan ? (isBuyer ? "Waiting for lender to fund the loan…" : "🤝 Lock your sats to fund this loan.") : (o.listingCategory === "bill-pay" ? (isBuyer ? "Waiting for bill poster to lock sats…" : "🧾 Lock your sats — a volunteer will pay your bill.") : (isBuyer ? "Lock your e-cash as payment." : "Waiting for buyer to lock payment…")))
            )}
            {status === "active" && "Trade in progress — open to vote and confirm."}
          </div>
        )}

        {/* ── Cancel (buyer only, before lock) ── */}
        {canCancel && (
          <button style={{ ...M.actionBtn, background: "linear-gradient(135deg, #dc2626, #b91c1c)", marginTop: 8, marginBottom: 80, fontSize: 13, padding: "10px 16px" }} onClick={handleCancel} disabled={loading}>
            {loading ? t("mkCancelling") : t("mkCancelOrder")}
          </button>
        )}

        {/* ── Completed ── */}
        {status === "completed" && !needsRating && !rated && !isLoan && (
          <div style={{ textAlign: "center", padding: "14px 0", color: "#10b981", fontSize: 14, fontWeight: 600 }}>
            ✓ Trade complete
          </div>
        )}

        {/* ── Lending: Loan Disbursed ── */}
        {isLoan && status === "completed" && !isRepayment && (
          <div style={{ borderRadius: 14, padding: "16px", marginBottom: 16, background: loanRepaymentId ? "linear-gradient(145deg, rgba(239,68,68,0.08), rgba(239,68,68,0.03))" : "linear-gradient(145deg, rgba(16,185,129,0.06), rgba(16,185,129,0.02))", border: loanRepaymentId ? "2px solid rgba(239,68,68,0.4)" : "1px solid rgba(16,185,129,0.2)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <span style={{ fontSize: 20 }}>{"🤝"}</span>
              <span style={{ fontSize: 15, fontWeight: 700, color: loanRepaymentId ? "#ef4444" : "#10b981" }}>{repaymentEscrow?.repaymentStatus === "COMPLETED" || repaymentEscrow?.repaymentStatus === "CLAIMED" ? "✅ Loan Complete" : loanRepaymentId ? "⚠️ Repayment Required" : "✅ Loan Disbursed Successfully"}</span>
            </div>

            {!loanRepaymentId && !repaymentEscrow && isLender && !(repaymentEscrow?.repaymentStatus === "COMPLETED" || repaymentEscrow?.repaymentStatus === "CLAIMED") && (
              <div>
                <div style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.6, marginBottom: 12 }}>
                  The borrower has received the sats. Create a repayment escrow so they can pay you back with interest.
                </div>
                <button onClick={handleCreateRepayment} disabled={repaymentCreating} style={{
                  ...M.actionBtn, background: "linear-gradient(135deg, #10b981, #059669)",
                  boxShadow: "0 4px 24px rgba(16,185,129,0.3)", fontSize: 15, padding: "14px 20px",
                }}>
                  {repaymentCreating ? "Creating..." : "💰 Create Repayment Escrow"}
                </button>
              </div>
            )}

            {!loanRepaymentId && !repaymentEscrow && isBorrower && (
              <div style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.6, textAlign: "center" }}>
                You received the loan. The lender will create a repayment escrow for you to pay back.
              </div>
            )}

            {/* ── Loan Fully Repaid ── */}
            {repaymentEscrow?.repaymentStatus && (repaymentEscrow.repaymentStatus === "COMPLETED" || repaymentEscrow.repaymentStatus === "CLAIMED") && (
              <div style={{ padding: "16px", borderRadius: 12, background: "rgba(16,185,129,0.08)", border: "2px solid rgba(16,185,129,0.3)", textAlign: "center", marginBottom: 12 }}>
                <div style={{ fontSize: 28, marginBottom: 6 }}>✅</div>
                <div style={{ fontSize: 16, fontWeight: 800, color: "#10b981", marginBottom: 4 }}>Loan Fully Repaid</div>
                <div style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.6 }}>
                  {isBorrower ? "You have successfully repaid this loan. Your trust score has been updated." : "The borrower has repaid in full. Sats have been returned to you."}
                </div>
                {repaymentEscrow.amountMsats && (
                  <div style={{ marginTop: 10, padding: "8px 14px", borderRadius: 8, background: "rgba(16,185,129,0.06)", display: "inline-block" }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "#10b981" }}>₿ {Math.floor(repaymentEscrow.amountMsats / 1000).toLocaleString()} sats repaid</span>
                  </div>
                )}
              </div>
            )}
            {(loanRepaymentId || repaymentEscrow) && !(repaymentEscrow?.repaymentStatus === "COMPLETED" || repaymentEscrow?.repaymentStatus === "CLAIMED") && (
              <div>
                <div style={{ padding: "12px 14px", borderRadius: 10, background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.2)", marginBottom: 12 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#f59e0b", marginBottom: 6 }}>{isBorrower ? "💰 You owe a repayment" : "⏳ Awaiting borrower repayment"}</div>
                  <div style={{ fontSize: 12, color: "#cbd5e1", lineHeight: 1.6 }}>
                    {isBorrower
                      ? "A repayment escrow has been created. Lock your sats to repay the loan. Failure to repay will flag your profile."
                      : "Waiting for the borrower to lock repayment sats. If they default, their profile will be flagged."
                    }
                  </div>
                </div>
                {repaymentEscrow && (
                  <div style={{ padding: "10px 14px", borderRadius: 10, background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.15)", marginBottom: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                      <span style={{ color: "#64748b" }}>Repayment amount</span>
                      <span style={{ fontWeight: 700, color: "#f59e0b" }}>{"₿"} {repaymentEscrow.repaymentSats?.toLocaleString()} sats</span>
                    </div>
                    {repaymentEscrow.interestMsats > 0 && (
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 4 }}>
                        <span style={{ color: "#475569" }}>Interest</span>
                        <span style={{ color: "#10b981" }}>{"₿"} {Math.floor(repaymentEscrow.interestMsats / 1000).toLocaleString()} sats</span>
                      </div>
                    )}
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                      <span style={{ color: "#475569" }}>Due by</span>
                      <span style={{ color: "#f87171" }}>{new Date(repaymentEscrow.dueAt).toLocaleDateString()}</span>
                    </div>
                  </div>
                )}
                <button onClick={() => onSwitchToEscrow(loanRepaymentId || repaymentEscrow?.repaymentEscrowId)} style={{
                  ...M.actionBtn, background: isBorrower
                    ? "linear-gradient(135deg, #f59e0b, #d97706)"
                    : "linear-gradient(135deg, #7c3aed, #6d28d9)",
                  fontSize: 14, padding: "12px 20px",
                }}>
                  {isBorrower ? "🔐 Open Repayment Escrow" : "🔍 View Repayment Escrow"}
                </button>
              </div>
            )}

            {loanDueAt && (
              <div style={{
                marginTop: 12, padding: "10px 14px", borderRadius: 10, textAlign: "center",
                background: new Date(loanDueAt) < new Date() ? "rgba(239,68,68,0.1)" : "rgba(59,130,246,0.06)",
                border: new Date(loanDueAt) < new Date() ? "1px solid rgba(239,68,68,0.3)" : "1px solid rgba(59,130,246,0.15)",
              }}>
                <div style={{ fontSize: 11, color: "#64748b", marginBottom: 2 }}>Repayment deadline</div>
                <div style={{ fontSize: 15, fontWeight: 800, color: new Date(loanDueAt) < new Date() ? "#ef4444" : "#3b82f6" }}>
                  {new Date(loanDueAt) < new Date()
                    ? "⚠️ OVERDUE — " + Math.floor((Date.now() - new Date(loanDueAt).getTime()) / 86400000) + " days late"
                    : new Date(loanDueAt).toLocaleDateString() + " (" + Math.ceil((new Date(loanDueAt).getTime() - Date.now()) / 86400000) + " days left)"
                  }
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Rating prompt ── */}
        {needsRating && (
          <div style={{ borderRadius: 12, padding: "12px 16px", marginBottom: 12, background: "linear-gradient(135deg, rgba(245,158,11,0.08), rgba(245,158,11,0.03))", border: "1px solid rgba(245,158,11,0.2)" }}>
            <div style={{ textAlign: "center", marginBottom: 8 }}>
              <span style={{ fontSize: 20 }}>⭐</span>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#f8fafc", marginTop: 4 }}>Rate your {otherRole}</div>
            </div>
            <div style={{ textAlign: "center", marginBottom: 8 }}>
              <StarRating score={rateScore} onChange={setRateScore} size={28} />
            </div>
            {rateScore > 0 && (
              <>
                <textarea value={rateComment} onChange={(e) => setRateComment(e.target.value)} placeholder="Optional comment..." maxLength={500} style={{ ...M.input, minHeight: 44, resize: "vertical", marginBottom: 8, fontSize: 12 }} />
                <button style={{ ...M.actionBtn, background: "linear-gradient(135deg, #f59e0b, #d97706)", color: "#0c0f17", padding: "10px 16px", fontSize: 13 }} onClick={handleRate} disabled={loading || !rateScore}>
                  {loading ? "Submitting…" : "⭐ Submit " + rateScore + "-Star Rating"}
                </button>
              </>
            )}
          </div>
        )}

        {/* ── Already rated ── */}
        {rated && (
          <div style={{ textAlign: "center", padding: "14px 16px", marginBottom: 16, borderRadius: 12, background: "rgba(16,185,129,0.06)", border: "1px solid rgba(16,185,129,0.15)" }}>
            <span style={{ color: "#10b981", fontSize: 13, fontWeight: 600 }}>
              ✓ You rated this trade {myExistingRating ? myExistingRating.score + "/5" : rateScore ? rateScore + "/5" : ""}
            </span>
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
  cardDesc: { fontSize: 13, color: "#94a3b8", margin: "6px 0 0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "center" },
  cardMeta: { display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10 },
  conditionBadge: { padding: "3px 10px", borderRadius: 6, fontSize: 11, fontWeight: 700, background: "rgba(139,92,246,0.1)", color: "#a78bfa", letterSpacing: 0.3 },
  categoryBadge: { padding: "3px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600, background: "rgba(100,116,139,0.1)", color: "#94a3b8" },
  chipBtn: { padding: "6px 12px", borderRadius: 8, background: "#111827", color: "#94a3b8", fontSize: 12, fontWeight: 500, border: "1px solid transparent", cursor: "pointer", WebkitTapHighlightColor: "rgba(0,0,0,0)", outline: "none" },
  chipBtnActive: { background: "#1e293b", color: "#f8fafc", borderColor: "#f59e0b" },
  infoBanner: { padding: "10px 14px", border: "1px solid", borderRadius: 10, marginBottom: 12 },
  participantRow: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", fontSize: 13 },
};
