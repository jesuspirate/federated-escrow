import { useState, useEffect, useRef } from "react";
import M from "./styles";

export default function ChapSmartView({ onBack, showToast, pubkey }) {
  const [tab, setTab] = useState("send"); // send | airtime | buy
  const [step, setStep] = useState(0); // 0=form, 1=quote, 2=pay, 3=done
  const [loading, setLoading] = useState(false);
  const [account, setAccount] = useState(() => { try { return localStorage.getItem("sm_chap_account") || ""; } catch { return ""; } });

  // Form state
  const [amountTZS, setAmountTZS] = useState("");
  const [phone, setPhone] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [quote, setQuote] = useState(null);
  const [invoice, setInvoice] = useState(null);
  const [result, setResult] = useState(null);
  const [polling, setPolling] = useState(false);
  const [mpesaId, setMpesaId] = useState("");
  const pollRef = useRef(null);

  // Authenticate with ChapSmart via Nostr (auto signup/login)
  const ensureAccount = async () => {
    if (account) return account;
    // Try Nostr auth first
    if (window.nostr) {
      try {
        const pubkey = await window.nostr.getPublicKey();
        // Build NIP-98 event for login
        const event = {
          kind: 27235,
          created_at: Math.floor(Date.now() / 1000),
          tags: [["u", location.origin + "/api/chapsmart/nostr/login"], ["method", "POST"]],
          content: "",
        };
        const signedEvent = await window.nostr.signEvent(event);
        // Try login first
        const loginRes = await fetch("/api/chapsmart/nostr/login", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ signedEvent }),
        });
        const loginData = await loginRes.json();
        if (loginData.success && loginData.accountNumber) {
          setAccount(loginData.accountNumber);
          try { localStorage.setItem("sm_chap_account", loginData.accountNumber); } catch {}
          return loginData.accountNumber;
        }
        // If 404 (no account), signup
        if (loginRes.status === 404) {
          const signupEvent = {
            kind: 27235,
            created_at: Math.floor(Date.now() / 1000),
            tags: [["u", location.origin + "/api/chapsmart/nostr/signup"], ["method", "POST"]],
            content: "",
          };
          const signedSignup = await window.nostr.signEvent(signupEvent);
          const signupRes = await fetch("/api/chapsmart/nostr/signup", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ signedEvent: signedSignup }),
          });
          const signupData = await signupRes.json();
          if (signupData.success && signupData.accountNumber) {
            setAccount(signupData.accountNumber);
            try { localStorage.setItem("sm_chap_account", signupData.accountNumber); } catch {}
            return signupData.accountNumber;
          }
        }
      } catch (err) { console.warn("[chapsmart] Nostr auth failed, falling back:", err); }
    }
    // Fallback: anonymous account
    try {
      const res = await fetch("/api/chapsmart/create-account", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const data = await res.json();
      if (data.success && data.accountNumber) {
        setAccount(data.accountNumber);
        try { localStorage.setItem("sm_chap_account", data.accountNumber); } catch {}
        return data.accountNumber;
      }
    } catch {}
    showToast("Failed to create ChapSmart account", "error");
    return null;
  };

  const getQuote = async () => {
    if (!amountTZS || !phone) { showToast("Enter amount and phone number", "error"); return; }
    setLoading(true);
    const acct = await ensureAccount();
    if (!acct) { setLoading(false); return; }
    try {
      // Normalize phone: strip everything, ensure 0xxx format for Chapsmart
      let cleanPhone = phone.replace(/[^0-9]/g, "");
      // Strip country code variants
      if (cleanPhone.startsWith("255")) cleanPhone = "0" + cleanPhone.substring(3);
      if (cleanPhone.startsWith("0255")) cleanPhone = "0" + cleanPhone.substring(4);
      // Ensure starts with 0
      if (!cleanPhone.startsWith("0") && cleanPhone.length >= 9) cleanPhone = "0" + cleanPhone;
      // Validate: must be 10 digits starting with 0
      if (cleanPhone.length !== 10 || !cleanPhone.startsWith("0")) {
        showToast("Phone must be 10 digits starting with 0 (e.g. 0741000000)", "error");
        return;
      }

      const endpoint = tab === "airtime" ? "/api/chapsmart/airtime/quote" : "/api/chapsmart/quote";
      const body = tab === "airtime"
        ? { amountTZS, phoneNumber: cleanPhone, accountNumber: acct }
        : { amountTZS, phoneNumber: cleanPhone, recipientName: recipientName || "Recipient", accountNumber: acct };
      const res = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Quote failed");
      setQuote(data);
      setStep(1);
    } catch (err) { showToast(err.message, "error"); }
    setLoading(false);
  };

  const generateInvoice = async () => {
    setLoading(true);
    try {
      const endpoint = tab === "airtime" ? "/api/chapsmart/airtime/generate" : "/api/chapsmart/generate-invoice";
      const res = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ quoteId: quote.quoteId }) });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Invoice generation failed");
      setInvoice(data);
      setStep(2);
      // Start polling for payment status
      startPolling(data.invoiceId);
    } catch (err) { showToast(err.message, "error"); }
    setLoading(false);
  };

  const startPolling = (invoiceId) => {
    setPolling(true);
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch("/api/chapsmart/status/" + invoiceId);
        const data = await res.json();
        if (data.status === "completed" || data.status === "settled") {
          clearInterval(pollRef.current);
          setPolling(false);
          setResult({ amountTZS, phone, status: data.status });
          setStep(3);
          showToast(tab === "airtime" ? "Airtime delivered!" : "M-Pesa delivered!", "ok");
        } else if (data.status === "failed" || data.status === "expired") {
          clearInterval(pollRef.current);
          setPolling(false);
          showToast("Transaction " + data.status + ". " + (data.message || ""), "error");
        }
      } catch {}
    }, 5000);
  };

  useEffect(() => { return () => { if (pollRef.current) clearInterval(pollRef.current); }; }, []);

  const payWithWallet = async () => {
    if (!window.webln) { showToast("No Lightning wallet detected", "error"); return; }
    try {
      await window.webln.enable();
      await window.webln.sendPayment(invoice.bolt11);
      showToast("Payment sent! Waiting for delivery...");
      // Ensure polling is running after wallet payment
      if (!polling && invoice.invoiceId) startPolling(invoice.invoiceId);
    } catch (err) { showToast("Payment failed: " + (err.message || ""), "error"); }
  };

  const copyBolt11 = () => {
    navigator.clipboard.writeText(invoice.bolt11).then(
      () => showToast("Invoice copied!"),
      () => showToast("Copy failed", "error")
    );
  };

  const reset = () => { setStep(0); setQuote(null); setInvoice(null); setResult(null); setAmountTZS(""); setPhone(""); setRecipientName(""); };

  // Tab button style
  const tabStyle = (active) => ({
    flex: 1, padding: "10px 0", borderRadius: 10, border: "none", fontSize: 12, fontWeight: 700, cursor: "pointer",
    background: active ? "rgba(59,130,246,0.15)" : "transparent",
    color: active ? "#3b82f6" : "#64748b",
  });

  return (
    <div style={M.container}>
      {/* Header */}
      <div style={M.viewHeader}>
        <button style={M.iconBtn} onClick={onBack}><Icons.Back /></button>
        <h2 style={{ ...M.viewTitle, fontSize: 16 }}>
          <span style={{ color: "#3b82f6" }}>Chap</span><span style={{ color: "#f59e0b" }}>Smart</span>
        </h2>
        <span style={{ fontSize: 10, color: "#64748b", padding: "3px 8px", borderRadius: 99, border: "1px solid #1e293b" }}>TZ</span>
      </div>

      {/* Tabs */}
      {step === 0 && (
        <div style={{ display: "flex", gap: 4, marginBottom: 14, background: "#111827", borderRadius: 12, padding: 4 }}>
          <button style={tabStyle(tab === "send")} onClick={() => setTab("send")}>💸 Send TZS</button>
          <button style={tabStyle(tab === "airtime")} onClick={() => setTab("airtime")}>📱 Airtime</button>
          <button style={tabStyle(tab === "buy")} onClick={() => setTab("buy")}>₿ Buy Sats</button>
        </div>
      )}

      {/* Step 0: Form */}
      {step === 0 && (tab === "send" || tab === "airtime") && (
        <div style={{ ...M.card, padding: 16 }}>
          <div style={{ fontSize: 11, color: "#3b82f6", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 }}>
            {tab === "send" ? "Send Bitcoin → Receive M-Pesa" : "Buy Airtime with Bitcoin"}
          </div>

          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>Amount (TZS)</div>
            <input style={{ ...M.input, fontSize: 18, fontWeight: 700 }} type="number" value={amountTZS} onChange={e => setAmountTZS(e.target.value)}
              placeholder={tab === "send" ? "2,500 — 1,000,000" : "500 — 15,000"} />
          </div>

          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>{tab === "send" ? "Vodacom M-Pesa Number" : "Phone Number"}</div>
            <input style={M.input} value={phone} onChange={e => setPhone(e.target.value)} placeholder="07XXXXXXXX" />
          </div>

          {tab === "send" && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>Recipient Name</div>
              <input style={M.input} value={recipientName} onChange={e => setRecipientName(e.target.value)} placeholder="John Doe" />
            </div>
          )}

          <div style={{ padding: "8px 12px", borderRadius: 8, background: "rgba(59,130,246,0.08)", border: "1px solid rgba(59,130,246,0.15)", marginBottom: 14, fontSize: 11, color: "#94a3b8" }}>
            ⚡ Powered by ChapSmart × SatoshiMarket — Lightning fast, ~10s settlement
          </div>

          <button onClick={getQuote} disabled={loading || !amountTZS || !phone}
            style={{ ...M.actionBtn, background: "linear-gradient(135deg, #3b82f6, #2563eb)", color: "#fff", opacity: loading ? 0.6 : 1 }}>
            {loading ? "Getting quote..." : "⚡ Get Quote"}
          </button>
        </div>
      )}

      {/* Step 0: Buy Sats form */}
      {step === 0 && tab === "buy" && (
        <div style={{ ...M.card, padding: 16 }}>
          <div style={{ textAlign: "center", marginBottom: 16 }}>
            <div style={{ fontSize: 28, marginBottom: 4 }}>₿</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#f59e0b" }}>Buy Sats with M-Pesa</div>
            <div style={{ fontSize: 11, color: "#64748b" }}>Send TZS via M-Pesa, receive sats to your wallet</div>
          </div>
          <div style={{ marginBottom: 10 }}>
            <label style={{ fontSize: 11, color: "#94a3b8", fontWeight: 600 }}>Amount (TZS)</label>
            <input style={M.input} type="number" value={amountTZS} onChange={e => setAmountTZS(e.target.value)} placeholder="1,000 — 20,000" />
          </div>
          <button onClick={async () => {
            if (!amountTZS || parseInt(amountTZS) < 1000) { showToast("Minimum 1,000 TZS", "error"); return; }
            setLoading(true);
            try {
              const acct = account || await ensureAccount();
              const res = await fetch("/api/chapsmart/buy-sats/quote", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ amountTZS: parseInt(amountTZS), accountNumber: acct }),
              });
              const data = await res.json();
              if (data.success === false) { showToast(data.error || "Quote failed", "error"); setLoading(false); return; }
              setInvoice({ ...data, type: "buy" });
              setStep(1);
            } catch (err) { showToast("Failed to get quote", "error"); }
            setLoading(false);
          }} style={{ width: "100%", padding: "12px 0", borderRadius: 10, border: "none", cursor: "pointer", background: "linear-gradient(135deg, #f59e0b, #d97706)", color: "#0c0f17", fontSize: 14, fontWeight: 700 }} disabled={loading}>
            {loading ? "Getting quote..." : "Get Quote"}
          </button>
        </div>
      )}

      {/* Step 1: Buy Sats — show quote + M-Pesa payment */}
      {step === 1 && tab === "buy" && invoice?.type === "buy" && (
        <div style={{ ...M.card, padding: 16, textAlign: "center" }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>₿</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#f8fafc", marginBottom: 4 }}>
            You will receive: <span style={{ color: "#f59e0b" }}>{invoice.calculatedSats || invoice.amountSats || invoice.satsAmount || "?"} sats</span>
          </div>
          <div style={{ fontSize: 13, color: "#64748b", marginBottom: 16 }}>
            for {parseInt(amountTZS).toLocaleString()} TZS via M-Pesa
          </div>

          <div style={{ background: "#0f1629", borderRadius: 10, padding: 14, marginBottom: 14, textAlign: "left" }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#f59e0b", marginBottom: 6 }}>How it works:</div>
            <div style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.6 }}>
              1. Send <strong style={{ color: "#f8fafc" }}>{parseInt(amountTZS).toLocaleString()} TZS</strong> via M-Pesa<br/>
              2. Enter your M-Pesa transaction ID below<br/>
              3. Sats sent to your Fedi wallet instantly
            </div>
            <div style={{ marginTop: 10, padding: "10px 12px", borderRadius: 8, background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.15)" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#f59e0b", marginBottom: 6 }}>KUTOA M-Pesa:</div>
              <div style={{ fontSize: 11, color: "#cbd5e1", lineHeight: 1.8, fontFamily: "monospace" }}>
                1. Piga <strong style={{ color: "#f8fafc" }}>*150*00#</strong><br/>
                2. Chagua <strong>2</strong> – Kutoa Pesa<br/>
                3. Namba ya wakala: <strong style={{ color: "#f8fafc" }}>1228685</strong><br/>
                4. Kiasi: <strong style={{ color: "#f59e0b" }}>{parseInt(amountTZS).toLocaleString()} TZS</strong><br/>
                5. Jina: <strong style={{ color: "#f8fafc" }}>BRIAN</strong><br/>
                6. Weka PIN yako na uthibitishe
              </div>
            </div>
          </div>

          {invoice.mpesaNumber && (
            <div style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.2)", borderRadius: 10, padding: 12, marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: "#f59e0b", fontWeight: 600 }}>Send M-Pesa to:</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: "#f8fafc", marginTop: 4 }}>{invoice.mpesaNumber}</div>
            </div>
          )}

          <div style={{ marginBottom: 10, textAlign: "left" }}>
            <label style={{ fontSize: 11, color: "#94a3b8", fontWeight: 600 }}>M-Pesa Transaction ID</label>
            <input style={M.input} value={mpesaId || ""} onChange={e => setMpesaId(e.target.value)} placeholder="e.g. QK7B2XYZ99" />
          </div>

          <button onClick={async () => {
            if (!mpesaId || mpesaId.trim().length < 5) { showToast("Enter your M-Pesa transaction ID", "error"); return; }
            setLoading(true);
            try {
              let bolt11;
              if (window.webln) {
                await window.webln.enable();
                const inv = await window.webln.makeInvoice({ amount: invoice.calculatedSats || invoice.amountSats || invoice.satsAmount });
                bolt11 = inv.paymentRequest;
              } else {
                bolt11 = prompt("Paste a Lightning invoice for " + (invoice.calculatedSats || invoice.amountSats || invoice.satsAmount) + " sats:");
              }
              if (!bolt11) { setLoading(false); return; }
              const res = await fetch("/api/chapsmart/buy-sats/send", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ quoteId: invoice.quoteId || invoice.id, mpesaId: mpesaId.trim(), bolt11 }),
              });
              const data = await res.json();
              if (data.success === false) { showToast(data.error || "Failed", "error"); }
              else {
                setResult({ amountTZS, status: "completed", sats: invoice.calculatedSats || invoice.amountSats || invoice.satsAmount });
                setStep(3);
                showToast("Sats incoming! Check your wallet.", "ok");
              }
            } catch (err) { showToast("Failed: " + (err.message || ""), "error"); }
            setLoading(false);
          }} style={{ width: "100%", padding: "12px 0", borderRadius: 10, border: "none", cursor: "pointer", background: "linear-gradient(135deg, #f59e0b, #d97706)", color: "#0c0f17", fontSize: 14, fontWeight: 700 }} disabled={loading}>
            {loading ? "Processing..." : "⚡ Confirm & Receive Sats"}
          </button>

          <button onClick={() => { setStep(0); setInvoice(null); }} style={{ width: "100%", padding: 10, marginTop: 8, background: "transparent", border: "none", color: "#64748b", fontSize: 12, cursor: "pointer" }}>
            ← Back
          </button>
        </div>
      )}

      {/* Step 1: Quote */}
      {step === 1 && quote && (
        <div style={{ ...M.card, padding: 16 }}>
          <div style={{ textAlign: "center", marginBottom: 14 }}>
            <div style={{ fontSize: 11, color: "#3b82f6", textTransform: "uppercase", letterSpacing: 1 }}>Quote Ready</div>
            <div style={{ fontSize: 28, fontWeight: 800, marginTop: 4 }}>
              <span style={{ color: "#f59e0b" }}>₿</span> {quote.youPay.sats.toLocaleString()}
              <span style={{ fontSize: 13, color: "#94a3b8" }}> sats</span>
            </div>
            <div style={{ fontSize: 13, color: "#94a3b8", marginTop: 4 }}>
              → <span style={{ color: "#10b981", fontWeight: 700 }}>{Number(amountTZS).toLocaleString()} TZS</span> to {phone}
            </div>
          </div>

          <div style={{ height: 1, background: "#1e293b", margin: "12px 0" }} />

          <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 13 }}>
            <span style={{ color: "#64748b" }}>Fee ({quote.youPay.feePercent}%)</span>
            <span style={{ fontWeight: 600, color: "#f59e0b" }}>{quote.youPay.feeSats} sats</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 13 }}>
            <span style={{ color: "#64748b" }}>Tier</span>
            <span style={{ padding: "2px 8px", borderRadius: 99, fontSize: 10, fontWeight: 700, color: "#f59e0b", background: "rgba(245,158,11,0.12)" }}>{quote.userTier}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 13 }}>
            <span style={{ color: "#64748b" }}>Settlement</span>
            <span style={{ fontWeight: 600, color: "#10b981" }}>~10 seconds</span>
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
            <button onClick={() => { setStep(0); setQuote(null); }} style={{ ...M.secondaryBtn, flex: 1 }}>← Back</button>
            <button onClick={generateInvoice} disabled={loading}
              style={{ ...M.actionBtn, flex: 2, background: "linear-gradient(135deg, #3b82f6, #2563eb)", color: "#fff", opacity: loading ? 0.6 : 1 }}>
              {loading ? "Generating..." : "⚡ Pay with Lightning"}
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Pay Invoice */}
      {step === 2 && invoice && (
        <div style={{ ...M.card, padding: 16 }}>
          <div style={{ textAlign: "center", marginBottom: 14 }}>
            <div style={{ fontSize: 36, marginBottom: 6 }}>⚡</div>
            <div style={{ fontSize: 15, fontWeight: 700 }}>Pay Lightning Invoice</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: "#f59e0b", marginTop: 4 }}>
              {invoice.youPay.sats.toLocaleString()} sats
            </div>
          </div>

          {/* Checkout link */}
          {invoice.checkoutLink && (
            <a href={invoice.checkoutLink} target="_blank" rel="noopener noreferrer"
              style={{ display: "block", textAlign: "center", padding: "12px", borderRadius: 10, background: "rgba(59,130,246,0.08)", border: "1px solid rgba(59,130,246,0.2)", color: "#3b82f6", fontSize: 13, fontWeight: 600, textDecoration: "none", marginBottom: 12 }}>
              🔗 Open BTCPay Checkout
            </a>
          )}

          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <button onClick={copyBolt11} style={{ ...M.secondaryBtn, flex: 1, fontSize: 12 }}>📋 Copy Invoice</button>
            {window.webln && (
              <button onClick={payWithWallet} style={{ ...M.actionBtn, flex: 1, background: "linear-gradient(135deg, #10b981, #059669)", color: "#fff", fontSize: 12 }}>
                ⚡ Pay with Wallet
              </button>
            )}
          </div>

          {/* BOLT11 display */}
          <div style={{ padding: 10, borderRadius: 8, background: "#0f1629", fontSize: 10, color: "#64748b", wordBreak: "break-all", marginBottom: 12 }}>
            {invoice.bolt11}
          </div>

          {polling && (
            <div style={{ textAlign: "center", color: "#3b82f6", fontSize: 12, animation: "pulse 1.5s infinite" }}>
              Waiting for payment confirmation...
            </div>
          )}
        </div>
      )}

      {/* Step 3: Done */}
      {step === 3 && result && (
        <div style={{ ...M.card, padding: 16, borderColor: "rgba(16,185,129,0.3)", background: "linear-gradient(135deg, rgba(16,185,129,0.05), rgba(16,185,129,0.02))" }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 48, marginBottom: 8 }}>✅</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: "#10b981" }}>
              {tab === "airtime" ? "Airtime Delivered!" : "M-Pesa Sent!"}
            </div>
            <div style={{ fontSize: 14, color: "#94a3b8", marginTop: 8 }}>
              {Number(amountTZS).toLocaleString()} TZS sent to {phone}
            </div>
          </div>

          <div style={{ textAlign: "center", marginTop: 16, fontSize: 11, color: "#64748b" }}>
            Powered by <span style={{ color: "#3b82f6", fontWeight: 700 }}>ChapSmart</span> × <span style={{ color: "#f59e0b", fontWeight: 700 }}>SatoshiMarket</span>
          </div>

          <button onClick={reset} style={{ ...M.secondaryBtn, width: "100%", marginTop: 14 }}>← New Transaction</button>
        </div>
      )}
    </div>
  );
}

