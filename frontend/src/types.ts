// ---- انواع داده مشترک با بک‌اند ----

export type Role = "admin" | "editor" | "viewer";
export type FieldType = "text" | "number" | "integer" | "boolean" | "date" | "select";
export type GeomType = "point" | "linestring" | "polygon" | "mixed";
export type SuggestionStatus = "pending" | "approved" | "rejected";

export interface User {
  id: string;
  username: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  role: Role;
  is_active: boolean;
  must_change_password: boolean;
  last_login_at: string | null;
  created_at: string;
}

export interface Permissions {
  view: boolean;
  edit: boolean;
  admin: boolean;
  suggest: boolean;
}

export interface Session {
  authenticated: boolean;
  role: Role | "public";
  user?: User;
  permissions: Permissions;
}

export interface Layer {
  id: string;
  name: string;
  slug: string;
  description: string;
  geom_type: GeomType;
  srid: number;
  style: Record<string, unknown>;
  label_field: string | null;
  is_visible_public: boolean;
  is_archived: boolean;
  created_at: string;
  feature_count: number;
}

export interface FieldDef {
  id: string;
  layer_id: string;
  key: string;
  label: string;
  data_type: FieldType;
  options: string[];
  is_required: boolean;
  is_searchable: boolean;
  is_system: boolean;
  default_value: string | null;
  unit: string | null;
  sort_order: number;
}

export type GeoJsonGeometry = {
  type: string;
  coordinates: unknown;
};

export interface Feature {
  id: string;
  layer_id: string;
  attributes: Record<string, unknown>;
  version: number;
  is_archived: boolean;
  geometry: GeoJsonGeometry | null;
  created_at: string;
  updated_at: string;
  created_by_name: string | null;
  updated_by_name: string | null;
}

export type Operator =
  | "eq" | "ne" | "contains" | "not_contains" | "starts_with" | "ends_with"
  | "gt" | "gte" | "lt" | "lte" | "between" | "in" | "is_empty" | "is_not_empty";

export interface SearchCondition {
  field: string;
  op: Operator;
  value?: unknown;
  value2?: unknown;
}

export interface SearchRequest {
  layer_id?: string;
  q?: string;
  conditions?: SearchCondition[];
  logic?: "and" | "or";
  include_archived?: boolean;
  bbox?: number[];
  intersects?: GeoJsonGeometry;
  sort_by?: string;
  sort_dir?: "asc" | "desc";
  page?: number;
  page_size?: number;
  include_geometry?: boolean;
}

export interface SearchResponse {
  total: number;
  page: number;
  page_size: number;
  items: Feature[];
}

export interface Paginated<T> {
  total: number;
  page: number;
  page_size: number;
  items: T[];
}

export interface Revision {
  id: string;
  feature_id: string;
  version: number;
  action: string;
  changed_fields: string[];
  geometry_changed: boolean;
  attributes_before: Record<string, unknown> | null;
  attributes_after: Record<string, unknown> | null;
  note: string | null;
  created_at: string;
  user_name: string | null;
}

export interface AuditEntry {
  id: number;
  username: string;
  action: string;
  action_label?: string;
  entity_type: string | null;
  entity_id: string | null;
  summary: string;
  payload: Record<string, unknown> | null;
  ip_address: string | null;
  method: string | null;
  path: string | null;
  status: string;
  created_at: string;
}

export interface Suggestion {
  id: string;
  feature_id: string | null;
  suggested_name: string;
  reason: string | null;
  submitter_name: string | null;
  submitter_phone: string | null;
  status: SuggestionStatus;
  admin_note: string | null;
  reviewed_at: string | null;
  created_at: string;
  reviewed_by_name: string | null;
  feature_label: string | null;
}

export interface SearchField {
  key: string;
  label: string;
  data_type: FieldType;
  options: string[];
  unit: string | null;
}

export interface OperatorInfo {
  value: Operator;
  label: string;
  types: string[];
}

export interface ShapefilePreview {
  token: string;
  filename: string;
  geom_type: string;
  feature_count: number;
  source_srid: number | null;
  encoding: string;
  fields: {
    source_name: string;
    key: string;
    label: string;
    dbf_type: string;
    data_type: FieldType;
    size: number;
    decimals: number;
  }[];
  sample: { attributes: Record<string, unknown>; geometry_type: string | null }[];
}

export interface AppInfo {
  app_name: string;
  version: string;
  city: string;
  default_center: [number, number];
  default_zoom: number;
}

export interface ImportJob {
  id: string;
  filename: string;
  status: string;
  feature_count: number;
  source_srid: number | null;
  layer_name: string | null;
  user: string | null;
  error: string | null;
  created_at: string | null;
}
