import { useState, useEffect, useCallback, useRef } from "react";

// ═══════════════════════════════════════════════════════════════════════
// Fedi Mini-App: E-Cash Escrow v6.0
// WebLN lock/claim • NIP-98 Nostr auth • Fedimint-powered
// ═══════════════════════════════════════════════════════════════════════

const API = "/api/ecash-escrows";

// ── Nostr / NIP-98 Auth ─────────────────────────────────────────────
// Fedi injects `window.nostr` (NIP-07). We use it for identity + signing.

async function getNostrPubkey() {
  if (!window.nostr) return null;
  try { return await window.nostr.getPublicKey(); }
  catch { return null; }
}

async function makeNip98Header(url, method) {
  if (!window.nostr && !_devPubkey) return null;
  // In dev mode with identity switcher, skip NIP-98 signing
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
// For browser testing: 3 stable dev identities so you can test the full
// 3-party flow. In Fedi, each user has their own device + nostr key.

const DEV_IDENTITIES = {
  seller:  "aa".repeat(32),
  buyer:   "bb".repeat(32),
  arbiter: "cc".repeat(32),
};

function isDevMode() {
  return !!_devPubkey;
}

// ── API Layer with NIP-98 + dev fallback ────────────────────────────

let _devPubkey = null;

async function api(path, opts = {}) {
  const method = opts.method || "GET";
  const url = `${location.origin}${API}${path}`;
  const headers = { "Content-Type": "application/json" };

  const nip98 = await makeNip98Header(url, method);
  if (nip98) {
    headers["Authorization"] = nip98;
  } else if (_devPubkey) {
    headers["X-Dev-Pubkey"] = _devPubkey;
  }

  const res = await fetch(url, { ...opts, headers });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { error: text || `HTTP ${res.status} — no response body` };
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

function fmtSats(msats) {
  return Math.floor(msats / 1000).toLocaleString();
}

function truncPk(hex) {
  if (!hex || hex.length < 16) return hex || "";
  return hex.slice(0, 8) + "\u2026" + hex.slice(-8);
}

// ── Icons ────────────────────────────────────────────────────────────

const I = {
  Shield: (p) => <svg {...p} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>,
  Plus: (p) => <svg {...p} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>,
  Back: (p) => <svg {...p} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>,
  Lock: (p) => <svg {...p} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>,
  Check: (p) => <svg {...p} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>,
  Zap: (p) => <svg {...p} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>,
  Copy: (p) => <svg {...p} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>,
  Vote: (p) => <svg {...p} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14z"/><path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg>,
  Wallet: (p) => <svg {...p} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a1 1 0 1 0 0 2 1 1 0 0 0 0-2z"/></svg>,
  Refresh: (p) => <svg {...p} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>,
  Clock: (p) => <svg {...p} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
  Download: (p) => <svg {...p} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>,
};

// ── Status Config ────────────────────────────────────────────────────

const STATUS = {
  CREATED:  { color: "#64748b", bg: "rgba(100,116,139,0.12)", label: "Waiting for parties" },
  FUNDED:   { color: "#8b5cf6", bg: "rgba(139,92,246,0.12)", label: "Ready to lock" },
  LOCKED:   { color: "#f59e0b", bg: "rgba(245,158,11,0.12)", label: "Funds locked" },
  APPROVED: { color: "#3b82f6", bg: "rgba(59,130,246,0.12)", label: "Resolved" },
  CLAIMED:  { color: "#10b981", bg: "rgba(16,185,129,0.12)", label: "Claimed" },
  EXPIRED:  { color: "#ef4444", bg: "rgba(239,68,68,0.12)", label: "Expired" },
};

function StatusBadge({ status }) {
  const c = STATUS[status] || STATUS.CREATED;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: "3px 10px", borderRadius: 99, fontSize: 12, fontWeight: 600,
      color: c.color, background: c.bg, letterSpacing: 0.3,
    }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: c.color }} />
      {c.label}
    </span>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// TOAST
// ═══════════════════════════════════════════════════════════════════════

function Toast({ msg, type, visible }) {
  if (!visible) return null;
  return (
    <div style={{
      position: "fixed", bottom: 24, left: 16, right: 16,
      padding: "12px 16px", borderRadius: 12,
      background: type === "error" ? "#7f1d1d" : "#064e3b",
      color: "#fff", fontSize: 13, fontWeight: 500,
      zIndex: 1000, textAlign: "center",
      animation: "slideUp 0.25s ease-out",
      boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
    }}>
      {msg}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════════════════════

export default function EcashEscrow() {
  const [pubkey, setPubkey] = useState(null);
  const [devRole, setDevRole] = useState("seller"); // dev mode identity switcher
  const [view, setView] = useState("list"); // list | create | detail | join
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

  // ── Init: detect Nostr identity ─────────────────────────────────
  useEffect(() => {
    (async () => {
      // Check URL param for forced dev mode: ?dev=1
      const forcedev = new URLSearchParams(location.search).get("dev");
      if (forcedev) {
        _devPubkey = DEV_IDENTITIES[devRole];
        setPubkey(_devPubkey);
        return;
      }
      const pk = await getNostrPubkey();
      if (pk) {
        _devPubkey = null;
        setPubkey(pk);
      } else {
        _devPubkey = DEV_IDENTITIES[devRole];
        setPubkey(_devPubkey);
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Dev mode: switch identity ───────────────────────────────────
  const switchDevIdentity = useCallback((role) => {
    if (!isDevMode()) return;
    setDevRole(role);
    _devPubkey = DEV_IDENTITIES[role];
    setPubkey(_devPubkey);
    setView("list");
    setSelected(null);
    setEscrows([]);
  }, []);

  // ── Load escrows ────────────────────────────────────────────────
  const loadEscrows = useCallback(async () => {
    if (!pubkey) return;
    setLoading(true);
    try {
      const data = await api("/");
      if (Array.isArray(data)) setEscrows(data);
    } catch (err) {
      showToast("Failed to load escrows", "error");
    }
    setLoading(false);
  }, [pubkey, showToast]);

  useEffect(() => { loadEscrows(); }, [loadEscrows, pubkey]);

  // ── Load single escrow detail ───────────────────────────────────
  const loadDetail = useCallback(async (id) => {
    setLoading(true);
    try {
      const data = await api(`/${id}`);
      if (data.error) throw new Error(data.error);
      setSelected(data);
    } catch (err) {
      showToast(err.message, "error");
    }
    setLoading(false);
  }, [showToast]);

  const openDetail = (id) => { setView("detail"); loadDetail(id); };

  // ── Render ──────────────────────────────────────────────────────
  if (!pubkey) {
    return (
      <div style={S.root}>
        <div style={{ ...S.container, justifyContent: "center", alignItems: "center" }}>
          <I.Shield style={{ color: "#f59e0b" }} />
          <p style={{ color: "#94a3b8", marginTop: 12, fontSize: 14 }}>Connecting to Nostr identity…</p>
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
        * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
        button { cursor: pointer; border: none; font-family: inherit; }
        input, textarea { font-family: inherit; }
        ::-webkit-scrollbar { width: 0; }
      `}</style>

      <Toast {...toast} />

      {/* Dev mode identity switcher */}
      {isDevMode() && (
        <div style={S.devBar}>
          <span style={S.devLabel}>DEV</span>
          {["seller", "buyer", "arbiter"].map(r => (
            <button key={r} onClick={() => { switchDevIdentity(r); }} style={{
              ...S.devBtn,
              ...(devRole === r ? S.devBtnActive : {}),
            }}>
              {r}
            </button>
          ))}
        </div>
      )}

      {view === "list" && (
        <ListView
          escrows={escrows} pubkey={pubkey} loading={loading}
          onOpen={openDetail} onCreate={() => setView("create")}
          onJoin={() => setView("join")} onRefresh={loadEscrows}
        />
      )}
      {view === "create" && (
        <CreateView
          pubkey={pubkey} onBack={() => setView("list")}
          onCreated={(id) => { loadEscrows(); openDetail(id); }}
          showToast={showToast} setLoading={setLoading} loading={loading}
        />
      )}
      {view === "join" && (
        <JoinView
          pubkey={pubkey} onBack={() => setView("list")}
          onJoined={(id) => { loadEscrows(); openDetail(id); }}
          showToast={showToast} setLoading={setLoading} loading={loading}
        />
      )}
      {view === "detail" && selected && (
        <DetailView
          escrow={selected} pubkey={pubkey}
          onBack={() => { setView("list"); loadEscrows(); }}
          onRefresh={() => loadDetail(selected.id)}
          showToast={showToast} setLoading={setLoading} loading={loading}
        />
      )}
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
        <div>
          <h1 style={S.title}>Escrow</h1>
          <p style={S.subtitle}>{truncPk(pubkey)}</p>
        </div>
        <button style={S.iconBtn} onClick={onRefresh}>
          <I.Refresh style={loading ? { animation: "pulse 1s infinite" } : {}} />
        </button>
      </div>

      <div style={{ display: "flex", gap: 10, margin: "0 0 16px" }}>
        <button style={S.primaryBtn} onClick={onCreate}><I.Plus /> New Trade</button>
        <button style={S.secondaryBtn} onClick={onJoin}>Join Escrow</button>
      </div>

      {escrows.length === 0 ? (
        <div style={S.emptyState}>
          <I.Shield style={{ color: "#475569", width: 40, height: 40 }} />
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
      const res = await api("/", {
        method: "POST",
        body: JSON.stringify({ amountMsats: sats * 1000, description: desc, terms, communityLink: community }),
      });
      if (res.error) throw new Error(res.error);
      showToast("Escrow created!");
      onCreated(res.id);
    } catch (err) { showToast(err.message, "error"); }
    setLoading(false);
  };

  return (
    <div style={S.container}>
      <div style={S.viewHeader}>
        <button style={S.iconBtn} onClick={onBack}><I.Back /></button>
        <h2 style={S.viewTitle}>New Trade</h2>
        <div style={{ width: 36 }} />
      </div>

      <div style={S.formGroup}>
        <label style={S.label}>Amount (sats)</label>
        <input style={S.input} type="number" placeholder="25000" value={amount} onChange={e => setAmount(e.target.value)} />
      </div>
      <div style={S.formGroup}>
        <label style={S.label}>Description</label>
        <input style={S.input} placeholder="Selling 50 USD for sats" value={desc} onChange={e => setDesc(e.target.value)} />
      </div>
      <div style={S.formGroup}>
        <label style={S.label}>Trade terms</label>
        <textarea style={{ ...S.input, minHeight: 72, resize: "vertical" }} placeholder="Payment via Zelle. Send within 1 hour of lock." value={terms} onChange={e => setTerms(e.target.value)} />
      </div>
      <div style={S.formGroup}>
        <label style={S.label}>Community link</label>
        <input style={S.input} placeholder="fedi:room:!roomId:federation.domain:::" value={community} onChange={e => setCommunity(e.target.value)} />
        <p style={S.hint}>Paste the Fedi room link where this trade was arranged</p>
      </div>

      <button style={{ ...S.primaryBtn, width: "100%", marginTop: 8, padding: "14px 0" }} onClick={handleCreate} disabled={loading}>
        {loading ? "Creating\u2026" : "Create Escrow"}
      </button>
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
      const res = await api(`/${escrowId.trim()}/join`, {
        method: "POST",
        body: JSON.stringify({ role }),
      });
      if (res.error) throw new Error(res.error);
      showToast(`Joined as ${role}!`);
      onJoined(escrowId.trim());
    } catch (err) { showToast(err.message, "error"); }
    setLoading(false);
  };

  return (
    <div style={S.container}>
      <div style={S.viewHeader}>
        <button style={S.iconBtn} onClick={onBack}><I.Back /></button>
        <h2 style={S.viewTitle}>Join Escrow</h2>
        <div style={{ width: 36 }} />
      </div>

      <div style={S.formGroup}>
        <label style={S.label}>Escrow ID</label>
        <input style={S.input} placeholder="Paste the escrow ID from chat" value={escrowId} onChange={e => setEscrowId(e.target.value)} />
      </div>
      <div style={S.formGroup}>
        <label style={S.label}>Your role</label>
        <div style={{ display: "flex", gap: 8 }}>
          {["buyer", "arbiter"].map(r => (
            <button key={r} onClick={() => setRole(r)} style={{ ...S.roleBtn, ...(role === r ? S.roleBtnActive : {}) }}>
              {r === "buyer" ? "\ud83d\uded2 Buyer" : "\u2696\ufe0f Arbiter"}
            </button>
          ))}
        </div>
      </div>

      <button style={{ ...S.primaryBtn, width: "100%", marginTop: 16, padding: "14px 0" }} onClick={handleJoin} disabled={loading}>
        {loading ? "Joining\u2026" : `Join as ${role}`}
      </button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// DETAIL VIEW — the core of the escrow flow
// ═══════════════════════════════════════════════════════════════════════

function DetailView({ escrow: e, pubkey, onBack, onRefresh, showToast, setLoading, loading }) {
  const role = e.yourRole || null;
  const status = e.status;

  const copy = (text, label) => {
    navigator.clipboard.writeText(text).then(
      () => showToast(`${label} copied`),
      () => showToast("Copy failed", "error")
    );
  };

  // ── WebLN Lock (seller) ───────────────────────────────────────────
  const handleLock = async () => {
    setLoading(true);
    try {
      // If WebLN available (Fedi), use the full invoice flow
      if (window.webln) {
        const inv = await api(`/${e.id}/invoice`);
        if (inv.error) throw new Error(inv.error);

        if (inv.mode === "webln" && inv.invoice) {
          await window.webln.enable();
          showToast("Confirm payment in Fedi\u2026");
          await window.webln.sendPayment(inv.invoice);

          const lock = await api(`/${e.id}/lock`, { method: "POST", body: JSON.stringify({ mode: "webln" }) });
          if (lock.error) throw new Error(lock.error);
          showToast("Sats locked in escrow!");
        }
      } else {
        // Dev/browser fallback: manual lock (no real payment)
        const notes = `ECASH_DEV_${Date.now()}`;
        const lock = await api(`/${e.id}/lock`, { method: "POST", body: JSON.stringify({ mode: "manual", notes }) });
        if (lock.error) throw new Error(lock.error);
        showToast("Locked (dev mode)");
      }
      onRefresh();
    } catch (err) { showToast(err.message, "error"); }
    setLoading(false);
  };

  // ── Vote ──────────────────────────────────────────────────────────
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

  // ── Claim + Payout ────────────────────────────────────────────────
  const handleClaim = async () => {
    setLoading(true);
    try {
      const claim = await api(`/${e.id}/claim`, { method: "POST" });
      if (claim.error) throw new Error(claim.error);

      if (claim.payoutReady) {
        let invoice;
        if (window.webln) {
          await window.webln.enable();
          const result = await window.webln.makeInvoice({ amount: claim.amountSats });
          invoice = result.paymentRequest;
        } else {
          invoice = prompt(`Paste a BOLT-11 invoice for ${claim.amountSats} sats:`);
          if (!invoice) { setLoading(false); return; }
        }
        showToast("Sending payout\u2026");
        const payout = await api(`/${e.id}/payout`, { method: "POST", body: JSON.stringify({ invoice }) });
        if (payout.error) throw new Error(payout.error);
        showToast("Sats received!");
      } else if (claim.notes) {
        copy(claim.notes, "E-cash notes");
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

  // Voting rules (mirror server logic):
  // - Buyer votes first, can only vote "release"
  // - Seller votes second (after buyer), can vote release or refund
  // - Arbiter votes last (after both), only if they disagree
  const canBuyerVote = status === "LOCKED" && role === "buyer" && !hasVoted;
  const canSellerVote = status === "LOCKED" && role === "seller" && !hasVoted && buyerVoted;
  const canArbiterVote = status === "LOCKED" && role === "arbiter" && !hasVoted
    && buyerVoted && sellerVoted && buyerOutcome !== sellerOutcome;

  const canClaim = status === "APPROVED" && (
    (e.resolvedOutcome === "release" && role === "buyer") ||
    (e.resolvedOutcome === "refund" && role === "seller")
  );
  const canReclaimExpired = status === "EXPIRED" && role === "seller" && e.lockedAt;

  return (
    <div style={S.container}>
      <div style={S.viewHeader}>
        <button style={S.iconBtn} onClick={onBack}><I.Back /></button>
        <h2 style={S.viewTitle}>Trade #{e.id}</h2>
        <button style={S.iconBtn} onClick={onRefresh}><I.Refresh /></button>
      </div>

      <div style={{ overflowY: "auto", flex: 1, paddingBottom: 100 }}>
        {/* Amount card */}
        <div style={S.amountCard}>
          <div style={{ fontSize: 13, color: "#94a3b8", marginBottom: 4 }}>Escrow Amount</div>
          <div style={{ fontSize: 32, fontWeight: 700, color: "#f8fafc", letterSpacing: -1 }}>
            {fmtSats(e.amountMsats)}
            <span style={{ fontSize: 16, color: "#64748b", fontWeight: 400, marginLeft: 6 }}>sats</span>
          </div>
          <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center" }}>
            <StatusBadge status={status} />
            {e.expiresIn && <span style={{ fontSize: 12, color: "#64748b" }}><I.Clock /> {e.expiresIn}</span>}
          </div>
        </div>

        {role && (
          <div style={S.roleBanner}>
            <I.Zap style={{ color: "#f59e0b", flexShrink: 0 }} />
            <span>You are the <strong style={{ textTransform: "capitalize" }}>{role}</strong></span>
          </div>
        )}

        {e.terms && (
          <div style={S.section}>
            <div style={S.sectionLabel}>Trade Terms</div>
            <div style={S.sectionValue}>{e.terms}</div>
          </div>
        )}

        {e.description && (
          <div style={S.section}>
            <div style={S.sectionLabel}>Description</div>
            <div style={S.sectionValue}>{e.description}</div>
          </div>
        )}

        <div style={S.section}>
          <div style={S.sectionLabel}>Participants</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {[
              { label: "Seller", pk: e.participants?.seller },
              { label: "Buyer", pk: e.participants?.buyer },
              { label: "Arbiter", pk: e.participants?.arbiter },
            ].map(p => (
              <div key={p.label} style={S.participantRow}>
                <span style={S.participantLabel}>{p.label}</span>
                <span style={S.participantPk}>
                  {typeof p.pk === "object" ? (p.pk?.isFull ? truncPk(p.pk.pubkey) : "\u2014") :
                   p.pk ? truncPk(p.pk) : <span style={{ color: "#475569" }}>waiting\u2026</span>}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div style={S.section}>
          <div style={S.sectionLabel}>Escrow ID</div>
          <button style={S.copyRow} onClick={() => copy(e.id, "Escrow ID")}>
            <span style={S.mono}>{e.id}</span>
            <I.Copy />
          </button>
        </div>

        {(status === "LOCKED" || status === "APPROVED" || status === "CLAIMED") && e.votes && (
          <div style={S.section}>
            <div style={S.sectionLabel}>Votes</div>
            <div style={{ display: "flex", gap: 12 }}>
              <div style={S.voteBox}>
                <div style={{ fontSize: 24, fontWeight: 700, color: "#10b981" }}>{e.votes.release || 0}</div>
                <div style={{ fontSize: 11, color: "#64748b" }}>Release</div>
              </div>
              <div style={{ width: 1, background: "#1e293b" }} />
              <div style={S.voteBox}>
                <div style={{ fontSize: 24, fontWeight: 700, color: "#f59e0b" }}>{e.votes.refund || 0}</div>
                <div style={{ fontSize: 11, color: "#64748b" }}>Refund</div>
              </div>
            </div>
            {e.votes.voters?.length > 0 && (
              <div style={{ marginTop: 8 }}>
                {e.votes.voters.map((v, i) => (
                  <div key={i} style={S.voterRow}>
                    <span style={{ color: "#94a3b8", textTransform: "capitalize", fontSize: 12 }}>{v.role}</span>
                    <span style={{ color: v.outcome === "release" ? "#10b981" : "#f59e0b", fontSize: 12, fontWeight: 600 }}>{v.outcome}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {e.resolvedOutcome && (
          <div style={{
            ...S.banner,
            background: e.resolvedOutcome === "release" ? "rgba(16,185,129,0.1)" : "rgba(245,158,11,0.1)",
            borderColor: e.resolvedOutcome === "release" ? "rgba(16,185,129,0.25)" : "rgba(245,158,11,0.25)",
          }}>
            <I.Check />
            <span>Resolved: <strong style={{ textTransform: "capitalize" }}>{e.resolvedOutcome}</strong>
            {e.resolvedOutcome === "release" ? " \u2192 Buyer wins" : " \u2192 Seller refunded"}</span>
          </div>
        )}
      </div>

      {/* Bottom Action Bar */}
      <div style={S.actionBar}>
        {canLock && (
          <button style={S.actionBtn} onClick={handleLock} disabled={loading}>
            <I.Lock /> {loading ? "Locking\u2026" : `Lock ${fmtSats(e.amountMsats)} sats`}
          </button>
        )}
        {canBuyerVote && (
          <button style={{ ...S.actionBtn, background: "#059669" }} onClick={() => handleVote("release")} disabled={loading}>
            <I.Check /> {loading ? "Voting\u2026" : "I completed my side \u2014 Release"}
          </button>
        )}
        {canSellerVote && (
          <div style={{ display: "flex", gap: 8, width: "100%" }}>
            <button style={{ ...S.actionBtn, flex: 1, background: "#059669" }} onClick={() => handleVote("release")} disabled={loading}>
              <I.Check /> Confirm
            </button>
            <button style={{ ...S.actionBtn, flex: 1, background: "#b45309" }} onClick={() => handleVote("refund")} disabled={loading}>
              <I.Vote /> Dispute
            </button>
          </div>
        )}
        {canArbiterVote && (
          <div style={{ display: "flex", gap: 8, width: "100%" }}>
            <button style={{ ...S.actionBtn, flex: 1, background: "#059669" }} onClick={() => handleVote("release")} disabled={loading}>Release</button>
            <button style={{ ...S.actionBtn, flex: 1, background: "#b45309" }} onClick={() => handleVote("refund")} disabled={loading}>Refund</button>
          </div>
        )}
        {(canClaim || canReclaimExpired) && (
          <button style={{ ...S.actionBtn, background: "#059669" }} onClick={handleClaim} disabled={loading}>
            <I.Download /> {loading ? "Claiming\u2026" : `Claim ${fmtSats(e.amountMsats)} sats`}
          </button>
        )}
        {/* Waiting states */}
        {status === "LOCKED" && role === "buyer" && hasVoted && (
          <div style={S.waitBanner}><I.Clock /> Waiting for seller to respond\u2026</div>
        )}
        {status === "LOCKED" && role === "seller" && !buyerVoted && (
          <div style={S.waitBanner}><I.Clock /> Waiting for buyer to vote first\u2026</div>
        )}
        {status === "LOCKED" && role === "seller" && hasVoted && (
          <div style={S.waitBanner}><I.Clock /> Waiting for resolution\u2026</div>
        )}
        {status === "LOCKED" && role === "arbiter" && (!buyerVoted || !sellerVoted) && (
          <div style={S.waitBanner}><I.Clock /> Waiting for buyer and seller to vote\u2026</div>
        )}
        {status === "LOCKED" && role === "arbiter" && buyerVoted && sellerVoted && buyerOutcome === sellerOutcome && (
          <div style={S.waitBanner}><I.Check /> Buyer and seller agree \u2014 no dispute</div>
        )}
        {status === "FUNDED" && role !== "seller" && (
          <div style={S.waitBanner}><I.Lock /> Waiting for seller to lock funds\u2026</div>
        )}
        {status === "CREATED" && (
          <div style={S.waitBanner}><I.Clock /> Waiting for all parties to join\u2026</div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// STYLES — dark theme, mobile-first, Fedi aesthetic
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
  amountCard: { background: "#111827", border: "1px solid #1e293b", borderRadius: 14, padding: "20px", marginBottom: 12 },
  roleBanner: { display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.15)", borderRadius: 10, fontSize: 13, marginBottom: 12 },
  section: { marginBottom: 14 },
  sectionLabel: { fontSize: 11, fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 },
  sectionValue: { fontSize: 13, color: "#cbd5e1", lineHeight: 1.6 },
  participantRow: { display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid #111827" },
  participantLabel: { fontSize: 12, color: "#94a3b8", fontWeight: 500 },
  participantPk: { fontSize: 12, fontFamily: "monospace", color: "#64748b" },
  copyRow: { display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", padding: "8px 12px", background: "#111827", border: "1px solid #1e293b", borderRadius: 8, color: "#94a3b8" },
  mono: { fontFamily: "monospace", fontSize: 12, color: "#64748b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "85%" },
  voteBox: { flex: 1, textAlign: "center", padding: "8px 0" },
  voterRow: { display: "flex", justifyContent: "space-between", padding: "4px 0" },
  banner: { display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", borderRadius: 10, border: "1px solid", fontSize: 13, marginBottom: 12 },
  actionBar: { position: "sticky", bottom: 0, left: 0, right: 0, padding: "12px 0 20px", background: "linear-gradient(transparent, #0c0f17 20%)" },
  actionBtn: { display: "flex", alignItems: "center", justifyContent: "center", gap: 8, width: "100%", padding: "14px 0", borderRadius: 12, background: "#f59e0b", color: "#0c0f17", fontSize: 15, fontWeight: 700, letterSpacing: -0.2 },
  waitBanner: { display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "14px 0", color: "#64748b", fontSize: 13, fontWeight: 500 },
  devBar: { display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", background: "#1a1625", borderBottom: "1px solid #2d2640", position: "sticky", top: 0, zIndex: 100 },
  devLabel: { fontSize: 10, fontWeight: 700, color: "#7c3aed", letterSpacing: 1, marginRight: 4 },
  devBtn: { padding: "4px 12px", borderRadius: 6, background: "#111827", color: "#64748b", fontSize: 12, fontWeight: 500, border: "1px solid #1e293b", textTransform: "capitalize" },
  devBtnActive: { background: "#7c3aed", color: "#fff", borderColor: "#7c3aed" },
};
