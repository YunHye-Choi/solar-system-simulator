#!/usr/bin/env python3

"""Build earth-data.js: a small RGB map used by the simulator for Earth.

R = land fraction (Natural Earth land polygons, public domain, via the
    `world-atlas` npm package: land-50m.json)
G = mountain-ness (hand-placed major ranges)
B = aridity (hand-placed major deserts)

Usage: python3 tools/build_earth.py path/to/land-50m.json
"""
import base64
import io
import json
import math
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

W, H = 1024, 512
SS = 3  # supersampling factor for the land mask

# (strength, half-width in degrees, [(lon, lat), ...])
RANGES = [
    (1.00, 2.6, [(73, 36), (80, 31), (88, 28), (97, 28)]),            # Himalaya
    (0.70, 4.5, [(80, 34), (90, 33), (98, 33)]),                       # Tibet
    (0.80, 2.2, [(67, 35), (72, 38), (80, 42), (88, 43)]),            # Hindu Kush, Pamir, Tien Shan
    (0.50, 1.8, [(87, 49), (96, 46)]),                                 # Altai
    (0.90, 1.6, [(-72, 10), (-78, 0), (-77, -10), (-70, -18), (-70, -33), (-72, -45), (-70, -52)]),  # Andes
    (0.70, 2.4, [(-150, 62), (-135, 60), (-120, 52), (-114, 46), (-106, 39), (-105, 33)]),  # Rockies
    (0.60, 1.3, [(-122, 48), (-121, 41), (-118.5, 36.5)]),             # Cascades, Sierra Nevada
    (0.50, 1.6, [(-107, 28), (-100, 19)]),                             # Sierra Madre
    (0.40, 1.2, [(-92, 15), (-83, 9)]),                                # Central America
    (0.25, 1.5, [(-84, 34), (-72, 44)]),                               # Appalachians
    (0.70, 1.2, [(6, 45), (10, 46.5), (14, 47)]),                      # Alps
    (0.50, 0.9, [(-1.5, 42.7), (2.5, 42.5)]),                          # Pyrenees
    (0.40, 1.2, [(18, 49), (25, 47), (26, 45.5)]),                     # Carpathians
    (0.40, 1.3, [(6, 60), (15, 67), (22, 69.5)]),                      # Scandinavian
    (0.70, 1.0, [(40, 43.5), (48, 41.5)]),                             # Caucasus
    (0.50, 1.6, [(30, 37), (36, 38), (42, 39)]),                       # Anatolia
    (0.60, 1.8, [(46, 36), (51, 32), (56, 28)]),                       # Zagros
    (0.50, 1.0, [(50, 36.5), (56, 37)]),                               # Alborz
    (0.50, 1.4, [(-8, 31), (5, 35)]),                                  # Atlas
    (0.30, 1.0, [(59, 52), (60, 66)]),                                 # Urals
    (0.40, 2.5, [(125, 62), (140, 65), (160, 64)]),                    # East Siberia
    (0.50, 1.0, [(158, 53), (162, 58)]),                               # Kamchatka
    (0.50, 0.9, [(131, 33), (138, 36), (141, 40), (143, 43)]),         # Japan
    (0.40, 0.7, [(128.6, 35.5), (128.2, 38.5), (127.5, 41)]),          # Taebaek / Korea
    (0.60, 2.2, [(38, 13), (39, 8)]),                                  # Ethiopian highlands
    (0.40, 1.4, [(36, -1), (33, -6), (30, -9)]),                       # East African rift
    (0.40, 1.3, [(29, -30), (30, -27)]),                               # Drakensberg
    (0.30, 1.2, [(146, -37), (152, -28), (145, -17)]),                 # Great Dividing Range
    (0.60, 0.8, [(168, -45), (172, -42)]),                             # Southern Alps
    (0.60, 1.0, [(137, -4), (146, -6)]),                               # New Guinea
    (0.40, 1.0, [(96, 5), (101, -1), (105, -5)]),                      # Sumatra
    (0.30, 0.9, [(74, 18), (77, 9)]),                                  # Western Ghats
    (0.20, 3.5, [(-46, -19), (-42, -15)]),                             # Brazilian highlands
    (0.35, 1.5, [(100, 27), (103, 22)]),                               # Yunnan / Hengduan
    (0.50, 1.5, [(160, -72), (175, -80), (-160, -85)]),                # Transantarctic
]

# (strength, lon, lat, lon radius, lat radius) in degrees
DESERTS = [
    (1.0, 9, 23, 26, 7.5),     # Sahara
    (0.9, 46, 23, 8, 7),       # Arabia
    (0.7, 60, 30, 6, 4),       # Iran / Baluchistan
    (0.6, 71, 27, 3, 3),       # Thar
    (0.8, 83, 39, 7, 3),       # Taklamakan
    (0.7, 104, 42, 9, 3.5),    # Gobi
    (0.6, 61, 42, 8, 4),       # Central Asia
    (0.9, 131, -25, 12, 6),    # Australian interior
    (0.7, 20, -24, 5, 5),      # Kalahari / Namib
    (0.9, -70, -23, 1.4, 6),   # Atacama
    (0.5, -68, -44, 3, 6),     # Patagonia
    (0.7, -112, 31, 6, 5),     # Sonora / Mojave
]


def decode_land(path):
    topo = json.loads(Path(path).read_text())
    sx, sy = topo["transform"]["scale"]
    tx, ty = topo["transform"]["translate"]
    arcs = []
    for arc in topo["arcs"]:
        x = y = 0
        pts = []
        for dx, dy in arc:
            x += dx
            y += dy
            pts.append((x * sx + tx, y * sy + ty))
        arcs.append(pts)

    def ring(idxs):
        out = []
        for i in idxs:
            pts = arcs[i] if i >= 0 else arcs[~i][::-1]
            out.extend(pts if not out else pts[1:])
        return out

    polys = []

    def walk(geom):
        t = geom["type"]
        if t == "GeometryCollection":
            for g in geom["geometries"]:
                walk(g)
        elif t == "Polygon":
            polys.append([ring(r) for r in geom["arcs"]])
        elif t == "MultiPolygon":
            for poly in geom["arcs"]:
                polys.append([ring(r) for r in poly])

    walk(topo["objects"]["land"])
    return polys


def land_mask(polys):
    w, h = W * SS, H * SS
    img = Image.new("L", (w, h), 0)
    draw = ImageDraw.Draw(img)

    def px(pt):
        return ((pt[0] + 180.0) / 360.0 * w, (90.0 - pt[1]) / 180.0 * h)

    def fill(pts, value):
        if len(pts) < 3:
            return
        # Unwrap rings that cross the antimeridian so they fill as one piece.
        out, shift, crossed = [pts[0]], 0.0, False
        for prev, cur in zip(pts, pts[1:]):
            jump = cur[0] - prev[0]
            if abs(jump) > 180.0 and min(prev[1], cur[1]) > -89.9:  # the south-pole edge is a real seam
                shift -= math.copysign(360.0, jump)
                crossed = True
            out.append((cur[0] + shift, cur[1]))
        pts = out
        if crossed:
            for off in (-360.0, 360.0):
                draw.polygon([px((p[0] + off, p[1])) for p in pts], fill=value)
        draw.polygon([px(p) for p in pts], fill=value)

    for rings in polys:
        fill(rings[0], 255)
    for rings in polys:
        for hole in rings[1:]:
            fill(hole, 0)
    # Morphological opening drops the 1px seams left by rings cut at the antimeridian.
    img = img.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.MaxFilter(3))
    img = img.resize((W, H), Image.LANCZOS)
    return img.filter(ImageFilter.GaussianBlur(1.1))


def dlon(a, b):
    d = (a - b + 180.0) % 360.0 - 180.0
    return d


def seg_dist(lon, lat, a, b):
    """Distance in degrees (lon scaled by cos lat) from point to segment a-b."""
    k = math.cos(math.radians(lat))
    ax, ay = dlon(a[0], lon) * k, a[1] - lat
    bx, by = ax + dlon(b[0], a[0]) * k, b[1] - lat
    vx, vy = bx - ax, by - ay
    vv = vx * vx + vy * vy
    t = 0.0 if vv == 0 else max(0.0, min(1.0, -(ax * vx + ay * vy) / vv))
    px, py = ax + vx * t, ay + vy * t
    return math.hypot(px, py)


def feature_maps():
    w, h = 256, 128
    mnt = Image.new("L", (w, h), 0)
    des = Image.new("L", (w, h), 0)
    mp, dp = mnt.load(), des.load()
    for j in range(h):
        lat = 90.0 - (j + 0.5) / h * 180.0
        for i in range(w):
            lon = (i + 0.5) / w * 360.0 - 180.0
            m = 0.0
            for s, hw, pts in RANGES:
                d = min(seg_dist(lon, lat, pts[n], pts[n + 1]) for n in range(len(pts) - 1))
                m = max(m, s * math.exp(-(d / hw) ** 2))
            a = 0.0
            for s, clon, clat, rl, rt in DESERTS:
                k = math.cos(math.radians(lat))
                q = (dlon(lon, clon) * k / (rl * math.cos(math.radians(clat)))) ** 2 + ((lat - clat) / rt) ** 2
                a = max(a, s * math.exp(-q * q))
            mp[i, j] = int(round(min(1.0, m) * 255))
            dp[i, j] = int(round(min(1.0, a) * 255))
    return mnt.resize((W, H), Image.BICUBIC), des.resize((W, H), Image.BICUBIC)


def main():
    src = sys.argv[1]
    land = land_mask(decode_land(src))
    mnt, des = feature_maps()
    img = Image.merge("RGB", (land, mnt, des))
    buf = io.BytesIO()
    img.save(buf, "PNG", optimize=True)
    out = Path(__file__).resolve().parent.parent / "earth-data.js"
    b64 = base64.b64encode(buf.getvalue()).decode()
    out.write_text(
        "// Generated by tools/build_earth.py. Land mask: Natural Earth (public domain).\n"
        f'window.EARTH_PNG="data:image/png;base64,{b64}";\n'
    )
    preview = Path(sys.argv[2]) if len(sys.argv) > 2 else None
    if preview:
        img.save(preview)
    print(f"wrote {out} ({len(b64) // 1024} KiB base64)")


if __name__ == "__main__":
    main()
