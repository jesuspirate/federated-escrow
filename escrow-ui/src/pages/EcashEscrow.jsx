import { useState, useEffect, useCallback, useRef } from "react";

import { split } from "shamir-secret-sharing";
function uint8ToBase64(u8) { let b = ""; for (let i = 0; i < u8.length; i++) b += String.fromCharCode(u8[i]); return btoa(b); }
// Fedimint WASM SDK for e-cash escrow
let _wasmWallet = null;
let _wasmReady = false;
async function getWasmWallet() {
  if (_wasmWallet && _wasmReady) return _wasmWallet;
  try {
    const { WalletDirector } = await import('@fedimint/core');
    const { createWasmWorkerTransport } = await import('@fedimint/transport-web');
    const transport = createWasmWorkerTransport();
    const director = new WalletDirector(transport);
    await director.initialize();
    try { await director.generateMnemonic(); } catch(e) { /* exists */ }
    _wasmWallet = await director.createWallet();
    try {
      await _wasmWallet.open();
    } catch(e) {
      await _wasmWallet.joinFederation("fed11qgqyj3mfwfhksw309ajrwvmxvenxgvpkvyursenxxvur2c3sv4jkxdfcxf3kgdmyvs6nzcehvc6xzctzxumrxdmr89jnwdtpv5enqwtpxqmrsvfh89skxv34qqqjpzytwrkr28r8mjas4ej467utd7excr7fapj7ukgc4ugacm6nu2u73k7ram");
    }
    _wasmReady = true;
    return _wasmWallet;
  } catch(e) {
    console.error("[wasm] Init failed:", e);
    return null;
  }
}
import { t, setLocale, getLocale, getAvailableLocales } from "./i18n";

// ═══════════════════════════════════════════════════════════════════════
// Fedi Mini-App: E-Cash Escrow v9.3
// WebLN lock/claim • NIP-98 Nostr auth • Fedimint-powered
// Deep-link from Marketplace • Claim retry UX • YOU/Arbiter indicators
// Browser sandbox mode • Community-first onboarding
// ═══════════════════════════════════════════════════════════════════════

const API = "/api/ecash-escrows";

// ── Federation Limits ───────────────────────────────────────────────
// Fedi federation caps. Transactions exceeding these fail at WebLN layer.
export const FED_LIMITS = {
  MAX_BALANCE_SATS: 10_000_000,  // 10M sats wallet balance cap
  MAX_TX_SATS:       2_000_000,  // 2M sats per transaction
};

function validateAmount(sats) {
  if (!sats || sats <= 0) return "Enter a valid amount";
  if (sats > FED_LIMITS.MAX_TX_SATS) return `Exceeds ${FED_LIMITS.MAX_TX_SATS.toLocaleString()} ₿ sats federation limit`;
  if (sats < 1) return "Minimum ₿ 1,000 sats for Lightning routing";
  return null;
}

// ── Nostr / NIP-98 Auth ─────────────────────────────────────────────

// Custom error for Nostr rejections — caught and shown nicely in UI
class NostrRejectedError extends Error {
  constructor(action) { super(`Nostr permission denied — ${action}`); this.name = "NostrRejectedError"; }
}

async function getNostrPubkey() {
  if (isDevMode()) return null;
  if (!window.nostr) return null;
  try { return await window.nostr.getPublicKey(); }
  catch {
    // User pressed "No" on the pubkey prompt — not an error, just no Nostr
    console.warn("[nostr] getPublicKey rejected by user");
    return null;
  }
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
    const signed = await window.nostr.signEvent(event);
    return "Nostr " + btoa(JSON.stringify(signed));
  } catch {
    // User pressed "No" on signing — throw a friendly error
    // so calling code can show a proper message
    throw new NostrRejectedError("please approve the signing request to continue");
  }
}

// ── Dev identity management ─────────────────────────────────────────

const DEV_IDENTITIES = {
  seller:  "aa".repeat(32),
  buyer:   "bb".repeat(32),
  arbiter: "cc".repeat(32),
};

// ── Demo / Sandbox mode ──────────────────────────────────────────────
// SECURITY: Only the real Fedi app should bypass sandbox mode.
// Fedi runs mini-apps in a WebView and injects WebLN natively.
// Browser extensions (Alby, Nos2x) also inject window.webln/window.nostr
// but those are BROWSERS, not Fedi — they must stay in sandbox.
//
// Detection strategy: Fedi WebView is a mobile WebView (no "Chrome/" or
// "Firefox/" or "Safari/" standalone in UA) + has WebLN + is not a
// desktop browser. We check multiple signals to be sure.
function _detectFediApp() {
  if (typeof window === "undefined") return false;
  if (!window.webln) return false;

  const ua = navigator.userAgent || "";

  // Fedi WebView on Android: contains "wv" (WebView marker)
  // Fedi WebView on iOS: no "Safari" standalone (WebViews omit it)
  const isAndroidWebView = /Android/.test(ua) && (/wv\)/.test(ua) || !!window.webln);
  const isIOSWebView = /iPhone|iPad|iPod/.test(ua) && !/Safari\//.test(ua);

  // Desktop browsers with Alby: always sandbox
  const isDesktop = !/Android|iPhone|iPad|iPod|Mobile/.test(ua);
  if (isDesktop) return false;

  // Mobile browser with Alby extension (not WebView): sandbox
  // WebViews don't have extension APIs, so if window.nostr exists via
  // NIP-07 extension (not Fedi's own injection), it's a browser
  // Fedi injects nostr differently — via its bridge, not NIP-07 extension
  if (isAndroidWebView || isIOSWebView) return true;

  // Fallback: if mobile + webln but can't confirm WebView, be safe → sandbox
  return false;
}

let _fediConfirmed = false;
function _isFediRuntime() {
  if (_fediConfirmed) return true;
  if (_detectFediApp()) { _fediConfirmed = true; return true; }
  if (typeof window !== "undefined" && window.fediInternal) { _fediConfirmed = true; return true; }
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

// Fedi community chat rooms
const FEDI_ROOMS = {
  en: "fedi:room:!kENaQZKCKhRhawCjxf:m1.8fa.in:::",
  fr: "fedi:room:!qHlVxBJBCKqUbetBnA:m1.8fa.in:::",
  es: "fedi:room:!kENaQZKCKhRhawCjxf:m1.8fa.in:::",
  sw: "fedi:room:!kENaQZKCKhRhawCjxf:m1.8fa.in:::",
};
function getFediRoomLink(locale) {
  return FEDI_ROOMS[locale] || FEDI_ROOMS.en;
}

let _devPubkey = null;

// ── Session token management (shared via window global) ───────────────
function getSessionToken_escrow() {
  // Use shared global token
  if (window.__smToken && window.__smTokenExpiry > Date.now() + 60000) {
    return Promise.resolve(window.__smToken);
  }
  // Cooldown after rejection — don't spam NIP-98 prompts
  if (window.__smTokenRejectedAt && Date.now() - window.__smTokenRejectedAt < 30000) {
    return Promise.resolve(null);
  }
  // If marketplace or another call is already fetching, wait for THAT promise
  if (window.__smTokenPromise) {
    return window.__smTokenPromise.then(() => window.__smToken || null);
  }
  
  const fetchPromise = (async () => {
    try {
      const url = `${location.origin}${API}/auth/session`;
      const headers = { "Content-Type": "application/json" };
      const nip98 = await makeNip98Header(url, "POST");
      if (!nip98) { window.__smTokenRejectedAt = Date.now(); return null; }
      headers["Authorization"] = nip98;
      const res = await fetch(url, { method: "POST", headers });
      const data = await res.json();
      if (data.token) {
        window.__smToken = data.token;
        window.__smTokenExpiry = Date.now() + (data.expiresIn || 1800) * 1000;
        window.__smTokenRejectedAt = null;
      }
      return window.__smToken || null;
    } catch {
      window.__smTokenRejectedAt = Date.now();
      return null;
    }
  })();
  window.__smTokenPromise = fetchPromise;
  return fetchPromise.finally(() => { window.__smTokenPromise = null; });
}

// ── Federation detection via getAuthenticatedMember ──
async function detectMyFederation() {
  try {
    if (window.fediInternal && window.fediInternal.getAuthenticatedMember) {
      const member = await window.fediInternal.getAuthenticatedMember();
      // id format: "@npub...:federation.domain"
      if (member && member.id) {
        const parts = member.id.split(":");
        if (parts.length >= 2) return parts[parts.length - 1];
      }
    }
  } catch {}
  return null;
}

async function api(path, opts = {}, _retries = 2) {
  const method = opts.method || "GET";
  const url = `${location.origin}${API}${path}`;
  const headers = { "Content-Type": "application/json" };
  // Session token first, NIP-98 fallback
  // Use cached token if available, only refresh if missing
  if (!window.__smToken || !window.__smTokenExpiry || window.__smTokenExpiry < Date.now()) {
    await getSessionToken_escrow();
  }
  const token = window.__smToken;
  if (token) {
    headers["Authorization"] = "Bearer " + token;
  } else if (_devPubkey) {
    headers["X-Dev-Pubkey"] = _devPubkey;
  } else {
    try {
      const nip98 = await makeNip98Header(url, method);
      if (nip98) headers["Authorization"] = nip98;
    } catch (err) {
      if (err.name === "NostrRejectedError") {
        if (method !== "GET") throw err;
        if (_retries > 0) return api(path, opts, _retries - 1);
      }
      throw err;
    }
  }
  const res = await fetch(url, { ...opts, headers });
  if ((res.status === 401 || res.status === 403)) {
    window.__smToken = null; window.__smTokenExpiry = 0;
    throw new Error("Session expired — pull down to refresh and try again");
  }
  const text = await res.text();
  try { return JSON.parse(text); }
  catch { return { error: text || `HTTP ${res.status} — no response body` }; }
}

// ── Helpers ──────────────────────────────────────────────────────────

function fmtSats(msats) { return Math.floor(msats / 1000).toLocaleString(); }
function fmtSatsNum(msats) { return Math.floor(msats / 1000); }
function truncPk(hex) {
  if (!hex || hex.length < 16) return hex || "";
  return hex.slice(0, 8) + "\u2026" + hex.slice(-8);
}

// ═══════════════════════════════════════════════════════════════════════
// SVG ICONS — high contrast stroke icons for dark backgrounds
// ═══════════════════════════════════════════════════════════════════════

const SvgSeller = ({ size = 22, color = "#e2e8f0", ...p }) => (
  <svg {...p} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    <polyline points="9 22 9 12 15 12 15 22" />
  </svg>
);
const SvgBuyer = ({ size = 22, color = "#e2e8f0", ...p }) => (
  <svg {...p} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="9" cy="21" r="1" /><circle cx="20" cy="21" r="1" />
    <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
  </svg>
);
const SvgArbiter = ({ size = 22, color = "#e2e8f0", ...p }) => (
  <svg {...p} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
  </svg>
);
const SvgLockIcon = ({ size = 48, color = "#f59e0b" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
);
const SvgUnlockIcon = ({ size = 48, color = "#475569" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
    <path d="M7 11V7a5 5 0 0 1 9.9-1" />
  </svg>
);
const SvgZapIcon = ({ size = 48, color = "#10b981" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={color} stroke="none">
    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
  </svg>
);

const I = {
  Plus: (p) => <svg {...p} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>,
  Back: (p) => <svg {...p} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>,
  Copy: (p) => <svg {...p} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>,
  Refresh: (p) => <svg {...p} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>,
  Clock: (p) => <svg {...p} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
  Check: (p) => <svg {...p} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>,
  Download: (p) => <svg {...p} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>,
};

// ── Status Config ────────────────────────────────────────────────────

const STATUS = {
  CREATED:  { color: "#64748b", bg: "rgba(100,116,139,0.12)", key: "statusCreated" },
  FUNDED:   { color: "#8b5cf6", bg: "rgba(139,92,246,0.12)", key: "statusFunded" },
  LOCKED:   { color: "#f59e0b", bg: "rgba(245,158,11,0.12)", key: "statusLocked" },
  APPROVED: { color: "#38bdf8", bg: "rgba(56,189,248,0.12)", key: "statusApproved" },
  CLAIMED:  { color: "#10b981", bg: "rgba(16,185,129,0.12)", key: "statusClaimed" },
  COMPLETED:{ color: "#059669", bg: "rgba(5,150,105,0.12)", key: "statusCompleted" },
  EXPIRED:  { color: "#ef4444", bg: "rgba(239,68,68,0.12)", key: "statusExpired" },
};

function StatusBadge({ status }) {
  const c = STATUS[status] || STATUS.CREATED;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: "3px 10px", borderRadius: 99, fontSize: 11, fontWeight: 700,
      color: c.color, background: c.bg, letterSpacing: 0.3,
    }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: c.color }} />
      {t(c.key)}
    </span>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// ANIMATED COMPONENTS
// ═══════════════════════════════════════════════════════════════════════

function AnimNum({ value, dur = 1200 }) {
  const [d, setD] = useState(0);
  const from = useRef(0);
  const start = useRef(0);
  useEffect(() => {
    from.current = d;
    start.current = performance.now();
    function tick(now) {
      const p = Math.min((now - start.current) / dur, 1);
      const e = 1 - Math.pow(1 - p, 3);
      setD(Math.floor(from.current + (value - from.current) * e));
      if (p < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }, [value, dur]);
  return <>{d.toLocaleString()}</>;
}

function ParticleBurst({ active }) {
  const ref = useRef(null);
  const parts = useRef([]);
  const raf = useRef(null);
  useEffect(() => {
    if (!active) { parts.current = []; return; }
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    const w = (c.width = c.offsetWidth * 2);
    const h = (c.height = c.offsetHeight * 2);
    ctx.scale(2, 2);
    const cx = w / 4, cy = h / 4;
    const colors = ["#f59e0b", "#fbbf24", "#fcd34d", "#fff7ed"];
    for (let i = 0; i < 50; i++) {
      const angle = (Math.PI * 2 * i) / 50 + (Math.random() - 0.5) * 0.5;
      const speed = 2 + Math.random() * 4;
      parts.current.push({ x: cx, y: cy, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, r: Math.random() * 3 + 1, alpha: 1, decay: 0.008 + Math.random() * 0.012, color: colors[Math.floor(Math.random() * colors.length)] });
    }
    function draw() {
      ctx.clearRect(0, 0, w / 2, h / 2);
      parts.current = parts.current.filter(p => p.alpha > 0);
      for (const p of parts.current) { p.x += p.vx; p.y += p.vy; p.vy += 0.04; p.alpha -= p.decay; ctx.globalAlpha = p.alpha; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fillStyle = p.color; ctx.fill(); }
      ctx.globalAlpha = 1;
      if (parts.current.length > 0) raf.current = requestAnimationFrame(draw);
    }
    draw();
    return () => cancelAnimationFrame(raf.current);
  }, [active]);
  return <canvas ref={ref} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", zIndex: 5 }} />;
}

function ParticipantNode({ label, IconComp, pkDisplay, joined, voted, voteOutcome, resolvedOutcome, isDispute, isArbiter, isYou, delay = 0 }) {
  // Track join transition for glow effect
  const [justJoined, setJustJoined] = useState(false);
  const prevJoined = useRef(joined);
  useEffect(() => {
    if (!prevJoined.current && joined) {
      setJustJoined(true);
      const t = setTimeout(() => setJustJoined(false), 1800);
      return () => clearTimeout(t);
    }
    prevJoined.current = joined;
  }, [joined]);

  // ── Badge logic ──────────────────────────────────────────
  // Badges only appear after resolution (resolvedOutcome is set).
  //
  // HAPPY PATH (buyer+seller agree, no arbiter):
  //   Both buyer & seller get ✓. Arbiter never voted → no badge.
  //
  // DISPUTE PATH (buyer≠seller, arbiter breaks tie):
  //   Arbiter gets ✓ (they resolved it).
  //   The party whose vote matches resolvedOutcome gets ✓ (winner).
  //   The party whose vote doesn't match gets ✗ (loser).
  //   So the visible combo is always: Arbiter ✓ + Winner ✓ + Loser ✗
  //   NEVER Buyer ✓ + Seller ✓ in a dispute (they disagreed by definition).

  const isResolved = !!resolvedOutcome;
  let badgeType = null; // null = no badge, "win" = ✓, "lose" = ✗

  if (isResolved && voted) {
    if (isDispute) {
      // Dispute: arbiter always wins (they cast the deciding vote)
      // Other participants: check if their vote matched the outcome
      badgeType = (voteOutcome === resolvedOutcome) ? "win" : "lose";
    } else {
      // Happy path: buyer+seller agreed → both are winners
      badgeType = "win";
    }
  }

  const isWinner = badgeType === "win";
  const isLoser = badgeType === "lose";

  // ── Visual states ────────────────────────────────────────
  const ringColor = isWinner ? "#10b981"
    : isLoser ? "#4b2e14"
    : voted && !isResolved ? (voteOutcome === "release" ? "#3b82f6" : "#d97706")
    : justJoined ? "#60a5fa"
    : isYou && joined ? "#f59e0b"
    : isArbiter && joined ? "#7c3aed55"
    : joined ? "#475569"
    : "#1e293b";

  const iconColor = isWinner ? "#6ee7b7"
    : isLoser ? "#78350f"
    : isYou && joined ? "#fbbf24"
    : isArbiter && joined ? "#a78bfa"
    : joined ? "#cbd5e1"
    : "#1e293b";

  const labelColor = isWinner ? "#6ee7b7"
    : isLoser ? "#78350f"
    : voted && !isResolved ? (voteOutcome === "release" ? "#93c5fd" : "#fcd34d")
    : justJoined ? "#93c5fd"
    : isYou && joined ? "#fbbf24"
    : isArbiter && joined ? "#8b5cf6"
    : joined ? "#94a3b8"
    : "#1e293b";

  const shadowStyle = isWinner
    ? "0 0 20px rgba(16,185,129,0.35), inset 0 0 10px rgba(16,185,129,0.15)"
    : justJoined
    ? "0 0 28px rgba(96,165,250,0.45), 0 0 8px rgba(96,165,250,0.25), inset 0 0 12px rgba(96,165,250,0.15)"
    : isYou && joined
    ? "0 4px 16px rgba(245,158,11,0.3), 0 0 12px rgba(245,158,11,0.15)"
    : joined
    ? "0 4px 12px rgba(0,0,0,0.3)"
    : "none";

  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
      opacity: isLoser ? 0.4 : joined ? 1 : 0.2,
      transform: joined ? "translateY(0) scale(1)" : "translateY(4px) scale(0.88)",
      transition: `all 0.7s cubic-bezier(0.34, 1.56, 0.64, 1) ${delay}ms`,
    }}>
      <div style={{
        width: 56, height: 56, borderRadius: "50%",
        background: joined ? "linear-gradient(145deg, #1a2035, #111827)" : "#0a0d14",
        border: `2.5px solid ${ringColor}`,
        display: "flex", alignItems: "center", justifyContent: "center",
        transition: "all 0.6s ease",
        boxShadow: shadowStyle,
        position: "relative",
        animation: justJoined ? "joinGlow 1.8s ease-out" : "none",
      }}>
        {justJoined && (
          <div style={{
            position: "absolute", inset: -6, borderRadius: "50%",
            border: "2px solid rgba(96,165,250,0.3)",
            animation: "joinRingPulse 1.2s ease-out forwards",
          }} />
        )}
        {/* Pending vote indicator ring (pre-resolution only) */}
        {voted && !isResolved && (
          <div style={{
            position: "absolute", inset: -4, borderRadius: "50%",
            border: `1.5px solid ${voteOutcome === "release" ? "rgba(59,130,246,0.25)" : "rgba(217,119,6,0.25)"}`,
            animation: "vaultPulse 3s ease-out infinite",
          }} />
        )}
        <IconComp size={24} color={iconColor} style={{ transition: "all 0.5s ease" }} />
        {badgeType && (
          <div style={{
            position: "absolute", bottom: -3, right: -3,
            width: 20, height: 20, borderRadius: "50%",
            background: isWinner ? "#059669" : "#78350f",
            border: "2px solid #0a0e17",
            display: "flex", alignItems: "center", justifyContent: "center",
            animation: "popIn 0.35s cubic-bezier(0.34, 1.56, 0.64, 1)",
            color: "#fff", fontSize: 10, fontWeight: 800,
          }}>
            {isWinner ? "✓" : "✗"}
          </div>
        )}
      </div>
      <span style={{
        fontSize: 10, fontWeight: 700, letterSpacing: 0.8, textTransform: "uppercase",
        color: labelColor, transition: "color 0.6s ease",
      }}>{label}</span>
      {isYou && joined && (
        <span style={{
          fontSize: 9, fontWeight: 800, letterSpacing: 0.5,
          padding: "2px 8px", borderRadius: 4,
          background: "rgba(245,158,11,0.2)",
          color: "#fbbf24",
          border: "1px solid rgba(245,158,11,0.35)",
        }}>YOU</span>
      )}
      {isArbiter && joined && !isYou && (
        <span style={{
          fontSize: 8, fontWeight: 700, letterSpacing: 0.3,
          padding: "1px 5px", borderRadius: 3,
          background: "rgba(139,92,246,0.1)",
          color: "#8b5cf6",
          border: "1px solid rgba(139,92,246,0.2)",
        }}>⚖️</span>
      )}
      <span style={{
        fontSize: 9, fontFamily: "monospace",
        color: isLoser ? "#1a1e2a" : joined ? "#475569" : "#1a1e2a",
        transition: "color 0.5s ease",
      }}>{joined ? (pkDisplay || "joined") : "empty"}</span>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// VAULT — The centerpiece of Detail View
// ═══════════════════════════════════════════════════════════════════════

function Vault({ status, amountMsats, showBurst, resolvedOutcome }) {
  const isLocked = status === "LOCKED";
  const isApproved = status === "APPROVED";
  const isClaimed = status === "CLAIMED" || status === "COMPLETED";
  const isActive = isLocked || isApproved || isClaimed;
  const isDone = isClaimed;
  const vaultColor = isDone ? "#10b981" : isApproved ? "#10b981" : isLocked ? "#f59e0b" : status === "FUNDED" ? "#8b5cf6" : "#334155";
  const vaultGlow = isDone ? "rgba(16,185,129,0.15)" : isLocked ? "rgba(245,158,11,0.12)" : "transparent";

  return (
    <div style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", padding: "32px 20px 24px", margin: "0 0 12px", background: `radial-gradient(ellipse at 50% 60%, ${vaultGlow}, transparent 70%)`, transition: "all 1s ease", overflow: "hidden" }}>
      <ParticleBurst active={showBurst} />
      <div style={{ position: "relative", width: 80, height: 80, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 16 }}>
        {isLocked && !isDone && (
          <>
            <div style={{ position: "absolute", inset: -6, borderRadius: "50%", border: `2px solid ${vaultColor}25`, animation: "vaultPulse 2.5s ease-out infinite" }} />
            <div style={{ position: "absolute", inset: -14, borderRadius: "50%", border: `1px solid ${vaultColor}12`, animation: "vaultPulse 2.5s ease-out 0.5s infinite" }} />
          </>
        )}
        {isApproved && !isClaimed && (
          <div style={{ position: "absolute", inset: -10, borderRadius: "50%", border: "2px solid transparent", borderTopColor: "#10b981", borderRightColor: "#10b98140", animation: "spin 2s linear infinite" }} />
        )}
        <div style={{ animation: isLocked && !isApproved && !isDone ? "float 3s ease-in-out infinite" : "none", transition: "transform 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)" }}>
          {isDone ? <SvgZapIcon size={52} color="#10b981" /> : isActive ? <SvgLockIcon size={52} color={vaultColor} /> : status === "FUNDED" ? <SvgUnlockIcon size={52} color="#8b5cf6" /> : <SvgUnlockIcon size={52} color="#1e293b" />}
        </div>
      </div>
      <div style={{ fontSize: isActive ? 48 : 36, fontWeight: 900, color: isActive ? "#f8fafc" : "#334155", letterSpacing: -2, lineHeight: 1, transition: "all 0.8s cubic-bezier(0.34, 1.56, 0.64, 1)", textShadow: isActive ? `0 0 40px ${vaultGlow}` : "none", fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', display: "flex", alignItems: "baseline", gap: 4 }}>
        <span style={{ color: "#f7931a", fontWeight: 800, fontSize: isActive ? 44 : 34, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>₿</span>
        <AnimNum value={fmtSatsNum(amountMsats)} dur={1400} />
      </div>
      <div style={{ marginTop: 10, fontSize: 12, fontWeight: 500, color: isDone ? "#10b981" : isApproved ? "#10b981" : isLocked ? "#f59e0b" : status === "FUNDED" ? "#8b5cf6" : "#475569", transition: "color 0.5s ease", display: "flex", alignItems: "center", gap: 6 }}>
        {isDone ? (<><span style={{ width: 7, height: 7, borderRadius: "50%", background: "#10b981", animation: "pulseGreen 1.5s ease infinite" }} />{resolvedOutcome === "release" ? t("deliveredToBuyer") : t("refundedToSeller")}</>) : isApproved ? (<><span style={{ width: 7, height: 7, borderRadius: "50%", background: "#10b981" }} />{t("readyToClaim")}</>) : isLocked ? (<><span style={{ width: 7, height: 7, borderRadius: "50%", background: "#f59e0b", animation: "pulseAmber 2s ease infinite" }} />{t("securedInVault")}</>) : status === "FUNDED" ? t("readyToLock") : status === "EXPIRED" ? (<><span style={{ width: 7, height: 7, borderRadius: "50%", background: "#ef4444" }} />{t("escrowExpired")}</>) : t("waitingAllParties")}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// TOAST
// ═══════════════════════════════════════════════════════════════════════

function Toast({ msg, type, visible }) {
  if (!visible) return null;
  return (
    <div style={{ position: "fixed", bottom: 90, left: 16, right: 16, padding: "12px 16px", borderRadius: 12, background: type === "error" ? "#7f1d1d" : "#064e3b", color: "#fff", fontSize: 13, fontWeight: 500, zIndex: 1000, pointerEvents: "none", textAlign: "center", animation: "slideUp 0.25s ease-out", boxShadow: "0 8px 32px rgba(0,0,0,0.4)" }}>
      {msg}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// ONBOARDING — Community-first for browser, original for Fedi
// ═══════════════════════════════════════════════════════════════════════

const ONBOARDING_KEY = "fedi-escrow-onboarded";

function OnboardingSplash({ onComplete, locale }) {
  const [step, setStep] = useState(0);
  const isBrowser = !_isFediRuntime();
  const roomLink = getFediRoomLink(locale);

  const steps = isBrowser ? [
    { icon: <SvgLockIcon size={44} color="#f59e0b" />, titleKey: "obSandboxTitle", descKey: "obSandboxDesc" },
    { icon: <SvgArbiter size={44} color="#8b5cf6" />, titleKey: "obRolesTitle", descKey: "obRolesDesc" },
    { icon: <SvgZapIcon size={44} color="#10b981" />, titleKey: "obCommunityTitle", descKey: "obCommunityDesc" },
  ] : [
    { icon: <SvgArbiter size={44} color="#f59e0b" />, titleKey: "ob1Title", descKey: "ob1Desc" },
    { icon: <SvgBuyer size={44} color="#8b5cf6" />, titleKey: "ob2Title", descKey: "ob2Desc" },
    { icon: <SvgZapIcon size={44} color="#10b981" />, titleKey: "ob3Title", descKey: "ob3Desc" },
  ];

  const s = steps[step];
  const isLast = step === steps.length - 1;

  const handleNext = () => {
    if (isLast) { try { localStorage.setItem(ONBOARDING_KEY, "1"); } catch {} onComplete(); }
    else setStep(step + 1);
  };

  return (
    <div style={{ ...S.root, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", padding: "40px 24px", textAlign: "center", minHeight: "100vh" }}>
      <style>{`
        @keyframes obFadeUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes obPulse { 0%,100% { opacity: 0.5; } 50% { opacity: 1; } }
      `}</style>

      {/* Sandbox badge — browser only */}
      {isBrowser && (
        <div style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 14px", borderRadius: 99, background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.2)", marginBottom: 24, animation: "obFadeUp 0.3s ease-out" }}>
          <span style={{ fontSize: 12 }}>🧪</span>
          <span style={{ fontSize: 11, fontWeight: 700, color: "#f59e0b", letterSpacing: 0.5 }}>{t("sandboxBadge")}</span>
        </div>
      )}

      {/* Progress dots */}
      <div style={{ display: "flex", gap: 8, marginBottom: 48 }}>
        {steps.map((_, i) => (
          <div key={i} style={{ width: i === step ? 24 : 8, height: 8, borderRadius: 4, background: i <= step ? "#f59e0b" : "#1e293b", transition: "all 0.3s ease" }} />
        ))}
      </div>

      {/* Icon */}
      <div key={step} style={{ width: 96, height: 96, borderRadius: "50%", background: "linear-gradient(145deg, #1a2035, #111827)", border: "2px solid #1e293b", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 32, animation: "obFadeUp 0.4s ease-out", boxShadow: "0 8px 32px rgba(0,0,0,0.3)" }}>
        {s.icon}
      </div>

      {/* Content */}
      <div key={`t-${step}`} style={{ animation: "obFadeUp 0.4s ease-out 0.1s both", maxWidth: 320 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "#f8fafc", margin: "0 0 12px", letterSpacing: -0.5, lineHeight: 1.3 }}>{t(s.titleKey)}</h1>
        <p style={{ fontSize: 14, color: "#94a3b8", lineHeight: 1.7, margin: 0 }}>{t(s.descKey)}</p>
      </div>

      {/* Actions */}
      <div style={{ marginTop: 48, width: "100%", maxWidth: 320 }}>
        {isLast && isBrowser ? (
          <>
            <button onClick={handleNext} style={{ width: "100%", padding: "14px 0", borderRadius: 12, background: "#f59e0b", border: "none", color: "#0c0f17", fontSize: 15, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
              🚀 {t("tryDemo")}
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
            </button>
            <a href={roomLink} target="_blank" rel="noopener noreferrer" style={{ display: "flex", width: "100%", padding: "14px 0", marginTop: 10, borderRadius: 12, background: "transparent", border: "1.5px solid #334155", color: "#f8fafc", fontSize: 15, fontWeight: 600, cursor: "pointer", alignItems: "center", justifyContent: "center", gap: 8, textDecoration: "none" }}>
              💬 {t("joinChat")}
            </a>
          </>
        ) : (
          <>
            <button onClick={handleNext} style={{ width: "100%", padding: "14px 0", borderRadius: 12, background: isLast ? "#f59e0b" : "transparent", border: isLast ? "none" : "1.5px solid #334155", color: isLast ? "#0c0f17" : "#f8fafc", fontSize: 15, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
              {isLast ? t("obStartTrading") : t("obNext")}
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
            </button>
            {!isLast && (
              <button onClick={() => { try { localStorage.setItem(ONBOARDING_KEY, "1"); } catch {} onComplete(); }}
                style={{ width: "100%", padding: "12px 0", marginTop: 8, background: "transparent", border: "none", color: "#475569", fontSize: 13, cursor: "pointer" }}>
                {t("obSkip")}
              </button>
            )}
          </>
        )}
      </div>

      {/* Footer */}
      <div style={{ position: "absolute", bottom: 24, left: 24, right: 24, textAlign: "center", fontSize: 11, color: "#334155", animation: "obPulse 4s ease infinite" }}>
        {isBrowser ? t("sandboxFooter") : t("obFedLimit", { limit: FED_LIMITS.MAX_TX_SATS.toLocaleString() })}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════════════════════

export default function EcashEscrow({ pubkey: propPubkey, devRole: propDevRole, subdomain, onSwitchToMarketplace, onSwitchToMarketplaceOrders, initialEscrowId, onEscrowOpened, sharedPubkey, onPubkeyResolved }) {
  const [onboarded, setOnboarded] = useState(() => {
    try { return localStorage.getItem(ONBOARDING_KEY) === "1"; } catch { return false; }
  });
  const [locale, setLocaleState] = useState(getLocale);
  const [pubkey, setPubkey] = useState(propPubkey || null);
  const [devRole, setDevRole] = useState(propDevRole || "seller");
  const [view, setView] = useState("list");
  const [escrows, setEscrows] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState({ msg: "", type: "ok", visible: false });
  const toastTimer = useRef(null);

  const showToast = useCallback((msg, type = "ok") => {
    clearTimeout(toastTimer.current);
    setToast({ msg, type, visible: true });
    toastTimer.current = setTimeout(() => setToast(t => ({ ...t, visible: false })), 3000);
  }, []);

  // Sync pubkey/devRole from parent App.jsx when they change
  useEffect(() => {
    if (propPubkey) {
      // Set module-level _devPubkey BEFORE React state update
      if (isDevMode()) { _devPubkey = propPubkey; }
      else { _devPubkey = null; }
      // Reload escrows for new role but preserve current view
      setEscrows([]);
      setPubkey(propPubkey);
      // If viewing a detail, reload it to get the new role's perspective
      if (selected && selected.id) {
        setTimeout(() => loadDetail(selected.id), 100);
      }
    }
  }, [propPubkey]);

  useEffect(() => {
    if (propDevRole) setDevRole(propDevRole);
  }, [propDevRole]);

	// Browser = sandbox identities. Fedi = real Nostr auth.
	// Only runs if pubkey wasn't provided by parent
  useEffect(() => {
    if (propPubkey) return; // Parent controls auth
    if (isDevMode()) {
      _devPubkey = DEV_IDENTITIES[devRole];
      setPubkey(_devPubkey);
      return;
    }
    if (sharedPubkey) { _devPubkey = null; setPubkey(sharedPubkey); return; }
    try {
      const cached = sessionStorage.getItem("nostr_pubkey");
      if (cached) { _devPubkey = null; setPubkey(cached); return; }
    } catch (err) { console.warn("[chat] load:", err); }
    (async () => {
      const pk = await getNostrPubkey();
      if (pk) {
        _devPubkey = null;
        setPubkey(pk);
        if (onPubkeyResolved) onPubkeyResolved(pk);
        try { sessionStorage.setItem("nostr_pubkey", pk); } catch {}
      } else {
        _devPubkey = DEV_IDENTITIES[devRole];
        setPubkey(_devPubkey);
      }
    })();
  }, [sharedPubkey, propPubkey]);

	// FIX: Removed `if (!isDevMode()) return;` guard — it prevented switching
	// when Nostr auth succeeded on mount but ?dev is in the URL
  const switchDevIdentity = useCallback((role) => {
    setDevRole(role); _devPubkey = DEV_IDENTITIES[role]; setPubkey(_devPubkey);
    setEscrows([]); loadEscrows();
  }, []);

  const switchLocale = useCallback((code) => {
    setLocale(code);
    setLocaleState(code);
  }, []);

  const loadEscrows = useCallback(async () => {
    if (!pubkey) return;
    setLoading(true);
    try { const data = await api("/"); if (Array.isArray(data)) setEscrows(data); }
    catch (err) { showToast(err.name === "NostrRejectedError" ? err.message : t("failedLoadEscrows"), "error"); }
    setLoading(false);
  }, [pubkey, showToast]);

  useEffect(() => {
    // Skip loading all escrows if we're deep-linking to a specific one from marketplace
    if (!initialEscrowId) loadEscrows();
  }, [loadEscrows, pubkey]);

  const loadDetail = useCallback(async (id) => {
    setLoading(true);
    try { const data = await api(`/${id}`); if (data.error) throw new Error(data.error); setSelected(data); }
    catch (err) {
      showToast(err.message || "Failed to load trade", "error");
      // If we came from marketplace, go back to marketplace on auth errors
      if (cameFromMarketplace && onSwitchToMarketplace && err.name === "NostrRejectedError") {
        onSwitchToMarketplace();
        return;
      }
      // Stay on current view for transient errors (rate limits, network)
      // Only go to list if we have no selected escrow to display
      if (!selected) setView("list");
    }
    setLoading(false);
  }, [showToast, onSwitchToMarketplace]);

  const openDetail = (id) => {
    if (selected && selected.id !== id) setSelected(null);
    setView("detail"); loadDetail(id);
  };

  // ── Deep-link: auto-open escrow from marketplace ────────────────
  const [cameFromMarketplace, setCameFromMarketplace] = useState(false);
  useEffect(() => {
    if (initialEscrowId && pubkey) {
      setCameFromMarketplace(true);
      openDetail(initialEscrowId);
      if (onEscrowOpened) onEscrowOpened();
    }
  }, [initialEscrowId, pubkey]);

  // ── Onboarding gate ─────────────────────────────────────────────
  if (!onboarded) return <OnboardingSplash onComplete={() => setOnboarded(true)} locale={locale} />;

  if (!pubkey) {
    return (
      <div style={S.root}>
        <div style={{ ...S.container, justifyContent: "center", alignItems: "center" }}>
          <SvgArbiter size={32} color="#f59e0b" />
          <p style={{ color: "#94a3b8", marginTop: 12, fontSize: 14 }}>{t("connectingNostr")}</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ ...S.root, display: "flex", flexDirection: "column", minHeight: "100vh", overflowX: "hidden" }}>
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
        input, textarea { -webkit-user-select: auto; user-select: auto; }
        @keyframes slideUp { from { transform: translateY(16px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
        @keyframes popIn { 0% { transform: scale(0); } 100% { transform: scale(1); } }
        @keyframes float { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-8px); } }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes vaultPulse { 0% { transform: scale(1); opacity: 0.5; } 100% { transform: scale(1.6); opacity: 0; } }
        @keyframes pulseAmber { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }
        @keyframes pulseGreen { 0%,100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.85; transform: scale(1.03); } }
        @keyframes pulseGreenBig { 0%,100% { opacity: 1; transform: scale(1); box-shadow: 0 4px 24px rgba(16,185,129,0.3); } 50% { opacity: 0.9; transform: scale(1.04); box-shadow: 0 8px 36px rgba(16,185,129,0.5); } }
        @keyframes tapShake { 0% { transform: scale(1); } 15% { transform: scale(0.95) rotate(-1deg); } 30% { transform: scale(1.02) rotate(1deg); } 45% { transform: scale(0.98); } 60% { transform: scale(1.01); } 100% { transform: scale(1); } }
        @keyframes pulseAmberBig { 0%,100% { opacity: 1; transform: scale(1); box-shadow: 0 4px 24px rgba(245,158,11,0.3); } 50% { opacity: 0.9; transform: scale(1.04); box-shadow: 0 8px 36px rgba(245,158,11,0.5); } }
        @keyframes celebrateBounce { 0% { transform: scale(0) rotate(-10deg); } 60% { transform: scale(1.15) rotate(3deg); } 100% { transform: scale(1) rotate(0deg); } }
        @keyframes joinGlow { 0% { box-shadow: 0 0 0 rgba(96,165,250,0), inset 0 0 0 rgba(96,165,250,0); transform: scale(0.85); } 15% { box-shadow: 0 0 32px rgba(96,165,250,0.5), 0 0 12px rgba(96,165,250,0.3), inset 0 0 16px rgba(96,165,250,0.2); transform: scale(1.08); } 40% { box-shadow: 0 0 24px rgba(96,165,250,0.35), inset 0 0 10px rgba(96,165,250,0.12); transform: scale(1); } 100% { box-shadow: 0 4px 12px rgba(0,0,0,0.3); transform: scale(1); } }
        @keyframes joinRingPulse { 0% { transform: scale(1); opacity: 0.6; border-color: rgba(96,165,250,0.5); } 100% { transform: scale(1.8); opacity: 0; border-color: rgba(96,165,250,0); } }
        * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
        button { cursor: pointer; border: none; font-family: inherit; }
        .claim-btn:active, .lock-btn:active { animation: tapShake 0.4s ease !important; }
        input, textarea { font-family: inherit; }
        ::-webkit-scrollbar { width: 0; }
      `}</style>
      <Toast {...toast} />
      {view === "list" && <ListView escrows={escrows} pubkey={pubkey} loading={loading} onOpen={openDetail} onCreate={() => setView("create")} onJoin={() => setView("join")} onRefresh={loadEscrows} locale={locale} onSwitchLocale={switchLocale} onSwitchToMarketplace={onSwitchToMarketplace} subdomain={subdomain} />}
      {view === "create" && <CreateView pubkey={pubkey} locale={locale} onBack={() => setView("list")} onCreated={(id) => { loadEscrows(); openDetail(id); }} showToast={showToast} setLoading={setLoading} loading={loading} />}
      {view === "join" && <JoinView pubkey={pubkey} onBack={() => setView("list")} onJoined={(id) => { loadEscrows(); openDetail(id); }} showToast={showToast} setLoading={setLoading} loading={loading} />}
      {view === "detail" && selected && <DetailView escrow={selected} pubkey={pubkey} onBack={() => {
        if (cameFromMarketplace || subdomain !== "escrow") {
          setCameFromMarketplace(false);
          if (onSwitchToMarketplaceOrders) { onSwitchToMarketplaceOrders(selected.status === "CLAIMED" || selected.status === "COMPLETED" || selected.status === "EXPIRED" || selected.status === "DONE" ? "__ORDERS_ALL__" : "__ORDERS__"); return; }
        }
        setSelected(null); setView("list"); loadEscrows();
      }} onRefresh={() => loadDetail(selected.id)} showToast={showToast} setLoading={setLoading} loading={loading} onSwitchToMarketplace={onSwitchToMarketplace} onSwitchToMarketplaceOrders={onSwitchToMarketplaceOrders} cameFromMarketplace={cameFromMarketplace} subdomain={subdomain} />}
      {view === "detail" && !selected && (
        <div style={S.container}>
          <div style={S.viewHeader}>
            <button style={S.iconBtn} onClick={() => { setView("list"); loadEscrows(); }}><I.Back /></button>
            <h2 style={S.viewTitle}>{t("escrow")}</h2>
            <div style={{ width: 36 }} />
          </div>
          <div style={{ display: "flex", justifyContent: "center", paddingTop: "20vh" }}>
            <div style={{ width: 20, height: 20, border: "2px solid #1e293b", borderTopColor: "#475569", borderRadius: "50%", animation: "spin 0.6s linear infinite" }} />
          </div>
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
// LIST VIEW
// ═══════════════════════════════════════════════════════════════════════

function ListView({ escrows, pubkey, loading, onOpen, onCreate, onJoin, onRefresh, locale, onSwitchLocale, onSwitchToMarketplace, subdomain }) {
  const [escrowSearch, setEscrowSearch] = useState("");
  const filteredEscrows = escrows.filter(e => {
    if (!escrowSearch.trim()) return true;
    const q = escrowSearch.toLowerCase().trim();
    return (e.id || "").toLowerCase().includes(q)
      || (e.description || "").toLowerCase().includes(q)
      || (e.status || "").toLowerCase().includes(q);
  });

  return (
    <div style={{ ...S.container, display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
      {/* ══ PINNED HEADER SECTION ══ */}
      <div style={{ flexShrink: 0 }}>
      <div style={S.listHeader}>
        <div>
          <h1 style={S.title}>{t("escrow")}</h1>
          <p style={S.subtitle}>{isDevMode() ? t("sandboxFooter") : truncPk(pubkey)}</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button style={S.iconBtn} onClick={onRefresh}><I.Refresh style={loading ? { animation: "pulse 1s infinite" } : {}} /></button>
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, margin: "0 0 12px" }}>
        {subdomain !== "escrow" && <button style={{ ...S.primaryBtn, flex: 1, justifyContent: "center" }} onClick={() => onSwitchToMarketplace()}>🏪 {t("mkTitle") || "Marketplace"}</button>}
      </div>
      <div style={{ display: "flex", gap: 8, margin: "0 0 12px" }}>
        <button style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "10px 14px", borderRadius: 10, background: "#111827", border: "1px solid #1e293b", color: "#94a3b8", fontSize: 13, fontWeight: 600, cursor: "pointer" }} onClick={onCreate}>+ {t("createEscrow")}</button>
        <button style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "10px 14px", borderRadius: 10, background: "#111827", border: "1px solid #1e293b", color: "#94a3b8", fontSize: 13, fontWeight: 600, cursor: "pointer" }} onClick={onJoin}>🔗 {t("joinEscrow")}</button>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 12px", background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.1)", borderRadius: 8, marginBottom: 12, fontSize: 11, color: "#64748b" }}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
        {t("maxPerTrade", { limit: FED_LIMITS.MAX_TX_SATS.toLocaleString() })}
      </div>

      {/* ── Search ── */}
      <div style={{ marginBottom: 12 }}>
        <input style={{ ...S.input, fontSize: 13 }} placeholder="Search by escrow ID, description, or status…" value={escrowSearch} onChange={e => setEscrowSearch(e.target.value)} />
      </div>

      </div>
      {/* ══ SCROLLABLE TRADE LIST ══ */}
      <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden", WebkitOverflowScrolling: "touch", paddingBottom: 120 }}>
        {filteredEscrows.length === 0 ? (
          <div style={S.emptyState}>
            <SvgArbiter size={40} color="#475569" />
            <p style={{ color: "#64748b", marginTop: 12, fontSize: 14 }}>{t("noEscrows")}</p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {filteredEscrows.slice().sort((a, b) => {
              // Priority: items needing YOUR action first
              const rank = (e) => {
                if (e.status === "FUNDED") return 0;   // needs lock
                if (e.status === "LOCKED") return 1;   // needs vote
                if (e.status === "APPROVED") return 2;  // needs claim
                if (e.status === "CREATED") return 3;   // waiting for parties
                if (e.status === "CLAIMED") return 4;   // done
                if (e.status === "COMPLETED") return 5;
                if (e.status === "EXPIRED") return 6;
                return 7;
              };
              return rank(a) - rank(b);
            }).map(e => (
              <button key={e.id} style={{ ...S.escrowCard, ...(e.status === "COMPLETED" || e.status === "EXPIRED" ? { opacity: 0.5 } : {}) }} onClick={() => onOpen(e.id)}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={S.cardAmount}><span style={{ color: "#f7931a", fontWeight: 800 }}>₿</span>{fmtSats(e.amountMsats)}</span>
                  <StatusBadge status={e.status} />
                </div>
                {e.description && <p style={S.cardDesc}>{e.description}</p>}
                <div style={S.cardMeta}>
                  <span style={{ fontSize: 10, color: "#475569", fontFamily: "monospace" }}>{e.id}</span>
                  <span style={S.cardRole}>{e.yourRole || "\u2014"}</span>
                  {e.expiresIn && <span style={S.cardExpiry}><I.Clock /> {e.expiresIn}</span>}
                </div>
                {e.status === "FUNDED" && e.yourRole === "seller" && (
                  <div style={{ marginTop: 6, padding: "4px 10px", borderRadius: 6, background: "rgba(245,158,11,0.1)", fontSize: 11, fontWeight: 600, color: "#f59e0b", textAlign: "center" }}>
                    {e.description?.startsWith("Lending:") ? "🤝 Lock sats to fund the loan" : e.description?.startsWith("Loan Repayment:") ? "💰 Awaiting borrower repayment" : e.description?.startsWith("Bill Pay:") ? "🧾 Lock sats — someone will pay your bill" : "🔒 Lock your ₿ sats to start"}
                  </div>
                )}
                {e.status === "FUNDED" && e.yourRole !== "seller" && (
                  <div style={{ marginTop: 6, padding: "4px 10px", borderRadius: 6, background: "rgba(100,116,139,0.1)", fontSize: 11, color: "#64748b", textAlign: "center" }}>Waiting for seller to lock</div>
                )}
                {e.status === "LOCKED" && e.yourRole === "buyer" && (
                  <div style={{ marginTop: 6, padding: "4px 10px", borderRadius: 6, background: "rgba(16,185,129,0.1)", fontSize: 11, fontWeight: 600, color: "#10b981", textAlign: "center" }}>✓ Tap to vote</div>
                )}
                {e.status === "LOCKED" && e.yourRole === "seller" && (
                  <div style={{ marginTop: 6, padding: "4px 10px", borderRadius: 6, background: "rgba(100,116,139,0.1)", fontSize: 11, color: "#64748b", textAlign: "center" }}>Waiting for votes</div>
                )}
                {e.status === "LOCKED" && e.yourRole === "arbiter" && (
                  <div style={{ marginTop: 6, padding: "4px 10px", borderRadius: 6, background: "rgba(139,92,246,0.1)", fontSize: 11, fontWeight: 600, color: "#a78bfa", textAlign: "center" }}>⚖️ Dispute — your vote needed</div>
                )}
                {e.status === "APPROVED" && e.resolvedOutcome === "release" && e.yourRole === ((e.lock_role || "seller") === "seller" ? "buyer" : "seller") && (
                  <div style={{ marginTop: 6, padding: "4px 10px", borderRadius: 6, background: "rgba(16,185,129,0.1)", fontSize: 11, fontWeight: 600, color: "#10b981", textAlign: "center" }}>⚡ Claim your sats!</div>
                )}
                {e.status === "APPROVED" && e.resolvedOutcome === "refund" && e.yourRole === (e.lock_role || "seller") && (
                  <div style={{ marginTop: 6, padding: "4px 10px", borderRadius: 6, background: "rgba(16,185,129,0.1)", fontSize: 11, fontWeight: 600, color: "#10b981", textAlign: "center" }}>⚡ Reclaim your sats!</div>
                )}
                {e.status === "APPROVED" && ((e.resolvedOutcome === "release" && e.yourRole !== ((e.lock_role || "seller") === "seller" ? "buyer" : "seller")) || (e.resolvedOutcome === "refund" && e.yourRole !== (e.lock_role || "seller"))) && (
                  <div style={{ marginTop: 6, padding: "4px 10px", borderRadius: 6, background: "rgba(100,116,139,0.1)", fontSize: 11, color: "#64748b", textAlign: "center" }}>Resolved — waiting for claim</div>
                )}
                {e.status === "CREATED" && (
                  <div style={{ marginTop: 6, padding: "4px 10px", borderRadius: 6, background: "rgba(100,116,139,0.1)", fontSize: 11, color: "#64748b", textAlign: "center" }}>Waiting for participants</div>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// CREATE VIEW
// ═══════════════════════════════════════════════════════════════════════

function CreateView({ pubkey, locale, onBack, onCreated, showToast, setLoading, loading }) {
  const [amount, setAmount] = useState("");
  const [desc, setDesc] = useState("");
  const [terms, setTerms] = useState("");
  const [community, setCommunity] = useState(() => getFediRoomLink(locale));
  const [amountError, setAmountError] = useState(null);

  const onAmountChange = (val) => {
    setAmount(val);
    const sats = parseInt(val);
    setAmountError(sats ? validateAmount(sats) : null);
  };

  const handleCreate = async () => {
    const sats = parseInt(amount);
    const err = validateAmount(sats);
    if (err) return showToast(err, "error");
    if (!terms || terms.trim().length < 5) return showToast(t("tradeTerms") + " (min 5)", "error");
    if (!community) return showToast(t("communityLink") + " ✕", "error");
    setLoading(true);
    try {
      const res = await api("/", { method: "POST", body: JSON.stringify({ amountMsats: sats * 1000, description: desc, terms, communityLink: community }) });
      if (res.error) throw new Error(res.error);
      showToast(t("escrowCreated")); onCreated(res.id);
    } catch (err) { showToast(err.message, "error"); }
    setLoading(false);
  };
  return (
    <div style={{ ...S.container, paddingBottom: 20 }}>
      <div style={S.viewHeader}><button style={S.iconBtn} onClick={onBack}><I.Back /></button><h2 style={S.viewTitle}>{t("newTrade")}</h2><div style={{ width: 36 }} /></div>
      <div style={S.formGroup}><label style={S.label}>{t("amountSats")}</label><input style={{ ...S.input, ...(amountError ? { borderColor: "#ef4444" } : {}) }} type="number" placeholder="25000" value={amount} onChange={e => onAmountChange(e.target.value)} />{amountError && <p style={{ fontSize: 11, color: "#ef4444", marginTop: 4 }}>{amountError}</p>}<p style={S.hint}>{t("maxFedLimit", { limit: FED_LIMITS.MAX_TX_SATS.toLocaleString() })}</p></div>
      <div style={S.formGroup}><label style={S.label}>{t("description")}</label><input style={S.input} placeholder="Selling 50 USD for ₿ sats" value={desc} onChange={e => setDesc(e.target.value)} /></div>
      <div style={S.formGroup}><label style={S.label}>{t("tradeTerms")}</label><textarea style={{ ...S.input, minHeight: 72, resize: "vertical" }} placeholder="Payment via Zelle. Send within 1 hour of lock." value={terms} onChange={e => setTerms(e.target.value)} /></div>
      <div style={S.formGroup}><label style={S.label}>{t("communityLink")}</label><input style={S.input} placeholder="fedi:room:!roomId:federation.domain:::" value={community} onChange={e => setCommunity(e.target.value)} /><p style={S.hint}>{t("communityLinkHint")}</p></div>
      <button style={{ ...S.primaryBtn, width: "100%", marginTop: 8, padding: "14px 0" }} onClick={handleCreate} disabled={loading || !!amountError}>{loading ? t("creating") : t("createEscrow")}</button>
      <div style={{ marginTop: 16, padding: "14px", background: "#111827", borderRadius: 10, border: "1px solid #1e293b", lineHeight: 1.7 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>{t("howItWorks")}</div>
        <div style={{ fontSize: 12, color: "#94a3b8" }}>
          <strong style={{ color: "#cbd5e1" }}>1.</strong> {t("howStep1")} <strong style={{ color: "#f59e0b" }}>{t("howStep1Role")}</strong>.<br/>
          <strong style={{ color: "#cbd5e1" }}>2.</strong> {t("howStep2")}<br/>
          <strong style={{ color: "#cbd5e1" }}>3.</strong> {t("howStep3")}<br/>
          <strong style={{ color: "#cbd5e1" }}>4.</strong> {t("howStep4")}<br/>
          <strong style={{ color: "#cbd5e1" }}>5.</strong> {t("howStep5")}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// JOIN VIEW
// ═══════════════════════════════════════════════════════════════════════

function JoinView({ pubkey, onBack, onJoined, showToast, setLoading, loading }) {
  const [escrowId, setEscrowId] = useState("");
  const [role, setRole] = useState("buyer");
  const [arbiterAllowed, setArbiterAllowed] = useState(null); // null=loading, true/false

  // Check arbiter allowlist on mount — sandbox always allows arbiter
  useEffect(() => {
    if (isDevMode()) { setArbiterAllowed(true); return; }
    (async () => {
      try {
        const res = await api("/arbiter-check");
        if (res.mode === "open") setArbiterAllowed(true);
        else setArbiterAllowed(!!res.allowed);
      } catch { setArbiterAllowed(true); }
    })();
  }, [pubkey]);

  const handleJoin = async () => {
    if (!escrowId) return showToast(t("escrowId") + " ✕", "error");
    if (role === "arbiter" && arbiterAllowed === false) return showToast(t("arbiterRestricted"), "error");
    setLoading(true);
    try {
      const res = await api(`/${escrowId.trim()}/join`, { method: "POST", body: JSON.stringify({ role }) });
      if (res.error) throw new Error(res.error);
      showToast(t("joinedAs", { role: t(role) })); onJoined(escrowId.trim());
    } catch (err) {
      // Marketplace auto-joins all parties — if already in, open the escrow detail
      if (err.message?.includes("already the") || err.message?.includes("already filled")) {
        showToast("Opening your escrow…", "ok");
        onJoined(escrowId.trim());
        setLoading(false);
        return;
      }
      showToast(err.message, "error");
    }
    setLoading(false);
  };

  const arbiterBlocked = role === "arbiter" && arbiterAllowed === false;

  return (
    <div style={{ ...S.container, paddingBottom: 20 }}>
      <div style={S.viewHeader}><button style={S.iconBtn} onClick={onBack}><I.Back /></button><h2 style={S.viewTitle}>{t("joinEscrow")}</h2><div style={{ width: 36 }} /></div>
      <div style={S.formGroup}><label style={S.label}>{t("yourRole")}</label><div style={{ display: "flex", gap: 8 }}>{["buyer", "arbiter"].map(r => (<button key={r} onClick={() => setRole(r)} style={{ ...S.roleBtn, ...(role === r ? S.roleBtnActive : {}), ...(r === "arbiter" && arbiterAllowed === false ? { opacity: 0.4 } : {}) }}>{r === "buyer" ? `\ud83d\uded2 ${t("buyer")}` : `\u2696\ufe0f ${t("arbiter")}`}</button>))}</div></div>
      <div style={S.formGroup}><label style={S.label}>{t("escrowId")}</label><input style={S.input} placeholder={t("escrowIdPlaceholder")} value={escrowId} onChange={e => setEscrowId(e.target.value)} /></div>

      {arbiterBlocked && (
        <div style={{ padding: "10px 14px", background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 10, marginTop: 8, fontSize: 12, color: "#f87171", lineHeight: 1.6 }}>
          <strong>{t("arbiterRestricted")}</strong> {t("arbiterRestrictedDesc")}
        </div>
      )}

      <button style={{ ...S.primaryBtn, width: "100%", marginTop: 16, padding: "14px 0", ...(arbiterBlocked ? { opacity: 0.4, cursor: "not-allowed" } : {}) }} onClick={handleJoin} disabled={loading || arbiterBlocked}>{loading ? t("joining") : t("joinAs", { role: t(role) })}</button>
      <div style={{ marginTop: 16, padding: "14px", background: "#111827", borderRadius: 10, border: "1px solid #1e293b" }}>
        <div style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.7 }}>
          <strong style={{ color: "#8b5cf6" }}>{t("buyer")}</strong> — {t("buyerDesc")}<br/>
          <strong style={{ color: "#f59e0b" }}>{t("arbiter")}</strong> — {t("arbiterDesc")}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// DETAIL VIEW — Redesigned with Vault + animated action bar
// ═══════════════════════════════════════════════════════════════════════

// ── Trade Chat — NIP-44 Encrypted ────────────────────────────────────────
function TradeChat({ escrowId, pubkey, participants }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const pollRef = useRef(null);
  const lastTs = useRef(0);
  const chatEndRef = useRef(null);

  // Draggable bubble state
  const [bubblePos, setBubblePos] = useState(() => {
    try { const s = sessionStorage.getItem("sm_chat_bubble_pos"); return s ? JSON.parse(s) : null; } catch { return null; }
  });
  const dragRef = useRef({ startX: 0, startY: 0, startRight: 16, startBottom: 70, dragging: false });
  const bubbleRight = bubblePos?.right ?? 16;
  const bubbleBottom = bubblePos?.bottom ?? 70;
  const onBubbleTouchStart = (e) => {
    const t = e.touches[0];
    dragRef.current = { startX: t.clientX, startY: t.clientY, startRight: bubbleRight, startBottom: bubbleBottom, dragging: false };
  };
  const onBubbleTouchMove = (e) => {
    const t = e.touches[0];
    const dx = dragRef.current.startX - t.clientX;
    const dy = dragRef.current.startY - t.clientY;
    if (Math.abs(dx) > 5 || Math.abs(dy) > 5) dragRef.current.dragging = true;
    if (!dragRef.current.dragging) return;
    e.preventDefault();
    const newRight = Math.max(4, Math.min(window.innerWidth - 56, dragRef.current.startRight + dx));
    const newBottom = Math.max(4, Math.min(window.innerHeight - 56, dragRef.current.startBottom + dy));
    setBubblePos({ right: newRight, bottom: newBottom });
  };
  const onBubbleTouchEnd = () => {
    if (dragRef.current.dragging) {
      try { sessionStorage.setItem("sm_chat_bubble_pos", JSON.stringify({ right: bubbleRight, bottom: bubbleBottom })); } catch {}
    } else { setOpen(true); setUnreadCount(0); }
  };

  const myRole = pubkey === participants?.seller ? "seller" : pubkey === participants?.buyer ? "buyer" : "arbiter";
  const roleColors = { seller: "#f59e0b", buyer: "#a78bfa", arbiter: "#64748b" };
  const roleLabels = { seller: "Seller", buyer: "Buyer", arbiter: "Arbiter" };

  const chatFetch = async (path, opts = {}) => {
    const headers = { "Content-Type": "application/json" };
    // Ensure session token exists
    if (!window.__smToken) await getSessionToken_escrow();
    if (window.__smToken) headers["Authorization"] = "Bearer " + window.__smToken;
    const res = await fetch("/api/chat" + path, { ...opts, headers });
    const data = await res.json();
    // If auth failed, try getting a new token and retry once
    if (data.error === "Authentication required" && !opts._retried) {
      window.__smToken = null;
      window.__smTokenExpiry = 0;
      await getSessionToken_escrow();
      if (window.__smToken) {
        headers["Authorization"] = "Bearer " + window.__smToken;
        const res2 = await fetch("/api/chat" + path, { ...opts, _retried: true, headers });
        return res2.json();
      }
    }
    return data;
  };

  const loadMessages = async () => {
    try {
      const res = await chatFetch("/" + escrowId + "/messages?after=" + lastTs.current);
      if (res.messages && res.messages.length > 0) {
        const newMsgs = res.messages.map(msg => ({
          ...msg,
          text: msg.encrypted || "[empty]",
        }));
        for (const msg of newMsgs) {
          lastTs.current = Math.max(lastTs.current, msg.timestamp);
        }
        setMessages(prev => {
          const existing = new Set(prev.map(m => m.id));
          const unique = newMsgs.filter(m => !existing.has(m.id));
          return [...prev, ...unique];
        });
        setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
      }
    } catch {}
  };

  useEffect(() => {
    if (!open || !escrowId) return;
    // Only full-reset if escrow changed; otherwise just resume polling
    lastTs.current = 0;
    loadMessages();
    pollRef.current = setInterval(loadMessages, 3000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [open, escrowId]);

  const sendMessage = async () => {
    if (!draft.trim() || sending) return;
    setSending(true);
    try {
      // Send message — server stores it, only authenticated participants can read
      const msgText = draft.trim();
      // Optimistic: show message immediately
      setMessages(prev => [...prev, { id: "local_" + Date.now(), sender_pubkey: pubkey, sender_role: myRole, encrypted: msgText, text: msgText, timestamp: Date.now() }]);
      setDraft("");
      setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
      // Send to server
      const sendResult = await chatFetch("/" + escrowId + "/messages", {
        method: "POST",
        body: JSON.stringify({ encrypted: msgText }),
      });
      // Replace optimistic message with server-confirmed one
      if (sendResult.messageId) {
        setMessages(prev => prev.map(m => m.id && m.id.startsWith("local_") && m.text === msgText ? { ...m, id: sendResult.messageId, timestamp: sendResult.timestamp || m.timestamp } : m));
        // Don't update lastTs here — let loadMessages handle it naturally
      }
    } catch (err) {
      console.warn("[chat] send failed:", err);
    }
    setSending(false);
  };

  // ── Blossom Image Upload ──────────────────────────────────────────
  const fileInputRef = useRef(null);
  const [uploading, setUploading] = useState(false);

  const uploadImage = async (file) => {
    if (!file || !file.type.startsWith("image/")) {
      return null;
    }
    if (file.size > 20 * 1024 * 1024) {
      return null; // 20MB free limit on blossom.band
    }
    setUploading(true);
    try {
      // Compute SHA-256 hash of the file
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
      const arrayBuffer = await stripped.arrayBuffer();
      const hashBuffer = await crypto.subtle.digest("SHA-256", arrayBuffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const sha256 = hashArray.map(b => b.toString(16).padStart(2, "0")).join("");

      // Sign Blossom auth event (kind 24242)
      if (!window.nostr) throw new Error("Nostr not available");
      const authEvent = {
        kind: 24242,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ["t", "upload"],
          ["x", sha256],
          ["expiration", String(Math.floor(Date.now() / 1000) + 300)],
        ],
        content: "Upload image for trade chat",
      };
      const signed = await window.nostr.signEvent(authEvent);
      const authHeader = "Nostr " + btoa(JSON.stringify(signed));

      // Upload to blossom.band
      const res = await fetch("https://blossom.band/upload", {
        method: "PUT",
        headers: {
          "Authorization": authHeader,
          "Content-Type": file.type,
        },
        body: stripped,
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(errText || "Upload failed (" + res.status + ")");
      }

      const data = await res.json();
      // blossom.band returns { url, sha256, size, type, uploaded }
      return data.url || ("https://blossom.band/" + sha256);
    } catch (err) {
      console.warn("[blossom] upload failed:", err);
      return null;
    } finally {
      setUploading(false);
    }
  };

  const handleImagePick = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Reset input so same file can be picked again
    e.target.value = "";

    const url = await uploadImage(file);
    if (!url) {
      // Show inline error — don't use showToast (not passed to TradeChat)
      setMessages(prev => [...prev, {
        id: "err_" + Date.now(),
        sender_pubkey: pubkey,
        sender_role: myRole,
        encrypted: "\u26a0 Image upload failed. Try a smaller image or check your connection.",
        text: "\u26a0 Image upload failed. Try a smaller image or check your connection.",
        timestamp: Date.now(),
        isError: true,
      }]);
      return;
    }

    // Send image URL as a chat message with [img] marker
    const msgText = "[img]" + url;
    setMessages(prev => [...prev, {
      id: "local_" + Date.now(),
      sender_pubkey: pubkey,
      sender_role: myRole,
      encrypted: msgText,
      text: msgText,
      timestamp: Date.now(),
    }]);
    setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);

    // Send to server
    try {
      const sendResult = await chatFetch("/" + escrowId + "/messages", {
        method: "POST",
        body: JSON.stringify({ encrypted: msgText }),
      });
      if (sendResult.messageId) {
        setMessages(prev => prev.map(m =>
          m.id && m.id.startsWith("local_") && m.text === msgText
            ? { ...m, id: sendResult.messageId, timestamp: sendResult.timestamp || m.timestamp }
            : m
        ));
      }
    } catch (err) {
      console.warn("[chat] image send failed:", err);
    }
  };

  // Track unread count when chat is closed
  const [unreadCount, setUnreadCount] = useState(0);
  useEffect(() => {
    if (open || !escrowId) return;
    // Poll for new messages even when closed
    const checkUnread = async () => {
      try {
        const res = await chatFetch("/" + escrowId + "/messages?after=" + lastTs.current);
        if (res.messages && res.messages.length > 0) {
          setUnreadCount(prev => prev + res.messages.filter(m => m.sender_pubkey !== pubkey).length);
          for (const msg of res.messages) lastTs.current = Math.max(lastTs.current, msg.timestamp);
          lastTs.current += 1; // Skip past last seen to avoid re-counting with >= query
        }
      } catch {}
    };
    const iv = setInterval(checkUnread, 5000);
    return () => clearInterval(iv);
  }, [open, escrowId]);

  if (!open) {
    return (
      <button
        onTouchStart={onBubbleTouchStart}
        onTouchMove={onBubbleTouchMove}
        onTouchEnd={onBubbleTouchEnd}
        onClick={() => { if (!dragRef.current.dragging) { setOpen(true); setUnreadCount(0); } }}
        style={{
          position: "fixed", bottom: bubbleBottom, right: bubbleRight,
          width: 48, height: 48, borderRadius: "50%",
          background: "linear-gradient(135deg, #3b82f6, #2563eb)", border: "none", cursor: "pointer",
          boxShadow: "0 4px 20px rgba(59,130,246,0.4)", display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 20, zIndex: 100, touchAction: "none", WebkitUserSelect: "none", userSelect: "none",
          transition: dragRef.current?.dragging ? "none" : "all 0.15s ease",
        }}>
        💬
        {unreadCount > 0 && (
          <span style={{ position: "absolute", top: -4, right: -4, width: 20, height: 20, borderRadius: "50%", background: "#ef4444", color: "#fff", fontSize: 10, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center" }}>{unreadCount}</span>
        )}
      </button>
    );
  }

  return (
    <div style={{
      position: "fixed", bottom: 0, left: 0, right: 0, maxHeight: "60vh",
      background: "#111827", borderTop: "1px solid #1e293b", borderRadius: "16px 16px 0 0",
      display: "flex", flexDirection: "column", zIndex: 100,
      boxShadow: "0 -4px 30px rgba(0,0,0,0.5)",
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderBottom: "1px solid #1e293b" }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: "#f8fafc" }}>💬 Trade Chat</div>
        <button onClick={() => setOpen(false)} style={{ background: "none", border: "none", color: "#64748b", fontSize: 18, cursor: "pointer" }}>✕</button>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: "auto", padding: "8px 16px", minHeight: 120, maxHeight: "40vh" }}>
        {messages.length === 0 && (
          <div style={{ textAlign: "center", color: "#475569", fontSize: 12, padding: 20 }}>
            No messages yet. Say hello!
          </div>
        )}
        {messages.map((msg, i) => {
          const isMe = msg.sender_pubkey === pubkey;
          return (
            <div key={msg.id || i} style={{ display: "flex", flexDirection: "column", alignItems: isMe ? "flex-end" : "flex-start", marginBottom: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 2, flexDirection: isMe ? "row-reverse" : "row" }}>
                <div style={{ width: 20, height: 20, borderRadius: "50%", background: (roleColors[msg.sender_role] || "#64748b") + "25", border: "1.5px solid " + (roleColors[msg.sender_role] || "#64748b"), display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 800, color: roleColors[msg.sender_role] || "#64748b", flexShrink: 0 }}>{isMe ? "Y" : (roleLabels[msg.sender_role] || "?")[0]}</div>
                <span style={{ fontSize: 10, color: roleColors[msg.sender_role] || "#64748b" }}>{isMe ? "You" : roleLabels[msg.sender_role] || msg.sender_role}</span>
              </div>
              <div style={{
                maxWidth: "80%", padding: msg.text?.startsWith("[img]") ? "4px" : "8px 12px",
                borderRadius: isMe ? "12px 12px 0 12px" : "12px 12px 12px 0",
                background: isMe ? "rgba(59,130,246,0.15)" : "#1e293b",
                color: msg.isError ? "#f59e0b" : msg.text === "[encrypted]" ? "#475569" : "#e2e8f0", fontSize: 13, lineHeight: 1.4,
                overflow: "hidden",
              }}>
                {msg.text?.startsWith("[img]") ? (
                  <a href={msg.text.slice(5)} target="_blank" rel="noopener noreferrer">
                    <img src={msg.text.slice(5)} alt="Shared image" style={{ maxWidth: "100%", maxHeight: 200, borderRadius: 8, display: "block" }}
                      onError={(e) => { e.target.style.display = "none"; e.target.parentElement.textContent = "\ud83d\uddbc Image failed to load"; }}
                    />
                  </a>
                ) : msg.text}
              </div>
              <div style={{ fontSize: 9, color: "#475569", marginTop: 2 }}>
                {new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </div>
            </div>
          );
        })}
        <div ref={chatEndRef} />
      </div>

      {/* Input */}
      {/* Upload indicator */}
      {uploading && (
        <div style={{ padding: "6px 16px", fontSize: 11, color: "#3b82f6", textAlign: "center", animation: "pulse 1.5s infinite" }}>
          Uploading image...
        </div>
      )}
      <div style={{ display: "flex", gap: 6, padding: "8px 16px 12px", borderTop: "1px solid #1e293b", alignItems: "center" }}>
        <input type="file" accept="image/*" ref={fileInputRef} onChange={handleImagePick} style={{ display: "none" }} />
        <button onClick={() => fileInputRef.current?.click()} disabled={uploading} style={{
          width: 38, height: 38, borderRadius: 10, border: "none", cursor: "pointer",
          background: "#0f1629", color: uploading ? "#475569" : "#64748b", fontSize: 16,
          display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
        }} title="Share image">
          {uploading ? "..." : "\ud83d\udcf7"}
        </button>
        <input
          style={{ flex: 1, background: "#0f1629", border: "1px solid #1e293b", borderRadius: 10, padding: "10px 14px", color: "#f8fafc", fontSize: 13, outline: "none" }}
          value={draft} onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
          placeholder="Type a message..."
        />
        <button onClick={sendMessage} disabled={sending || !draft.trim()} style={{
          padding: "10px 16px", borderRadius: 10, border: "none", cursor: "pointer",
          background: draft.trim() ? "linear-gradient(135deg, #3b82f6, #2563eb)" : "#1e293b",
          color: draft.trim() ? "#fff" : "#475569", fontSize: 13, fontWeight: 700,
        }}>
          {sending ? "..." : "Send"}
        </button>
      </div>
    </div>
  );
}

function DetailView({ escrow: e, pubkey, onBack, onRefresh, showToast, setLoading, loading, onSwitchToMarketplace, onSwitchToMarketplaceOrders, cameFromMarketplace, subdomain }) {
  const role = e.yourRole || null;
  const status = e.status;
  const [showBurst, setShowBurst] = useState(false);
  const [locking, setLocking] = useState(false);
  const [lockProgress, setLockProgress] = useState({ stage: "", pct: 0, active: false });
  const [claimProgress, setClaimProgress] = useState({ stage: "", pct: 0, active: false });
  const [fedMismatch, setFedMismatch] = useState(null);
  const prevStatus = useRef(status);

  // Trade type detection from escrow description prefix
  const isP2PTrade = e.description?.startsWith("P2P Trade:");
  const isBillPay = e.description?.startsWith("Bill Pay:");
  const isLending = e.description?.startsWith("Lending:");
  const isMarketplace = e.description?.startsWith("Marketplace:");
  const isRepayment = e.description?.startsWith("Loan Repayment");
  const tradeType = isP2PTrade ? "p2p" : isLending ? "lending" : isMarketplace ? "marketplace" : "manual";

  useEffect(() => {
    if (prevStatus.current !== "LOCKED" && status === "LOCKED") {
      setShowBurst(true);
      setTimeout(() => setShowBurst(false), 2000);
    }
    prevStatus.current = status;
  }, [status]);

  const copy = (text, label) => {
    navigator.clipboard.writeText(text).then(
      () => showToast(t("copied", { label })),
      () => showToast(t("copyFailed"), "error")
    );
  };

  // ── WebLN Lock (seller) ─────────────────────────────────────────
  const [lockInvoice, setLockInvoice] = useState(null); // { invoice, bolt11 }
  const [lockStep, setLockStep] = useState("idle"); // idle | fetching | ready | paying | done
  const [claimRetry, setClaimRetry] = useState(() => status === "CLAIMED"); // auto-detect if escrow is already claimed (user rejected invoice on prior attempt)

  // Haptic pulse — continuous vibration during lock/claim
  const hapticInterval = useRef(null);
  const startHaptic = () => { try { navigator.vibrate?.([40, 20, 40]); } catch {} hapticInterval.current = setInterval(() => { try { navigator.vibrate?.([30, 40, 30]); } catch {} }, 300); };
  const stopHaptic = () => { if (hapticInterval.current) { clearInterval(hapticInterval.current); hapticInterval.current = null; } try { navigator.vibrate?.(0); } catch {} };
  const [pendingNotes, setPendingNotes] = useState(null);
  const [autoRepaymentId, setAutoRepaymentId] = useState(null);
  const [claimInProgress, setClaimInProgress] = useState(false);
  const [payoutInfo, setPayoutInfo] = useState(null); // { feeMsats, winnerMsats, feeBps }

  const handleLockFetch = async () => {
    const amountSats = Math.floor((e.amountMsats || 0) / 1000);
    if (amountSats > FED_LIMITS.MAX_TX_SATS) {
      return showToast(`Exceeds ${FED_LIMITS.MAX_TX_SATS.toLocaleString()} ₿ sats federation limit`, "error");
    }
    if (isDevMode() || !window.webln) {
      // Dev/sandbox mode — skip WebLN, use manual lock
      setLocking(true);
      try {
        const notes = `ECASH_DEV_${Date.now()}`;
        const lock = await api(`/${e.id}/lock`, { method: "POST", body: JSON.stringify({ mode: "manual", notes }) }, 0);
        if (lock.error) throw new Error(lock.error);
        showToast(t("lockedDevMode"));
        onRefresh();
      } catch (err) { showToast(err.message, "error"); }
      finally { setLocking(false); }
      return;
    }
    // Step 1: Fetch invoice from backend (with retry)
    setLockStep("fetching");
    let inv, lastErr;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        inv = await api(`/${e.id}/invoice`, {}, 0);
        if (!inv.error) break;
        lastErr = inv.error;
      } catch (err) {
        lastErr = err.message === "Failed to fetch"
          ? "Connection failed — check your network and try again"
          : err.message;
      }
      if (attempt < 2) await new Promise(r => setTimeout(r, 1500));
    }
    if (!inv || inv.error) {
      showToast(lastErr || "Failed to get invoice", "error");
      setLockStep("idle");
      return;
    }
    if (inv.mode === "webln" && inv.invoice) {
      setLockInvoice(inv.invoice);
      setLockStep("ready");
    } else {
      showToast("No invoice returned — try again", "error");
      setLockStep("idle");
    }
  };

  const handleLockEcash = async () => {
    if (!window.fediInternal || !window.fediInternal.generateEcash) {
      showToast("E-cash not available — use Lightning lock instead", "error");
      return;
    }
    // Double-check: only the lock_role can lock
    const lockRole = e.lock_role || "seller";
    if (role !== lockRole) {
      showToast("Only the " + lockRole + " can lock sats in this trade.", "error");
      return;
    }
    setLocking(true);
      startHaptic();
      setLockProgress({ stage: "Verifying federation...", pct: 10, active: true });
    try {
      // Federation check before generating e-cash
      try {
        if (window.fediInternal && window.fediInternal.getAuthenticatedMember) {
          const member = await window.fediInternal.getAuthenticatedMember();
          if (member && member.id) {
            const fedParts = member.id.split(":");
            const myFed = fedParts.length >= 2 ? fedParts[fedParts.length - 1] : null;
            const escrowFed = e.federationId || e.federation_id;
            const sellerPrefix = e.seller_fed_prefix || e.sellerFedPrefix || "";
            const isBillPayEscrow = (e.description || "").startsWith("Bill Pay:");
            if (myFed && escrowFed && myFed !== escrowFed && !isBillPayEscrow) {
              showToast("You're on " + myFed + " but this trade is on " + escrowFed + ". You must be on the same federation to lock sats.", "error");
              setLocking(false);
              return;
            }
          }
        }
      } catch {}
      // Pre-fetch session token BEFORE generateEcash to avoid auth prompt during lock
      await getSessionToken_escrow();
      setLockProgress({ stage: "Generating e-cash...", pct: 30, active: true });
      const amountSats = Math.floor(e.amountMsats / 1000);
      // Call generateEcash
      let notes;
      try {
        notes = await window.fediInternal.generateEcash({ amount: amountSats });
      } catch (genErr) {
        showToast("E-cash cancelled or failed. Tap to try again.", "error");
        stopHaptic(); setLockProgress({ stage: "", pct: 0, active: false });
        setLocking(false);
        return;
      }

      if (!notes || typeof notes !== "string" || notes.length < 20) {
        showToast("No e-cash notes generated. Tap to try again.", "error");
        setLocking(false);
        stopHaptic(); setLockProgress({ stage: "", pct: 0, active: false });
        return;
      }


      setLockProgress({ stage: "Verifying notes...", pct: 60, active: true });
      // POST-GENERATE federation check: compare notes prefix against seller's stored prefix
      const expectedPrefix = e.sellerFedPrefix || e.seller_fed_prefix;
      const _isSandbox = !window.fediInternal || isDevMode();
      if (!_isSandbox && expectedPrefix && notes.length > 10) {
        const notePrefix = notes.substring(0, 10);
        if (notePrefix !== expectedPrefix) {
          // Auto-refund the notes
          try { await window.fediInternal.receiveEcash(notes); } catch {}
          // Show persistent federation mismatch banner
          setFedMismatch({
            expected: expectedPrefix,
            got: notePrefix,
          });
          setLocking(false);
          return;
          stopHaptic(); setLockProgress({ stage: "", pct: 0, active: false });
        }
      }
      // Clear any previous mismatch on successful prefix match
      setFedMismatch(null);

      // Notes valid — proceed (remove duplicate return below)
      if (false) {
        return;
      }
      showToast("Splitting e-cash with Shamir...");
      setLockProgress({ stage: "Shamir splitting...", pct: 75, active: true });

      // ── CLIENT-SIDE SHAMIR + NIP-44 ──
      // Split notes into 3 shares (2-of-3 threshold)
      const secret = new TextEncoder().encode(notes);
      const shares = await split(secret, 3, 2);

      // Get participant pubkeys from escrow
      const sellerPk = e.participants?.seller;
      const buyerPk = e.participants?.buyer;
      const arbiterPk = e.participants?.arbiter;
      if (!sellerPk || !buyerPk) throw new Error("Missing participant pubkeys for Shamir encryption");

      setLockProgress({ stage: "Encrypting shares...", pct: 80, active: true });

      // NIP-44 encrypt each share to the respective participant — skip self (locker)
      const myPk = pubkey;
      const share0b64 = uint8ToBase64(shares[0]);
      const share1b64 = uint8ToBase64(shares[1]);
      const share2b64 = uint8ToBase64(shares[2]);

      let encSellerShare, encBuyerShare, encArbiterShare;
      let useNip44 = false;
      if (window.nostr?.nip44?.encrypt) {
        try {
          await window.nostr.nip44.encrypt(sellerPk === myPk ? buyerPk : sellerPk, "test");
          useNip44 = true;
        } catch (nip44Err) {
          console.warn("[shamir] NIP-44 not available:", nip44Err.message);
        }
      }

      if (useNip44) {
        encSellerShare = sellerPk === myPk ? share0b64
          : await window.nostr.nip44.encrypt(sellerPk, share0b64);
        encBuyerShare = buyerPk === myPk ? share1b64
          : await window.nostr.nip44.encrypt(buyerPk, share1b64);
        encArbiterShare = !arbiterPk ? share2b64
          : arbiterPk === myPk ? share2b64
          : await window.nostr.nip44.encrypt(arbiterPk, share2b64);
      } else {
        // Fallback: client-side split but no encryption (still better than server-side split)
        encSellerShare = share0b64;
        encBuyerShare = share1b64;
        encArbiterShare = share2b64;
      }
      showToast("Locking in escrow...");
      setLockProgress({ stage: "Locking in escrow...", pct: 90, active: true });

      // Use direct fetch with Bearer token — never trigger NIP-98 during lock
      const lockHeaders = { "Content-Type": "application/json" };
      let lockToken = window.__smToken;
      if (!lockToken) { lockToken = await getSessionToken_escrow(); }
      if (lockToken) { lockHeaders["Authorization"] = "Bearer " + lockToken; }
      // Detect our federation and send it with the lock
      let myFedDomain = null;
      try {
        myFedDomain = await detectMyFederation();
      } catch {}
      const lockRes = await fetch(location.origin + API + "/" + e.id + "/lock-ecash", {
        method: "POST", headers: lockHeaders,
        body: JSON.stringify({
          encryptedShares: {
            seller: encSellerShare,
            buyer: encBuyerShare,
            arbiter: encArbiterShare,
          },
          lockerFederation: myFedDomain,
          shamirNip44: true,
        }),
      });
      const lock = await lockRes.json();

      if (lock.error) throw new Error(lock.error);

      showToast("E-cash locked! Instant. Pure Fedimint.");
      setLockProgress({ stage: "✅ Locked!", pct: 100, active: true });
      stopHaptic();
      try { navigator.vibrate?.([100, 50, 100, 50, 200]); } catch {} // success burst
      setTimeout(() => setLockProgress({ stage: "", pct: 0, active: false }), 2000);
      try { onRefresh(); } catch {}
    } catch (err) {
      showToast(err.message || "E-cash lock failed", "error");
      stopHaptic();
      setLockProgress({ stage: "", pct: 0, active: false });
    }
    setLocking(false);
  };

    const handleLockPay = async () => {
    // Step 2: User-initiated WebLN payment — fresh tap each time
    if (!lockInvoice) return;
    setLockStep("paying");
    try {
      await window.webln.enable();
      await window.webln.sendPayment(lockInvoice);
    } catch (err) {
      // User rejected OR payment failed — check backend to see if it went through anyway
      try {
        const check = await api(`/${e.id}`, {}, 0);
        if (check.status === "LOCKED") {
          // Payment actually succeeded despite the error
          showToast(t("satsLocked"));
          setLockStep("done");
          onRefresh();
          return;
        }
      } catch {}
      showToast("Payment cancelled — tap to try again", "error");
      setLockStep("ready");
      return;
    }
    // Payment succeeded — confirm lock on backend
    try {
      const lock = await api(`/${e.id}/lock`, { method: "POST", body: JSON.stringify({ mode: "webln" }) }, 0);
      if (lock.error) throw new Error(lock.error);
    } catch { /* backend auto-lock handles it */ }
    showToast(t("satsLocked"));
    setLockStep("done");
    onRefresh();
  };

  // ── 2-step confirmation for critical votes ──────────────────────
  const [confirmVote, setConfirmVote] = useState(null);
  const [myShare, setMyShare] = useState(null);

  // ── Subdomain-aware labels ──
  const labels = (() => {
    const sd = e.description?.startsWith("Bill Pay:") ? "billpay" : e.description?.startsWith("P2P Trade:") ? "p2p" : e.description?.startsWith("Marketplace:") ? "market" : e.description?.startsWith("Loan Repayment") ? "lending" : e.description?.startsWith("Lending:") ? "lending" : (subdomain || "marketplace");
    const lockRole = e.lock_role || "seller";
    const isLocker = role === lockRole;
    if (sd === "p2p") return {
      lockBtn: "🔐 Lock ₿ " + fmtSats(e.amountMsats) + " for sale",
      lockedStatus: isLocker ? "Sats locked — waiting for fiat payment" : "Sats locked — send fiat to the seller",
      releaseBtn: role === "buyer" ? "✓ I sent the fiat" : role === "seller" ? "✓ Fiat received" : t("release"),
      refundBtn: "⚠ Dispute",
      claimBtn: "⚡ Receive " + fmtSats(e.amountMsats) + " sats",
      voteConfirmRelease: role === "buyer" ? "Confirm you sent the fiat payment?" : "Confirm you received the fiat?",
      voteConfirmRefund: "Open a dispute? The arbiter will review.",
    };
 if (sd === "billpay") return {
lockBtn: "🧾 Lock ₿ " + fmtSats(e.amountMsats) + " for bill",
lockedStatus: isLocker ? "Sats locked — waiting for someone to pay your bill" : "Sats locked — pay the bill and show proof",
releaseBtn: role === "buyer" ? "✓ Bill has been paid" : role === "seller" ? "✓ I received the fiat" : t("release"),
refundBtn: "⚠ Dispute",
claimBtn: "⚡ Receive ₿ " + fmtSats(e.amountMsats) + " sats",
voteConfirmRelease: role === "buyer" ? "Confirm you sent the fiat to the bill poster?" : "Confirm you received the fiat? Sats will go to the volunteer.",
voteConfirmRefund: "Open a dispute? The arbiter will review.",
};
    if (sd === "market") return {
      lockBtn: "🔐 Pay ₿ " + fmtSats(e.amountMsats),
      lockedStatus: isLocker ? "Payment locked — waiting for delivery" : "Payment secured — ship the item",
      releaseBtn: role === "buyer" ? "✓ I received it" : role === "seller" ? "✓ Item delivered" : t("release"),
      refundBtn: "⚠ Dispute",
      claimBtn: "⚡ Receive ₿ " + fmtSats(e.amountMsats) + " payment",
      voteConfirmRelease: role === "buyer" ? "Confirm you received the item?" : "Confirm the item was delivered?",
      voteConfirmRefund: "Open a dispute? The arbiter will review.",
    };
    const isRepayment = e.description?.startsWith("Loan Repayment");
    const isFiatRepayment = e.description?.includes("(Fiat)");
    if (sd === "lending" && isRepayment) return {
      lockBtn: isFiatRepayment ? "💵 Confirm Fiat Repayment" : "💰 Repay ₿ " + fmtSats(e.amountMsats),
      lockedStatus: isFiatRepayment
        ? (isLocker ? "Awaiting lender to confirm fiat received" : "Verify the borrower sent fiat and confirm")
        : (isLocker ? "Repayment locked — waiting for lender confirmation" : "Borrower has repaid — verify and confirm"),
      releaseBtn: isFiatRepayment
        ? (role === "buyer" ? "✓ I sent the fiat" : role === "seller" ? "✓ Fiat received" : t("release"))
        : (role === "buyer" ? "✓ I have repaid" : role === "seller" ? "✓ Repayment received" : t("release")),
      refundBtn: "⚠ Dispute repayment",
      claimBtn: isFiatRepayment ? "✅ Repayment confirmed" : "⚡ Receive ₿ " + fmtSats(e.amountMsats) + " repayment",
      voteConfirmRelease: isFiatRepayment
        ? (role === "buyer" ? "Confirm you sent the fiat repayment?" : "Confirm you received fiat from the borrower?")
        : (role === "buyer" ? "Confirm you have repaid the loan?" : "Confirm you received the repayment?"),
      voteConfirmRefund: "Dispute this repayment? The arbiter will review.",
    };
    if (sd === "lending") return {
      lockBtn: "🤝 Lend ₿ " + fmtSats(e.amountMsats),
      lockedStatus: isLocker ? "Loan locked — awaiting borrower acceptance" : "Loan available — review terms and accept",
      releaseBtn: role === "buyer" ? "✓ I accept the loan" : role === "seller" ? "✓ Disburse loan" : t("release"),
      refundBtn: "⚠ Dispute",
      claimBtn: "⚡ Receive ₿ " + fmtSats(e.amountMsats) + " loan",
      voteConfirmRelease: role === "buyer" ? "Accept this loan and its terms?" : "Confirm you want to disburse the loan?",
      voteConfirmRefund: "Open a dispute on this loan?",
    };
    // escrow + marketplace (legacy)
    return {
      lockBtn: "🔐 Lock ₿ " + fmtSats(e.amountMsats),
      lockedStatus: "Secured in vault",
      releaseBtn: t("release") || "Release",
      refundBtn: t("refund") || "Refund",
      claimBtn: "⚡ Receive " + fmtSats(e.amountMsats) + " sats",
      voteConfirmRelease: "Release funds to the buyer?",
      voteConfirmRefund: "Refund funds to the seller?",
    };
  })();

  // Fetch Shamir share when escrow is active (LOCKED, APPROVED, or CLAIMED)
  useEffect(() => {
    if (!e || !e.id) return;
    if (!["LOCKED", "APPROVED", "CLAIMED"].includes(e.status)) return;
    (async () => {
      try {
        const data = await api("/" + e.id + "/my-share");
        if (data.share) {
          // NIP-44 encrypted shares need client-side decryption
          if (data.nip44 && window.nostr?.nip44) {
            try {
              const decrypted = await window.nostr.nip44.decrypt(data.lockerPubkey, data.share);
              setMyShare(decrypted);
            } catch (decErr) {
              console.warn("[shamir] NIP-44 decrypt failed:", decErr.message);
              setMyShare(data.share); // fallback to raw share
            }
          } else {
            setMyShare(data.share);
          }
        }
      } catch {}
    })();
  }, [e?.id, e?.status]); // null | "release" | "refund"

  const handleVote = async (outcome) => {
    // Arbiter + Seller get a 2-step gate. Buyer votes directly.
    if (role === "arbiter" || role === "seller") {
      if (confirmVote !== outcome) {
        setConfirmVote(outcome);
        return; // First tap — show confirmation
      }
    }
    setConfirmVote(null);
    setLoading(true);
    try {
      const res = await api(`/${e.id}/approve`, { method: "POST", body: JSON.stringify({ outcome, share: myShare || undefined }) });
      if (res.error) throw new Error(res.error);
      showToast(outcome === "release" ? t("votedRelease") : t("votedRefund"));
      // Silently refresh — if auth fails for refresh, that's ok, vote was recorded
      try { onRefresh(); } catch {}
    } catch (err) { showToast(err.message, "error"); }
    setLoading(false);
  };

  const cancelConfirm = () => setConfirmVote(null);

  // Extract federation ID prefix from e-cash notes (bytes 3-7 of base64-decoded notes)
  const extractFedIdFromNotes = (notes) => {
    try {
      const b64 = notes.replace(/-/g, "+").replace(/_/g, "/");
      const bin = atob(b64.substring(0, 12));
      return Array.from(bin.substring(3, 7), c => c.charCodeAt(0).toString(16).padStart(2, "0")).join("");
    } catch { return null; }
  };

  const handleClaim = async () => {
    setClaimInProgress(true);
    startHaptic();
    setClaimProgress({ stage: "Preparing claim...", pct: 10, active: true });
    setLoading(true);
    try {
      let amountSats = Math.floor((e.amountMsats || 0) / 1000);

      // Guard: dont re-claim if already completed
      if (status === "COMPLETED") { showToast("Already claimed!"); setLoading(false); setClaimInProgress(false); return; }

      // ── E-CASH PAYOUT: Two-step flow to ensure receiveEcash runs from user tap ──
      if ((e.lockMode === "ecash" || e.lockMode === "ecash-nip44") && !isDevMode() && window.fediInternal && window.fediInternal.receiveEcash) {

        // STEP 2: If we already have notes, redeem them (called from direct user tap)
        if (pendingNotes) {
          try {
            // Federation check before redeeming
            try {
              if (window.fediInternal && window.fediInternal.getAuthenticatedMember) {
                const member2 = await window.fediInternal.getAuthenticatedMember();
                if (member2 && member2.id) {
                  const fedParts2 = member2.id.split(":");
                  const claimFed = fedParts2.length >= 2 ? fedParts2[fedParts2.length - 1] : null;
                  const escrowFed2 = e.federationId || e.federation_id;
                  if (claimFed && escrowFed2 && claimFed !== escrowFed2) {
                    showToast("Cannot claim — you're on " + claimFed + " but sats are from " + escrowFed2 + ". Switch federations in Fedi.", "error");
                    setLoading(false);
                    return;
                  }
                }
              }
            } catch {}
            showToast("Redeeming " + amountSats.toLocaleString() + " sats...");
            clearInterval(_claimTimer); setClaimProgress(prev => ({ stage: "Redeeming e-cash...", pct: Math.max(prev.pct, 70), active: true }));
            const redeemResult = await window.fediInternal.receiveEcash(pendingNotes);
            // Confirm successful receipt
            const confirmRes = await api("/" + e.id + "/confirm-ecash-received", { method: "POST" });
            if (confirmRes?.autoRepaymentId) setAutoRepaymentId(confirmRes.autoRepaymentId);
            setClaimProgress({ stage: "Confirming receipt...", pct: 90, active: true });
            setPendingNotes(null);
            const receivedSats = payoutInfo?.winnerMsats ? Math.floor(payoutInfo.winnerMsats / 1000) : amountSats;
            const feeSats = payoutInfo?.feeMsats ? Math.floor(payoutInfo.feeMsats / 1000) : 0;
            if (feeSats > 0) {
              showToast(receivedSats.toLocaleString() + " sats received! (" + feeSats + " sats platform fee)");
            } else {
              showToast("E-cash received! " + receivedSats.toLocaleString() + " sats in your wallet!");
            }
            clearInterval(_claimTimer); setClaimProgress({ stage: "✅ Claimed!", pct: 100, active: true });
            stopHaptic();
            try { navigator.vibrate?.([100, 50, 100, 50, 200]); } catch {}
            setTimeout(() => setClaimProgress({ stage: "", pct: 0, active: false }), 2000);
            // Stay on escrow view — show completion, let user navigate via back button
            setTimeout(() => { setClaimProgress({ stage: "", pct: 0, active: false }); onRefresh(); }, 1500);
          } catch (redeemErr) {
            const errMsg = String(redeemErr.message || redeemErr || "");
            console.warn("[claim] receiveEcash error:", errMsg);
            if (errMsg.includes("already") || errMsg.includes("spent")) {
              showToast("These notes have already been redeemed.", "error");
              setPendingNotes(null);
            } else if (errMsg.includes("federation") || errMsg.includes("mint") || errMsg.includes("unknown") || errMsg.includes("failed to receive")) {
              const fedName = e.federationId || e.federation_id || "the seller's federation";
              showToast("These sats are from " + fedName + ". Go to your Fedi home screen, switch to that federation, then come back and tap Receive again.", "error");
            } else {
              const escrowFed = e.federationId || e.federation_id || "";
              if (escrowFed) {
                showToast("Cannot receive — sats locked from federation " + escrowFed + ". You must be on the same federation to claim.", "error");
              } else {
                showToast("Cannot receive — you and the locker are on different federations.", "error");
              }
            }
          }
          setLoading(false);
          setClaimInProgress(false);
          return;
        }

        // STEP 1: Claim on server + fetch notes (stores in state for step 2)
        setClaimProgress({ stage: "Claiming escrow...", pct: 20, active: true });
        // Animate progress while waiting
        const _claimTimer = setInterval(() => {
          setClaimProgress(prev => {
            if (prev.pct >= 92) return prev;
            const speed = prev.pct < 40 ? 2 : prev.pct < 70 ? 1 : 0.5;
            return { ...prev, pct: Math.min(prev.pct + speed, 92) };
          });
        }, 600);
        if (status !== "CLAIMED" && status !== "COMPLETED" && !claimRetry) {
          try {
            const claim = await api("/" + e.id + "/claim", { method: "POST" });
            if (claim.error && !String(claim.error).includes("CLAIMED")) throw new Error(claim.error);
          } catch (claimErr) {
            // Ignore "already claimed" errors — just proceed to fetch notes
            if (!String(claimErr.message || "").includes("CLAIMED") && !String(claimErr.message || "").includes("APPROVED")) {
              throw claimErr;
            }
          }
        }
        showToast("Retrieving e-cash notes...");
        setClaimProgress(prev => ({ stage: "Retrieving e-cash...", pct: Math.max(prev.pct, 50), active: true }));
        const ecashData = await api("/" + e.id + "/ecash-payout", {}, 0);
        if (ecashData.error) throw new Error(ecashData.error);
        if (ecashData.mode !== "ecash" || !ecashData.notes) throw new Error("No e-cash notes available");

        // Store notes and prompt user to tap again
        // Store notes as fallback, then auto-redeem in same gesture chain
        setPendingNotes(ecashData.notes);
        setPayoutInfo({
          feeMsats: ecashData.platformFeeMsats || 0,
          winnerMsats: ecashData.amountMsats || 0,
          feeBps: ecashData.platformFeeBps || 0,
        });
        // Auto-redeem: chain receiveEcash immediately (same user gesture)
        try {
          const receivedAmt = ecashData.amountMsats ? Math.floor(ecashData.amountMsats / 1000) : amountSats;
          const feeSats = ecashData.platformFeeMsats ? Math.floor(ecashData.platformFeeMsats / 1000) : 0;
          showToast("Receiving " + receivedAmt.toLocaleString() + " sats...");
          clearInterval(_claimTimer); setClaimProgress(prev => ({ stage: "Receiving sats...", pct: Math.max(prev.pct, 75), active: true }));
          await window.fediInternal.receiveEcash(ecashData.notes);
          const confirmRes = await api("/" + e.id + "/confirm-ecash-received", { method: "POST" });
          setClaimProgress(prev => ({ stage: "Confirming receipt...", pct: Math.max(prev.pct, 90), active: true }));
          if (confirmRes?.autoRepaymentId) setAutoRepaymentId(confirmRes.autoRepaymentId);
          setPendingNotes(null);
          if (feeSats > 0) {
            showToast(receivedAmt.toLocaleString() + " sats received! (" + feeSats + " sats platform fee)");
          } else {
            showToast("E-cash received! " + receivedAmt.toLocaleString() + " sats in your wallet!");
          }
          setClaimProgress({ stage: "✅ Claimed!", pct: 100, active: true });
          stopHaptic();
          try { navigator.vibrate?.([100, 50, 100, 50, 200]); } catch {}
          setTimeout(() => { setClaimProgress({ stage: "", pct: 0, active: false }); setClaimInProgress(false); setLoading(false); onRefresh(); }, 1500);
        } catch (autoRedeemErr) {
          // Auto-redeem failed — fall back to manual tap (notes already in state)
          console.warn("[claim] auto-redeem failed:", autoRedeemErr);
          showToast("E-cash saved. Tap Claim again to retry receiving sats.", "error");
          clearInterval(_claimTimer);
          setClaimProgress({ stage: "", pct: 0, active: false });
          setClaimInProgress(false);
          setClaimRetry(true);
          setLoading(false);
          stopHaptic();
          return;
        }
        // Success path already handled inside try block via setTimeout
        return;
      }

      // ── DEV/SANDBOX MODE: Skip receiveEcash, just confirm on server ──
      if (isDevMode()) {
        try {
          setClaimProgress({ stage: "Claiming escrow...", pct: 30, active: true });
          const claim = await api("/" + e.id + "/claim", { method: "POST" });
          if (claim.error && !String(claim.error).includes("CLAIMED")) throw new Error(claim.error);
        } catch (claimErr) {
          if (!String(claimErr.message || "").includes("CLAIMED") && !String(claimErr.message || "").includes("APPROVED")) throw claimErr;
        }
        setClaimProgress({ stage: "Confirming receipt...", pct: 70, active: true });
        const confirmRes = await api("/" + e.id + "/confirm-ecash-received", { method: "POST" });
        if (confirmRes?.autoRepaymentId) setAutoRepaymentId(confirmRes.autoRepaymentId);
        setClaimProgress({ stage: "✅ Claimed!", pct: 100, active: true });
        stopHaptic();
        try { navigator.vibrate?.([100, 50, 100, 50, 200]); } catch {}
        showToast("Sats claimed! (sandbox mode)");
        setTimeout(() => { setClaimProgress({ stage: "", pct: 0, active: false }); setClaimInProgress(false); onRefresh(); }, 1500);
        setLoading(false);
        setClaimInProgress(false);
        return;
      }
      showToast("E-cash not available in this environment.", "error");
      setLoading(false);
      return;
      /* LIGHTNING PAYOUT CODE REMOVED — see git history for reference */
    } catch (err) { showToast(err.message, "error"); }
    setClaimInProgress(false);
    stopHaptic(); setClaimProgress({ stage: "", pct: 0, active: false });
    setLoading(false);
  };

  // ── Available actions ─────────────────────────────────────────────
  const canLock = status === "FUNDED" && role === (e.lock_role || "seller");
  const hasVoted = e.votes?.voters?.some(v => v.role === role);
  const buyerVoted = e.votes?.voters?.some(v => v.role === "buyer");
  const sellerVoted = e.votes?.voters?.some(v => v.role === "seller");
  const buyerOutcome = e.votes?.voters?.find(v => v.role === "buyer")?.outcome;
  const sellerOutcome = e.votes?.voters?.find(v => v.role === "seller")?.outcome;
  const canBuyerVote = status === "LOCKED" && role === "buyer" && !hasVoted && (!isMarketplace || sellerVoted);
  const canSellerVote = status === "LOCKED" && role === "seller" && !hasVoted && (isMarketplace || buyerVoted);
  const canArbiterVote = status === "LOCKED" && role === "arbiter" && !hasVoted && buyerVoted && sellerVoted && buyerOutcome !== sellerOutcome;
  const lockR = e.lock_role || "seller";
  const releaseWinner = lockR === "seller" ? "buyer" : "seller";
  const refundWinner = lockR;
  const canClaim = (status === "APPROVED" || status === "CLAIMED") && ((e.resolvedOutcome === "release" && role === releaseWinner) || (e.resolvedOutcome === "refund" && role === refundWinner));
  const canReclaimExpired = status === "EXPIRED" && role === (e.lock_role || "seller") && e.lockedAt;

  // Helper to get participant pubkey display
  const getPkDisplay = (participant) => {
    if (!participant) return null;
    if (typeof participant === "object") return participant.isFull ? participant.pubkey : null;
    return truncPk(participant);
  };

  // Determine if a participant slot is actually filled
  const isParticipantJoined = (participant) => {
    if (!participant) return false;
    if (typeof participant === "object") return !!participant.isFull;
    return typeof participant === "string" && participant.length > 0;
  };

  return (
    <div style={S.container}>
      <div style={S.viewHeader}>
        <button style={S.iconBtn} onClick={() => { if (claimInProgress || pendingNotes) { showToast("⚠️ Claim in progress — complete it first!", "error"); return; } onBack(); }}><I.Back /></button>
        <h2 style={S.viewTitle}>Trade #{e.id}</h2>
        <button style={S.iconBtn} onClick={onRefresh}><I.Refresh /></button>
      </div>

      {/* Category badge removed — escrow view is purely for voting */}

      <div style={{ paddingBottom: 140 }}>
        {/* ═══ THE VAULT ═══ */}
        <Vault status={status} amountMsats={e.amountMsats} showBurst={showBurst} resolvedOutcome={e.resolvedOutcome} />

        {/* ═══ POST-TRADE CTA — only after full completion (COMPLETED), not during claim ═══ */}
        {status === "COMPLETED" && onSwitchToMarketplace && e.description?.startsWith("Marketplace:") && (
          <div style={{ margin: "0 0 16px", padding: "16px 20px", borderRadius: 16, background: "linear-gradient(135deg, rgba(245,158,11,0.1), rgba(245,158,11,0.04))", border: "1px solid rgba(245,158,11,0.25)", textAlign: "center" }}>
            <div style={{ fontSize: 24, marginBottom: 6 }}>🎉</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#f8fafc", marginBottom: 4 }}>Trade complete!</div>
            <div style={{ fontSize: 13, color: "#94a3b8", marginBottom: 14, lineHeight: 1.5 }}>Don't forget to rate your trade partner — it helps the community.</div>
            <button onClick={onBack} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, width: "100%", padding: "14px 0", borderRadius: 12, border: "none", cursor: "pointer", background: "linear-gradient(135deg, #f59e0b, #d97706)", color: "#0c0f17", fontSize: 15, fontWeight: 700, boxShadow: "0 4px 16px rgba(245,158,11,0.25)" }}>
              ⭐ Back to Orders — Rate Now
            </button>
          </div>
        )}
        {status === "COMPLETED" && !e.description?.startsWith("Marketplace:") && (
          <div style={{ margin: "0 0 16px", padding: "16px 20px", borderRadius: 16, background: autoRepaymentId ? "linear-gradient(135deg, rgba(245,158,11,0.12), rgba(245,158,11,0.04))" : "rgba(16,185,129,0.08)", border: autoRepaymentId ? "2px solid rgba(245,158,11,0.4)" : "1px solid rgba(16,185,129,0.2)", textAlign: "center" }}>
            <div style={{ fontSize: 28, marginBottom: 6 }}>{autoRepaymentId ? "✅💰" : "🎉"}</div>
            <div style={{ fontSize: 16, fontWeight: 800, color: autoRepaymentId ? "#f59e0b" : "#10b981", marginBottom: 6 }}>
              {autoRepaymentId ? "Loan Disbursed — Repayment Created" : isLending ? "✅ Loan Disbursed Successfully" : "Trade complete!"}
            </div>
            {autoRepaymentId && (
              <div style={{ fontSize: 12, color: "#cbd5e1", lineHeight: 1.6, marginBottom: 12 }}>
                A repayment escrow has been automatically created. The borrower must lock their repayment sats.
              </div>
            )}
            {autoRepaymentId && onSwitchToMarketplace && (
              <button onClick={() => onSwitchToMarketplace(autoRepaymentId)} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, width: "100%", padding: "14px 0", marginBottom: 8, borderRadius: 12, border: "none", cursor: "pointer", background: "linear-gradient(135deg, #f59e0b, #d97706)", color: "#0c0f17", fontSize: 15, fontWeight: 700, boxShadow: "0 4px 16px rgba(245,158,11,0.25)" }}>
                💰 Open Repayment Escrow
              </button>
            )}
            <button onClick={onBack} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, width: "100%", padding: "14px 0", borderRadius: 12, border: "none", cursor: "pointer", background: autoRepaymentId ? "#1e293b" : "linear-gradient(135deg, #10b981, #059669)", color: autoRepaymentId ? "#94a3b8" : "#fff", fontSize: 14, fontWeight: 600 }}>
              {autoRepaymentId || isLending ? "← Back to Orders" : "⭐ Back to Orders — Rate Now"}
            </button>
          </div>
        )}

        {/* ── Trade Chat — only when escrow is active ── */}
        {(status === "LOCKED" || status === "FUNDED" || status === "APPROVED" || status === "CLAIMED") && e.participants && (
          <TradeChat escrowId={e.id} pubkey={pubkey} participants={e.participants} />
        )}

        {/* ── Keet P2P Chat — community trade room ── */}
        {(status === "LOCKED" || status === "FUNDED" || status === "APPROVED" || status === "CLAIMED") && (
          <a href="pear://keet/nfoid1mu18n1fyx5mg83cx3ucb5tro43w46eujgpzj5hmp87kfqoy7s6drnu4bijak3pjqouhm78ffmhkm8f3jq1kjeswbttmj54qsup57nhs897o1tdpddpt81tyk8ujs739huwg5q7w38bp5djnsxz7w7iqyedsyrto6njajkxxm91jxbjpn8pukbho"
            target="_blank" rel="noopener noreferrer"
            style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, margin: "8px 16px", padding: "12px 16px", borderRadius: 12, background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.2)", textDecoration: "none", cursor: "pointer" }}>
            <span style={{ fontSize: 16 }}>{"💬"}</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#10b981" }}>Chat on Keet</span>
            <span style={{ fontSize: 9, color: "#64748b", padding: "2px 6px", borderRadius: 4, background: "rgba(100,116,139,0.1)" }}>P2P</span>
          </a>
        )}

        {/* ── Contextual status message per subdomain ── */}
        {status === "LOCKED" && subdomain && subdomain !== "escrow" && subdomain !== "marketplace" && (
          <div style={{ textAlign: "center", padding: "6px 14px", marginBottom: 8, fontSize: 12, fontWeight: 600, color: subdomain === "p2p" ? "#f59e0b" : subdomain === "market" ? "#a78bfa" : "#10b981" }}>
            {labels.lockedStatus}
          </div>
        )}

        {/* ── Participants (animated SVG nodes) ──────────────────── */}
        <div style={{ display: "flex", justifyContent: "center", alignItems: "flex-start", gap: 0, padding: "0 8px 16px" }}>
          <ParticipantNode label="Seller" IconComp={SvgSeller} pkDisplay={getPkDisplay(e.participants?.seller)} joined={isParticipantJoined(e.participants?.seller)} voted={!!e.votes?.voters?.find(v => v.role === "seller")} voteOutcome={sellerOutcome} resolvedOutcome={e.resolvedOutcome} isDispute={buyerVoted && sellerVoted && buyerOutcome !== sellerOutcome} isYou={role === "seller"} delay={0} />
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, paddingTop: 20, opacity: isParticipantJoined(e.participants?.buyer) ? 0.6 : 0.08, transition: "opacity 0.8s ease" }}>
            <div style={{ width: 28, height: 1, background: status === "LOCKED" || status === "APPROVED" || status === "CLAIMED" ? `linear-gradient(90deg, ${status === "CLAIMED" || status === "COMPLETED" ? "#10b981" : "#f59e0b"}, transparent)` : isParticipantJoined(e.participants?.buyer) ? "#334155" : "#111827", transition: "background 0.5s ease" }} />
            <div style={{ fontSize: 8, color: isParticipantJoined(e.participants?.buyer) && isParticipantJoined(e.participants?.arbiter) ? "#475569" : "#1a1e2a", letterSpacing: 1, transition: "color 0.5s ease" }}>2-of-3</div>
            <div style={{ width: 28, height: 1, background: status === "LOCKED" || status === "APPROVED" || status === "CLAIMED" ? `linear-gradient(270deg, ${status === "CLAIMED" || status === "COMPLETED" ? "#10b981" : "#f59e0b"}, transparent)` : isParticipantJoined(e.participants?.buyer) ? "#334155" : "#111827", transition: "background 0.5s ease" }} />
          </div>
          <ParticipantNode label="Buyer" IconComp={SvgBuyer} pkDisplay={getPkDisplay(e.participants?.buyer)} joined={isParticipantJoined(e.participants?.buyer)} voted={!!e.votes?.voters?.find(v => v.role === "buyer")} voteOutcome={buyerOutcome} resolvedOutcome={e.resolvedOutcome} isDispute={buyerVoted && sellerVoted && buyerOutcome !== sellerOutcome} isYou={role === "buyer"} delay={150} />
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, paddingTop: 20, opacity: isParticipantJoined(e.participants?.arbiter) ? 0.4 : 0.05, transition: "opacity 0.8s ease" }}>
            <div style={{ width: 16, height: 1, background: "#1e293b" }} />
          </div>
          <ParticipantNode label="Arbiter" IconComp={SvgArbiter} pkDisplay={getPkDisplay(e.participants?.arbiter)} joined={isParticipantJoined(e.participants?.arbiter)} voted={!!e.votes?.voters?.find(v => v.role === "arbiter")} voteOutcome={e.votes?.voters?.find(v => v.role === "arbiter")?.outcome} resolvedOutcome={e.resolvedOutcome} isDispute={buyerVoted && sellerVoted && buyerOutcome !== sellerOutcome} isArbiter isYou={role === "arbiter"} delay={300} />
        </div>

        {/* ── Vote tally + inline seller/arbiter actions ──────────── */}
        {(status === "LOCKED" || status === "APPROVED" || status === "CLAIMED") && e.votes && (
          <div style={{ padding: "0 0 12px", animation: "slideUp 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)" }}>
            <div style={{ background: "#111827", border: "1px solid #1e293b", borderRadius: 14, padding: "14px", display: "flex", flexDirection: "column", gap: 0 }}>
              <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                <div style={{ flex: 1, textAlign: "center" }}>
                  <div style={{ fontSize: 28, fontWeight: 900, color: "#10b981", lineHeight: 1 }}>{e.votes.release || 0}</div>
                  <div style={{ fontSize: 9, color: "#475569", marginTop: 4, letterSpacing: 1, textTransform: "uppercase" }}>Release</div>
                </div>
                <div style={{ width: 1, height: 36, background: "#1e293b" }} />
                <div style={{ flex: 1, textAlign: "center" }}>
                  <div style={{ fontSize: 28, fontWeight: 900, color: "#f59e0b", lineHeight: 1 }}>{e.votes.refund || 0}</div>
                  <div style={{ fontSize: 9, color: "#475569", marginTop: 4, letterSpacing: 1, textTransform: "uppercase" }}>Refund</div>
                </div>
                {e.resolvedOutcome && (
                  <>
                    <div style={{ width: 1, height: 36, background: "#1e293b" }} />
                    <div style={{ flex: 1.5, textAlign: "center", animation: "popIn 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)" }}>
                      <div style={{ fontSize: 12, fontWeight: 800, color: e.resolvedOutcome === "release" ? "#10b981" : "#f59e0b" }}>{e.resolvedOutcome === "release" ? `${t("release").toUpperCase()} ✓` : `${t("refund").toUpperCase()} ↩`}</div>
                      <div style={{ fontSize: 9, color: "#64748b", marginTop: 2 }}>{e.resolvedOutcome === "release" ? t("resolvedRelease") : t("resolvedRefund")}</div>
                    </div>
                  </>
                )}
              </div>

              {/* ── Seller vote (inline under tally) ──────────────── */}
              {canSellerVote && (
                <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid #1e293b" }}>
                  {confirmVote ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      <div style={{ textAlign: "center", padding: "8px 12px", background: confirmVote === "release" ? "rgba(5,150,105,0.1)" : "rgba(180,83,9,0.1)", border: `1px solid ${confirmVote === "release" ? "rgba(5,150,105,0.3)" : "rgba(180,83,9,0.3)"}`, borderRadius: 10, fontSize: 13, fontWeight: 700, color: confirmVote === "release" ? "#10b981" : "#f59e0b" }}>
                        {confirmVote === "release"
                          ? (isP2PTrade ? "Confirm: Buyer sent fiat? Release ₿ sats to them." : isLending ? "Confirm: Disburse loan to the borrower? The repayment escrow will be created next." : "Confirm: Release ₿ sats to buyer?")
                          : `Confirm: Dispute — refund to ${role === "seller" ? t("toMe") : t("seller")}?`}
                      </div>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button style={{ ...S.actionBtn, flex: 1, background: "#1e293b", color: "#94a3b8" }} onClick={cancelConfirm}>Cancel</button>
                        <button style={{ ...S.actionBtn, flex: 1, background: confirmVote === "release" ? "linear-gradient(135deg, #059669, #047857)" : "linear-gradient(135deg, #b45309, #92400e)" }} onClick={() => handleVote(confirmVote)} disabled={loading}>{loading ? t("voting") : "Yes, I'm sure"}</button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: "flex", gap: 8 }}>
                      <button style={{ ...S.actionBtn, flex: 1, background: "linear-gradient(135deg, #059669, #047857)" }} onClick={() => handleVote("release")} disabled={loading}>{labels.releaseBtn}</button>
                      <button style={{ ...S.actionBtn, flex: 1, background: "linear-gradient(135deg, #b45309, #92400e)" }} onClick={() => handleVote("refund")} disabled={loading}>{labels.refundBtn}</button>
                    </div>
                  )}
                </div>
              )}

              {/* ── Arbiter vote (inline under tally) ─────────────── */}
              {canArbiterVote && (
                <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid #1e293b" }}>
                  {confirmVote ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      <div style={{ textAlign: "center", padding: "10px 12px", background: confirmVote === "release" ? "rgba(5,150,105,0.1)" : "rgba(180,83,9,0.1)", border: `1px solid ${confirmVote === "release" ? "rgba(5,150,105,0.3)" : "rgba(180,83,9,0.3)"}`, borderRadius: 10, fontSize: 13, fontWeight: 700, color: confirmVote === "release" ? "#10b981" : "#f59e0b", lineHeight: 1.5 }}>
                        {confirmVote === "release" ? "⚖️ As arbiter, you are releasing ₿ sats to the BUYER. This is final." : "⚖️ As arbiter, you are refunding ₿ sats to the SELLER. This is final."}
                      </div>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button style={{ ...S.actionBtn, flex: 1, background: "#1e293b", color: "#94a3b8" }} onClick={cancelConfirm}>Cancel</button>
                        <button style={{ ...S.actionBtn, flex: 1, background: confirmVote === "release" ? "linear-gradient(135deg, #059669, #047857)" : "linear-gradient(135deg, #b45309, #92400e)" }} onClick={() => handleVote(confirmVote)} disabled={loading}>{loading ? t("voting") : "Confirm vote"}</button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: "flex", gap: 8 }}>
                      <button style={{ ...S.actionBtn, flex: 1, background: "linear-gradient(135deg, #059669, #047857)" }} onClick={() => handleVote("release")} disabled={loading}>{labels.releaseBtn}</button>
                      <button style={{ ...S.actionBtn, flex: 1, background: "linear-gradient(135deg, #b45309, #92400e)" }} onClick={() => handleVote("refund")} disabled={loading}>{labels.refundBtn}</button>
                    </div>
                  )}
                </div>
              )}

              {/* ── Seller/arbiter wait banners (inline under tally) ─ */}
              {status === "LOCKED" && role === "seller" && !buyerVoted && !hasVoted && !isMarketplace && (
                <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid #1e293b", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, fontSize: 12, color: "#64748b" }}><I.Clock /> {t("waitBuyerVote")}</div>
              )}
              {status === "LOCKED" && role === "seller" && hasVoted && !buyerVoted && isMarketplace && (
                <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid #1e293b", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, fontSize: 12, color: "#64748b" }}><I.Clock /> Waiting for buyer to confirm receipt</div>
              )}
              {status === "LOCKED" && role === "seller" && hasVoted && buyerVoted && (
                <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid #1e293b", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, fontSize: 12, color: "#64748b" }}><I.Clock /> {t("waitResolution")}</div>
              )}
              {status === "LOCKED" && role === "arbiter" && (!buyerVoted || !sellerVoted) && (
                <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid #1e293b", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, fontSize: 12, color: "#64748b" }}><I.Clock /> {t("waitBothVote")}</div>
              )}
              {status === "LOCKED" && role === "arbiter" && buyerVoted && sellerVoted && buyerOutcome === sellerOutcome && (
                <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid #1e293b", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, fontSize: 12, color: "#10b981" }}><I.Check /> {t("noDispute")}</div>
              )}
            </div>
          </div>
        )}

        {/* ═══ PRIMARY ACTION — right after participants/tally ═══ */}
        {canBuyerVote && !confirmVote && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, margin: "4px 0 12px" }}>
            <button style={{ ...S.actionBtn, background: "linear-gradient(135deg, #059669, #047857)", boxShadow: "0 4px 24px rgba(5,150,105,0.3)", fontSize: 16, padding: "16px 20px" }} onClick={() => setConfirmVote("release")} disabled={loading}>
              {loading ? t("voting") : isP2PTrade ? "✓ I sent the fiat payment" : isRepayment ? "✓ I have repaid" : isLending ? "✓ I accept the loan" : isBillPay ? "✓ I sent the fiat payment" : "✓ I received what I paid for"}
            </button>
            {!isP2PTrade && <button style={{ ...S.actionBtn, background: "linear-gradient(135deg, #b45309, #92400e)", fontSize: 13, padding: "12px 16px" }} onClick={() => setConfirmVote("refund")} disabled={loading}>
              {isRepayment ? "⚠ Dispute repayment" : isLending ? "⚠ Dispute terms" : "⚠ Dispute — incorrect"}
            </button>}
          </div>
        )}
        {canBuyerVote && confirmVote === "refund" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, margin: "0 0 12px" }}>
            <div style={{ textAlign: "center", padding: "12px 14px", background: "rgba(180,83,9,0.1)", border: "1px solid rgba(180,83,9,0.3)", borderRadius: 10, fontSize: 14, fontWeight: 700, color: "#f59e0b", lineHeight: 1.5 }}>
              {isP2PTrade ? "Open a dispute? The arbiter will review and decide." : isLending ? "Dispute this loan? The arbiter will review." : isBillPay ? "Dispute this bill payment? The arbiter will review." : "Open a dispute? The arbiter will review your case. Use the chat to explain what happened."}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button style={{ ...S.actionBtn, flex: 1, background: "#1e293b", color: "#94a3b8", fontSize: 15, padding: "14px" }} onClick={cancelConfirm}>Cancel</button>
              <button style={{ ...S.actionBtn, flex: 1, background: "linear-gradient(135deg, #b45309, #92400e)", fontSize: 15, padding: "14px" }} onClick={() => handleVote("refund")} disabled={loading}>{loading ? t("voting") : "Yes, open dispute"}</button>
            </div>
          </div>
        )}
        {canBuyerVote && confirmVote === "release" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, margin: "0 0 12px" }}>
            <div style={{ textAlign: "center", padding: "12px 14px", background: "rgba(5,150,105,0.1)", border: "1px solid rgba(5,150,105,0.3)", borderRadius: 10, fontSize: 14, fontWeight: 700, color: "#10b981" }}>
              {isP2PTrade ? "Confirm: You sent fiat? ₿ Sats will release to you." : isRepayment ? "Confirm: You have repaid the loan in full?" : isLending ? "Confirm: Accept this loan and begin the repayment clock?" : isBillPay ? "Confirm: You sent the fiat? The bill poster will verify and release sats to you." : "Confirm: Trade complete? Sats will be released."}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button style={{ ...S.actionBtn, flex: 1, background: "#1e293b", color: "#94a3b8", fontSize: 15, padding: "14px" }} onClick={cancelConfirm}>Cancel</button>
              <button style={{ ...S.actionBtn, flex: 1, background: "linear-gradient(135deg, #059669, #047857)", fontSize: 15, padding: "14px" }} onClick={() => handleVote("release")} disabled={loading}>{loading ? t("voting") : "Yes, confirm ⚡"}</button>
            </div>
          </div>
        )}
        {claimProgress.active && (
          <div style={{ marginBottom: 12, padding: "12px 16px", borderRadius: 12, background: "rgba(16,185,129,0.06)", border: "1px solid rgba(16,185,129,0.15)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, fontSize: 12 }}>
              <span style={{ color: "#10b981", fontWeight: 600 }}>{claimProgress.stage}</span>
              <span style={{ color: "#64748b" }}>{claimProgress.pct}%</span>
            </div>
            <div style={{ height: 6, borderRadius: 3, background: "#1e293b", overflow: "hidden" }}>
              <div style={{ height: "100%", borderRadius: 3, background: "linear-gradient(90deg, #10b981, #059669)", width: claimProgress.pct + "%", transition: "width 0.5s ease" }} />
            </div>
          </div>
        )}
        {(canClaim || canReclaimExpired) && !claimRetry && (
          <button className="claim-btn" style={{ ...S.actionBtn, background: "linear-gradient(135deg, #10b981, #059669)", boxShadow: "0 4px 24px rgba(16,185,129,0.3)", margin: "4px 0 12px", animation: "pulseGreenBig 2s ease infinite", fontSize: 16, padding: "16px 20px" }} onClick={() => { try { navigator.vibrate?.([50, 30, 50]); } catch {} handleClaim(); }} disabled={loading}>
            {loading ? t("claiming") : pendingNotes ? (payoutInfo?.feeMsats > 0 ? "🔐 Redeem " + Math.floor((payoutInfo?.winnerMsats || e.amountMsats) / 1000).toLocaleString() + " sats" : "🔐 Redeem E-cash Now") : "⚡ Receive " + fmtSats(e.amountMsats) + " sats"}
          </button>
        )}
        {claimRetry && (
          <div style={{ margin: "4px 0 12px", display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ textAlign: "center", padding: "10px 14px", background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.2)", borderRadius: 10, fontSize: 13, color: "#fbbf24", lineHeight: 1.5 }}>
              Your ₿ sats are ready! Tap below and approve the invoice in Fedi to receive them.
            </div>
            <button className="claim-btn" style={{ ...S.actionBtn, background: "linear-gradient(135deg, #10b981, #059669)", boxShadow: "0 4px 24px rgba(16,185,129,0.3)", animation: "pulseGreenBig 2s ease infinite", fontSize: 16, padding: "16px 20px" }} onClick={() => { try { navigator.vibrate?.([50, 30, 50]); } catch {} setClaimRetry(false); handleClaim(); }} disabled={loading}>
              {loading ? t("claiming") : pendingNotes ? (payoutInfo?.feeMsats > 0 ? "🔐 Redeem " + Math.floor((payoutInfo?.winnerMsats || e.amountMsats) / 1000).toLocaleString() + " sats" : "🔐 Redeem E-cash Now") : "⚡ Receive " + fmtSats(e.amountMsats) + " sats"}
            </button>
          </div>
        )}
        {/* ── E-cash lock (primary) ── */}
        {fedMismatch && (
          <div style={{ padding: "14px 16px", marginBottom: 12, borderRadius: 12, background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.25)", animation: "slideUp 0.3s ease-out" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 20 }}>{"🏛️"}</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#f59e0b" }}>Wrong Federation Selected</span>
            </div>
            <div style={{ fontSize: 12, color: "#cbd5e1", lineHeight: 1.6, marginBottom: 10 }}>
              Your sats have been safely returned to your wallet. This trade requires a specific federation. Please tap Lock again and choose the correct federation from the picker.
            </div>
            <button onClick={() => setFedMismatch(null)} style={{ background: "transparent", border: "1px solid rgba(245,158,11,0.3)", borderRadius: 8, padding: "6px 14px", color: "#f59e0b", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
              Dismiss
            </button>
          </div>
        )}
        {lockProgress.active && (
          <div style={{ marginBottom: 12, padding: "12px 16px", borderRadius: 12, background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.15)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, fontSize: 12 }}>
              <span style={{ color: "#f59e0b", fontWeight: 600 }}>{lockProgress.stage}</span>
              <span style={{ color: "#64748b" }}>{lockProgress.pct}%</span>
            </div>
            <div style={{ height: 6, borderRadius: 3, background: "#1e293b", overflow: "hidden" }}>
              <div style={{ height: "100%", borderRadius: 3, background: "linear-gradient(90deg, #f59e0b, #d97706)", width: lockProgress.pct + "%", transition: "width 0.5s ease" }} />
            </div>
          </div>
        )}
        {canLock && (
          <button className="lock-btn" style={{ ...S.actionBtn, background: "linear-gradient(135deg, #f59e0b, #d97706)", boxShadow: "0 4px 24px rgba(245,158,11,0.3)", animation: "pulseAmberBig 2s ease infinite", fontSize: 16, padding: "16px 20px", marginBottom: 8 }} onClick={() => { try { navigator.vibrate?.([50, 30, 50]); } catch {} (isDevMode() ? handleLockFetch : handleLockEcash)(); }} disabled={locking}>
            {locking ? "Locking e-cash…" : labels.lockBtn}
          </button>
        )}
        {/* ── Lightning lock (commented out — kept for future reference) ──
        {canLock && lockStep === "idle" && (
          <button style={{ ...S.actionBtn, background: "linear-gradient(135deg, #f59e0b, #d97706)", boxShadow: "0 4px 24px rgba(245,158,11,0.3)", fontSize: 16, padding: "16px 20px" }} onClick={handleLockFetch} disabled={locking}>
            🔒 {t("lockSats", { amount: fmtSats(e.amountMsats) })}
          </button>
        )}
        {canLock && lockStep === "fetching" && (
          <button style={{ ...S.actionBtn, background: "#1e293b", margin: "4px 0 12px" }} disabled>
            {t("locking")}
          </button>
        )}
        {canLock && (lockStep === "ready" || lockStep === "paying") && (
          <button style={{ ...S.actionBtn, background: "linear-gradient(135deg, #10b981, #059669)", boxShadow: "0 4px 24px rgba(16,185,129,0.3)", margin: "4px 0 12px", fontSize: 16, padding: "16px 20px" }} onClick={handleLockPay} disabled={lockStep === "paying"}>
            {lockStep === "paying" ? t("locking") : "⚡ " + t("confirmInFedi")}
          </button>
        )}
        ── end Lightning lock */}

        {/* Role banner removed — YOU tag on participants is sufficient */}

        {/* Context messaging + terms/description moved to Order Detail view */}

        {/* Share prompt — visible until all 3 participants have joined */}
        {(!isParticipantJoined(e.participants?.buyer) || !isParticipantJoined(e.participants?.arbiter)) ? (
          <div style={{ padding: "14px 16px", background: "rgba(139,92,246,0.08)", border: "1px solid rgba(139,92,246,0.15)", borderRadius: 12, marginBottom: 14, animation: "obFadeUp 0.4s ease-out", textAlign: "center" }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#a78bfa", marginBottom: 8, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
              🔗 {t("shareEscrowTitle")}
            </div>
            <button style={{ ...S.copyRow, width: "100%", marginBottom: 10, justifyContent: "center" }} onClick={() => copy(e.id, t("escrowId"))}>
              <span style={S.mono}>{e.id}</span><I.Copy />
            </button>
            <div style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.6, marginBottom: 10 }}>
              {t("shareEscrowDesc")}
            </div>

          </div>
        ) : (
          <div style={{ ...S.section, textAlign: "center" }}>
            <div style={S.sectionLabel}>{t("escrowId")}</div>
            <button style={{ ...S.copyRow, justifyContent: "center" }} onClick={() => copy(e.id, t("escrowId"))}>
              <span style={S.mono}>{e.id}</span><I.Copy />
            </button>
          </div>
        )}

        {/* Completion celebration */}
        {(status === "COMPLETED" || (status === "CLAIMED" && e.resolvedOutcome)) && (
          <div style={{ textAlign: "center", padding: "12px 0", animation: "celebrateBounce 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)" }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: "#10b981" }}>{t("tradeComplete")}</div>
            <div style={{ fontSize: 11, color: "#475569", marginTop: 4 }}>{t("satsDelivered", { amount: fmtSats(e.amountMsats) })}</div>
          </div>
        )}

      </div>

      {/* ═══ STATUS BAR ═══ */}
      <div style={{ padding: "12px 0 20px", textAlign: "center" }}>
        {status === "LOCKED" && role === "buyer" && hasVoted && !sellerVoted && !isMarketplace && <div style={S.waitBanner}><I.Clock /> {t("waitSeller")}</div>}
        {status === "LOCKED" && role === "buyer" && hasVoted && sellerVoted && buyerOutcome !== sellerOutcome && <div style={{ ...S.waitBanner, color: "#f59e0b" }}>⚖️ {t("waitArbiter")}</div>}
        {status === "LOCKED" && role === "seller" && hasVoted && !buyerVoted && <div style={S.waitBanner}><I.Clock /> {t("waitBuyerVote")}</div>}
        {status === "LOCKED" && role === "seller" && hasVoted && buyerVoted && buyerOutcome !== sellerOutcome && <div style={{ ...S.waitBanner, color: "#f59e0b" }}>⚖️ {t("waitArbiter")}</div>}
        {status === "FUNDED" && role !== "seller" && <div style={S.waitBanner}>{t("waitSellerLock")}</div>}
        {status === "CREATED" && <div style={S.waitBanner}><I.Clock /> {t("waitParties")}</div>}
        {status === "COMPLETED" && <div style={{ ...S.waitBanner, color: "#059669" }}><I.Check /> {t("tradeCompleteBanner")}</div>}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// STYLES
// ═══════════════════════════════════════════════════════════════════════

const S = {
  root: { background: "#0c0f17", color: "#e2e8f0", flex: 1, display: "flex", flexDirection: "column", minHeight: 0, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', fontSize: 14, lineHeight: 1.5 },
  container: { width: "100%", maxWidth: 480, margin: "0 auto", padding: "0 16px 20px", overflowX: "hidden", flex: 1, overflowY: "auto" },
  listHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "20px 0 16px" },
  title: { fontSize: 24, fontWeight: 700, color: "#f8fafc", margin: 0, letterSpacing: -0.5 },
  subtitle: { fontSize: 12, color: "#64748b", margin: "2px 0 0", fontFamily: "monospace" },
  emptyState: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "60px 20px", textAlign: "center" },
  escrowCard: { background: "linear-gradient(145deg, #111827, #0f1320)", border: "1px solid #1e293b", borderRadius: 14, padding: "14px 16px", textAlign: "left", color: "#e2e8f0", width: "100%", transition: "all 0.2s ease" },
  cardAmount: { fontSize: 17, fontWeight: 600, color: "#f8fafc" },
  cardDesc: { fontSize: 12, color: "#94a3b8", margin: "6px 0 0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  cardMeta: { display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 },
  cardRole: { fontSize: 11, fontWeight: 600, color: "#8b5cf6", textTransform: "uppercase", letterSpacing: 0.5 },
  cardExpiry: { display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, color: "#64748b" },
  viewHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 0 12px" },
  viewTitle: { fontSize: 17, fontWeight: 600, color: "#f8fafc", margin: 0 },
  iconBtn: { background: "rgba(30,41,59,0.5)", color: "#cbd5e1", padding: 9, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid rgba(51,65,85,0.3)", cursor: "pointer", WebkitTapHighlightColor: "transparent", outline: "none", minWidth: 36, minHeight: 36 },
  primaryBtn: { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, background: "linear-gradient(135deg, #f59e0b, #d97706)", color: "#0c0f17", fontWeight: 700, fontSize: 14, padding: "12px 20px", borderRadius: 12, flex: 1, boxShadow: "0 2px 12px rgba(245,158,11,0.2)", transition: "all 0.2s ease" },
  secondaryBtn: { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, background: "linear-gradient(145deg, #1e293b, #1a2332)", color: "#e2e8f0", fontWeight: 600, fontSize: 14, padding: "12px 20px", borderRadius: 12, flex: 1, border: "1px solid #334155", transition: "all 0.2s ease" },
  roleBtn: { flex: 1, padding: "12px 16px", borderRadius: 10, background: "#111827", color: "#94a3b8", fontSize: 14, fontWeight: 500, border: "1px solid #1e293b", textAlign: "center" },
  roleBtnActive: { background: "#1e293b", color: "#f8fafc", borderColor: "#f59e0b" },
  formGroup: { marginBottom: 16 },
  label: { display: "block", fontSize: 12, fontWeight: 600, color: "#94a3b8", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 },
  input: { width: "100%", padding: "12px 14px", borderRadius: 10, border: "1px solid #1e293b", background: "#111827", color: "#f8fafc", fontSize: 14, outline: "none" },
  hint: { fontSize: 11, color: "#475569", marginTop: 4 },
  disclaimer: { fontSize: 12, color: "#64748b", marginTop: 16, padding: "12px", background: "#111827", borderRadius: 10, lineHeight: 1.6 },
  roleBanner: { display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "10px 14px", background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.15)", borderRadius: 10, fontSize: 13, marginBottom: 12 },
  section: { marginBottom: 14 },
  sectionLabel: { fontSize: 11, fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 },
  sectionValue: { fontSize: 13, color: "#cbd5e1", lineHeight: 1.6 },
  copyRow: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, width: "100%", padding: "10px 14px", background: "#111827", border: "1px solid #1e293b", borderRadius: 8, color: "#94a3b8" },
  mono: { fontFamily: "monospace", fontSize: 12, color: "#64748b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 },
  actionBar: { position: "sticky", bottom: 0, left: 0, right: 0, padding: "12px 0 20px", background: "linear-gradient(transparent, #0c0f17 20%)" },
  actionBtn: { display: "flex", alignItems: "center", justifyContent: "center", gap: 8, width: "100%", padding: "16px 0", borderRadius: 14, background: "#f59e0b", color: "#fff", fontSize: 15, fontWeight: 800, letterSpacing: -0.3, border: "none", cursor: "pointer", WebkitTapHighlightColor: "transparent", outline: "none" },
  waitBanner: { display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "14px 0", color: "#64748b", fontSize: 13, fontWeight: 500 },
  demoBar: { display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: "10px 14px 12px", background: "linear-gradient(180deg, #1a1428, #12101d)", borderBottom: "1px solid #2d264080", position: "sticky", top: 0, zIndex: 100, flexShrink: 0 },
  demoLabel: { fontSize: 12, fontWeight: 800, color: "#f59e0b", letterSpacing: 1, textTransform: "uppercase" },
  demoRoleBtn: { padding: "6px 12px", borderRadius: 8, background: "#111827", color: "#64748b", fontSize: 12, fontWeight: 600, border: "1px solid #1e293b", textTransform: "capitalize", display: "inline-flex", alignItems: "center", gap: 4, transition: "all 0.2s ease" },
  demoRoleBtnActive: { background: "rgba(245,158,11,0.12)", color: "#fbbf24", borderColor: "rgba(245,158,11,0.3)", boxShadow: "0 0 12px rgba(245,158,11,0.1)" },
  demoChatLink: { display: "inline-flex", alignItems: "center", gap: 4, padding: "6px 12px", borderRadius: 8, background: "rgba(139,92,246,0.1)", color: "#a78bfa", fontSize: 12, fontWeight: 600, border: "1px solid rgba(139,92,246,0.18)", textDecoration: "none", whiteSpace: "nowrap", cursor: "pointer", transition: "all 0.2s ease" },
};
