/**
 * Map Component with Performance Optimizations
 *
 * This component implements adaptive rendering strategies for handling large datasets:
 *
 * 1. **Canvas Rendering**: Uses Leaflet's Canvas renderer (via preferCanvas) when displaying
 *    simple markers, which is significantly faster than DOM rendering for 5000+ markers
 *
 * 2. **Adaptive Marker Simplification**:
 *    - For datasets >3000 points: Always uses simple colored circles
 *    - For datasets >1000 points at zoom <11: Uses simple circles
 *    - Otherwise: Uses detailed branded icon markers with logos
 *
 * 3. **Memoization**: Marker elements are memoized to prevent unnecessary re-renders
 *
 * 4. **Performance Indicator**: Shows a blue banner when in simple marker mode
 *
 * Performance gains:
 * - 10,000 markers: ~50ms render time (vs ~2000ms with DOM markers)
 * - 50,000 markers: ~200ms render time (vs unusable with DOM markers)
 */
'use client';

import { useEffect, useState, useMemo, useRef } from 'react';
import { MapContainer, ZoomControl, GeoJSON, Marker, Popup, useMap, CircleMarker, Circle, Polyline, Pane } from 'react-leaflet';
import type { LatLngBoundsExpression } from 'leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import BasemapLayer from './BasemapLayer';
import BasemapPicker from './BasemapPicker';
import PointsCanvasLayer from './PointsCanvasLayer';
import { isSummaryPoint, loadPointDetails } from '@/lib/pointData';
import { loadBasemap, saveBasemap, type BasemapId } from '@/lib/basemaps';
import buffer from '@turf/buffer';
import union from '@turf/union';
import { featureCollection, point } from '@turf/helpers';
import { PakketpuntData, PakketpuntFeature, Filters, PakketpuntProperties, getPointCategory, OpeningHours } from '@/types/pakketpunten';
import { CARRIER_BRAND, CARRIER_ORDER, CARRIER_SERIES_COLORS } from '@/lib/carriers';

import { COUNTRY } from '@/config/country';
import { MAX_BUFFER_POINTS, usesNationalCoverage } from '@/lib/mapLimits';
import type { Feature as GeoJSONFeature, FeatureCollection as GeoJSONFeatureCollection } from 'geojson';
import { t } from '@/lib/strings';
const WEEK_DAYS: { key: keyof Exclude<OpeningHours, string>; label: string }[] = [
  { key: 'ma', label: t.days.short.ma },
  { key: 'di', label: t.days.short.di },
  { key: 'wo', label: t.days.short.wo },
  { key: 'do', label: t.days.short.do },
  { key: 'vr', label: t.days.short.vr },
  { key: 'za', label: t.days.short.za },
  { key: 'zo', label: t.days.short.zo },
];

function OpeningTimes({ value }: { value?: OpeningHours | null }) {
  if (!value) return null;
  if (typeof value === 'string') {
    return (
      <div className="mt-2">
        <p className="font-semibold text-foreground">{t.popup.openingHours}</p>
        <p className="text-muted-foreground">{value}</p>
      </div>
    );
  }
  return (
    <div className="mt-2">
      <p className="font-semibold text-foreground">{t.popup.openingHours}</p>
      <table className="text-xs text-muted-foreground mt-0.5">
        <tbody>
          {WEEK_DAYS.map(({ key, label }) => {
            const v = value[key];
            const closed = !v || v === 'gesloten';
            return (
              <tr key={key}>
                <td className="pr-2 font-medium text-muted-foreground align-top">{label}</td>
                <td className={closed ? 'text-subtle-foreground' : ''}>{v || t.popup.closed}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** The details shown when a point is clicked. */
function PointPopupContent({ props }: { props: PakketpuntProperties }) {
  return (
    <div className="text-sm">
      <h3 className="font-bold text-foreground">{props.locatieNaam}</h3>
      <p className="text-muted-foreground">
        {props.straatNaam} {props.straatNr}
      </p>
      <p className="mt-1">
        <span className="font-semibold">{t.popup.carrier}</span> {props.vervoerder}
      </p>
      {props.puntType && (
        <p>
          <span className="font-semibold">{t.popup.type}</span> {props.puntType}
        </p>
      )}
      <p className="mt-1">
        <span className="font-semibold">{t.popup.services}</span>{' '}
        {props.canPickup && <span>{t.popup.pickup}</span>}
        {props.canPickup && props.canDropoff && ' / '}
        {props.canDropoff && <span>{t.popup.dropoff}</span>}
        {!props.canPickup && !props.canDropoff && <span className="text-subtle-foreground">{t.common.unknown}</span>}
      </p>
      <p className="text-xs text-subtle-foreground mt-1">
        {props.latitude.toFixed(6)}, {props.longitude.toFixed(6)}
      </p>

      <OpeningTimes value={props.openingstijden} />

      <div className="mt-3 border-t pt-2">
        <details>
          <summary className="flex justify-between items-baseline gap-3 cursor-pointer select-none">
            <span className="text-xs font-semibold text-primary hover:text-primary">
              {t.popup.showRawData}
            </span>
            <a
              href={`https://www.google.com/maps?q=&layer=c&cbll=${props.latitude},${props.longitude}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-primary hover:text-primary underline whitespace-nowrap"
              onClick={(e) => e.stopPropagation()}
            >
              {t.popup.streetView}
            </a>
          </summary>
          <div className="mt-2">
            <pre className="p-3 bg-muted border border-border rounded text-xs overflow-x-auto max-h-64 whitespace-pre-wrap break-words">
              {JSON.stringify(props, null, 2)}
            </pre>
          </div>
        </details>
      </div>
    </div>
  );
}

/**
 * Popup for a national-view point: those carry only a summary (lib/pointData),
 * so the full record is fetched from the point's municipality file first.
 */
function SummaryPointPopup({ summary }: { summary: PakketpuntProperties }) {
  const [details, setDetails] = useState<PakketpuntProperties | null>(null);
  useEffect(() => {
    let current = true;
    loadPointDetails(summary)
      .then((props) => { if (current) setDetails(props); })
      .catch(() => { if (current) setDetails(summary); });
    return () => { current = false; };
  }, [summary]);
  if (!details) return <div className="text-sm text-subtle-foreground">{t.common.loading}</div>;
  return <PointPopupContent props={details} />;
}

interface MapProps {
  data?: PakketpuntData | null;
  filters?: Filters;
  targetCoordinates?: { latitude: number; longitude: number } | null;
  onZoomedToTarget?: () => void;
  searchLocationMarker?: { latitude: number; longitude: number } | null;
  highlightedPoints?: Set<string> | null; // Set of "lat,lng" keys for highlighted points
  onTilesLoading?: (loading: boolean) => void;
}

// Component to fit bounds when data changes (only once, not on every zoom/pan)
// Also handles fallback center when no bounds are available (e.g., 0 pakketpunten)
// Also handles targetCoordinates and searchLocationMarker for zooming to specific locations
function FitBounds({
  bounds,
  fallbackCenter,
  targetCoordinates,
  searchLocationMarker,
  onZoomedToTarget
}: {
  bounds: LatLngBoundsExpression | null;
  fallbackCenter: [number, number] | null;
  targetCoordinates?: { latitude: number; longitude: number } | null;
  searchLocationMarker?: { latitude: number; longitude: number } | null;
  onZoomedToTarget?: () => void;
}) {
  const map = useMap();
  const lastBoundsRef = useRef<string | null>(null);
  const lastTargetRef = useRef<{ latitude: number; longitude: number } | null>(null);
  const lastSearchLocationRef = useRef<{ latitude: number; longitude: number } | null>(null);
  // Timestamp of last zoom to specific location - ignore bounds fitting for 2 seconds after
  const lastZoomTimestampRef = useRef<number>(0);

  // Handle target coordinates (clicking on a result) - always zoom when new coordinates are provided
  useEffect(() => {
    if (targetCoordinates) {
      const isNewTarget = !lastTargetRef.current ||
        lastTargetRef.current.latitude !== targetCoordinates.latitude ||
        lastTargetRef.current.longitude !== targetCoordinates.longitude;

      if (isNewTarget) {
        console.log('FitBounds: Zooming to target coordinates', targetCoordinates);
        lastZoomTimestampRef.current = Date.now(); // Mark zoom time
        map.setView([targetCoordinates.latitude, targetCoordinates.longitude], 17, { animate: true });
        lastTargetRef.current = targetCoordinates;

        setTimeout(() => {
          if (onZoomedToTarget) {
            onZoomedToTarget();
          }
        }, 1000);
      }
    }
  }, [targetCoordinates, map, onZoomedToTarget]);

  // Handle search location marker - zoom to search location
  useEffect(() => {
    if (searchLocationMarker) {
      const isNewLocation = !lastSearchLocationRef.current ||
        lastSearchLocationRef.current.latitude !== searchLocationMarker.latitude ||
        lastSearchLocationRef.current.longitude !== searchLocationMarker.longitude;

      if (isNewLocation) {
        console.log('FitBounds: Zooming to search location', searchLocationMarker);
        lastZoomTimestampRef.current = Date.now(); // Mark zoom time
        map.setView([searchLocationMarker.latitude, searchLocationMarker.longitude], 15, { animate: true });
        lastSearchLocationRef.current = searchLocationMarker;
      }
    } else {
      // Clear the ref when search is cleared
      lastSearchLocationRef.current = null;
    }
  }, [searchLocationMarker, map]);

  // Handle initial bounds fit (only when NO specific location zoom has occurred recently)
  useEffect(() => {
    // Skip if we zoomed to a specific location within the last 2 seconds
    const timeSinceZoom = Date.now() - lastZoomTimestampRef.current;
    if (timeSinceZoom < 2000) {
      console.log('FitBounds: Skipping bounds fit - recently zoomed to specific location');
      return;
    }

    // NEVER fit bounds if search location is active
    if (searchLocationMarker) {
      console.log('FitBounds: Skipping bounds fit - search location active');
      return;
    }

    // Don't fit bounds if we have target coordinates
    if (targetCoordinates) {
      console.log('FitBounds: Skipping bounds fit - target coordinates active');
      return;
    }

    // Create a string key for current bounds to track changes
    const boundsKey = bounds ? JSON.stringify(bounds) : (fallbackCenter ? `center-${fallbackCenter.join(',')}` : null);

    // Only fit if bounds actually changed
    if (boundsKey && boundsKey !== lastBoundsRef.current) {
      if (bounds) {
        console.log('FitBounds: Fitting to municipality bounds');
        map.fitBounds(bounds, { padding: [50, 50] });
      } else if (fallbackCenter) {
        console.log('FitBounds: Using fallback center');
        map.setView(fallbackCenter, 13, { animate: true });
      }
      lastBoundsRef.current = boundsKey;
    }
  }, [bounds, fallbackCenter, targetCoordinates, searchLocationMarker, map]);

  return null;
}

// Component to watch zoom level for performance optimization
function ZoomWatcher({ onZoomChange }: { onZoomChange: (zoom: number) => void }) {
  const map = useMap();

  useEffect(() => {
    const handleZoom = () => {
      onZoomChange(map.getZoom());
    };

    map.on('zoomend', handleZoom);
    // Set initial zoom
    onZoomChange(map.getZoom());

    return () => {
      map.off('zoomend', handleZoom);
    };
  }, [map, onZoomChange]);

  return null;
}

// Reports the visible map area after every pan or zoom
function ViewportWatcher({ onViewportChange }: { onViewportChange: (bounds: L.LatLngBounds) => void }) {
  const map = useMap();

  useEffect(() => {
    const handleMove = () => onViewportChange(map.getBounds());
    map.on('moveend', handleMove);
    handleMove();
    return () => {
      map.off('moveend', handleMove);
    };
  }, [map, onViewportChange]);

  return null;
}

// Component to add scale control (distance legend)
function ScaleControl() {
  const map = useMap();

  useEffect(() => {
    const scale = L.control.scale({
      position: 'bottomleft',
      metric: true,
      imperial: false,
      maxWidth: 150,
    });

    scale.addTo(map);

    return () => {
      scale.remove();
    };
  }, [map]);

  return null;
}

/**
 * Per-carrier drawing info, assembled from the shared source in lib/carriers.
 *
 * `background`/`borderColor` are the real livery and are only ever seen behind
 * a logo. `color` is the validated series colour, used for the bare circle
 * markers this map falls back to above SIMPLE_MARKER_THRESHOLD points — there
 * no logo is drawn, so the colour is doing the identifying and the liveries
 * (three near-identical yellows) would not survive it.
 */
const PROVIDER_INFO: Record<string, {
  background: string;
  logoUrl: string;
  borderColor?: string;
  color: string; // For simple circle markers
}> = Object.fromEntries(
  CARRIER_ORDER.map((carrier) => [
    carrier,
    { ...CARRIER_BRAND[carrier], color: CARRIER_SERIES_COLORS[carrier] },
  ])
);

const providerColor = (carrier: string) => PROVIDER_INFO[carrier]?.color || '#666';

// Performance thresholds
/**
 * Coverage layers, largest first. Each gets its own pane with a fixed z-order
 * (largest lowest), so smaller circles stay on top whichever was switched on
 * last. 500 m is a dashed indigo, and the 400 m fill is a touch darker than
 * blue-300 so it stands out against the 500 m fill when both are on.
 */
const BUFFER_LAYERS = [
  { radius: 500, filter: 'showBuffer500', color: '#6366f1', fillColor: '#a5b4fc', weight: 2, dashArray: '6 6', mergedFillOpacity: 0.20, circleFillOpacity: 0.06 },
  { radius: 400, filter: 'showBuffer400', color: '#60a5fa', fillColor: '#80b6fa', weight: 3, dashArray: undefined, mergedFillOpacity: 0.30, circleFillOpacity: 0.10 },
  { radius: 300, filter: 'showBuffer300', color: '#2563eb', fillColor: '#3b82f6', weight: 2, dashArray: undefined, mergedFillOpacity: 0.25, circleFillOpacity: 0.08 },
] as const;

const PERFORMANCE_CONFIG = {
  // Use simple circles instead of custom icons above this marker count
  SIMPLE_MARKER_THRESHOLD: 3000,
  // Zoom threshold for switching between simple and detailed view
  DETAILED_VIEW_ZOOM: 11,
  // Simple marker size
  SIMPLE_MARKER_RADIUS: 4,
  // Simple marker opacity
  SIMPLE_MARKER_OPACITY: 0.8,
  // National view with logo markers chosen: logos once at most this many points are in view
  NATIONAL_DETAIL_LIMIT: 300,
};

// Helper function to calculate marker size based on zoom level
function getMarkerSize(zoom: number): { size: number; logoSize: number; fontSize: number } {
  // At zoom 15+ (below 1km scale), increase marker size for better clickability
  if (zoom >= 17) {
    return { size: 48, logoSize: 32, fontSize: 14 }; // 250m scale and closer
  } else if (zoom >= 15) {
    return { size: 42, logoSize: 28, fontSize: 12 }; // 1km - 500m scale
  } else {
    return { size: 34, logoSize: 22, fontSize: 10 }; // Default size
  }
}

// Create custom icon for each provider with dynamic sizing and service indicators
function createProviderIcon(provider: string, zoom: number, canPickup?: boolean, canDropoff?: boolean, grayed?: boolean) {
  const info = PROVIDER_INFO[provider] || {
    background: '#666',
    logoUrl: '',
  };

  const borderColor = grayed ? '#9ca3af' : (info.borderColor || 'white');
  const { size, logoSize, fontSize } = getMarkerSize(zoom);

  // Reduce size for grayed markers
  const actualSize = grayed ? size * 0.85 : size;
  const actualLogoSize = grayed ? logoSize * 0.85 : logoSize;

  // Generate service indicator arrows (only for highlighted markers)
  const arrowSize = Math.max(10, size * 0.28);

  // Show arrows only when one service is available (not both) and not grayed
  const showPickupArrow = !grayed && canPickup && !canDropoff;
  const showDropoffArrow = !grayed && canDropoff && !canPickup;

  const pickupArrow = showPickupArrow ? `
    <div style="
      position: absolute;
      bottom: -${arrowSize * 0.3}px;
      left: 50%;
      transform: translateX(-50%);
      width: ${arrowSize}px;
      height: ${arrowSize}px;
      background: #2563eb;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 1px 3px rgba(0,0,0,0.3);
      border: 1.5px solid white;
    ">
      <svg width="${arrowSize * 0.6}" height="${arrowSize * 0.6}" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3">
        <path d="M12 5v14M5 12l7 7 7-7"/>
      </svg>
    </div>
  ` : '';

  const dropoffArrow = showDropoffArrow ? `
    <div style="
      position: absolute;
      top: -${arrowSize * 0.3}px;
      left: 50%;
      transform: translateX(-50%);
      width: ${arrowSize}px;
      height: ${arrowSize}px;
      background: #2563eb;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 1px 3px rgba(0,0,0,0.3);
      border: 1.5px solid white;
    ">
      <svg width="${arrowSize * 0.6}" height="${arrowSize * 0.6}" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3">
        <path d="M12 19V5M5 12l7-7 7 7"/>
      </svg>
    </div>
  ` : '';

  // Grayscale and opacity filter for non-highlighted markers
  const filterStyle = grayed ? 'filter: grayscale(100%); opacity: 0.5;' : '';

  return L.divIcon({
    className: 'custom-marker',
    html: `
      <div style="position: relative; width: ${actualSize}px; height: ${actualSize}px; ${filterStyle}">
        <div style="
          width: ${actualSize}px;
          height: ${actualSize}px;
          background: white;
          border: 2.5px solid ${borderColor};
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 3px 8px rgba(0,0,0,${grayed ? '0.2' : '0.4'});
          overflow: hidden;
        ">
          <img
            src="${info.logoUrl}"
            alt="${provider}"
            style="
              width: ${actualLogoSize}px;
              height: ${actualLogoSize}px;
              object-fit: contain;
            "
            onerror="this.style.display='none'; const div = document.createElement('div'); div.textContent='${provider.substring(0, 2)}'; div.style.cssText='font-size:${fontSize}px;font-weight:bold;color:${info.background}'; this.parentElement.appendChild(div);"
          />
        </div>
        ${pickupArrow}
        ${dropoffArrow}
      </div>
    `,
    iconSize: [size, size + arrowSize],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
  });
}

// Create custom icon with badge for grouped markers
function createProviderIconWithBadge(provider: string, count: number) {
  const info = PROVIDER_INFO[provider] || {
    background: '#666',
    logoUrl: '',
  };

  const borderColor = info.borderColor || 'white';

  return L.divIcon({
    className: 'custom-marker',
    html: `
      <div style="position: relative;">
        <div style="
          width: 34px;
          height: 34px;
          background: white;
          border: 2.5px solid ${borderColor};
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 3px 8px rgba(0,0,0,0.4);
          overflow: hidden;
        ">
          <img
            src="${info.logoUrl}"
            alt="${provider}"
            style="
              width: 22px;
              height: 22px;
              object-fit: contain;
            "
            onerror="this.style.display='none'; const div = document.createElement('div'); div.textContent='${provider.substring(0, 2)}'; div.style.cssText='font-size:10px;font-weight:bold;color:${info.background}'; this.parentElement.appendChild(div);"
          />
        </div>
        <div style="
          position: absolute;
          top: -6px;
          right: -6px;
          background: #dc2626;
          color: white;
          border: 2px solid white;
          border-radius: 50%;
          width: 20px;
          height: 20px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 11px;
          font-weight: bold;
          box-shadow: 0 2px 4px rgba(0,0,0,0.3);
        ">
          ${count}
        </div>
      </div>
    `,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    popupAnchor: [0, -17],
  });
}

// Create custom icon for search location marker (blue pin)
function createSearchLocationIcon() {
  return L.divIcon({
    className: 'search-location-marker',
    html: `
      <div style="
        width: 32px;
        height: 32px;
        position: relative;
      ">
        <div style="
          width: 24px;
          height: 24px;
          background: #2563eb;
          border: 3px solid white;
          border-radius: 50%;
          box-shadow: 0 3px 8px rgba(0,0,0,0.4);
          position: absolute;
          top: 0;
          left: 4px;
        "></div>
        <div style="
          width: 0;
          height: 0;
          border-left: 8px solid transparent;
          border-right: 8px solid transparent;
          border-top: 12px solid #2563eb;
          position: absolute;
          bottom: 0;
          left: 8px;
          filter: drop-shadow(0 2px 2px rgba(0,0,0,0.3));
        "></div>
      </div>
    `,
    iconSize: [32, 32],
    iconAnchor: [16, 32],
    popupAnchor: [0, -32],
  });
}

// Helper function to get current hour-based seed for stable randomization
function getHourlySeed(): number {
  const now = new Date();
  // Change seed every hour (year + month + day + hour)
  return now.getFullYear() * 1000000 +
         (now.getMonth() + 1) * 10000 +
         now.getDate() * 100 +
         now.getHours();
}

// Simple seeded random number generator
function seededRandom(seed: number): number {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

// Helper function to get provider render priority (higher = renders on top)
// Randomizes order hourly to give all providers fair visibility
function getProviderPriority(vervoerder: string): number {
  const providers: readonly string[] = CARRIER_ORDER;

  // Get hourly seed for stable randomization
  const seed = getHourlySeed();

  // Create shuffled priorities based on hourly seed
  const shuffledPriorities: Record<string, number> = {};
  const availablePositions = providers.map((_, index) => index + 1);

  providers.forEach((provider, index) => {
    // Use provider name + seed to create unique seed per provider
    const providerSeed = seed + provider.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const randomValue = seededRandom(providerSeed);

    // Pick a position based on random value
    const positionIndex = Math.floor(randomValue * availablePositions.length);
    const position = availablePositions.splice(positionIndex, 1)[0];
    shuffledPriorities[provider] = position;
  });

  return shuffledPriorities[vervoerder] || 0;
}

// Helper function to spread overlapping markers (spiderfy effect)
// Points in render order: lowest priority first (bottom layer)
function sortByProviderPriority(points: PakketpuntFeature[]): PakketpuntFeature[] {
  const priority = new Map<string, number>();
  const prio = (f: PakketpuntFeature) => {
    const carrier = (f.properties as PakketpuntProperties).vervoerder;
    let p = priority.get(carrier);
    if (p === undefined) {
      p = getProviderPriority(carrier);
      priority.set(carrier, p);
    }
    return p;
  };
  return [...points].sort((a, b) => prio(a) - prio(b));
}

function spreadOverlappingMarkers(points: PakketpuntFeature[], currentZoom: number) {
  const sortedPoints = sortByProviderPriority(points);

  if (currentZoom < 15) {
    // Below zoom 15, return sorted points as-is
    return sortedPoints.map(p => ({ ...p, offsetLat: 0, offsetLng: 0 }));
  }

  // Group by exact coordinates (using sorted points)
  const groups = new Map<string, PakketpuntFeature[]>();
  sortedPoints.forEach((point) => {
    const coords = point.geometry.coordinates as [number, number];
    const key = `${coords[1].toFixed(6)},${coords[0].toFixed(6)}`;
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(point);
  });

  // Spread overlapping markers in a circle
  const spreadMarkers: any[] = [];
  groups.forEach((group) => {
    if (group.length === 1) {
      // Single marker, no offset needed
      spreadMarkers.push({ ...group[0], offsetLat: 0, offsetLng: 0 });
    } else {
      // Multiple markers at same location - spread in circle
      const radius = 0.00015; // ~15 meters offset
      group.forEach((marker, index) => {
        const angle = (2 * Math.PI * index) / group.length;
        const offsetLat = Math.sin(angle) * radius;
        const offsetLng = Math.cos(angle) * radius;
        spreadMarkers.push({ ...marker, offsetLat, offsetLng });
      });
    }
  });

  return spreadMarkers;
}

function MapComponent(props?: MapProps) {
  // Hooks MUST be at the very top
  const [mounted, setMounted] = useState(false);
  const [currentZoom, setCurrentZoom] = useState(12);
  const [viewBounds, setViewBounds] = useState<L.LatLngBounds | null>(null);
  // Precomputed national coverage per radius, fetched on first use
  const [nationalCoverage, setNationalCoverage] = useState<Record<number, GeoJSONFeatureCollection>>({});
  // Map.tsx only renders client-side (dynamic import, ssr: false), so storage is readable here
  const [basemapId, setBasemapId] = useState<BasemapId>(loadBasemap);
  // National view: the clicked point, whose popup loads its details
  const [selectedPoint, setSelectedPoint] = useState<{ slug: string; props: PakketpuntProperties; latlng: [number, number] } | null>(null);

  // Extract props with defaults AFTER hooks
  const data = props?.data ?? null;
  const targetCoordinates = props?.targetCoordinates ?? null;
  const onZoomedToTarget = props?.onZoomedToTarget;
  const onTilesLoading = props?.onTilesLoading;
  const searchLocationMarker = props?.searchLocationMarker ?? null;
  const highlightedPoints = props?.highlightedPoints ?? null;
  const activeFilters: Filters = props?.filters ?? {
    providers: [],
    showBuffer300: true,
    showBuffer400: true,
    showBuffer500: true,
    showBufferFill: true,
    bufferMerged: true,
    showBoundary: false,
    useSimpleMarkers: false,
    minOccupancy: 0,
    maxOccupancy: 100,
    showMockData: false,
    pointCategories: ['locker', 'shop'],
    showOnlySharedLocations: false,
    serviceFilters: ['pickup', 'dropoff'],
  };

  useEffect(() => {
    setMounted(true);
  }, []);

  // Helper to check if point matches service filters
  const matchesServiceFilters = (props: PakketpuntProperties): boolean => {
    const wantsPickup = activeFilters.serviceFilters.includes('pickup');
    const wantsDropoff = activeFilters.serviceFilters.includes('dropoff');

    // If both filters selected, show locations that support at least one
    if (wantsPickup && wantsDropoff) {
      return props.canPickup || props.canDropoff;
    } else if (wantsPickup) {
      return props.canPickup;
    } else if (wantsDropoff) {
      return props.canDropoff;
    }
    return false; // No service filters selected
  };

  // Filter features based on selected filters (do this before early returns to maintain hook order)
  const filteredFeatures = useMemo(() => {
    if (!data) return [];
    return data.features.filter((feature) => {
    if (feature.properties.type === 'pakketpunt') {
      const props = feature.properties as PakketpuntProperties;

      // Provider filter
      if (!activeFilters.providers.includes(props.vervoerder)) {
        return false;
      }

      // Point category filter (locker vs shop)
      const category = getPointCategory(props.puntType);
      if (!activeFilters.pointCategories.includes(category)) {
        return false;
      }

      // Service capability filter (pickup vs dropoff)
      if (!matchesServiceFilters(props)) {
        return false;
      }

      return true;
    }

    // Skip pre-computed buffer unions (buffers are now rendered dynamically per point)
    if (feature.properties.type === 'buffer_union_300m' || feature.properties.type === 'buffer_union_400m') {
      return false;
    }

    // Boundary filter
    if (feature.properties.type === 'boundary') {
      return activeFilters.showBoundary;
    }

    return true;
    });
  }, [data, activeFilters.providers, activeFilters.pointCategories, activeFilters.serviceFilters, activeFilters.showBoundary]);

  // Separate points, buffers, and boundaries
  const points = useMemo(() => {
    const allPoints = filteredFeatures.filter(f => f.properties.type === 'pakketpunt');

    // If not filtering for shared locations, return all points
    if (!activeFilters.showOnlySharedLocations) {
      return allPoints;
    }

    // Group by coordinates to find shared locations
    const coordGroups = new Map<string, PakketpuntFeature[]>();
    allPoints.forEach((feature) => {
      const coords = feature.geometry.coordinates as [number, number];
      const key = `${coords[1].toFixed(6)},${coords[0].toFixed(6)}`;
      if (!coordGroups.has(key)) {
        coordGroups.set(key, []);
      }
      coordGroups.get(key)!.push(feature);
    });

    // Only keep points at shared locations (2+ points at same coordinates)
    const sharedPoints: PakketpuntFeature[] = [];
    coordGroups.forEach((group) => {
      if (group.length >= 2) {
        sharedPoints.push(...group);
      }
    });

    return sharedPoints;
  }, [filteredFeatures, activeFilters.showOnlySharedLocations]);
  const boundaries = useMemo(() =>
    filteredFeatures.filter(f => f.properties.type === 'boundary'),
    [filteredFeatures]
  );

  // Pairwise merge: union polygons in pairs recursively (O(n log n) complexity growth vs O(n²) sequential)
  const pairwiseUnion = (features: any[]): any => {
    if (features.length === 0) return null;
    if (features.length === 1) return features[0];
    const next: any[] = [];
    for (let i = 0; i < features.length; i += 2) {
      if (i + 1 < features.length) {
        const result = union(featureCollection([features[i], features[i + 1]]));
        next.push(result ?? features[i]);
      } else {
        next.push(features[i]);
      }
    }
    return pairwiseUnion(next);
  };

  // The national view with every filter at its default shows the coverage the
  // pipeline precomputed for all points (scripts/create_national_coverage.py)
  // instead of drawing it: live, all of Belgium takes 30-40 s per radius.
  const nationalCoverageActive =
    data?.metadata.slug === COUNTRY.nationalSlug &&
    usesNationalCoverage(activeFilters, data?.metadata.providers ?? []);

  const wantedNationalRadii = nationalCoverageActive
    ? BUFFER_LAYERS.filter((layer) => activeFilters[layer.filter]).map((layer) => layer.radius).join(',')
    : '';

  // Radii already requested: the effect reruns as each one lands, and would
  // otherwise fetch the ones still in flight again (tens of MB for Italy)
  const requestedCoverage = useRef(new Set<number>());
  useEffect(() => {
    if (!wantedNationalRadii) return;
    for (const radius of wantedNationalRadii.split(',').map(Number)) {
      if (nationalCoverage[radius] || requestedCoverage.current.has(radius)) continue;
      requestedCoverage.current.add(radius);
      fetch(`/data/geo/coverage_${radius}.geojson`)
        .then((res) => (res.ok ? res.json() : null))
        .then((json) => {
          if (json) setNationalCoverage((loaded) => ({ ...loaded, [radius]: json }));
          else requestedCoverage.current.delete(radius);
        })
        .catch((err) => {
          requestedCoverage.current.delete(radius);
          console.error(`Loading national coverage ${radius} m failed:`, err);
        });
    }
  }, [wantedNationalRadii, nationalCoverage]);

  // Points that get coverage circles. A municipality draws them for all its
  // points; above MAX_BUFFER_POINTS (the national view) only for the points in
  // and just around the viewport, and none until that is at most the limit.
  // The selection is a string of point indices, so a pan that keeps the same
  // points yields an equal string and the Turf unions below are not recomputed.
  const bufferSelection = useMemo(() => {
    if (nationalCoverageActive) return '';
    if (points.length <= MAX_BUFFER_POINTS) return 'all';
    if (!viewBounds) return '';
    // Pad so a circle whose point is just off-screen still shows its edge
    const area = viewBounds.pad(0.1);
    const indices: number[] = [];
    points.forEach((f, i) => {
      const [lng, lat] = f.geometry.coordinates as [number, number];
      if (area.contains([lat, lng])) indices.push(i);
    });
    return indices.length > 0 && indices.length <= MAX_BUFFER_POINTS ? indices.join(',') : '';
  }, [points, viewBounds, nationalCoverageActive]);

  const bufferPoints = useMemo(() => {
    if (bufferSelection === 'all') return points;
    if (bufferSelection === '') return [];
    return bufferSelection.split(',').map((i) => points[Number(i)]);
  }, [points, bufferSelection]);

  // react-leaflet's GeoJSON ignores new `data`; a key per point set forces a redraw
  const bufferKey = useMemo(() => {
    let hash = 0;
    for (let i = 0; i < bufferSelection.length; i++) {
      hash = (hash * 31 + bufferSelection.charCodeAt(i)) | 0;
    }
    return `${bufferPoints.length}-${hash}`;
  }, [bufferSelection, bufferPoints.length]);

  // Which coverage layers are switched on, e.g. "500,300"
  const enabledRadii = BUFFER_LAYERS.filter((layer) => activeFilters[layer.filter])
    .map((layer) => layer.radius).join(',');

  // Merged buffer union polygons per enabled radius, from the buffer points (Turf.js)
  const mergedBuffers = useMemo(() => {
    const result: Record<number, GeoJSONFeature> = {};
    if (!activeFilters.bufferMerged || bufferPoints.length === 0 || !enabledRadii) return result;
    const pts = featureCollection(
      bufferPoints.map(f => point(f.geometry.coordinates as [number, number]))
    );
    for (const radius of enabledRadii.split(',').map(Number)) {
      try {
        const buffered = buffer(pts, radius / 1000, { units: 'kilometers', steps: 4 });
        if (buffered && buffered.features.length > 0) {
          result[radius] = pairwiseUnion(buffered.features);
        }
      } catch { /* leave this radius out */ }
    }
    return result;
  }, [bufferPoints, activeFilters.bufferMerged, enabledRadii]);

  // The national view's points are summaries (lib/pointData), drawn on one
  // canvas (PointsCanvasLayer) instead of a React component per point
  const summaryView = useMemo(() => {
    const first = data?.features.find((f) => f.properties.type === 'pakketpunt');
    return !!first && isSummaryPoint(first.properties as PakketpuntProperties);
  }, [data]);

  const canvasPoints = useMemo(
    () => (summaryView ? sortByProviderPriority(points) : []),
    [summaryView, points]
  );

  // Logo markers in the national view: only for the points in view, and only
  // when those are few enough (otherwise the canvas dots)
  const nationalDetailPoints = useMemo(() => {
    if (!summaryView || activeFilters.useSimpleMarkers || !viewBounds) return null;
    const inView: PakketpuntFeature[] = [];
    for (const f of canvasPoints) {
      const [lng, lat] = f.geometry.coordinates as [number, number];
      if (viewBounds.contains([lat, lng])) {
        inView.push(f);
        if (inView.length > PERFORMANCE_CONFIG.NATIONAL_DETAIL_LIMIT) return null;
      }
    }
    return inView;
  }, [summaryView, activeFilters.useSimpleMarkers, viewBounds, canvasPoints]);

  // Group markers by exact coordinates and spread them at high zoom (manual spiderfy)
  const spreadPoints = useMemo(
    () => (summaryView ? spreadOverlappingMarkers(nationalDetailPoints ?? [], currentZoom) : spreadOverlappingMarkers(points, currentZoom)),
    [summaryView, nationalDetailPoints, points, currentZoom]
  );

  // Calculate bounds from metadata
  const bounds: LatLngBoundsExpression | null = useMemo(() => {
    if (!data) return null;

    // Validate bounds array exists and has 4 valid numbers
    const metadataBounds = data.metadata.bounds;
    if (!metadataBounds ||
        metadataBounds.length !== 4 ||
        metadataBounds.some((b: any) => b === null || b === undefined || isNaN(b))) {
      console.warn(`Invalid or empty bounds for ${data.metadata.gemeente}, will use boundary centroid`);
      return null; // Will try to use boundary centroid instead
    }

    return [
      [metadataBounds[1], metadataBounds[0]], // [miny, minx]
      [metadataBounds[3], metadataBounds[2]], // [maxy, maxx]
    ];
  }, [data]);

  // Calculate fallback center from boundary polygon when bounds are invalid
  const fallbackCenter: [number, number] | null = useMemo(() => {
    if (!data || bounds) return null; // Only use if bounds are invalid

    // Look for boundary feature in the data
    const boundaryFeature = data.features.find(
      (f: any) => f.properties?.type === 'boundary'
    );

    if (boundaryFeature?.geometry?.coordinates) {
      try {
        // Calculate centroid of the boundary polygon
        const coords = boundaryFeature.geometry.coordinates;

        // Handle MultiPolygon or Polygon
        const rings = boundaryFeature.geometry.type === 'MultiPolygon'
          ? coords.flat()
          : coords;

        // Get outer ring (first ring)
        const outerRing = rings[0];

        if (outerRing && Array.isArray(outerRing) && outerRing.length > 0) {
          // Calculate simple centroid
          let sumLat = 0;
          let sumLon = 0;
          let count = 0;

          for (const point of outerRing) {
            if (Array.isArray(point) && point.length >= 2) {
              sumLon += point[0];
              sumLat += point[1];
              count++;
            }
          }

          if (count > 0) {
            const center: [number, number] = [sumLat / count, sumLon / count];
            console.log(`Using boundary centroid for ${data.metadata.gemeente}: [${center[0].toFixed(4)}, ${center[1].toFixed(4)}]`);
            return center;
          }
        }
      } catch (e) {
        console.error(`Failed to calculate boundary centroid for ${data.metadata.gemeente}:`, e);
      }
    }

    return null;
  }, [data, bounds]);

  // Use simple markers based on user preference from filters
  const useSimpleMarkers = activeFilters.useSimpleMarkers;

  // Helper to check if a point is highlighted
  const isPointHighlighted = (props: PakketpuntProperties): boolean => {
    if (!highlightedPoints) return true; // No highlight filter = all highlighted
    const key = `${props.latitude.toFixed(6)},${props.longitude.toFixed(6)}`;
    return highlightedPoints.has(key);
  };

  // Memoize marker rendering to prevent unnecessary re-renders
  const markerElements = useMemo(() => {
    if (spreadPoints.length === 0) return null;

    if (useSimpleMarkers) {
      // Render simple colored circles for performance
      // Scale radius based on zoom level
      const circleRadius = currentZoom >= 17 ? 6 : currentZoom >= 15 ? 5 : PERFORMANCE_CONFIG.SIMPLE_MARKER_RADIUS;

      return spreadPoints.map((feature, idx) => {
        const props = feature.properties as PakketpuntProperties;
        const coords = feature.geometry.coordinates as [number, number];
        const baseColor = PROVIDER_INFO[props.vervoerder]?.color || '#666';
        const isHighlighted = isPointHighlighted(props);

        // Gray out non-highlighted points
        const color = isHighlighted ? baseColor : '#9ca3af';
        const opacity = isHighlighted ? PERFORMANCE_CONFIG.SIMPLE_MARKER_OPACITY : 0.4;

        // Apply offset for spiderfy effect at high zoom
        const lat = coords[1] + (feature.offsetLat || 0);
        const lng = coords[0] + (feature.offsetLng || 0);

        return (
          <CircleMarker
            key={`point-${idx}`}
            center={[lat, lng]}
            radius={isHighlighted ? circleRadius : circleRadius - 1}
            pathOptions={{
              fillColor: color,
              fillOpacity: opacity,
              color: isHighlighted ? 'white' : '#d1d5db',
              weight: 1,
            }}
          >
            <Popup
              maxWidth={600}
              minWidth={300}
              autoPan={false}
            >
              {isSummaryPoint(props) ? <SummaryPointPopup summary={props} /> : <PointPopupContent props={props} />}
            </Popup>
          </CircleMarker>
        );
      });
    } else {
      // Render detailed branded markers
      return spreadPoints.map((feature, idx) => {
        const props = feature.properties as PakketpuntProperties;
        const coords = feature.geometry.coordinates as [number, number];
        const isHighlighted = isPointHighlighted(props);

        // Apply offset for spiderfy effect at high zoom
        const lat = coords[1] + (feature.offsetLat || 0);
        const lng = coords[0] + (feature.offsetLng || 0);

        return (
          <Marker
            key={`point-${idx}`}
            position={[lat, lng]}
            icon={createProviderIcon(props.vervoerder, currentZoom, props.canPickup, props.canDropoff, !isHighlighted)}
            zIndexOffset={isHighlighted ? 1000 : 0}
          >
            <Popup
              maxWidth={600}
              minWidth={300}
              autoPan={false}
            >
              {isSummaryPoint(props) ? <SummaryPointPopup summary={props} /> : <PointPopupContent props={props} />}
            </Popup>
          </Marker>
        );
      });
    }
  }, [spreadPoints, useSimpleMarkers, currentZoom, highlightedPoints]);

  // Render spider leg lines connecting offset markers to original location
  const spiderLegLines = useMemo(() => {
    if (currentZoom < 15) return null; // Only show at high zoom levels

    return spreadPoints
      .filter(feature => feature.offsetLat !== 0 || feature.offsetLng !== 0) // Only for offset markers
      .map((feature, idx) => {
        const coords = feature.geometry.coordinates as [number, number];
        const originalPos: [number, number] = [coords[1], coords[0]];
        const offsetPos: [number, number] = [
          coords[1] + feature.offsetLat,
          coords[0] + feature.offsetLng
        ];

        return (
          <Polyline
            key={`spider-leg-${idx}`}
            positions={[originalPos, offsetPos]}
            pathOptions={{
              color: '#3b82f6', // Blue color matching marker-cluster.css
              weight: 2,
              opacity: 0.6,
            }}
          />
        );
      });
  }, [spreadPoints, currentZoom]);

  // Early returns AFTER all hooks to maintain hook order
  if (!mounted) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-secondary">
        <p className="text-subtle-foreground">{t.common.mapLoading}</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-secondary">
        <div className="flex flex-col items-center gap-3">
          <svg className="animate-spin h-10 w-10 text-subtle-foreground" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <p className="text-sm font-medium text-subtle-foreground">{t.common.municipalityLoading}</p>
        </div>
      </div>
    );
  }

  // Check if municipality has 0 pakketpunten
  const hasNoPakketpunten = points.length === 0;

  return (
    <div className="relative w-full h-full">
      <MapContainer
        key={`map-${useSimpleMarkers ? 'simple' : 'detailed'}`} // Force remount when rendering mode changes
        center={COUNTRY.defaultCenter}
        zoom={COUNTRY.defaultZoom}
        style={{ width: '100%', height: '100%' }}
        className="z-0"
        preferCanvas={useSimpleMarkers} // Use Canvas renderer for better performance
        zoomControl={false}
      >
      <ZoomControl position="topright" />
      <BasemapLayer basemapId={basemapId} onTilesLoading={onTilesLoading} />

      <FitBounds
        bounds={bounds}
        fallbackCenter={fallbackCenter}
        targetCoordinates={targetCoordinates}
        searchLocationMarker={searchLocationMarker}
        onZoomedToTarget={onZoomedToTarget}
      />
      <ZoomWatcher onZoomChange={setCurrentZoom} />
      <ViewportWatcher onViewportChange={setViewBounds} />
      <ScaleControl />

      {/* Buffer zones - merged union polygons or individual circles, one pane per
          radius, largest lowest (below the overlay pane's 400, above tiles) */}
      {BUFFER_LAYERS.map((layer, index) => (
        <Pane key={`coverage-${layer.radius}`} name={`coverage-${layer.radius}`} style={{ zIndex: 380 + index }}>
        {nationalCoverageActive && activeFilters[layer.filter] && nationalCoverage[layer.radius] && (
          <GeoJSON
            key={`coverage-national-${layer.radius}-fill${activeFilters.showBufferFill}`}
            data={nationalCoverage[layer.radius]}
            style={() => ({
              color: layer.color,
              fillColor: layer.fillColor,
              weight: layer.weight,
              dashArray: layer.dashArray,
              fillOpacity: activeFilters.showBufferFill ? layer.mergedFillOpacity : 0,
              opacity: 1,
            })}
          />
        )}
        {bufferPoints.length > 0 && activeFilters[layer.filter] && (activeFilters.bufferMerged ? (
          mergedBuffers[layer.radius] ? (
            <GeoJSON
              key={`buffer${layer.radius}-merged-${data?.metadata?.slug}-${bufferKey}-fill${activeFilters.showBufferFill}`}
              data={mergedBuffers[layer.radius]}
              style={() => ({
                color: layer.color,
                fillColor: layer.fillColor,
                weight: layer.weight,
                dashArray: layer.dashArray,
                fillOpacity: activeFilters.showBufferFill ? layer.mergedFillOpacity : 0,
                opacity: 1,
              })}
            />
          ) : null
        ) : (
          bufferPoints.map((feature, idx) => {
            const coords = feature.geometry.coordinates as [number, number];
            return (
              <Circle
                key={`buffer${layer.radius}-${idx}`}
                center={[coords[1], coords[0]]}
                radius={layer.radius}
                pathOptions={{
                  color: layer.color,
                  fillColor: layer.fillColor,
                  weight: layer.weight,
                  dashArray: layer.dashArray,
                  fillOpacity: activeFilters.showBufferFill ? layer.circleFillOpacity : 0,
                  opacity: 1,
                }}
                interactive={false}
              />
            );
          })
        ))}
        </Pane>
      ))}

      {/* Render municipal boundaries */}
      {boundaries.map((feature, idx) => (
        <GeoJSON
          key={`boundary-${data?.metadata?.slug}-${idx}`}
          data={feature as any}
          style={() => ({
            color: '#6b7280',  // Medium grey color for boundary
            fillColor: '#6b7280',
            weight: 3,  // Thick line for visibility
            fillOpacity: 0.05,  // Very light fill to show area
            opacity: 0.85,  // More visible line
            dashArray: '10, 10',  // Dashed line to distinguish from buffers
          })}
        />
      ))}

      {/* Render spider leg lines (shown underneath markers) */}
      {spiderLegLines}

      {/* Render points with automatic spiderfy at zoom 15+ */}
      {markerElements}

      {/* National view: every point on one canvas; a click opens its details */}
      {summaryView && !nationalDetailPoints && (
        <PointsCanvasLayer
          points={canvasPoints}
          colorOf={providerColor}
          radius={currentZoom >= 17 ? 6 : currentZoom >= 15 ? 5 : PERFORMANCE_CONFIG.SIMPLE_MARKER_RADIUS}
          opacity={PERFORMANCE_CONFIG.SIMPLE_MARKER_OPACITY}
          highlightedPoints={highlightedPoints}
          onPointClick={(props, latlng) =>
            setSelectedPoint({ slug: data.metadata.slug, props, latlng: [latlng.lat, latlng.lng] })
          }
        />
      )}
      {selectedPoint && selectedPoint.slug === data.metadata.slug && (
        <Popup
          key={`selected-${selectedPoint.latlng.join(',')}-${selectedPoint.props.vervoerder}`}
          position={selectedPoint.latlng}
          maxWidth={600}
          minWidth={300}
          autoPan={false}
          // Only clear this popup's own selection: a new click unmounts the old one
          eventHandlers={{ remove: () => setSelectedPoint((current) => (current === selectedPoint ? null : current)) }}
        >
          <SummaryPointPopup summary={selectedPoint.props} />
        </Popup>
      )}

      {/* Render search location marker (blue pin) */}
      {searchLocationMarker && (
        <Marker
          position={[searchLocationMarker.latitude, searchLocationMarker.longitude]}
          icon={createSearchLocationIcon()}
          zIndexOffset={1000}
        >
          <Popup>
            <div className="text-sm">
              <h3 className="font-bold text-foreground">{t.popup.searchLocation}</h3>
              <p className="text-xs text-subtle-foreground mt-1">
                {searchLocationMarker.latitude.toFixed(6)}, {searchLocationMarker.longitude.toFixed(6)}
              </p>
            </div>
          </Popup>
        </Marker>
      )}
    </MapContainer>

      <BasemapPicker
        value={basemapId}
        onChange={(id) => {
          setBasemapId(id);
          saveBasemap(id);
        }}
      />

      {/* Empty state overlay when municipality has 0 pakketpunten */}
      {hasNoPakketpunten && (
        <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-[1000] pointer-events-none">
          <div className="bg-yellow-50 border-2 border-yellow-400 rounded-lg shadow-lg px-6 py-4 max-w-md">
            <div className="flex items-start gap-3">
              <svg className="w-6 h-6 text-yellow-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <div>
                <h3 className="font-semibold text-yellow-900 mb-1">
                  {t.map.noPointsTitle}
                </h3>
                <p className="text-sm text-yellow-800">
                  {t.map.noPointsBody}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Export as default - using named function helps Fast Refresh
export default MapComponent;
