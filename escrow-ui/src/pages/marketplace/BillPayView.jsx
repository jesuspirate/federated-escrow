import { useState, useEffect, useMemo } from "react";
import { BILL_TYPES, PAYMENT_METHODS } from "./constants";

export default function BillPayView({ onBrowse, listings, loading, pubkey, onBack, onCreate, onOpen, onOrders, onRefresh, fiatRates, showToast, subdomain, activeOrderCount, mapi, isDevMode }) {
  const [mode, setMode] = useState(null);
  const [posting, setPosting] = useState(false);
  const [billType, setBillType] = useState(null);
  const [fiatAmount, setFiatAmount] = useState("");
  const [fiatCurrency, setFiatCurrency] = useState("USD");
  const [note, setNote] = useState("");
  const [premiumPct, setPremiumPct] = useState("5");
  const [payMethods, setPayMethods] = useState([]);

  // Auto-refresh every 15 seconds
  useEffect(() => {
    if (onRefresh) onRefresh();
    const iv = setInterval(() => { if (onRefresh) onRefresh(); }, 15000);
    return () => clearInterval(iv);
  }, []);

  const billListings = useMemo(() =>
    listings.filter(l => l.category === "bill-pay" && l.status !== "sold" && l.status !== "paused"),
    [listings]
  );

  const CURRENCY_ALIASES = { CFA: "XOF", FCFA: "XAF" };
  const satsFromFiat = (fiatAmt, currency) => {
    if (!fiatRates || !fiatRates.btcUsd || !fiatRates.rates || !fiatAmt) return 0;
    const isoCode = CURRENCY_ALIASES[currency] || currency;
    const fxRate = fiatRates.rates[isoCode];
    if (!fxRate) return 0;
    const usd = parseFloat(fiatAmt) / fxRate;
    return Math.floor((usd / fiatRates.btcUsd) * 100000000);
  };
  const fmtFiatBP = (msats, currency) => {
    if (!fiatRates || !msats) return "";
    const rate = fiatRates[currency || "USD"];
    if (!rate) return "";
    const fiat = ((msats / 1000) / 100000000) * rate;
    return fiat < 0.01 ? "<$0.01" : "$" + fiat.toFixed(2);
  };
  const totalSatsWithPremium = () => {
    const base = satsFromFiat(fiatAmount, fiatCurrency);
    const prem = parseFloat(premiumPct) || 0;
    return Math.floor(base * (1 + prem / 100));
  };

  // CHOOSER
  if (mode === null) {
    return (
      <div style={{ display: "flex", flexDirection: "column", flex: 1, overflowY: "auto", maxWidth: 480, margin: "0 auto", width: "100%", boxSizing: "border-box" }}>

        {/* ── Standard header: [←]  🧾 Bill Pay  [spacer] ── */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 16px 4px" }}>
          <button onClick={onBack} style={{ background: "rgba(30,41,59,0.5)", color: "#cbd5e1", padding: 9, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid rgba(51,65,85,0.3)", cursor: "pointer", WebkitTapHighlightColor: "transparent", outline: "none", width: 36, height: 36, flexShrink: 0 }}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg></button>
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <span style={{ fontSize: 18 }}>🧾</span>
            <span style={{ fontSize: 17, fontWeight: 600, color: "#f8fafc" }}>Bill Pay</span>
          </div>
          <div style={{ width: 36 }} />
        </div>

        {/* ── Tagline ── */}
        <div style={{ textAlign: "center", fontSize: 12, color: "#475569", padding: "2px 16px 14px", lineHeight: 1.4 }}>Pay any bill with sats · Your community has your back</div>

                {/* ── How it works ── */}
        <div style={{ margin: "16px 16px 24px", padding: "16px", borderRadius: 14, background: "#111827", border: "1px solid #1e293b", textAlign: "center" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 14 }}>How it works</div>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "center", gap: 0 }}>
            {[
              { icon: "🧾", label: "Post", desc: "Tell us your bill", color: "#f59e0b" },
              { icon: "🔒", label: "Lock", desc: "Sats held safe", color: "#a78bfa" },
              { icon: "💵", label: "Pay", desc: "Fiat is sent", color: "#10b981" },
              { icon: "✅", label: "Done", desc: "Confirm & earn", color: "#3b82f6" },
            ].map((s, i, arr) => (
              <div key={s.label} style={{ display: "flex", alignItems: "flex-start" }}>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 5, minWidth: 64 }}>
                  <div style={{ width: 38, height: 38, borderRadius: 11, background: s.color + "18", border: "1px solid " + s.color + "35", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17 }}>{s.icon}</div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#f8fafc" }}>{s.label}</div>
                  <div style={{ fontSize: 9, color: "#475569", lineHeight: 1.3 }}>{s.desc}</div>
                </div>
                {i < arr.length - 1 && (
                  <div style={{ color: "#334155", fontSize: 14, paddingTop: 12, flexShrink: 0 }}>{"→"}</div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* ── Action cards ── */}
        <div style={{ padding: "0 16px", display: "flex", flexDirection: "column", gap: 10 }}>
          <button onClick={() => setMode("need")} style={{ width: "100%", padding: "20px 16px", borderRadius: 16, background: "linear-gradient(135deg, rgba(245,158,11,0.10), rgba(245,158,11,0.03))", border: "1.5px solid rgba(245,158,11,0.3)", cursor: "pointer", textAlign: "left", WebkitTapHighlightColor: "transparent" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <div style={{ width: 52, height: 52, borderRadius: 14, background: "rgba(245,158,11,0.15)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26, flexShrink: 0 }}>{"💸"}</div>

              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 17, fontWeight: 800, color: "#f59e0b", marginBottom: 3 }}>I need fiat for a bill</div>
                <div style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.4 }}>Lock your sats. Someone pays your bill. You confirm receipt.</div>
              </div>
              <span style={{ color: "#f59e0b", fontSize: 20, flexShrink: 0 }}>{"→"}</span>
            </div>
          </button>

          <button onClick={() => setMode("earn")} style={{ width: "100%", padding: "20px 16px", borderRadius: 16, background: "linear-gradient(135deg, rgba(16,185,129,0.10), rgba(16,185,129,0.03))", border: "1.5px solid rgba(16,185,129,0.3)", cursor: "pointer", textAlign: "left", WebkitTapHighlightColor: "transparent" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <div style={{ width: 52, height: 52, borderRadius: 14, background: "rgba(16,185,129,0.15)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26, flexShrink: 0 }}>{"₿"}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 17, fontWeight: 800, color: "#10b981", marginBottom: 3 }}>I want to buy sats</div>
                <div style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.4 }}>Pay someone's bill. Earn sats at a premium. Easy on-ramp.</div>
              </div>
              <span style={{ color: "#10b981", fontSize: 20, flexShrink: 0 }}>{"→"}</span>
            </div>
          </button>
        </div>

        {/* ── Stats ── */}
        <div style={{ display: "flex", gap: 10, margin: "16px 16px 0" }}>
          <div style={{ flex: 1, padding: "14px 12px", borderRadius: 12, background: "#111827", border: "1px solid #1e293b", textAlign: "center" }}>
            <div style={{ fontSize: 22, fontWeight: 900, color: "#f59e0b" }}>{billListings.length}</div>
            <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 2 }}>Bills Posted</div>
          </div>
          <button onClick={onOrders} style={{ flex: 1, padding: "14px 12px", borderRadius: 12, background: "#111827", border: activeOrderCount > 0 ? "1px solid rgba(245,158,11,0.4)" : "1px solid #1e293b", textAlign: "center", cursor: "pointer", WebkitTapHighlightColor: "transparent", boxShadow: activeOrderCount > 0 ? "0 0 12px rgba(245,158,11,0.15)" : "none", animation: activeOrderCount > 0 ? "pulse 2s infinite" : "none" }}>
            <div style={{ fontSize: 22, fontWeight: 900, color: "#10b981" }}>{activeOrderCount || 0}</div>
          </button>
        </div>

        {/* ── Advanced mode link ── */}
        <div style={{ textAlign: "center", padding: "0 16px 8px" }}>
          <button onClick={onBrowse || onBack} style={{ background: "none", border: "none", color: "#334155", fontSize: 11, cursor: "pointer", textDecoration: "underline", textUnderlineOffset: 2 }}>
            Advanced mode — browse & create custom offers →
          </button>
        </div>
      </div>
    );
  }

  // "I NEED FIAT" form
  if (mode === "need") {
    const baseSats = satsFromFiat(fiatAmount, fiatCurrency);
    const totalSats = totalSatsWithPremium();
    const premiumSats = totalSats - baseSats;

    return (
      <div style={{ padding: "0 16px 80px", maxWidth: 480, margin: "0 auto", width: "100%", boxSizing: "border-box", overflowY: "auto", flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <button onClick={() => setMode(null)} style={{ background: "rgba(30,41,59,0.5)", color: "#cbd5e1", padding: 9, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid rgba(51,65,85,0.3)", cursor: "pointer", WebkitTapHighlightColor: "transparent", outline: "none", flexShrink: 0 }}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg></button>
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 800, color: "#f8fafc", margin: 0 }}>{"💸"} I need fiat for a bill</h2>
            <p style={{ fontSize: 11, color: "#64748b", margin: "2px 0 0" }}>Lock sats, get fiat from your community</p>
          </div>
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5, display: "block", marginBottom: 6 }}>What is this for?</label>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {BILL_TYPES.map(bt => {
              const active = billType === bt.id;
              return (
                <button key={bt.id} onClick={() => setBillType(active ? null : bt.id)} style={{ padding: "6px 12px", borderRadius: 8, fontSize: 12, fontWeight: active ? 700 : 500, background: active ? "rgba(245,158,11,0.12)" : "#111827", color: active ? "#f59e0b" : "#94a3b8", border: active ? "1px solid rgba(245,158,11,0.3)" : "1px solid #1e293b", cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}>
                  {bt.icon} {bt.label}
                </button>
              );
            })}
          </div>
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5, display: "block", marginBottom: 6 }}>How much do you need?</label>
          <div style={{ display: "flex", gap: 8 }}>
            <select value={fiatCurrency} onChange={e => setFiatCurrency(e.target.value)} style={{ padding: "14px 12px", borderRadius: 10, border: "1.5px solid #334155", background: "#0f172a", color: "#f8fafc", fontSize: 14, fontWeight: 600, outline: "none", cursor: "pointer", fontFamily: "inherit" }}>
              {["USD", "EUR", "GBP", "KES", "TZS", "NGN", "CFA", "BRL", "INR"].map(c => (<option key={c} value={c}>{c}</option>))}
            </select>
            <div style={{ flex: 1, position: "relative" }}>
              <input type="number" inputMode="decimal" placeholder="0.00" value={fiatAmount} onChange={e => setFiatAmount(e.target.value)} style={{ width: "100%", padding: "14px", borderRadius: 10, border: "1.5px solid #334155", background: "#0f172a", color: "#f8fafc", fontSize: 22, fontWeight: 700, outline: "none", fontFamily: "inherit" }} />
            </div>
          </div>
          {fiatAmount && baseSats > 0 && (
            <div style={{ marginTop: 6, fontSize: 12, color: "#64748b" }}>
              {"≈"} {baseSats.toLocaleString()} sats + {premiumPct}% premium = <span style={{ color: "#f59e0b", fontWeight: 700 }}>{totalSats.toLocaleString()} sats</span> locked
            </div>
          )}
        </div>

        <div style={{ marginBottom: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
            <label style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5 }}>Volunteer premium</label>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#10b981" }}>{premiumPct}%</span>
          </div>
          <input type="range" min="0" max="20" step="1" value={premiumPct} onChange={e => setPremiumPct(e.target.value)} style={{ width: "100%", accentColor: "#10b981", height: 6, WebkitAppearance: "none", appearance: "none", background: "linear-gradient(to right, #10b981 " + (parseFloat(premiumPct) / 20 * 100) + "%, #1e293b " + (parseFloat(premiumPct) / 20 * 100) + "%)", borderRadius: 3, outline: "none" }} />
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#475569" }}>
            <span>0% (no bonus)</span><span>20% (generous)</span>
          </div>
          {premiumSats > 0 && (
            <div style={{ fontSize: 11, color: "#10b981", marginTop: 4 }}>Volunteer earns {premiumSats.toLocaleString()} bonus sats for helping you</div>
          )}
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5, display: "block", marginBottom: 6 }}>How should you be paid?</label>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {PAYMENT_METHODS.map(pm => {
              const active = payMethods.includes(pm.key);
              return (
                <button key={pm.key} onClick={() => setPayMethods(prev => active ? prev.filter(k => k !== pm.key) : [...prev, pm.key])} style={{ padding: "5px 10px", borderRadius: 8, fontSize: 11, fontWeight: active ? 700 : 500, background: active ? "rgba(16,185,129,0.12)" : "#111827", color: active ? "#10b981" : "#94a3b8", border: active ? "1px solid rgba(16,185,129,0.3)" : "1px solid #1e293b", cursor: "pointer", display: "flex", alignItems: "center", gap: 3 }}>
                  {pm.icon} {pm.label}
                </button>
              );
            })}
          </div>
          {payMethods.length > 0 && <div style={{ fontSize: 10, color: "#10b981", marginTop: 4 }}>{payMethods.length} method{payMethods.length > 1 ? "s" : ""} selected</div>}
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5, display: "block", marginBottom: 6 }}>Note (optional)</label>
          <div style={{ fontSize: 10, color: "#475569", marginBottom: 6, lineHeight: 1.4 }}>Your payment details (phone number, $cashtag, etc.) will be shared privately via encrypted chat after a volunteer accepts.</div>
          <input placeholder="e.g., Need this by Friday, rent is due" value={note} onChange={e => setNote(e.target.value)} style={{ width: "100%", padding: "12px 14px", borderRadius: 10, border: "1.5px solid #334155", background: "#0f172a", color: "#f8fafc", fontSize: 13, outline: "none", fontFamily: "inherit" }} />
        </div>

        {fiatAmount && baseSats > 0 && (
          <div style={{ padding: "14px", borderRadius: 12, background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.15)", marginBottom: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#f59e0b", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>Summary</div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}><span style={{ fontSize: 13, color: "#94a3b8" }}>You receive</span><span style={{ fontSize: 15, fontWeight: 700, color: "#f8fafc" }}>{fiatCurrency} {parseFloat(fiatAmount).toFixed(2)}</span></div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}><span style={{ fontSize: 13, color: "#94a3b8" }}>You lock</span><span style={{ fontSize: 15, fontWeight: 700, color: "#f59e0b" }}>{"₿"} {totalSats.toLocaleString()} sats</span></div>
            <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ fontSize: 13, color: "#94a3b8" }}>Volunteer earns</span><span style={{ fontSize: 13, fontWeight: 600, color: "#10b981" }}>+{premiumSats.toLocaleString()} sats ({premiumPct}%)</span></div>
          </div>
        )}

        <button onClick={async () => {
            if (!billType) return showToast("Pick a bill type", "error");
            if (!fiatAmount || parseFloat(fiatAmount) <= 0) return showToast("Enter the fiat amount you need", "error");
            if (payMethods.length === 0) return showToast("Select at least one payment method", "error");
            const bt = BILL_TYPES.find(b => b.id === billType);
            const totalSats = totalSatsWithPremium();
            if (totalSats <= 0) return showToast("Could not calculate sats amount - check fiat rates", "error");
            if (totalSats > 2000000) return showToast("Exceeds 2,000,000 sats federation limit", "error");

            const billTitle = bt.icon + " " + bt.label + " bill - " + fiatCurrency + " " + parseFloat(fiatAmount).toFixed(2);
            const billTerms = "--- Bill Pay Details ---\nType: " + bt.label + "\nFiat needed: " + fiatCurrency + " " + parseFloat(fiatAmount).toFixed(2) + "\nCurrency: " + fiatCurrency + "\nRate: " + premiumPct + (note ? "\n\n" + note : "");

            setPosting(true);
            try {
              let sellerFedPrefix = null;
              const _isSandbox = !window.fediInternal || isDevMode();
              if (!_isSandbox && window.fediInternal && window.fediInternal.generateEcash) {
                try {
                  showToast("Detecting your federation...");
                  const probe = await window.fediInternal.generateEcash({ amount: 1 });
                  if (probe && probe.length > 10) {
                    sellerFedPrefix = probe.substring(0, 10);
                    try { await window.fediInternal.receiveEcash(probe); } catch {}
                  }
                } catch {}
              }
              if (!sellerFedPrefix && !_isSandbox) {
                showToast("Federation detection failed. Please approve the prompt to continue.", "error");
                setPosting(false);
                return;
              }

              const res = await mapi("/", {
                method: "POST",
                body: JSON.stringify({
                  title: billTitle,
                  description: note || undefined,
                  priceMsats: totalSats * 1000,
                  terms: billTerms,
                  category: "bill-pay",
                  condition: "service",
                  communityLink: undefined,
                  sellerFedPrefix: sellerFedPrefix || undefined,
                  quantity: 1,
                  paymentMethods: payMethods.length > 0 ? payMethods : undefined,
                }),
              });
              if (res.error) throw new Error(res.error);
              showToast("Bill posted! Now lock your sats.");
              onOpen(res.id);
            } catch (err) { showToast(err.message, "error"); }
            setPosting(false);
          }} disabled={!billType || !fiatAmount || posting}
          style={{ width: "100%", padding: "16px 0", borderRadius: 12, background: (!billType || !fiatAmount) ? "#1e293b" : "linear-gradient(135deg, #f59e0b, #d97706)", color: (!billType || !fiatAmount) ? "#475569" : "#fff", fontSize: 16, fontWeight: 700, border: "none", cursor: "pointer", boxShadow: (billType && fiatAmount) ? "0 4px 24px rgba(245,158,11,0.3)" : "none", fontFamily: "inherit" }}>
          {posting ? "Posting..." : "🧾 Post My Bill"}
        </button>
      </div>
    );
  }

  // "I WANT TO BUY SATS" browse
  if (mode === "earn") {
    return (
      <div style={{ padding: "0 16px 80px", maxWidth: 480, margin: "0 auto", width: "100%", boxSizing: "border-box", overflowY: "auto", flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <button onClick={() => setMode(null)} style={{ background: "rgba(30,41,59,0.5)", color: "#cbd5e1", padding: 9, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid rgba(51,65,85,0.3)", cursor: "pointer", WebkitTapHighlightColor: "transparent", outline: "none", flexShrink: 0 }}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg></button>
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 800, color: "#f8fafc", margin: 0 }}>{"₿"} Buy Sats</h2>
            <p style={{ fontSize: 11, color: "#64748b", margin: "2px 0 0" }}>Send fiat, earn sats at a premium</p>
          </div>
          <button onClick={onRefresh} style={{ marginLeft: "auto", background: "none", border: "none", color: "#64748b", fontSize: 16, cursor: "pointer" }}>{"↻"}</button>
        </div>

        {loading && (<div style={{ display: "flex", justifyContent: "center", padding: "40px 0" }}><div style={{ width: 20, height: 20, border: "2px solid #1e293b", borderTopColor: "#475569", borderRadius: "50%", animation: "spin 0.6s linear infinite" }} /></div>)}

        {!loading && billListings.length === 0 && (
          <div style={{ textAlign: "center", padding: "40px 16px" }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>{"🌟"}</div>
            <p style={{ fontSize: 15, fontWeight: 600, color: "#f8fafc", marginBottom: 6 }}>No bills posted yet</p>
            <p style={{ fontSize: 12, color: "#64748b", lineHeight: 1.5 }}>When someone needs fiat for a bill, it will show up here. Check back soon or post your own!</p>
          </div>
        )}

        {!loading && billListings.map((l, i) => {
          const sats = Math.floor((l.priceMsats || 0) / 1000);
          const termsCurrMatch = (l.terms || "").match(/Fiat needed:\s*(\w+)\s+([\d.]+)/);
          const fiatDisplay = termsCurrMatch ? termsCurrMatch[1] + " " + termsCurrMatch[2] : fmtFiatBP(l.priceMsats, "USD");
          const billIcon = BILL_TYPES.find(bt => (l.title || "").toLowerCase().includes(bt.id))?.icon || "🧾";
          const rateMatch = (l.terms || "").match(/Rate:\s*(\d+)/);
          const premium = rateMatch ? rateMatch[1] + "%" : null;

          return (
            <button key={l.id} onClick={() => onOpen(l.id)} style={{ width: "100%", padding: "14px", marginBottom: 8, borderRadius: 12, background: "#111827", border: "1px solid #1e293b", cursor: "pointer", textAlign: "left", animation: "slideUp 0.3s ease " + (i * 0.05) + "s both" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ width: 44, height: 44, borderRadius: 10, background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.15)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>{billIcon}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "#f8fafc", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{l.title}</div>
                  <div style={{ fontSize: 11, color: "#64748b", marginTop: 2, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    {premium && <span style={{ color: "#10b981", fontWeight: 600 }}>+{premium}</span>}
                    {(l.paymentMethods || []).slice(0, 3).map(pm => { const m = PAYMENT_METHODS.find(p => p.key === pm); return m ? <span key={pm} style={{ padding: "1px 5px", borderRadius: 4, fontSize: 9, background: "rgba(16,185,129,0.08)", color: "#10b981", border: "1px solid rgba(16,185,129,0.15)" }}>{m.icon} {m.label}</span> : null; })}
                    {(l.paymentMethods || []).length > 3 && <span style={{ fontSize: 9, color: "#475569" }}>+{(l.paymentMethods || []).length - 3}</span>}
                  </div>
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  {fiatDisplay && <div style={{ fontSize: 18, fontWeight: 800, color: "#f8fafc" }}>{fiatDisplay}</div>}
                  <div style={{ fontSize: 10, color: "#f59e0b", fontWeight: 600 }}>{"₿"} {(() => {
                    if (!fiatRates || !fiatRates.btcUsd) return sats.toLocaleString();
                    const fm = (l.terms || "").match(/Fiat needed:\s*(\w+)\s+([\d.]+)/);
                    const rm = (l.terms || "").match(/Rate:\s*(\d+)/);
                    if (!fm) return sats.toLocaleString();
                    const BILL_ALIASES = { CFA: "XOF", FCFA: "XAF" };
                    const billIso = BILL_ALIASES[fm[1]] || fm[1];
                    const fx = fiatRates.rates[billIso] || 1;
                    const usd = parseFloat(fm[2]) / fx;
                    const base = Math.floor((usd / fiatRates.btcUsd) * 100000000);
                    const prem = rm ? parseInt(rm[1]) : 0;
                    return Math.floor(base * (1 + prem / 100)).toLocaleString();
                  })()} sats</div>
                </div>

              </div>

            </button>
          );
        })}

        {billListings.length > 0 && (<div style={{ textAlign: "center", padding: "12px 0", fontSize: 12, color: "#475569" }}>Tap a bill to send fiat and earn sats</div>)}
      </div>
    );
  }

  return null;
}

