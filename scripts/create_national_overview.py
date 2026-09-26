"""
Create a national overview by aggregating all municipality data.

Writes webapp/public/data/<national_slug>.geojson (pakketpunten only, for
downloads and the API), <national_slug>-points.json (the same points in a
compact columnar form: what the map loads for the national view) and
<national_slug>-boundaries.geojson (all municipal outlines; gitignored, the
webapp loads the per-province chunks from create_provincial_boundaries.py).
The national row in municipalities.json is written by build_municipalities.py.
"""

import json
import sys
from pathlib import Path

import geopandas as gpd
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from country_config import CARRIERS, CONFIG, MUNICIPALITIES_FILE, NATIONAL_SLUG, WEBAPP_DATA_DIR  # noqa: E402


def write_compact_points(path, metadata, features, slugs):
    """The national points as parallel arrays, a few MB instead of tens.

    Coordinates are integers of 1e-5 degree (about 1 m); carrier, point type and
    municipality are indices into the lists alongside; `services` is a bitmask
    (1 pickup, 2 dropoff). Everything else (names, addresses, opening hours) the
    map fetches from the point's municipality file when the point is clicked.
    Read by webapp/lib/pointData.ts.
    """
    carriers = list(metadata["providers"])
    punt_types: list[str] = []
    gemeenten: list[str] = []
    type_index: dict[str, int] = {}
    slug_index: dict[str, int] = {}
    cols = {"lon": [], "lat": [], "carrier": [], "puntType": [], "services": [], "gemeente": []}

    for feature, slug in zip(features, slugs):
        props = feature["properties"]
        lon, lat = feature["geometry"]["coordinates"][:2]
        punt_type = props.get("puntType") or ""
        if punt_type not in type_index:
            type_index[punt_type] = len(punt_types)
            punt_types.append(punt_type)
        if slug not in slug_index:
            slug_index[slug] = len(gemeenten)
            gemeenten.append(slug)
        cols["lon"].append(round(lon * 1e5))
        cols["lat"].append(round(lat * 1e5))
        cols["carrier"].append(carriers.index(props.get("vervoerder", "Unknown")))
        cols["puntType"].append(type_index[punt_type])
        cols["services"].append((1 if props.get("canPickup") else 0) | (2 if props.get("canDropoff") else 0))
        cols["gemeente"].append(slug_index[slug])

    compact = {
        "metadata": metadata,
        "carriers": carriers,
        "puntTypes": punt_types,
        "gemeenten": gemeenten,
        **cols,
    }
    with open(path, "w", encoding="utf-8") as f:
        json.dump(compact, f, ensure_ascii=False, separators=(",", ":"))


def create_national_overview():
    """Combine all municipality GeoJSON files into a national overview"""

    print(f"Creating national overview for {CONFIG['name']}...")

    with open(MUNICIPALITIES_FILE, 'r', encoding='utf-8') as f:
        slugs = [m['slug'] for m in json.load(f)]

    geojson_files = [WEBAPP_DATA_DIR / f"{slug}.geojson" for slug in slugs]
    missing = [f.name for f in geojson_files if not f.exists()]
    geojson_files = [f for f in geojson_files if f.exists()]

    if not geojson_files:
        print("❌ No GeoJSON files found!")
        return
    if missing:
        print(f"⚠️  {len(missing)} municipality files missing: {', '.join(missing[:10])}")

    all_features = []
    feature_slugs = []  # municipality slug per point, for the compact file
    boundary_features = []
    provider_stats = {}

    for geojson_file in geojson_files:
        with open(geojson_file, 'r', encoding='utf-8') as f:
            data = json.load(f)

        # Pakketpunten and boundaries (not buffers)
        for feature in data['features']:
            kind = feature['properties'].get('type')
            if kind == 'pakketpunt':
                all_features.append(feature)
                feature_slugs.append(geojson_file.stem)
                provider = feature['properties'].get('vervoerder', 'Unknown')
                provider_stats[provider] = provider_stats.get(provider, 0) + 1
            elif kind == 'boundary':
                boundary_features.append(feature)

    total_points = len(all_features)
    print(f"\n📊 Processed {len(geojson_files)} municipality files")
    print(f"  Total points: {total_points}")
    for provider, count in sorted(provider_stats.items(), key=lambda x: x[1], reverse=True):
        print(f"    {provider}: {count} points ({count/total_points*100:.1f}%)")

    gdf = gpd.GeoDataFrame.from_features(all_features, crs="EPSG:4326")
    bounds = gdf.total_bounds  # [minx, miny, maxx, maxy]

    national_data = {
        "type": "FeatureCollection",
        "metadata": {
            "gemeente": CONFIG["name"],
            "slug": NATIONAL_SLUG,
            "generated_at": pd.Timestamp.now().isoformat() + "Z",
            "total_points": total_points,
            # Configured carrier order, like the municipality files: the filter
            # panel lists carriers in this order
            "providers": [c for c in CARRIERS if c in provider_stats]
                         + sorted(set(provider_stats) - set(CARRIERS)),
            "bounds": bounds.tolist(),
            "municipalities_included": len(geojson_files),
            "provider_stats": provider_stats
        },
        "features": all_features
    }

    output_file = WEBAPP_DATA_DIR / f"{NATIONAL_SLUG}.geojson"
    with open(output_file, 'w', encoding='utf-8') as f:
        # Compact: this file holds every point in the country
        json.dump(national_data, f, ensure_ascii=False, separators=(',', ':'))

    print(f"\n✅ National overview: {output_file} ({output_file.stat().st_size / 1024 / 1024:.1f} MB)")

    points_file = WEBAPP_DATA_DIR / f"{NATIONAL_SLUG}-points.json"
    write_compact_points(points_file, national_data["metadata"], all_features, feature_slugs)
    print(f"✅ Compact points: {points_file} ({points_file.stat().st_size / 1024 / 1024:.1f} MB)")

    boundaries_data = {
        "type": "FeatureCollection",
        "metadata": {
            "gemeente": CONFIG["name"],
            "slug": f"{NATIONAL_SLUG}-boundaries",
            "generated_at": pd.Timestamp.now().isoformat() + "Z",
            "municipalities_included": len(geojson_files),
            "boundaries_count": len(boundary_features)
        },
        "features": boundary_features
    }

    boundaries_file = WEBAPP_DATA_DIR / f"{NATIONAL_SLUG}-boundaries.geojson"
    with open(boundaries_file, 'w', encoding='utf-8') as f:
        json.dump(boundaries_data, f, ensure_ascii=False, separators=(',', ':'))

    print(f"✅ Boundaries file: {boundaries_file} ({boundaries_file.stat().st_size / 1024 / 1024:.1f} MB)")

    return provider_stats


if __name__ == "__main__":
    create_national_overview()
