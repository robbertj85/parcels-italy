"""
Landconfiguratie voor de pakketpunten-pipeline.

Alles wat per land verschilt (landcodes, projectie, bounding box, welke
vervoerders, parameters per vervoerder) staat hier, zodat de fetch-scripts en
de batch-pipeline landonafhankelijk blijven.

Land kiezen: het bestand webapp/config/active-country (één regel: BE of IT),
dat ook de webapp leest. De env var PAKKETPUNTEN_COUNTRY gaat voor. Het
webapp-profiel staat in webapp/config/countries.ts; houd de twee profielen
gelijk. Een land toevoegen: zie docs/NEW_COUNTRY.md.
"""

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
WEBAPP_DATA_DIR = ROOT / "webapp" / "public" / "data"
MUNICIPALITIES_FILE = DATA_DIR / "municipalities_all.json"
MUNICIPALITY_POLYGONS_FILE = DATA_DIR / "municipality_polygons.geojson"

COUNTRIES = {
    "BE": {
        "iso2": "BE",
        "iso3": "BEL",
        "iso_numeric": 56,
        "name": "België",
        "national_slug": "belgie",
        "national_label": "België (totaal)",
        "all_regions_label": "Alle provincies",
        # Belgian Lambert 2008: metrische berekeningen (buffers, oppervlakte)
        "metric_crs": 3812,
        # (south, west, north, east) in WGS84
        "bbox": (49.49, 2.54, 51.51, 6.41),
        "municipality_code_label": "NIS",
        # Gemeentegrenzen uit OSM (scripts/build_municipalities.py)
        "boundaries": {
            "admin_level": "8",
            "code_tag": "ref:INS",
            # België: één query voor het hele land; provincie volgt uit de NIS-code
            "fetch": "national",
            "region_resolver": "be_nis",
        },
        # Alle vervoerders zijn landelijke caches in data/<carrier>_all_locations.json.
        # Zelfde volgorde als `carriers` in webapp/config/countries.ts (bepaalt
        # de grafiekkleuren daar).
        "carriers": ["bpost", "DHL", "GLS", "InPost", "VintedGo", "PostNL", "DPD", "Amazon", "ViaTim", "FedEx"],
        "dhl": {"country_path": "BE"},
        "dpd": {"country_code": 56},
        "inpost": {"country": "BE"},
        "viatim": {"country": "BE"},
        "postnl": {"country": "bel", "lang": "NL"},
        "vintedgo": {"country": "be"},
        "gls": {"country": "BE", "partner_prefixes": ("GLS_BE",)},
        "amazon": {"domain": "www.amazon.com.be", "locale": "nl-BE"},
    },
    # Italië: profiel klaar, PosteItaliane-fetcher nog te bouwen (zie plan).
    "IT": {
        "iso2": "IT",
        "iso3": "ITA",
        "iso_numeric": 380,
        "name": "Italia",
        "national_slug": "italia",
        "national_label": "Italia (totale)",
        "all_regions_label": "Tutte le regioni",
        # RDN2008 / Italy zone: één metrische projectie voor heel Italië
        # (het land valt in twee UTM-zones)
        "metric_crs": 6875,
        "bbox": (35.49, 6.62, 47.09, 18.52),
        "municipality_code_label": "ISTAT",
        "boundaries": {
            "admin_level": "8",
            "code_tag": "ref:ISTAT",
            # ~7.900 comuni: per regio ophalen, anders time-out Overpass
            "fetch": "per_region",
            "region_admin_level": "4",
            # "Sardigna/Sardegna" -> "Sardegna"
            "name_tag": "name:it",
            "region_resolver": "spatial",
        },
        "carriers": ["PosteItaliane", "DPD", "InPost", "GLS", "DHL", "Amazon"],
        "dhl": {"country_path": "IT"},
        # DPD Italia = BRT: BRT-fermopoint en BRT-lockers zitten in deze feed
        "dpd": {"country_code": 380},
        "inpost": {"country": "IT"},
        "gls": {"country": "IT", "partner_prefixes": ("GLS_IT", "PRP_IT", "QDT_IT")},
        "amazon": {"domain": "www.amazon.it", "locale": "it-IT"},
    },
}

ACTIVE_COUNTRY_FILE = ROOT / "webapp" / "config" / "active-country"
COUNTRY = (
    os.environ.get("PAKKETPUNTEN_COUNTRY")
    or ACTIVE_COUNTRY_FILE.read_text(encoding="utf-8").strip()
).upper()
CONFIG = COUNTRIES[COUNTRY]

ISO2 = CONFIG["iso2"]
METRIC_CRS = CONFIG["metric_crs"]
NATIONAL_SLUG = CONFIG["national_slug"]
CARRIERS = CONFIG["carriers"]


def carrier_cache_file(carrier: str) -> Path:
    """Pad van de landelijke cache van een vervoerder, bv. data/bpost_all_locations.json."""
    return DATA_DIR / f"{carrier.lower()}_all_locations.json"


def in_bbox(lat, lon, margin: float = 0.0) -> bool:
    """True als het punt binnen de (eventueel verruimde) landsbounding box valt."""
    if lat is None or lon is None:
        return False
    south, west, north, east = CONFIG["bbox"]
    return (south - margin) <= lat <= (north + margin) and (west - margin) <= lon <= (east + margin)


def grid_points(spacing_km: float):
    """Raster van (lat, lon) middelpunten over de landsbounding box."""
    south, west, north, east = CONFIG["bbox"]
    lat_step = spacing_km / 111.0
    mid_lat = (south + north) / 2
    import math
    lon_step = spacing_km / (111.0 * math.cos(math.radians(mid_lat)))
    points = []
    lat = south + lat_step / 2
    while lat < north:
        lon = west + lon_step / 2
        while lon < east:
            points.append((round(lat, 5), round(lon, 5)))
            lon += lon_step
        lat += lat_step
    return points
