import { useState, useEffect } from "react";
import { fmtSats, fmtFiat, truncPk, getFedName, isLending, isSatsForFiat } from "./helpers";
import { PAYMENT_METHODS } from "./constants";
import { t } from "../i18n";
import { SellerName, StarRating, Icons } from "./components";
import M from "./styles";

export default function OrderDetailView({ order: o, pubkey, onBack, onProfile, onSwitchToEscrow, showToast, loading, setLoading, fiatRates, subdomain, mapi }) {
  const [detail, setDetail] = useState(null);
  const [rateScore, setRateScore] = useState(0);
  const [rateComment, setRateComment] = useState("");
  const [rated, setRated] = useState(false);
  const isBuyer = o.buyerPubkey === pubkey;
  const canCancel = isBuyer && (o.status === "pending");

  const loadOrderDetail = async () => {
    try {
      const data = await mapi(`/orders/${o.id}`);
      if (!data.error) {
        setDetail(data);
        if (data.order?.myRating != null) setRated(true);
        const repId = data.escrow?.loanRepaymentId;
        if (repId) {
          try {
            const repData = await fetch("/api/ecash-escrows/" + repId, {
              headers: window.__smToken ? { "Authorization": "Bearer " + window.__smToken } : {},
            }).then(r => r.json());
            if (repData && !repData.error) setRepaymentEscrow({ ...repData, repaymentEscrowId: repId, repaymentStatus: repData.status, repaymentSats: repData.amountSats || Math.floor((repData.amountMsats || 0) / 1000), dueAt: repData.loanDueAt, interestMsats: Math.floor((repData.amountMsats || 0) * (repData.loanInterestBps || 0) / 10000) });
          } catch {}
        }
      }
    } catch {}
  };
  useEffect(() => {
    loadOrderDetail();
    // Poll for lending orders to pick up auto-created repayment
    const isLoanOrder = subdomain === "lending" || (o.listingTitle || "").toLowerCase().includes("lend");
    if (isLoanOrder) {
      const iv = setInterval(loadOrderDetail, 10000);
      return () => clearInterval(iv);
    }
  }, [o.id]);

  const handleCancel = async () => {
    const listingId = detail?.order?.listingId || o.listingId;
    if (!listingId) return;
    setLoading(true);
    try {
      const res = await mapi(`/${listingId}/cancel`, { method: "POST" });
      if (res.error) throw new Error(res.error);
      showToast(t("mkOrderCancelledToast"));
      onBack();
    } catch (err) { showToast(err.message, "error"); }
    setLoading(false);
  };

  const handleRate = async () => {
    if (rateScore < 1) return showToast("Select a rating (1-5 stars)", "error");
    const otherPubkey = isBuyer ? o.sellerPubkey : o.buyerPubkey;
    setLoading(true);
    try {
      const res = await mapi(`/profile/${otherPubkey}/rate`, {
        method: "POST",
        body: JSON.stringify({ orderId: o.id, score: rateScore, comment: rateComment || undefined }),
      });
      if (res.error) throw new Error(res.error);
      showToast("⭐ Rating submitted — thank you!");
      setRated(true);
    } catch (err) { showToast(err.message, "error"); }
    setLoading(false);
  };

  const handleCreateRepayment = async () => {
    setRepaymentCreating(true);
    try {
      const res = await mapi(`/${o.id}/create-repayment`, { method: "POST" });
      if (res.error) throw new Error(res.error);
      setRepaymentEscrow(res);
      showToast("Repayment escrow created! Borrower must lock " + res.repaymentSats + " sats by " + new Date(res.dueAt).toLocaleDateString());
    } catch (err) { showToast(err.message, "error"); }
    setRepaymentCreating(false);
  };

  const escrow = detail?.escrow;
  const status = detail?.order?.status || o.status;
  // Only show rating prompt AFTER detail loads AND confirms no rating exists
  const detailLoaded = detail != null;
  const otherPubkey = isBuyer ? o.sellerPubkey : o.buyerPubkey;
  const isP2P = detail?.tradeType === "sats-for-fiat" || isSatsForFiat(detail?.listing?.category);
  const isLoan = detail?.tradeType === "lending" || isLending(detail?.listing?.category) || (escrow?.description || "").startsWith("Lending:") || (escrow?.description || "").startsWith("Loan Repayment");
  const isRepayment = (escrow?.description || "").startsWith("Loan Repayment") || (detail?.listing?.category === "lending" && escrow?.loanParentId);
  const needsRating = (detailLoaded || o.status === "completed") && status === "completed" && !rated && (!isLoan || isRepayment);
  const isLender = isLoan && o.sellerPubkey === pubkey;
  const isBorrower = isLoan && o.buyerPubkey === pubkey;
  const otherRole = isLoan ? (isBuyer ? "Lender" : "Borrower") : isBuyer ? t("seller") : t("buyer");
  const loanRepaymentId = escrow?.loanRepaymentId || null;
  const loanStatus = escrow?.loanStatus || null;
  const loanDueAt = escrow?.loanDueAt || null;
  const [repaymentCreating, setRepaymentCreating] = useState(false);
  const [repaymentEscrow, setRepaymentEscrow] = useState(null);
  const myExistingRating = detail?.order?.myRating;

  return (
    <div style={M.container}>
      <div style={M.viewHeader}>
        <button style={M.iconBtn} onClick={onBack}><Icons.Back /></button>
        <h2 style={M.viewTitle}>{o.listingTitle || detail?.listing?.title || t("mkOrder")}</h2>
        <div style={{ width: 36 }} />
      </div>

      <div style={{ paddingBottom: 20 }}>
        {/* ── Price + fiat ── */}
        <div style={{ textAlign: "center", marginBottom: 20, opacity: detail ? 1 : 0.5, transition: "opacity 0.3s" }}>
          <div style={{ fontSize: 36, fontWeight: 900, color: "#f8fafc", letterSpacing: -1 }}>
            <span style={{ color: "#f7931a", fontWeight: 800, fontSize: 34 }}>₿</span>{fmtSats(o.amountMsats)}
          </div>
          {detail?.listing?.shippingCostSats > 0 && (
            <div style={{ marginTop: 8, padding: "10px 14px", borderRadius: 10, background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.12)", maxWidth: 260, margin: "8px auto 0" }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#94a3b8", marginBottom: 4 }}>
                <span>Item price</span>
                <span>₿ {(Math.floor(o.amountMsats / 1000) - detail.listing.shippingCostSats).toLocaleString()} sats</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#3b82f6", marginBottom: 4 }}>
                <span>📦 Shipping</span>
                <span>+ ₿ {detail.listing.shippingCostSats.toLocaleString()} sats</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 700, color: "#f8fafc", borderTop: "1px solid rgba(245,158,11,0.15)", paddingTop: 6, marginTop: 4 }}>
                <span>Total</span>
                <span>₿ {fmtSats(o.amountMsats)} sats</span>
              </div>
            </div>
          )}
          {fiatRates && <div style={{ fontSize: 13, color: "#64748b", marginTop: 2 }}>≈ {fmtFiat(o.amountMsats, fiatRates, "USD")}</div>}
        </div>
        {/* ── Federation — shown high for picker visibility ── */}
        {(detail?.listing?.sellerFedDomain || escrow?.federationId) && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "8px 14px", marginBottom: 16, borderRadius: 10, background: "rgba(139,92,246,0.08)", border: "1px solid rgba(139,92,246,0.2)" }}>
            <span style={{ fontSize: 14 }}>🏛️</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#a78bfa" }}>{getFedName(detail?.listing?.sellerFedPrefix || escrow?.seller_fed_prefix, detail?.listing?.sellerFedDomain || escrow?.federationId)}</span>
            <span style={{ fontSize: 10, color: "#64748b", marginLeft: 4 }}>Federation</span>
          </div>
        )}

        {/* ── Participants ── */}
        <div style={{ display: "flex", justifyContent: "space-around", marginBottom: 20, padding: "14px 0", borderRadius: 12, background: "rgba(15,23,42,0.5)", border: "1px solid #1e293b" }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 22, marginBottom: 4 }}>🏠</div>
            <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5 }}>{t("seller")}</div>
            <div onClick={() => onProfile(o.sellerPubkey)} style={{ cursor: "pointer" }}><SellerName pubkey={o.sellerPubkey} /></div>
            {o.sellerPubkey === pubkey && <span style={{ fontSize: 9, color: "#f59e0b", fontWeight: 700, background: "rgba(245,158,11,0.12)", padding: "1px 6px", borderRadius: 4, marginTop: 2, display: "inline-block" }}>YOU</span>}
          </div>
          <div style={{ width: 1, background: "#1e293b" }} />
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 22, marginBottom: 4 }}>🛒</div>
            <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5 }}>{t("buyer")}</div>
            <div onClick={() => onProfile(o.buyerPubkey)} style={{ cursor: "pointer" }}><SellerName pubkey={o.buyerPubkey} /></div>
            {o.buyerPubkey === pubkey && <span style={{ fontSize: 9, color: "#8b5cf6", fontWeight: 700, background: "rgba(139,92,246,0.12)", padding: "1px 6px", borderRadius: 4, marginTop: 2, display: "inline-block" }}>YOU</span>}
          </div>
          {o.arbiterPubkey && (
            <>
              <div style={{ width: 1, background: "#1e293b" }} />
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 22, marginBottom: 4 }}>⚖️</div>
                <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5 }}>{t("arbiter")}</div>
                <div style={{ fontFamily: "monospace", fontSize: 10, color: "#475569" }}>{truncPk(o.arbiterPubkey)}</div>
              </div>
            </>
          )}
        </div>

        {/* ── Trade info (description + terms) ── */}
        {(detail?.listing?.description || detail?.listing?.terms || escrow?.terms) && (
          <div style={{ marginBottom: 16, padding: "12px 16px", borderRadius: 12, background: "rgba(245,158,11,0.04)", border: "1px solid rgba(245,158,11,0.12)" }}>
            {(detail?.listing?.description || escrow?.description) && (
              <div style={{ marginBottom: detail?.listing?.terms || escrow?.terms ? 20 : 0 }}>
                <div style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4, textAlign: "center" }}>Description</div>
                <div style={{ fontSize: 13, color: "#cbd5e1", lineHeight: 1.8, textAlign: "center", whiteSpace: "pre-line" }}>{detail?.listing?.description || escrow?.description}</div>
              </div>
            )}
            {(detail?.listing?.terms || escrow?.terms) && (
              <div>
                <div style={{ fontSize: 11, color: "#f59e0b", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8, display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>ⓘ Trade Terms</div>
                {(() => {
                  const raw = detail?.listing?.terms || escrow?.terms || "";
                  const parts = raw.split(/---\s*(P2P Details|Loan Terms|Bill Pay Details)\s*---/);
                  const userTerms = (parts[0] || "").trim();
                  const metaBlock = parts.length > 2 ? parts[2] : "";
                  const metaLines = metaBlock.split("\n").map(l => l.trim()).filter(Boolean);
                  const meta = {};
                  metaLines.forEach(line => { const [k, ...v] = line.split(":"); if (k && v.length) meta[k.trim()] = v.join(":").trim(); });
                  return <>
                    {Object.keys(meta).length > 0 && (
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center", marginBottom: userTerms ? 10 : 0 }}>
                        {Object.entries(meta).map(([k, v]) => (
                          <div key={k} style={{ padding: "5px 12px", borderRadius: 8, background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.2)", fontSize: 12 }}>
                            <span style={{ color: "#94a3b8" }}>{k}: </span>
                            <span style={{ color: "#f8fafc", fontWeight: 600 }}>{(k === "Interest" || k === "Rate") && v && !String(v).includes("%") ? v + "%" : v}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {userTerms && <div style={{ fontSize: 13, color: "#cbd5e1", lineHeight: 1.8, textAlign: "center", whiteSpace: "pre-line" }}>{userTerms}</div>}
                  </>;
                })()}
              </div>
            )}
          </div>
        )}


        {/* ── Accepted Payment Methods ── */}
        {detail?.listing?.paymentMethods && detail.listing.paymentMethods.length > 0 && (
          <div style={{ marginBottom: 16, padding: "10px 14px", borderRadius: 12, background: "rgba(16,185,129,0.04)", border: "1px solid rgba(16,185,129,0.12)" }}>
            <div style={{ fontSize: 10, color: "#10b981", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8, textAlign: "center" }}>{t("mkAcceptedPayment") || "Accepted Payment Methods"}</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "center" }}>
              {detail.listing.paymentMethods.map(pm => { const m = PAYMENT_METHODS.find(p => p.key === pm); return m ? <span key={pm} style={{ padding: "4px 10px", borderRadius: 8, fontSize: 11, fontWeight: 600, background: "rgba(16,185,129,0.1)", color: "#10b981", border: "1px solid rgba(16,185,129,0.2)" }}>{m.icon} {m.label}</span> : null; })}
            </div>
          </div>
        )}
        {/* ── ONE action button ── */}
        {onSwitchToEscrow && (status === "pending" || status === "active") && (o.escrowId || escrow?.id) && (
          <button
            onClick={() => onSwitchToEscrow(escrow?.id || o.escrowId)}
            style={{
              ...M.actionBtn,
              background: o.listingCategory === "bill-pay" ? "linear-gradient(135deg, #f59e0b, #d97706)" : status === "active"
                ? "linear-gradient(135deg, #f59e0b, #d97706)"
                : "linear-gradient(135deg, #7c3aed, #6d28d9)",
              boxShadow: o.listingCategory === "bill-pay" ? "0 4px 24px rgba(245,158,11,0.3)" : status === "active"
                ? "0 4px 24px rgba(245,158,11,0.3)"
                : "0 4px 24px rgba(124,58,237,0.3)",
              marginBottom: 8, fontSize: 16, padding: "16px 20px",
            }}
          >
            {status === "pending"
              ? (isP2P
                  ? (isBuyer ? (isRepayment ? "💰 Lock Repayment" : isLoan ? "✓ Accept Loan" : (fiatRates ? "💵 " + (t("mkPrepare") || "Prepare") + " " + fmtFiat(o.amountMsats, fiatRates, "USD") : t("mkViewTrade") || "View Trade")) : (isRepayment ? "🔍 View Repayment" : isLoan ? "🤝 Fund Loan" : "🔐 " + (t("mkLockEcash") || "Lock E-cash")))
: (isRepayment ? (isBuyer ? "💰 Lock Repayment" : "🔍 View Repayment") : isLoan ? (isBuyer ? "✓ Accept Loan" : "🤝 Fund Loan") : (o.listingCategory === "bill-pay" ? (isBuyer ? (fiatRates ? "💵 " + (t("mkPrepare") || "Prepare") + " " + (() => { const rm = (detail?.listing?.terms || "").match(/Rate:\s*(\d+)/); const rp = rm ? parseFloat(rm[1]) : 0; const base = rp > 0 ? Math.floor(o.amountMsats / (1 + rp / 100)) : o.amountMsats; return fmtFiat(base, fiatRates, "USD"); })() : "View Trade") : "🧾 " + (t("mkLockSats") || "Lock Sats")) : (isBuyer ? "🔐 " + (t("mkLockPayment") || "Lock Payment") : "View Trade"))))
              : isRepayment ? "💰 Open Repayment" : isLoan ? "🤝 Open Loan" : "⚡ Open Trade"
            }
          </button>
        )}

        {/* ── ONE status notification ── */}
        {status !== "completed" && status !== "cancelled" && status !== "expired" && (
          <div style={{ textAlign: "center", padding: "8px 0", fontSize: 12, color: "#64748b" }}>
            {status === "pending" && (
              isP2P
                ? (isBuyer ? "Waiting for seller to lock e-cash…" : ("🔐 Lock your e-cash to start the trade. Make sure you have ₿ " + fmtSats(o.amountMsats) + " sats in your federation wallet."))
                : (isRepayment ? (isBuyer ? "Lock your sats to repay the loan." : "Waiting for borrower to lock repayment sats…") : isLoan ? (isBuyer ? "Waiting for lender to fund the loan…" : "🤝 Lock your sats to fund this loan.") : (o.listingCategory === "bill-pay" ? (isBuyer ? "Waiting for bill poster to lock sats…" : "🧾 Lock your sats — a volunteer will pay your bill.") : (isBuyer ? "Lock your e-cash as payment." : "Waiting for buyer to lock payment…")))
            )}
            {status === "active" && "Trade in progress — open to vote and confirm."}
          </div>
        )}

        {/* ── Cancel (buyer only, before lock) ── */}
        {canCancel && (
          <button style={{ ...M.actionBtn, background: "linear-gradient(135deg, #dc2626, #b91c1c)", marginTop: 8, marginBottom: 80, fontSize: 13, padding: "10px 16px" }} onClick={handleCancel} disabled={loading}>
            {loading ? t("mkCancelling") : t("mkCancelOrder")}
          </button>
        )}

        {/* ── Completed ── */}
        {status === "completed" && !needsRating && !rated && !isLoan && (
          <div style={{ textAlign: "center", padding: "14px 0", color: "#10b981", fontSize: 14, fontWeight: 600 }}>
            ✓ Trade complete
          </div>
        )}

        {/* ── Lending: Loan Disbursed ── */}
        {isLoan && status === "completed" && !isRepayment && (
          <div style={{ borderRadius: 14, padding: "16px", marginBottom: 16, background: loanRepaymentId ? "linear-gradient(145deg, rgba(239,68,68,0.08), rgba(239,68,68,0.03))" : "linear-gradient(145deg, rgba(16,185,129,0.06), rgba(16,185,129,0.02))", border: loanRepaymentId ? "2px solid rgba(239,68,68,0.4)" : "1px solid rgba(16,185,129,0.2)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <span style={{ fontSize: 20 }}>{"🤝"}</span>
              <span style={{ fontSize: 15, fontWeight: 700, color: loanRepaymentId ? "#ef4444" : "#10b981" }}>{repaymentEscrow?.repaymentStatus === "COMPLETED" || repaymentEscrow?.repaymentStatus === "CLAIMED" ? "✅ Loan Complete" : loanRepaymentId ? "⚠️ Repayment Required" : "✅ Loan Disbursed Successfully"}</span>
            </div>

            {!loanRepaymentId && !repaymentEscrow && isLender && !(repaymentEscrow?.repaymentStatus === "COMPLETED" || repaymentEscrow?.repaymentStatus === "CLAIMED") && (
              <div>
                <div style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.6, marginBottom: 12 }}>
                  The borrower has received the sats. Create a repayment escrow so they can pay you back with interest.
                </div>
                <button onClick={handleCreateRepayment} disabled={repaymentCreating} style={{
                  ...M.actionBtn, background: "linear-gradient(135deg, #10b981, #059669)",
                  boxShadow: "0 4px 24px rgba(16,185,129,0.3)", fontSize: 15, padding: "14px 20px",
                }}>
                  {repaymentCreating ? "Creating..." : "💰 Create Repayment Escrow"}
                </button>
              </div>
            )}

            {!loanRepaymentId && !repaymentEscrow && isBorrower && (
              <div style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.6, textAlign: "center" }}>
                You received the loan. The lender will create a repayment escrow for you to pay back.
              </div>
            )}

            {/* ── Loan Fully Repaid ── */}
            {repaymentEscrow?.repaymentStatus && (repaymentEscrow.repaymentStatus === "COMPLETED" || repaymentEscrow.repaymentStatus === "CLAIMED") && (
              <div style={{ padding: "16px", borderRadius: 12, background: "rgba(16,185,129,0.08)", border: "2px solid rgba(16,185,129,0.3)", textAlign: "center", marginBottom: 12 }}>
                <div style={{ fontSize: 28, marginBottom: 6 }}>✅</div>
                <div style={{ fontSize: 16, fontWeight: 800, color: "#10b981", marginBottom: 4 }}>Loan Fully Repaid</div>
                <div style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.6 }}>
                  {isBorrower ? "You have successfully repaid this loan. Your trust score has been updated." : "The borrower has repaid in full. Sats have been returned to you."}
                </div>
                {repaymentEscrow.amountMsats && (
                  <div style={{ marginTop: 10, padding: "8px 14px", borderRadius: 8, background: "rgba(16,185,129,0.06)", display: "inline-block" }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "#10b981" }}>₿ {Math.floor(repaymentEscrow.amountMsats / 1000).toLocaleString()} sats repaid</span>
                  </div>
                )}
              </div>
            )}
            {(loanRepaymentId || repaymentEscrow) && !(repaymentEscrow?.repaymentStatus === "COMPLETED" || repaymentEscrow?.repaymentStatus === "CLAIMED") && (
              <div>
                <div style={{ padding: "12px 14px", borderRadius: 10, background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.2)", marginBottom: 12 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#f59e0b", marginBottom: 6 }}>{isBorrower ? "💰 You owe a repayment" : "⏳ Awaiting borrower repayment"}</div>
                  <div style={{ fontSize: 12, color: "#cbd5e1", lineHeight: 1.6 }}>
                    {isBorrower
                      ? "A repayment escrow has been created. Lock your sats to repay the loan. Failure to repay will flag your profile."
                      : "Waiting for the borrower to lock repayment sats. If they default, their profile will be flagged."
                    }
                  </div>
                </div>
                {repaymentEscrow && (
                  <div style={{ padding: "10px 14px", borderRadius: 10, background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.15)", marginBottom: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                      <span style={{ color: "#64748b" }}>Repayment amount</span>
                      <span style={{ fontWeight: 700, color: "#f59e0b" }}>{"₿"} {repaymentEscrow.repaymentSats?.toLocaleString()} sats</span>
                    </div>
                    {repaymentEscrow.interestMsats > 0 && (
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 4 }}>
                        <span style={{ color: "#475569" }}>Interest</span>
                        <span style={{ color: "#10b981" }}>{"₿"} {Math.floor(repaymentEscrow.interestMsats / 1000).toLocaleString()} sats</span>
                      </div>
                    )}
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                      <span style={{ color: "#475569" }}>Due by</span>
                      <span style={{ color: "#f87171" }}>{new Date(repaymentEscrow.dueAt).toLocaleDateString()}</span>
                    </div>
                  </div>
                )}
                <button onClick={() => onSwitchToEscrow(loanRepaymentId || repaymentEscrow?.repaymentEscrowId)} style={{
                  ...M.actionBtn, background: isBorrower
                    ? "linear-gradient(135deg, #f59e0b, #d97706)"
                    : "linear-gradient(135deg, #7c3aed, #6d28d9)",
                  fontSize: 14, padding: "12px 20px",
                }}>
                  {isBorrower ? "🔐 Open Repayment Escrow" : "🔍 View Repayment Escrow"}
                </button>
              </div>
            )}

            {loanDueAt && (
              <div style={{
                marginTop: 12, padding: "10px 14px", borderRadius: 10, textAlign: "center",
                background: new Date(loanDueAt) < new Date() ? "rgba(239,68,68,0.1)" : "rgba(59,130,246,0.06)",
                border: new Date(loanDueAt) < new Date() ? "1px solid rgba(239,68,68,0.3)" : "1px solid rgba(59,130,246,0.15)",
              }}>
                <div style={{ fontSize: 11, color: "#64748b", marginBottom: 2 }}>Repayment deadline</div>
                <div style={{ fontSize: 15, fontWeight: 800, color: new Date(loanDueAt) < new Date() ? "#ef4444" : "#3b82f6" }}>
                  {new Date(loanDueAt) < new Date()
                    ? "⚠️ OVERDUE — " + Math.floor((Date.now() - new Date(loanDueAt).getTime()) / 86400000) + " days late"
                    : new Date(loanDueAt).toLocaleDateString() + " (" + Math.ceil((new Date(loanDueAt).getTime() - Date.now()) / 86400000) + " days left)"
                  }
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Rating prompt ── */}
        {needsRating && (
          <div style={{ borderRadius: 12, padding: "12px 16px", marginBottom: 12, background: "linear-gradient(135deg, rgba(245,158,11,0.08), rgba(245,158,11,0.03))", border: "1px solid rgba(245,158,11,0.2)" }}>
            <div style={{ textAlign: "center", marginBottom: 8 }}>
              <span style={{ fontSize: 20 }}>⭐</span>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#f8fafc", marginTop: 4 }}>Rate your {otherRole}</div>
            </div>
            <div style={{ textAlign: "center", marginBottom: 8 }}>
              <StarRating score={rateScore} onChange={setRateScore} size={28} />
            </div>
            {rateScore > 0 && (
              <>
                <textarea value={rateComment} onChange={(e) => setRateComment(e.target.value)} placeholder="Optional comment..." maxLength={500} style={{ ...M.input, minHeight: 44, resize: "vertical", marginBottom: 8, fontSize: 12 }} />
                <button style={{ ...M.actionBtn, background: "linear-gradient(135deg, #f59e0b, #d97706)", color: "#0c0f17", padding: "10px 16px", fontSize: 13 }} onClick={handleRate} disabled={loading || !rateScore}>
                  {loading ? "Submitting…" : "⭐ Submit " + rateScore + "-Star Rating"}
                </button>
              </>
            )}
          </div>
        )}

        {/* ── Already rated ── */}
        {rated && (
          <div style={{ textAlign: "center", padding: "14px 16px", marginBottom: 16, borderRadius: 12, background: "rgba(16,185,129,0.06)", border: "1px solid rgba(16,185,129,0.15)" }}>
            <span style={{ color: "#10b981", fontSize: 13, fontWeight: 600 }}>
              ✓ You rated this trade {myExistingRating ? myExistingRating.score + "/5" : rateScore ? rateScore + "/5" : ""}
            </span>
          </div>
        )}

      </div>
    </div>
  );
}

