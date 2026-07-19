"use client";

/* ------------------------------------------------------------------ */
/*  Backend API client                                                 */
/*  Wraps the Fastify revenue-api backend at NEXT_PUBLIC_API_URL.      */
/* ------------------------------------------------------------------ */

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/+$/, "") || "http://localhost:8080";

const TOKEN_KEY = "rev.jwt";

/* ----- Domain types ---------------------------------------------- */

export type Role = "admin" | "finance_manager" | "officer" | "gis_officer";

export interface BackendUser {
  userId: number;
  name: string;
  email: string;
  role: Role;
  zoneId: number | null;
  zoneName?: string | null;
  lastLoginAt?: string | null;
}

export interface DashboardSummary {
  totalRecords: number;
  activeRecords: number;
  pendingRecords: number;
  /**
   * Σ (applicable fee schedule amount × active records). The realistic
   * target — what would be collected if every registered taxpayer paid.
   */
  expectedRevenue: number;
  /** Active records with a matching fee schedule (counted in expectedRevenue). */
  billableRecords: number;
  /** Active records with NO matching fee schedule yet — admin must fill the gap. */
  unbilledRecords: number;
  /** Legacy: sum of actual fee_assignment rows for the year. */
  totalBilled: number;
  totalCollected: number;
  totalOutstanding: number;
  noticeCount: number;
  paidNotices: number;
  collectionRate: string;
}

export interface DashboardPayload {
  summary: DashboardSummary;
  monthlyTrend: { month: string; collected: number; paymentCount: number }[];
  byRecordType: {
    typeName: string;
    recordCount: number;
    billed: number;
    collected: number;
  }[];
  byZone: {
    zoneId: number;
    zoneName: string;
    recordCount: number;
    billed: number;
    collected: number;
  }[];
  recentActivity: {
    logId: number;
    action: string;
    createdAt: string;
    userName?: string | null;
  }[];
  billingYear: number;
}

export interface SyncStatus {
  lastSyncAt: string | null;
  syncIntervalMinutes: number;
  isActive: boolean;
  /** Last sync's error message, or null if the most recent sync succeeded. */
  lastSyncError?: string | null;
  arcgisSyncedRecords: number;
  manualRecords: number;
  totalRecords: number;
}

export interface TaxpayerRecord {
  recordId: number;
  taxpayerName: string;
  taxpayerPhone?: string | null;
  taxpayerEmail?: string | null;
  taxpayerIdNo?: string | null;
  /**
   * Pointer to the canonical feature in the ArcGIS layer. Geometry itself
   * is NOT stored in Postgres — query the ArcGIS service to render the
   * record's location.
   */
  arcgisObjectId?: number | null;
  submissionDate: string;
  updatedAt: string;
  recordType: string;
  zoneName: string;
  zoneId: number;
  status: string;
  submittedByName?: string | null;
  outstandingBalance: number;
}

// Backend stores attributes as (attribute_key, attribute_val) on read,
// but its POST /records body schema expects `{ key, value }` shape.
export interface RecordAttribute {
  attributeKey: string;
  attributeVal: string;
}

export interface ManualRecordCreatePayload {
  taxpayerName: string;
  taxpayerPhone?: string | null;
  taxpayerEmail?: string | null;
  taxpayerIdNo?: string | null;
  zoneId: number;
  recordTypeId: number;
  arcgisObjectId?: number | null;
  attributes?: { key: string; value: string }[];
}

export interface FeeScheduleCreatePayload {
  scheduleName: string;
  recordTypeId: number;
  zoneId?: number | null;
  amount: number;
  billingPeriod: string;
  effectiveFrom: string;
  effectiveTo?: string | null;
  isActive?: boolean;
}

export interface FeeAssignmentCreatePayload {
  recordId: number;
  scheduleId: number;
  billingYear: number;
  dueDate: string;
}

export interface FeeBulkAssignmentPayload {
  zoneId: number;
  scheduleId: number;
  billingYear: number;
  dueDate: string;
  recordTypeId?: number;
}

export interface FeeAssignment {
  assignmentId: number;
  scheduleId: number;
  recordId: number;
  amountDue: number;
  billingYear: number;
  isWaived: boolean;
  scheduleName: string;
  billingPeriod: string;
}

export interface Notice {
  noticeId: number;
  noticeNumber: string;
  amountDue: number;
  issuedDate: string;
  dueDate: string;
  noticeStatus: "issued" | "paid" | "overdue" | "cancelled";
  recordId: number;
  taxpayerName?: string;
  taxpayerPhone?: string | null;
  taxpayerIdNo?: string | null;
  zoneName?: string;
  generatedByName?: string | null;
  generatedByOfficerId?: string | null;
  pdfPath?: string | null;
}

export interface Payment {
  paymentId: number;
  recordId: number;
  noticeId: number | null;
  amountPaid: number;
  paymentMethod: "mpesa" | "bank" | "cash" | "cheque";
  mpesaRef: string | null;
  bankRef: string | null;
  paymentDate: string;
  receiptNumber: string;
  recordedByName?: string | null;
  taxpayerName?: string;
  notes?: string | null;
  /** Set on rows created via Paystack initialize/verify/webhook flow. */
  paystackReference?: string | null;
  /** Raw Paystack `data` payload — used to surface the channel chip. */
  gatewayResponse?: {
    channel?: string | null;
    [key: string]: unknown;
  } | null;
  /** TRUE once this payment has been reversed (correction workflow). */
  isReversed?: boolean;
  /** Set on reversal rows: the payment_id this row cancels out. */
  reversesPaymentId?: number | null;
  reversalReason?: string | null;
}

export interface FieldTask {
  taskId: number;
  recordId: number;
  assignedTo: number;
  assignedBy: number;
  taskType: string;
  priority: "low" | "normal" | "high";
  status: "open" | "in_progress" | "done" | "cancelled";
  instructions?: string | null;
  dueDate?: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt?: string | null;
  taxpayerName?: string;
  zoneName?: string;
  recordType?: string;
  arcgisObjectId?: number | null;
  assignedToName?: string;
  assignedByName?: string;
  /** Deep links into the Esri field apps — present when env-configured. */
  links?: { survey123?: string; fieldMaps?: string };
}

export interface PaymentsSummary {
  totals: { totalCollected: number; paymentCount: number; payerCount: number };
  byMethod: { method: string; total: number; count: number }[];
  dailySeries: { day: string; total: number; count: number }[];
}

export interface Zone {
  zoneId: number;
  zoneName: string;
  zoneCode: string;
  zoneType: string;
  parentZoneId: number | null;
  parentZoneName?: string | null;
  recordCount: number;
}

export interface RecordType {
  recordTypeId: number;
  typeName: string;
  geometryType: string;
  description: string | null;
}

export interface FeeSchedule {
  scheduleId: number;
  scheduleName: string;
  recordTypeId: number;
  recordTypeName: string;
  zoneId: number | null;
  zoneName: string | null;
  amount: number;
  billingPeriod: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  isActive: boolean;
  createdByName?: string | null;
}

export interface AdminUser {
  userId: number;
  name: string;
  email: string;
  role: Role;
  zoneName: string | null;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface ArcgisConfig {
  configId?: number;
  baseUrl?: string;
  clientId?: string;
  parcelLayerId?: string | null;
  businessLayerId?: string | null;
  marketStallLayerId?: string | null;
  syncIntervalMinutes?: number;
  lastSyncAt?: string | null;
  isActive?: boolean;
}

export interface ArcgisLayerSearchItem {
  itemId: string;
  title: string;
  type: string;
  owner: string;
  modified: number;
  snippet: string | null;
  url: string;
  tags: string[];
  thumbnail: string | null;
  numViews: number;
}

export interface ActiveArcgisLayer {
  recordType: string;
  recordTypeId: number | null;
  itemId: string;
  title: string;
  serviceUrl: string;
  layerUrl: string;
  geometryType: string | null;
  objectIdField: string;
  extent?: {
    xmin: number;
    ymin: number;
    xmax: number;
    ymax: number;
    spatialReference?: { wkid: number };
  } | null;
  /** Number of features in the ArcGIS layer (server-side count). */
  featureCount?: number | null;
}

export interface ActiveArcgisAuth {
  token: string;
  servers: string[];
  expiresAt: number;
}

export interface ActiveArcgisResponse {
  layers: ActiveArcgisLayer[];
  auth: ActiveArcgisAuth | null;
}

export interface ArcgisLayerInspect {
  item?: { itemId: string; title: string; owner: string; tags: string[] } | null;
  name: string;
  geometryType: string;
  objectIdField: string;
  capabilities: string;
  featureCount: number | null;
  extent: unknown;
  serviceUrl: string;
  layerUrl: string;
  fields: { name: string; alias: string; type: string; length?: number }[];
  sample: Record<string, unknown>[];
}

export interface AuditEntry {
  logId: number;
  userId: number | null;
  userName?: string | null;
  action: string;
  tableName?: string | null;
  recordId?: number | null;
  newValues?: unknown;
  oldValues?: unknown;
  ipAddress?: string | null;
  createdAt: string;
}

export interface RecordDetail extends TaxpayerRecord {
  attributes: RecordAttribute[];
  fees: FeeAssignment[];
  notices: Notice[];
  payments: Payment[];
  geometryType?: string;
}

export interface Paged<T> {
  data: T[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

/* ----- Errors ----------------------------------------------------- */

export class ApiError extends Error {
  status: number;
  body?: unknown;
  constructor(message: string, status: number, body?: unknown) {
    super(message);
    this.status = status;
    this.body = body;
    this.name = "ApiError";
  }
}

/* ----- Token storage --------------------------------------------- */

let inMemoryToken: string | null = null;
const sessionListeners = new Set<(t: string | null) => void>();

export function loadStoredToken(): string | null {
  if (inMemoryToken) return inMemoryToken;
  if (typeof window === "undefined") return null;
  const t = window.localStorage.getItem(TOKEN_KEY);
  inMemoryToken = t;
  return t;
}

export function setToken(token: string | null) {
  inMemoryToken = token;
  if (typeof window !== "undefined") {
    if (token) window.localStorage.setItem(TOKEN_KEY, token);
    else window.localStorage.removeItem(TOKEN_KEY);
  }
  for (const l of sessionListeners) l(token);
}

export function onSessionChange(fn: (token: string | null) => void): () => void {
  sessionListeners.add(fn);
  return () => sessionListeners.delete(fn);
}

/* ----- Fetch wrapper --------------------------------------------- */

function buildQuery(params?: object): string {
  if (!params) return "";
  const parts: string[] = [];
  for (const [k, v] of Object.entries(params as Record<string, unknown>)) {
    if (v === undefined || v === null || v === "") continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.length ? `?${parts.join("&")}` : "";
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = loadStoredToken();
  let res: Response;
  try {
    // Build headers carefully: avoid sending `Content-Type: application/json`
    // on GET/HEAD requests (or any request without a body). Sending that
    // header unnecessarily makes the request non-simple and triggers a
    // CORS preflight which some backends may not accept.
    const baseHeaders: Record<string, string> = {
      Accept: "application/json",
      ...(init.headers as Record<string, string> | undefined),
    };

    if (token) baseHeaders.Authorization = `Bearer ${token}`;

    // Only set Content-Type when there is a body and it's not a FormData
    const hasBody = init.body !== undefined && init.body !== null;
    const isFormData = typeof FormData !== "undefined" && init.body instanceof FormData;
    if (hasBody && !isFormData) {
      baseHeaders["Content-Type"] = "application/json";
    }

    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: baseHeaders,
    });
  } catch (err) {
    throw new ApiError(
      err instanceof Error
        ? `Network error reaching ${API_BASE}: ${err.message}`
        : "Network error",
      0,
    );
  }

  let body: unknown = null;
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    try {
      body = await res.json();
    } catch {
      body = null;
    }
  } else {
    try {
      body = await res.text();
    } catch {
      body = null;
    }
  }

  // 401 means different things in different contexts:
  // - on the login endpoint, it's "wrong credentials" — surface the real message
  // - everywhere else it's "session expired" — clear the cached JWT
  if (res.status === 401) {
    const serverMessage =
      body && typeof body === "object" && "message" in body
        ? (body as { message: string }).message
        : null;
    if (path === "/api/auth/login") {
      throw new ApiError(serverMessage ?? "Invalid email or password", 401, body);
    }
    setToken(null);
    throw new ApiError(
      serverMessage ?? "Session expired — please sign in again",
      401,
      body,
    );
  }

  if (!res.ok) {
    const message =
      (body && typeof body === "object" && "message" in body
        ? (body as { message: string }).message
        : null) ??
      (typeof body === "string" && body.length ? body : `HTTP ${res.status}`);
    throw new ApiError(message, res.status, body);
  }

  return body as T;
}

/* ----- API surface ----------------------------------------------- */

export interface RecordsQuery {
  page?: number;
  limit?: number;
  zoneId?: number;
  recordTypeId?: number;
  statusId?: number;
  search?: string;
  /** true → only records awaiting GIS capture; false → only records linked to a feature. */
  unmapped?: boolean;
  /** Exact lookup by the linked ArcGIS feature OBJECTID. */
  arcgisObjectId?: number;
}

export interface NoticesQuery {
  page?: number;
  limit?: number;
  recordId?: number;
  status?: string;
  zoneId?: number;
}

export interface PaymentsQuery {
  page?: number;
  limit?: number;
  recordId?: number;
  paymentMethod?: string;
  dateFrom?: string;
  dateTo?: string;
  mpesaRef?: string;
}

export interface AuditQuery {
  page?: number;
  limit?: number;
  userId?: number;
  action?: string;
  dateFrom?: string;
  dateTo?: string;
}

export const api = {
  baseUrl: API_BASE,

  auth: {
    login: (email: string, password: string) =>
      request<{ token: string; user: BackendUser }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      }),
    arcgisBridge: (token: string, portalUrl?: string) =>
      request<{ token: string; user: BackendUser & { arcgisUsername?: string } }>(
        "/api/auth/arcgis-bridge",
        {
          method: "POST",
          body: JSON.stringify({ token, portalUrl }),
        },
      ),
    me: () => request<BackendUser>("/api/auth/me"),
    changePassword: (currentPassword: string, newPassword: string) =>
      request<{ message: string }>("/api/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ currentPassword, newPassword }),
      }),
  },

  dashboard: {
    get: (params?: {
      zoneId?: number;
      billingYear?: number;
      /** ISO YYYY-MM-DD — narrows the trend chart to a window. */
      dateFrom?: string;
      dateTo?: string;
    }) => request<DashboardPayload>(`/api/dashboard${buildQuery(params)}`),
    syncStatus: () => request<SyncStatus>("/api/dashboard/sync-status"),
  },

  records: {
    list: (params?: RecordsQuery) =>
      request<Paged<TaxpayerRecord>>(`/api/records${buildQuery(params)}`),
    get: (id: number) => request<RecordDetail>(`/api/records/${id}`),
    create: (body: ManualRecordCreatePayload) =>
      request<{ recordId: number; autoAssignmentId: number | null; message: string }>(
        "/api/records",
        {
          method: "POST",
          body: JSON.stringify(body),
        },
      ),
    /** Link or unlink a record to an ArcGIS feature (OBJECTID). Pass null to unlink. */
    linkFeature: (id: number, arcgisObjectId: number | null) =>
      request<{ message: string }>(`/api/records/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ arcgisObjectId }),
      }),
    update: (id: number, body: unknown) =>
      request<{ message: string }>(`/api/records/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    types: () => request<RecordType[]>("/api/records/types/list"),
  },

  zones: {
    list: () => request<Zone[]>("/api/zones"),
    create: (body: {
      zoneName: string;
      zoneCode: string;
      zoneType: "county" | "subcounty" | "ward" | "village";
      parentZoneId?: number;
    }) =>
      request<{ zoneId: number; message: string }>("/api/zones", {
        method: "POST",
        body: JSON.stringify(body),
      }),
  },

  fees: {
    schedules: (params?: { recordTypeId?: number; zoneId?: number; activeOnly?: boolean }) =>
      request<FeeSchedule[]>(`/api/fees/schedules${buildQuery(params)}`),
    createSchedule: (body: FeeScheduleCreatePayload) =>
      request<{ scheduleId: number; message: string }>("/api/fees/schedules", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    assign: (body: FeeAssignmentCreatePayload) =>
      request<{ assignmentId: number; message: string }>("/api/fees/assign", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    assignBulk: (body: FeeBulkAssignmentPayload) =>
      request<{ assigned: number; skipped?: number; message: string }>("/api/fees/assign/bulk", {
        method: "POST",
        body: JSON.stringify(body),
      }),
  },

  notices: {
    list: (params?: NoticesQuery) =>
      request<Paged<Notice>>(`/api/notices${buildQuery(params)}`),
    generate: (body: { recordId: number; assignmentId?: number; dueDate: string }) =>
      request<{ noticeId: number; noticeNumber: string; amountDue: number }>(
        "/api/notices/generate",
        { method: "POST", body: JSON.stringify(body) },
      ),
    bulk: (body: {
      zoneId: number;
      billingYear: number;
      dueDate: string;
      recordTypeId?: number;
    }) =>
      request<{ generated: number; totalAmount?: number; message: string }>(
        "/api/notices/bulk",
        { method: "POST", body: JSON.stringify(body) },
      ),
    setStatus: (id: number, status: Notice["noticeStatus"]) =>
      request<{ message: string }>(`/api/notices/${id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      }),
    pdfUrl: (id: number) => `${API_BASE}/api/notices/${id}/pdf`,
  },

  payments: {
    record: (body: {
      recordId: number;
      noticeId?: number;
      amountPaid: number;
      paymentMethod: "mpesa" | "bank" | "cash" | "cheque";
      mpesaRef?: string;
      bankRef?: string;
      paymentDate: string;
      notes?: string;
    }) =>
      request<{ paymentId: number; receiptNumber: string }>("/api/payments", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    list: (params?: PaymentsQuery) =>
      request<Paged<Payment>>(`/api/payments${buildQuery(params)}`),
    summary: (params?: { dateFrom?: string; dateTo?: string; zoneId?: number }) =>
      request<PaymentsSummary>(`/api/payments/summary${buildQuery(params)}`),
    paystackInitialize: (body: { noticeId: number; email?: string; callbackUrl?: string }) =>
      request<{ authorizationUrl: string; reference: string }>(
        "/api/payments/paystack/initialize",
        { method: "POST", body: JSON.stringify(body) },
      ),
    reverse: (id: number, reason: string) =>
      request<{ reversalPaymentId: number; receiptNumber: string; message: string }>(
        `/api/payments/${id}/reverse`,
        { method: "POST", body: JSON.stringify({ reason }) },
      ),
    paystackVerify: (reference: string) =>
      request<{
        status:
          | "already_recorded"
          | "recorded"
          | "notice_not_found"
          | "unrouteable"
          | "success"
          | "failed"
          | "pending"
          | "unknown"
          | "abandoned";
        payment?: { paymentId: number; receiptNumber: string; noticeId: number };
        message?: string;
      }>(`/api/payments/paystack/verify/${encodeURIComponent(reference)}`),
  },

  tasks: {
    create: (body: {
      recordId: number;
      assignedTo: number;
      priority?: "low" | "normal" | "high";
      instructions?: string;
      dueDate?: string;
    }) =>
      request<{ taskId: number; reassigned: boolean; message: string }>("/api/tasks", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    list: (params?: { status?: string; recordId?: number; mine?: boolean }) =>
      request<{ data: FieldTask[] }>(`/api/tasks${buildQuery(params)}`),
    setStatus: (id: number, status: FieldTask["status"]) =>
      request<{ taskId: number; status: string }>(`/api/tasks/${id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      }),
    assignees: () =>
      request<{ data: { userId: number; name: string; roleName: string; zoneName?: string | null }[] }>(
        "/api/tasks/assignees",
      ),
  },

  admin: {
    users: () => request<AdminUser[]>("/api/admin/users"),
    createUser: (body: {
      fullName: string;
      email: string;
      password: string;
      roleName: Role;
      zoneId?: number;
    }) =>
      request<{ userId: number; message: string }>("/api/admin/users", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    updateUser: (id: number, body: {
      fullName?: string;
      isActive?: boolean;
      roleName?: Role;
      zoneId?: number;
    }) =>
      request<{ message: string }>(`/api/admin/users/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    arcgisConfig: () => request<ArcgisConfig>("/api/admin/arcgis"),
    arcgisSync: () =>
      request<{ message: string; totalInserted?: number; totalUpdated?: number }>(
        "/api/admin/arcgis/sync",
        { method: "POST" },
      ),
    arcgisCreateLayers: () =>
      request<{ results: { name: string; success: boolean; itemId?: string; envKey?: string; error?: string }[] }>(
        "/api/admin/arcgis/create-layers",
        { method: "POST" },
      ),
    arcgisActiveLayers: () =>
      request<ActiveArcgisResponse>("/api/admin/arcgis/layers/active"),
    arcgisLayerSearch: (params?: { q?: string; mineOnly?: boolean }) =>
      request<{
        total: number;
        owner?: string;
        items: ArcgisLayerSearchItem[];
      }>(`/api/admin/arcgis/layers/search${buildQuery(params)}`),
    arcgisLayerInspect: (params: { itemId?: string; url?: string }) =>
      request<ArcgisLayerInspect>(
        `/api/admin/arcgis/layers/inspect${buildQuery(params)}`,
      ),
    arcgisLayerAttach: (body: {
      itemId: string;
      recordTypeId: number;
      syncNow?: boolean;
    }) =>
      request<{
        message: string;
        slot: string;
        sync: { totalInserted: number; totalUpdated: number } | null;
      }>("/api/admin/arcgis/layers/attach", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    saveArcgisConfig: (body: {
      baseUrl: string;
      clientId: string;
      clientSecret?: string;
      parcelLayerId?: string;
      businessLayerId?: string;
      marketStallLayerId?: string;
      syncIntervalMinutes?: number;
      isActive?: boolean;
    }) =>
      request<{ message: string }>("/api/admin/arcgis", {
        method: "PUT",
        body: JSON.stringify(body),
      }),
    auditLog: (params?: AuditQuery) =>
      request<Paged<AuditEntry>>(`/api/admin/audit-log${buildQuery(params)}`),
  },

  health: () => request<{ status: string; timestamp: string; version: string }>("/health"),
};

/* ----- React-friendly helpers ------------------------------------ */

export function pdfDownloadUrlWithToken(noticeId: number): string {
  // Browser <a download> doesn't carry Authorization headers, so we use the
  // existing cookie-less endpoint and rely on the JWT being in localStorage.
  // For now we just return the bare URL — the user is expected to be in the
  // app and the bearer token is appended by a small fetcher when needed.
  return api.notices.pdfUrl(noticeId);
}

export async function downloadNoticePdf(notice: Notice): Promise<void> {
  const token = loadStoredToken();
  const res = await fetch(api.notices.pdfUrl(notice.noticeId), {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const ct = res.headers.get("content-type") ?? "";

  // 202 = "PDF is still being generated, try again in a moment"
  // Any non-PDF response (JSON error, HTML, plain text) means the renderer
  // hasn't produced a file yet; saving the response body as ".pdf" would
  // give the user an unopenable file. Surface a real error instead.
  if (res.status === 202 || !ct.includes("application/pdf")) {
    let message = "PDF is not ready yet — try again in a moment.";
    try {
      if (ct.includes("application/json")) {
        const body = (await res.json()) as { message?: string } | null;
        if (body?.message) message = body.message;
      } else {
        const text = await res.text();
        if (text && text.length < 400) message = text;
      }
    } catch {
      /* fall back to the default message */
    }
    throw new ApiError(message, res.status);
  }
  if (!res.ok) {
    throw new ApiError(`Failed to download PDF (${res.status})`, res.status);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${notice.noticeNumber}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
