// ---- لایه ارتباط با API سامانه ----
import type {
  AppInfo, AuditEntry, Feature, FieldDef, ImportJob, Layer, OperatorInfo,
  Paginated, Revision, SearchField, SearchRequest, SearchResponse, Session,
  ShapefilePreview, Suggestion, User,
} from "./types";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    credentials: "include",
    headers:
      options.body instanceof FormData
        ? undefined
        : { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });

  if (!res.ok) {
    let message = `خطای سرور (${res.status})`;
    try {
      const data = await res.json();
      if (typeof data.detail === "string") message = data.detail;
      else if (Array.isArray(data.detail)) {
        // خطاهای اعتبارسنجی Pydantic
        message = data.detail.map((d: { msg: string }) => d.msg).join(" | ");
      }
    } catch {
      if (res.status === 0) message = "ارتباط با سرور برقرار نشد.";
    }
    throw new ApiError(message, res.status);
  }

  if (res.status === 204) return undefined as T;
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("json")) return (await res.text()) as unknown as T;
  return res.json();
}

const get = <T>(p: string) => request<T>(p);
const post = <T>(p: string, body?: unknown) =>
  request<T>(p, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });
const patch = <T>(p: string, body: unknown) =>
  request<T>(p, { method: "PATCH", body: JSON.stringify(body) });
const del = <T>(p: string) => request<T>(p, { method: "DELETE" });

/** دانلود فایل از یک endpoint که خروجی فایل می‌دهد. */
async function download(path: string, body: unknown, filename: string): Promise<void> {
  const res = await fetch(path, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new ApiError("دریافت فایل ناموفق بود.", res.status);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function downloadGet(path: string, filename: string): Promise<void> {
  const res = await fetch(path, { credentials: "include" });
  if (!res.ok) throw new ApiError("دریافت فایل ناموفق بود.", res.status);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

const qs = (params: Record<string, unknown>) => {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
};

export const api = {
  // ---- سامانه ----
  info: () => get<AppInfo>("/api/info"),
  health: () => get<{ status: string; postgis?: string }>("/api/health"),

  // ---- احراز هویت ----
  me: () => get<Session>("/api/auth/me"),
  login: (username: string, password: string) =>
    post<User>("/api/auth/login", { username, password }),
  logout: () => post<{ detail: string }>("/api/auth/logout"),
  changePassword: (current_password: string, new_password: string) =>
    post<{ detail: string }>("/api/auth/change-password", { current_password, new_password }),

  // ---- لایه‌ها ----
  layers: (includeArchived = false) =>
    get<Layer[]>(`/api/layers${qs({ include_archived: includeArchived })}`),
  createLayer: (body: Record<string, unknown>) => post<Layer>("/api/layers", body),
  updateLayer: (id: string, body: Record<string, unknown>) => patch<Layer>(`/api/layers/${id}`, body),
  archiveLayer: (id: string, reason?: string) =>
    post<{ detail: string }>(`/api/layers/${id}/archive`, { reason }),
  restoreLayer: (id: string) => post<{ detail: string }>(`/api/layers/${id}/restore`),
  deleteLayer: (id: string) => del<{ detail: string }>(`/api/layers/${id}`),

  // ---- ستون‌های جدول توصیفی ----
  fields: (layerId: string) => get<FieldDef[]>(`/api/layers/${layerId}/fields`),
  createField: (layerId: string, body: Record<string, unknown>) =>
    post<FieldDef>(`/api/layers/${layerId}/fields`, body),
  updateField: (layerId: string, fieldId: string, body: Record<string, unknown>) =>
    patch<FieldDef>(`/api/layers/${layerId}/fields/${fieldId}`, body),
  deleteField: (layerId: string, fieldId: string) =>
    del<{ detail: string; values_removed: number }>(`/api/layers/${layerId}/fields/${fieldId}`),

  // ---- عوارض ----
  features: (layerId: string, page = 1, pageSize = 50, includeArchived = false) =>
    get<Paginated<Feature>>(
      `/api/features${qs({ layer_id: layerId, page, page_size: pageSize, include_archived: includeArchived })}`,
    ),
  geojson: (layerId: string, includeArchived = false) =>
    get<{ type: string; layer: { id: string; name: string; style: Record<string, unknown> }; features: GeoJSON.Feature[] }>(
      `/api/features/geojson${qs({ layer_id: layerId, include_archived: includeArchived })}`,
    ),
  feature: (id: string) => get<Feature>(`/api/features/${id}`),
  createFeature: (body: Record<string, unknown>) => post<Feature>("/api/features", body),
  updateFeature: (id: string, body: Record<string, unknown>) => patch<Feature>(`/api/features/${id}`, body),
  archiveFeature: (id: string, reason?: string) =>
    post<{ detail: string }>(`/api/features/${id}/archive`, { reason }),
  restoreFeature: (id: string) => post<{ detail: string }>(`/api/features/${id}/restore`),
  deleteFeature: (id: string) => del<{ detail: string }>(`/api/features/${id}`),
  history: (id: string) => get<Revision[]>(`/api/features/${id}/history`),
  bulkField: (featureIds: string[], key: string, value: unknown) =>
    post<{ detail: string; updated: number }>("/api/features/bulk-field", {
      feature_ids: featureIds, key, value,
    }),

  // ---- جست‌وجو ----
  search: (body: SearchRequest) => post<SearchResponse>("/api/search", body),
  searchFields: (layerId: string) => get<SearchField[]>(`/api/search/fields${qs({ layer_id: layerId })}`),
  operators: () => get<OperatorInfo[]>("/api/search/operators"),
  distinct: (layerId: string, key: string) =>
    get<{ value: string; count: number }[]>(`/api/search/distinct${qs({ layer_id: layerId, key })}`),

  // ---- پیشنهاد نام ----
  createSuggestion: (body: Record<string, unknown>) => post<Suggestion>("/api/suggestions", body),
  suggestions: (params: Record<string, unknown> = {}) =>
    get<Paginated<Suggestion>>(`/api/suggestions${qs(params)}`),
  suggestionStats: () => get<Record<string, number>>("/api/suggestions/stats"),
  publicSuggestionCount: (featureId: string) =>
    get<{ total: number; approved: number }>(`/api/suggestions/public/count${qs({ feature_id: featureId })}`),
  reviewSuggestion: (id: string, body: Record<string, unknown>) =>
    post<Suggestion>(`/api/suggestions/${id}/review`, body),
  deleteSuggestion: (id: string) => del<{ detail: string }>(`/api/suggestions/${id}`),

  // ---- کاربران ----
  users: (params: Record<string, unknown> = {}) => get<Paginated<User>>(`/api/users${qs(params)}`),
  roles: () => get<{ value: string; label: string; description: string }[]>("/api/users/roles"),
  createUser: (body: Record<string, unknown>) => post<User>("/api/users", body),
  updateUser: (id: string, body: Record<string, unknown>) => patch<User>(`/api/users/${id}`, body),
  deleteUser: (id: string) => del<{ detail: string }>(`/api/users/${id}`),

  // ---- لاگ ----
  audit: (params: Record<string, unknown> = {}) => get<Paginated<AuditEntry>>(`/api/audit${qs(params)}`),
  auditActions: () => get<{ value: string; label: string }[]>("/api/audit/actions"),
  auditSummary: (days = 30) =>
    get<{
      days: number; total: number;
      by_user: { username: string; count: number }[];
      by_action: { action: string; label: string; count: number }[];
    }>(`/api/audit/summary${qs({ days })}`),
  allRevisions: (page = 1, pageSize = 50) =>
    get<Paginated<Revision>>(`/api/audit/revisions${qs({ page, page_size: pageSize })}`),
  exportAudit: (params: Record<string, unknown> = {}) =>
    downloadGet(`/api/audit/export${qs(params)}`, "audit-log.csv"),

  // ---- آپلود شیپ‌فایل ----
  previewShapefile: (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return request<ShapefilePreview>("/api/upload/shapefile/preview", { method: "POST", body: fd });
  },
  importShapefile: (body: Record<string, unknown>) =>
    post<{
      detail: string; layer_id: string; layer_name: string;
      inserted: number; without_geometry: number; new_fields: string[];
    }>("/api/upload/shapefile/import", body),
  importJobs: () => get<ImportJob[]>("/api/upload/jobs"),

  // ---- خروجی ----
  exportCsv: (body: SearchRequest, filename = "attributes.csv") =>
    download("/api/export/csv", body, filename),
  exportGeojson: (body: SearchRequest, filename = "features.geojson") =>
    download("/api/export/geojson", body, filename),
};
