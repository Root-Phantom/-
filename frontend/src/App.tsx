// ---- پوسته اصلی سامانه ----
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import AuditLogPage from "./admin/AuditLogPage";
import LayerManager from "./admin/LayerManager";
import SuggestionsPage from "./admin/SuggestionsPage";
import UploadWizard from "./admin/UploadWizard";
import UserManager from "./admin/UserManager";
import { api } from "./api";
import AttributeTable from "./components/AttributeTable";
import FeatureEditor from "./components/FeatureEditor";
import HistoryModal from "./components/HistoryModal";
import { ChangePasswordModal, LoginModal } from "./components/LoginModal";
import MapView, { type DrawMode } from "./components/MapView";
import SearchPanel from "./components/SearchPanel";
import SuggestModal from "./components/SuggestModal";
import type {
  AppInfo, Feature, FieldDef, GeoJsonGeometry, Layer, OperatorInfo,
  SearchCondition, SearchField, SearchRequest, Session,
} from "./types";
import { Confirm, ErrorBox, GEOM_LABEL, Loading, Modal, ROLE_LABEL, fa, useToast } from "./ui";

type Tab = "map" | "layers" | "upload" | "suggestions" | "users" | "audit";

export default function App() {
  const toast = useToast();
  const [session, setSession] = useState<Session | null>(null);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [tab, setTab] = useState<Tab>("map");
  const [showLogin, setShowLogin] = useState(false);
  const [showPw, setShowPw] = useState<null | "forced" | "normal">(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // ---- لایه‌ها ----
  const [layers, setLayers] = useState<Layer[]>([]);
  const [activeLayerId, setActiveLayerId] = useState<string | null>(null);
  const [visible, setVisible] = useState<Set<string>>(new Set());
  const [layerData, setLayerData] = useState<Record<string, GeoJSON.FeatureCollection>>({});
  const [fields, setFields] = useState<FieldDef[]>([]);
  const [searchFields, setSearchFields] = useState<SearchField[]>([]);
  const [operators, setOperators] = useState<OperatorInfo[]>([]);

  // ---- جست‌وجو ----
  const [q, setQ] = useState("");
  const [conditions, setConditions] = useState<SearchCondition[]>([]);
  const [logic, setLogic] = useState<"and" | "or">("and");
  const [includeArchived, setIncludeArchived] = useState(false);
  const [spatial, setSpatial] = useState<GeoJsonGeometry | null>(null);
  const [sortBy, setSortBy] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [features, setFeatures] = useState<Feature[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [filterApplied, setFilterApplied] = useState(false);
  const [searchTick, setSearchTick] = useState(0);

  // ---- انتخاب و پنجره‌ها ----
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [drawMode, setDrawMode] = useState<DrawMode>("none");
  const [editId, setEditId] = useState<string | null>(null);
  const [newGeom, setNewGeom] = useState<GeoJsonGeometry | null>(null);
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [suggestId, setSuggestId] = useState<string | null>(null);
  const [archiveId, setArchiveId] = useState<string | null>(null);
  const [archiveReason, setArchiveReason] = useState("");
  const [showBulk, setShowBulk] = useState(false);
  const [tableH, setTableH] = useState(300);

  const perms = session?.permissions;
  const canEdit = Boolean(perms?.edit);
  const isAdmin = Boolean(perms?.admin);

  // ---------------- بارگذاری اولیه ----------------

  const loadSession = useCallback(async () => {
    const s = await api.me();
    setSession(s);
    return s;
  }, []);

  useEffect(() => {
    api.info().then(setInfo).catch(() => {});
    api.operators().then(setOperators).catch(() => {});
    loadSession().catch(() =>
      setSession({ authenticated: false, role: "public", permissions: { view: true, edit: false, admin: false, suggest: true } }),
    );
  }, [loadSession]);

  const loadLayers = useCallback(async () => {
    try {
      const ls = await api.layers();
      setLayers(ls);
      setActiveLayerId((cur) => (cur && ls.some((l) => l.id === cur) ? cur : ls[0]?.id ?? null));
      setVisible((cur) => {
        const valid = new Set([...cur].filter((id) => ls.some((l) => l.id === id)));
        if (valid.size === 0 && ls[0]) valid.add(ls[0].id);
        return valid;
      });
    } catch (e) {
      toast((e as Error).message, "err");
    }
  }, [toast]);

  useEffect(() => {
    if (session) loadLayers();
  }, [session, loadLayers]);

  const loadPending = useCallback(() => {
    if (!canEdit) return;
    api.suggestionStats().then((s) => setPendingCount(s.pending || 0)).catch(() => {});
  }, [canEdit]);
  useEffect(() => { loadPending(); }, [loadPending]);

  // ---- GeoJSON لایه‌های روشن ----
  const staffArchive = canEdit && includeArchived;
  useEffect(() => {
    for (const id of visible) {
      if (layerData[id]) continue;
      api
        .geojson(id, staffArchive)
        .then((d) => setLayerData((p) => ({ ...p, [id]: d as unknown as GeoJSON.FeatureCollection })))
        .catch((e) => toast(e.message, "err"));
    }
  }, [visible, layerData, staffArchive, toast]);

  // با تغییر نمایش آرشیو، داده نقشه دوباره خوانده می‌شود
  useEffect(() => { setLayerData({}); }, [staffArchive]);

  const reloadLayerData = useCallback((layerId: string) => {
    setLayerData((p) => {
      const n = { ...p };
      delete n[layerId];
      return n;
    });
  }, []);

  // ---- ستون‌های لایه فعال ----
  const loadFields = useCallback(async (id: string) => {
    const [fs, sf] = await Promise.all([api.fields(id), api.searchFields(id)]);
    setFields(fs);
    setSearchFields(sf);
  }, []);

  useEffect(() => {
    if (!activeLayerId) {
      setFields([]);
      setSearchFields([]);
      setFeatures([]);
      setTotal(0);
      return;
    }
    setConditions([]);
    setQ("");
    setSortBy(null);
    setPage(1);
    setSelectedId(null);
    setChecked(new Set());
    setFilterApplied(false);
    loadFields(activeLayerId).catch((e) => toast(e.message, "err"));
    setVisible((p) => (p.has(activeLayerId) ? p : new Set([...p, activeLayerId])));
    setSearchTick((t) => t + 1);
  }, [activeLayerId, loadFields, toast]);

  // ---------------- اجرای جست‌وجو ----------------

  const buildRequest = useCallback(
    (): SearchRequest => ({
      layer_id: activeLayerId || undefined,
      q: q.trim() || undefined,
      conditions: conditions.filter(
        (c) => ["is_empty", "is_not_empty"].includes(c.op) || (c.value !== "" && c.value !== undefined && c.value !== null),
      ),
      logic,
      include_archived: canEdit && includeArchived,
      intersects: spatial || undefined,
      sort_by: sortBy || undefined,
      sort_dir: sortDir,
      page,
      page_size: pageSize,
    }),
    [activeLayerId, q, conditions, logic, canEdit, includeArchived, spatial, sortBy, sortDir, page, pageSize],
  );

  const reqRef = useRef(buildRequest);
  reqRef.current = buildRequest;

  useEffect(() => {
    if (!activeLayerId || searchTick === 0) return;
    let cancelled = false;
    const req = reqRef.current();
    setLoading(true);
    api
      .search(req)
      .then((r) => {
        if (cancelled) return;
        setFeatures(r.items);
        setTotal(r.total);
        setFilterApplied(Boolean(req.q || req.conditions?.length || req.intersects));
      })
      .catch((e) => !cancelled && toast(e.message, "err"))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [searchTick, page, pageSize, sortBy, sortDir, includeArchived, spatial, activeLayerId, toast]);

  const runSearch = () => {
    setPage(1);
    setSearchTick((t) => t + 1);
  };

  const resetSearch = () => {
    setQ("");
    setConditions([]);
    setSortBy(null);
    setPage(1);
    setSearchTick((t) => t + 1);
  };

  const refresh = useCallback(() => {
    setSearchTick((t) => t + 1);
    if (activeLayerId) reloadLayerData(activeLayerId);
    loadLayers();
  }, [activeLayerId, reloadLayerData, loadLayers]);

  const highlightIds = useMemo(
    () => (filterApplied ? new Set(features.map((f) => f.id)) : new Set<string>()),
    [filterApplied, features],
  );

  // ---------------- عملیات عارضه ----------------

  const findFeature = async (id: string): Promise<Feature> =>
    features.find((f) => f.id === id) || (await api.feature(id));

  const featureTitle = (f: Feature | undefined | null) => {
    if (!f) return "";
    const lay = layers.find((l) => l.id === f.layer_id);
    const a = f.attributes;
    return String((lay?.label_field && a[lay.label_field]) || a.nam || a.name || "بدون نام");
  };

  const [editFeature, setEditFeature] = useState<Feature | null>(null);
  const [editFields, setEditFields] = useState<FieldDef[]>([]);
  useEffect(() => {
    if (!editId) { setEditFeature(null); return; }
    findFeature(editId)
      .then(async (f) => {
        setEditFields(f.layer_id === activeLayerId ? fields : await api.fields(f.layer_id));
        setEditFeature(f);
      })
      .catch((e) => { toast(e.message, "err"); setEditId(null); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId]);

  const [suggestFeature, setSuggestFeature] = useState<Feature | null>(null);
  useEffect(() => {
    if (!suggestId) { setSuggestFeature(null); return; }
    findFeature(suggestId).then(setSuggestFeature).catch(() => setSuggestId(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestId]);

  const [historyFeature, setHistoryFeature] = useState<Feature | null>(null);
  useEffect(() => {
    if (!historyId) { setHistoryFeature(null); return; }
    findFeature(historyId).then(setHistoryFeature).catch(() => setHistoryId(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyId]);

  const onGeometryEdited = async (id: string, geometry: GeoJsonGeometry) => {
    try {
      await api.updateFeature(id, { geometry, note: "اصلاح هندسه روی نقشه" });
      toast("هندسه ذخیره شد.", "ok");
      refresh();
    } catch (e) {
      toast((e as Error).message, "err");
      refresh();
    }
  };

  const restore = async (id: string) => {
    try {
      toast((await api.restoreFeature(id)).detail, "ok");
      refresh();
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };

  const doLogout = async () => {
    await api.logout().catch(() => {});
    setTab("map");
    setIncludeArchived(false);
    await loadSession();
    toast("از سامانه خارج شدید.");
  };

  // ---- کشیدن مرز جدول ----
  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = tableH;
    const move = (ev: MouseEvent) => {
      const h = Math.min(window.innerHeight - 200, Math.max(90, startH - (ev.clientY - startY)));
      setTableH(h);
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      window.dispatchEvent(new Event("resize"));
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  if (!session) return <Loading text="در حال اتصال به سامانه…" />;

  const activeLayer = layers.find((l) => l.id === activeLayerId);
  const tabs: { id: Tab; label: string; show: boolean }[] = [
    { id: "map", label: "🗺 نقشه و جدول توصیفی", show: true },
    { id: "layers", label: "🗂 لایه‌ها و ستون‌ها", show: canEdit },
    { id: "upload", label: "⬆ آپلود شیپ‌فایل", show: canEdit },
    { id: "suggestions", label: `💡 پیشنهادها${pendingCount ? ` (${fa(pendingCount)})` : ""}`, show: canEdit },
    { id: "users", label: "👥 کاربران", show: isAdmin },
    { id: "audit", label: "📜 لاگ سامانه", show: isAdmin },
  ];

  return (
    <div className="app">
      <header className="header">
        {tab === "map" && (
          <button className="btn btn-sm menu-toggle" onClick={() => setSidebarOpen((o) => !o)} aria-label="منو">☰</button>
        )}
        <div className="brand">
          <div className="brand-mark">🛣</div>
          <div className="brand-text">
            <h1>{info?.app_name || "سامانه مدیریت معابر شهر پلدختر"}</h1>
            <span>شهرداری پلدختر</span>
          </div>
        </div>
        <nav>
          {tabs.filter((t) => t.show).map((t) => (
            <button key={t.id} className={tab === t.id ? "active" : ""} onClick={() => setTab(t.id)}>{t.label}</button>
          ))}
        </nav>
        <div className="spacer" />
        <div className="userbox">
          {session.authenticated && session.user ? (
            <>
              <div className="who">
                <strong>{session.user.full_name || session.user.username}</strong>
                <small>{ROLE_LABEL[session.user.role]}</small>
              </div>
              <button className="btn btn-sm btn-ghost" onClick={() => setShowPw("normal")} title="تغییر گذرواژه">🔑</button>
              <button className="btn btn-sm" onClick={doLogout}>خروج</button>
            </>
          ) : (
            <>
              <span className="badge badge-muted">کاربر عمومی</span>
              <button className="btn btn-sm btn-primary" onClick={() => setShowLogin(true)}>ورود کارکنان</button>
            </>
          )}
        </div>
      </header>

      <div className="main">
        {tab === "map" && (
          <>
            <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
              <div className="card">
                <h3>🗂 لایه‌ها</h3>
                {layers.length === 0 && (
                  <div className="tiny muted">
                    لایه‌ای وجود ندارد.{canEdit && <> از بخش <a href="#" onClick={(e) => { e.preventDefault(); setTab("upload"); }}>آپلود شیپ‌فایل</a> شروع کنید.</>}
                  </div>
                )}
                {layers.map((l) => (
                  <div key={l.id} style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 0" }}>
                    <input
                      type="checkbox"
                      title="نمایش روی نقشه"
                      checked={visible.has(l.id)}
                      disabled={l.id === activeLayerId}
                      onChange={() =>
                        setVisible((p) => {
                          const n = new Set(p);
                          if (n.has(l.id)) n.delete(l.id);
                          else n.add(l.id);
                          return n;
                        })
                      }
                    />
                    <label className="checkbox grow" style={{ fontWeight: l.id === activeLayerId ? 700 : 400 }}>
                      <input type="radio" name="active-layer" checked={l.id === activeLayerId} onChange={() => setActiveLayerId(l.id)} />
                      <span>{l.name}</span>
                    </label>
                    <span className="tiny muted" title={GEOM_LABEL[l.geom_type]}>{fa(l.feature_count)}</span>
                  </div>
                ))}
                {canEdit && activeLayer && (
                  <div className="tiny muted" style={{ marginTop: 6 }}>
                    برای رسم عارضه جدید در «{activeLayer.name}» از نوار ابزار سمت چپ نقشه استفاده کنید.
                  </div>
                )}
              </div>

              <SearchPanel
                layerId={activeLayerId}
                fields={searchFields}
                operators={operators}
                q={q}
                conditions={conditions}
                logic={logic}
                includeArchived={includeArchived}
                canSeeArchive={canEdit}
                total={total}
                hasSpatial={Boolean(spatial)}
                onQ={setQ}
                onConditions={setConditions}
                onLogic={setLogic}
                onIncludeArchived={(v) => { setIncludeArchived(v); setPage(1); }}
                onRun={() => { runSearch(); setSidebarOpen(false); }}
                onReset={resetSearch}
                onExportCsv={() =>
                  api.exportCsv({ ...buildRequest(), page: 1 }, `${activeLayer?.slug || "layer"}.csv`).catch((e) => toast(e.message, "err"))
                }
                onExportGeojson={() =>
                  api.exportGeojson({ ...buildRequest(), page: 1 }, `${activeLayer?.slug || "layer"}.geojson`).catch((e) => toast(e.message, "err"))
                }
              />
            </aside>

            <section className="workspace">
              <div className="split">
                <div className="pane-map">
                  <MapView
                    layers={layers}
                    visibleLayerIds={visible}
                    layerData={layerData}
                    fields={fields}
                    activeLayerId={activeLayerId}
                    selectedId={selectedId}
                    highlightIds={highlightIds}
                    canEdit={canEdit}
                    canSuggest={Boolean(perms?.suggest)}
                    center={info?.default_center || [33.143, 47.7172]}
                    zoom={info?.default_zoom || 14}
                    drawMode={drawMode}
                    onDrawModeChange={setDrawMode}
                    onSelect={setSelectedId}
                    onDrawn={(g) => setNewGeom(g)}
                    onGeometryEdited={onGeometryEdited}
                    onEditAttributes={setEditId}
                    onSuggest={setSuggestId}
                    onSpatialFilter={(g) => { setSpatial(g); setPage(1); }}
                  />
                </div>
                <div className="resizer" onMouseDown={startResize} title="برای تغییر اندازه بکشید" />
                <div className="pane-table" style={{ height: tableH }}>
                  <div className="table-toolbar">
                    <strong>جدول توصیفی {activeLayer ? `«${activeLayer.name}»` : ""}</strong>
                    <span className="muted tiny">{fa(total)} عارضه{filterApplied ? " (فیلترشده)" : ""}</span>
                    <div className="grow" />
                    {canEdit && checked.size > 0 && (
                      <>
                        <span className="tiny">{fa(checked.size)} ردیف انتخاب شده</span>
                        <button className="btn btn-sm btn-primary" onClick={() => setShowBulk(true)}>ویرایش گروهی</button>
                        <button className="btn btn-sm btn-ghost" onClick={() => setChecked(new Set())}>لغو انتخاب</button>
                      </>
                    )}
                    {selectedId && (
                      <button className="btn btn-sm btn-ghost" onClick={() => setSelectedId(null)}>لغو انتخاب روی نقشه</button>
                    )}
                    <button className="btn btn-sm" onClick={refresh} title="بارگذاری دوباره">⟳</button>
                  </div>
                  <AttributeTable
                    features={features}
                    fields={fields}
                    total={total}
                    page={page}
                    pageSize={pageSize}
                    loading={loading}
                    selectedId={selectedId}
                    selectedIds={checked}
                    sortBy={sortBy}
                    sortDir={sortDir}
                    canEdit={canEdit}
                    canSuggest={Boolean(perms?.suggest)}
                    isStaff={session.authenticated}
                    onPage={setPage}
                    onPageSize={(n) => { setPageSize(n); setPage(1); }}
                    onSort={(k) => {
                      if (sortBy === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
                      else { setSortBy(k); setSortDir("asc"); }
                    }}
                    onSelect={setSelectedId}
                    onToggleCheck={(id) =>
                      setChecked((p) => {
                        const n = new Set(p);
                        if (n.has(id)) n.delete(id);
                        else n.add(id);
                        return n;
                      })
                    }
                    onToggleAll={() =>
                      setChecked((p) => {
                        const all = features.every((f) => p.has(f.id));
                        const n = new Set(p);
                        for (const f of features) {
                          if (all) n.delete(f.id);
                          else n.add(f.id);
                        }
                        return n;
                      })
                    }
                    onEdit={setEditId}
                    onHistory={setHistoryId}
                    onArchive={(id) => { setArchiveReason(""); setArchiveId(id); }}
                    onRestore={restore}
                    onSuggest={setSuggestId}
                  />
                </div>
              </div>
            </section>
          </>
        )}

        {tab !== "map" && (
          <section className="workspace" style={{ overflow: "hidden" }}>
            {tab === "layers" && canEdit && <LayerManager isAdmin={isAdmin} onChanged={() => { setLayerData({}); loadLayers(); if (activeLayerId) loadFields(activeLayerId); setSearchTick((t) => t + 1); }} />}
            {tab === "upload" && canEdit && (
              <UploadWizard
                onImported={async (layerId) => {
                  await loadLayers();
                  setLayerData({});
                  setActiveLayerId(layerId);
                  setTab("map");
                }}
              />
            )}
            {tab === "suggestions" && canEdit && (
              <SuggestionsPage
                onChanged={() => { loadPending(); setLayerData({}); setSearchTick((t) => t + 1); }}
                onShowFeature={async (id) => {
                  try {
                    const f = await api.feature(id);
                    setActiveLayerId(f.layer_id);
                    setTab("map");
                    window.setTimeout(() => setSelectedId(id), 600);
                  } catch (e) {
                    toast((e as Error).message, "err");
                  }
                }}
              />
            )}
            {tab === "users" && isAdmin && session.user && <UserManager currentUserId={session.user.id} />}
            {tab === "audit" && isAdmin && <AuditLogPage />}
          </section>
        )}
      </div>

      {/* ---------------- پنجره‌ها ---------------- */}

      {showLogin && (
        <LoginModal
          onClose={() => setShowLogin(false)}
          onLoggedIn={async () => {
            setShowLogin(false);
            const s = await loadSession();
            toast(`خوش آمدید، ${s.user?.full_name || s.user?.username}`, "ok");
            if (s.user?.must_change_password) setShowPw("forced");
          }}
        />
      )}

      {showPw && (
        <ChangePasswordModal
          forced={showPw === "forced"}
          onClose={() => setShowPw(null)}
          onDone={async () => {
            setShowPw(null);
            toast("گذرواژه تغییر کرد.", "ok");
            await loadSession();
          }}
        />
      )}

      {editId && editFeature && (
        <FeatureEditor
          title={`ویرایش «${featureTitle(editFeature)}»`}
          subtitle={`نسخه ${fa(editFeature.version)} · آخرین ویرایش: ${editFeature.updated_by_name || "—"}`}
          fields={editFields}
          initial={editFeature.attributes}
          onClose={() => setEditId(null)}
          onSave={async (attrs, note) => {
            if (Object.keys(attrs).length === 0) {
              setEditId(null);
              return;
            }
            await api.updateFeature(editFeature.id, { attributes: attrs, note: note || null });
            toast("تغییرات ذخیره شد و در لاگ ثبت گردید.", "ok");
            setEditId(null);
            refresh();
          }}
        />
      )}

      {newGeom && activeLayer && (
        <FeatureEditor
          title={`عارضه جدید در «${activeLayer.name}»`}
          subtitle={`نوع هندسه: ${newGeom.type}`}
          fields={fields}
          initial={{}}
          isNew
          onClose={() => setNewGeom(null)}
          onSave={async (attrs) => {
            const f = await api.createFeature({ layer_id: activeLayer.id, attributes: attrs, geometry: newGeom });
            toast("عارضه جدید ثبت شد.", "ok");
            setNewGeom(null);
            refresh();
            setSelectedId(f.id);
          }}
        />
      )}

      {historyId && historyFeature && (
        <HistoryModal
          featureId={historyId}
          title={featureTitle(historyFeature)}
          fields={historyFeature.layer_id === activeLayerId ? fields : []}
          onClose={() => setHistoryId(null)}
        />
      )}

      {suggestId && suggestFeature && (
        <SuggestModal
          featureId={suggestId}
          currentName={featureTitle(suggestFeature)}
          onClose={() => setSuggestId(null)}
          onDone={() => {
            setSuggestId(null);
            toast("پیشنهاد شما ثبت شد. سپاس از همکاری شما.", "ok");
            loadPending();
          }}
        />
      )}

      {archiveId && (
        <Confirm
          title="آرشیو عارضه"
          confirmLabel="آرشیو کن"
          message={
            <>
              <p style={{ marginTop: 0 }}>
                عارضه از نقشه و جدول عمومی پنهان می‌شود ولی داده و تاریخچه آن حفظ می‌شود و قابل بازگردانی است.
              </p>
              <div className="field">
                <label>دلیل آرشیو</label>
                <input className="input" value={archiveReason} onChange={(e) => setArchiveReason(e.target.value)} autoFocus />
              </div>
            </>
          }
          onCancel={() => setArchiveId(null)}
          onConfirm={async () => {
            try {
              toast((await api.archiveFeature(archiveId, archiveReason || undefined)).detail, "ok");
              if (selectedId === archiveId) setSelectedId(null);
              refresh();
            } catch (e) {
              toast((e as Error).message, "err");
            }
            setArchiveId(null);
          }}
        />
      )}

      {showBulk && (
        <BulkEditModal
          fields={fields}
          count={checked.size}
          onClose={() => setShowBulk(false)}
          onSave={async (key, value) => {
            const r = await api.bulkField([...checked], key, value);
            toast(r.detail, "ok");
            setShowBulk(false);
            setChecked(new Set());
            refresh();
          }}
        />
      )}
    </div>
  );
}

// ---------------- ویرایش گروهی ----------------

function BulkEditModal({
  fields, count, onClose, onSave,
}: {
  fields: FieldDef[];
  count: number;
  onClose: () => void;
  onSave: (key: string, value: unknown) => Promise<void>;
}) {
  const [key, setKey] = useState(fields[0]?.key || "");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fd = fields.find((f) => f.key === key);

  return (
    <Modal
      title="ویرایش گروهی"
      subtitle={`اعمال یک مقدار روی ${fa(count)} عارضه`}
      onClose={onClose}
      footer={
        <>
          <button
            className="btn btn-primary"
            disabled={busy || !key}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await onSave(key, value === "" ? null : value);
              } catch (e) {
                setError((e as Error).message);
                setBusy(false);
              }
            }}
          >
            اعمال
          </button>
          <button className="btn" onClick={onClose}>انصراف</button>
        </>
      }
    >
      <ErrorBox msg={error} />
      <div className="field">
        <label>ستون</label>
        <select className="select" value={key} onChange={(e) => { setKey(e.target.value); setValue(""); }}>
          {fields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
        </select>
      </div>
      <div className="field">
        <label>مقدار جدید (خالی = پاک‌کردن مقدار)</label>
        {fd?.data_type === "select" ? (
          <select className="select" value={value} onChange={(e) => setValue(e.target.value)}>
            <option value="">—</option>
            {fd.options.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        ) : fd?.data_type === "boolean" ? (
          <select className="select" value={value} onChange={(e) => setValue(e.target.value)}>
            <option value="">—</option>
            <option value="true">بله</option>
            <option value="false">خیر</option>
          </select>
        ) : (
          <input
            className="input"
            type={fd?.data_type === "date" ? "date" : fd?.data_type === "number" || fd?.data_type === "integer" ? "number" : "text"}
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        )}
      </div>
    </Modal>
  );
}
