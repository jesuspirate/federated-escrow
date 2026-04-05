// ═══════════════════════════════════════════════════════════════════════
// Marketplace Styles — extracted from Marketplace.jsx
// ═══════════════════════════════════════════════════════════════════════

export const M = {
  root: { background: "#0c0f17", color: "#e2e8f0", flex: 1, display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden", fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', fontSize: 14, lineHeight: 1.5 },
  container: { width: "100%", maxWidth: 480, margin: "0 auto", padding: "0 16px 20px", overflowX: "hidden", flex: 1, overflowY: "auto" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 0 12px", minHeight: 52 },
  title: { fontSize: 24, fontWeight: 700, color: "#f8fafc", margin: 0, letterSpacing: -0.5 },
  subtitle: { fontSize: 12, color: "#64748b", margin: "2px 0 0" },
  viewHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 0 12px" },
  viewTitle: { fontSize: 17, fontWeight: 600, color: "#f8fafc", margin: 0 },
  iconBtn: { background: "rgba(30,41,59,0.5)", color: "#cbd5e1", padding: 9, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid rgba(51,65,85,0.3)", cursor: "pointer", WebkitTapHighlightColor: "transparent", outline: "none", minWidth: 36, minHeight: 36 },
  primaryBtn: { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, background: "linear-gradient(135deg, #f59e0b, #d97706)", color: "#0c0f17", fontWeight: 700, fontSize: 15, padding: "14px 24px", borderRadius: 14, flex: 1, border: "none", cursor: "pointer", boxShadow: "0 2px 12px rgba(245,158,11,0.2)", WebkitTapHighlightColor: "transparent", outline: "none" },
  secondaryBtn: { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, background: "linear-gradient(145deg, #1e293b, #1a2332)", color: "#e2e8f0", fontWeight: 600, fontSize: 15, padding: "14px 24px", borderRadius: 14, flex: 1, border: "1px solid #334155", cursor: "pointer", WebkitTapHighlightColor: "transparent", outline: "none" },
  actionBtn: { display: "flex", alignItems: "center", justifyContent: "center", gap: 8, width: "100%", padding: "16px 0", borderRadius: 14, color: "#fff", fontSize: 15, fontWeight: 800, letterSpacing: -0.3, border: "none", cursor: "pointer", WebkitTapHighlightColor: "transparent", outline: "none" },
  input: { width: "100%", padding: "12px 14px", borderRadius: 10, border: "1px solid #1e293b", background: "#111827", color: "#f8fafc", fontSize: 14, outline: "none", boxSizing: "border-box" },
  formGroup: { marginBottom: 16 },
  label: { display: "block", fontSize: 12, fontWeight: 600, color: "#94a3b8", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 },
  hint: { fontSize: 11, color: "#475569", marginTop: 4 },
  section: { marginBottom: 14 },
  sectionLabel: { fontSize: 11, fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 },
  sectionValue: { fontSize: 13, color: "#cbd5e1", lineHeight: 1.6 },
  emptyState: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "60px 20px", textAlign: "center" },
  listingCard: { background: "linear-gradient(145deg, #111827, #0f1320)", border: "1px solid #1e293b", borderRadius: 14, padding: "16px 18px", textAlign: "left", color: "#e2e8f0", width: "100%", cursor: "pointer", transition: "all 0.2s ease" },
  cardTitle: { fontSize: 16, fontWeight: 600, color: "#f8fafc", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 },
  cardPrice: { fontSize: 16, fontWeight: 700, color: "#f8fafc", whiteSpace: "nowrap", marginLeft: 8 },
  cardDesc: { fontSize: 13, color: "#94a3b8", margin: "6px 0 0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "center" },
  cardMeta: { display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10 },
  conditionBadge: { padding: "3px 10px", borderRadius: 6, fontSize: 11, fontWeight: 700, background: "rgba(139,92,246,0.1)", color: "#a78bfa", letterSpacing: 0.3 },
  categoryBadge: { padding: "3px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600, background: "rgba(100,116,139,0.1)", color: "#94a3b8" },
  chipBtn: { padding: "6px 12px", borderRadius: 8, background: "#111827", color: "#94a3b8", fontSize: 12, fontWeight: 500, border: "1px solid transparent", cursor: "pointer", WebkitTapHighlightColor: "rgba(0,0,0,0)", outline: "none" },
  chipBtnActive: { background: "#1e293b", color: "#f8fafc", borderColor: "#f59e0b" },
  infoBanner: { padding: "10px 14px", border: "1px solid", borderRadius: 10, marginBottom: 12 },
  participantRow: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", fontSize: 13 },
};

export default M;
