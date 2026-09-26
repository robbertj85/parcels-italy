import type { Carrier } from '@/lib/carriers';
import { t } from '@/lib/strings';

export interface Municipality {
  name: string;
  slug: string;
  province: string;
  /** Null when no source had a figure (e.g. some municipalities merged on 1 Jan 2025). */
  population: number | null;
  /** Official code (NIS in Belgium); null for the national row. */
  code?: string | null;
  /** Names in the other national languages, e.g. "Luik" for Liège. */
  aliases?: string[];
}

export interface PakketpuntProperties {
  type: 'pakketpunt';
  locatieNaam: string;
  straatNaam: string;
  straatNr: string;
  vervoerder: Carrier;
  puntType: string;
  bezettingsgraad: number;
  latitude: number;
  longitude: number;
  canPickup: boolean;
  canDropoff: boolean;
  openingstijden?: OpeningHours | null;
  /** Municipality slug; only on national points loaded from the compact file (lib/pointData). */
  gemeente?: string;
}

// Per-day map (Dutch keys) OR a single free-text string OR null when unknown.
export type OpeningHours = string | {
  ma?: string;
  di?: string;
  wo?: string;
  do?: string;
  vr?: string;
  za?: string;
  zo?: string;
};

export interface BufferProperties {
  type: 'buffer_union_300m' | 'buffer_union_400m' | 'boundary';
  buffer_m?: number;
  gemeente?: string;
}

export type FeatureProperties = PakketpuntProperties | BufferProperties;

export interface PakketpuntFeature {
  type: 'Feature';
  geometry: {
    type: 'Point' | 'Polygon' | 'MultiPolygon';
    coordinates: number[] | number[][] | number[][][];
  };
  properties: FeatureProperties;
}

export interface PakketpuntData {
  type: 'FeatureCollection';
  metadata: {
    gemeente: string;
    slug: string;
    generated_at: string;
    total_points: number;
    providers: string[];
    bounds: [number, number, number, number]; // [minx, miny, maxx, maxy]
  };
  features: PakketpuntFeature[];
}

export interface Filters {
  providers: string[];
  showBuffer300: boolean;
  showBuffer400: boolean;
  showBuffer500: boolean;
  showBufferFill: boolean;
  bufferMerged: boolean;
  showBoundary: boolean;
  useSimpleMarkers: boolean;
  minOccupancy: number;
  maxOccupancy: number;
  showMockData: boolean;
  pointCategories: PointCategory[];
  showOnlySharedLocations: boolean;
  serviceFilters: ServiceFilter[];
}

// Service capability filter: pickup (receive) vs dropoff (send)
export type ServiceFilter = 'pickup' | 'dropoff';

// Normalized point category: locker (automated) vs shop (staffed)
export type PointCategory = 'locker' | 'shop';

// Mapping of carrier-specific puntType values to normalized categories
// Lockers (automated machines):
//   - DHL: packStation
//   - PostNL: automaat
//   - DPD: dpd_box
//   - Amazon: locker
//   - DeBuren: Buitenkluis
//   - GLS: locker
// Shops (staffed locations):
//   - DHL: parcelShop
//   - PostNL: servicepunt
//   - DPD: pickup_point
//   - Amazon: 3p (3rd party counter)
//   - VintedGo: parcel_shop, social
//   - DeBuren: Afhaalpunt, Afhaalcentrum
//   - GLS: parcel_shop, locker
//   - ViaTim: servicepunt (all are staffed shops)
//   - InPost: servicepunt (PUDO shops), automaat (parcel lockers)
//   - bpost: postkantoor, servicepunt (shops), automaat (pakjesautomaten)
const LOCKER_TYPES = new Set([
  'packStation',      // DHL
  'automaat',         // PostNL, InPost, bpost
  'dpd_box',          // DPD
  'locker',           // Amazon, VintedGo
  'Buitenkluis',      // DeBuren
]);

export function getPointCategory(puntType: string): PointCategory {
  return LOCKER_TYPES.has(puntType) ? 'locker' : 'shop';
}

export function getCategoryLabel(category: PointCategory): string {
  return category === 'locker' ? t.categories.locker : t.categories.shop;
}
