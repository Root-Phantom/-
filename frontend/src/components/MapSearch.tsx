// ---- جست‌وجوی سریع روی نقشه (مانند گوگل ارث): عوارض لایه‌ها، مکان‌ها و مختصات ----
import L from "leaflet";
import { useEffect, useMemo, useRef, useState } from "react";

import type { FieldDef, Layer as LayerT } from "../types";

export interface MapSearchProps {
  map: React.RefObject<L.Map | null>;
  layers: LayerT[];
  visibleLayerIds: Set<string>;
  layerData: Record<string, GeoJSON.FeatureCollection>;
  fields: FieldDef[];
  /** انتخاب، بزرگ‌نمایی و باز کردن پاپ‌آپ عارضه */
  onPickFeature: (id: string) => void;
}

interface FeatureHit {
  kind: "feature";
  id: string;
  title: string;
  sub: string;
}

interface PlaceHit {
  kind: "place";
  key: string;
  title: string;
  sub: string;
  lat: number;
  lon: number;
  /** [جنوب، شمال، غرب، شرق] */
  bbox?: [number, number, number, number];
  geojson?: GeoJSON.Geometry;
}

interface CoordHit {
  kind: "coord";
  lat: number;
  lon: number;
}

type Hit = FeatureHit | PlaceHit | CoordHit;

interface NominatimResult {
  place_id: number;
  display_name: string;
  name?: string;
  lat: string;
  lon: string;
  boundingbox?: string[];
  geojson?: GeoJSON.Geometry;
}

const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const MAX_FEATURES = 8;

// یکسان‌سازی نویسه‌های عربی/فارسی، ارقام و نیم‌فاصله برای مقایسه
function norm(s: string): string {
  return s
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[يى]/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[ةۀ]/g, "ه")
    .replace(/[أإآ]/g, "ا")
    .replace(/[‌‏ً-ٟ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// «۳۳٫۱۴, ۴۷٫۷۱» یا «33.14 47.71» ← مختصات؛ ترتیب طول/عرض برای محدوده ایران تشخیص داده می‌شود
function parseCoords(raw: string): CoordHit | null {
  const s = norm(raw).replace(/٫/g, ".").replace(/،/g, ",");
  const m = s.match(/^(-?\d{1,3}(?:\.\d+)?)\s*[,\s]\s*(-?\d{1,3}(?:\.\d+)?)$/);
  if (!m) return null;
  let lat = parseFloat(m[1]);
  let lon = parseFloat(m[2]);
  if (Math.abs(lat) > 90 || (lat > 43 && lat < 64 && lon > 24 && lon < 40)) [lat, lon] = [lon, lat];
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { kind: "coord", lat, lon };
}

const fmt = (n: number) => n.toFixed(5).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[+d]);

export default function MapSearch({ map, layers, visibleLayerIds, layerData, fields, onPickFeature }: MapSearchProps) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [places, setPlaces] = useState<PlaceHit[]>([]);
  const [placesLoading, setPlacesLoading] = useState(false);
  const [placesError, setPlacesError] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [hasResult, setHasResult] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultLayer = useRef<L.LayerGroup | null>(null);

  const query = norm(text);
  const coord = useMemo(() => parseCoords(text), [text]);

  // ---- جست‌وجو در عوارض لایه‌های نمایش‌داده‌شده (داده‌ها از پیش بارگذاری شده‌اند) ----
  const featureHits = useMemo<FeatureHit[]>(() => {
    if (query.length < 2 || coord) return [];
    const labelByKey: Record<string, string> = {};
    for (const f of fields) labelByKey[f.key] = f.label;
    const hits: (FeatureHit & { score: number })[] = [];

    for (const lay of layers) {
      if (!visibleLayerIds.has(lay.id)) continue;
      const data = layerData[lay.id];
      if (!data) continue;
      for (const feat of data.features) {
        const props = feat.properties || {};
        const fid = String(props.__id || feat.id || "");
        if (!fid) continue;
        const titleRaw = (lay.label_field && props[lay.label_field]) || props.nam || props.name || props.anvan;
        let best: { key: string; value: string; score: number } | null = null;
        for (const [k, v] of Object.entries(props)) {
          if (k.startsWith("__") || v === null || v === undefined || v === "") continue;
          const nv = norm(String(v));
          const at = nv.indexOf(query);
          if (at < 0) continue;
          // تطابق کامل > آغاز متن > میانه متن؛ ستون عنوان امتیاز بیشتری دارد
          let score = nv === query ? 3 : at === 0 ? 2 : 1;
          if (String(v) === String(titleRaw ?? "")) score += 0.5;
          if (!best || score > best.score) best = { key: k, value: String(v), score };
        }
        if (!best) continue;
        const title = String(titleRaw || best.value);
        const matchedTitle = String(titleRaw ?? "") === best.value;
        hits.push({
          kind: "feature",
          id: fid,
          title,
          sub: matchedTitle ? lay.name : `${lay.name} · ${labelByKey[best.key] || best.key}: ${best.value}`,
          score: best.score,
        });
      }
    }
    hits.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title, "fa"));
    return hits.slice(0, MAX_FEATURES);
  }, [query, coord, layers, visibleLayerIds, layerData, fields]);

  // ---- جست‌وجوی مکان در OpenStreetMap (با تأخیر برای رعایت محدودیت سرویس) ----
  useEffect(() => {
    setPlaces([]);
    setPlacesError(false);
    if (query.length < 2 || coord) {
      setPlacesLoading(false);
      return;
    }
    const ctrl = new AbortController();
    setPlacesLoading(true);
    const t = window.setTimeout(async () => {
      const m = map.current;
      const fetchPlaces = async (restrictIran: boolean) => {
        const params = new URLSearchParams({
          q: text.trim(),
          format: "jsonv2",
          limit: "6",
          "accept-language": "fa",
          polygon_geojson: "1",
          polygon_threshold: "0.0003",
        });
        if (restrictIran) params.set("countrycodes", "ir");
        if (m) {
          // ترجیح نتایج نزدیک به محدوده فعلی نقشه
          const b = m.getBounds().pad(2);
          params.set("viewbox", [b.getWest(), b.getNorth(), b.getEast(), b.getSouth()].map((n) => n.toFixed(4)).join(","));
        }
        const res = await fetch(`${NOMINATIM}?${params}`, { signal: ctrl.signal });
        if (!res.ok) throw new Error(String(res.status));
        return (await res.json()) as NominatimResult[];
      };
      try {
        let rows = await fetchPlaces(true);
        if (rows.length === 0) rows = await fetchPlaces(false);
        setPlaces(
          rows.map((r) => {
            const parts = r.display_name.split("،").map((p) => p.trim());
            const title = r.name || parts[0];
            const bb = r.boundingbox?.map(Number);
            return {
              kind: "place",
              key: String(r.place_id),
              title,
              sub: parts.filter((p) => p !== title).slice(0, 4).join("، "),
              lat: Number(r.lat),
              lon: Number(r.lon),
              bbox: bb && bb.length === 4 && bb.every(Number.isFinite) ? (bb as [number, number, number, number]) : undefined,
              geojson: r.geojson,
            };
          }),
        );
      } catch (e) {
        if ((e as Error).name !== "AbortError") setPlacesError(true);
      } finally {
        if (!ctrl.signal.aborted) setPlacesLoading(false);
      }
    }, 600);
    return () => {
      window.clearTimeout(t);
      ctrl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, coord]);

  const hits: Hit[] = useMemo(
    () => (coord ? [coord] : [...featureHits, ...places]),
    [coord, featureHits, places],
  );
  useEffect(() => setCursor(0), [text]);

  // بستن فهرست با کلیک بیرون از کادر
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, []);

  // پاک‌سازی نشانگر نتیجه هنگام برچیده شدن
  useEffect(() => () => {
    resultLayer.current?.remove();
  }, []);

  const clearResult = () => {
    resultLayer.current?.remove();
    resultLayer.current = null;
    setHasResult(false);
  };

  const showResult = (lat: number, lon: number, label: string, geom?: GeoJSON.Geometry, bbox?: PlaceHit["bbox"]) => {
    const m = map.current;
    if (!m) return;
    clearResult();
    const g = L.layerGroup().addTo(m);
    if (geom && geom.type !== "Point") {
      L.geoJSON(geom, {
        interactive: false,
        style: { color: "#dc2626", weight: 3, dashArray: "6,5", fillColor: "#dc2626", fillOpacity: 0.06 },
      }).addTo(g);
    }
    const marker = L.marker([lat, lon], { title: label }).addTo(g);
    const popup = document.createElement("div");
    const t = document.createElement("div");
    t.className = "popup-title";
    t.textContent = label;
    const c = document.createElement("div");
    c.className = "tiny muted";
    c.textContent = `${fmt(lat)}، ${fmt(lon)}`;
    const btn = document.createElement("button");
    btn.className = "btn btn-sm";
    btn.style.marginTop = "8px";
    btn.textContent = "حذف نشانگر";
    btn.onclick = clearResult;
    popup.append(t, c, btn);
    marker.bindPopup(popup, { autoPan: false });
    resultLayer.current = g;
    setHasResult(true);

    if (bbox) {
      const [s, n, w, e] = bbox;
      m.flyToBounds([[s, w], [n, e]], { padding: [40, 40], maxZoom: 17, duration: 1.2 });
    } else {
      m.flyTo([lat, lon], Math.max(m.getZoom(), 17), { duration: 1.2 });
    }
    m.once("moveend", () => marker.openPopup());
  };

  const pick = (h: Hit | undefined) => {
    if (!h) return;
    setOpen(false);
    inputRef.current?.blur();
    if (h.kind === "feature") {
      clearResult();
      setText(h.title);
      onPickFeature(h.id);
    } else if (h.kind === "place") {
      setText(h.title);
      showResult(h.lat, h.lon, h.title, h.geojson, h.bbox);
    } else {
      showResult(h.lat, h.lon, "مختصات واردشده");
    }
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setCursor((c) => Math.min(c + 1, hits.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      pick(hits[cursor]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  const showList = open && query.length >= 2;
  const featureCount = coord ? 0 : featureHits.length;

  return (
    <div className="map-overlay map-search" ref={boxRef}>
      <div className="map-search-row">
        <span className="map-search-icon" aria-hidden>
          🔎
        </span>
        <input
          ref={inputRef}
          type="search"
          value={text}
          placeholder="جست‌وجو: معبر، مکان یا مختصات…"
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKey}
          aria-label="جست‌وجو روی نقشه"
          role="combobox"
          aria-expanded={showList}
          aria-autocomplete="list"
        />
        {(text || hasResult) && (
          <button
            className="map-search-clear"
            title="پاک کردن"
            onClick={() => {
              setText("");
              clearResult();
              inputRef.current?.focus();
            }}
          >
            ✕
          </button>
        )}
      </div>

      {showList && (
        <div className="map-search-list" role="listbox">
          {hits.map((h, i) => {
            const header =
              i === 0 && h.kind === "feature" ? "عوارض لایه‌ها" :
              h.kind === "place" && i === featureCount ? "مکان‌ها (OpenStreetMap)" : null;
            return (
              <div key={h.kind === "feature" ? `f${h.id}` : h.kind === "place" ? `p${h.key}` : "c"}>
                {header && <div className="map-search-group">{header}</div>}
                <button
                  role="option"
                  aria-selected={i === cursor}
                  className={`map-search-item ${i === cursor ? "active" : ""}`}
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => pick(h)}
                >
                  <span className="map-search-kind" aria-hidden>
                    {h.kind === "feature" ? "▤" : h.kind === "place" ? "📍" : "⌖"}
                  </span>
                  <span className="map-search-text">
                    {h.kind === "coord" ? (
                      <>
                        <strong>رفتن به مختصات</strong>
                        <span className="tiny muted">عرض {fmt(h.lat)}، طول {fmt(h.lon)}</span>
                      </>
                    ) : (
                      <>
                        <strong>{h.title}</strong>
                        {h.sub && <span className="tiny muted">{h.sub}</span>}
                      </>
                    )}
                  </span>
                </button>
              </div>
            );
          })}
          {!coord && placesLoading && <div className="map-search-status">در حال جست‌وجوی مکان‌ها…</div>}
          {!coord && placesError && <div className="map-search-status">سرویس جست‌وجوی مکان در دسترس نیست.</div>}
          {!coord && !placesLoading && !placesError && hits.length === 0 && (
            <div className="map-search-status">نتیجه‌ای یافت نشد.</div>
          )}
        </div>
      )}
    </div>
  );
}
