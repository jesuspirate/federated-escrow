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
      {activeApp === "escrow" && (
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
