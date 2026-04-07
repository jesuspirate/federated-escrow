import { useState, useEffect } from "react";
import { CONDITION_KEYS, PAYMENT_METHODS } from "./constants";
import { fmtSats, fmtFiat, getFedName, isBillPay, isLending, isSatsForFiat } from "./helpers";
import { t } from "../i18n";
import { SellerName, Icons } from "./components";
import M from "./styles";

export default function ListingDetail({ listing: l, pubkey, onBack, onProfile, onOrderCreated, showToast, loading, setLoading, onEdit, onPause, onUnpause, onDelete, fiatRates, myFederation, subdomain, mapi, isDevMode }) {
  const isSeller = l.sellerPubkey === pubkey;
  const canBuy = !isSeller && l.status === "active" && l.quantity > 0;
  const isP2P = isSatsForFiat(l.category);
  const hasRange = l.minPriceSats && l.maxPriceSats && l.minPriceSats !== l.maxPriceSats;
  const [buyAmount, setBuyAmount] = useState(hasRange ? "" : "");


  // Lending level for borrower
  const [myLendingLevel, setMyLendingLevel] = useState(null);
  useEffect(() => {
    if (!isLending(l.category) || isSeller) return;
    (async () => {
      try {
        const data = await mapi("/lending-level/" + pubkey);
        if (!data.error) setMyLendingLevel(data);
      } catch {}
    })();
  }, [l.id, pubkey]);
  const handleBuy = async () => {
    // Federation probe: verify buyer is on same federation as seller
    const sellerPrefix = l.sellerFedPrefix;
    const _isSandbox = !window.fediInternal || isDevMode();
    if (!_isSandbox && sellerPrefix && window.fediInternal && window.fediInternal.generateEcash) {
      setLoading(true);
      try {
        showToast("Verifying your federation...");
        const probe = await window.fediInternal.generateEcash({ amount: 1 });
        if (!probe || probe.length <= 10) {
          showToast("Federation verification failed. Please try again and make sure to approve the prompt.", "error");
          setLoading(false);
          return;
        }
        const buyerPrefix = probe.substring(0, 10);
        try { await window.fediInternal.receiveEcash(probe); } catch {}
        if (buyerPrefix !== sellerPrefix) {
          showToast("This trade requires the same federation as the seller. Please switch to the correct federation in Fedi and try again. Your 1 sat probe has been returned.", "error");
          setLoading(false);
          return;
        }
      } catch {
        showToast("Federation verification failed. Please try again.", "error");
        setLoading(false);
        return;
      }
    } else if (!_isSandbox && sellerPrefix) {
      // No generateEcash available but listing has prefix — block trade
      showToast("Cannot verify your federation. Please update your Fedi app and try again.", "error");
      return;
    }
    setLoading(true);
    try {
      let customMsats = hasRange && buyAmount ? parseInt(buyAmount) * 1000 : undefined;
      // Apply premium at checkout (P2P range + bill pay/P2P fixed)
      const rateM = (l.terms || "").match(/Rate:\s*(\d+)/);
      const ratePct = rateM ? parseFloat(rateM[1]) : 0;
      if (isP2P && customMsats && ratePct > 0) {
        customMsats = Math.ceil(customMsats * (1 + ratePct / 100));
        if (customMsats > 2_000_000_000) { showToast("Total with premium exceeds 2M sats federation limit!", "error"); setLoading(false); return; }
      }
      if (!customMsats && ratePct > 0 && (isP2P || isBillPay(l.category))) {
        customMsats = Math.ceil(l.priceMsats * (1 + ratePct / 100));
        if (customMsats > 2_000_000_000) { showToast("Total with premium exceeds 2M sats federation limit!", "error"); setLoading(false); return; }
      }
      const res = await mapi(`/${l.id}/buy`, { method: "POST", body: JSON.stringify(customMsats ? { amountMsats: customMsats } : {}) });
      if (res.error) throw new Error(res.error);
      showToast(isP2P ? t("mkTradeStarted") || "Trade started!" : t("mkBuySuccess"));
      setLoading(false);
      // Navigate directly to the new order detail
      if (onOrderCreated && res.order) {
        onOrderCreated({
          id: res.order.id,
          listingId: res.order.listingId,
          escrowId: res.order.escrowId,
          buyerPubkey: pubkey,
          sellerPubkey: l.sellerPubkey,
          arbiterPubkey: res.order.arbiterPubkey,
          amountMsats: customMsats || l.priceMsats,
          listingTitle: l.title,
          status: "pending",
 listingCategory: l.category,
        });
      } else {
        onBack();
      }
    } catch (err) { showToast(err.message, "error"); setLoading(false); }
  };

  return (
    <div style={M.container}>
      <div style={M.viewHeader}>
        <button style={M.iconBtn} onClick={onBack}><Icons.Back /></button>
        <h2 style={M.viewTitle}>{t("mkListing")}</h2>
        <div style={{ width: 36 }} />
      </div>

      <div style={{ paddingBottom: 20 }}>
        <div style={{ marginBottom: 16 }}>
          <h2 style={{ fontSize: 22, fontWeight: 700, color: "#f8fafc", margin: "0 0 8px", lineHeight: 1.3 }}>{l.title}</h2>
          {hasRange ? (
            <>
              <div style={{ fontSize: 24, fontWeight: 900, color: "#f8fafc", letterSpacing: -1 }}>
                <span style={{ color: "#f7931a", fontWeight: 800, fontSize: 22 }}>₿</span>{l.minPriceSats.toLocaleString()} — <span style={{ color: "#f7931a", fontWeight: 800, fontSize: 22 }}>₿</span>{l.maxPriceSats.toLocaleString()}
              </div>
              {fiatRates && <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>≈ {fmtFiat(l.minPriceMsats, fiatRates, "USD")} — {fmtFiat(l.maxPriceMsats, fiatRates, "USD")}</div>}
            </>
          ) : (
            <>
              <div style={{ fontSize: 32, fontWeight: 900, color: "#f8fafc", letterSpacing: -1 }}>
                <span style={{ color: "#f7931a", fontWeight: 800, fontSize: 30 }}>₿</span>{fmtSats(l.priceMsats)}
              </div>
              {fiatRates && <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>≈ {fmtFiat(l.priceMsats, fiatRates, "USD")}</div>}
            </>
          )}
        </div>

        {l.images && l.images.length > 0 && (
          <div style={{ display: "flex", gap: 8, overflowX: "auto", padding: "0 0 12px", WebkitOverflowScrolling: "touch" }}>
            {l.images.map((url, i) => (
              <a key={i} href={url} target="_blank" rel="noopener noreferrer" style={{ flexShrink: 0 }}>
                <img src={url} alt="" style={{ width: 120, height: 120, objectFit: "cover", borderRadius: 10, border: "1px solid #1e293b" }}
                  onError={e => { e.target.style.display = "none"; }}
                />
              </a>
            ))}
          </div>
        )}

        {/* Trade type indicator */}
        {isP2P && (() => {
          // Extract P2P details from terms
          const termsStr = l.terms || "";
          const p2pSection = termsStr.split("--- P2P Details ---")[1] || "";
          const getDetail = (key) => { const m = p2pSection.match(new RegExp(key + ":\\s*(.+)")); return m ? m[1].trim() : null; };
          const currency = getDetail("Currency");
          const payment = getDetail("Payment");
          const rate = getDetail("Rate");
          return (
            <div style={{ ...M.infoBanner, borderColor: "rgba(245,158,11,0.3)", background: "rgba(245,158,11,0.06)", marginBottom: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                <span style={{ fontSize: 14 }}>₿</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: "#f59e0b" }}>P2P Sats-for-Fiat Trade</span>
              </div>
              <div style={{ fontSize: 11, color: "#94a3b8", lineHeight: 1.5, marginBottom: 8 }}>
                Seller locks ₿ sats in escrow. You send fiat externally. Once both confirm, you receive the sats.
              </div>
              {(currency || payment || rate) && (
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                  {currency && <div style={{ padding: "4px 10px", borderRadius: 6, background: "rgba(245,158,11,0.12)", fontSize: 11, fontWeight: 700, color: "#f59e0b" }}>{currency}</div>}
                  {payment && <div style={{ padding: "4px 10px", borderRadius: 6, background: "rgba(139,92,246,0.12)", fontSize: 11, fontWeight: 700, color: "#a78bfa" }}>{payment}</div>}
                  {rate && rate !== "N/A" && <div style={{ padding: "4px 10px", borderRadius: 6, background: "rgba(16,185,129,0.12)", fontSize: 11, fontWeight: 700, color: "#10b981" }}>+{rate}% premium</div>}
                </div>
              )}
            </div>
          );
        })()}

        {/* Amount picker for P2P range listings */}
        {canBuy && hasRange && (
          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 11, color: "#f59e0b", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6, display: "block" }}>How many sats do you want to buy?</label>
            <input style={M.input} type="number" placeholder={l.minPriceSats.toLocaleString() + " — " + l.maxPriceSats.toLocaleString() + " sats"} value={buyAmount} onChange={e => setBuyAmount(e.target.value)} />
            {buyAmount && fiatRates && <div style={{ fontSize: 12, color: "#64748b", marginTop: 4, textAlign: "center" }}>≈ {fmtFiat(parseInt(buyAmount) * 1000 || 0, fiatRates, "USD")}</div>}
            {buyAmount && (() => {
              const termsStr = l.terms || "";
              const p2pBlock = termsStr.split("--- P2P Details ---")[1] || "";
              const rateMatch = p2pBlock.match(/Rate:\s*(.+)/);
              const ratePct = rateMatch ? parseFloat(rateMatch[1]) : 0;
              const base = parseInt(buyAmount) || 0;
              const premium = ratePct > 0 ? Math.ceil(base * ratePct / 100) : 0;
              const total = base + premium;
              if (!base) return null;
              return (
                <div style={{ marginTop: 8, padding: "10px 14px", borderRadius: 10, background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.15)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#94a3b8", marginBottom: 4 }}>
                    <span>Base amount</span>
                    <span>₿ {base.toLocaleString()} sats</span>
                  </div>
                  {premium > 0 && (
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#10b981", marginBottom: 4 }}>
                      <span>Premium ({ratePct}%)</span>
                      <span>+ ₿ {premium.toLocaleString()} sats</span>
                    </div>
                  )}
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 700, color: "#f8fafc", borderTop: "1px solid rgba(245,158,11,0.15)", paddingTop: 6, marginTop: 4 }}>
                    <span>Total</span>
                    <span>₿ {total.toLocaleString()} sats</span>
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {canBuy && (isP2P || isBillPay(l.category)) && !hasRange && fiatRates && (() => {
          const rateM = (l.terms || "").match(/Rate:\s*(\d+)/);
          const ratePct = rateM ? parseFloat(rateM[1]) : 0;
          const baseSats = Math.floor(l.priceMsats / 1000);
          const premiumSats = ratePct > 0 ? Math.ceil(baseSats * ratePct / 100) : 0;
          const totalSats = baseSats + premiumSats;
          const fiatAmount = fmtFiat(l.priceMsats, fiatRates, l.fiatCurrency || "USD");
          const isBP = isBillPay(l.category);
          const bpMatch = isBP ? (l.terms || "").match(/Fiat needed:\s*(\w+)\s+([\d.]+)/) : null;
          const bpFiatStr = bpMatch ? (bpMatch[1] + " " + parseFloat(bpMatch[2]).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })) : null;
          return (
            <div style={{ marginBottom: 10, padding: "12px 14px", borderRadius: 10, background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.15)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#94a3b8", marginBottom: 4 }}>
                <span>{isBP ? "Volunteer pays" : (t("mkBaseAmount") || "Base amount")}</span>
                <span style={isBP ? { fontWeight: 700, color: "#f8fafc" } : {}}>{isBP ? (bpFiatStr || fiatAmount) : (fiatAmount + " (" + baseSats.toLocaleString() + " sats)")}</span>
              </div>
              {premiumSats > 0 && (
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#10b981", marginBottom: 4 }}>
                  <span>{t("mkVolunteerEarns") || "Volunteer earns"} ({ratePct}%)</span>
                  <span>+ {premiumSats.toLocaleString()} sats</span>
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, fontWeight: 700, color: "#f59e0b", borderTop: "1px solid rgba(245,158,11,0.15)", paddingTop: 6, marginTop: 4 }}>
                <span>{isBP ? (t("mkVolunteerReceives") || "Volunteer receives") : (t("mkTotal") || "Total")}</span>
                <span>{isBP ? ("₿ " + totalSats.toLocaleString() + " sats") : (totalSats.toLocaleString() + " sats")}</span>
              </div>
            </div>
          );
        })()}
        {canBuy && (
          <button style={{ ...M.actionBtn, background: isP2P || isBillPay(l.category) ? "linear-gradient(135deg, #f59e0b, #d97706)" : "linear-gradient(135deg, #10b981, #059669)", boxShadow: isP2P || isBillPay(l.category) ? "0 4px 24px rgba(245,158,11,0.3)" : "0 4px 24px rgba(16,185,129,0.3)", color: (isP2P || isBillPay(l.category)) ? "#0c0f17" : "#fff", marginBottom: 16 }} onClick={() => { if (hasRange && (!buyAmount || parseInt(buyAmount) < l.minPriceSats || parseInt(buyAmount) > l.maxPriceSats)) { showToast("Pick an amount between " + l.minPriceSats.toLocaleString() + " and " + l.maxPriceSats.toLocaleString() + " sats", "error"); return; } handleBuy(); }} disabled={loading || (isLending(l.category) && myLendingLevel && Math.floor(l.priceMsats / 1000) > myLendingLevel.maxSats)}>
            {loading
              ? (isP2P ? "Starting trade…" : t("mkBuying"))
              : isP2P
                ? (hasRange ? ("Start Trade — ₿ " + (() => { const b = parseInt(buyAmount) || 0; const rm = (l.terms || "").match(/Rate:\s*(\d+)/); const rp = rm ? parseFloat(rm[1]) : 0; return rp > 0 ? (b + Math.ceil(b * rp / 100)).toLocaleString() : (buyAmount || "?"); })() + " sats") : ("Start Trade — ₿ " + fmtSats(l.priceMsats) + " sats"))
                : isLending(l.category) ? ("🤝 Accept Loan — ₿ " + fmtSats(l.priceMsats)) : isBillPay(l.category) ? ("🧾 Pay Bill — " + (() => { const fm = (l.terms || "").match(/Fiat needed:\s*(\w+)\s+([\d.]+)/); if (fm) return fm[1] + " " + parseFloat(fm[2]).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); return "₿ " + fmtSats(l.priceMsats); })()) : ("⚡ Buy for ₿ " + fmtSats(l.priceMsats + (l.shippingCostSats ? l.shippingCostSats * 1000 : 0)))
            }
          </button>
        )}

        {/* Marketplace buyer info */}
        {l.shippingCostSats > 0 && (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", marginBottom: 10, borderRadius: 10, background: "rgba(59,130,246,0.04)", border: "1px solid rgba(59,130,246,0.15)" }}>
            <span style={{ fontSize: 12, color: "#94a3b8" }}>📦 Shipping</span>
            <span style={{ fontSize: 14, fontWeight: 700, color: "#3b82f6" }}>₿ {l.shippingCostSats.toLocaleString()} sats</span>
          </div>
        )}
        {l.shippingCostSats > 0 && (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", marginBottom: 14, borderRadius: 10, background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.2)" }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#f59e0b" }}>Total</span>
            <span style={{ fontSize: 16, fontWeight: 900, color: "#f8fafc" }}>₿ {(Math.floor(l.priceMsats / 1000) + l.shippingCostSats).toLocaleString()} sats</span>
          </div>
        )}
        {l.platformFeeBps > 0 && (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 14px", marginBottom: 10, borderRadius: 10, background: "rgba(100,116,139,0.04)", border: "1px solid rgba(100,116,139,0.1)" }}>
            <span style={{ fontSize: 11, color: "#64748b" }}>{t("mkPlatformFee") || "Platform fee"}</span>
            <span style={{ fontSize: 11, fontWeight: 600, color: "#64748b" }}>{(l.platformFeeBps / 100)}% ({Math.ceil(Math.floor(l.priceMsats / 1000) * l.platformFeeBps / 10000).toLocaleString()} sats)</span>
          </div>
        )}
        {(l.sellerFedPrefix || l.sellerFedDomain) && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 14px", marginBottom: 10, borderRadius: 10, background: "rgba(139,92,246,0.06)", border: "1px solid rgba(139,92,246,0.15)" }}>
            <span style={{ fontSize: 14 }}>{"🏛️"}</span>
            <span style={{ fontSize: 12, fontWeight: 600, color: "#a78bfa" }}>Federation: {getFedName(l.sellerFedPrefix, l.sellerFedDomain)}</span>
            <span style={{ fontSize: 10, color: "#64748b", marginLeft: "auto" }}>Must match yours</span>
          </div>
        )}
        {isLending(l.category) && myLendingLevel && (
          <div style={{ padding: "10px 14px", borderRadius: 10, background: "rgba(139,92,246,0.08)", border: "1px solid rgba(139,92,246,0.2)", marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <span style={{ fontSize: 12, color: "#a78bfa", fontWeight: 700 }}>Your Lending Level</span>
                <div style={{ fontSize: 16, fontWeight: 800, color: "#f8fafc", marginTop: 2 }}>Level {myLendingLevel.level} — {myLendingLevel.name}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 11, color: "#64748b" }}>Max loan</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#a78bfa" }}>₿ {myLendingLevel.maxSats.toLocaleString()}</div>
              </div>
            </div>
            {Math.floor(l.priceMsats / 1000) > myLendingLevel.maxSats && (
              <div style={{ marginTop: 8, padding: "6px 10px", borderRadius: 8, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)", fontSize: 11, color: "#ef4444", fontWeight: 600 }}>
                ⚠️ This loan exceeds your Level {myLendingLevel.level} limit. Repay smaller loans on time to level up.
              </div>
            )}
          </div>
        )}
        {canBuy && !isP2P && (
          <div style={{ ...M.infoBanner, borderColor: "rgba(16,185,129,0.2)", background: "rgba(16,185,129,0.04)", marginBottom: 14 }}>
            <div style={{ fontSize: 11, color: "#94a3b8", lineHeight: 1.5 }}>
              {isLending(l.category) ? <span>The lender will lock <strong style={{ color: "#10b981" }}>{"₿"} {fmtSats(l.priceMsats)}</strong> for you to borrow.</span>
              : isBillPay(l.category) ? <div>
                  {(() => { const cm = (l.terms || "").match(/Currency:\s*(\w+)/); return cm ? <div style={{ marginBottom: 6, textAlign: "center" }}><span style={{ color: "#64748b", fontSize: 11 }}>Currency:</span> <strong style={{ color: "#f59e0b", fontSize: 13 }}>{cm[1]}</strong></div> : null; })()}
                  {l.paymentMethods && l.paymentMethods.length > 0 && <div style={{ display: "flex", gap: 4, flexWrap: "wrap", justifyContent: "center" }}>{l.paymentMethods.map(pm => { const m = PAYMENT_METHODS.find(p => p.key === pm); return m ? <span key={pm} style={{ padding: "3px 8px", borderRadius: 6, fontSize: 10, fontWeight: 600, background: "rgba(16,185,129,0.1)", color: "#10b981", border: "1px solid rgba(16,185,129,0.2)" }}>{m.icon} {m.label}</span> : null; })}</div>}
                </div>
              : <span>You'll lock <strong style={{ color: "#10b981" }}>{"₿"} {fmtSats(l.priceMsats + (l.shippingCostSats ? l.shippingCostSats * 1000 : 0))}</strong> as payment.</span>}
            </div>
          </div>
        )}

        {isSeller && (
          <div style={{ ...M.infoBanner, borderColor: "rgba(245,158,11,0.2)", background: "rgba(245,158,11,0.06)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <span style={{ color: "#f59e0b", fontSize: 13, fontWeight: 600 }}>
                {isP2P ? "₿ Your P2P Trade Listing" : `🏠 ${t("mkYourListing")}`}
              </span>
              {l.status !== "deleted" && (
                <div style={{ display: "flex", gap: 6 }}>
                  <button onClick={() => onEdit(l)} style={{ padding: "4px 10px", borderRadius: 8, border: "1px solid rgba(245,158,11,0.3)", background: "rgba(245,158,11,0.1)", color: "#f59e0b", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>✏️ Edit</button>
                  {l.status === "active" && (
                    <button onClick={() => onPause(l.id)} style={{ padding: "4px 10px", borderRadius: 8, border: "1px solid rgba(100,116,139,0.3)", background: "rgba(100,116,139,0.1)", color: "#94a3b8", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>⏸ Pause</button>
                  )}
                  {l.status === "paused" && (
                    <button onClick={() => onUnpause(l.id)} style={{ padding: "4px 10px", borderRadius: 8, border: "1px solid rgba(16,185,129,0.3)", background: "rgba(16,185,129,0.1)", color: "#10b981", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>▶ Resume</button>
                  )}
                  <button onClick={() => onDelete(l.id)} style={{ padding: "4px 10px", borderRadius: 8, border: "1px solid rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.1)", color: "#f87171", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>🗑 Delete</button>
                </div>
              )}
            </div>
            {isP2P && (
              <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4, lineHeight: 1.5 }}>
                When someone starts this trade, you'll lock your ₿ sats in escrow. The buyer sends you fiat externally.
              </div>
            )}
          </div>
        )}

        {l.status !== "active" && (
          <div style={{ ...M.infoBanner, borderColor: "rgba(239,68,68,0.2)", background: "rgba(239,68,68,0.06)" }}>
            <span style={{ color: "#f87171", fontSize: 13, fontWeight: 600 }}>
              {l.status === "sold" ? t("mkQtySoldOut") : l.status === "paused" ? t("mkStatusPaused") : l.status === "deleted" ? t("mkStatusDeleted") : l.status}
            </span>
          </div>
        )}

        {l.description && (
          <div style={M.section}>
            <div style={M.sectionLabel}>{t("description")}</div>
            <div style={M.sectionValue}>{l.description?.split("\n").map((line, i) => {
              const urlMatch = line.match(/(https?:\/\/[^\s]+)/);
              if (urlMatch) {
                const url = urlMatch[1];
                const before = line.slice(0, urlMatch.index);
                const after = line.slice(urlMatch.index + url.length);
                return <div key={i}>{before}<a href={url} target="_blank" rel="noopener noreferrer" style={{ color: "#3b82f6", textDecoration: "underline" }}>{url}</a>{after}</div>;
              }
              return <div key={i}>{line}</div>;
            })}</div>
          </div>
        )}

        {l.terms && isSeller && (
          <div style={M.section}>
            <div style={M.sectionLabel}>{t("tradeTerms")}</div>
            {(() => {
              const raw = l.terms || "";
              const parts = raw.split(/---\s*(P2P Details|Loan Terms|Bill Pay Details)\s*---/);
              const userTerms = (parts[0] || "").trim();
              const metaBlock = parts.length > 2 ? parts[2] : "";
              const metaLines = metaBlock.split("\n").map(ln => ln.trim()).filter(Boolean);
              const meta = {};
              metaLines.forEach(line => { const [k, ...v] = line.split(":"); if (k && v.length) meta[k.trim()] = v.join(":").trim(); });
              if (Object.keys(meta).length === 0) return <div style={M.sectionValue}>{raw}</div>;
              return <>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center", marginBottom: userTerms ? 10 : 0 }}>
                  {Object.entries(meta).map(([k, v]) => (
                    <div key={k} style={{ padding: "5px 12px", borderRadius: 8, background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.2)", fontSize: 12 }}>
                      <span style={{ color: "#94a3b8" }}>{k}: </span>
                      <span style={{ color: "#f8fafc", fontWeight: 600 }}>{(k === "Interest" || k === "Rate") && v && !String(v).includes("%") ? v + "%" : k === "Fiat needed" ? v : v}</span>
                    </div>
                  ))}
                </div>
                {userTerms && <div style={{ fontSize: 13, color: "#cbd5e1", lineHeight: 1.8, textAlign: "center", whiteSpace: "pre-line", marginTop: 6 }}>{userTerms}</div>}
              </>;
            })()}
          </div>
        )}
        {l.terms && !isSeller && (
          <div style={{ ...M.infoBanner, borderColor: "rgba(100,116,139,0.2)", background: "rgba(100,116,139,0.04)", marginBottom: 14 }}>
            <div style={{ fontSize: 12, color: "#64748b", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
              🔒 {t("mkTradeTermsHidden") || "Trade terms visible after purchase"}
            </div>
          </div>
        )}

        {/* ── Listing info grid ── */}
        {!isBillPay(l.category) && <div style={{ display: "flex", justifyContent: "space-around", padding: "12px 0", marginBottom: 14, borderRadius: 12, background: "rgba(15,23,42,0.5)", border: "1px solid #1e293b", textAlign: "center" }}>
          {l.condition && !isP2P && !isBillPay(l.category) && (
            <div>
              <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5 }}>{t("mkCondition")}</div>
              <div style={{ fontSize: 13, color: "#f8fafc", fontWeight: 600, marginTop: 2 }}>{t(CONDITION_KEYS[l.condition] || l.condition)}</div>
            </div>
          )}
          {l.category && !isBillPay(l.category) && (
            <div>
              <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5 }}>{t("mkCategory")}</div>
              <div style={{ fontSize: 13, color: "#f8fafc", fontWeight: 600, marginTop: 2 }}>{l.category}</div>
            </div>
          )}
          {!isBillPay(l.category) && <div>
            <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5 }}>{t("mkAvailable")}</div>
            <div style={{ fontSize: 13, color: "#10b981", fontWeight: 700, marginTop: 2 }}>{l.quantity}</div>
          </div>}
        </div>}

        {/* ── Seller ── */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, padding: "14px", marginBottom: 10, borderRadius: 10, background: "rgba(245,158,11,0.04)", border: "1px solid rgba(245,158,11,0.1)" }}>
          <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5 }}>{t("seller")}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 18 }}>🏠</span>
            <div onClick={() => onProfile(l.sellerPubkey)} style={{ cursor: "pointer" }}><SellerName pubkey={l.sellerPubkey} /></div>
          </div>
        </div>

        <div style={{ fontSize: 11, color: "#334155", textAlign: "center", fontFamily: "monospace" }}>
          ID: {l.id}
        </div>
      </div>
    </div>
  );
}

