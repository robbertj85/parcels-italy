"""
Fetch all Amazon Hub Locker and Counter locations in the configured country.

API: GET https://<amazon domain>/location_selector/fetch_locations
         ?latitude=..&longitude=..&clientId=..&countryCode=..
     The endpoint behind the pickup-point finder (/ulp). It returns 20
     points within ~15 km of a coordinate. With the finder's default
     sortType=RECOMMENDED those are not the 20 nearest (closer points are
     left out), so this asks for sortType=NEAREST. It needs the cookies of a
     browser session, so Playwright opens the store once; the page's own
     first call also gives the clientId. After that every call is a plain
     HTTP request.

Strategy: an adaptive grid over the country (municipality polygons). Each cell
is searched from its centre; if 20 points came back and the 20th is closer
than the cell's corners, the cell may hide more and is split in four. Cells
start at 16 km, so a corner (11.3 km) stays inside the search radius.

The earlier version typed each municipality into the finder: 50 min for
Belgium, ~11 h for Italy's 7,900 comuni, and capped at 20 per search. This
takes minutes and has no cap.

Prerequisites:
    pip install playwright
    playwright install chromium

Usage:
    python scripts/amazon_fetch_all.py
"""

import json
import math
import sys
import threading
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import requests
from shapely.geometry import box, shape
from shapely.strtree import STRtree

try:
    from playwright.sync_api import sync_playwright
except ImportError:
    print("Playwright not installed. Run:")
    print("   pip install playwright")
    print("   playwright install chromium")
    sys.exit(1)

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from country_config import CONFIG, ISO2, MUNICIPALITY_POLYGONS_FILE, carrier_cache_file, in_bbox  # noqa: E402

DOMAIN = CONFIG["amazon"]["domain"]
ULP_URL = f"https://{DOMAIN}/ulp"
API_URL = f"https://{DOMAIN}/location_selector/fetch_locations"
PAGE_CAP = 20
START_CELL_KM = 16
MIN_CELL_KM = 0.25
# The 20 results are near, but not strictly the 20 nearest: a point at 2.0 km
# can be missing while the 20th is at 2.3 km. So a cell only counts as
# complete when its corners lie within this share of the 20th point's distance.
# 0.5 split ~6x more cells for Belgium (CI timed out) and found 1 point more.
TRUST = 0.8
# amazon.it answers 503 at 6 parallel; 3 with a short pause stay under its limit
WORKERS = 3
REQUEST_DELAY = 0.3
MAX_ATTEMPTS = 6
RETRY_ROUNDS = 3
RETRY_PAUSE = 120  # s, times the round

_local = threading.local()


def haversine_km(lat1, lon1, lat2, lon2):
    p = math.radians
    a = math.sin(p(lat2 - lat1) / 2) ** 2 + math.cos(p(lat1)) * math.cos(p(lat2)) * math.sin(p(lon2 - lon1) / 2) ** 2
    return 12742 * math.asin(math.sqrt(a))


USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"
)


def default_client_id():
    """The finder's clientId follows the store: amazon_be_..., amazon_it_..."""
    store = DOMAIN.removeprefix("www.amazon.").split(".")[-1]
    return f"amazon_{store}_add_to_addressbook_mkt_mobile"


def browser_session():
    """Cookies and clientId from a visit to the store and its finder page.

    From a GitHub runner amazon.com.be answered /ulp with a download instead of
    the page ("Download is starting"), so the homepage comes first for the
    session cookies, a failed /ulp load is tolerated, and the clientId falls
    back to the store's pattern when the page made no call.
    """
    client_ids = []

    def on_request(request):
        if "fetch_locations" in request.url:
            client_ids.extend(parse_qs(urlparse(request.url).query).get("clientId", []))

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            locale=CONFIG["amazon"]["locale"], user_agent=USER_AGENT, accept_downloads=True,
        )
        page = context.new_page()
        page.on("request", on_request)
        for url in (f"https://{DOMAIN}/", ULP_URL):
            try:
                page.goto(url, wait_until="domcontentloaded", timeout=60000)
            except Exception as e:  # PlaywrightError: download, timeout, reset
                print(f"   ⚠️  {url}: {str(e).splitlines()[0]}")
                continue
            time.sleep(3)
        for _ in range(20):
            if client_ids:
                break
            time.sleep(0.5)
        cookies = {c["name"]: c["value"] for c in context.cookies()}
        browser.close()

    client_id = client_ids[0] if client_ids else default_client_id()
    return cookies, USER_AGENT, client_id


def country_cells():
    """16 km cells (as lat/lon boxes) that touch a municipality of the country."""
    with open(MUNICIPALITY_POLYGONS_FILE, encoding="utf-8") as f:
        polygons = [shape(feat["geometry"]) for feat in json.load(f)["features"]]
    tree = STRtree(polygons)
    minx = min(p.bounds[0] for p in polygons)
    miny = min(p.bounds[1] for p in polygons)
    maxx = max(p.bounds[2] for p in polygons)
    maxy = max(p.bounds[3] for p in polygons)
    dlat = START_CELL_KM / 111.32
    cells = []
    lat = miny
    while lat < maxy:
        dlon = START_CELL_KM / (111.32 * math.cos(math.radians(lat + dlat / 2)))
        lon = minx
        while lon < maxx:
            cell = box(lon, lat, lon + dlon, lat + dlat)
            if any(polygons[i].intersects(cell) for i in tree.query(cell)):
                cells.append((lat, lon, lat + dlat, lon + dlon))
            lon += dlon
        lat += dlat
    return cells


class Fetcher:
    def __init__(self, cookies, user_agent, client_id):
        self.cookies = cookies
        self.headers = {"User-Agent": user_agent, "Accept": "application/json", "Accept-Language": CONFIG["amazon"]["locale"]}
        self.params = {
            "clientId": client_id, "countryCode": ISO2, "sortType": "NEAREST", "userBenefit": "false",
            "showFreeShippingLabel": "false", "showPromotionDetail": "false", "showAvailableLocations": "false",
        }
        self.lock = threading.Lock()
        self.pause_until = 0.0

    def session(self):
        if not hasattr(_local, "session"):
            _local.session = requests.Session()
            _local.session.headers.update(self.headers)
            _local.session.cookies.update(self.cookies)
        return _local.session

    def search(self, lat, lon):
        params = dict(self.params, latitude=f"{lat:.5f}", longitude=f"{lon:.5f}")
        for attempt in range(MAX_ATTEMPTS):
            # A refusal pauses every worker, not just the one that got it
            wait = self.pause_until - time.time()
            time.sleep(max(wait, 0) + REQUEST_DELAY)
            try:
                resp = self.session().get(API_URL, params=params, timeout=30)
                resp.raise_for_status()
                data = resp.json()
                # A throttled call is valid JSON without points:
                # {"exceptionClassName":"ThrottlingException"}
                if data.get("isErrored") or data.get("exceptionClassName"):
                    raise ValueError(data.get("exceptionClassName") or "isErrored")
                return data.get("locationList") or []
            except (requests.RequestException, ValueError) as e:
                if attempt == MAX_ATTEMPTS - 1:
                    raise RuntimeError(f"{lat:.4f},{lon:.4f}: {e}")
                # 5, 10, 20, 40, 80 s: a 503 is Amazon's rate limit, it needs a real pause
                with self.lock:
                    self.pause_until = max(self.pause_until, time.time() + 5 * 2 ** attempt)

    def try_search(self, cell):
        """(cell, locations), or (cell, None) when Amazon kept refusing it."""
        s, w, n, e = cell
        try:
            return cell, self.search((s + n) / 2, (w + e) / 2)
        except RuntimeError as err:
            print(f"   ⚠️  {err}", flush=True)
            return cell, None


def crawl(fetcher, cells):
    """Search every cell, splitting the crowded ones, until no cell is left."""
    found = {}
    calls = 0
    splits = 0
    level = 0
    while cells:
        level += 1
        with ThreadPoolExecutor(max_workers=WORKERS) as pool:
            results = list(pool.map(fetcher.try_search, cells))
        calls += len(cells)
        # Cells Amazon kept refusing get a few more rounds after a longer pause;
        # only if they still fail is the whole run given up (cache untouched)
        for round_ in range(1, RETRY_ROUNDS + 1):
            failed = [c for c, locs in results if locs is None]
            if not failed:
                break
            print(f"   {len(failed)} searches refused; retrying in {RETRY_PAUSE * round_} s", flush=True)
            time.sleep(RETRY_PAUSE * round_)
            retried = dict(fetcher.try_search(c) for c in failed)
            calls += len(failed)
            results = [(c, retried.get(c, locs)) for c, locs in results]
        failed = [c for c, locs in results if locs is None]
        if failed:
            raise RuntimeError(f"{len(failed)} searches still refused after {RETRY_ROUNDS} retry rounds")
        next_cells = []
        for (s, w, n, e), locations in results:
            clat, clon = (s + n) / 2, (w + e) / 2
            for loc in locations:
                found.setdefault(loc.get("id"), loc)
            if len(locations) < PAGE_CAP:
                continue
            reach = max(haversine_km(clat, clon, l["location"]["latitude"], l["location"]["longitude"]) for l in locations)
            corner = haversine_km(clat, clon, n, e)
            if reach * TRUST >= corner or corner < MIN_CELL_KM:
                continue
            splits += 1
            next_cells += [(s, w, clat, clon), (s, clon, clat, e), (clat, w, n, clon), (clat, clon, n, e)]
        print(f"   level {level}: {len(cells)} searches, {len(found)} points, {len(next_cells)} cells to refine", flush=True)
        cells = next_cells
    return found, calls, splits


def normalize(loc):
    coords = loc.get("location") or {}
    address = loc.get("addressLine1") or loc.get("addressLine2") or ""
    return {
        "id": loc["id"],
        "locatieNaam": loc.get("name", ""),
        "straatNaam": address.strip(),
        "straatNr": "",
        "postcode": loc.get("postalCode", ""),
        "city": loc.get("city", ""),
        "latitude": coords["latitude"],
        "longitude": coords["longitude"],
        "puntType": (loc.get("accessPointType") or "").lower(),
        "apisType": loc.get("apisAccessPointType", ""),
        "vervoerder": "Amazon",
    }


def main():
    print("=" * 80)
    print("AMAZON HUB COMPLETE LOCATION FETCH")
    print("=" * 80)
    print(f"Time: {datetime.now():%Y-%m-%d %H:%M:%S}")

    started = time.time()
    cookies, user_agent, client_id = browser_session()
    print(f"🌐 {ULP_URL}: session ok, clientId {client_id}")

    cells = country_cells()
    print(f"📍 {len(cells)} cells of {START_CELL_KM} km, {WORKERS} parallel\n")

    try:
        found, calls, splits = crawl(Fetcher(cookies, user_agent, client_id), cells)
    except RuntimeError as e:
        print(f"❌ Search failed ({e}); cache not updated")
        return 1

    locations = []
    for loc in found.values():
        try:
            record = normalize(loc)
        except (KeyError, TypeError):
            continue
        if loc.get("countryCode", ISO2) == ISO2 and in_bbox(record["latitude"], record["longitude"]):
            locations.append(record)

    print(f"\n✅ {len(locations)} Amazon locations ({calls} searches, {splits} splits, {(time.time() - started) / 60:.1f} min)")
    for punt_type, count in Counter(loc["puntType"] for loc in locations).most_common():
        print(f"   {punt_type:15s}: {count:6d}")

    if not locations:
        print("❌ No locations fetched")
        return 1

    from cache_guard import safe_save
    safe_save(
        carrier="Amazon",
        new_locations=locations,
        output_path=carrier_cache_file("Amazon"),
        metadata={
            "method": "adaptive-grid",
            "source": API_URL,
            "country": CONFIG["name"],
            "searches": calls,
        },
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
