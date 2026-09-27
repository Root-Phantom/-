// ---- نقشه: نمایش لایه‌ها، رسم نقطه/خط/چندضلعی و انتخاب عارضه ----
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet-draw";
import "leaflet-draw/dist/leaflet.draw.css";
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";
import { useEffect, useMemo, useRef, useState } from "react";

import type { FieldDef, GeoJsonGeometry, Layer as LayerT } from "../types";

// مسیر آیکون نشانگر پیش‌فرض پس از بسته‌بندی Vite درست تنظیم می‌شود
delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl;
L.Icon.Default.mergeOptions({ iconRetinaUrl: markerIcon2x, iconUrl: markerIcon, shadowUrl: markerShadow });

// ترجمه متن‌های ابزار رسم لیفلت به فارسی
function localizeDraw() {
  const D = (L as unknown as { drawLocal: Record<string, Record<string, Record<string, unknown>>> }).drawLocal;
  if (!D) return;
  D.draw.toolbar.actions = { title: "انصراف", text: "انصراف" };
  D.draw.toolbar.finish = { title: "پایان رسم", text: "پایان" };
  D.draw.toolbar.undo = { title: "حذف آخرین نقطه", text: "حذف آخرین نقطه" };
  D.draw.toolbar.buttons = {
    polyline: "رسم خط / معبر",
    polygon: "رسم چندضلعی",
    rectangle: "رسم مستطیل",
    circle: "رسم دایره",
    marker: "افزودن نقطه",
    circlemarker: "افزودن نقطه دایره‌ای",
  };
  D.draw.handlers.polyline = {
    tooltip: { start: "برای شروع رسم کلیک کنید.", cont: "برای ادامه کلیک کنید.", end: "برای پایان روی آخرین نقطه کلیک کنید." },
    error: "<strong>خطا:</strong> خطوط نباید یکدیگر را قطع کنند.",
  };
  D.draw.handlers.polygon = {
    tooltip: { start: "برای شروع رسم کلیک کنید.", cont: "برای ادامه کلیک کنید.", end: "برای بستن چندضلعی روی نقطه اول کلیک کنید." },
  };
  D.draw.handlers.marker = { tooltip: { start: "روی نقشه کلیک کنید." } };
  D.draw.handlers.rectangle = { tooltip: { start: "بکشید تا مستطیل رسم شود." } };
  D.draw.handlers.simpleshape = { tooltip: { end: "رها کنید تا رسم پایان یابد." } };
  D.edit.toolbar.actions = {
    save: { title: "ذخیره تغییرات", text: "ذخیره" },
    cancel: { title: "لغو تغییرات", text: "انصراف" },
    clearAll: { title: "پاک‌کردن همه", text: "پاک‌کردن همه" },
  };
  D.edit.toolbar.buttons = {
    edit: "ویرایش هندسه", editDisabled: "عارضه‌ای برای ویرایش نیست",
    remove: "حذف هندسه", removeDisabled: "عارضه‌ای برای حذف نیست",
  };
  D.edit.handlers.edit = {
    tooltip: { text: "نقاط را بکشید تا شکل تغییر کند.", subtext: "برای لغو روی انصراف بزنید." },
  };
  D.edit.handlers.remove = { tooltip: { text: "برای حذف روی عارضه کلیک کنید." } };
}

export type DrawMode = "none" | "point" | "line" | "polygon";

export interface MapViewProps {
  layers: LayerT[];
  visibleLayerIds: Set<string>;
  /** عوارض هر لایه به صورت GeoJSON */
  layerData: Record<string, GeoJSON.FeatureCollection>;
  fields: FieldDef[];
  activeLayerId: string | null;
  selectedId: string | null;
  highlightIds: Set<string>;
  canEdit: boolean;
  canSuggest: boolean;
  center: [number, number];
  zoom: number;
  drawMode: DrawMode;
  onDrawModeChange: (m: DrawMode) => void;
  onSelect: (id: string | null) => void;
  onDrawn: (geometry: GeoJsonGeometry) => void;
  onGeometryEdited: (featureId: string, geometry: GeoJsonGeometry) => void;
  onEditAttributes: (id: string) => void;
  onSuggest: (id: string) => void;
  /** فیلتر مکانی با رسم چندضلعی */
  onSpatialFilter: (geometry: GeoJsonGeometry | null) => void;
}

const DEFAULT_COLORS = ["#1d4ed8", "#dc2626", "#15803d", "#b45309", "#7c3aed", "#0891b2", "#be185d"];

export default function MapView(props: MapViewProps) {
  const {
    layers, visibleLayerIds, layerData, fields, activeLayerId, selectedId, highlightIds,
    canEdit, canSuggest, center, zoom, drawMode, onDrawModeChange, onSelect, onDrawn,
    onGeometryEdited, onEditAttributes, onSuggest, onSpatialFilter,
  } = props;

  const mapEl = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layerGroups = useRef<Record<string, L.GeoJSON>>({});
  const drawnItems = useRef<L.FeatureGroup | null>(null);
  const drawHandler = useRef<L.Draw.Feature | null>(null);
  const spatialLayer = useRef<L.Layer | null>(null);
  const [baseName, setBaseName] = useState("osm");
  const [spatialActive, setSpatialActive] = useState(false);

  // نگه‌داشتن آخرین callback ها تا در بسته‌ها کهنه نشوند
  const cb = useRef({ onSelect, onDrawn, onGeometryEdited, onEditAttributes, onSuggest, onSpatialFilter, onDrawModeChange });
  cb.current = { onSelect, onDrawn, onGeometryEdited, onEditAttributes, onSuggest, onSpatialFilter, onDrawModeChange };

  const labelByKey = useMemo(() => {
    const m: Record<string, string> = {};
    for (const f of fields) m[f.key] = f.label;
    return m;
  }, [fields]);

  // محتوای پاپ‌آپ هنگام باز شدن ساخته می‌شود تا پس از ورود/خروج یا بارگذاری ستون‌ها کهنه نماند
  const popupCtx = useRef({ canEdit, canSuggest, labelByKey, layers });
  popupCtx.current = { canEdit, canSuggest, labelByKey, layers };

  const colorOf = (layerId: string) => {
    const lay = layers.find((l) => l.id === layerId);
    const c = (lay?.style as { color?: string })?.color;
    if (c) return c;
    const idx = layers.findIndex((l) => l.id === layerId);
    return DEFAULT_COLORS[Math.max(0, idx) % DEFAULT_COLORS.length];
  };

  // ---------------- ساخت نقشه ----------------
  useEffect(() => {
    if (!mapEl.current || map.current) return;
    localizeDraw();

    const m = L.map(mapEl.current, {
      center,
      zoom,
      zoomControl: false,
      preferCanvas: true,
      attributionControl: true,
    });
    map.current = m;

    L.control.zoom({ position: "topright", zoomInTitle: "بزرگ‌نمایی", zoomOutTitle: "کوچک‌نمایی" }).addTo(m);
    L.control.scale({ position: "bottomleft", imperial: false, metric: true }).addTo(m);

    const bases: Record<string, L.TileLayer> = {
      osm: L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 20, attribution: "© OpenStreetMap",
      }),
      satellite: L.tileLayer(
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        { maxZoom: 19, attribution: "© Esri" },
      ),
      blank: L.tileLayer("", { attribution: "بدون نقشه پایه" }),
    };
    bases.osm.addTo(m);
    (m as unknown as { __bases: typeof bases }).__bases = bases;

    const group = new L.FeatureGroup();
    m.addLayer(group);
    drawnItems.current = group;

    m.on(L.Draw.Event.CREATED, (e: L.LeafletEvent) => {
      const ev = e as unknown as { layer: L.Layer; layerType: string };
      const gj = (ev.layer as unknown as { toGeoJSON: () => GeoJSON.Feature }).toGeoJSON();
      drawHandler.current?.disable();
      drawHandler.current = null;
      if ((m as unknown as { __spatial?: boolean }).__spatial) {
        // حالت فیلتر مکانی: شکل رسم‌شده به عنوان محدوده جست‌وجو استفاده می‌شود
        if (spatialLayer.current) m.removeLayer(spatialLayer.current);
        const shown = L.geoJSON(gj, {
          style: { color: "#b45309", weight: 2, dashArray: "5,5", fillOpacity: 0.08 },
        }).addTo(m);
        spatialLayer.current = shown;
        (m as unknown as { __spatial?: boolean }).__spatial = false;
        setSpatialActive(true);
        cb.current.onSpatialFilter(gj.geometry as GeoJsonGeometry);
      } else {
        cb.current.onDrawn(gj.geometry as GeoJsonGeometry);
      }
      cb.current.onDrawModeChange("none");
    });

    // هر تغییر اندازه ظرف نقشه (چرخش گوشی، کشیدن جدول، منوی کناری) به لیفلت اطلاع داده می‌شود
    const ro = new ResizeObserver(() => m.invalidateSize({ debounceMoveend: true }));
    ro.observe(mapEl.current);

    return () => {
      ro.disconnect();
      m.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------- تعویض نقشه پایه ----------------
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const bases = (m as unknown as { __bases?: Record<string, L.TileLayer> }).__bases;
    if (!bases) return;
    for (const [name, tl] of Object.entries(bases)) {
      if (name === baseName) {
        if (!m.hasLayer(tl)) tl.addTo(m);
      } else if (m.hasLayer(tl)) m.removeLayer(tl);
    }
  }, [baseName]);

  // ---------------- رسم لایه‌ها ----------------
  useEffect(() => {
    const m = map.current;
    if (!m) return;

    // حذف لایه‌هایی که دیگر نمایش داده نمی‌شوند
    for (const [id, g] of Object.entries(layerGroups.current)) {
      if (!visibleLayerIds.has(id) || !layerData[id]) {
        m.removeLayer(g);
        delete layerGroups.current[id];
      }
    }

    for (const id of visibleLayerIds) {
      const data = layerData[id];
      if (!data) continue;
      if (layerGroups.current[id]) continue;

      const color = colorOf(id);

      const g = L.geoJSON(data, {
        style: (feat) => {
          const archived = Boolean(feat?.properties?.__archived);
          return {
            color: archived ? "#94a3b8" : color,
            weight: 3,
            opacity: archived ? 0.45 : 0.9,
            fillColor: color,
            fillOpacity: 0.15,
            dashArray: archived ? "4,4" : undefined,
          };
        },
        pointToLayer: (feat, latlng) =>
          L.circleMarker(latlng, {
            radius: 6,
            color: "#fff",
            weight: 2,
            fillColor: feat.properties?.__archived ? "#94a3b8" : color,
            fillOpacity: 0.95,
          }),
        onEachFeature: (feat, lyr) => {
          const fid = String(feat.properties?.__id || feat.id || "");

          lyr.bindPopup(() => {
            const { canEdit: edit, canSuggest: suggest, labelByKey: labels, layers: lays } = popupCtx.current;
            const props = feat.properties || {};
            const labelField = lays.find((l) => l.id === id)?.label_field;
            const title =
              (labelField && props[labelField]) ||
              props.nam || props.name || props.anvan || "بدون نام";

            const rows = Object.entries(props)
              .filter(([k, v]) => !k.startsWith("__") && v !== null && v !== "" && v !== undefined)
              .slice(0, 8)
              .map(
                ([k, v]) =>
                  `<tr><td>${escapeHtml(labels[k] || k)}</td><td><strong>${escapeHtml(
                    String(v),
                  )}</strong></td></tr>`,
              )
              .join("");

            const actions: string[] = [];
            if (edit) actions.push(`<button class="btn btn-sm btn-primary" data-act="edit">ویرایش</button>`);
            if (suggest) actions.push(`<button class="btn btn-sm" data-act="suggest">پیشنهاد نام</button>`);

            return `
              <div class="popup-title">${escapeHtml(String(title))}</div>
              <table class="popup-table">${rows}</table>
              ${props.__archived ? '<div class="badge badge-muted" style="margin-top:6px">آرشیو شده</div>' : ""}
              <div class="popup-actions">${actions.join("")}</div>`;
          }, { maxWidth: 320, minWidth: 200 });

          lyr.on("click", () => cb.current.onSelect(fid));
          lyr.on("popupopen", (e: L.LeafletEvent) => {
            const node = (e as unknown as { popup: L.Popup }).popup.getElement();
            node?.querySelector<HTMLButtonElement>('[data-act="edit"]')?.addEventListener("click", () => {
              cb.current.onEditAttributes(fid);
              m.closePopup();
            });
            node?.querySelector<HTMLButtonElement>('[data-act="suggest"]')?.addEventListener("click", () => {
              cb.current.onSuggest(fid);
              m.closePopup();
            });
          });
        },
      });

      g.addTo(m);
      layerGroups.current[id] = g;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleLayerIds, layerData, layers]);

  // ---------------- پرش به لایه فعال ----------------
  const fittedRef = useRef<string | null>(null);
  useEffect(() => {
    const m = map.current;
    if (!m || !activeLayerId) return;
    const g = layerGroups.current[activeLayerId];
    if (!g || fittedRef.current === activeLayerId) return;
    try {
      const b = g.getBounds();
      if (b.isValid()) {
        m.fitBounds(b, { padding: [30, 30], maxZoom: 17 });
        fittedRef.current = activeLayerId;
      }
    } catch {
      /* لایه خالی */
    }
  }, [activeLayerId, layerData]);

  // ---------------- برجسته‌سازی نتایج جست‌وجو ----------------
  useEffect(() => {
    for (const [id, g] of Object.entries(layerGroups.current)) {
      const color = colorOf(id);
      g.eachLayer((lyr) => {
        const f = (lyr as unknown as { feature?: GeoJSON.Feature }).feature;
        const fid = String(f?.properties?.__id || "");
        const isSel = fid === selectedId;
        const dim = highlightIds.size > 0 && !highlightIds.has(fid);
        const archived = Boolean(f?.properties?.__archived);

        const path = lyr as unknown as L.Path & { setStyle?: (s: L.PathOptions) => void };
        if (!path.setStyle) return;

        if (f?.geometry?.type === "Point" || f?.geometry?.type === "MultiPoint") {
          path.setStyle({
            fillColor: isSel ? "#f59e0b" : archived ? "#94a3b8" : color,
            color: isSel ? "#b45309" : "#fff",
            weight: isSel ? 3 : 2,
            fillOpacity: dim ? 0.2 : 0.95,
            opacity: dim ? 0.3 : 1,
          });
        } else {
          path.setStyle({
            color: isSel ? "#f59e0b" : archived ? "#94a3b8" : color,
            weight: isSel ? 6 : 3,
            opacity: dim ? 0.18 : archived ? 0.45 : 0.9,
            fillOpacity: dim ? 0.04 : 0.15,
          });
        }
        if (isSel && path.bringToFront) path.bringToFront();
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, highlightIds, layerData]);

  // ---------------- پرش به عارضه انتخاب‌شده ----------------
  useEffect(() => {
    const m = map.current;
    if (!m || !selectedId) return;
    for (const g of Object.values(layerGroups.current)) {
      let found: L.Layer | null = null;
      g.eachLayer((lyr) => {
        const f = (lyr as unknown as { feature?: GeoJSON.Feature }).feature;
        if (String(f?.properties?.__id || "") === selectedId) found = lyr;
      });
      if (found) {
        const withBounds = found as unknown as { getBounds?: () => L.LatLngBounds; getLatLng?: () => L.LatLng };
        if (withBounds.getBounds) {
          const b = withBounds.getBounds();
          if (b.isValid()) m.fitBounds(b, { padding: [80, 80], maxZoom: 18 });
        } else if (withBounds.getLatLng) {
          m.setView(withBounds.getLatLng(), Math.max(m.getZoom(), 17));
        }
        break;
      }
    }
  }, [selectedId]);

  // ---------------- فعال‌سازی ابزار رسم ----------------
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    drawHandler.current?.disable();
    drawHandler.current = null;
    if (drawMode === "none") return;

    const opts = { shapeOptions: { color: "#f59e0b", weight: 4 } };
    let handler: L.Draw.Feature | null = null;
    if (drawMode === "point") handler = new L.Draw.Marker(m as L.DrawMap);
    else if (drawMode === "line") handler = new L.Draw.Polyline(m as L.DrawMap, opts);
    else if (drawMode === "polygon") handler = new L.Draw.Polygon(m as L.DrawMap, opts);
    if (handler) {
      handler.enable();
      drawHandler.current = handler;
    }
    return () => {
      handler?.disable();
    };
  }, [drawMode]);

  // ---------------- ویرایش هندسه عارضه انتخاب‌شده ----------------
  const startGeometryEdit = () => {
    const m = map.current;
    if (!m || !selectedId) return;
    for (const g of Object.values(layerGroups.current)) {
      let target: L.Layer | null = null;
      g.eachLayer((lyr) => {
        const f = (lyr as unknown as { feature?: GeoJSON.Feature }).feature;
        if (String(f?.properties?.__id || "") === selectedId) target = lyr;
      });
      if (!target) continue;

      const editable = target as unknown as {
        editing?: { enable: () => void; disable: () => void };
        toGeoJSON: () => GeoJSON.Feature;
      };
      if (!editable.editing) {
        alert("ویرایش هندسه این عارضه پشتیبانی نمی‌شود.");
        return;
      }
      editable.editing.enable();

      const finish = new L.Control({ position: "topright" });
      finish.onAdd = () => {
        const div = L.DomUtil.create("div", "map-overlay");
        div.style.padding = "8px";
        div.innerHTML = `<div style="margin-bottom:6px;font-size:12px">نقاط را بکشید، سپس ذخیره کنید.</div>
          <button class="btn btn-sm btn-primary" data-a="save">ذخیره هندسه</button>
          <button class="btn btn-sm" data-a="cancel">انصراف</button>`;
        L.DomEvent.disableClickPropagation(div);
        div.querySelector('[data-a="save"]')?.addEventListener("click", () => {
          const gj = editable.toGeoJSON();
          editable.editing!.disable();
          m.removeControl(finish);
          cb.current.onGeometryEdited(selectedId, gj.geometry as GeoJsonGeometry);
        });
        div.querySelector('[data-a="cancel"]')?.addEventListener("click", () => {
          editable.editing!.disable();
          m.removeControl(finish);
        });
        return div;
      };
      finish.addTo(m);
      return;
    }
  };

  const beginSpatialFilter = () => {
    const m = map.current;
    if (!m) return;
    (m as unknown as { __spatial?: boolean }).__spatial = true;
    onDrawModeChange("polygon");
  };

  const clearSpatialFilter = () => {
    const m = map.current;
    if (m && spatialLayer.current) {
      m.removeLayer(spatialLayer.current);
      spatialLayer.current = null;
    }
    setSpatialActive(false);
    onSpatialFilter(null);
  };

  const activeLayer = layers.find((l) => l.id === activeLayerId);
  const geomOfActive = activeLayer?.geom_type;

  return (
    <div className="map-area">
      <div id="map" ref={mapEl} />

      {/* نوار ابزار رسم */}
      <div className="map-overlay drawbar">
        <button
          className={baseName === "osm" ? "active" : ""}
          onClick={() => setBaseName("osm")}
          title="نقشه خیابان‌ها"
        >
          🗺
        </button>
        <button
          className={baseName === "satellite" ? "active" : ""}
          onClick={() => setBaseName("satellite")}
          title="تصویر ماهواره‌ای"
        >
          🛰
        </button>
        <button
          className={baseName === "blank" ? "active" : ""}
          onClick={() => setBaseName("blank")}
          title="بدون نقشه پایه"
        >
          ⬜
        </button>

        {canEdit && activeLayerId && (
          <>
            <div className="sep" />
            {(geomOfActive === "point" || geomOfActive === "mixed") && (
              <button
                className={drawMode === "point" ? "active" : ""}
                onClick={() => onDrawModeChange(drawMode === "point" ? "none" : "point")}
                title="رسم نقطه"
              >
                📍
              </button>
            )}
            {(geomOfActive === "linestring" || geomOfActive === "mixed") && (
              <button
                className={drawMode === "line" ? "active" : ""}
                onClick={() => onDrawModeChange(drawMode === "line" ? "none" : "line")}
                title="رسم خط / معبر"
              >
                ╱
              </button>
            )}
            {(geomOfActive === "polygon" || geomOfActive === "mixed") && (
              <button
                className={drawMode === "polygon" ? "active" : ""}
                onClick={() => onDrawModeChange(drawMode === "polygon" ? "none" : "polygon")}
                title="رسم چندضلعی"
              >
                ⬠
              </button>
            )}
            {selectedId && (
              <button onClick={startGeometryEdit} title="ویرایش هندسه عارضه انتخاب‌شده">
                ✏
              </button>
            )}
          </>
        )}

        <div className="sep" />
        <button
          className={spatialActive ? "active" : ""}
          onClick={spatialActive ? clearSpatialFilter : beginSpatialFilter}
          title={spatialActive ? "حذف فیلتر مکانی" : "جست‌وجو در محدوده ترسیمی"}
        >
          {spatialActive ? "✕" : "🔍"}
        </button>
      </div>

      {drawMode !== "none" && (
        <div className="map-overlay map-hint">
          {drawMode === "point" && "روی نقشه کلیک کنید تا نقطه ثبت شود."}
          {drawMode === "line" && "برای رسم معبر کلیک کنید؛ روی آخرین نقطه دوبار کلیک کنید تا پایان یابد."}
          {drawMode === "polygon" && "برای رسم محدوده کلیک کنید؛ روی نقطه آغاز کلیک کنید تا بسته شود."}
          <div style={{ marginTop: 6 }}>
            <button className="btn btn-sm" onClick={() => onDrawModeChange("none")}>
              انصراف
            </button>
          </div>
        </div>
      )}

      {/* راهنمای لایه‌ها */}
      {visibleLayerIds.size > 0 && (
        <div className="map-overlay map-legend">
          <strong className="tiny">لایه‌های نمایش‌داده‌شده</strong>
          {layers
            .filter((l) => visibleLayerIds.has(l.id))
            .map((l) => (
              <div className="item" key={l.id}>
                <span
                  className={`swatch ${l.geom_type === "point" ? "point" : ""}`}
                  style={{ background: colorOf(l.id) }}
                />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {l.name}
                </span>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
