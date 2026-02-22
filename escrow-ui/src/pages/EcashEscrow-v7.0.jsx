import { useState, useEffect, useCallback, useRef } from "react";

// ═══════════════════════════════════════════════════════════════════════
// Fedi Mini-App: E-Cash Escrow v7.0
// WebLN lock/claim • NIP-98 Nostr auth • Fedimint-powered
// Now with animated vault visualization + motion design
// ═══════════════════════════════════════════════════════════════════════

const API = "/api/ecash-escrows";

// ── Nostr / NIP-98 Auth ─────────────────────────────────────────────

async function getNostrPubkey() {
  if (!window.nostr) return null;
  try { return await window.nostr.getPublicKey(); }
  catch { return null; }
}

async function makeNip98Header(url, method) {
  if (!window.nostr && !_devPubkey) return null;
  if (_devPubkey) return null;
  const event = {
    kind: 27235,
    created_at: Math.floor(Date.now() / 1000),
    tags: [["u", url], ["method", method]],
    content: "",
  };
  try {
    const signed = await window.nostr.signEvent(event);
    return "Nostr " + btoa(JSON.stringify(signed));
  } catch { return null; }
}

// ── Dev identity management ─────────────────────────────────────────

const DEV_IDENTITIES = {
  seller:  "aa".repeat(32),
  buyer:   "bb".repeat(32),
  arbiter: "cc".repeat(32),
};

function isDevMode() { return !!_devPubkey; }

let _devPubkey = null;

async function api(path, opts = {}) {
  const method = opts.method || "GET";
  const url = `${location.origin}${API}${path}`;
  const headers = { "Content-Type": "application/json" };
  const nip98 = await makeNip98Header(url, method);
  if (nip98) headers["Authorization"] = nip98;
  else if (_devPubkey) headers["X-Dev-Pubkey"] = _devPubkey;
  const res = await fetch(url, { ...opts, headers });
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
  CREATED:  { color: "#64748b", bg: "rgba(100,116,139,0.12)", label: "Waiting for parties" },
  FUNDED:   { color: "#8b5cf6", bg: "rgba(139,92,246,0.12)", label: "Ready to lock" },
  LOCKED:   { color: "#f59e0b", bg: "rgba(245,158,11,0.12)", label: "Funds locked" },
  APPROVED: { color: "#10b981", bg: "rgba(16,185,129,0.12)", label: "Resolved" },
  CLAIMED:  { color: "#10b981", bg: "rgba(16,185,129,0.12)", label: "Claimed" },
  COMPLETED:{ color: "#059669", bg: "rgba(5,150,105,0.12)", label: "Complete" },
  EXPIRED:  { color: "#ef4444", bg: "rgba(239,68,68,0.12)", label: "Expired" },
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
      {c.label}
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

function ParticipantNode({ label, IconComp, pkDisplay, joined, voted, voteOutcome, delay = 0 }) {
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

  // Color logic: unjoined → dim | just joined → blue glow | joined → neutral | voted → green/amber
  const ringColor = voted
    ? (voteOutcome === "release" ? "#10b981" : "#f59e0b")
    : justJoined ? "#60a5fa"
    : joined ? "#475569"
    : "#1e293b";

  const glowColor = voted
    ? (voteOutcome === "release" ? "rgba(16,185,129,0.35)" : "rgba(245,158,11,0.35)")
    : justJoined ? "rgba(96,165,250,0.4)"
    : "none";

  const iconColor = voted
    ? (voteOutcome === "release" ? "#6ee7b7" : "#fcd34d")
    : joined ? "#cbd5e1"
    : "#1e293b";

  const labelColor = voted
    ? (voteOutcome === "release" ? "#6ee7b7" : "#fcd34d")
    : justJoined ? "#93c5fd"
    : joined ? "#94a3b8"
    : "#1e293b";

  const shadowStyle = voted
    ? `0 0 20px ${glowColor}, inset 0 0 10px ${glowColor}`
    : justJoined
    ? "0 0 28px rgba(96,165,250,0.45), 0 0 8px rgba(96,165,250,0.25), inset 0 0 12px rgba(96,165,250,0.15)"
    : joined
    ? "0 4px 12px rgba(0,0,0,0.3)"
    : "none";

  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
      opacity: joined ? 1 : 0.2,
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
        {/* Join pulse ring — visible only during the glow moment */}
        {justJoined && (
          <div style={{
            position: "absolute", inset: -6, borderRadius: "50%",
            border: "2px solid rgba(96,165,250,0.3)",
            animation: "joinRingPulse 1.2s ease-out forwards",
          }} />
        )}
        <IconComp size={24} color={iconColor} style={{ transition: "all 0.5s ease" }} />
        {voted && (
          <div style={{
            position: "absolute", bottom: -3, right: -3,
            width: 20, height: 20, borderRadius: "50%",
            background: voteOutcome === "release" ? "#059669" : "#b45309",
            border: "2px solid #0a0e17",
            display: "flex", alignItems: "center", justifyContent: "center",
            animation: "popIn 0.35s cubic-bezier(0.34, 1.56, 0.64, 1)",
            color: "#fff", fontSize: 10, fontWeight: 800,
          }}>
            {voteOutcome === "release" ? "✓" : "✗"}
          </div>
        )}
      </div>
      <span style={{
        fontSize: 10, fontWeight: 700, letterSpacing: 0.8, textTransform: "uppercase",
        color: labelColor, transition: "color 0.6s ease",
      }}>{label}</span>
      <span style={{
        fontSize: 9, fontFamily: "monospace",
        color: joined ? "#475569" : "#1a1e2a",
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
      <div style={{ fontSize: isActive ? 48 : 36, fontWeight: 900, color: isActive ? "#f8fafc" : "#334155", letterSpacing: -2, lineHeight: 1, transition: "all 0.8s cubic-bezier(0.34, 1.56, 0.64, 1)", textShadow: isActive ? `0 0 40px ${vaultGlow}` : "none", fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
        <AnimNum value={fmtSatsNum(amountMsats)} dur={1400} />
      </div>
      <div style={{ fontSize: 14, fontWeight: 500, color: isActive ? "#64748b" : "#1e293b", marginTop: 4, letterSpacing: 2, transition: "color 0.8s ease" }}>SATS</div>
      <div style={{ marginTop: 10, fontSize: 12, fontWeight: 500, color: isDone ? "#10b981" : isApproved ? "#10b981" : isLocked ? "#f59e0b" : status === "FUNDED" ? "#8b5cf6" : "#475569", transition: "color 0.5s ease", display: "flex", alignItems: "center", gap: 6 }}>
        {isDone ? (<><span style={{ width: 7, height: 7, borderRadius: "50%", background: "#10b981", animation: "pulseGreen 1.5s ease infinite" }} />{resolvedOutcome === "release" ? "Delivered to buyer" : "Refunded to seller"}</>) : isApproved ? (<><span style={{ width: 7, height: 7, borderRadius: "50%", background: "#10b981" }} />Ready to claim</>) : isLocked ? (<><span style={{ width: 7, height: 7, borderRadius: "50%", background: "#f59e0b", animation: "pulseAmber 2s ease infinite" }} />Secured in escrow vault</>) : status === "FUNDED" ? "Ready to lock" : status === "EXPIRED" ? (<><span style={{ width: 7, height: 7, borderRadius: "50%", background: "#ef4444" }} />Escrow expired</>) : "Waiting for all parties"}
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
    <div style={{ position: "fixed", bottom: 90, left: 16, right: 16, padding: "12px 16px", borderRadius: 12, background: type === "error" ? "#7f1d1d" : "#064e3b", color: "#fff", fontSize: 13, fontWeight: 500, zIndex: 1000, textAlign: "center", animation: "slideUp 0.25s ease-out", boxShadow: "0 8px 32px rgba(0,0,0,0.4)" }}>
      {msg}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════════════════════

export default function EcashEscrow() {
  const [pubkey, setPubkey] = useState(null);
  const [devRole, setDevRole] = useState("seller");
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

  useEffect(() => {
    (async () => {
      const forcedev = new URLSearchParams(location.search).get("dev");
      if (forcedev) { _devPubkey = DEV_IDENTITIES[devRole]; setPubkey(_devPubkey); return; }
      const pk = await getNostrPubkey();
      if (pk) { _devPubkey = null; setPubkey(pk); }
      else { _devPubkey = DEV_IDENTITIES[devRole]; setPubkey(_devPubkey); }
    })();
  }, []);

  const switchDevIdentity = useCallback((role) => {
    if (!isDevMode()) return;
    setDevRole(role); _devPubkey = DEV_IDENTITIES[role]; setPubkey(_devPubkey);
    setView("list"); setSelected(null); setEscrows([]);
  }, []);

  const loadEscrows = useCallback(async () => {
    if (!pubkey) return;
    setLoading(true);
    try { const data = await api("/"); if (Array.isArray(data)) setEscrows(data); }
    catch { showToast("Failed to load escrows", "error"); }
    setLoading(false);
  }, [pubkey, showToast]);

  useEffect(() => { loadEscrows(); }, [loadEscrows, pubkey]);

  const loadDetail = useCallback(async (id) => {
    setLoading(true);
    try { const data = await api(`/${id}`); if (data.error) throw new Error(data.error); setSelected(data); }
    catch (err) { showToast(err.message, "error"); }
    setLoading(false);
  }, [showToast]);

  const openDetail = (id) => { setView("detail"); loadDetail(id); };

  if (!pubkey) {
    return (
      <div style={S.root}>
        <div style={{ ...S.container, justifyContent: "center", alignItems: "center" }}>
          <SvgArbiter size={32} color="#f59e0b" />
          <p style={{ color: "#94a3b8", marginTop: 12, fontSize: 14 }}>Connecting to Nostr identity\u2026</p>
        </div>
      </div>
    );
  }

  return (
    <div style={S.root}>
      <style>{`
        @keyframes slideUp { from { transform: translateY(16px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
        @keyframes popIn { 0% { transform: scale(0); } 100% { transform: scale(1); } }
        @keyframes float { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-8px); } }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes vaultPulse { 0% { transform: scale(1); opacity: 0.5; } 100% { transform: scale(1.6); opacity: 0; } }
        @keyframes pulseAmber { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }
        @keyframes pulseGreen { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }
        @keyframes celebrateBounce { 0% { transform: scale(0) rotate(-10deg); } 60% { transform: scale(1.15) rotate(3deg); } 100% { transform: scale(1) rotate(0deg); } }
        @keyframes joinGlow { 0% { box-shadow: 0 0 0 rgba(96,165,250,0), inset 0 0 0 rgba(96,165,250,0); transform: scale(0.85); } 15% { box-shadow: 0 0 32px rgba(96,165,250,0.5), 0 0 12px rgba(96,165,250,0.3), inset 0 0 16px rgba(96,165,250,0.2); transform: scale(1.08); } 40% { box-shadow: 0 0 24px rgba(96,165,250,0.35), inset 0 0 10px rgba(96,165,250,0.12); transform: scale(1); } 100% { box-shadow: 0 4px 12px rgba(0,0,0,0.3); transform: scale(1); } }
        @keyframes joinRingPulse { 0% { transform: scale(1); opacity: 0.6; border-color: rgba(96,165,250,0.5); } 100% { transform: scale(1.8); opacity: 0; border-color: rgba(96,165,250,0); } }
        * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
        button { cursor: pointer; border: none; font-family: inherit; }
        input, textarea { font-family: inherit; }
        ::-webkit-scrollbar { width: 0; }
      `}</style>
      <Toast {...toast} />
      {isDevMode() && (
        <div style={S.devBar}>
          <span style={S.devLabel}>DEV</span>
          {["seller", "buyer", "arbiter"].map(r => (
            <button key={r} onClick={() => switchDevIdentity(r)} style={{ ...S.devBtn, ...(devRole === r ? S.devBtnActive : {}) }}>{r}</button>
          ))}
        </div>
      )}
      {view === "list" && <ListView escrows={escrows} pubkey={pubkey} loading={loading} onOpen={openDetail} onCreate={() => setView("create")} onJoin={() => setView("join")} onRefresh={loadEscrows} />}
      {view === "create" && <CreateView pubkey={pubkey} onBack={() => setView("list")} onCreated={(id) => { loadEscrows(); openDetail(id); }} showToast={showToast} setLoading={setLoading} loading={loading} />}
      {view === "join" && <JoinView pubkey={pubkey} onBack={() => setView("list")} onJoined={(id) => { loadEscrows(); openDetail(id); }} showToast={showToast} setLoading={setLoading} loading={loading} />}
      {view === "detail" && selected && <DetailView escrow={selected} pubkey={pubkey} onBack={() => { setView("list"); loadEscrows(); }} onRefresh={() => loadDetail(selected.id)} showToast={showToast} setLoading={setLoading} loading={loading} />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// LIST VIEW
// ═══════════════════════════════════════════════════════════════════════

function ListView({ escrows, pubkey, loading, onOpen, onCreate, onJoin, onRefresh }) {
  return (
    <div style={S.container}>
      <div style={S.listHeader}>
        <div><h1 style={S.title}>Escrow</h1><p style={S.subtitle}>{truncPk(pubkey)}</p></div>
        <button style={S.iconBtn} onClick={onRefresh}><I.Refresh style={loading ? { animation: "pulse 1s infinite" } : {}} /></button>
      </div>
      <div style={{ display: "flex", gap: 10, margin: "0 0 16px" }}>
        <button style={S.primaryBtn} onClick={onCreate}><I.Plus /> New Trade</button>
        <button style={S.secondaryBtn} onClick={onJoin}>Join Escrow</button>
      </div>
      {escrows.length === 0 ? (
        <div style={S.emptyState}>
          <SvgArbiter size={40} color="#475569" />
          <p style={{ color: "#64748b", marginTop: 12, fontSize: 14 }}>No escrows yet. Create a new trade or join an existing one.</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {escrows.map(e => (
            <button key={e.id} style={S.escrowCard} onClick={() => onOpen(e.id)}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={S.cardAmount}>{fmtSats(e.amountMsats)} <span style={{ color: "#64748b", fontWeight: 400 }}>sats</span></span>
                <StatusBadge status={e.status} />
              </div>
              {e.description && <p style={S.cardDesc}>{e.description}</p>}
              <div style={S.cardMeta}>
                <span style={S.cardRole}>{e.yourRole || "\u2014"}</span>
                {e.expiresIn && <span style={S.cardExpiry}><I.Clock /> {e.expiresIn}</span>}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// CREATE VIEW
// ═══════════════════════════════════════════════════════════════════════

function CreateView({ pubkey, onBack, onCreated, showToast, setLoading, loading }) {
  const [amount, setAmount] = useState("");
  const [desc, setDesc] = useState("");
  const [terms, setTerms] = useState("");
  const [community, setCommunity] = useState("");
  const handleCreate = async () => {
    const sats = parseInt(amount);
    if (!sats || sats <= 0) return showToast("Enter a valid amount in sats", "error");
    if (!terms || terms.trim().length < 5) return showToast("Trade terms required (min 5 chars)", "error");
    if (!community) return showToast("Community link required", "error");
    setLoading(true);
    try {
      const res = await api("/", { method: "POST", body: JSON.stringify({ amountMsats: sats * 1000, description: desc, terms, communityLink: community }) });
      if (res.error) throw new Error(res.error);
      showToast("Escrow created!"); onCreated(res.id);
    } catch (err) { showToast(err.message, "error"); }
    setLoading(false);
  };
  return (
    <div style={S.container}>
      <div style={S.viewHeader}><button style={S.iconBtn} onClick={onBack}><I.Back /></button><h2 style={S.viewTitle}>New Trade</h2><div style={{ width: 36 }} /></div>
      <div style={S.formGroup}><label style={S.label}>Amount (sats)</label><input style={S.input} type="number" placeholder="25000" value={amount} onChange={e => setAmount(e.target.value)} /></div>
      <div style={S.formGroup}><label style={S.label}>Description</label><input style={S.input} placeholder="Selling 50 USD for sats" value={desc} onChange={e => setDesc(e.target.value)} /></div>
      <div style={S.formGroup}><label style={S.label}>Trade terms</label><textarea style={{ ...S.input, minHeight: 72, resize: "vertical" }} placeholder="Payment via Zelle. Send within 1 hour of lock." value={terms} onChange={e => setTerms(e.target.value)} /></div>
      <div style={S.formGroup}><label style={S.label}>Community link</label><input style={S.input} placeholder="fedi:room:!roomId:federation.domain:::" value={community} onChange={e => setCommunity(e.target.value)} /><p style={S.hint}>Paste the Fedi room link where this trade was arranged</p></div>
      <button style={{ ...S.primaryBtn, width: "100%", marginTop: 8, padding: "14px 0" }} onClick={handleCreate} disabled={loading}>{loading ? "Creating\u2026" : "Create Escrow"}</button>
      <p style={S.disclaimer}>You are the <strong>seller</strong>. After buyer and arbiter join, you'll lock sats into escrow via Lightning.</p>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// JOIN VIEW
// ═══════════════════════════════════════════════════════════════════════

function JoinView({ pubkey, onBack, onJoined, showToast, setLoading, loading }) {
  const [escrowId, setEscrowId] = useState("");
  const [role, setRole] = useState("buyer");
  const handleJoin = async () => {
    if (!escrowId) return showToast("Enter the escrow ID", "error");
    setLoading(true);
    try {
      const res = await api(`/${escrowId.trim()}/join`, { method: "POST", body: JSON.stringify({ role }) });
      if (res.error) throw new Error(res.error);
      showToast(`Joined as ${role}!`); onJoined(escrowId.trim());
    } catch (err) { showToast(err.message, "error"); }
    setLoading(false);
  };
  return (
    <div style={S.container}>
      <div style={S.viewHeader}><button style={S.iconBtn} onClick={onBack}><I.Back /></button><h2 style={S.viewTitle}>Join Escrow</h2><div style={{ width: 36 }} /></div>
      <div style={S.formGroup}><label style={S.label}>Escrow ID</label><input style={S.input} placeholder="Paste the escrow ID from chat" value={escrowId} onChange={e => setEscrowId(e.target.value)} /></div>
      <div style={S.formGroup}><label style={S.label}>Your role</label><div style={{ display: "flex", gap: 8 }}>{["buyer", "arbiter"].map(r => (<button key={r} onClick={() => setRole(r)} style={{ ...S.roleBtn, ...(role === r ? S.roleBtnActive : {}) }}>{r === "buyer" ? "Buyer" : "Arbiter"}</button>))}</div></div>
      <button style={{ ...S.primaryBtn, width: "100%", marginTop: 16, padding: "14px 0" }} onClick={handleJoin} disabled={loading}>{loading ? "Joining\u2026" : `Join as ${role}`}</button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// DETAIL VIEW — Redesigned with Vault + animated action bar
// ═══════════════════════════════════════════════════════════════════════

function DetailView({ escrow: e, pubkey, onBack, onRefresh, showToast, setLoading, loading }) {
  const role = e.yourRole || null;
  const status = e.status;
  const [showBurst, setShowBurst] = useState(false);
  const prevStatus = useRef(status);

  useEffect(() => {
    if (prevStatus.current !== "LOCKED" && status === "LOCKED") {
      setShowBurst(true);
      setTimeout(() => setShowBurst(false), 2000);
    }
    prevStatus.current = status;
  }, [status]);

  const copy = (text, label) => {
    navigator.clipboard.writeText(text).then(
      () => showToast(`${label} copied`),
      () => showToast("Copy failed", "error")
    );
  };

  // ── WebLN Lock (seller) ─────────────────────────────────────────
  const handleLock = async () => {
    setLoading(true);
    try {
      if (window.webln) {
        const inv = await api(`/${e.id}/invoice`);
        if (inv.error) throw new Error(inv.error);
        if (inv.mode === "webln" && inv.invoice) {
          try { await window.webln.enable(); showToast("Confirm payment in Fedi\u2026"); await window.webln.sendPayment(inv.invoice); }
          catch { showToast("Payment cancelled — tap Lock to try again", "error"); setLoading(false); return; }
          const lock = await api(`/${e.id}/lock`, { method: "POST", body: JSON.stringify({ mode: "webln" }) });
          if (lock.error) throw new Error(lock.error);
          showToast("Sats locked in escrow!");
        }
      } else {
        const notes = `ECASH_DEV_${Date.now()}`;
        const lock = await api(`/${e.id}/lock`, { method: "POST", body: JSON.stringify({ mode: "manual", notes }) });
        if (lock.error) throw new Error(lock.error);
        showToast("Locked (dev mode)");
      }
      onRefresh();
    } catch (err) { showToast(err.message, "error"); }
    setLoading(false);
  };

  const handleVote = async (outcome) => {
    setLoading(true);
    try {
      const res = await api(`/${e.id}/approve`, { method: "POST", body: JSON.stringify({ outcome }) });
      if (res.error) throw new Error(res.error);
      showToast(outcome === "release" ? "Voted to release" : "Voted to refund");
      onRefresh();
    } catch (err) { showToast(err.message, "error"); }
    setLoading(false);
  };

  const handleClaim = async () => {
    setLoading(true);
    try {
      let amountSats = Math.floor((e.amountMsats || 0) / 1000);
      let payoutReady = false;
      let notes = null;
      if (status === "CLAIMED") { payoutReady = true; }
      else {
        const claim = await api(`/${e.id}/claim`, { method: "POST" });
        if (claim.error) throw new Error(claim.error);
        payoutReady = claim.payoutReady; amountSats = claim.amountSats || amountSats; notes = claim.notes;
      }
      if (payoutReady) {
        let invoice;
        if (window.webln) {
          try { await window.webln.enable(); const result = await window.webln.makeInvoice({ amount: amountSats }); invoice = result.paymentRequest; }
          catch { showToast("Invoice cancelled — tap Claim to try again", "error"); setLoading(false); return; }
        } else {
          invoice = prompt(`Paste a BOLT-11 invoice for ${amountSats} sats:`);
          if (!invoice) { setLoading(false); return; }
        }
        showToast("Sending payout\u2026");
        const payout = await api(`/${e.id}/payout`, { method: "POST", body: JSON.stringify({ invoice }) });
        if (payout.error) throw new Error(payout.error);
        showToast("Sats received!");
      } else if (notes) {
        copy(notes, "E-cash notes");
        showToast("Notes copied to clipboard");
      } else {
        showToast("Claimed!");
      }
      onRefresh();
    } catch (err) { showToast(err.message, "error"); }
    setLoading(false);
  };

  // ── Available actions ─────────────────────────────────────────────
  const canLock = status === "FUNDED" && role === "seller";
  const hasVoted = e.votes?.voters?.some(v => v.role === role);
  const buyerVoted = e.votes?.voters?.some(v => v.role === "buyer");
  const sellerVoted = e.votes?.voters?.some(v => v.role === "seller");
  const buyerOutcome = e.votes?.voters?.find(v => v.role === "buyer")?.outcome;
  const sellerOutcome = e.votes?.voters?.find(v => v.role === "seller")?.outcome;
  const canBuyerVote = status === "LOCKED" && role === "buyer" && !hasVoted;
  const canSellerVote = status === "LOCKED" && role === "seller" && !hasVoted && buyerVoted;
  const canArbiterVote = status === "LOCKED" && role === "arbiter" && !hasVoted && buyerVoted && sellerVoted && buyerOutcome !== sellerOutcome;
  const canClaim = (status === "APPROVED" || status === "CLAIMED") && ((e.resolvedOutcome === "release" && role === "buyer") || (e.resolvedOutcome === "refund" && role === "seller"));
  const canReclaimExpired = status === "EXPIRED" && role === "seller" && e.lockedAt;

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
        <button style={S.iconBtn} onClick={onBack}><I.Back /></button>
        <h2 style={S.viewTitle}>Trade #{e.id}</h2>
        <button style={S.iconBtn} onClick={onRefresh}><I.Refresh /></button>
      </div>

      <div style={{ overflowY: "auto", flex: 1, paddingBottom: 100 }}>
        {/* ═══ THE VAULT ═══ */}
        <Vault status={status} amountMsats={e.amountMsats} showBurst={showBurst} resolvedOutcome={e.resolvedOutcome} />

        {/* ── Participants (animated SVG nodes) ──────────────────── */}
        <div style={{ display: "flex", justifyContent: "center", alignItems: "flex-start", gap: 0, padding: "0 8px 16px" }}>
          <ParticipantNode label="Seller" IconComp={SvgSeller} pkDisplay={getPkDisplay(e.participants?.seller)} joined={isParticipantJoined(e.participants?.seller)} voted={!!e.votes?.voters?.find(v => v.role === "seller")} voteOutcome={sellerOutcome} delay={0} />
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, paddingTop: 20, opacity: isParticipantJoined(e.participants?.buyer) ? 0.6 : 0.08, transition: "opacity 0.8s ease" }}>
            <div style={{ width: 28, height: 1, background: status === "LOCKED" || status === "APPROVED" || status === "CLAIMED" ? `linear-gradient(90deg, ${status === "CLAIMED" || status === "COMPLETED" ? "#10b981" : "#f59e0b"}, transparent)` : isParticipantJoined(e.participants?.buyer) ? "#334155" : "#111827", transition: "background 0.5s ease" }} />
            <div style={{ fontSize: 8, color: isParticipantJoined(e.participants?.buyer) && isParticipantJoined(e.participants?.arbiter) ? "#475569" : "#1a1e2a", letterSpacing: 1, transition: "color 0.5s ease" }}>2-of-3</div>
            <div style={{ width: 28, height: 1, background: status === "LOCKED" || status === "APPROVED" || status === "CLAIMED" ? `linear-gradient(270deg, ${status === "CLAIMED" || status === "COMPLETED" ? "#10b981" : "#f59e0b"}, transparent)` : isParticipantJoined(e.participants?.buyer) ? "#334155" : "#111827", transition: "background 0.5s ease" }} />
          </div>
          <ParticipantNode label="Buyer" IconComp={SvgBuyer} pkDisplay={getPkDisplay(e.participants?.buyer)} joined={isParticipantJoined(e.participants?.buyer)} voted={!!e.votes?.voters?.find(v => v.role === "buyer")} voteOutcome={buyerOutcome} delay={150} />
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, paddingTop: 20, opacity: isParticipantJoined(e.participants?.arbiter) ? 0.4 : 0.05, transition: "opacity 0.8s ease" }}>
            <div style={{ width: 16, height: 1, background: "#1e293b" }} />
          </div>
          <ParticipantNode label="Arbiter" IconComp={SvgArbiter} pkDisplay={getPkDisplay(e.participants?.arbiter)} joined={isParticipantJoined(e.participants?.arbiter)} voted={!!e.votes?.voters?.find(v => v.role === "arbiter")} voteOutcome={e.votes?.voters?.find(v => v.role === "arbiter")?.outcome} delay={300} />
        </div>

        {/* ── Vote tally ─────────────────────────────────────────── */}
        {(status === "LOCKED" || status === "APPROVED" || status === "CLAIMED") && e.votes && (
          <div style={{ padding: "0 0 12px", animation: "slideUp 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)" }}>
            <div style={{ background: "#111827", border: "1px solid #1e293b", borderRadius: 14, padding: "14px", display: "flex", gap: 12, alignItems: "center" }}>
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
                    <div style={{ fontSize: 12, fontWeight: 800, color: e.resolvedOutcome === "release" ? "#10b981" : "#f59e0b" }}>{e.resolvedOutcome === "release" ? "RELEASE ✓" : "REFUND ↩"}</div>
                    <div style={{ fontSize: 9, color: "#64748b", marginTop: 2 }}>{e.resolvedOutcome === "release" ? "→ Buyer wins" : "→ Seller refunded"}</div>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {role && (
          <div style={S.roleBanner}>
            <SvgArbiter size={16} color="#f59e0b" />
            <span>You are the <strong style={{ textTransform: "capitalize" }}>{role}</strong></span>
          </div>
        )}

        {e.terms && (<div style={S.section}><div style={S.sectionLabel}>Trade Terms</div><div style={S.sectionValue}>{e.terms}</div></div>)}
        {e.description && (<div style={S.section}><div style={S.sectionLabel}>Description</div><div style={S.sectionValue}>{e.description}</div></div>)}

        <div style={S.section}>
          <div style={S.sectionLabel}>Escrow ID</div>
          <button style={S.copyRow} onClick={() => copy(e.id, "Escrow ID")}>
            <span style={S.mono}>{e.id}</span><I.Copy />
          </button>
        </div>

        {/* Completion celebration */}
        {(status === "COMPLETED" || (status === "CLAIMED" && e.resolvedOutcome)) && (
          <div style={{ textAlign: "center", padding: "12px 0", animation: "celebrateBounce 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)" }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: "#10b981" }}>Trade Complete</div>
            <div style={{ fontSize: 11, color: "#475569", marginTop: 4 }}>{fmtSats(e.amountMsats)} sats delivered trustlessly</div>
          </div>
        )}
      </div>

      {/* ═══ BOLD ACTION BAR ═══ */}
      <div style={S.actionBar}>
        {canLock && (
          <button style={{ ...S.actionBtn, background: "linear-gradient(135deg, #f59e0b, #d97706)", boxShadow: "0 4px 24px rgba(245,158,11,0.3)" }} onClick={handleLock} disabled={loading}>
            {loading ? "Locking\u2026" : `Lock ${fmtSats(e.amountMsats)} sats into escrow`}
          </button>
        )}
        {canBuyerVote && (
          <button style={{ ...S.actionBtn, background: "linear-gradient(135deg, #059669, #047857)", boxShadow: "0 4px 24px rgba(5,150,105,0.3)" }} onClick={() => handleVote("release")} disabled={loading}>
            {loading ? "Voting\u2026" : "Confirm trade completed — Release"}
          </button>
        )}
        {canSellerVote && (
          <div style={{ display: "flex", gap: 8, width: "100%" }}>
            <button style={{ ...S.actionBtn, flex: 1, background: "linear-gradient(135deg, #059669, #047857)" }} onClick={() => handleVote("release")} disabled={loading}>Confirm</button>
            <button style={{ ...S.actionBtn, flex: 1, background: "linear-gradient(135deg, #b45309, #92400e)" }} onClick={() => handleVote("refund")} disabled={loading}>Dispute</button>
          </div>
        )}
        {canArbiterVote && (
          <div style={{ display: "flex", gap: 8, width: "100%" }}>
            <button style={{ ...S.actionBtn, flex: 1, background: "linear-gradient(135deg, #059669, #047857)" }} onClick={() => handleVote("release")} disabled={loading}>Release</button>
            <button style={{ ...S.actionBtn, flex: 1, background: "linear-gradient(135deg, #b45309, #92400e)" }} onClick={() => handleVote("refund")} disabled={loading}>Refund</button>
          </div>
        )}
        {(canClaim || canReclaimExpired) && (
          <button style={{ ...S.actionBtn, background: "linear-gradient(135deg, #10b981, #059669)", boxShadow: "0 4px 24px rgba(16,185,129,0.3)" }} onClick={handleClaim} disabled={loading}>
            {loading ? "Claiming\u2026" : `Claim your ${fmtSats(e.amountMsats)} sats`}
          </button>
        )}
        {status === "LOCKED" && role === "buyer" && hasVoted && <div style={S.waitBanner}><I.Clock /> Waiting for seller to respond\u2026</div>}
        {status === "LOCKED" && role === "seller" && !buyerVoted && <div style={S.waitBanner}><I.Clock /> Waiting for buyer to vote first\u2026</div>}
        {status === "LOCKED" && role === "seller" && hasVoted && <div style={S.waitBanner}><I.Clock /> Waiting for resolution\u2026</div>}
        {status === "LOCKED" && role === "arbiter" && (!buyerVoted || !sellerVoted) && <div style={S.waitBanner}><I.Clock /> Waiting for buyer and seller to vote\u2026</div>}
        {status === "LOCKED" && role === "arbiter" && buyerVoted && sellerVoted && buyerOutcome === sellerOutcome && <div style={S.waitBanner}><I.Check /> Buyer and seller agree — no dispute</div>}
        {status === "FUNDED" && role !== "seller" && <div style={S.waitBanner}>Waiting for seller to lock funds\u2026</div>}
        {status === "CREATED" && <div style={S.waitBanner}><I.Clock /> Waiting for all parties to join\u2026</div>}
        {status === "COMPLETED" && <div style={{ ...S.waitBanner, color: "#059669" }}><I.Check /> Trade complete — sats paid out!</div>}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// STYLES
// ═══════════════════════════════════════════════════════════════════════

const S = {
  root: { background: "#0c0f17", color: "#e2e8f0", minHeight: "100vh", fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', fontSize: 14, lineHeight: 1.5 },
  container: { maxWidth: 480, margin: "0 auto", padding: "0 16px", minHeight: "100vh", display: "flex", flexDirection: "column" },
  listHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "20px 0 16px" },
  title: { fontSize: 24, fontWeight: 700, color: "#f8fafc", margin: 0, letterSpacing: -0.5 },
  subtitle: { fontSize: 12, color: "#64748b", margin: "2px 0 0", fontFamily: "monospace" },
  emptyState: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "60px 20px", textAlign: "center" },
  escrowCard: { background: "#111827", border: "1px solid #1e293b", borderRadius: 12, padding: "14px 16px", textAlign: "left", color: "#e2e8f0", width: "100%", transition: "background 0.15s" },
  cardAmount: { fontSize: 17, fontWeight: 600, color: "#f8fafc" },
  cardDesc: { fontSize: 12, color: "#94a3b8", margin: "6px 0 0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  cardMeta: { display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 },
  cardRole: { fontSize: 11, fontWeight: 600, color: "#8b5cf6", textTransform: "uppercase", letterSpacing: 0.5 },
  cardExpiry: { display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, color: "#64748b" },
  viewHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 0 12px" },
  viewTitle: { fontSize: 17, fontWeight: 600, color: "#f8fafc", margin: 0 },
  iconBtn: { background: "transparent", color: "#94a3b8", padding: 8, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center" },
  primaryBtn: { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, background: "#f59e0b", color: "#0c0f17", fontWeight: 600, fontSize: 14, padding: "10px 20px", borderRadius: 10, flex: 1 },
  secondaryBtn: { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, background: "#1e293b", color: "#e2e8f0", fontWeight: 500, fontSize: 14, padding: "10px 20px", borderRadius: 10, flex: 1 },
  roleBtn: { flex: 1, padding: "12px 16px", borderRadius: 10, background: "#111827", color: "#94a3b8", fontSize: 14, fontWeight: 500, border: "1px solid #1e293b", textAlign: "center" },
  roleBtnActive: { background: "#1e293b", color: "#f8fafc", borderColor: "#f59e0b" },
  formGroup: { marginBottom: 16 },
  label: { display: "block", fontSize: 12, fontWeight: 600, color: "#94a3b8", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 },
  input: { width: "100%", padding: "12px 14px", borderRadius: 10, border: "1px solid #1e293b", background: "#111827", color: "#f8fafc", fontSize: 14, outline: "none" },
  hint: { fontSize: 11, color: "#475569", marginTop: 4 },
  disclaimer: { fontSize: 12, color: "#64748b", marginTop: 16, padding: "12px", background: "#111827", borderRadius: 10, lineHeight: 1.6 },
  roleBanner: { display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.15)", borderRadius: 10, fontSize: 13, marginBottom: 12 },
  section: { marginBottom: 14 },
  sectionLabel: { fontSize: 11, fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 },
  sectionValue: { fontSize: 13, color: "#cbd5e1", lineHeight: 1.6 },
  copyRow: { display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", padding: "8px 12px", background: "#111827", border: "1px solid #1e293b", borderRadius: 8, color: "#94a3b8" },
  mono: { fontFamily: "monospace", fontSize: 12, color: "#64748b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "85%" },
  actionBar: { position: "sticky", bottom: 0, left: 0, right: 0, padding: "12px 0 20px", background: "linear-gradient(transparent, #0c0f17 20%)" },
  actionBtn: { display: "flex", alignItems: "center", justifyContent: "center", gap: 8, width: "100%", padding: "16px 0", borderRadius: 14, background: "#f59e0b", color: "#fff", fontSize: 15, fontWeight: 800, letterSpacing: -0.3 },
  waitBanner: { display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "14px 0", color: "#64748b", fontSize: 13, fontWeight: 500 },
  devBar: { display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", background: "#1a1625", borderBottom: "1px solid #2d2640", position: "sticky", top: 0, zIndex: 100 },
  devLabel: { fontSize: 10, fontWeight: 700, color: "#7c3aed", letterSpacing: 1, marginRight: 4 },
  devBtn: { padding: "4px 12px", borderRadius: 6, background: "#111827", color: "#64748b", fontSize: 12, fontWeight: 500, border: "1px solid #1e293b", textTransform: "capitalize" },
  devBtnActive: { background: "#7c3aed", color: "#fff", borderColor: "#7c3aed" },
};
