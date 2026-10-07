"""Optional local static server.

The site reads the CORS-enabled Esri Active Hurricanes service, so GitHub Pages
does not need this proxy. The /api routes remain for direct NHC file access.
"""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import io
import json
import re
import threading
import time
import urllib.parse
import urllib.request
import zipfile
import xml.etree.ElementTree as ET

NHC_STORMS = "https://www.nhc.noaa.gov/CurrentStorms.json"
STORMS_PATH = "/api/CurrentStorms.json"
FORECAST_PATH = "/api/forecast"
CACHE_SECONDS = 300
CACHE = {}
CACHE_LOCK = threading.Lock()


def local_name(tag):
    return tag.split("}")[-1]


def parse_coordinates(text):
    points = []
    for token in (text or "").split():
        parts = token.split(",")
        if len(parts) < 2:
            continue
        try:
            points.append([float(parts[0]), float(parts[1])])
        except ValueError:
            continue
    return points


def close_ring(points):
    if len(points) >= 3 and points[0] != points[-1]:
        return points + [points[0]]
    return points


def element_text(element):
    return " ".join("".join(element.itertext()).split())


def extended_data(placemark):
    values = {}
    for node in placemark.iter():
        if local_name(node.tag) != "Data":
            continue
        key = node.attrib.get("name")
        value_node = next((child for child in node if local_name(child.tag) == "value"), None)
        if key and value_node is not None and value_node.text:
            values[key] = value_node.text.strip()
    return values


def forecast_fields(description):
    clean = " ".join(re.sub(r"<[^>]+>", " ", description).split())
    hour_match = re.search(r"(\d+)\s*hr Forecast", clean, re.I)
    valid_match = re.search(r"Valid at:\s*(.+?)(?:\s+Location:|$)", clean, re.I)
    wind_match = re.search(r"Maximum Wind:\s*(.+?)(?:\s+Wind Gusts:|$)", clean, re.I)
    return {
        "hour": int(hour_match.group(1)) if hour_match else None,
        "valid": valid_match.group(1).strip() if valid_match else None,
        "wind": wind_match.group(1).strip() if wind_match else None,
    }


def placemark_features(placemark):
    description = ""
    for node in placemark:
        if local_name(node.tag) == "description":
            description = element_text(node)
            break
    fields = forecast_fields(description)
    meta = extended_data(placemark)
    features = []

    for node in placemark.iter():
        kind = local_name(node.tag)
        if kind == "LineString":
            coords_node = next((child for child in node if local_name(child.tag) == "coordinates"), None)
            points = parse_coordinates(coords_node.text if coords_node is not None else "")
            hours = fields["hour"]
            if meta.get("fcstpd", "").isdigit():
                hours = int(meta["fcstpd"])
            if len(points) >= 2:
                features.append({
                    "type": "Feature",
                    "geometry": {"type": "LineString", "coordinates": points},
                    "properties": {"kind": "track", "hours": hours},
                })
        elif kind == "Point":
            if fields["hour"] is None:
                continue
            coords_node = next((child for child in node if local_name(child.tag) == "coordinates"), None)
            points = parse_coordinates(coords_node.text if coords_node is not None else "")
            if len(points) != 1:
                continue
            features.append({
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": points[0]},
                "properties": {
                    "kind": "point",
                    "hour": fields["hour"],
                    "valid": fields["valid"],
                    "wind": fields["wind"],
                    "label": str(fields["hour"]) + "h",
                },
            })
        elif kind == "Polygon":
            rings = []
            for coords_node in node.iter():
                if local_name(coords_node.tag) != "coordinates":
                    continue
                points = close_ring(parse_coordinates(coords_node.text or ""))
                if len(points) >= 4:
                    rings.append(points)
            if rings:
                features.append({
                    "type": "Feature",
                    "geometry": {"type": "Polygon", "coordinates": rings},
                    "properties": {"kind": "cone"},
                })
    return features


def kmz_to_geojson(payload):
    archive = zipfile.ZipFile(io.BytesIO(payload))
    kml_name = next(name for name in archive.namelist() if name.lower().endswith(".kml"))
    root = ET.fromstring(archive.read(kml_name))
    features = []
    for placemark in root.iter():
        if local_name(placemark.tag) == "Placemark":
            features.extend(placemark_features(placemark))
    return {"type": "FeatureCollection", "features": features}


def allowed_kmz(url):
    parsed = urllib.parse.urlparse(url)
    return (
        parsed.scheme == "https"
        and parsed.netloc == "www.nhc.noaa.gov"
        and parsed.path.endswith(".kmz")
        and not parsed.username
    )


def fetch_bytes(url):
    now = time.time()
    with CACHE_LOCK:
        cached = CACHE.get(url)
        if cached and now - cached[0] < CACHE_SECONDS:
            return cached[1]
    request = urllib.request.Request(url, headers={"User-Agent": "BadgerHurricaneTracker"})
    with urllib.request.urlopen(request, timeout=25) as response:
        payload = response.read()
    with CACHE_LOCK:
        CACHE[url] = (time.time(), payload)
    return payload


def json_bytes(payload):
    return json.dumps(payload).encode("utf-8")


class Handler(SimpleHTTPRequestHandler):
    def guess_type(self, path):
        ctype = super().guess_type(path)
        if ctype.startswith("text/") or ctype in ("application/javascript", "application/json"):
            if "charset=" not in ctype:
                return ctype + "; charset=utf-8"
        return ctype

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == STORMS_PATH:
            self.proxy_storms()
            return
        if parsed.path == FORECAST_PATH:
            query = urllib.parse.parse_qs(parsed.query)
            self.proxy_forecast((query.get("kmz") or [None])[0])
            return
        super().do_GET()

    def send_json(self, status, payload):
        body = json_bytes(payload)
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(body)

    def proxy_storms(self):
        try:
            self.send_json(200, json.loads(fetch_bytes(NHC_STORMS).decode("utf-8")))
        except Exception:
            self.send_json(502, {"error": "storm data unavailable"})

    def proxy_forecast(self, kmz_url):
        if not kmz_url or not allowed_kmz(kmz_url):
            self.send_json(400, {"error": "A National Hurricane Center KMZ url is required"})
            return
        try:
            self.send_json(200, kmz_to_geojson(fetch_bytes(kmz_url)))
        except Exception:
            self.send_json(502, {"error": "forecast data unavailable"})


if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", 8080), Handler)
    print("Serving http://127.0.0.1:8080/index.html")
    server.serve_forever()
