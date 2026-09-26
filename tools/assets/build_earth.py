"""Build equirectangular Earth textures from public-domain Natural Earth data.

    .venv/bin/python tools/assets/build_earth.py [--size 4096]

Outputs (assets/earth/, all RGB PNG):
  masks.png    R=land, G=ocean depth (0 shore .. 1 = 6000 m), B=ice
  climate.png  R=aridity, G=vegetation density, B=mountain ranges
  relief.png   R=relief height, G=city lights
  albedo.png   sRGB present-day land colour (oceans are shaded in GLSL)

Natural Earth (naturalearthdata.com) is in the public domain. GeoJSON is fetched from
the nvkelso/natural-earth-vector GitHub mirror and cached in out/cache/naturalearth/.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / "out" / "cache" / "naturalearth"
OUT = ROOT / "assets" / "earth"
BASE = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/"


def fetch(name: str) -> dict:
    CACHE.mkdir(parents=True, exist_ok=True)
    p = CACHE / f"{name}.geojson"
    if not p.exists():
        print(f"  downloading {name}")
        urllib.request.urlretrieve(BASE + name + ".geojson", p)
    return json.loads(p.read_text(encoding="utf-8"))


def polys(geom: dict):
    if geom is None:
        return []
    if geom["type"] == "Polygon":
        return [geom["coordinates"]]
    if geom["type"] == "MultiPolygon":
        return geom["coordinates"]
    return []


def lines(geom: dict):
    if geom is None:
        return []
    if geom["type"] == "LineString":
        return [geom["coordinates"]]
    if geom["type"] == "MultiLineString":
        return geom["coordinates"]
    return []


class Raster:
    """Supersampled polygon rasteriser in equirectangular projection."""

    def __init__(self, w: int, h: int, ss: int = 2):
        self.w, self.h, self.ss = w, h, ss
        self.img = Image.new("L", (w * ss, h * ss), 0)
        self.draw = ImageDraw.Draw(self.img)

    def xy(self, ring):
        W, H = self.w * self.ss, self.h * self.ss
        return [((lon + 180.0) / 360.0 * W, (90.0 - lat) / 180.0 * H) for lon, lat, *_ in ring]

    def polygon(self, poly, value=255):
        ext, *holes = poly
        if len(ext) >= 3:
            self.draw.polygon(self.xy(ext), fill=value)
        for hole in holes:
            if len(hole) >= 3:
                self.draw.polygon(self.xy(hole), fill=0)

    def line(self, coords, value=255, width=1):
        pts = self.xy(coords)
        # Skip segments that wrap across the antimeridian.
        seg = [pts[0]]
        for a, b in zip(pts, pts[1:]):
            if abs(a[0] - b[0]) > self.w * self.ss / 2:
                if len(seg) > 1:
                    self.draw.line(seg, fill=value, width=width)
                seg = [b]
            else:
                seg.append(b)
        if len(seg) > 1:
            self.draw.line(seg, fill=value, width=width)

    def array(self) -> np.ndarray:
        img = self.img.resize((self.w, self.h), Image.BOX) if self.ss > 1 else self.img
        return np.asarray(img, dtype=np.float32) / 255.0


def value_noise(h: int, w: int, cells: int, seed: int) -> np.ndarray:
    rs = np.random.RandomState(seed)
    g = rs.rand(cells // 2 + 2, cells + 2).astype(np.float32)
    z = ndimage.zoom(g, (h / (g.shape[0] - 2), w / (g.shape[1] - 2)), order=3, mode="wrap")
    return z[:h, :w]


def fbm(h: int, w: int, seed: int, base=8, octaves=6) -> np.ndarray:
    acc = np.zeros((h, w), np.float32)
    amp, tot = 1.0, 0.0
    for o in range(octaves):
        cells = base * (2**o)
        if cells > w // 2:
            break
        acc += amp * value_noise(h, w, cells, seed + o * 101)
        tot += amp
        amp *= 0.5
    return acc / tot


def blur(a: np.ndarray, px: float) -> np.ndarray:
    return ndimage.gaussian_filter(a, px, mode=("nearest", "wrap"))


def srgb(c):
    return np.array([int(c[i : i + 2], 16) / 255.0 for i in (1, 3, 5)], np.float32)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--size", type=int, default=4096)
    args = ap.parse_args()
    W = args.size
    H = W // 2
    OUT.mkdir(parents=True, exist_ok=True)
    print(f"Building Earth textures {W}x{H}")

    # ---------------------------------------------------------------- land
    r = Raster(W, H)
    for f in fetch("ne_50m_land")["features"]:
        for p in polys(f["geometry"]):
            r.polygon(p)
    for f in fetch("ne_50m_lakes")["features"]:
        for p in polys(f["geometry"]):
            r.polygon(p, 0)
    land = r.array()

    # ---------------------------------------------------------------- ocean depth
    depth = np.zeros((H, W), np.float32)
    for name, meters in [
        ("ne_10m_bathymetry_K_200", 200),
        ("ne_10m_bathymetry_J_1000", 1000),
        ("ne_10m_bathymetry_I_2000", 2000),
        ("ne_10m_bathymetry_H_3000", 3000),
        ("ne_10m_bathymetry_G_4000", 4000),
        ("ne_10m_bathymetry_F_5000", 5000),
        ("ne_10m_bathymetry_E_6000", 6000),
    ]:
        rr = Raster(W, H, 1)
        for f in fetch(name)["features"]:
            for p in polys(f["geometry"]):
                rr.polygon(p)
        m = rr.array()
        depth = np.maximum(depth, m * meters)
    depth = blur(depth, W / 2048.0 * 2.0)
    depth = np.clip(depth / 6000.0, 0, 1) * (1 - land)

    # ---------------------------------------------------------------- ice
    r = Raster(W, H)
    for name in ("ne_50m_glaciated_areas", "ne_50m_antarctic_ice_shelves_polys"):
        for f in fetch(name)["features"]:
            for p in polys(f["geometry"]):
                r.polygon(p)
    ice = r.array()
    # Antarctica is entirely ice-covered at this scale.
    lat = np.linspace(90, -90, H, dtype=np.float32)[:, None] * np.ones((1, W), np.float32)
    ice = np.maximum(ice, land * (lat < -60).astype(np.float32))
    ice = np.clip(blur(ice, W / 4096.0), 0, 1)

    # ---------------------------------------------------------------- deserts / mountains
    regions = fetch("ne_50m_geography_regions_polys")["features"]
    rd = Raster(W, H, 1)
    rm = Raster(W, H, 1)
    for f in regions:
        cls = f["properties"].get("FEATURECLA") or f["properties"].get("featurecla")
        for p in polys(f["geometry"]):
            if cls == "Desert":
                rd.polygon(p)
            elif cls == "Range/mtn":
                rm.polygon(p)
    # Named deserts keep their shapes; edges are broken up with noise.
    n1 = fbm(H, W, 11, base=6, octaves=6)
    n2 = fbm(H, W, 23, base=16, octaves=5)
    n3 = fbm(H, W, 77, base=32, octaves=5)
    desert = blur(rd.array(), W / 4096.0 * 7.0)
    mountains = np.clip(blur(rm.array(), W / 4096.0 * 6.0) * 1.3, 0, 1)

    lon = np.linspace(-180, 180, W, endpoint=False, dtype=np.float32)[None, :] * np.ones((H, 1), np.float32)
    alat = np.abs(lat)

    def region(lo, la, rlo, rla, k):
        d = ((lon - lo) / rlo) ** 2 + ((lat - la) / rla) ** 2
        return k * np.exp(-d * 1.4)

    # Hand-placed climate zones (lon, lat, radius lon, radius lat, strength).
    dry = sum(
        region(*z)
        for z in [
            (10, 23, 26, 8, 1.0), (30, 20, 8, 6, 1.0), (47, 22, 10, 8, 1.0), (58, 30, 10, 6, 0.85),
            (70, 27, 4, 3, 0.7), (65, 44, 20, 6, 0.6), (105, 42, 16, 5, 0.85), (88, 34, 12, 5, 0.55),
            (82, 40, 8, 3, 0.9), (134, -24, 14, 9, 0.95), (122, -28, 6, 6, 0.6), (-113, 37, 7, 6, 0.7),
            (-104, 41, 5, 7, 0.35), (-106, 28, 5, 4, 0.6), (-68, -45, 4, 7, 0.6), (-70, -23, 2, 6, 0.95),
            (20, -24, 7, 6, 0.75), (15, -22, 3, 5, 0.9), (45, 7, 5, 4, 0.6), (-40, -8, 4, 4, 0.45),
            (38, 36, 5, 3, 0.5), (-64, -30, 4, 6, 0.35),
        ]
    )
    wet = sum(
        region(*z)
        for z in [
            (-62, -5, 12, 9, 1.0), (22, 0, 9, 6, 1.0), (105, 2, 18, 9, 0.9), (140, -5, 6, 4, 0.8),
            (-80, 5, 5, 6, 0.6), (80, 22, 8, 7, 0.5), (115, 28, 12, 8, 0.5), (-85, 36, 10, 7, 0.5),
            (15, 50, 15, 8, 0.45), (-45, -22, 6, 6, 0.5),
        ]
    )
    arid = desert * 1.2 + dry * (0.75 + 0.5 * n1)
    arid = np.clip((arid - 0.25 + (n3 - 0.5) * 0.35) * 1.6, 0, 1)
    arid *= land * (1 - ice)

    # Vegetation: wet zones and forest belts, reduced by aridity and cold.
    boreal = np.exp(-(((lat - 58.0) / 7.0) ** 2))
    tropics = np.clip(wet * (0.8 + 0.4 * n2), 0, 1)
    veg = np.clip(0.35 + 0.7 * tropics + 0.45 * boreal + 0.2 * n2 - 1.1 * arid - 0.7 * (alat > 68), 0, 1)
    veg *= land * (1 - ice)
    dist_coast = ndimage.distance_transform_edt(land > 0.5).astype(np.float32) / (W / 360.0)
    interior = np.clip((dist_coast - 4.0) / 12.0, 0, 1)

    # Relief: mountain ranges get ridged detail, continents a gentle rolling height.
    ridge = 1 - np.abs(fbm(H, W, 37, base=24, octaves=6) * 2 - 1)
    height = land * (0.15 * n1 + 0.2 * interior * n2) + mountains * (0.35 + 0.65 * ridge**2)
    height = np.clip(height, 0, 1)

    # ---------------------------------------------------------------- city lights
    lights = np.zeros((H, W), np.float32)
    places = fetch("ne_10m_populated_places_simple")["features"]
    for f in places:
        props = f["properties"]
        pop = float(props.get("pop_max") or props.get("POP_MAX") or 0)
        if pop < 20000:
            continue
        lon, lat_p = f["geometry"]["coordinates"][:2]
        x = (lon + 180.0) / 360.0 * W
        y = (90.0 - lat_p) / 180.0 * H
        rad = (0.8 + 3.2 * (pop / 1e7) ** 0.45) * (W / 4096.0)
        amp = min(1.0, 0.18 + 0.28 * math.log10(max(pop, 1.0) / 2e4 + 1.0))
        k = int(math.ceil(rad * 3))
        x0, x1 = int(x) - k, int(x) + k + 1
        y0, y1 = max(0, int(y) - k), min(H, int(y) + k + 1)
        ys, xs = np.mgrid[y0:y1, x0:x1]
        g = amp * np.exp(-(((xs - x) ** 2 + (ys - y) ** 2) / (2 * rad * rad)))
        lights[y0:y1, np.mod(np.arange(x0, x1), W)] = np.maximum(lights[y0:y1, np.mod(np.arange(x0, x1), W)], g)
    rr = Raster(W, H, 1)
    for f in fetch("ne_10m_roads")["features"]:
        for ln in lines(f["geometry"]):
            if len(ln) > 1:
                rr.line(ln, 255, 1)
    roads = blur(rr.array(), 0.6 * W / 4096.0)
    speckle = np.clip(fbm(H, W, 51, base=64, octaves=4) * 1.8 - 0.7, 0, 1)
    lights = np.clip(lights + 0.22 * roads * (0.5 + speckle), 0, 1) * land * (1 - ice)
    lights = np.clip(blur(lights, 0.5), 0, 1)

    # ---------------------------------------------------------------- albedo
    c_forest = srgb("#1e3a18")
    c_rain = srgb("#14300f")
    c_boreal = srgb("#1f3322")
    c_grass = srgb("#5d6a36")
    c_steppe = srgb("#8c8458")
    c_desert = srgb("#d2ab72")
    c_red = srgb("#b56f3d")
    c_tundra = srgb("#6f6b57")
    c_rock = srgb("#6e6253")
    c_ice = srgb("#eef3f8")
    t = lambda a: a[..., None]
    green = t(tropics) * c_rain + t(1 - tropics) * (t(boreal) * c_boreal + t(1 - boreal) * c_forest)
    col = t(veg) * green + t(1 - veg) * c_grass
    sand = c_desert * t(n2) + c_red * t(1 - n2)
    a1 = t(np.clip(arid * 1.3, 0, 1))
    col = col * (1 - a1) + a1 * (c_steppe * t(np.clip(1 - arid * 1.6, 0, 1)) + t(np.clip(arid * 1.6, 0, 1)) * sand)
    tundra = np.clip((alat - 60.0) / 8.0, 0, 1) * (1 - arid)
    col = col * t(1 - tundra * 0.8) + t(tundra * 0.8) * c_tundra
    col = col * t(1 - mountains * 0.55) + t(mountains * 0.55) * c_rock
    col = col * t(0.82 + 0.36 * n3)
    col = col * t(1 - ice) + t(ice) * c_ice
    col = np.clip(col, 0, 1)

    # ---------------------------------------------------------------- write
    def save(name, *chans):
        arr = np.stack([np.clip(c, 0, 1) for c in chans], axis=-1)
        Image.fromarray((arr * 255 + 0.5).astype(np.uint8)).save(OUT / name, optimize=True)
        print(f"  wrote assets/earth/{name} ({os.path.getsize(OUT / name) / 1e6:.1f} MB)")

    # RGB only: browsers may premultiply PNG alpha on decode, destroying data packed there.
    save("masks.png", land, depth, ice)
    save("climate.png", arid, veg, mountains)
    save("relief.png", height, lights, np.zeros_like(height))
    save("albedo.png", col[..., 0], col[..., 1], col[..., 2])
    (OUT / "README.md").write_text(
        "# Earth textures\n\n"
        "Generated by `tools/assets/build_earth.py` from [Natural Earth](https://www.naturalearthdata.com/) "
        "vector data (public domain): land, lakes, bathymetry, glaciers, geographic regions, populated places "
        "and roads. Equirectangular (longitude -180..180 left to right, latitude 90..-90 top to bottom).\n\n"
        "- `masks.png`: R land, G ocean depth (0..6000 m), B ice\n"
        "- `climate.png`: R aridity, G vegetation, B mountain ranges\n"
        "- `relief.png`: R relief height, G city lights\n"
        "- `albedo.png`: sRGB present-day land colour\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
