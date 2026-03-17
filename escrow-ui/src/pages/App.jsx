import { useState, useEffect, useCallback } from "react";
import EcashEscrow from "./EcashEscrow";
import Marketplace from "./Marketplace";

// ═══════════════════════════════════════════════════════════════════════
// App Shell — Single source of truth for auth, sandbox mode, and routing
//
// The sandbox bar lives HERE and wraps both Escrow and Marketplace.
// Both child components receive pubkey/devRole as props — they never
// touch window.nostr in sandbox mode.
// ═══════════════════════════════════════════════════════════════════════

const DEV_IDENTITIES = {
  seller:  "aa".repeat(32),
  buyer:   "bb".repeat(32),
  arbiter: "cc".repeat(32),
};

// ── Fedi detection (runs once at module load) ─────────────────────────
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

let _fediConfirmed = false;
function _isFediRuntime() {
  if (_fediConfirmed) return true;
  if (_detectFediApp()) { _fediConfirmed = true; return true; }
  if (typeof window !== "undefined" && window.fediInternal) { _fediConfirmed = true; return true; }
  const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || "");
  if (isMobile && typeof window !== "undefined" && window.webln) { _fediConfirmed = true; return true; }
  return false;
}
function _isSandboxCheck() {
  if (typeof location !== "undefined" && new URLSearchParams(location.search).has("dev")) return true;
  return !_isFediRuntime();
}

// ═══════════════════════════════════════════════════════════════════════

// ── SatoshiMarket Landing Page ────────────────────────────────────────────
// The main satoshimarket.app domain showcases all 4 products

function LandingPage() {
  const [hoveredProduct, setHoveredProduct] = useState(null);

  return (
    <div style={{ background: "#0a0e17", minHeight: "100vh", color: "#f8fafc", fontFamily: "'SF Pro Text', -apple-system, system-ui, sans-serif", overflowX: "hidden" }}>
      <style>{`
        @keyframes fadeUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
        @keyframes orbit { from { transform: rotate(0deg) translateX(140px) rotate(0deg); } to { transform: rotate(360deg) translateX(140px) rotate(-360deg); } }
        @keyframes pulse2 { 0%,100% { opacity: 0.4; } 50% { opacity: 0.8; } }
        .product-card { transition: transform 0.3s, border-color 0.3s; }
        .product-card:hover { transform: translateY(-2px); }
      `}</style>

      {/* ── Hero with animated escrow visualization ── */}
      <div style={{ position: "relative", textAlign: "center", padding: "48px 24px 32px", overflow: "hidden" }}>
        {/* Background glow */}
        <div style={{ position: "absolute", top: "30%", left: "50%", transform: "translate(-50%, -50%)", width: 300, height: 300, borderRadius: "50%", background: "radial-gradient(circle, rgba(245,158,11,0.06) 0%, transparent 70%)", pointerEvents: "none" }} />

        {/* Orbiting nodes SVG */}
        <div style={{ position: "relative", width: 200, height: 200, margin: "0 auto 20px" }}>
          <svg viewBox="0 0 200 200" width="200" height="200" style={{ position: "absolute", top: 0, left: 0 }}>
            {/* Center lock */}
            <circle cx="100" cy="100" r="28" fill="#111827" stroke="#f59e0b" strokeWidth="1.5" />
            <path d="M92 105V100a8 8 0 1116 0v5" fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" />
            <rect x="88" y="103" width="24" height="16" rx="3" fill="#f59e0b" fillOpacity="0.2" stroke="#f59e0b" strokeWidth="1.5" />

            {/* Orbit ring */}
            <circle cx="100" cy="100" r="70" fill="none" stroke="#1e293b" strokeWidth="0.5" strokeDasharray="4 4" />

            {/* Participant nodes */}
            <g style={{ animation: "orbit 12s linear infinite" }}>
              <circle cx="100" cy="100" r="12" fill="#111827" stroke="#f59e0b" strokeWidth="1" />
              <text x="100" y="104" textAnchor="middle" fill="#f59e0b" fontSize="10" fontWeight="700">S</text>
            </g>
            <g style={{ animation: "orbit 12s linear infinite", animationDelay: "-4s" }}>
              <circle cx="100" cy="100" r="12" fill="#111827" stroke="#a78bfa" strokeWidth="1" />
              <text x="100" y="104" textAnchor="middle" fill="#a78bfa" fontSize="10" fontWeight="700">B</text>
            </g>
            <g style={{ animation: "orbit 12s linear infinite", animationDelay: "-8s" }}>
              <circle cx="100" cy="100" r="12" fill="#111827" stroke="#64748b" strokeWidth="1" />
              <text x="100" y="104" textAnchor="middle" fill="#64748b" fontSize="10" fontWeight="700">A</text>
            </g>
          </svg>
        </div>

        <div style={{ animation: "fadeUp 0.6s ease-out" }}>
          <img src="/satoshimarket-logo.png" alt="" style={{ height: 80, objectFit: "contain", marginBottom: 12 }} />
        </div>

        <h1 style={{ fontSize: 24, fontWeight: 900, letterSpacing: -0.5, margin: "0 0 8px", animation: "fadeUp 0.6s ease-out 0.1s both" }}>
          Non-Custodial Bitcoin<br/><span style={{ background: "linear-gradient(135deg, #f59e0b, #10b981)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>Marketplace Protocol</span>
        </h1>

        <p style={{ fontSize: 13, color: "#94a3b8", maxWidth: 320, margin: "0 auto 20px", lineHeight: 1.6, animation: "fadeUp 0.6s ease-out 0.15s both" }}>
          Trade, lend, and transact — secured by Shamir 2-of-3 escrow on Fedimint e-cash.
        </p>

        {/* Stats row */}
        <div style={{ display: "flex", justifyContent: "center", gap: 20, animation: "fadeUp 0.6s ease-out 0.2s both" }}>
          {[
            { val: "2-of-3", label: "Escrow", color: "#f59e0b" },
            { val: "0%", label: "Custody", color: "#10b981" },
            { val: "~1s", label: "Settlement", color: "#a78bfa" },
          ].map(s => (
            <div key={s.label} style={{ textAlign: "center" }}>
              <div style={{ fontSize: 18, fontWeight: 900, color: s.color }}>{s.val}</div>
              <div style={{ fontSize: 9, color: "#475569", textTransform: "uppercase", letterSpacing: 0.5 }}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Products Grid ── */}
      <div style={{ padding: "0 16px 24px" }}>
        <div style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: 1, textAlign: "center", marginBottom: 14 }}>Four products, one protocol</div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {[
            { name: "Escrow", emoji: "⚖️", desc: "Raw 2-of-3 multisig", url: "https://escrow.satoshimarket.app", color: "#64748b", bg: "rgba(100,116,139,0.06)", border: "#1e293b" },
            { name: "P2P", emoji: "₿", desc: "Buy & sell Bitcoin", url: "https://p2p.satoshimarket.app", color: "#f59e0b", bg: "rgba(245,158,11,0.06)", border: "rgba(245,158,11,0.15)" },
            { name: "Market", emoji: "🛒", desc: "Buy anything with sats", url: "https://market.satoshimarket.app", color: "#a78bfa", bg: "rgba(139,92,246,0.06)", border: "rgba(139,92,246,0.15)" },
            { name: "Lending", emoji: "🤝", desc: "Community loans", url: "https://lending.satoshimarket.app", color: "#10b981", bg: "rgba(16,185,129,0.06)", border: "rgba(16,185,129,0.15)" },
          ].map((p, i) => (
            <a key={p.name} href={p.url} className="product-card" style={{
              display: "flex", flexDirection: "column", alignItems: "center", padding: "18px 12px", borderRadius: 14,
              background: p.bg, border: "1px solid " + p.border, textDecoration: "none", textAlign: "center",
              animation: "fadeUp 0.5s ease-out " + (0.1 + i * 0.08) + "s both",
            }}>
              <span style={{ fontSize: 28, marginBottom: 8 }}>{p.emoji}</span>
              <div style={{ fontSize: 14, fontWeight: 800, color: p.color, marginBottom: 4 }}>{p.name}</div>
              <div style={{ fontSize: 10, color: "#94a3b8", lineHeight: 1.4 }}>{p.desc}</div>
              <div style={{ fontSize: 9, color: "#475569", marginTop: 8 }}>Open in Fedi →</div>
            </a>
          ))}
        </div>
      </div>

      {/* ── How It Works — visual flow ── */}
      <div style={{ padding: "8px 16px 24px" }}>
        <div style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: 1, textAlign: "center", marginBottom: 14 }}>How it works</div>

        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 0, padding: "0 8px" }}>
          {[
            { step: "1", icon: "🔐", label: "Lock sats", color: "#f59e0b" },
            { step: "", icon: "→", label: "", color: "#1e293b" },
            { step: "2", icon: "🗳️", label: "Vote 2-of-3", color: "#a78bfa" },
            { step: "", icon: "→", label: "", color: "#1e293b" },
            { step: "3", icon: "⚡", label: "Claim", color: "#10b981" },
          ].map((s, i) => s.step ? (
            <div key={i} style={{ textAlign: "center", flex: 1 }}>
              <div style={{ width: 44, height: 44, borderRadius: "50%", background: s.color + "15", border: "1px solid " + s.color + "30", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 6px", fontSize: 18 }}>{s.icon}</div>
              <div style={{ fontSize: 10, color: s.color, fontWeight: 700 }}>{s.label}</div>
            </div>
          ) : (
            <div key={i} style={{ color: "#334155", fontSize: 16, padding: "0 2px" }}>→</div>
          ))}
        </div>
      </div>

      {/* ── Technology ── */}
      <div style={{ padding: "0 16px 24px" }}>
        <div style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: 1, textAlign: "center", marginBottom: 14 }}>Built different</div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {[
            { icon: "🔐", title: "Shamir SSS", desc: "Notes split 2-of-3. Server can't access funds.", color: "#f59e0b" },
            { icon: "⚡", title: "Fedimint", desc: "Instant e-cash. No Lightning routing.", color: "#10b981" },
            { icon: "🔑", title: "Nostr Auth", desc: "One key. No passwords. No accounts.", color: "#a78bfa" },
            { icon: "🌍", title: "M-Pesa", desc: "Bitcoin to mobile money via ChapSmart.", color: "#3b82f6" },
          ].map((f, i) => (
            <div key={f.title} style={{
              padding: "12px", borderRadius: 10, background: "#111827", border: "1px solid #1e293b",
              animation: "fadeUp 0.5s ease-out " + (0.2 + i * 0.08) + "s both",
            }}>
              <div style={{ fontSize: 20, marginBottom: 4 }}>{f.icon}</div>
              <div style={{ fontSize: 11, fontWeight: 700, color: f.color, marginBottom: 3 }}>{f.title}</div>
              <div style={{ fontSize: 10, color: "#94a3b8", lineHeight: 1.4 }}>{f.desc}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Learn ── */}
      <div style={{ padding: "0 16px 24px" }}>
        <div style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: 1, textAlign: "center", marginBottom: 14 }}>Learn</div>

        {[
          { icon: "₿", title: "What is Bitcoin?", desc: "Sound money for the digital age", url: "https://bitcoin.org/en/getting-started", color: "#f7931a" },
          { icon: "🛡️", title: "What is Fedi?", desc: "The private Bitcoin wallet for communities", url: "https://www.fedi.xyz", color: "#a78bfa" },
          { icon: "🏛️", title: "Federated Custody", desc: "Multi-guardian Bitcoin security", url: "https://fedimint.org", color: "#10b981" },
        ].map(l => (
          <a key={l.title} href={l.url} target="_blank" rel="noopener noreferrer" style={{
            display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderRadius: 10,
            background: "#111827", border: "1px solid #1e293b", textDecoration: "none", marginBottom: 8,
          }}>
            <span style={{ fontSize: 20, width: 28, textAlign: "center" }}>{l.icon}</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: l.color }}>{l.title}</div>
              <div style={{ fontSize: 10, color: "#64748b" }}>{l.desc}</div>
            </div>
            <span style={{ color: "#334155", fontSize: 12 }}>↗</span>
          </a>
        ))}
      </div>

      {/* ── Community ── */}
      <div style={{ padding: "0 16px 24px", textAlign: "center" }}>
        <div style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: 1, marginBottom: 14 }}>Community</div>

        <div style={{ display: "flex", gap: 8, justifyContent: "center", marginBottom: 16 }}>
          <a href="fedi:community210v3xzat5dphhyhmsw43xketeygazyv33vvmnzvmxx5unqwpkxdnxxvfs893rjwfcvsukxcmzxsmkxcnyvf3kywpnxscxzdnyxq6rvcmpxuengvp4xdsn2wfcvymrgvpexesjytpzvdhk6mt4de5hg72lw46kjezldpjhsg36yfskyephv5cnqwpjvdnrqenrxpnrxvmrxs6nscfkxymnvdrpv4jngwpjvdskgce3xy6nvdf5vfjxyef4x9jrvceevejrvcenxcekydtrygkzyer9vde8jur5d9hkuhmtv4ujyw3zvymkvmr0gcu4wuth2eh9zkr9vdc8z3m4w4m56v60w3j9zwrpxdvhw3n9ga3kwcfcgc4kk0fz05fkv4p3" style={{
            padding: "8px 16px", borderRadius: 8, background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.15)",
            color: "#f59e0b", fontSize: 12, fontWeight: 600, textDecoration: "none",
          }}>🇬🇧 English</a>
          <a href="fedi:community210v3xzat5dphhyhmsw43xketeygazyde5xf3kzvpnx9skzdnyxpjrvdm9xpskzc3kxucrxwpex33xxe3exvmnxvtxv9jryefexsmnqvty8yunvd35vgunywrzxvmrsvpj8q6jytpzvdhk6mt4de5hg72lw46kjezldpjhsg36yfnrqcf3vserxvfevyck2wtyxanxzvf5x9skgdfhvd3rwc3jv5crsetyx3jxvdesxserxerpvdskzcehxpjr2wf5vymkxenpx56kvwrpygkzyer9vde8jur5d9hkuhmtv4ujyw3zfphhy3t3vym8sd6vg4a9v6n2fsek7m6k23ux6v6ytp65jeekd4pkj5nzw39xcanh0pkrg0fz055t3dve" style={{
            padding: "8px 16px", borderRadius: 8, background: "rgba(59,130,246,0.08)", border: "1px solid rgba(59,130,246,0.15)",
            color: "#3b82f6", fontSize: 12, fontWeight: 600, textDecoration: "none",
          }}>🇫🇷 Français</a>
        </div>

        <a href="https://fedi.xyz/product" target="_blank" rel="noopener noreferrer" style={{
          display: "inline-flex", alignItems: "center", gap: 8, padding: "12px 24px", borderRadius: 10,
          background: "linear-gradient(135deg, #10b981, #059669)", color: "#fff", fontSize: 14, fontWeight: 700, textDecoration: "none",
        }}>📲 Download Fedi</a>
      </div>

      {/* ── Footer ── */}
      <div style={{ textAlign: "center", padding: "16px 16px 32px", borderTop: "1px solid #111827" }}>
        <div style={{ fontSize: 10, color: "#334155", marginBottom: 8 }}>⚡ EST. BLOCK 934,669 🥜</div>
        <div style={{ display: "flex", gap: 16, justifyContent: "center", fontSize: 11 }}>
          <a href="https://github.com/jesuspirate/federated-escrow" target="_blank" rel="noopener noreferrer" style={{ color: "#f59e0b", textDecoration: "none" }}>GitHub ↗</a>
          <a href="https://sandbox.satoshimarket.app" style={{ color: "#475569", textDecoration: "none" }}>🧪 Sandbox</a>
        </div>
        <div style={{ fontSize: 9, color: "#1e293b", marginTop: 8 }}>Non-custodial · Shamir 2-of-3 · Fedimint · Nostr</div>
      </div>
    </div>
  );
}


export default function App() {
  // ── Subdomain routing ──────────────────────────────────────────
  const subdomain = (() => {
    const host = window.location.hostname;
    if (host.startsWith("escrow.")) return "escrow";
    if (host.startsWith("p2p.")) return "p2p";
    if (host.startsWith("lending.")) return "lending";
    if (host.startsWith("market.")) return "market";
    return "marketplace"; // satoshimarket.app (legacy)
  })();
  const [activeApp, setActiveApp] = useState(subdomain === "escrow" ? "escrow" : "marketplace");
  const [initialEscrowId, setInitialEscrowId] = useState(null);
  const [initialMarketplaceEscrowId, setInitialMarketplaceEscrowId] = useState(null);

  // ── Auth state (single source of truth) ─────────────────────────
  const [pubkey, setPubkey] = useState(_isSandboxCheck() ? DEV_IDENTITIES["seller"] : null);
  const [devRole, setDevRole] = useState("seller");

  // Resolve pubkey once on mount
  useEffect(() => {
    if (_isSandboxCheck()) {
      setPubkey(DEV_IDENTITIES[devRole]);
      return;
    }
    // Fedi: get real Nostr pubkey
    (async () => {
      // Try sessionStorage first (fast, no prompt)
      try {
        const cached = sessionStorage.getItem("nostr_pubkey");
        if (cached) { setPubkey(cached); return; }
      } catch {}
      // Ask Fedi for pubkey
      try {
        const pk = await window.nostr?.getPublicKey();
        if (pk) {
          setPubkey(pk);
          try { sessionStorage.setItem("nostr_pubkey", pk); } catch {}
          return;
        }
      } catch {}
      // Fallback to sandbox if all else fails
      setPubkey(DEV_IDENTITIES[devRole]);
    })();
  }, []);

  // Sandbox role switch
  const switchDevIdentity = useCallback((role) => {
    setDevRole(role);
    setPubkey(DEV_IDENTITIES[role]);
  }, []);

  // ── Navigation ──────────────────────────────────────────────────
  const switchToEscrow = useCallback((escrowId) => {
    setInitialEscrowId(escrowId || null);
    setActiveApp("escrow");
  }, []);

  const switchToMarketplace = useCallback((escrowId = null) => {
    setInitialEscrowId(null);
    setInitialMarketplaceEscrowId(escrowId || null);
    setActiveApp("marketplace");
  }, []);

  const switchToMarketplaceOrders = useCallback(() => {
    setInitialEscrowId(null);
    setInitialMarketplaceEscrowId("__ORDERS__");
    setActiveApp("marketplace");
  }, []);

  // ── Landing page for root domain ──────────────────────────────
  // Landing page for root domain (satoshimarket.app) — not sandbox, not subdomains
  if (subdomain === "marketplace") {
    return <LandingPage />;
  }

  // ── Loading state ───────────────────────────────────────────────
  if (!pubkey) {
    return (
      <div style={{ background: "#0c0f17", color: "#e2e8f0", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <p style={{ color: "#94a3b8", fontSize: 14 }}>Connecting...</p>
      </div>
    );
  }

  return (
    <div style={{ background: "#0c0f17", height: "100dvh", maxHeight: "100vh", display: "flex", flexDirection: "column" }}>
      {/* ── Sandbox bar — always visible, fixed at top ── */}
      {_isSandboxCheck() && (
        <div style={{
          display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
          padding: "10px 14px 12px",
          background: "linear-gradient(180deg, #1a1428, #12101d)",
          borderBottom: "1px solid #2d264080",
          flexShrink: 0,
          zIndex: 200,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#f59e0b" }} />
            <span style={{ fontSize: 12, fontWeight: 800, color: "#f59e0b", letterSpacing: 1, textTransform: "uppercase" }}>Sandbox</span>
            <div style={{ width: 1, height: 14, background: "#2d2640" }} />
            <span style={{ fontSize: 11, color: "#64748b" }}>Play as:</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            {["seller", "buyer", "arbiter"].map(r => (
              <button key={r} onClick={() => switchDevIdentity(r)} style={{
                padding: "6px 12px", borderRadius: 8,
                background: devRole === r ? "rgba(245,158,11,0.12)" : "#111827",
                color: devRole === r ? "#fbbf24" : "#64748b",
                fontSize: 12, fontWeight: 600,
                border: devRole === r ? "1px solid rgba(245,158,11,0.3)" : "1px solid transparent",
                cursor: "pointer", textTransform: "capitalize",
                WebkitTapHighlightColor: "rgba(0,0,0,0)",
              }}>
                {r === "seller" ? "🏠" : r === "buyer" ? "🛒" : "⚖️"} {r}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Active view ── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      {(activeApp === "escrow" || subdomain === "escrow") && (
        <EcashEscrow
          pubkey={pubkey}
          devRole={devRole}
          subdomain={subdomain}
          onSwitchToMarketplace={switchToMarketplace}
          onSwitchToMarketplaceOrders={switchToMarketplaceOrders}
          initialEscrowId={initialEscrowId}
          onEscrowOpened={() => setInitialEscrowId(null)}
        />
      )}
      {activeApp === "marketplace" && (
        <Marketplace
          pubkey={pubkey}
          devRole={devRole}
          subdomain={subdomain}
          onSwitchToEscrow={switchToEscrow}
          initialEscrowId={initialMarketplaceEscrowId}
          onOpened={() => setInitialMarketplaceEscrowId(null)}
        />
      )}
      </div>
    </div>
  );
}
