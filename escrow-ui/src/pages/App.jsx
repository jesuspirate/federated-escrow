import { useState, useEffect, useCallback } from "react";
import EcashEscrow from "./EcashEscrow";
import Marketplace from "./Marketplace";

// ═══════════════════════════════════════════════════════════════════════
// App Shell — Switches between Escrow and Marketplace
//
// This wraps both components and provides bi-directional navigation.
// EcashEscrow gets an onSwitchToMarketplace prop.
// Marketplace gets an onSwitchToEscrow prop.
//
// In your main.jsx, replace:
//   import EcashEscrow from "./pages/EcashEscrow";
// with:
//   import App from "./pages/App";
// and render <App /> instead of <EcashEscrow />
// ═══════════════════════════════════════════════════════════════════════

export default function App() {
  const [activeApp, setActiveApp] = useState("marketplace"); // "escrow" | "marketplace"
  const [initialEscrowId, setInitialEscrowId] = useState(null);
  const [sharedPubkey, setSharedPubkey] = useState(null); // shared across both apps — avoids double NIP-98 prompt

  const switchToEscrow = useCallback((escrowId) => {
    setInitialEscrowId(escrowId || null);
    setActiveApp("escrow");
  }, []);

  const [initialMarketplaceEscrowId, setInitialMarketplaceEscrowId] = useState(null);

  const switchToMarketplace = useCallback((escrowId = null) => {
    setInitialEscrowId(null);
    setInitialMarketplaceEscrowId(escrowId || null);
    setActiveApp("marketplace");
  }, []);

  return (
    <>
      {activeApp === "escrow" && (
        <EcashEscrow
          onSwitchToMarketplace={switchToMarketplace}
          initialEscrowId={initialEscrowId}
          onEscrowOpened={() => setInitialEscrowId(null)}
          sharedPubkey={sharedPubkey}
          onPubkeyResolved={setSharedPubkey}
        />
      )}
      {activeApp === "marketplace" && (
        <MarketplaceShell onSwitchToEscrow={switchToEscrow} initialEscrowId={initialMarketplaceEscrowId} onOpened={() => setInitialMarketplaceEscrowId(null)} sharedPubkey={sharedPubkey} onPubkeyResolved={setSharedPubkey} />
      )}
    </>
  );
}

// ── MarketplaceShell — handles auth before rendering Marketplace ──────
// Replicates the same auth flow as EcashEscrow so both components
// share the same pubkey and dev mode state.

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

function isDevMode() { return _forceDevMode || !_isFediApp; }

function MarketplaceShell({ onSwitchToEscrow, initialEscrowId, onOpened, sharedPubkey, onPubkeyResolved }) {
  const [pubkey, setPubkey] = useState(sharedPubkey || null);
  const [devRole, setDevRole] = useState("seller");

  useEffect(() => {
    if (sharedPubkey) { setPubkey(sharedPubkey); return; } // skip re-auth if already known
    (async () => {
      if (_forceDevMode || !_isFediApp) {
        setPubkey(DEV_IDENTITIES[devRole]);
        return;
      }
      try {
        const pk = await window.nostr?.getPublicKey();
        if (pk) {
          setPubkey(pk);
          if (onPubkeyResolved) onPubkeyResolved(pk);
          try { sessionStorage.setItem("nostr_pubkey", pk); } catch {}
          return;
        }
      } catch {}
      setPubkey(DEV_IDENTITIES[devRole]);
    })();
  }, [sharedPubkey]);

  const switchDevIdentity = useCallback((role) => {
    setDevRole(role);
    setPubkey(DEV_IDENTITIES[role]);
  }, []);

  if (!pubkey) {
    return (
      <div style={{ background: "#0c0f17", color: "#e2e8f0", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <p style={{ color: "#94a3b8", fontSize: 14 }}>Connecting...</p>
      </div>
    );
  }

  return (
    <div style={{ background: "#0c0f17", minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      {/* Dev mode sandbox bar */}
      {isDevMode() && (
        <div style={{
          display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
          padding: "10px 14px 12px",
          background: "linear-gradient(180deg, #1a1428, #12101d)",
          borderBottom: "1px solid #2d264080",
          position: "sticky", top: 0, zIndex: 100,
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
                border: devRole === r ? "1px solid rgba(245,158,11,0.3)" : "1px solid #1e293b",
                cursor: "pointer", textTransform: "capitalize",
              }}>
                {r === "seller" ? "🏠" : r === "buyer" ? "🛒" : "⚖️"} {r}
              </button>
            ))}
          </div>
        </div>
      )}
      <Marketplace pubkey={pubkey} devRole={devRole} onSwitchToEscrow={onSwitchToEscrow} initialEscrowId={initialEscrowId} onOpened={onOpened} />
    </div>
  );
}
