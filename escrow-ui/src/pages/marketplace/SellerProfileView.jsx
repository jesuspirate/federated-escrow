import { useState, useEffect } from "react";
import { fmtVolume, truncPk } from "./helpers";
import { useNostrProfile, StarRating, Icons } from "./components";
import M from "./styles";

export default function SellerProfileView({ pubkey: pk, myPubkey, onBack, onOpen, showToast, mapi }) {
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

