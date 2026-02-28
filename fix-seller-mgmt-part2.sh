#!/usr/bin/env python3
import sys

filepath = "escrow-ui/src/pages/Marketplace.jsx"
with open(filepath, "r") as f:
    src = f.read()

# ── Step 3: Inject EditListingView component before ListingDetail ──────────
EDIT_COMPONENT = '''
// ═══════════════════════════════════════════════════════════════════════
// EDIT LISTING VIEW — seller can update title, description, price, qty
// ═══════════════════════════════════════════════════════════════════════
function EditListingView({ listing: l, onBack, showToast, loading, setLoading }) {
  const [title, setTitle] = useState(l.title || "");
  const [description, setDescription] = useState(l.description || "");
  const [price, setPrice] = useState(l.priceMsats ? Math.floor(l.priceMsats / 1000) : "");
  const [terms, setTerms] = useState(l.terms || "");
  const [quantity, setQuantity] = useState(l.quantity ?? 1);

  const handleSave = async () => {
    if (!title.trim()) return showToast("Title is required", "error");
    if (!price || Number(price) <= 0) return showToast("Price must be positive", "error");
    setLoading(true);
    try {
      const res = await mapi(`/${l.id}/update`, {
        method: "POST",
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          priceMsats: Number(price) * 1000,
          terms: terms.trim(),
          quantity: Number(quantity),
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

        <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
          <div style={{ flex: 1 }}>
            <div style={M.sectionLabel}>Price (sats) *</div>
            <input style={M.input} type="number" value={price} onChange={e => setPrice(e.target.value)} placeholder="e.g. 5000" min={1} />
          </div>
          <div style={{ width: 90 }}>
            <div style={M.sectionLabel}>Quantity</div>
            <input style={M.input} type="number" value={quantity} onChange={e => setQuantity(e.target.value)} min={1} max={999} />
          </div>
        </div>

        <div style={{ marginBottom: 20 }}>
          <div style={M.sectionLabel}>Trade Terms</div>
          <textarea style={{ ...M.input, minHeight: 60, resize: "vertical" }} value={terms} onChange={e => setTerms(e.target.value)} placeholder="Terms and conditions..." maxLength={1000} />
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

'''

marker = "// ═══════════════════════════════════════════════════════════════════════\n// LISTING DETAIL"
if marker in src:
    src = src.replace(marker, EDIT_COMPONENT + marker, 1)
    print("✅ EditListingView component injected")
else:
    print("❌ LISTING DETAIL marker not found")
    sys.exit(1)

# ── Step 4: Add 'edit' view to Marketplace state + handlers ───────────────
old_state = '''  const [view, setView] = useState("browse");
  const [listings, setListings] = useState([]);
  const [selected, setSelected] = useState(null);
  const [orders, setOrders] = useState([]);'''

new_state = '''  const [view, setView] = useState("browse");
  const [listings, setListings] = useState([]);
  const [selected, setSelected] = useState(null);
  const [editingListing, setEditingListing] = useState(null);
  const [orders, setOrders] = useState([]);'''

if old_state in src:
    src = src.replace(old_state, new_state)
    print("✅ editingListing state added")
else:
    print("❌ state pattern not found")

# ── Step 5: Add handlers after loadOrders ─────────────────────────────────
old_openOrders = '''  const openOrders = () => { setView("orders"); loadOrders(); };'''
new_openOrders = '''  const openOrders = () => { setView("orders"); loadOrders(); };

  const handleEdit = (listing) => { setEditingListing(listing); setView("edit"); };

  const handlePause = async (id) => {
    try {
      const res = await mapi(`/${id}/update`, { method: "POST", body: JSON.stringify({ status: "paused" }) });
      if (res.error) throw new Error(res.error);
      showToast("⏸ Listing paused");
      loadListings();
      setView("browse");
    } catch (err) { showToast(err.message, "error"); }
  };

  const handleUnpause = async (id) => {
    try {
      const res = await mapi(`/${id}/update`, { method: "POST", body: JSON.stringify({ status: "active" }) });
      if (res.error) throw new Error(res.error);
      showToast("▶ Listing resumed");
      loadListings();
      setView("browse");
    } catch (err) { showToast(err.message, "error"); }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this listing? This cannot be undone.")) return;
    try {
      const res = await mapi(`/${id}/delete`, { method: "POST" });
      if (res.error) throw new Error(res.error);
      showToast("🗑 Listing deleted");
      loadListings();
      setView("browse");
    } catch (err) { showToast(err.message, "error"); }
  };'''

if old_openOrders in src:
    src = src.replace(old_openOrders, new_openOrders)
    print("✅ Seller management handlers added")
else:
    print("❌ openOrders pattern not found")

# ── Step 6: Add edit view render + pass handlers to ListingDetail ──────────
old_detail_render = '''          onBack={() => { setSelected(null); setView("browse"); }}
          onOrderCreated={(order) => { setSelected(order); setView("orderDetail"); loadOrders(); }}'''

new_detail_render = '''          onBack={() => { setSelected(null); setView("browse"); }}
          onEdit={handleEdit}
          onPause={handlePause}
          onUnpause={handleUnpause}
          onDelete={handleDelete}
          onOrderCreated={(order) => { setSelected(order); setView("orderDetail"); loadOrders(); }}'''

if old_detail_render in src:
    src = src.replace(old_detail_render, new_detail_render)
    print("✅ ListingDetail handlers wired")
else:
    print("❌ detail render pattern not found")

# ── Step 7: Add edit view to the render switch ────────────────────────────
old_render_switch = '''          {view === "detail" && selected && (
            <ListingDetail'''

new_render_switch = '''          {view === "edit" && editingListing && (
            <EditListingView
              listing={editingListing}
              onBack={(updated) => {
                if (updated) {
                  setEditingListing(null);
                  loadListings();
                  setView("browse");
                } else {
                  setView("detail");
                }
              }}
              showToast={showToast}
              loading={actionLoading}
              setLoading={setActionLoading}
            />
          )}
          {view === "detail" && selected && (
            <ListingDetail'''

if old_render_switch in src:
    src = src.replace(old_render_switch, new_render_switch)
    print("✅ Edit view render added to switch")
else:
    print("❌ render switch pattern not found")

with open(filepath, "w") as f:
    f.write(src)

print("\n✅ All steps complete")
