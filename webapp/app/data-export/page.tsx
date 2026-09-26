'use client';

import { useState, useEffect } from 'react';

import { COUNTRY } from '@/config/country';
import { t } from '@/lib/strings';
import { loadViewData } from '@/lib/pointData';
interface Municipality {
  name: string;
  slug: string;
  province: string;
  population: number | null;
}

export default function DownloadsPage() {
  const [municipalities, setMunicipalities] = useState<Municipality[]>([]);
  const [downloadStatus, setDownloadStatus] = useState<string>('');
  const [isDownloading, setIsDownloading] = useState(false);
  const [nationalStats, setNationalStats] = useState<{ totalPoints: number; municipalityCount: number }>({ totalPoints: 0, municipalityCount: 0 });

  useEffect(() => {
    fetch('/municipalities.json')
      .then(res => res.json())
      .then(data => {
        setMunicipalities(data);
        // Count municipalities excluding the national row
        const municipalityCount = data.filter((m: Municipality) => m.slug !== COUNTRY.nationalSlug).length;
        setNationalStats(prev => ({ ...prev, municipalityCount }));
      })
      .catch(err => console.error('Error loading municipalities:', err));

    // The total pakketpunten count, from the national view's compact points
    // (the national GeoJSON holds the same count but is tens of MB)
    loadViewData(COUNTRY.nationalSlug)
      .then(data => {
        setNationalStats(prev => ({ ...prev, totalPoints: data.features.length }));
      })
      .catch(err => console.error('Error loading national data:', err));
  }, []);

  const handleDownload = async (slug: string, format: 'json' | 'csv') => {
    setIsDownloading(true);
    setDownloadStatus('');

    try {
      const response = await fetch(`/api/download?slug=${slug}&format=${format}`);

      if (response.status === 429) {
        setDownloadStatus(`⚠️ ${t.dataExport.tooManyDownloads}`);
        setIsDownloading(false);
        return;
      }

      if (!response.ok) {
        throw new Error(t.dataExport.downloadFailed(response.statusText));
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `pakketpunten-${slug}.${format}`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      setDownloadStatus(`✅ ${t.dataExport.downloadStarted}`);
    } catch (error) {
      setDownloadStatus(`❌ ${t.dataExport.errorPrefix} ${error instanceof Error ? error.message : t.dataExport.unknownError}`);
    } finally {
      setIsDownloading(false);
    }
  };

  const nationalData = municipalities.find(m => m.slug === COUNTRY.nationalSlug);
  const cityData = municipalities.filter(m => m.slug !== COUNTRY.nationalSlug);

  return (
    <>
      {/* Status message */}
        {downloadStatus && (
          <div className={`mb-6 p-4 rounded-lg ${
            downloadStatus.startsWith('✅') ? 'bg-success-muted text-success' :
            downloadStatus.startsWith('⚠️') ? 'bg-amber-50 text-amber-800' :
            'bg-destructive-muted text-red-800'
          }`}>
            {downloadStatus}
          </div>
        )}

        {/* National data */}
        {nationalData && (
          <section className="mb-8">
            <h2 className="text-xl font-bold text-foreground mb-4">{t.dataExport.nationalTitle}</h2>
            <div className="bg-card rounded-lg shadow-md p-6">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <h3 className="text-lg font-semibold text-foreground">{nationalData.name}</h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    {t.dataExport.allResidents((nationalData.population ?? 0).toLocaleString(COUNTRY.locale))}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {t.dataExport.sumOfMunicipalities(nationalStats.municipalityCount)}
                  </p>
                  {nationalStats.totalPoints > 0 && (
                    <p className="text-sm font-semibold text-foreground mt-2">
                      📍 {t.dataExport.pointsCount(nationalStats.totalPoints.toLocaleString(COUNTRY.locale))}
                    </p>
                  )}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleDownload(COUNTRY.nationalSlug, 'json')}
                    disabled={isDownloading}
                    className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 disabled:bg-muted-foreground disabled:cursor-not-allowed transition flex items-center gap-2"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    JSON
                  </button>
                  <button
                    onClick={() => handleDownload(COUNTRY.nationalSlug, 'csv')}
                    disabled={isDownloading}
                    className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-muted-foreground disabled:cursor-not-allowed transition flex items-center gap-2"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    CSV
                  </button>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* City data */}
        <section>
          <h2 className="text-xl font-bold text-foreground mb-4">{t.dataExport.municipalityTitle}</h2>
          <div className="bg-card rounded-lg shadow-md p-6">
            <div className="mb-4">
              <input
                type="text"
                placeholder={t.dataExport.searchPlaceholder}
                className="w-full px-4 py-2 border border-input rounded-lg focus:ring-2 focus:ring-ring focus:border-transparent"
                id="citySearch"
                onChange={(e) => {
                  const searchTerm = e.target.value.toLowerCase();
                  const rows = document.querySelectorAll('.municipality-row');
                  rows.forEach(row => {
                    const text = row.textContent?.toLowerCase() || '';
                    (row as HTMLElement).style.display = text.includes(searchTerm) ? '' : 'none';
                  });
                }}
              />
            </div>

            <div className="space-y-2 max-h-96 overflow-y-auto">
              {cityData.map(municipality => (
                <div
                  key={municipality.slug}
                  className="municipality-row flex items-center justify-between p-3 hover:bg-muted rounded-lg border border-border"
                >
                  <div className="flex-1">
                    <h3 className="text-sm font-semibold text-foreground">{municipality.name}</h3>
                    <p className="text-xs text-muted-foreground">
                      {municipality.province} • {municipality.population != null
                        ? t.dataExport.residents(municipality.population.toLocaleString(COUNTRY.locale))
                        : t.dataExport.populationUnknown}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleDownload(municipality.slug, 'json')}
                      disabled={isDownloading}
                      className="px-3 py-1 text-sm bg-primary text-white rounded hover:bg-primary/90 disabled:bg-muted-foreground disabled:cursor-not-allowed transition"
                      title={t.dataExport.downloadJson}
                    >
                      JSON
                    </button>
                    <button
                      onClick={() => handleDownload(municipality.slug, 'csv')}
                      disabled={isDownloading}
                      className="px-3 py-1 text-sm bg-green-600 text-white rounded hover:bg-green-700 disabled:bg-muted-foreground disabled:cursor-not-allowed transition"
                      title={t.dataExport.downloadCsv}
                    >
                      CSV
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Rate limit notice */}
        <div className="mt-8 p-4 bg-accent border border-primary/30 rounded-lg">
          <h3 className="font-semibold text-accent-foreground mb-2 flex items-center">
            <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
            </svg>
            {t.dataExport.limitTitle}
          </h3>
          <p className="text-sm text-primary">
            {t.dataExport.limitBefore}<strong>{t.dataExport.limitStrong}</strong>{t.dataExport.limitAfter}
          </p>
        </div>
    </>
  );
}
