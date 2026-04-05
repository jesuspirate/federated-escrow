import { useState, useEffect, useRef } from "react";
import { CONDITION_KEYS, PAYMENT_METHODS, SATS_FOR_FIAT, LENDING } from "./constants";
import { isBillPay, isLending, isSatsForFiat, isSpecialCategory } from "./helpers";
import { t, getLocale } from "../i18n";
import { Icons } from "./components";
import M from "./styles";

export default function CreateListingView({ pubkey, subdomain, myFederation, onBack, onCreated, showToast, loading, setLoading, mapi, isDevMode }) {
  const [title, setTitle] = useState(() => {
    try { const bp = JSON.parse(sessionStorage.getItem("sm_billpay_prefill") || "null"); if (bp && bp.billType) { sessionStorage.removeItem("sm_billpay_prefill"); return bp.billType.icon + " " + bp.billType.label + " bill - " + bp.fiatCurrency + " " + parseFloat(bp.fiatAmount).toFixed(2); } } catch(e) {}
    return "";
  });
  const [desc, setDesc] = useState("");
  const [price, setPrice] = useState(() => {
    try { const bp = JSON.parse(sessionStorage.getItem("sm_billpay_prefill_price") || "null"); if (bp) { sessionStorage.removeItem("sm_billpay_prefill_price"); return String(bp); } } catch(e) {}
    return "";
  });
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [terms, setTerms] = useState("");
  const [category, setCategory] = useState(() => {
    try { const bp = JSON.parse(sessionStorage.getItem("sm_billpay_prefill") || "null"); if (bp) return "bill-pay"; } catch(e) {}
    return subdomain === "p2p" ? "sats-for-fiat" : subdomain === "lending" ? "lending" : "";
  });
  const [condition, setCondition] = useState("new");
  const [quantity, setQuantity] = useState("1");
  const [fiatCurrency, setFiatCurrency] = useState("USD");
  const [paymentMethods, setPaymentMethods] = useState([]);
  const [paymentMethod, setPaymentMethod] = useState("");
  const [listingImages, setListingImages] = useState([]);
  const [imgUploading, setImgUploading] = useState(false);
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [shippingCost, setShippingCost] = useState("");
  const [federationOnly, setFederationOnly] = useState(false);
  const listingFileRef = useRef(null);

  const uploadListingImage = async (file) => {
    if (!file || !file.type.startsWith("image/")) { showToast("Please select an image", "error"); return; }
    if (file.size > 20 * 1024 * 1024) { showToast("Image too large (max 20MB)", "error"); return; }
    if (listingImages.length >= 4) { showToast("Maximum 4 images", "error"); return; }
    setImgUploading(true);
    try {
      // Strip EXIF metadata by re-encoding through canvas
      const stripped = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement("canvas");
          const max = 1920;
          let w = img.width, h = img.height;
          if (w > max || h > max) {
            if (w > h) { h = Math.round(h * max / w); w = max; }
            else { w = Math.round(w * max / h); h = max; }
          }
          canvas.width = w; canvas.height = h;
          canvas.getContext("2d").drawImage(img, 0, 0, w, h);
          canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Canvas encode failed")), "image/jpeg", 0.85);
        };
        img.onerror = () => reject(new Error("Image load failed"));
        img.src = URL.createObjectURL(file);
      });
      const buf = await stripped.arrayBuffer();
      const hashBuf = await crypto.subtle.digest("SHA-256", buf);
      const sha256 = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, "0")).join("");
      if (!window.nostr) throw new Error("Nostr not available");
      const authEvent = {
        kind: 24242,
        created_at: Math.floor(Date.now() / 1000),
        tags: [["t", "upload"], ["x", sha256], ["expiration", String(Math.floor(Date.now() / 1000) + 300)]],
        content: "Upload listing image",
      };
      const signed = await window.nostr.signEvent(authEvent);
      const res = await fetch("https://blossom.band/upload", {
        method: "PUT",
        headers: { "Authorization": "Nostr " + btoa(JSON.stringify(signed)), "Content-Type": "image/jpeg" },
        body: stripped,
      });
      if (!res.ok) throw new Error("Upload failed (" + res.status + ")");
      const data = await res.json();
      const url = data.url || ("https://blossom.band/" + sha256);
      setListingImages(prev => [...prev, url]);
      showToast("Image uploaded!");
    } catch (err) {
      showToast("Image upload failed: " + (err.message || ""), "error");
    }
    setImgUploading(false);
  };

  const [ratePremium, setRatePremium] = useState("");
  const [interestRate, setInterestRate] = useState("");
  const [repaymentDays, setRepaymentDays] = useState("");
  const locale = getLocale();
  const FEDI_ROOMS = {
    en: "fedi:room:!kENaQZKCKhRhawCjxf:m1.8fa.in:::",
    fr: "fedi:room:!qHlVxBJBCKqUbetBnA:m1.8fa.in:::",
  };
  const [community, setCommunity] = useState(() => FEDI_ROOMS[locale] || FEDI_ROOMS.en);

  const isP2P = isSatsForFiat(category);
  const isLoan = isLending(category);
  const isBill = isBillPay(category);
  const isShipping = category.toLowerCase().trim() === "shipping";
  const isSpecial = isP2P || isLoan;

  // Auto-set condition/qty when P2P or Lending is selected
  useEffect(() => {
    if (isP2P || isLoan) { setCondition("service"); setQuantity("1"); }
  }, [isP2P, isLoan]);

  const handleCreate = async () => {
    let sats, minSats, maxSats;

    if (isP2P) {
      // P2P: use bracket pricing (min/max range)
      minSats = parseInt(minPrice);
      maxSats = parseInt(maxPrice);
      if (!minSats || minSats <= 0) return showToast("Enter a minimum price", "error");
      if (!maxSats || maxSats <= 0) return showToast("Enter a maximum price", "error");
      if (minSats < 1) return showToast("Minimum ₿ 1 sat", "error");
      if (maxSats < minSats) return showToast("Max must be greater than min", "error");
      if (maxSats > 2_000_000) return showToast(t("mkPriceExceeds"), "error");
      sats = maxSats; // listing price = max (display price)
    } else {
      sats = parseInt(price);
    }

    if (!title.trim()) return showToast(t("mkTitleRequired"), "error");
    if (!category) return showToast("Please select a category", "error");
    if ((isP2P || isBill) && !fiatCurrency) return showToast("Please select a currency", "error");
    if (isLoan && (paymentMethod === "Fiat" || paymentMethod === "Mixed") && !fiatCurrency) return showToast("Please select a currency for fiat repayment", "error");
 if (isShipping && (!shippingCost || Number(shippingCost) <= 0)) return showToast("Shipping cost is required for shipping listings", "error");
    if (!sats || sats <= 0) return showToast(t("mkPriceRequired"), "error");
    if (sats < 1) return showToast("Minimum ₿ 1 sat", "error");
    if (sats > 2_000_000) return showToast(t("mkPriceExceeds"), "error");

    // Append P2P metadata to terms
    let finalTerms = terms.trim();
    if (isP2P) {
      const p2pMeta = [];
      if (fiatCurrency) p2pMeta.push(`Currency: ${fiatCurrency}`);
      if (paymentMethod) p2pMeta.push(`Payment: ${paymentMethod}`);
      if (ratePremium) p2pMeta.push(`Rate: ${ratePremium}`);
      if (p2pMeta.length) finalTerms = (finalTerms ? finalTerms + "\n\n" : "") + "--- P2P Details ---\n" + p2pMeta.join("\n");
    }

    // Append Lending metadata to terms
    if (isLoan) {
      const loanMeta = [];
      if (interestRate) loanMeta.push(`Interest: ${interestRate}`);
      if (repaymentDays) loanMeta.push(`Repayment: ${repaymentDays}`);
      if (paymentMethod) loanMeta.push(`Repayment method: ${paymentMethod}`);
      if (fiatCurrency) loanMeta.push(`Currency: ${fiatCurrency}`);
      if (loanMeta.length) finalTerms = (finalTerms ? finalTerms + "\n\n" : "") + "--- Loan Terms ---\n" + loanMeta.join("\n");
    }

    setLoading(true);
    try {
      // Federation probe: generate 1 sat to capture federation prefix
      let sellerFedPrefix = null;
      const _isSandbox = !window.fediInternal || isDevMode();
      if (!_isSandbox && window.fediInternal && window.fediInternal.generateEcash) {
        try {
          showToast("Detecting your federation...");
          const probe = await window.fediInternal.generateEcash({ amount: 1 });
          if (probe && probe.length > 10) {
            sellerFedPrefix = probe.substring(0, 10);
            // Return the 1 sat immediately
            try { await window.fediInternal.receiveEcash(probe); } catch {}
          }
        } catch { /* user cancelled probe */ }
      }

      // REQUIRE federation prefix — block listing if probe failed
      if (!sellerFedPrefix && !_isSandbox) {
        showToast("Federation detection failed — please try again. Make sure to select a federation when prompted.", "error");
        setLoading(false);
        return;
      }

      const res = await mapi("/", {
        method: "POST",
        body: JSON.stringify({
          title: title.trim(),
          description: (desc.trim() + (websiteUrl.trim() ? "\n\n\ud83c\udf10 " + websiteUrl.trim() : "")) || undefined,
          priceMsats: sats * 1000,
          minPriceMsats: minSats ? minSats * 1000 : undefined,
          maxPriceMsats: maxSats ? maxSats * 1000 : undefined,
          terms: finalTerms || undefined,
          category: category.trim() || undefined,
          condition: isSpecial ? "service" : condition,
          communityLink: community.trim() || undefined,
          sellerFedDomain: myFederation || undefined,
          sellerFedPrefix: sellerFedPrefix || undefined,
          quantity: parseInt(quantity) || 1,
          images: listingImages.length > 0 ? listingImages : undefined,
          shippingCostSats: shippingCost ? parseInt(shippingCost) : undefined,
          federationOnly: federationOnly,
          paymentMethods: paymentMethods.length > 0 ? paymentMethods : undefined,
        }),
      });
      if (res.error) throw new Error(res.error);
      showToast(t("mkListingCreated"));
      onCreated(res.id);
    } catch (err) { showToast(err.message, "error"); }
    setLoading(false);
  };

  return (
    <div style={M.container}>
      <div style={M.viewHeader}>
        <button style={M.iconBtn} onClick={onBack}><Icons.Back /></button>
        <h2 style={M.viewTitle}>{isP2P ? t("mkP2PSellTitle") : isLoan ? "New Loan" : t("mkNewListing")}</h2>
        <div style={{ width: 36 }} />
      </div>

      {/* ── Category: fixed badge on p2p/lending, full picker otherwise ── */}
      {subdomain === "p2p" && (
        <div style={{ padding: "10px 14px", borderRadius: 10, background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.2)", marginBottom: 14, fontSize: 13, fontWeight: 700, color: "#f59e0b", display: "flex", alignItems: "center", gap: 8 }}>₿ P2P Trade</div>
      )}
      {subdomain === "lending" && (
        <div style={{ padding: "10px 14px", borderRadius: 10, background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.2)", marginBottom: 14, fontSize: 13, fontWeight: 700, color: "#10b981", display: "flex", alignItems: "center", gap: 8 }}>🤝 Community Lending</div>
      )}
      {subdomain === "market" && (
        <div style={{ padding: "10px 14px", borderRadius: 10, background: "rgba(139,92,246,0.08)", border: "1px solid rgba(139,92,246,0.2)", marginBottom: 14, fontSize: 13, fontWeight: 700, color: "#a78bfa", display: "flex", alignItems: "center", gap: 8 }}>{"🛒"} Marketplace</div>
      )}
      {subdomain !== "p2p" && subdomain !== "lending" && (
      <div style={M.formGroup}>
        <label style={M.label}>{t("mkCategory")}</label>

        {/* Bitcoin categories — hidden on market subdomain */}
        {subdomain !== "market" && <><div style={{ fontSize: 10, color: "#f59e0b", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>₿ Bitcoin</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
          {[
            { value: SATS_FOR_FIAT, label: "₿ P2P Trade", color: "#f59e0b", bg: "rgba(245,158,11,0.12)" },
            { value: LENDING, label: "🤝 Lending", color: "#10b981", bg: "rgba(16,185,129,0.12)" },
          ].map(cat => {
            const active = category === cat.value;
            return (
              <button key={cat.value} onClick={() => {
                setCategory(active ? "" : cat.value);
                if (active) { setPaymentMethod && setPaymentMethod(""); setFiatCurrency && setFiatCurrency(""); }
              }} style={{
                ...M.chipBtn, padding: "8px 14px",
                ...(active ? { ...M.chipBtnActive, borderColor: cat.color, color: cat.color, background: cat.bg } : { borderColor: "transparent", background: "#111827", color: "#94a3b8" }),
              }}>
                {cat.label}
              </button>
            );
          })}
        </div>

        </>}

        {/* Marketplace categories — hidden on p2p/lending subdomain */}
        {subdomain !== "p2p" && subdomain !== "lending" && <><div style={{ fontSize: 10, color: "#a78bfa", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>🛒 Marketplace</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
          {[
            { value: "electronics", label: "📱 Electronics" },
            { value: "clothing", label: "👕 Clothing" },
            { value: "shipping", label: "📦 Shipping" },
            { value: "art", label: "🎨 Art" },
            { value: "services", label: "🛠 Services" },
            { value: "digital", label: "💾 Digital" },
          ].map(cat => {
            const active = category === cat.value;
            return (
              <button key={cat.value} onClick={() => {
                if (isSpecialCategory(category)) setCategory(cat.value);
                else setCategory(active ? "" : cat.value);
              }} style={{
                ...M.chipBtn,
                ...(active ? { ...M.chipBtnActive, borderColor: "#a78bfa", color: "#f8fafc", background: "rgba(139,92,246,0.12)" } : { borderColor: "transparent", background: "#111827", color: "#94a3b8" }),
              }}>
                {cat.label}
              </button>
            );
          })}
        </div>
        </>}
        {!isP2P && !isLoan && !isBill && (
          <input style={M.input} placeholder="Or type a custom category..." value={isSpecialCategory(category) ? "" : category} onChange={e => setCategory(e.target.value)} />
        )}
      </div>
      )}


      {/* Bill Pay button removed - now accessed via BillPayView */}
      {/* ── P2P mode banner ── */}
      {isP2P && (
        <div style={{ ...M.infoBanner, borderColor: "rgba(245,158,11,0.3)", background: "rgba(245,158,11,0.06)", marginBottom: 14, borderLeft: "3px solid #f59e0b" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
            <span style={{ fontSize: 15 }}>₿</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#f59e0b" }}>{t("mkP2PSellTitle")}</span>
          </div>
          <div style={{ fontSize: 11, color: "#94a3b8", lineHeight: 1.5 }}>
            {t("mkP2PNote")}
          </div>
        </div>
      )}

      {/* Old Bill Pay banner removed - now handled by BillPayView */}

      {/* ── Lending mode banner ── */}
      {isLoan && (
        <div style={{ ...M.infoBanner, borderColor: "rgba(16,185,129,0.3)", background: "rgba(16,185,129,0.06)", marginBottom: 14, borderLeft: "3px solid #10b981" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
            <span style={{ fontSize: 15 }}>🤝</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#10b981" }}>Community Lending</span>
          </div>
          <div style={{ fontSize: 11, color: "#94a3b8", lineHeight: 1.5 }}>
            You lock ₿ sats in escrow as a loan. The borrower receives them and repays externally (fiat, goods, labor). The community arbiter verifies repayment.
          </div>
        </div>
      )}

      {/* ── Market mode banner ── */}
      {!isP2P && !isBill && !isLoan && !isShipping && category && (
        <div style={{ ...M.infoBanner, borderColor: "rgba(139,92,246,0.3)", background: "rgba(139,92,246,0.06)", marginBottom: 14, borderLeft: "3px solid #a78bfa" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
            <span style={{ fontSize: 15 }}>{"🛒"}</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#a78bfa" }}>Marketplace</span>
          </div>
          <div style={{ fontSize: 11, color: "#94a3b8", lineHeight: 1.5 }}>
            List your item for sats. Buyers lock payment in escrow, you ship or deliver, both confirm, sats released to your wallet.
          </div>
        </div>
      )}

      {/* ── Shipping mode banner ── */}
      {isShipping && (
        <div style={{ ...M.infoBanner, borderColor: "rgba(59,130,246,0.3)", background: "rgba(59,130,246,0.06)", marginBottom: 14, borderLeft: "3px solid #3b82f6" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
            <span style={{ fontSize: 15 }}>📦</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#3b82f6" }}>Physical Item — Shipping</span>
          </div>
          <div style={{ fontSize: 11, color: "#94a3b8", lineHeight: 1.5 }}>
            14-day escrow window for shipping and inspection. Buyer confirms receipt, then both vote to release payment.
          </div>
        </div>
      )}

      {/* ── Common fields: Title + Price ── */}
      <div style={M.formGroup}><label style={M.label}>{t("mkFieldTitle")} *</label><input style={M.input} placeholder={isBill ? "e.g., Pay my $30 AT&T phone bill" : isP2P ? "e.g., Selling ₿ 50,000 sats for USD" : isLoan ? "e.g., Lending ₿ 50,000 sats — 14 day term" : t("mkFieldTitleHint")} value={title} onChange={e => setTitle(e.target.value)} /></div>
      {isP2P ? (
        <div style={M.formGroup}>
          <label style={M.label}>PRICE RANGE (SATS) *</label>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input style={{ ...M.input, flex: 1 }} type="number" placeholder="Min (e.g. 5000)" value={minPrice} onChange={e => setMinPrice(e.target.value)} />
            <span style={{ color: "#64748b", fontSize: 13 }}>—</span>
            <input style={{ ...M.input, flex: 1 }} type="number" placeholder="Max (e.g. 100000)" value={maxPrice} onChange={e => setMaxPrice(e.target.value)} />
          </div>
          <p style={M.hint}>Buyers choose any amount in this range. {t("maxFedLimit", { limit: "2,000,000" })}</p>
        </div>
      ) : (
        <div style={M.formGroup}><label style={M.label}>{isBill ? "BILL AMOUNT (SATS) *" : isLoan ? "LOAN AMOUNT (SATS) *" : t("mkFieldPrice") + " *"}</label><input style={M.input} type="number" placeholder="25000" value={price} onChange={e => setPrice(e.target.value)} /><p style={M.hint}>{t("maxFedLimit", { limit: "2,000,000" })}</p></div>
      )}

      {/* ── P2P + Bill Pay fields ── */}
      {(isP2P || isBill) && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={M.formGroup}>
            <label style={M.label}>{t("mkFiatCurrency")}</label>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {["USD", "EUR", "GBP", "CFA", "KES", "TZS", "NGN", "BRL", "ARS", "INR"].map(cur => (
                <button key={cur} onClick={() => setFiatCurrency(cur)} style={{
                  ...M.chipBtn, padding: "6px 12px", fontSize: 12, fontWeight: 600,
                  ...(fiatCurrency === cur ? { ...M.chipBtnActive, borderColor: "#f59e0b", color: "#f59e0b", background: "rgba(245,158,11,0.12)" } : { borderColor: "transparent", background: "#111827", color: "#94a3b8" }),
                }}>
                  {cur}
                </button>
              ))}
              <button onClick={() => setFiatCurrency("other")} style={{
                ...M.chipBtn, padding: "6px 12px", fontSize: 12,
                ...(fiatCurrency === "other" ? M.chipBtnActive : { borderColor: "transparent", background: "#111827", color: "#94a3b8" }),
              }}>
                {t("mkFiatOther")}
              </button>
            </div>
          </div>
          <div style={M.formGroup}>
            <label style={M.label}>{t("mkRatePremium")} (%)</label>
            <input style={M.input} placeholder="e.g., 3" type="number" value={ratePremium} onChange={e => setRatePremium(e.target.value)} />
            {ratePremium && (minPrice || price) && (() => {
              const rp = Number(ratePremium) / 100;
              const adjMax = minPrice && maxPrice ? Math.ceil(Number(maxPrice) * (1 + rp)) : Math.ceil(Number(price) * (1 + rp));
              const adjMin = minPrice ? Math.ceil(Number(minPrice) * (1 + rp)) : adjMax;
              const exceeds = adjMax > 2_000_000;
              return <>
                <p style={{ ...M.hint, color: exceeds ? "#ef4444" : "#f59e0b", fontWeight: 600 }}>
                  {minPrice && maxPrice
                    ? "Range with premium: ₿ " + adjMin.toLocaleString() + " — ₿ " + adjMax.toLocaleString() + " sats"
                    : "Total with premium: ₿ " + adjMax.toLocaleString() + " sats"
                  }
                </p>
                {exceeds && <p style={{ ...M.hint, color: "#ef4444", fontWeight: 700 }}>⚠️ Exceeds 2M sats federation limit! Lower price or premium.</p>}
              </>;
            })()}
          </div>
        </div>
      )}

      {/* ── Lending-specific fields ── */}
      {isLoan && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", gap: 12 }}>
            <div style={{ flex: 1 }}>
              <label style={M.label}>INTEREST / PREMIUM (%)</label>
              <input style={M.input} placeholder="e.g., 5" type="number" value={interestRate} onChange={e => setInterestRate(e.target.value)} />
              {interestRate && price && (
                <p style={{ ...M.hint, color: "#10b981", fontWeight: 600 }}>
                  Total repayment: ₿ {Math.ceil(Number(price) * (1 + Number(interestRate) / 100)).toLocaleString()} sats
                </p>
              )}
            </div>
            <div style={{ flex: 1 }}>
              <label style={M.label}>REPAYMENT PERIOD</label>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {["7 days", "14 days", "30 days", "60 days", "90 days"].map(d => (
                  <button key={d} onClick={() => setRepaymentDays(d)} style={{
                    ...M.chipBtn, padding: "6px 10px", fontSize: 11,
                    ...(repaymentDays === d ? { ...M.chipBtnActive, borderColor: "#10b981", color: "#10b981", background: "rgba(16,185,129,0.12)" } : { borderColor: "transparent", background: "#111827", color: "#94a3b8" }),
                  }}>
                    {d}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div style={M.formGroup}>
            <label style={M.label}>REPAYMENT METHOD *</label>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {["Sats", "Fiat", "Goods/Labor", "Mixed"].map(rm => (
                <button key={rm} onClick={() => { setPaymentMethod(rm); if (rm === "Sats" || rm === "Goods/Labor") setFiatCurrency(""); }} style={{
                  ...M.chipBtn, padding: "6px 12px", fontSize: 12,
                  ...(paymentMethod === rm ? { ...M.chipBtnActive, borderColor: "#10b981", color: "#10b981", background: "rgba(16,185,129,0.12)" } : { borderColor: "transparent", background: "#111827", color: "#94a3b8" }),
                }}>
                  {rm}
                </button>
              ))}
            </div>
            {!paymentMethod && <p style={{ ...M.hint, color: "#f59e0b" }}>Please select a repayment method</p>}
          </div>
        </div>
      )}

      {/* ── P2P/Lending: Quantity (how many trades) ── */}
      {(isP2P || isLoan) && (
        <div style={{ marginBottom: 16 }}>
          <label style={M.label}>{t("mkHowManyTrades") || "How many trades will you accept?"}</label>
          <input style={{ ...M.input, width: 100 }} type="number" min="1" value={quantity} onChange={e => setQuantity(e.target.value)} placeholder="1" />
          <p style={M.hint}>Each buyer creates a separate trade within your price range.</p>
        </div>
      )}

      {/* ── Non-P2P/Lending fields: Condition + Quantity ── */}
      {!isP2P && !isLoan && !isBill && (
        <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
          <div style={{ flex: 1 }}>
            <label style={M.label}>{t("mkCondition")}</label>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {["new", "used", "digital", "service"].map(c => (
                <button key={c} onClick={() => setCondition(c)} style={{ ...M.chipBtn, ...(condition === c ? { ...M.chipBtnActive, borderColor: "#8b5cf6", color: "#f8fafc", background: "rgba(139,92,246,0.15)" } : { borderColor: "transparent", background: "#111827", color: "#94a3b8" }) }}>
                  {t(CONDITION_KEYS[c])}
                </button>
              ))}
            </div>
          </div>
          <div style={{ width: 80 }}>
            <label style={M.label}>{t("mkFieldQty")}</label>
            <input style={M.input} type="number" min="1" value={quantity} onChange={e => setQuantity(e.target.value)} />
          </div>
        </div>
      )}

      {/* ── Payment Methods (P2P + Bill Pay) ── */}
      {(isP2P || isBill || (isLoan && (paymentMethod === "Fiat" || paymentMethod === "Mixed"))) && (
        <div style={{ marginBottom: 16 }}>
          <label style={{ ...M.label, color: "#10b981" }}>{"💳"} {t("mkAcceptedPayment") || "Accepted Payment Methods"}</label>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {PAYMENT_METHODS.map(pm => {
              const active = paymentMethods.includes(pm.key);
              return (
                <button key={pm.key} onClick={() => setPaymentMethods(prev => active ? prev.filter(k => k !== pm.key) : [...prev, pm.key])} style={{ padding: "5px 10px", borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: "pointer", border: active ? "1.5px solid #10b981" : "1px solid #334155", background: active ? "rgba(16,185,129,0.15)" : "#111827", color: active ? "#10b981" : "#94a3b8", transition: "all 0.15s" }}>
                  {pm.icon} {pm.label}
                </button>
              );
            })}
          </div>
          {paymentMethods.length > 0 && <div style={{ fontSize: 10, color: "#475569", marginTop: 4 }}>{paymentMethods.length} selected</div>}
        </div>
      )}

      {/* ── Common fields: Description + Terms + Community ── */}
      <div style={M.formGroup}><label style={M.label}>{t("description")}</label><textarea style={{ ...M.input, minHeight: 72, resize: "vertical" }} placeholder={isP2P ? "Any additional details about your trade..." : t("mkFieldDescHint")} value={desc} onChange={e => setDesc(e.target.value)} /></div>

      {!isP2P && !isLoan && !isBill && (
        <div style={M.formGroup}>
          <label style={M.label}>PHOTOS (optional)</label>
          <input type="file" accept="image/*" ref={listingFileRef} onChange={e => { if (e.target.files?.[0]) uploadListingImage(e.target.files[0]); e.target.value = ""; }} style={{ display: "none" }} />
          {listingImages.length > 0 && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
              {listingImages.map((url, i) => (
                <div key={i} style={{ position: "relative", width: 72, height: 72, borderRadius: 8, overflow: "hidden", border: "1px solid #1e293b" }}>
                  <img src={url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  <button onClick={() => setListingImages(prev => prev.filter((_, j) => j !== i))} style={{
                    position: "absolute", top: 2, right: 2, width: 18, height: 18, borderRadius: "50%",
                    background: "rgba(0,0,0,0.7)", color: "#fff", fontSize: 10, border: "none", cursor: "pointer",
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>✕</button>
                </div>
              ))}
            </div>
          )}
          <button onClick={() => listingFileRef.current?.click()} disabled={imgUploading || listingImages.length >= 4} style={{
            padding: "10px 16px", borderRadius: 10, border: "1px dashed #334155", background: "transparent",
            color: imgUploading ? "#475569" : "#64748b", fontSize: 12, fontWeight: 600, cursor: "pointer", width: "100%",
          }}>
            {imgUploading ? "Uploading..." : listingImages.length > 0 ? "📷 Add another photo (" + listingImages.length + "/4)" : "📷 Add photos of your item"}
          </button>
          <div style={{ marginTop: 8 }}>
            <input style={M.input} placeholder="https://your-shop.com (optional)" value={websiteUrl} onChange={e => setWebsiteUrl(e.target.value)} />
            <p style={{ fontSize: 10, color: "#475569", marginTop: 4 }}>Link to your shop, portfolio, or product page</p>
          </div>
          {!isBill && <div style={{ marginTop: 8 }}>
            <div style={M.sectionLabel}>SHIPPING COST (sats, optional)</div>
            <input style={M.input} type="number" placeholder="e.g., 500" value={shippingCost} onChange={e => setShippingCost(e.target.value)} />
            <p style={{ fontSize: 10, color: "#475569", marginTop: 4 }}>Added to the item price. Buyer pays item + shipping.</p>
          </div>}
        </div>
      )}

      <div style={M.formGroup}><label style={M.label}>{t("tradeTerms")}</label><textarea style={{ ...M.input, minHeight: 60, resize: "vertical" }} placeholder={isP2P ? "Payment window, confirmation steps..." : t("mkFieldTermsHint")} value={terms} onChange={e => setTerms(e.target.value)} /></div>



      {/* ── Federation-only toggle ── */}
      <div style={{ padding: "12px 14px", borderRadius: 10, background: "rgba(139,92,246,0.06)", border: "1px solid rgba(139,92,246,0.15)", marginTop: 8, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#a78bfa" }}>🏛️ Federation Only</div>
          <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>Only visible to users in your federation</div>
        </div>
        <button onClick={() => setFederationOnly(!federationOnly)} style={{ width: 44, height: 24, borderRadius: 12, border: "none", cursor: "pointer", background: federationOnly ? "#a78bfa" : "#334155", position: "relative", transition: "background 0.2s" }}>
          <div style={{ width: 18, height: 18, borderRadius: 9, background: "#fff", position: "absolute", top: 3, left: federationOnly ? 23 : 3, transition: "left 0.2s" }} />
        </button>
      </div>
      <button style={{ ...M.primaryBtn, width: "100%", marginTop: 8, padding: "14px 0" }} onClick={handleCreate} disabled={loading}>
        {loading ? t("creating") : t("mkCreateListing")}
      </button>
    </div>
  );
}

