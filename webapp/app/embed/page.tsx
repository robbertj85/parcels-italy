'use client';

import { useState, useEffect, useMemo, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { PakketpuntData, Filters } from '@/types/pakketpunten';

import { COUNTRY } from '@/config/country';
import { CARRIER_ORDER } from '@/lib/carriers';
import { t } from '@/lib/strings';
import { loadViewData } from '@/lib/pointData';
const MapView = dynamic(() => import('@/components/Map'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-secondary">
      <p className="text-subtle-foreground">{t.common.mapLoading}</p>
    </div>
  ),
});

function EmbedContent() {
  const searchParams = useSearchParams();
  const rawParam = searchParams.get('gemeente') || COUNTRY.defaultMunicipalitySlug;
  // Map URL alias to internal slug
  const gemeente = rawParam === COUNTRY.nationalUrlAlias ? COUNTRY.nationalSlug : rawParam;

  const [data, setData] = useState<PakketpuntData | null>(null);
  const [loading, setLoading] = useState(true);

  const filters = useMemo<Filters>(() => ({
    providers: [...CARRIER_ORDER],
    showBuffer300: false,
    showBuffer400: false,
    showBuffer500: true,
    showBufferFill: true,
    bufferMerged: false,
    showBoundary: false,
    useSimpleMarkers: gemeente === COUNTRY.nationalSlug,
    minOccupancy: 0,
    maxOccupancy: 100,
    showMockData: false,
    pointCategories: ['locker', 'shop'],
    showOnlySharedLocations: false,
    serviceFilters: ['pickup', 'dropoff'],
  }), [gemeente]);

  useEffect(() => {
    setLoading(true);
    loadViewData(gemeente)
      .then((data) => {
        setData(data);
      })
      .catch((err) => console.error('Error loading data:', err))
      .finally(() => setLoading(false));
  }, [gemeente]);

  const municipalityName = data?.metadata?.gemeente || gemeente;

  return (
    <div className="w-full h-screen relative">
      <MapView data={data} filters={filters} />

      {/* Attribution bar */}
      <div className="absolute bottom-0 left-0 right-0 bg-card/90 backdrop-blur-sm border-t border-border px-3 py-1.5 flex items-center justify-between z-[1000]">
        <span className="text-xs text-muted-foreground">
          {loading ? t.common.loading : t.embed.attribution(municipalityName)}
        </span>
        <a
          href={`${typeof window !== 'undefined' ? window.location.origin : ''}/?gemeente=${gemeente === COUNTRY.nationalSlug ? COUNTRY.nationalUrlAlias : gemeente}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-primary hover:text-primary hover:underline font-medium"
        >
          {t.embed.openInViewer}
        </a>
      </div>
    </div>
  );
}

export default function EmbedPage() {
  return (
    <Suspense fallback={
      <div className="w-full h-screen flex items-center justify-center bg-secondary">
        <p className="text-subtle-foreground">{t.common.loading}</p>
      </div>
    }>
      <EmbedContent />
    </Suspense>
  );
}
