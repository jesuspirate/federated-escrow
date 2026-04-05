import { useState, useEffect } from "react";
import { getFedName } from "./helpers";
import { Icons } from "./components";
import M from "./styles";

export default function ArbiterRecruitmentView({ pubkey, onBack, showToast, mapi }) {
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

