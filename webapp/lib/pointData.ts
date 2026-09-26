/**
 * Loading a view's points.
 *
 * A municipality loads its own GeoJSON. The national view loads
 * `<national>-points.json` instead (scripts/create_national_overview.py): the
 * same points as parallel arrays, a few MB where the national GeoJSON is tens
 * (Italy: ~60 MB, which browsers choke on). Those points carry only what the
 * filters, counts and map need; names, addresses and opening hours come from
 * the point's municipality file when it is clicked (`loadPointDetails`).
 */
import { COUNTRY } from '@/config/country';
import type { PakketpuntData, PakketpuntFeature, PakketpuntProperties } from '@/types/pakketpunten';

interface CompactPoints {
  metadata: PakketpuntData['metadata'];
  carriers: string[];
  puntTypes: string[];
  gemeenten: string[];
  lon: number[];
  lat: number[];
  carrier: number[];
  puntType: number[];
  services: number[];
  gemeente: number[];
}

/** True for points expanded from the compact file: their details are fetched on click. */
export function isSummaryPoint(props: PakketpuntProperties): boolean {
  return props.gemeente !== undefined && props.locatieNaam === '';
}

function expand(compact: CompactPoints): PakketpuntData {
  const features: PakketpuntFeature[] = new Array(compact.lon.length);
  for (let i = 0; i < compact.lon.length; i++) {
    const longitude = compact.lon[i] / 1e5;
    const latitude = compact.lat[i] / 1e5;
    const services = compact.services[i];
    features[i] = {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [longitude, latitude] },
      properties: {
        type: 'pakketpunt',
        locatieNaam: '',
        straatNaam: '',
        straatNr: '',
        vervoerder: compact.carriers[compact.carrier[i]] as PakketpuntProperties['vervoerder'],
        puntType: compact.puntTypes[compact.puntType[i]],
        bezettingsgraad: 50,
        latitude,
        longitude,
        canPickup: (services & 1) !== 0,
        canDropoff: (services & 2) !== 0,
        gemeente: compact.gemeenten[compact.gemeente[i]],
      },
    };
  }
  return { type: 'FeatureCollection', metadata: compact.metadata, features };
}

async function fetchJson(url: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

/** A municipality's GeoJSON, or the national points (compact file, full GeoJSON as fallback). */
export async function loadViewData(slug: string): Promise<PakketpuntData> {
  if (slug === COUNTRY.nationalSlug) {
    try {
      return expand(await fetchJson(`/data/${slug}-points.json`));
    } catch (err) {
      console.warn('Compact national points unavailable, loading the full GeoJSON:', err);
    }
  }
  return fetchJson(`/data/${slug}.geojson`);
}

const municipalityCache = new Map<string, Promise<PakketpuntData>>();

/**
 * The full record of a summary point, from its municipality's file (cached per
 * municipality). Matches carrier and position (the compact file rounds to ~1 m);
 * falls back to the summary itself if the file has no such point.
 */
export async function loadPointDetails(summary: PakketpuntProperties): Promise<PakketpuntProperties> {
  const slug = summary.gemeente;
  if (!slug) return summary;
  let pending = municipalityCache.get(slug);
  if (!pending) {
    pending = fetchJson(`/data/${slug}.geojson`);
    municipalityCache.set(slug, pending);
    pending.catch(() => municipalityCache.delete(slug));
  }
  const data = await pending;
  let best: PakketpuntProperties | null = null;
  let bestDistance = Infinity;
  for (const feature of data.features) {
    const props = feature.properties;
    if (props.type !== 'pakketpunt' || props.vervoerder !== summary.vervoerder) continue;
    const distance = Math.abs(props.latitude - summary.latitude) + Math.abs(props.longitude - summary.longitude);
    if (distance < bestDistance) {
      best = props;
      bestDistance = distance;
    }
  }
  return best && bestDistance < 5e-5 ? best : summary;
}
