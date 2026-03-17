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
  const products = [
    {
      name: "Escrow",
      emoji: "⚖️",
      tagline: "Raw 2-of-3 multisig escrow",
      desc: "Lock sats, vote, claim. Pure cypherpunk primitive. Any arbiter, any trade, any amount.",
      url: "https://escrow.satoshimarket.app",
      color: "#64748b",
      bg: "rgba(100,116,139,0.08)",
      border: "rgba(100,116,139,0.2)",
    },
    {
      name: "P2P Exchange",
      emoji: "₿",
      tagline: "Buy & sell Bitcoin peer-to-peer",
      desc: "Seller locks sats, buyer sends fiat. Both confirm. No middleman, no KYC, pure freedom.",
      url: "https://p2p.satoshimarket.app",
      color: "#f59e0b",
      bg: "rgba(245,158,11,0.08)",
      border: "rgba(245,158,11,0.2)",
    },
    {
      name: "Marketplace",
      emoji: "🛒",
      tagline: "Buy anything with Bitcoin",
      desc: "Buyer pays with sats, seller ships. Escrow protects both. ChapSmart M-Pesa integration for East Africa.",
      url: "https://market.satoshimarket.app",
      color: "#a78bfa",
      bg: "rgba(139,92,246,0.08)",
      border: "rgba(139,92,246,0.2)",
    },
    {
      name: "Community Lending",
      emoji: "🤝",
      tagline: "Lend & borrow within your community",
      desc: "Lender locks sats, borrower confirms. Repayment tracked. Trust built through escrow.",
      url: "https://lending.satoshimarket.app",
      color: "#10b981",
      bg: "rgba(16,185,129,0.08)",
      border: "rgba(16,185,129,0.2)",
    },
  ];

  const features = [
    { icon: "🔐", title: "Shamir Secret Sharing", desc: "E-cash notes split into 2-of-3 shares. Server never holds full funds. Mathematically non-custodial." },
    { icon: "⚡", title: "Fedimint E-Cash", desc: "Instant, private transactions powered by federated e-cash. No Lightning routing fees, no waiting." },
    { icon: "🔑", title: "Nostr Authentication", desc: "One key, one identity. NIP-98 signed sessions. No passwords, no emails, no accounts to manage." },
    { icon: "🌍", title: "M-Pesa Integration", desc: "Bitcoin to mobile money via ChapSmart. Send TZS, buy airtime, or purchase sats from East Africa." },
  ];

  return (
    <div style={{ background: "#0a0e17", minHeight: "100vh", color: "#f8fafc", fontFamily: "'SF Pro Text', -apple-system, system-ui, sans-serif" }}>
      <style>{`
        @keyframes fadeUp { from { opacity: 0; transform: translateY(30px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes glow { 0%, 100% { opacity: 0.3; } 50% { opacity: 0.6; } }
        @keyframes float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-8px); } }
      `}</style>

      {/* ── Hero ── */}
      <div style={{ textAlign: "center", padding: "60px 24px 40px", position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", width: 400, height: 400, borderRadius: "50%", background: "radial-gradient(circle, rgba(245,158,11,0.08) 0%, transparent 70%)", animation: "glow 4s ease infinite", pointerEvents: "none" }} />
        
        <img src="/satoshimarket-logo.png" alt="SatoshiMarket" style={{ height: 120, objectFit: "contain", animation: "fadeUp 0.8s ease-out", position: "relative" }} />
        
        <h1 style={{ fontSize: 28, fontWeight: 900, letterSpacing: -1, margin: "16px 0 8px", animation: "fadeUp 0.8s ease-out 0.1s both", position: "relative" }}>
          The Bitcoin-Native<br/><span style={{ color: "#f59e0b" }}>Marketplace Protocol</span>
        </h1>
        
        <p style={{ fontSize: 14, color: "#94a3b8", maxWidth: 360, margin: "0 auto 24px", lineHeight: 1.6, animation: "fadeUp 0.8s ease-out 0.2s both", position: "relative" }}>
          Trade, lend, and transact with Bitcoin — secured by Shamir 2-of-3 escrow on Fedimint e-cash. Non-custodial. No KYC. Unstoppable.
        </p>

        <div style={{ display: "flex", justifyContent: "center", gap: 24, flexWrap: "wrap", animation: "fadeUp 0.8s ease-out 0.3s both", position: "relative" }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 22, fontWeight: 900, color: "#f59e0b" }}>2-of-3</div>
            <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5 }}>Escrow</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 22, fontWeight: 900, color: "#10b981" }}>0%</div>
            <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5 }}>Custody</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 22, fontWeight: 900, color: "#a78bfa" }}>~1s</div>
            <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5 }}>Settlement</div>
          </div>
        </div>
      </div>

      {/* ── Products ── */}
      <div style={{ padding: "0 16px 32px" }}>
        <h2 style={{ fontSize: 18, fontWeight: 800, textAlign: "center", marginBottom: 20, color: "#e2e8f0" }}>Four Products, One Protocol</h2>
        
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {products.map((p, i) => (
            <a key={p.name} href={p.url} style={{
              display: "block", padding: "18px 16px", borderRadius: 14,
              background: p.bg, border: "1px solid " + p.border,
              textDecoration: "none", color: "#f8fafc",
              animation: "fadeUp 0.6s ease-out " + (0.1 + i * 0.1) + "s both",
              transition: "transform 0.2s, box-shadow 0.2s",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
                <span style={{ fontSize: 24 }}>{p.emoji}</span>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 800, color: p.color }}>{p.name}</div>
                  <div style={{ fontSize: 11, color: "#94a3b8" }}>{p.tagline}</div>
                </div>
                <span style={{ marginLeft: "auto", fontSize: 18, color: "#475569" }}>→</span>
              </div>
              <div style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.5, paddingLeft: 36 }}>{p.desc}</div>
            </a>
          ))}
        </div>
      </div>

      {/* ── Technology ── */}
      <div style={{ padding: "0 16px 32px" }}>
        <h2 style={{ fontSize: 18, fontWeight: 800, textAlign: "center", marginBottom: 20, color: "#e2e8f0" }}>Built Different</h2>
        
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {features.map((f, i) => (
            <div key={f.title} style={{
              padding: 14, borderRadius: 12,
              background: "#111827", border: "1px solid #1e293b",
              animation: "fadeUp 0.6s ease-out " + (0.2 + i * 0.1) + "s both",
            }}>
              <div style={{ fontSize: 24, marginBottom: 6 }}>{f.icon}</div>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#f8fafc", marginBottom: 4 }}>{f.title}</div>
              <div style={{ fontSize: 10, color: "#94a3b8", lineHeight: 1.5 }}>{f.desc}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── What is Fedi / Bitcoin ── */}
      <div style={{ padding: "0 16px 32px" }}>
        <h2 style={{ fontSize: 18, fontWeight: 800, textAlign: "center", marginBottom: 20, color: "#e2e8f0" }}>New to Bitcoin?</h2>
        
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <a href="https://bitcoin.org/en/getting-started" target="_blank" rel="noopener noreferrer" style={{
            display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", borderRadius: 12,
            background: "rgba(247,147,26,0.06)", border: "1px solid rgba(247,147,26,0.15)",
            textDecoration: "none", color: "#f8fafc",
          }}>
            <span style={{ fontSize: 24 }}>₿</span>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#f7931a" }}>What is Bitcoin?</div>
              <div style={{ fontSize: 11, color: "#94a3b8" }}>Sound money for the digital age. Peer-to-peer, censorship-resistant, finite supply.</div>
            </div>
          </a>
          
          <a href="https://www.fedi.xyz" target="_blank" rel="noopener noreferrer" style={{
            display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", borderRadius: 12,
            background: "rgba(139,92,246,0.06)", border: "1px solid rgba(139,92,246,0.15)",
            textDecoration: "none", color: "#f8fafc",
          }}>
            <span style={{ fontSize: 24 }}>🛡️</span>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#a78bfa" }}>What is Fedi?</div>
              <div style={{ fontSize: 11, color: "#94a3b8" }}>Federated custody for Bitcoin communities. Your keys, your community, your money.</div>
            </div>
          </a>
          
          <a href="https://fedimint.org" target="_blank" rel="noopener noreferrer" style={{
            display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", borderRadius: 12,
            background: "rgba(16,185,129,0.06)", border: "1px solid rgba(16,185,129,0.15)",
            textDecoration: "none", color: "#f8fafc",
          }}>
            <span style={{ fontSize: 24 }}>🏛️</span>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#10b981" }}>What is Federated Custody?</div>
              <div style={{ fontSize: 11, color: "#94a3b8" }}>Multi-guardian Bitcoin custody. No single point of failure. Community-managed security.</div>
            </div>
          </a>
        </div>
      </div>

      {/* ── Community ── */}
      <div style={{ padding: "0 16px 32px" }}>
        <h2 style={{ fontSize: 18, fontWeight: 800, textAlign: "center", marginBottom: 20, color: "#e2e8f0" }}>Join the Community</h2>
        
        <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
          <a href="fedi:community210v3xzat5dphhyhmsw43xketeygazyv33vvmnzvmxx5unqwpkxdnxxvfs893rjwfcvsukxcmzxsmkxcnyvf3kywpnxscxzdnyxq6rvcmpxuengvp4xdsn2wfcvymrgvpexesjytpzvdhk6mt4de5hg72lw46kjezldpjhsg36yfskyephv5cnqwpjvdnrqenrxpnrxvmrxs6nscfkxymnvdrpv4jngwpjvdskgce3xy6nvdf5vfjxyef4x9jrvceevejrvcenxcekydtrygkzyer9vde8jur5d9hkuhmtv4ujyw3zvymkvmr0gcu4wuth2eh9zkr9vdc8z3m4w4m56v60w3j9zwrpxdvhw3n9ga3kwcfcgc4kk0fz05fkv4p3" style={{
            display: "inline-flex", alignItems: "center", gap: 6, padding: "10px 16px", borderRadius: 10,
            background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.2)",
            color: "#f59e0b", fontSize: 13, fontWeight: 600, textDecoration: "none",
          }}>🇬🇧 English Community</a>
          
          <a href="fedi:community210v3xzat5dphhyhmsw43xketeygazyde5xf3kzvpnx9skzdnyxpjrvdm9xpskzc3kxucrxwpex33xxe3exvmnxvtxv9jryefexsmnqvty8yunvd35vgunywrzxvmrsvpj8q6jytpzvdhk6mt4de5hg72lw46kjezldpjhsg36yfnrqcf3vserxvfevyck2wtyxanxzvf5x9skgdfhvd3rwc3jv5crsetyx3jxvdesxserxerpvdskzcehxpjr2wf5vymkxenpx56kvwrpygkzyer9vde8jur5d9hkuhmtv4ujyw3zfphhy3t3vym8sd6vg4a9v6n2fsek7m6k23ux6v6ytp65jeekd4pkj5nzw39xcanh0pkrg0fz055t3dve" style={{
            display: "inline-flex", alignItems: "center", gap: 6, padding: "10px 16px", borderRadius: 10,
            background: "rgba(59,130,246,0.08)", border: "1px solid rgba(59,130,246,0.2)",
            color: "#3b82f6", fontSize: 13, fontWeight: 600, textDecoration: "none",
          }}>🇫🇷 Communauté Française</a>
        </div>
      </div>

      {/* ── Download ── */}
      <div style={{ padding: "0 16px 32px", textAlign: "center" }}>
        <a href="https://fedi.xyz/product" target="_blank" rel="noopener noreferrer" style={{
          display: "inline-flex", alignItems: "center", gap: 8, padding: "14px 28px", borderRadius: 12,
          background: "linear-gradient(135deg, #10b981, #059669)",
          color: "#fff", fontSize: 15, fontWeight: 700, textDecoration: "none",
          boxShadow: "0 4px 20px rgba(16,185,129,0.3)",
        }}>📲 Download Fedi to Start Trading</a>
      </div>

      {/* ── Footer ── */}
      <div style={{ textAlign: "center", padding: "24px 16px 40px", borderTop: "1px solid #1e293b" }}>
        <div style={{ fontSize: 11, color: "#475569", marginBottom: 8 }}>
          ⚡ EST. BLOCK 934,669 🥜 · Open source
        </div>
        <a href="https://github.com/jesuspirate/federated-escrow" target="_blank" rel="noopener noreferrer" style={{ color: "#f59e0b", fontSize: 12, textDecoration: "none", fontWeight: 600 }}>
          GitHub ↗
        </a>
        <div style={{ fontSize: 10, color: "#334155", marginTop: 12 }}>
          Non-custodial · Shamir 2-of-3 · Fedimint · Nostr · Built for Fedi
        </div>
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
  if (subdomain === "marketplace" && !_isSandboxCheck()) {
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
