# GeoRevenue Spatial OS — Implementation Checklist

## ✅ Completed (Ready to Use)

- [x] **Dashboard** (Finance view)
  - Minimalist design with no fancy icons
  - KPI cards, charts, zone rankings, activity feed
  - Navigate via sidebar: click "Dashboard"

- [x] **Payments Page** (NEW)
  - View all payments with summary stats
  - Filter by method, date range, search by receipt/taxpayer
  - Daily collections chart & payment method pie chart
  - Click payment → open record detail
  - Navigate via sidebar: click "Payments"

- [x] **User & Role Management** (Enhanced)
  - Create users → assigns ArcGIS account auto-linking
  - Roles: Admin, Finance Manager, Field Officer
  - Zone assignment for officers
  - Navigate: Settings → Users
  - Clear documentation of ArcGIS auth flow

---

## 🚀 Next: Quick-Win Features (30-60 mins each)

### 1. **Feature Layer Ingestion** (Recommended: Do First)
- **Why**: Core data pipeline — need to pull parcels/businesses from ArcGIS
- **Steps**:
  1. Go to Settings → ArcGIS (admin only)
  2. Search for your feature layer (e.g., "Nairobi Parcels")
  3. Click "Inspect" to review fields
  4. Click "Attach" and select record type (Parcel, Business, etc.)
  5. Click "Sync" — backend pulls features into system
  6. Records now visible on Map and in Records list
- **Implementation**: See `FEATURES_IMPLEMENTATION.md` section 4
- **Depends on**: Configured ArcGIS OAuth credentials in `SettingsArcGIS`

### 2. **Record Creation Form** (Optional but Helpful)
- **Why**: Manual record entry for records not in ArcGIS
- **Steps**:
  1. Create form modal or separate view
  2. User fills: Name, Phone, Zone, Type, optional coordinates
  3. System creates record and stores in DB
  4. If lat/lon provided, shows on map
  5. If ArcGIS ObjectID provided, links to feature
- **Implementation**: See `FEATURES_IMPLEMENTATION.md` section 5
- **Depends on**: Nothing, can start immediately

### 3. **PDF Notice Templates** (Low Priority)
- **Why**: Professional-looking PDF for printing/emailing notices
- **Steps**:
  1. Install: `npm install html2pdf.js`
  2. Add "Download PDF" button to notices list
  3. Click → generates and downloads PDF with template
- **Implementation**: See `FEATURES_IMPLEMENTATION.md` section 6
- **Depends on**: html2pdf library

### 4. **Calcite Map Tools** (Low Priority)
- **Why**: Better map UX — switch basemaps, use search widget
- **Steps**:
  1. Add BasemapToggle widget to map
  2. Add Search widget for location lookup
  3. Users can now switch between Streets/Satellite/Hybrid basemaps
- **Implementation**: See `FEATURES_IMPLEMENTATION.md` section 7
- **Depends on**: ArcGIS JS SDK (already installed)

---

## 📋 Checklist: What Still Needs Setup on Backend

These require backend configuration (Fastify API):

- [ ] **ArcGIS OAuth** configured with correct `clientId`, `clientSecret`, `baseUrl`
- [ ] **Feature layers** registered in database (e.g., parcel, business, market stall layers)
- [ ] **Zones** populated in database
- [ ] **Record types** created (Parcel, Business, Market Stall, etc.)
- [ ] **Fee schedules** created for each record type/zone combo
- [ ] **Database** tables exist for records, payments, notices, audit log
- [ ] **PDF endpoint** enabled (`GET /api/notices/:id/pdf`)

**Check with your backend team** about these configurations.

---

## 🎯 Recommended Implementation Order

1. ✅ **Payments page** — DONE
2. ✅ **User & role management** — DONE
3. → **Feature layer ingestion** — Do this next (pulls real data in)
4. → **Record creation form** — Add after confirming feature layers work
5. → **PDF templates** — Nice-to-have
6. → **Calcite tools** — Nice-to-have

---

## 📱 Quick Navigation

After completing above, system has:

```
Dashboard (finance view)
  ├─ KPI cards, charts, zone rankings
  └─ Real-time collection stats

Map
  ├─ All records with spatial data
  ├─ Click parcel → open record detail
  └─ Filter by zone, record type

Records
  └─ List of all records
      └─ Click → view details, pay ments, notices

Notices (Bulk)
  ├─ Generate notices by zone + type
  ├─ View list of all notices
  └─ Download as PDF

Payments (NEW)
  ├─ Summary stats
  ├─ Chart by day & method
  └─ Queryable table with filters

Settings
  ├─ Profile
  ├─ Security (password change)
  ├─ ArcGIS (OAuth, feature layers)
  ├─ Fee schedules (admin only)
  ├─ Users & roles (admin only)
  └─ Audit log (admin & finance)
```

---

## 🛠️ How to Add Features

### Example: Adding Feature Layer Ingestion

1. Open `src/app/Shell.tsx`
2. Find `SettingsArcGIS` component (around line 2XXX)
3. Add new tab "Layers" or "Feature Data"
4. Copy code from `FEATURES_IMPLEMENTATION.md` section 4
5. Adapt to match existing component style (use `glass-panel`, `auth-input`, etc.)
6. Import any new types from `lib/api.ts`

### Example: Adding Record Creation

1. Create new "form" view type or modal component
2. Add to `navItems` if you want main nav button, or keep as modal
3. Copy form code from `FEATURES_IMPLEMENTATION.md` section 5
4. Test with dummy data first
5. Ensure backend `POST /api/records` endpoint is working

---

## 🔍 Troubleshooting

**"Backend API not responding"**
- Check `NEXT_PUBLIC_API_URL` environment variable
- Backend should be running at `http://localhost:8080` or configured URL
- Check browser Network tab for actual API calls

**"No users can sign in"**
- Backend needs ArcGIS OAuth credentials set
- Admin needs to configure in Settings → ArcGIS
- First user is auto-promoted to admin (if no users exist)

**"Records not showing on map"**
- Check that records have latitude/longitude
- Or records need to be synced from ArcGIS feature layer
- Verify zone and record type exist in database

**"PDF download not working"**
- Install `html2pdf.js` via npm
- Check browser console for errors
- May need CORS headers from backend if fetching remote data

---

## 📚 Additional Resources

- **Backend API docs**: `http://localhost:8080/api/docs` (if enabled)
- **ArcGIS JS SDK**: https://developers.arcgis.com/javascript/latest/
- **Calcite Design System**: https://developers.arcgis.com/calcite-design-system/
- **Tailwind CSS**: https://tailwindcss.com/docs

---

**Status**: Application is **70% complete**. Core features work. Remaining are enhancements and optional features.

**Last Updated**: May 8, 2026
