# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Parcel point (pakketpunt) viewer for **Belgium**, forked from the Dutch viewer
(`upstream-nl` remote, github.com/robbertj85/pakketpunten) and made
**country-configurable** so the same core serves other countries (Italy next):

- **Python pipeline**: nationwide fetch per carrier → per-municipality GeoJSON with 300/400 m coverage buffers → statistics and history
- **Next.js webapp**: Leaflet map, filters, statistics, data export, address search

One repository = one country = one Vercel project. The data files are those of one country.

## Country configuration (read this first)

The active country is one committed line in `webapp/config/active-country` (`BE`),
read by `country_config.py` (pipeline and workflows) and by `webapp/next.config.ts`
(which exposes it as `NEXT_PUBLIC_COUNTRY`). The env vars `PAKKETPUNTEN_COUNTRY` and
`NEXT_PUBLIC_COUNTRY` override it for a one-off run.

Everything that differs per country lives in two mirrored profiles:

- `country_config.py` (`COUNTRIES`):
  ISO codes, metric CRS, bbox, national slug, OSM boundary settings, carrier list, per-carrier fetch parameters.
- `webapp/config/countries.ts` (`COUNTRIES`):
  locale, site name/URL, national slug and labels, default municipality, region label,
  geocoder bbox, carrier list, `missingCarriers` (hard-to-get networks shown in About), About links.

The carrier list and order must match in both: the order picks each carrier's chart colour.
Never hardcode a country, slug (`belgie`), region name or locale in code — read the profile.
How to add a country: `docs/NEW_COUNTRY.md`.

## Common Commands

```bash
python3 -m venv venv && source venv/bin/activate && pip install -r requirements.txt

python scripts/build_municipalities.py      # municipality list + boundaries (OSM), rerun after mergers
python scripts/fetch_all.py                 # every carrier's nationwide cache
python scripts/<carrier>_fetch_all.py       # one carrier, e.g. bpost_fetch_all.py
python scripts/batch_generate.py            # per-municipality GeoJSON (geometry only, no network)
python scripts/create_national_overview.py
python scripts/create_provincial_boundaries.py
python scripts/compute_statistics.py
python scripts/update_totals_history.py
python scripts/check_cache_freshness.py --max-age-days 21

python main.py --gemeente Gent --filename test --format geojson   # one municipality to output/

cd webapp && npm install && npm run dev     # NEXT_PUBLIC_COUNTRY=IT npm run dev for another profile
npm run build && npm run lint
```

## Architecture

### Pipeline

```
scripts/<carrier>_fetch_all.py ──> data/<carrier>_all_locations.json (via cache_guard.safe_save)
scripts/build_municipalities.py ──> data/municipalities_all.json, data/municipality_polygons.geojson,
                                    webapp/public/municipalities.json, webapp/public/data/geo/
api_client.get_data_pakketpunten(gemeente)
    loads every cache once per process (lru_cache), clips to the municipal polygon
batch_generate.py ──> webapp/public/data/<slug>.geojson + summary.json
create_national_overview.py ──> <national_slug>.geojson + <national_slug>-points.json (compact, for the map)
create_provincial_boundaries.py ──> boundaries/index.json + provincie-<slug>.geojson
create_national_coverage.py ──> geo/coverage_{300,400,500}.geojson (national unions)
compute_statistics.py ──> statistics.json (incl. `unieke_locaties`)
update_totals_history.py ──> totals_history.json
```

- **All carriers are nationwide caches.** Unlike the Dutch viewer, PostNL and VintedGo
  are tiled nationwide fetches too, so `batch_generate.py` makes no network calls.
- **Record schema**: bpost, PostNL, GLS and VintedGo fetchers write normalised records
  (`locatieNaam, straatNaam, straatNr, latitude, longitude, puntType, canPickup,
  canDropoff, openingstijden`). DHL and DPD keep raw API objects, mapped in
  `api_client.ROW_MAPPERS` (as upstream does, to keep those fetchers close to NL).
- **Boundaries** come from a local file built from one Overpass query
  (`utils.get_gemeente_polygon` looks up by name, slug, code or alias).
  Belgium: 565 municipalities (2025 mergers), NIS codes in `ref:INS`, province from the NIS prefix.
- **CRS**: WGS84 for all I/O; `country_config.METRIC_CRS` (BE: EPSG:3812) for buffers and areas.

### Carriers in Belgium

| Carrier | Fetcher | Method | ~Locations |
|---|---|---|---|
| bpost | `bpost_fetch_all.py` | pudo.bpost.be locator (XML), postcode crawl, 20 km per call | 4,400 |
| DHL | `dhl_fetch_all.py` | api-gw.dhlparcel.nl `/BE/by-geo`, adaptive grid | 4,400 |
| GLS | `gls_fetch_all.py` | api.gls-group.net parcel-shop API, public widget key, 20 km grid | 1,900 |
| InPost | `inpost_fetch_all.py` | easypack24 `?country=BE` (incl. ex-Mondial Relay) | 1,300 |
| VintedGo | `vintedgo_fetch_all.py` | vintedgo.com RSC payload, bbox tiles (cap 500) | 1,300 |
| PostNL | `postnl_fetch_all.py` | location widget `country=bel`, bbox tiles | 1,100 |
| DPD | `dpd_fetch_all.py` | pickup.dpd.cz `getAll?country=56` | 1,000 |
| Amazon | `amazon_fetch_all.py` | amazon.com.be `fetch_locations` (20 nearest), adaptive grid; Playwright only for the session | 3,700 |
| ViaTim | `viatim_fetch_all.py` | ViaTim API, filtered to BE | 140 |
| FedEx | `fedex_fetch_all.py` | local.fedex.com Yext search (worldwide, keyless), 100 km circles | 620 |

**DHL and Amazon ride on the bpost network in Belgium**: every DHL point (id prefix
`8026-`) is a bpost location, and every Amazon pickup point found is a bpost shop or
locker (named "bpost - ..."). All three are shown (a DHL or Amazon parcel can be
collected there); `compute_statistics` reports `unieke_locaties` (points within 25 m
count once): ~19,000 points but ~7,900 physical locations.

PostNL's widget returns Dutch `BBN_` records without a country code at Belgian
coordinates; the fetcher keeps only `countryCode == 'BE'`.

Hard-to-get networks (UPS, Budbee, Mondial Relay own API, Cubee, DHL Express)
are listed in `missingCarriers` in the webapp profile.

### Cache Guard (`scripts/cache_guard.py`)

Every nationwide fetch saves through `safe_save()`, which refuses to overwrite a
cache when the count drops more than 20%, and exits 2 so the workflow can flag it.

The guard is **self-healing**, because a permanent block freezes the cache whenever
a carrier genuinely shrinks:

- Each run's count is appended to `data/fetch_history.json`, committed to the repo.
- A large drop that **repeats** on the next run, within 5%, is accepted as the new baseline.
- A fetch of 0 locations is never saved, and never confirmable.
- `CACHE_GUARD_FORCE=1` accepts the new count immediately (`force_save` on `workflow_dispatch`).

The workflows commit `data/fetch_history.json` **whatever the fetch outcome**. Do not
add an outcome gate to those commit steps.

### Freshness Gate (`scripts/check_cache_freshness.py`)

Exits 1 if any `data/*_all_locations.json` is older than `--max-age-days` (21 in CI).
Runs **last** in `update-data.yml`, after the push. The threshold is mirrored as
`STALE_AFTER_DAYS` in `webapp/types/sources.ts`.

### Workflows

- `fetch-amazon-data.yml` — Tuesday 00:00 UTC, Playwright, commits the Amazon cache
- `update-data.yml` — Tuesday 02:00 UTC: `fetch_all.py --skip Amazon` → batch → national
  overview → province chunks → statistics → history → commit → freshness gate

Both take the country from `webapp/config/active-country`. Tuesday on
purpose: the Dutch viewer runs Monday against the same DHL/DPD/InPost APIs.

### Repository size

The repo carries the Dutch viewer's history (~580 MB on GitHub) plus a weekly data
commit (~250 MB of data files, stored as deltas). `update-data.yml` reports the size
every run and warns above 2 GB (GitHub recommends < 1 GB, is strict around 5 GB).
When it warns, the data has to leave git: e.g. publish the weekly output as a release
asset or to object storage (Vercel Blob, S3) and have the webapp read from there,
or squash old data commits.

### Webapp

- `config/country.ts` → `COUNTRY` (active profile); `isNationalSlug()`
- `lib/carriers.ts` → `CARRIER_CATALOG` (every known carrier: label, livery, logo, data source)
  and, derived from the profile, `CARRIER_ORDER`, `CARRIER_SERIES_COLORS(_DARK)`, `CARRIER_BRAND`.
  Series colours are ten validated hue slots assigned by position (see the comment there).
- `app/api/geocode/route.ts` → Photon (komoot) for search/reverse, bbox + country filter;
  the municipality comes from `lib/municipalityLocator.ts` (point-in-polygon on
  `public/data/geo/municipality_polygons.geojson`), not from geocoder names.
- `components/Map.tsx` → marker rendering, spiderfy at zoom ≥15, hourly-rotated carrier render priority.
- **National view** (`lib/pointData.ts`, `components/PointsCanvasLayer.tsx`): loads
  `<national_slug>-points.json` (parallel arrays, ~0.5 MB for Belgium, ~3.4 MB for Italy) instead of
  the national GeoJSON (8 / 60 MB), and draws every point on one canvas instead of a
  React-Leaflet component per point (130k components froze the browser for Italy). Those points
  are summaries (carrier, type, services, municipality slug); a click fetches the point's
  municipality GeoJSON for the popup. With logo markers chosen, logos appear once ≤300 points
  are in view. The national GeoJSON stays for downloads and the API.
- **Coverage circles (300/400/500 m)** are never stored per municipality. The map draws
  them with Turf for at most `MAX_BUFFER_POINTS` (1,000, `lib/mapLimits.ts`) points —
  all points of a municipality, or above that only the points in view. Live, all of
  Belgium would take 30–40 s per radius; so the national view with default filters
  shows the unions `create_national_coverage.py` precomputes (~1.5 s each in GEOS).
  Each radius has its own Leaflet pane (500 lowest), so the stacking never changes.
- Clicking the "Vervoerders" heading switches all carriers off, or all on when none is
  (same behaviour as pakketpunten-analyse).
- Municipality search also matches `aliases` (other-language names: Luik → Liège).

Keep the data contract stable: GeoJSON property names are Dutch (`locatieNaam`,
`vervoerder`, `puntType`, `openingstijden` with keys `ma..zo`) in every country.

## Known Limitations

- **Population**: Statbel 2023 (`data/raw/TF_SOC_POP_STRUCT_2023.txt`, gitignored, downloaded by hand
  because Statbel blocks automated downloads). `build_municipalities.py` sums the pre-merger
  municipalities into the 2025 NIS codes (`BE_MERGERS_2025`). Without the file it falls back to
  Wikidata (older, gaps). Replace with a newer `TF_SOC_POP_STRUCT_<year>` file when available.
- **bpost**: no opening hours (one info call per point would be ~4,400 calls).
- **GLS**: the bulk API only returns today's and tomorrow's hours.
- **Bezettingsgraad** is a fixed placeholder (50), not real occupancy.
- `webapp/tests/test-all-municipalities.spec.ts` is inherited and broken (no Playwright setup).
