'use client';

import { useState, useEffect } from 'react';
import { Filters, PointCategory, ServiceFilter, getCategoryLabel } from '@/types/pakketpunten';
import { BoundaryLoadProgress } from '@/utils/boundaryLoader';
import { CARRIER_LABELS, CARRIER_ORDER, CARRIER_SERIES_COLORS } from '@/lib/carriers';
import { MAX_BUFFER_POINTS, usesNationalCoverage } from '@/lib/mapLimits';
import { t } from '@/lib/strings';

interface FilterPanelProps {
  filters: Filters;
  onChange: (filters: Filters) => void;
  availableProviders?: string[];
  providerCounts?: Record<string, number>;
  categoryCounts?: Record<PointCategory, number>;
  serviceCounts?: Record<ServiceFilter, number>;
  sharedLocationCount?: number;
  boundariesLoading?: boolean;
  boundaryLoadProgress?: BoundaryLoadProgress | null;
  totalPoints?: number;
  /** The national view, where default filters show the precomputed coverage. */
  nationalView?: boolean;
}

/**
 * This list doubles as the map's legend, so the swatch carries the *series*
 * colour rather than the livery — that is what the charts draw and what the
 * map's simple markers use. The carrier name sits beside it, so identity never
 * rests on the colour alone.
 *
 * (The former `textColor` field was dropped: it was never read.)
 */
const PROVIDER_INFO: Record<string, { name: string; color: string }> = Object.fromEntries(
  CARRIER_ORDER.map((carrier) => [
    carrier,
    { name: CARRIER_LABELS[carrier], color: CARRIER_SERIES_COLORS[carrier] },
  ])
);

const CATEGORY_INFO: Record<PointCategory, { name: string }> = {
  locker: { name: t.categories.locker },
  shop: { name: t.categories.shop },
};

const SERVICE_INFO: Record<ServiceFilter, { name: string; description: string }> = {
  pickup: { name: t.filters.pickup, description: t.filters.pickupDescription },
  dropoff: { name: t.filters.dropoff, description: t.filters.dropoffDescription },
};

// Icon components for point categories
function LockerIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
    </svg>
  );
}

function ShopIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13.5 21v-7.5a.75.75 0 01.75-.75h3a.75.75 0 01.75.75V21m-4.5 0H2.36m11.14 0H18m0 0h3.64m-1.39 0V9.349m-16.5 11.65V9.35m0 0a3.001 3.001 0 003.75-.615A2.993 2.993 0 009.75 9.75c.896 0 1.7-.393 2.25-1.016a2.993 2.993 0 002.25 1.016c.896 0 1.7-.393 2.25-1.016a3.001 3.001 0 003.75.614m-16.5 0a3.004 3.004 0 01-.621-4.72L4.318 3.44A1.5 1.5 0 015.378 3h13.243a1.5 1.5 0 011.06.44l1.19 1.189a3 3 0 01-.621 4.72m-13.5 8.65h3.75a.75.75 0 00.75-.75V13.5a.75.75 0 00-.75-.75H6.75a.75.75 0 00-.75.75v3.75c0 .415.336.75.75.75z" />
    </svg>
  );
}

function SharedLocationIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 7v.01M9.5 9l.01.01M14.5 9l.01.01M9.5 12l.01.01M14.5 12l.01.01" />
    </svg>
  );
}

// Package with arrow down icon for pickup (receive package)
function PickupIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      {/* Box outline */}
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0v10l-8 4m8-14l-8 4m-8-4v10l8 4m-8-14l8 4" />
      {/* Down arrow */}
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v5m0 0l-2-2m2 2l2-2" />
    </svg>
  );
}

// Package with arrow up icon for dropoff (send package)
function DropoffIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      {/* Box outline */}
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0v10l-8 4m8-14l-8 4m-8-4v10l8 4m-8-14l8 4" />
      {/* Up arrow */}
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 13V8m0 0l-2 2m2-2l2 2" />
    </svg>
  );
}

// Inline loading spinner component (grey, matching top bar)
function InlineSpinner() {
  return (
    <svg className="animate-spin h-3.5 w-3.5 text-subtle-foreground flex-shrink-0" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
    </svg>
  );
}

export default function FilterPanel({ filters, onChange, availableProviders, providerCounts, categoryCounts, serviceCounts, sharedLocationCount, boundariesLoading, boundaryLoadProgress, totalPoints, nationalView }: FilterPanelProps) {
  // Above this many points the map only draws coverage for what is in view,
  // unless the national view can show its precomputed coverage
  const buffersNeedZoom =
    (totalPoints ?? 0) > MAX_BUFFER_POINTS &&
    !(nationalView && usesNationalCoverage(filters, availableProviders ?? []));

  // Local spinner state for merged buffer toggle
  const [mergeSpinner, setMergeSpinner] = useState(false);
  // Local spinner state for the "toggle all carriers" heading click
  const [providersSpinner, setProvidersSpinner] = useState(false);

  useEffect(() => {
    if (!providersSpinner) return;
    const timer = setTimeout(() => setProvidersSpinner(false), 400);
    return () => clearTimeout(timer);
  }, [filters.providers, providersSpinner]);

  // Clear spinner once the filter change has been applied (computation done, re-render complete)
  useEffect(() => {
    if (filters.bufferMerged && mergeSpinner) {
      setMergeSpinner(false);
    }
  }, [filters.bufferMerged, mergeSpinner]);

  const toggleProvider = (provider: string) => {
    const newProviders = filters.providers.includes(provider)
      ? filters.providers.filter((p) => p !== provider)
      : [...filters.providers, provider];

    onChange({ ...filters, providers: newProviders });
  };

  const toggleCategory = (category: PointCategory) => {
    const newCategories = filters.pointCategories.includes(category)
      ? filters.pointCategories.filter((c) => c !== category)
      : [...filters.pointCategories, category];

    onChange({ ...filters, pointCategories: newCategories });
  };

  const toggleService = (service: ServiceFilter) => {
    const newServices = filters.serviceFilters.includes(service)
      ? filters.serviceFilters.filter((s) => s !== service)
      : [...filters.serviceFilters, service];

    onChange({ ...filters, serviceFilters: newServices });
  };

  const providers = availableProviders || Object.keys(PROVIDER_INFO);
  const anyProviderSelected = filters.providers.length > 0;

  // Clicking the "Vervoerders" heading switches every carrier off, or all on
  // when none is selected (as in pakketpunten-analyse)
  const toggleAllProviders = () => {
    const next = anyProviderSelected ? [] : [...providers];
    setProvidersSpinner(true);
    // Defer so the browser paints the spinner before the heavy re-render
    setTimeout(() => onChange({ ...filters, providers: next }), 20);
  };
  // Clicking the "Dekkingsgebieden" heading does the same for its six ticks
  const anyCoverageOn =
    filters.showBuffer300 || filters.showBuffer400 || filters.showBuffer500 ||
    filters.showBufferFill || filters.bufferMerged || filters.showBoundary;
  const toggleAllCoverage = () => {
    const on = !anyCoverageOn;
    const next = {
      ...filters,
      showBuffer300: on,
      showBuffer400: on,
      showBuffer500: on,
      showBufferFill: on,
      bufferMerged: on,
      showBoundary: on,
    };
    if (on) {
      // Merging is the heavy part: paint the spinner first, as the merge tick does
      setMergeSpinner(true);
      setTimeout(() => onChange(next), 20);
    } else {
      onChange(next);
    }
  };
  const categories: PointCategory[] = ['locker', 'shop'];
  const services: ServiceFilter[] = ['pickup', 'dropoff'];

  return (
    <div className="space-y-4 md:space-y-6 p-3 md:p-4 bg-card rounded-lg shadow-md">
      <div>
        <h3 className="text-base md:text-lg font-semibold text-foreground mb-2 md:mb-3">{t.filters.title}</h3>
      </div>

      {/* Provider filters */}
      <div>
        <button
          type="button"
          onClick={toggleAllProviders}
          title={anyProviderSelected ? t.filters.allCarriersOff : t.filters.allCarriersOn}
          className="flex items-center gap-2 w-full text-left text-sm font-medium text-foreground mb-2 hover:text-primary transition cursor-pointer select-none"
        >
          <span>{t.filters.carriers}</span>
          {providersSpinner && <InlineSpinner />}
        </button>
        <div className="space-y-1 md:space-y-2">
          {providers.map((provider) => {
            const info = PROVIDER_INFO[provider as keyof typeof PROVIDER_INFO];
            if (!info) return null;

            const isSelected = filters.providers.includes(provider);
            const count = providerCounts?.[provider] || 0;

            return (
              <label key={provider} className="flex items-center space-x-2 cursor-pointer py-1.5 md:py-0.5 -mx-1 px-1 rounded hover:bg-muted active:bg-secondary transition">
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggleProvider(provider)}
                  className="w-5 h-5 md:w-4 md:h-4 text-primary rounded focus:ring-2 focus:ring-ring"
                />
                <span
                  className="w-4 h-4 rounded-full border border-white flex-shrink-0"
                  style={{ backgroundColor: info.color }}
                />
                <span className="text-sm text-foreground flex-1">{info.name}</span>
                {isSelected && count > 0 && (
                  <span className="text-sm font-semibold text-foreground ml-auto tabular-nums">
                    {count}
                  </span>
                )}
              </label>
            );
          })}
        </div>
      </div>

      {/* Point category filters */}
      <div>
        <label className="block text-sm font-medium text-foreground mb-2">{t.filters.locationType}</label>
        <div className="space-y-1 md:space-y-2">
          {categories.map((category) => {
            const info = CATEGORY_INFO[category];
            const isSelected = filters.pointCategories.includes(category);
            const count = categoryCounts?.[category] || 0;

            return (
              <label key={category} className="flex items-center space-x-2 cursor-pointer py-1.5 md:py-0.5 -mx-1 px-1 rounded hover:bg-muted active:bg-secondary transition">
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggleCategory(category)}
                  className="w-5 h-5 md:w-4 md:h-4 text-primary rounded focus:ring-2 focus:ring-ring"
                />
                {category === 'locker' ? (
                  <LockerIcon className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                ) : (
                  <ShopIcon className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                )}
                <span className="text-sm text-foreground flex-1">{info.name}</span>
                {isSelected && count > 0 && (
                  <span className="text-sm font-semibold text-foreground ml-auto tabular-nums">
                    {count}
                  </span>
                )}
              </label>
            );
          })}
        </div>
      </div>

      {/* Service capability filters */}
      <div>
        <label className="block text-sm font-medium text-foreground mb-2">{t.filters.service}</label>
        <div className="space-y-1 md:space-y-2">
          {services.map((service) => {
            const info = SERVICE_INFO[service];
            const isSelected = filters.serviceFilters.includes(service);
            const count = serviceCounts?.[service] || 0;

            return (
              <label key={service} className="flex items-center space-x-2 cursor-pointer py-1.5 md:py-0.5 -mx-1 px-1 rounded hover:bg-muted active:bg-secondary transition">
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggleService(service)}
                  className="w-5 h-5 md:w-4 md:h-4 text-primary rounded focus:ring-2 focus:ring-ring"
                />
                {service === 'pickup' ? (
                  <PickupIcon className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                ) : (
                  <DropoffIcon className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                )}
                <span className="text-sm text-foreground flex-1">{info.name}</span>
                {isSelected && count > 0 && (
                  <span className="text-sm font-semibold text-foreground ml-auto tabular-nums">
                    {count}
                  </span>
                )}
              </label>
            );
          })}
        </div>
        <p className="text-xs text-subtle-foreground mt-1">{t.filters.serviceHint}</p>
      </div>

      {/* Shared locations filter */}
      <div>
        <label className="block text-sm font-medium text-foreground mb-2">{t.filters.locations}</label>
        <div className="space-y-1 md:space-y-2">
          <label className="flex items-center space-x-2 cursor-pointer py-1.5 md:py-0.5 -mx-1 px-1 rounded hover:bg-muted active:bg-secondary transition">
            <input
              type="radio"
              name="locationFilter"
              checked={!filters.showOnlySharedLocations}
              onChange={() => onChange({ ...filters, showOnlySharedLocations: false })}
              className="w-5 h-5 md:w-4 md:h-4 text-primary focus:ring-2 focus:ring-ring"
            />
            <span className="text-sm text-foreground">{t.filters.allLocations}</span>
          </label>
          <label className="flex items-center space-x-2 cursor-pointer py-1.5 md:py-0.5 -mx-1 px-1 rounded hover:bg-muted active:bg-secondary transition">
            <input
              type="radio"
              name="locationFilter"
              checked={filters.showOnlySharedLocations}
              onChange={() => onChange({ ...filters, showOnlySharedLocations: true })}
              className="w-5 h-5 md:w-4 md:h-4 text-primary focus:ring-2 focus:ring-ring"
            />
            <SharedLocationIcon className="w-4 h-4 text-muted-foreground flex-shrink-0" />
            <span className="text-sm text-foreground flex-1">{t.filters.sharedAddresses}</span>
            {filters.showOnlySharedLocations && sharedLocationCount !== undefined && sharedLocationCount > 0 && (
              <span className="text-sm font-semibold text-foreground ml-auto tabular-nums">
                {sharedLocationCount}
              </span>
            )}
          </label>
          <p className="text-xs text-subtle-foreground ml-7">{t.filters.sharedAddressesHint}</p>
        </div>
      </div>

      {/* Marker Style */}
      <div>
        <label className="block text-sm font-medium text-foreground mb-2">{t.filters.markerStyle}</label>
        <div className="space-y-1 md:space-y-2">
          <label className="flex items-center space-x-2 cursor-pointer py-1.5 md:py-0.5 -mx-1 px-1 rounded hover:bg-muted active:bg-secondary transition">
            <input
              type="radio"
              name="markerStyle"
              checked={!filters.useSimpleMarkers}
              onChange={() => onChange({ ...filters, useSimpleMarkers: false })}
              className="w-5 h-5 md:w-4 md:h-4 text-primary focus:ring-2 focus:ring-ring"
            />
            <span className="text-sm text-foreground">{t.filters.logoIcons}</span>
          </label>
          <label className="flex items-center space-x-2 cursor-pointer py-1.5 md:py-0.5 -mx-1 px-1 rounded hover:bg-muted active:bg-secondary transition">
            <input
              type="radio"
              name="markerStyle"
              checked={filters.useSimpleMarkers}
              onChange={() => onChange({ ...filters, useSimpleMarkers: true })}
              className="w-5 h-5 md:w-4 md:h-4 text-primary focus:ring-2 focus:ring-ring"
            />
            <span className="text-sm text-foreground">{t.filters.coloredDots}</span>
          </label>
        </div>
      </div>

      {/* Buffer zones */}
      <div>
        <button
          type="button"
          onClick={toggleAllCoverage}
          title={anyCoverageOn ? t.filters.allCarriersOff : t.filters.allCarriersOn}
          className="block w-full text-left text-sm font-medium text-foreground mb-2 hover:text-primary transition cursor-pointer select-none"
        >
          {t.filters.coverage}
        </button>
        {buffersNeedZoom && (
          <p className="text-xs text-subtle-foreground mb-2">{t.filters.buffersZoomHint(MAX_BUFFER_POINTS)}</p>
        )}
        <div className="space-y-1 md:space-y-2">
          <label className={`flex items-center space-x-2 py-1.5 md:py-0.5 -mx-1 px-1 rounded transition cursor-pointer hover:bg-muted active:bg-secondary`}>
            <input
              type="checkbox"
              checked={filters.showBuffer300}
              onChange={(e) => onChange({ ...filters, showBuffer300: e.target.checked })}
              className="w-5 h-5 md:w-4 md:h-4 text-primary rounded focus:ring-2 focus:ring-ring disabled:opacity-50"
            />
            <span className="text-sm text-foreground">{t.filters.buffer300}</span>
          </label>
          <label className={`flex items-center space-x-2 py-1.5 md:py-0.5 -mx-1 px-1 rounded transition cursor-pointer hover:bg-muted active:bg-secondary`}>
            <input
              type="checkbox"
              checked={filters.showBuffer400}
              onChange={(e) => onChange({ ...filters, showBuffer400: e.target.checked })}
              className="w-5 h-5 md:w-4 md:h-4 text-primary rounded focus:ring-2 focus:ring-ring disabled:opacity-50"
            />
            <span className="text-sm text-foreground">{t.filters.buffer400}</span>
          </label>
          <label className={`flex items-center space-x-2 py-1.5 md:py-0.5 -mx-1 px-1 rounded transition cursor-pointer hover:bg-muted active:bg-secondary`}>
            <input
              type="checkbox"
              checked={filters.showBuffer500}
              onChange={(e) => onChange({ ...filters, showBuffer500: e.target.checked })}
              className="w-5 h-5 md:w-4 md:h-4 text-primary rounded focus:ring-2 focus:ring-ring disabled:opacity-50"
            />
            <span className="text-sm text-foreground">{t.filters.buffer500}</span>
          </label>
          <label className={`flex items-center space-x-2 py-1.5 md:py-0.5 -mx-1 px-1 rounded transition cursor-pointer hover:bg-muted active:bg-secondary`}>
            <input
              type="checkbox"
              checked={filters.showBufferFill}
              onChange={(e) => onChange({ ...filters, showBufferFill: e.target.checked })}
              className="w-5 h-5 md:w-4 md:h-4 text-primary rounded focus:ring-2 focus:ring-ring disabled:opacity-50"
            />
            <span className="text-sm text-foreground">{t.filters.bufferFill}</span>
          </label>
          <label className={`flex items-center space-x-2 py-1.5 md:py-0.5 -mx-1 px-1 rounded transition cursor-pointer hover:bg-muted active:bg-secondary`}>
            <input
              type="checkbox"
              checked={filters.bufferMerged || mergeSpinner}
              onChange={(e) => {
                const checked = e.target.checked;
                if (checked) {
                  // Show spinner first, defer filter change so browser paints spinner before useMemo blocks
                  setMergeSpinner(true);
                  setTimeout(() => onChange({ ...filters, bufferMerged: true }), 20);
                } else {
                  onChange({ ...filters, bufferMerged: false });
                }
              }}
              className="w-5 h-5 md:w-4 md:h-4 text-primary rounded focus:ring-2 focus:ring-ring disabled:opacity-50"
            />
            <span className="text-sm text-foreground">{t.filters.mergedBuffers}</span>
            {mergeSpinner && <InlineSpinner />}
            <span className="relative group/tip">
              <span className="inline-flex items-center justify-center w-4 h-4 text-[10px] font-medium text-subtle-foreground bg-secondary rounded-full cursor-help">i</span>
              <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover/tip:block w-48 px-2 py-1 text-xs text-background bg-foreground rounded shadow-lg text-center pointer-events-none z-50">
                {t.filters.mergedBuffersTip}
              </span>
            </span>
          </label>
          <label className="flex items-center space-x-2 cursor-pointer py-1.5 md:py-0.5 -mx-1 px-1 rounded hover:bg-muted active:bg-secondary transition">
            <input
              type="checkbox"
              checked={filters.showBoundary}
              onChange={(e) => onChange({ ...filters, showBoundary: e.target.checked })}
              disabled={boundariesLoading}
              className="w-5 h-5 md:w-4 md:h-4 text-destructive rounded focus:ring-2 focus:ring-red-500 disabled:opacity-50"
            />
            <div className="flex-1">
              <span className="text-sm text-foreground">{t.filters.boundary}</span>
              {boundariesLoading && boundaryLoadProgress && (
                <div className="mt-1 text-xs text-primary">
                  <div className="flex items-center gap-2">
                    <span>{t.filters.loadingProgress(boundaryLoadProgress.loaded, boundaryLoadProgress.total)}</span>
                    <span>({boundaryLoadProgress.percentage}%)</span>
                  </div>
                  <div className="w-full bg-border rounded-full h-1.5 mt-1">
                    <div
                      className="bg-primary h-1.5 rounded-full transition-all duration-300"
                      style={{ width: `${boundaryLoadProgress.percentage}%` }}
                    />
                  </div>
                </div>
              )}
              {boundariesLoading && !boundaryLoadProgress && (
                <span className="ml-2 text-xs text-primary">{t.filters.loadingParen}</span>
              )}
            </div>
          </label>
        </div>
      </div>

      {/* Reset button */}
      <button
        onClick={() =>
          onChange({
            providers: providers,
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
          })
        }
        className="w-full px-4 py-3 md:py-2 text-sm font-medium text-foreground bg-secondary rounded-lg hover:bg-border active:bg-input transition"
      >
        {t.filters.reset}
      </button>
    </div>
  );
}
