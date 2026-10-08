"""Generates AppIcon.icns: the PawPad bunny-controller (cream body, floppy ears, ochre eyes, coral touchpad) on a mint tile with stepped corners.
Run: python3 make_icon.py   (needs only macOS sips + iconutil)"""
import struct, zlib, subprocess, os, shutil

G, S = 32, 32  # 32x32 chunky grid, each cell 32px -> 1024px master

def hexc(h):
    return tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))

# ---- the controller sprite (22 x 16 cells) ----------------------------------------------------
SW, SH = 24, 16
INK, BODY, HI, LO = '#4a3228', '#efe6d6', '#fbf6ec', '#cdb999'
GOLD, GOLD_LO = '#e0907e', '#b8665a'   # coral touchpad
EYE, BLUSH, EAR_IN = '#b58b4c', '#f2a39a', '#f0c4b8'
sprite = {}  # (x, y) -> colour

def put(x, y, c):
    sprite[(x, y)] = c

def rect(x, y, w, h, c):
    for yy in range(y, y + h):
        for xx in range(x, x + w):
            put(xx, yy, c)

def mirror(x):
    return SW - 1 - x

mask = set()
def body_rect(x, y, w, h):
    mask.update((xx, yy) for yy in range(y, y + h) for xx in range(x, x + w))

body_rect(1, 3, 22, 10)           # main body
body_rect(1, 12, 5, 4)            # left grip
body_rect(18, 12, 5, 4)           # right grip
for cx, cy in [(1, 3), (22, 3), (1, 15), (22, 15), (5, 15), (18, 15), (1, 14), (22, 14)]:
    mask.discard((cx, cy))        # chamfered corners
body_rect(3, 2, 4, 1)             # L1 / R1
body_rect(17, 2, 4, 1)
for x, y in mask:
    put(x, y, BODY)
for x in range(1, 23):            # light top edge, dark bottom edge
    if (x, 3) in mask: put(x, 3, HI)
for x, y in list(mask):
    if (x, y + 1) not in mask and y >= 12: put(x, y, LO)
for x in (3, 4, 5, 6, 17, 18, 19, 20):
    put(x, 2, HI)
for x in range(6, 18):            # shade under the body between the grips
    if (x, 12) in mask: put(x, 12, LO)

# floppy bunny ears: arch up from the touchpad corners, then hang down over the shoulders (drawn over the body)
EAR_L = [(8, 0), (9, 0), (7, 1), (8, 1), (9, 1), (10, 1), (6, 2), (7, 2), (8, 2), (9, 2), (10, 2),
         (6, 3), (7, 3), (8, 3), (7, 4), (8, 4)]
EAR_IN_CELLS = {(8, 1), (8, 2), (8, 3)}
ear_cells = {p for x, y in EAR_L for p in ((x, y), (mirror(x), y))}
for x, y in ear_cells:           # ink line where an ear lies over the body
    for n in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
        if n in sprite and n not in ear_cells:
            put(n[0], n[1], INK)
for x, y in EAR_L:
    c = EAR_IN if (x, y) in EAR_IN_CELLS else HI
    put(x, y, c); put(mirror(x), y, c)

rect(9, 3, 6, 3, GOLD); rect(9, 5, 6, 1, GOLD_LO)        # touchpad

# d-pad (left): crisp plus; face buttons (right): four 2x2 blocks
rect(2, 6, 5, 1, '#ffffff'); rect(4, 4, 1, 5, '#ffffff'); rect(4, 8, 1, 1, '#b8b8c8')
for (x, y), c in {(18, 4): '#4fae7b', (16, 6): '#e873ae', (20, 6): '#e0606e', (18, 8): '#5a8fd8'}.items():
    rect(x, y, 2, 2, c)

# sticks: soft cheeks with a blush dot; two small eyes between them
for cx in (8, 15):
    rect(cx - 1, 9, 3, 3, '#e3d3b8')
    put(cx, 10, BLUSH)
put(10, 8, EYE); put(13, 8, EYE)

# ink outline around everything
solid = set(sprite)
for x, y in solid:
    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        n = (x + dx, y + dy)
        if n not in solid and 0 <= n[0] < SW and 0 <= n[1] < SH:
            sprite.setdefault(n, INK)
# ---------------------------------------------------------------------------------------------

def tile(x, y):  # squircle, half-size 14 cells around the grid centre
    return abs(x + 0.5 - 16) ** 5 + abs(y + 0.5 - 16) ** 5 <= 14 ** 5

def band(y):     # gold in three flat bands (no gradient: it's pixel art)
    return '#9fdcab' if y < 12 else '#82c58f' if y < 21 else '#6fb07c'

cells = {}
for y in range(G):
    for x in range(G):
        if tile(x, y):
            c = band(y)
            if not tile(x, y - 1): c = '#dcf5e1'      # top rim
            elif not tile(x, y + 1): c = '#4a8559'    # bottom edge
            cells[(x, y)] = c

OX, OY = (G - SW) // 2, (G - SH) // 2 + 1
sprite_cells = {(x + OX, y + OY) for (x, y) in sprite}
for (x, y), c in sprite.items():          # hard drop shadow one cell down
    p = (x + OX, y + OY + 1)
    if p in cells and cells[p] not in ('#dcf5e1', '#4a8559'): cells[p] = '#5d9c6a'
for (x, y), c in sprite.items():
    p = (x + OX, y + OY)
    if p in cells: cells[p] = c
for p in [(5, 8), (26, 6), (4, 23), (27, 21), (23, 27), (8, 27), (12, 4), (21, 4)]:   # pale pebbles, like the brand art
    if p in cells and p not in sprite_cells and cells[p] in ('#9fdcab', '#82c58f', '#6fb07c'): cells[p] = '#d6dfb8'

def png(path, w, h, rows):
    raw = b''.join(b'\x00' + r for r in rows)
    chunk = lambda t, d: struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    open(path, 'wb').write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)) +
                           chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))

rows = []
for y in range(G):
    line = b''.join((bytes(hexc(cells[(x, y)])) + b'\xff' if (x, y) in cells else b'\0\0\0\0') * S for x in range(G))
    rows += [line] * S
here = os.path.dirname(os.path.abspath(__file__))
master = os.path.join(here, 'icon_1024.png')
png(master, G * S, G * S, rows)

iconset = os.path.join(here, 'AppIcon.iconset')
shutil.rmtree(iconset, ignore_errors=True)
os.makedirs(iconset)
for base in (16, 32, 128, 256, 512):
    for scale in (1, 2):
        px = base * scale
        out = os.path.join(iconset, f'icon_{base}x{base}{"@2x" if scale == 2 else ""}.png')
        subprocess.run(['sips', '-z', str(px), str(px), master, '--out', out], check=True, capture_output=True)
subprocess.run(['iconutil', '-c', 'icns', iconset, '-o', os.path.join(here, 'AppIcon.icns')], check=True)
print('icon written')
