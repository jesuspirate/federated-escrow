// escrow-ui/src/pages/NotificationSettings.jsx
//
// Phase 5: Notification preferences UI.
//
// Renders as a view inside Marketplace (same pattern as OrdersView, SellerProfileView).
// Uses the same auth headers (NIP-98 or X-Dev-Pubkey) as other API calls.
//
// Add to Marketplace.jsx:
//   import NotificationSettings, { NotifBellIcon } from "./NotificationSettings";
//   // In the view router: {view === "notifications" && <NotificationSettings ... />}
//   // In the BrowseView header: <NotifBellIcon onClick={() => setView("notifications")} />

import { useState, useEffect, useCallback } from "react";

const API_BASE = typeof location !== "undefined"
  ? `${location.protocol}//${location.host}/api`
  : "http://localhost:3000/api";

// ── Bell Icon (for nav bar) ───────────────────────────────────────────────

export function NotifBellIcon({ onClick, style = {} }) {
  return (
    <button
      onClick={onClick}
      title="Notification Settings"
      style={{
        background: "none",
        border: "none",
        cursor: "pointer",
        padding: 6,
        display: "flex",
        alignItems: "center",
        ...style,
      }}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      </svg>
    </button>
  );
}

// ── Notification Settings View ────────────────────────────────────────────

export default function NotificationSettings({ pubkey, onBack, showToast }) {
  const [prefs, setPrefs] = useState(null);
  const [systemStatus, setSystemStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testSending, setTestSending] = useState(false);

  const headers = useCallback(() => {
    const h = { "Content-Type": "application/json" };
    // Dev mode sends X-Dev-Pubkey; production sends NIP-98 (handled by authFetch in the real app)
    if (pubkey) h["X-Dev-Pubkey"] = pubkey;
    return h;
  }, [pubkey]);

  // Load system status + user preferences
  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [statusRes, prefsRes] = await Promise.all([
          fetch(`${API_BASE}/notifications/status`),
          fetch(`${API_BASE}/notifications/preferences`, { headers: headers() }),
        ]);
        if (statusRes.ok) setSystemStatus(await statusRes.json());
        if (prefsRes.ok) setPrefs(await prefsRes.json());
      } catch (err) {
        console.error("Failed to load notification settings:", err);
      }
      setLoading(false);
    }
    load();
  }, [pubkey]);

  // Save preference toggle
  const toggle = async (key) => {
    const updated = { ...prefs, [key]: !prefs[key] };
    setPrefs(updated);
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/notifications/preferences`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          dmEnabled: updated.dmEnabled,
          escrowUpdates: updated.escrowUpdates,
          orderUpdates: updated.orderUpdates,
          listingSold: updated.listingSold,
        }),
      });
      if (!res.ok) throw new Error("Failed to save");
      const data = await res.json();
      setPrefs(data);
    } catch (err) {
      // Revert on error
      setPrefs(prefs);
      showToast?.("Failed to save preferences", "error");
    }
    setSaving(false);
  };

  // Send test DM
  const sendTest = async () => {
    setTestSending(true);
    try {
      const res = await fetch(`${API_BASE}/notifications/test`, {
        method: "POST",
        headers: headers(),
      });
      const data = await res.json();
      showToast?.(data.message || (data.sent ? "Test sent!" : "Test failed"), data.sent ? "success" : "error");
    } catch {
      showToast?.("Failed to send test DM", "error");
    }
    setTestSending(false);
  };

  // ── Render ──────────────────────────────────────────────────────────────

  const s = styles;

  return (
    <div style={s.container}>
      {/* Header */}
      <div style={s.header}>
        <button onClick={onBack} style={s.backBtn}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <span style={s.headerTitle}>Notifications</span>
        <div style={{ width: 32 }} />
      </div>

      {loading ? (
        <div style={s.center}>
          <div style={s.spinner} />
        </div>
      ) : (
        <div style={s.content}>
          {/* System Status */}
          <div style={s.statusCard}>
            <div style={s.statusRow}>
              <span style={{ fontSize: 20 }}>
                {systemStatus?.enabled ? "🟢" : "🔴"}
              </span>
              <div>
                <div style={s.statusLabel}>
                  {systemStatus?.enabled ? "Notifications Active" : "Notifications Unavailable"}
                </div>
                <div style={s.statusSub}>
                  {systemStatus?.enabled
                    ? `Encrypted via NIP-44 • ${systemStatus?.relays?.length || 0} relays`
                    : "Server not configured — contact admin"}
                </div>
              </div>
            </div>
          </div>

          {/* Preference Toggles */}
          {prefs && (
            <div style={s.section}>
              <div style={s.sectionTitle}>Your Preferences</div>

              <ToggleRow
                label="DM Notifications"
                description="Master toggle — disable to stop all DMs"
                value={prefs.dmEnabled}
                onChange={() => toggle("dmEnabled")}
                disabled={saving}
              />

              <ToggleRow
                label="Escrow Updates"
                description="Join, lock, vote, resolution alerts"
                value={prefs.escrowUpdates}
                onChange={() => toggle("escrowUpdates")}
                disabled={saving || !prefs.dmEnabled}
                dimmed={!prefs.dmEnabled}
              />

              <ToggleRow
                label="Order Updates"
                description="Purchase, status change, completion"
                value={prefs.orderUpdates}
                onChange={() => toggle("orderUpdates")}
                disabled={saving || !prefs.dmEnabled}
                dimmed={!prefs.dmEnabled}
              />

              <ToggleRow
                label="Listing Sold"
                description="Get notified when someone buys your listing"
                value={prefs.listingSold}
                onChange={() => toggle("listingSold")}
                disabled={saving || !prefs.dmEnabled}
                dimmed={!prefs.dmEnabled}
              />
            </div>
          )}

          {/* Test DM */}
          {systemStatus?.enabled && prefs?.dmEnabled && (
            <div style={s.section}>
              <div style={s.sectionTitle}>Test</div>
              <button
                onClick={sendTest}
                disabled={testSending}
                style={{
                  ...s.testBtn,
                  opacity: testSending ? 0.6 : 1,
                }}
              >
                {testSending ? "Sending…" : "📨 Send Test DM"}
              </button>
              <div style={s.hint}>
                Sends a test message to your Nostr client (Damus, Amethyst, Primal, Fedi)
              </div>
            </div>
          )}

          {/* Bot Info */}
          {systemStatus?.botPubkey && (
            <div style={s.section}>
              <div style={s.sectionTitle}>Bot Identity</div>
              <div style={s.hint}>
                DMs come from this bot. Add it to your contacts for reliable delivery.
              </div>
              <div style={s.botPk}>
                {systemStatus.botPubkey.slice(0, 16)}…{systemStatus.botPubkey.slice(-8)}
              </div>
            </div>
          )}
        </div>
      )}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}

// ── Toggle Row Component ──────────────────────────────────────────────────

function ToggleRow({ label, description, value, onChange, disabled, dimmed }) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "center",
      padding: "14px 0", borderBottom: "1px solid #1e293b",
      opacity: dimmed ? 0.4 : 1,
    }}>
      <div>
        <div style={{ color: "#f8fafc", fontSize: 14, fontWeight: 500 }}>{label}</div>
        <div style={{ color: "#64748b", fontSize: 12, marginTop: 2 }}>{description}</div>
      </div>
      <button
        onClick={onChange}
        disabled={disabled}
        style={{
          width: 44, height: 24, borderRadius: 12, border: "none",
          cursor: disabled ? "not-allowed" : "pointer",
          background: value ? "#f97316" : "#334155",
          position: "relative", transition: "background 0.2s",
          flexShrink: 0, marginLeft: 12,
        }}
      >
        <div style={{
          width: 18, height: 18, borderRadius: 9, background: "#fff",
          position: "absolute", top: 3,
          left: value ? 23 : 3,
          transition: "left 0.2s",
        }} />
      </button>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────

const styles = {
  container: {
    maxWidth: 480, margin: "0 auto", minHeight: "100vh",
    background: "#0f172a", color: "#f8fafc", fontFamily: "system-ui, sans-serif",
  },
  header: {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "16px 16px 12px", borderBottom: "1px solid #1e293b",
  },
  backBtn: {
    background: "none", border: "none", color: "#94a3b8", cursor: "pointer",
    padding: 4, display: "flex",
  },
  headerTitle: { color: "#f8fafc", fontSize: 17, fontWeight: 600 },
  center: { display: "flex", justifyContent: "center", paddingTop: "30vh" },
  spinner: {
    width: 20, height: 20, border: "2px solid #1e293b", borderTopColor: "#475569",
    borderRadius: "50%", animation: "spin 0.6s linear infinite",
  },
  content: { padding: 16 },
  statusCard: {
    background: "#1e293b", borderRadius: 12, padding: 16, marginBottom: 20,
  },
  statusRow: { display: "flex", alignItems: "center", gap: 12 },
  statusLabel: { color: "#f8fafc", fontSize: 15, fontWeight: 600 },
  statusSub: { color: "#64748b", fontSize: 12, marginTop: 2 },
  section: { marginBottom: 24 },
  sectionTitle: {
    color: "#94a3b8", fontSize: 12, fontWeight: 600, textTransform: "uppercase",
    letterSpacing: "0.5px", marginBottom: 8,
  },
  testBtn: {
    width: "100%", padding: "12px 16px", borderRadius: 10,
    background: "#1e293b", border: "1px solid #334155",
    color: "#f8fafc", fontSize: 14, fontWeight: 500, cursor: "pointer",
  },
  hint: { color: "#64748b", fontSize: 12, marginTop: 8 },
  botPk: {
    background: "#1e293b", borderRadius: 8, padding: "10px 12px",
    fontFamily: "monospace", fontSize: 12, color: "#94a3b8",
    marginTop: 8, wordBreak: "break-all",
  },
};
