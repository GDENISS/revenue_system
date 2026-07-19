# GeoRevenue Spatial OS — Feature Implementation Guide

## ✅ Completed Features

### 1. **Finance Dashboard** (Minimalist, no icons)
- KPI cards (Total billed, Collected, Collection rate %, Outstanding)
- Revenue trend chart (monthly)
- Revenue sources donut chart
- Zone rankings table
- Recent activity feed
- **Location**: `src/app/Shell.tsx` → `FinanceDashboard` component

### 2. **Payments Page** (NEW)
- Payment summary KPIs
- Daily collections chart
- Payment method breakdown (pie chart)
- **Queryable payment table** with filters:
  - Search by receipt, taxpayer, M-Pesa ref
  - Filter by method (M-Pesa, Bank, Cash, Cheque)
  - Filter by date range
- Click-through to record detail
- **Location**: `src/app/Shell.tsx` → `PaymentsDashboard` component
- **API Used**: `api.payments.list()`, `api.payments.summary()`

### 3. **Enhanced User & Role Management**
- Create users with role assignment
- Roles: Admin, Finance Manager, Officer
- Zone assignment for field officers
- **ArcGIS auto-linking** explanation:
  - Users sign in with ArcGIS account
  - First user → auto-promoted to Admin
  - Subsequent users → created as Officer (admin can change roles)
  - ArcGIS username linked to prevent duplicates
- Inline role editing
- **Location**: `src/app/Shell.tsx` → `SettingsUsers` component
- **API Used**: `api.admin.createUser()`, `api.admin.updateUser()`

---

## 🔧 Implementation Guide for Remaining Features

### 4. **Feature Layer Ingestion (ArcGIS → System)**

**Problem**: Users need to connect their ArcGIS feature services and ingest spatial data into the system.

**Solution**: Enhance `SettingsArcGIS` component with layer attachment UI.

**Implementation**:

```typescript
// Add to SettingsArcGIS component:

function SettingsArcGISLayers() {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<ArcgisLayerSearchItem[]>([]);
  const [selectedLayer, setSelectedLayer] = useState<ArcgisLayerInspect | null>(null);
  const [searching, setSearching] = useState(false);
  const [attaching, setAttaching] = useState(false);

  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    try {
      const res = await api.admin.arcgisLayerSearch({ q: searchQuery, mineOnly: false });
      setSearchResults(res.items);
    } catch (err) {
      console.error("Search failed:", err);
    }
    setSearching(false);
  };

  const handleInspect = async (itemId: string) => {
    try {
      const layer = await api.admin.arcgisLayerInspect({ itemId });
      setSelectedLayer(layer);
    } catch (err) {
      console.error("Inspect failed:", err);
    }
  };

  const handleAttach = async (recordTypeId: number) => {
    if (!selectedLayer?.item) return;
    setAttaching(true);
    try {
      const res = await api.admin.arcgisLayerAttach({
        itemId: selectedLayer.item.itemId,
        recordTypeId,
        syncNow: true,
      });
      alert(`Attached to record type. Synced ${res.sync?.totalInserted ?? 0} records.`);
      setSelectedLayer(null);
      setSearchResults([]);
      setSearchQuery("");
    } catch (err) {
      console.error("Attach failed:", err);
    }
    setAttaching(false);
  };

  return (
    <div className="space-y-3">
      <div className="glass-panel p-4">
        <h3 className="text-sm font-semibold mb-3">Search ArcGIS Feature Layers</h3>
        <div className="flex gap-2 mb-3">
          <input
            type="text"
            placeholder="Search layers (e.g., 'Parcels', 'Businesses')"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            className="auth-input flex-1"
          />
          <button
            onClick={handleSearch}
            disabled={searching}
            className="primary-control"
          >
            Search
          </button>
        </div>

        {searchResults.length > 0 && (
          <div className="space-y-2">
            {searchResults.map((item) => (
              <div
                key={item.itemId}
                className="flex items-start justify-between rounded border border-[var(--line)] p-2"
              >
                <div className="flex-1">
                  <p className="font-semibold text-[12px]">{item.title}</p>
                  <p className="text-[11px] text-[var(--muted)]">{item.owner}</p>
                </div>
                <button
                  onClick={() => handleInspect(item.itemId)}
                  className="control text-[11px]"
                >
                  Inspect
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {selectedLayer && (
        <div className="glass-panel p-4">
          <h3 className="text-sm font-semibold mb-2">Layer Details</h3>
          <p className="text-[12px]"><strong>Name:</strong> {selectedLayer.name}</p>
          <p className="text-[12px]"><strong>Type:</strong> {selectedLayer.geometryType}</p>
          <p className="text-[12px]"><strong>Features:</strong> {selectedLayer.featureCount ?? "Unknown"}</p>
          
          <div className="mt-3 space-y-2 text-[12px]">
            <p className="font-semibold">Fields:</p>
            {selectedLayer.fields.slice(0, 5).map((f) => (
              <div key={f.name} className="text-[11px] text-[var(--muted)]">
                {f.alias} ({f.type})
              </div>
            ))}
          </div>

          <div className="mt-3">
            <label className="block mb-2">
              <span className="auth-label">Attach to record type</span>
              <select className="auth-input" id="recordTypeSelect">
                <option value="">Select record type</option>
                {/* Populate from api.records.types() */}
              </select>
            </label>
            <button
              onClick={() => {
                const sel = document.getElementById("recordTypeSelect") as HTMLSelectElement;
                if (sel.value) handleAttach(Number(sel.value));
              }}
              disabled={attaching}
              className="primary-control"
            >
              {attaching ? "Attaching..." : "Attach & Sync"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
```

**Integration**: Add this to the "arcgis" tab in `SettingsArcGIS`.

---

### 5. **Record Creation Form**

**Problem**: Need UI to create individual records and link to ArcGIS features.

**Implementation**:

```typescript
// Add new route "new-record" or modal:

function RecordCreationForm({ onClose }: { onClose: () => void }) {
  const [zones, setZones] = useState<Zone[]>([]);
  const [recordTypes, setRecordTypes] = useState<RecordType[]>([]);
  const [form, setForm] = useState({
    taxpayerName: "",
    taxpayerPhone: "",
    taxpayerEmail: "",
    taxpayerIdNo: "",
    zoneId: "",
    recordTypeId: "",
    latitude: "",
    longitude: "",
    arcgisObjectId: "",
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    Promise.all([api.zones.list(), api.records.types()])
      .then(([z, t]) => {
        setZones(z);
        setRecordTypes(t);
      })
      .catch(() => {});
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.taxpayerName || !form.zoneId || !form.recordTypeId) {
      alert("Fill required fields");
      return;
    }
    setLoading(true);
    try {
      const res = await api.records.create({
        taxpayerName: form.taxpayerName,
        taxpayerPhone: form.taxpayerPhone || null,
        taxpayerEmail: form.taxpayerEmail || null,
        taxpayerIdNo: form.taxpayerIdNo || null,
        zoneId: Number(form.zoneId),
        recordTypeId: Number(form.recordTypeId),
        latitude: form.latitude ? Number(form.latitude) : null,
        longitude: form.longitude ? Number(form.longitude) : null,
        arcgisObjectId: form.arcgisObjectId ? Number(form.arcgisObjectId) : null,
      });
      alert(`Record created: ${res.recordId}`);
      onClose();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Creation failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <form className="glass-panel w-full max-w-[500px] space-y-3 p-4">
        <h2 className="text-lg font-semibold">Create Record</h2>
        
        <label className="block">
          <span className="auth-label">Taxpayer name *</span>
          <input
            type="text"
            value={form.taxpayerName}
            onChange={(e) => setForm({ ...form, taxpayerName: e.target.value })}
            className="auth-input"
          />
        </label>

        <label className="block">
          <span className="auth-label">Phone</span>
          <input
            type="tel"
            value={form.taxpayerPhone}
            onChange={(e) => setForm({ ...form, taxpayerPhone: e.target.value })}
            className="auth-input"
          />
        </label>

        <label className="block">
          <span className="auth-label">Zone *</span>
          <select
            value={form.zoneId}
            onChange={(e) => setForm({ ...form, zoneId: e.target.value })}
            className="auth-input"
          >
            <option value="">Pick zone</option>
            {zones.map((z) => (
              <option key={z.zoneId} value={z.zoneId}>
                {z.zoneName}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="auth-label">Record type *</span>
          <select
            value={form.recordTypeId}
            onChange={(e) => setForm({ ...form, recordTypeId: e.target.value })}
            className="auth-input"
          >
            <option value="">Pick type</option>
            {recordTypes.map((t) => (
              <option key={t.recordTypeId} value={t.recordTypeId}>
                {t.typeName}
              </option>
            ))}
          </select>
        </label>

        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="auth-label text-[11px]">Latitude</span>
            <input
              type="number"
              step="0.0001"
              value={form.latitude}
              onChange={(e) => setForm({ ...form, latitude: e.target.value })}
              className="auth-input"
              placeholder="-1.2921"
            />
          </label>
          <label className="block">
            <span className="auth-label text-[11px]">Longitude</span>
            <input
              type="number"
              step="0.0001"
              value={form.longitude}
              onChange={(e) => setForm({ ...form, longitude: e.target.value })}
              className="auth-input"
              placeholder="36.8219"
            />
          </label>
        </div>

        <label className="block">
          <span className="auth-label text-[11px]">ArcGIS Object ID (optional)</span>
          <input
            type="number"
            value={form.arcgisObjectId}
            onChange={(e) => setForm({ ...form, arcgisObjectId: e.target.value })}
            className="auth-input"
            placeholder="Link to ArcGIS feature"
          />
        </label>

        <div className="flex gap-2">
          <button type="submit" disabled={loading} className="primary-control">
            {loading ? "Creating..." : "Create Record"}
          </button>
          <button type="button" onClick={onClose} className="control">
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
```

---

### 6. **PDF Notice Templates**

**Problem**: Need PDF generation with professional templates for notices.

**Setup**:
```bash
npm install html2pdf.js
```

**Implementation**:

```typescript
// Add to BulkNotices or Notices list:

async function downloadNoticePDF(notice: Notice) {
  const element = document.createElement("div");
  element.innerHTML = `
    <div style="font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 40px;">
      <div style="text-align: center; margin-bottom: 30px;">
        <h1 style="margin: 0; color: #006A3F;">REVENUE DEMAND NOTICE</h1>
        <p style="margin: 10px 0; color: #CE1126;">Nairobi City County</p>
      </div>

      <table style="width: 100%; margin-bottom: 20px;">
        <tr>
          <td><strong>Notice #:</strong> ${notice.noticeNumber}</td>
          <td><strong>Date Issued:</strong> ${new Date(notice.issuedDate).toLocaleDateString()}</td>
        </tr>
        <tr>
          <td><strong>Due Date:</strong> ${new Date(notice.dueDate).toLocaleDateString()}</td>
          <td><strong>Status:</strong> ${notice.noticeStatus.toUpperCase()}</td>
        </tr>
      </table>

      <div style="border-top: 2px solid #006A3F; padding-top: 20px; margin-bottom: 20px;">
        <p><strong>Taxpayer:</strong> ${notice.taxpayerName}</p>
        <p><strong>Zone:</strong> ${notice.zoneName}</p>
        <p><strong>Phone:</strong> ${notice.taxpayerPhone || "N/A"}</p>
      </div>

      <div style="background: #f0f0f0; padding: 15px; border-radius: 5px; margin-bottom: 20px;">
        <table style="width: 100%;">
          <tr>
            <td>Amount Due:</td>
            <td style="text-align: right;"><strong>KES ${notice.amountDue.toLocaleString()}</strong></td>
          </tr>
        </table>
      </div>

      <p style="font-size: 12px; color: #666;">
        This is an official notice of revenue obligation. Payment must be made by the due date to avoid penalties.
      </p>

      <div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #ccc; font-size: 10px; color: #666;">
        <p>Nairobi City County Revenue Department</p>
        <p>Generated on ${new Date().toLocaleDateString()}</p>
      </div>
    </div>
  `;

  const opt = {
    margin: 10,
    filename: `notice-${notice.noticeNumber}.pdf`,
    image: { type: "jpeg", quality: 0.98 },
    html2canvas: { scale: 2 },
    jsPDF: { orientation: "portrait", unit: "mm", format: "a4" },
  };

  // @ts-ignore
  window.html2pdf().set(opt).from(element).save();
}
```

**In Notice list table**:
```tsx
<button onClick={() => downloadNoticePDF(notice)}>
  Download PDF
</button>
```

---

### 7. **Calcite Map Tools Integration**

**Problem**: Need to enable map basemap switching, drawing tools, etc.

**Implementation** (in `MapWorkspace`):

```typescript
import MapView from "@arcgis/core/views/MapView";
import BasemapToggle from "@arcgis/core/widgets/BasemapToggle";
import Search from "@arcgis/core/widgets/Search";

// After creating mapView in useEffect:

const basemapToggle = new BasemapToggle({
  view: mapView,
  nextBasemap: "satellite"
});

const search = new Search({
  view: mapView
});

mapView.ui.add(basemapToggle, "bottom-right");
mapView.ui.add(search, "top-left");
```

**Calcite UI components** (if using Calcite):
```tsx
<calcite-button
  appearance="solid"
  onClick={() => {
    // Toggle basemap
    const current = map.basemap;
    map.basemap = current === "streets" ? "satellite" : "streets";
  }}
>
  Switch Basemap
</calcite-button>

<calcite-dropdown>
  <calcite-button slot="trigger">Basemap</calcite-button>
  <calcite-dropdown-group>
    <calcite-dropdown-item onClick={() => (map.basemap = "streets")}>
      Streets
    </calcite-dropdown-item>
    <calcite-dropdown-item onClick={() => (map.basemap = "satellite")}>
      Satellite
    </calcite-dropdown-item>
    <calcite-dropdown-item onClick={() => (map.basemap = "hybrid")}>
      Hybrid
    </calcite-dropdown-item>
  </calcite-dropdown-group>
</calcite-dropdown>
```

---

## 📊 Data Flow Diagram

```
User Creates Record (UI)
         ↓
api.records.create() → Backend validates & stores
         ↓
If ArcGIS ObjectID provided → Link to feature layer
         ↓
Record syncs with Map display
         ↓
Zone managers can generate notices
         ↓
Payments recorded against notices
         ↓
All visible in Dashboard, Payments page
```

---

## 🔗 API Endpoints Reference

All endpoints require Bearer token in `Authorization` header.

### Records
- `POST /api/records` — Create record
- `GET /api/records` — List with filters
- `PATCH /api/records/:id` — Update

### ArcGIS Admin
- `POST /api/admin/arcgis/layers/search` — Search feature layers
- `GET /api/admin/arcgis/layers/inspect` — Inspect layer schema
- `POST /api/admin/arcgis/layers/attach` — Attach & sync layer

### Payments
- `GET /api/payments` — List payments
- `GET /api/payments/summary` — Summary stats
- `POST /api/payments` — Record payment

### Notices
- `GET /api/notices/:id/pdf` — Download notice as PDF
- `POST /api/notices/bulk` — Bulk generate notices

---

## 📝 Next Steps

1. **Test Payments Page**: Navigate to "Payments" nav item, verify data loads
2. **Create Users**: Go to Settings → Users → Add user with different roles
3. **Ingest Feature Layer**: Settings → ArcGIS → Search & attach a layer
4. **Create Records**: Use API or implement Record Creation modal
5. **Generate Notices**: Bulk Notices page with zone/record type filters
6. **Download PDFs**: Click notice → download PDF with template

---

**Questions?** Check the API docs at `/api/docs` (if enabled on backend) or inspect Network tab in browser DevTools.
