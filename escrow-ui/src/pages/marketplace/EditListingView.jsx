import { useState, useRef } from "react";
import { PAYMENT_METHODS } from "./constants";
import { isBillPay, isSatsForFiat } from "./helpers";
import { t } from "../i18n";
import { Icons } from "./components";
import M from "./styles";

export default function EditListingView({ listing: l, onBack, showToast, loading, setLoading, subdomain, mapi }) {
  const [title, setTitle] = useState(l.title || "");
  const [description, setDescription] = useState(l.description || "");
  const [price, setPrice] = useState(l.priceMsats ? Math.floor(l.priceMsats / 1000) : "");
  const [terms, setTerms] = useState(l.terms || "");
  const [quantity, setQuantity] = useState(l.quantity ?? 1);
  const [minPrice, setMinPrice] = useState(l.minPriceSats || "");
  const [maxPrice, setMaxPrice] = useState(l.maxPriceSats || "");
  const [editPremium, setEditPremium] = useState(() => { const m = (l.terms || "").match(/Rate:\s*(\d+)/); return m ? m[1] : ""; });
  const [editShipping, setEditShipping] = useState(l.shippingCostSats || "");
 const [editFedOnly, setEditFedOnly] = useState(!!l.federationOnly);
  const [editCurrency, setEditCurrency] = useState(() => { const m = (l.terms || "").match(/Currency:\s*(\w+)/); return m ? m[1] : ""; });
  const [editPaymentMethods, setEditPaymentMethods] = useState(l.paymentMethods || []);
  const isP2PEdit = isSatsForFiat(l.category);
  const isP2P = isSatsForFiat(l.category);
  const [editImages, setEditImages] = useState(l.images || []);
  const [editImgUploading, setEditImgUploading] = useState(false);
  const editFileRef = useRef(null);

  const uploadEditImage = async (file) => {
    if (!file || !file.type.startsWith("image/")) { showToast("Please select an image", "error"); return; }
    if (file.size > 20 * 1024 * 1024) { showToast("Image too large (max 20MB)", "error"); return; }
    if (editImages.length >= 4) { showToast("Maximum 4 images", "error"); return; }
    setEditImgUploading(true);
    try {
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
      setEditImages(prev => [...prev, url]);
      showToast("Image uploaded!");
    } catch (err) {
      showToast("Upload failed: " + (err.message || ""), "error");
    }
    setEditImgUploading(false);
  };

  const handleSave = async () => {
    if (!title.trim()) return showToast("Title is required", "error");
    if (!price || Number(price) <= 0) return showToast("Price must be positive", "error");
    setLoading(true);
    try {
      const updatedTerms = (() => { let t = terms.trim().replace(/Rate:\s*\d+/, "").trim(); if (editPremium) t = (t ? t + " | " : "") + "Rate: " + editPremium; t = t.replace(/Currency:\s*\w+/, "").trim(); if (editCurrency) t = (t ? t + " | " : "") + "Currency: " + editCurrency; return t; })();
      const res = await mapi(`/${l.id}/update`, {
        method: "POST",
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          priceMsats: Number(price) * 1000,
          terms: updatedTerms,
          quantity: Number(quantity),
          minPriceMsats: minPrice ? Number(minPrice) * 1000 : null,
          maxPriceMsats: maxPrice ? Number(maxPrice) * 1000 : null,
          images: editImages.length > 0 ? editImages : [],
          shippingCostSats: editShipping ? parseInt(editShipping) : 0,
 federationOnly: editFedOnly, payment_methods: editPaymentMethods.length > 0 ? editPaymentMethods.join(",") : "",
        }),
      });
      if (res.error) throw new Error(res.error);
      showToast("✅ Listing updated!");
      onBack(res); // pass updated listing back
    } catch (err) {
      showToast(err.message, "error");
    }
    setLoading(false);
  };

  return (
    <div style={M.container}>
      <div style={M.header}>
        <button style={M.backBtn} onClick={() => onBack(null)}>←</button>
        <span style={M.headerTitle}>Edit Listing</span>
        <div style={{ width: 32 }} />
      </div>

      <div style={{ padding: "0 0 100px" }}>
        <div style={{ marginBottom: 14 }}>
          <div style={M.sectionLabel}>Title *</div>
          <input style={M.input} value={title} onChange={e => setTitle(e.target.value)} placeholder="What are you selling?" maxLength={120} />
        </div>

        <div style={{ marginBottom: 14 }}>
          <div style={M.sectionLabel}>Description</div>
          <textarea style={{ ...M.input, minHeight: 80, resize: "vertical" }} value={description} onChange={e => setDescription(e.target.value)} placeholder="Describe your item..." maxLength={2000} />
        </div>

        {!isP2P && (
          <div style={{ marginBottom: 14 }}>
            <div style={M.sectionLabel}>Photos</div>
            <input type="file" accept="image/*" ref={editFileRef} onChange={e => { if (e.target.files?.[0]) uploadEditImage(e.target.files[0]); e.target.value = ""; }} style={{ display: "none" }} />
            {editImages.length > 0 && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                {editImages.map((url, i) => (
                  <div key={i} style={{ position: "relative", width: 72, height: 72, borderRadius: 8, overflow: "hidden", border: "1px solid #1e293b" }}>
                    <img src={url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    <button onClick={() => setEditImages(prev => prev.filter((_, j) => j !== i))} style={{
                      position: "absolute", top: 2, right: 2, width: 18, height: 18, borderRadius: "50%",
                      background: "rgba(0,0,0,0.7)", color: "#fff", fontSize: 10, border: "none", cursor: "pointer",
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>✕</button>
                  </div>
                ))}
              </div>
            )}
            <button onClick={() => editFileRef.current?.click()} disabled={editImgUploading || editImages.length >= 4} style={{
              padding: "10px 16px", borderRadius: 10, border: "1px dashed #334155", background: "transparent",
              color: editImgUploading ? "#475569" : "#64748b", fontSize: 12, fontWeight: 600, cursor: "pointer", width: "100%",
            }}>
              {editImgUploading ? "Uploading..." : editImages.length > 0 ? "📷 Add photo (" + editImages.length + "/4)" : "📷 Add photos"}
            </button>
          </div>
        )}

        <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
          <div style={{ flex: 1 }}>
            <div style={M.sectionLabel}>{isP2P ? "Display Price (sats)" : "Price (sats) *"}</div>
            <input style={M.input} type="number" value={price} onChange={e => setPrice(e.target.value)} placeholder="e.g. 5000" min={1} />
          </div>
          <div style={{ width: 90 }}>
            <div style={M.sectionLabel}>Quantity</div>
            <input style={M.input} type="number" value={quantity} onChange={e => setQuantity(e.target.value)} min={1} max={999} />
          </div>
        </div>

        {!isP2P && !isBillPay(l.category) && (
          <div style={{ marginBottom: 14 }}>
            <div style={M.sectionLabel}>Shipping Cost (sats, optional)</div>
            <input style={M.input} type="number" placeholder="e.g., 500" value={editShipping} onChange={e => setEditShipping(e.target.value)} />
          </div>
        )}

        {isP2P && (
          <div style={{ marginBottom: 14 }}>
            <div style={M.sectionLabel}>Price Range (sats)</div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input style={{ ...M.input, flex: 1 }} type="number" placeholder="Min" value={minPrice} onChange={e => setMinPrice(e.target.value)} />
              <span style={{ color: "#64748b", fontSize: 13 }}>—</span>
              <input style={{ ...M.input, flex: 1 }} type="number" placeholder="Max" value={maxPrice} onChange={e => setMaxPrice(e.target.value)} />
            </div>
            <p style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>Buyers choose any amount in this range.</p>
          </div>
        )}

        <div style={{ marginBottom: 20 }}>
          <div style={M.sectionLabel}>Trade Terms</div>
          <textarea style={{ ...M.input, minHeight: 60, resize: "vertical" }} value={terms} onChange={e => setTerms(e.target.value)} placeholder="Terms and conditions..." maxLength={1000} />
        </div>

        {(isP2PEdit || isBillPay(l.category)) && (
          <div style={{ marginBottom: 20 }}>
            <div style={M.sectionLabel}>Rate Premium (%)</div>
            <input style={M.input} type="number" placeholder="e.g., 3" value={editPremium} onChange={e => setEditPremium(e.target.value)} />
            {editPremium && price && (() => {
              const rp = Number(editPremium) / 100;
              const adjMax = minPrice && maxPrice ? Math.ceil(Number(maxPrice) * (1 + rp)) : Math.ceil(Number(price) * (1 + rp));
              const adjMin = minPrice ? Math.ceil(Number(minPrice) * (1 + rp)) : adjMax;
              const exceeds = adjMax > 2_000_000;
              return <>
                <p style={{ fontSize: 11, color: exceeds ? "#ef4444" : "#f59e0b", fontWeight: 600, marginTop: 4 }}>
                  {minPrice && maxPrice
                    ? "Range with premium: ₿ " + adjMin.toLocaleString() + " — ₿ " + adjMax.toLocaleString() + " sats"
                    : "Total with premium: ₿ " + adjMax.toLocaleString() + " sats"
                  }
                </p>
                {exceeds && <p style={{ fontSize: 11, color: "#ef4444", fontWeight: 700, marginTop: 2 }}>⚠️ Exceeds 2M sats federation limit!</p>}
              </>;
            })()}
          </div>
        )}

        {/* Currency picker (edit) */}
        {(isP2PEdit || isBillPay(l.category)) && (
          <div style={{ marginBottom: 16 }}>
            <div style={M.sectionLabel}>{t("mkFiatCurrency") || "Fiat Currency"}</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {["USD","EUR","GBP","CFA","KES","TZS","NGN","BRL","INR","CAD","AUD"].map(cur => (
                <button key={cur} onClick={() => setEditCurrency(editCurrency === cur ? "" : cur)} style={{ padding: "5px 12px", borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: "pointer", border: editCurrency === cur ? "1.5px solid #f59e0b" : "1px solid #334155", background: editCurrency === cur ? "rgba(245,158,11,0.15)" : "#111827", color: editCurrency === cur ? "#f59e0b" : "#94a3b8" }}>{cur}</button>
              ))}
            </div>
          </div>
        )}

        {/* Payment methods (edit) */}
        {(isP2PEdit || isBillPay(l.category)) && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ ...M.sectionLabel, color: "#10b981" }}>{t("mkAcceptedPayment") || "Accepted Payment Methods"}</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {PAYMENT_METHODS.map(pm => {
                const active = editPaymentMethods.includes(pm.key);
                return <button key={pm.key} onClick={() => setEditPaymentMethods(prev => active ? prev.filter(k => k !== pm.key) : [...prev, pm.key])} style={{ padding: "5px 10px", borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: "pointer", border: active ? "1.5px solid #10b981" : "1px solid #334155", background: active ? "rgba(16,185,129,0.15)" : "#111827", color: active ? "#10b981" : "#94a3b8" }}>{pm.icon} {pm.label}</button>;
              })}
            </div>
          </div>
        )}
        {/* Federation-only toggle */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, padding: "10px 14px", borderRadius: 10, background: editFedOnly ? "rgba(139,92,246,0.1)" : "#111827", border: "1px solid " + (editFedOnly ? "rgba(139,92,246,0.3)" : "#1e293b"), cursor: "pointer" }} onClick={() => setEditFedOnly(!editFedOnly)}>
          <span style={{ fontSize: 18 }}>{editFedOnly ? "🔒" : "🌐"}</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: editFedOnly ? "#a78bfa" : "#94a3b8" }}>Federation Only</div>
            <div style={{ fontSize: 10, color: "#475569" }}>{editFedOnly ? "Only your federation members can see this" : "Visible to everyone"}</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button style={{ ...M.secondaryBtn, flex: 1 }} onClick={() => onBack(null)}>Cancel</button>
          <button style={{ ...M.primaryBtn, flex: 2 }} onClick={handleSave} disabled={loading}>
            {loading ? "Saving…" : "💾 Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

