/**
 * Pixel-art controller, drawn rect by rect on a canvas (no images, no smoothing).
 * Looks: classic / fine (2x denser grid) / cat; layouts: normal / wide.
 * Every button has two states (idle / pressed); L2 and R2 show analog pressure
 * as a bar meter plus a 0-100 readout (level), or as a button that squeezes down (squeeze).
 * Bun and Cat can also bulge the squeezed triggers (bulge) and squish every pressed button (squish).
 * Entry points: RetroPad.setStyle(...) and RetroPad.draw(state, leftStick, rightStick).
 */
(function () {
  'use strict';

  // Layouts: canvas size + crop origin, and a per-group (dx, dy) shift applied on top of the normal positions.
  // Wide puts everything in one row (triggers/bumpers at the ends); it keeps the same canvas box in OBS,
  // so the Browser Source size does not change between layouts.
  const SHIFT0 = { lt: [0, 0], rt: [0, 0], dpad: [0, 0], share: [0, 0], ls: [0, 0], pad: [0, 0], rs: [0, 0], options: [0, 0], face: [0, 0] };
  const LAYOUTS = {
    normal: { W: 122, H: 70, OX: 20, OY: 1, g: SHIFT0 },
    wide: {
      W: 220, H: 32, OX: 0, OY: 0,
      g: { lt: [-21, 2], rt: [80, 2], dpad: [1, -31], share: [1, -19], ls: [13, -40], pad: [26, -22], rs: [39, -40], options: [51, -19], face: [54, -29] }
    }
  };
  // Xbox arrangement: staggered sticks (left stick up, d-pad and right stick lower), View / Guide / Menu in the middle.
  // Shifts are relative to the same base positions as above. The Guide button takes the touchpad's slot ('pad' group).
  const XBOX = {
    normal: { lt: [0, 0], rt: [0, 0], dpad: [30, 11], share: [14, -1], ls: [-24, -14], pad: [0, -8], rs: [-4, 2], options: [-14, -1], face: [0, -3] },
    wide: { W: 200, g: { lt: [-21, 2], rt: [60, 2], dpad: [28, -31], share: [28, -19], ls: [-24, -40], pad: [16, -22], rs: [30, -40], options: [4, -19], face: [34, -29] } }
  };
  const GAP = { ps: 35, xbox: 15 }; // room the touchpad / Guide button takes in the wide row (width + gap)
  let W = 122, H = 70, OX = 20, OY = 1, G = SHIFT0, showPad = true, wideLayout = false, xbox = false; // canvas is cropped tight to the buttons
  const C = {
    ink: '#000000',
    gray: '#3a3a4a', grayHi: '#8a8a9c', grayLo: '#1f1f2a', white: '#ffffff',
    yellow: '#fcd000', gold: '#fcb000', brown: '#8b4a1b',
    empty: '#14141c',
    text: '#ffffff', capFill: null, capHi: null, capLo: null, bean: '#ff9fb0', dim: null,
    on: '#fcd000', onHi: '#ffffff', onLo: '#fcb000',      // "pressed" colours of bumpers, pills, d-pad arms
    tri: '#43b047', cir: '#ff4d6d', crs: '#2e8bff', sqr: '#ff5fc4', yel: '#fcd000', // face button colours
    m1: '#43b047', m2: '#fcd000', m3: '#e52521',          // L2/R2 meter: low / mid / high
    pad: null, padHi: null, padLo: null, blush: '#f2a39a', earIn: '#f0c4b8'
  };
  const BASE = { ...C };
  // Cat preset coats: body = gray parts of the pad; cap = stick cap (defaults to body); bean = paw pads.
  const COATS = {
    pumpkin: { gray: '#d9822b', grayHi: '#f5b061', grayLo: '#8f4a12', bean: '#ffb3c1' },
    shadow: { gray: '#2b2b33', grayHi: '#5a5a70', grayLo: '#121217', bean: '#ff7fa3' },
    snowball: { gray: '#e6e6ee', grayHi: '#ffffff', grayLo: '#a9a9bb', bean: '#ff9fb5', text: '#3a3a4a' },
    smokey: { gray: '#7d8794', grayHi: '#b0b9c4', grayLo: '#4b5360', bean: '#ffa9bc' },
    mittens: { gray: '#e3d2b2', grayHi: '#f6ead2', grayLo: '#a88f68', bean: '#e58f9d',
      capFill: '#6b4f3a', capHi: '#8f705a', capLo: '#3f2c20', text: '#4a3a2a' }
  };
  // Bun preset: the Mr Bun tiramisu bunny (cream body, cocoa outlines, coral touchpad, ochre eyes).
  const BUN = {
    ink: '#4a3228', gray: '#efe6d6', grayHi: '#fbf6ec', grayLo: '#cdb999', dim: '#b9a688', text: '#5a3d33', empty: '#6b5043',
    on: '#f0907a', onHi: '#ffd6ca', onLo: '#c9654f', brown: '#a85a4e',
    tri: '#4fae7b', cir: '#e0606e', crs: '#5a8fd8', sqr: '#e873ae', yel: '#e8b84a',
    m1: '#7fbf8a', m2: '#f2c75c', m3: '#d9645a',
    pad: '#e0907e', padHi: '#f2b5a6', padLo: '#b8665a', blush: '#f2a39a', earIn: '#f0c4b8'
  };

  const SPRITES = {
    triangle: ['...#...', '..#.#..', '..#.#..', '.#...#.', '.#...#.', '#######'],
    circle: ['..###..', '.#...#.', '#.....#', '#.....#', '#.....#', '.#...#.', '..###..'],
    cross: ['#.....#', '.#...#.', '..#.#..', '...#...', '..#.#..', '.#...#.', '#.....#'],
    square: ['#######', '#.....#', '#.....#', '#.....#', '#.....#', '#.....#', '#######']
  };
  const DIGITS = [
    '###,#.#,#.#,#.#,###', '.#.,##.,.#.,.#.,###', '###,..#,###,#..,###', '###,..#,###,..#,###',
    '#.#,#.#,###,..#,..#', '###,#..,###,..#,###', '###,#..,###,#.#,###', '###,..#,..#,..#,..#',
    '###,#.#,###,#.#,###', '###,#.#,###,..#,###'
  ].map(d => d.split(','));
  // Button names: 3x5 letters (digits come from DIGITS). Drawn on 1-unit cells, so every style reads the same.
  const NAME_FONT = { L: '#..,#..,#..,#..,###', R: '##.,#.#,##.,#.#,#.#', T: '###,.#.,.#.,.#.,.#.', B: '##.,#.#,##.,#.#,##.' };
  const nameGlyph = ch => (NAME_FONT[ch] ? NAME_FONT[ch].split(',') : DIGITS[+ch]);

  // Face symbols for fine mode, built on the 0.5 grid (14 px wide, 2 px stroke).
  const grid = (w, h, on) => Array.from({ length: h }, (_, j) => Array.from({ length: w }, (_, i) => (on(i, j) ? '#' : '.')).join(''));
  const FINE_SYMBOLS = {
    circle: grid(14, 14, (i, j) => { const d = Math.hypot(i - 6.5, j - 6.5); return d <= 7 && d > 5; }),
    square: grid(14, 14, (i, j) => i < 2 || i > 11 || j < 2 || j > 11),
    cross: grid(14, 14, (i, j) => Math.abs(i - j) <= 1 || Math.abs(i + j - 13) <= 1),
    triangle: grid(14, 12, (i, j) => { const c = Math.abs(i - 6.5), w = 0.5 + j * 6.5 / 11; return j >= 10 ? c <= w : c <= w && w - c < 2; })
  };

  // Cat paw printed on the stick cap (14x12 on the 0.5 grid); flattened and spread when pressed.
  const PAW = [
    '......##....##......', '.....####..####.....', '.....####..####.....', '.....####..####.....',
    '......##....##......', '.##..............##.', '####............####', '####............####',
    '####...######...####', '.##...########...##.', '....############....', '...##############...',
    '...##############...', '....############....', '.....##########.....', '.......######.......'
  ];
  const PAW_SQUISH = [
    '.....####....####.....', '.....####....####.....', '.....####....####.....', '.##................##.',
    '####..............####', '####..##########..####', '.##..############..##.', '...################...',
    '..##################..', '...################...', '....##############....', '......##########......'
  ];

  // Bunny paw on the stick cap (0.5 grid): four small round toes and a soft round pad; flattened and spread when pressed.
  const BUN_PAW = [
    '....##......##....', '...####....####...', '...####....####...', '....##......##....',
    '.#..............#.', '###............###', '###...######...###', '.#...########...#.',
    '....##########....', '....##########....', '....##########....', '.....########.....',
    '......######......', '.......####.......'
  ];
  const BUN_PAW_SQUISH = [
    '...##..........##...', '..####........####..', '..####........####..', '.#................#.',
    '###..............###', '###...########...###', '....############....', '...##############...',
    '...##############...', '....############....', '.....##########.....'
  ];
  // Floppy ear: a tapered tube along a curve that rises from the touchpad corner, arches over and hangs down the outside.
  // Built once as cells (units relative to the base point) with an ink outline; mirrored for the right ear.
  const makeEar = (p1, p2, r0, r1) => {
    const S = 0.5, cells = new Map();
    for (let i = 0; i <= 90; i++) {
      const t = i / 90, u = 1 - t;
      const x = 2 * u * t * p1[0] + t * t * p2[0], y = 2 * u * t * p1[1] + t * t * p2[1], r = r0 - (r0 - r1) * t;
      for (let dy = -r; dy <= r; dy += S) for (let dx = -r; dx <= r; dx += S) {
        const d2 = dx * dx + dy * dy;
        if (d2 > r * r) continue;
        const key = Math.round((x + dx) / S) * S + ',' + Math.round((y + dy) / S) * S;
        const inner = d2 <= (r * 0.42) ** 2 && t > 0.1 && t < 0.8 && dy > -0.3 * r;
        if (inner || !cells.has(key)) cells.set(key, inner ? 'in' : 'fur');
      }
    }
    const list = [...cells].map(([k, v]) => [...k.split(',').map(Number), v]);
    const outline = new Set();
    for (const [x, y] of list) for (const [dx, dy] of [[S, 0], [-S, 0], [0, S], [0, -S]]) {
      const k = (x + dx) + ',' + (y + dy);
      if (!cells.has(k)) outline.add(k);
    }
    return { list, outline: [...outline].map(k => k.split(',').map(Number)) };
  };
  const EAR_NORMAL = makeEar([-2, -12], [-11, -3], 3.1, 2.2);
  // Wide layout: the sticks sit right beside the pad, so the ears are shorter and droop less (no overlap, no clipping).
  const EAR_WIDE = makeEar([-0.5, -9], [-4.5, -4.5], 3.0, 2.1);
  // Xbox: the Guide button is small (a round head, not a wide pad), so the ears are small too.
  const EAR_SMALL = makeEar([-0.5, -5.5], [-4, -3], 1.9, 1.3);
  // Xbox cat: two tilted triangle ears that rise out from behind the round Guide button (it is drawn on top of
  // their bases), so they wrap around its upper corners instead of floating beside it. Left ear shown; the right one mirrors it.
  const catEarShape = (outer, inner) => {
    const S = 0.5, cells = new Map();
    const inTri = (px, py, a, b, c) => {
      const d = (p, q, r) => (p[0] - r[0]) * (q[1] - r[1]) - (q[0] - r[0]) * (p[1] - r[1]);
      const d1 = d([px, py], a, b), d2 = d([px, py], b, c), d3 = d([px, py], c, a);
      return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
    };
    for (let y = -8; y <= 1; y += S) for (let x = -6; x <= 4; x += S) {
      if (!inTri(x + S / 2, y + S / 2, ...outer)) continue;
      cells.set(x + ',' + y, inTri(x + S / 2, y + S / 2, ...inner) ? 'in' : 'fur');
    }
    const list = [...cells].map(([k, v]) => [...k.split(',').map(Number), v]);
    const outline = new Set();
    for (const [x, y] of list) for (const [dx, dy] of [[S, 0], [-S, 0], [0, S], [0, -S]]) {
      const k = (x + dx) + ',' + (y + dy);
      if (!cells.has(k)) outline.add(k);
    }
    return { list, outline: [...outline].map(k => k.split(',').map(Number)) };
  };
  const CAT_EAR_X = catEarShape([[-2.8, 0.5], [2.4, 0.5], [-3.7, -5]], [[-2.6, 0], [-0.6, 0], [-3.2, -3.6]]);
  // PlayStation: bigger, rounder ears; the pad is 14 units tall, so they stand clear of it.
  const CAT_EAR_PS = catEarShape([[-3.6, 0.5], [3.0, 0.5], [-5, -7]], [[-3.2, 0], [-0.6, 0], [-4.2, -5.2]]);
  // PlayStation, touchpad pressed: the same ears, shorter and bent down and out.
  const CAT_EAR_PS_DOWN = catEarShape([[-3.6, 0.5], [3.0, 0.5], [-5.6, -3.5]], [[-3.2, 0], [-0.6, 0], [-4.6, -2.8]]);

  // Cat ears: anchors [x, mirror] on row y. The first anchor is the left ear, the second the right one, and each folds with its bumper.
  // The Xbox Guide uses CAT_EAR_X; the PlayStation pad passes its own shape.
  const catEars = (anchors, y, shape = CAT_EAR_X) => anchors.forEach(([ax, m], i) =>
    drawEar(shape, ax, y, m, foldAngle(i === 0 ? 'left' : 'right'), 1, { ink: C.ink, out: C.gray, in: C.bean }));

  // Touchpad press (finger down or button click): the ears pop up and settle in a few stepped frames.
  // Very small on purpose (a pixel or two): pushing down squashes the ears a hair, letting go pops them back up a hair.
  const BOING_DOWN = [0.95, 0.98, 1];      // vertical ear scale per frame
  const BOING_UP = [1.05, 1.02, 0.99, 1];
  const BOING_MS = 50;
  let boingSeq = BOING_UP, boingStart = 0, boingTimer = null, prevClick = false, prevTouch = false;
  let prevL1 = false, prevR1 = false; // bumper edges, for the ear folds
  const boingFrame = () => {
    const i = Math.floor((performance.now() - boingStart) / BOING_MS);
    return boingStart && i < boingSeq.length ? i : -1;
  };
  function startBoing(seq) {
    boingSeq = seq;
    boingStart = performance.now();
    if (boingTimer) return;
    boingTimer = setInterval(() => {
      if (boingFrame() < 0) { clearInterval(boingTimer); boingTimer = null; boingStart = 0; }
      draw(...last); // the frame index is part of the repaint key, so a new frame always redraws
    }, 30);
  }
  // Ear fold: each ear folds about its base, the tip falling outward and down, as PawKey's mouse ears do. L1 folds the left
  // ear and R1 the right one. The ear stays folded while the bumper is held and springs back on release.
  const FOLD_PRESS = { seq: [0.1, 0.27, 0.2], hold: 0.2 }, FOLD_RELEASE = { seq: [0.12, -0.05, 0.02], hold: 0 }; // radians per 50 ms frame
  const folds = { left: null, right: null };
  let foldTimer = null;
  function foldAngle(side) {
    const f = folds[side];
    if (!f) return 0;
    const i = Math.floor((performance.now() - f.start) / 50);
    return i < f.seq.length ? f.seq[i] : f.hold;
  }
  function fold(side, spec) {
    folds[side] = { seq: spec.seq, hold: spec.hold, start: performance.now() };
    if (foldTimer) return;
    foldTimer = setInterval(() => {
      const moving = ['left', 'right'].some((s) => folds[s] && Math.floor((performance.now() - folds[s].start) / 50) < folds[s].seq.length);
      if (!moving) { clearInterval(foldTimer); foldTimer = null; }
      draw(...last); // the fold angle is part of the repaint key, so each frame redraws
    }, 30);
  }

  // Ears: each target pixel is traced back through the fold and the boing squash (sy), so the ear has no gaps, and the
  // outline is decided on the folded picture. Ear cells are half units (Bun and Cat always draw on the 0.5 grid).
  function earCells(shape) {
    if (shape.cells) return shape;
    shape.cells = new Map();
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    shape.list.forEach(([x, y, v]) => {
      const kx = Math.round(x * 2), ky = Math.round(y * 2);
      shape.cells.set(kx + ',' + ky, v);
      x0 = Math.min(x0, kx); x1 = Math.max(x1, kx); y0 = Math.min(y0, ky); y1 = Math.max(y1, ky);
    });
    shape.box = { x0, x1, y0, y1 };
    return shape;
  }
  function drawEar(shape, bx, by, mirror, angle, sy, fill) {
    earCells(shape);
    const c = Math.cos(angle), s = Math.sin(angle);
    const { x0, x1, y0, y1 } = shape.box;
    // The shape cell a target pixel traces back to: un-fold (rotate back by -angle), then un-bend (divide y by sy).
    const sourceAt = (tx, ty) => {
      const px = tx / 2, py = ty / 2;
      return shape.cells.get(Math.round((c * px - s * py) * 2) + ',' + Math.round(((s * px + c * py) / sy) * 2));
    };
    const pick = (tx, ty) => {
      const kind = sourceAt(tx, ty);
      if (kind) return kind === 'in' ? fill.in : fill.out;
      if ((sourceAt(tx - 1, ty) && sourceAt(tx + 1, ty)) || (sourceAt(tx, ty - 1) && sourceAt(tx, ty + 1))) return fill.out;
      return (sourceAt(tx + 1, ty) || sourceAt(tx - 1, ty) || sourceAt(tx, ty + 1) || sourceAt(tx, ty - 1)) ? fill.ink : null;
    };
    for (let ty = y0 - 5; ty <= y1 + 5; ty++) for (let tx = x0 - 5; tx <= x1 + 5; tx++) {
      const col = pick(tx, ty);
      if (!col) continue;
      const px = tx / 2, py = ty / 2;
      ctx.fillStyle = col;
      ctx.fillRect(bx + (mirror < 0 ? -px - 0.5 : px), by + py, 0.5, 0.5);
    }
  }
  function ears(by, half = 12) { // half = distance of each ear base from the centre (80)
    const f = boingFrame(), sy = f < 0 ? 1 : boingSeq[f];
    const ear = xbox ? EAR_SMALL : wideLayout ? EAR_WIDE : EAR_NORMAL;
    [[80 - half, 1, 'left'], [80 + half, -1, 'right']].forEach(([bx, m, side]) =>
      drawEar(ear, bx, by, m, foldAngle(side), sy, { ink: C.ink, out: C.gray, in: C.earIn }));
  }

  const canvas = document.getElementById('retroCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  // P = size of one drawn pixel in logical units: 1 = classic, 0.5 = fine (2x denser grid).
  let P = 1, last = [], lastKey = null, cat = false, bun = false, themed = false, squeeze = false, bulgeFx = false, squishFx = false, nameOn = true;
  function setStyle(name, coat, tone, layout, pad, controller, triggerLook, bulge, squish, names) {
    ({ W, H, OX, OY, g: G } = LAYOUTS[layout] || LAYOUTS.normal);
    showPad = pad !== false;
    wideLayout = layout === 'wide';
    xbox = controller === 'xbox';
    squeeze = triggerLook === 'squeeze';
    if (xbox) { G = wideLayout ? XBOX.wide.g : XBOX.normal; if (wideLayout) W = XBOX.wide.W; }
    if (!showPad && wideLayout) { // wide row: close the gap the touchpad / Guide button leaves
      const gap = xbox ? GAP.xbox : GAP.ps;
      G = { ...G };
      ['rs', 'options', 'face', 'rt'].forEach(n => { G[n] = [G[n][0] - gap, G[n][1]]; });
      W -= gap;
    }
    cat = name === 'cat';
    bun = name === 'bun';
    const stylised = cat || bun; // only Bun and Cat take the bulge and squish effects; Classic and Fine never do
    bulgeFx = stylised && bulge !== false;
    squishFx = stylised && squish === true;
    nameOn = names !== false;
    if (bun && wideLayout) { OY -= 4; H += 4; } // headroom for the ears in the one-row layout
    themed = cat || bun || (name === 'fine' && tone === 'midnight'); // fine + midnight: the black-cat colours without the cat extras
    P = name === 'fine' || cat || bun ? 0.5 : 1;
    Object.assign(C, BASE, cat ? COATS[coat] || COATS.pumpkin : bun ? BUN : themed ? COATS.shadow : {});
    if (!C.capFill) { C.capFill = C.gray; C.capHi = C.grayHi; C.capLo = C.grayLo; }
    if (!C.dim) C.dim = C.grayHi;
    const k = 1 / P;
    canvas.width = W * k; canvas.height = H * k; // resizing resets ctx state
    ctx.imageSmoothingEnabled = false;
    ctx.setTransform(k, 0, 0, k, -OX * k, -OY * k); // keep drawing in the original 160x100 coordinates
    lastKey = null; // style changed: force a repaint
    draw(...last);
  }

  const rect = (x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); };
  const disc = (cx, cy, r, c, blocky) => {
    ctx.fillStyle = c;
    if (P < 1 && blocky) { // round, but on 1-unit cells: stepped edges, between smooth and octagonal
      for (let y = -r; y < r; y++) for (let x = -r; x < r; x++) {
        if ((x + 0.5) ** 2 + (y + 0.5) ** 2 <= r * r) ctx.fillRect(cx + x, cy + y, 1, 1);
      }
      return;
    }
    if (P < 1) { // even pixel count, centred exactly on (cx, cy)
      for (let y = -r; y < r; y += P) for (let x = -r; x < r; x += P) {
        if ((x + P / 2) ** 2 + (y + P / 2) ** 2 <= r * r) ctx.fillRect(cx + x, cy + y, P, P);
      }
      return;
    }
    for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) {
      if (x * x + y * y <= r * r + 1) ctx.fillRect(cx + x, cy + y, 1, 1);
    }
  };
  // Scale2x/EPX: doubles a sprite's resolution with clean diagonals, so fine mode's
  // symbols and digits sit on the same pixel grid as its outlines.
  const fineCache = new Map();
  const fine = rows => {
    if (fineCache.has(rows)) return fineCache.get(rows);
    const at = (x, y) => (rows[y] && rows[y][x] === '#' ? 1 : 0);
    const out = [];
    rows.forEach((row, y) => {
      const r0 = [], r1 = [];
      for (let x = 0; x < row.length; x++) {
        const p = at(x, y), a = at(x, y - 1), b = at(x + 1, y), c = at(x - 1, y), d = at(x, y + 1);
        const q1 = c === a && c !== d && a !== b ? a : p, q2 = a === b && a !== c && b !== d ? b : p;
        const q3 = d === c && d !== b && c !== a ? c : p, q4 = b === d && b !== a && d !== c ? d : p;
        r0.push(q1, q2); r1.push(q3, q4);
      }
      out.push(r0.map(v => (v ? '#' : '.')).join(''), r1.map(v => (v ? '#' : '.')).join(''));
    });
    fineCache.set(rows, out);
    return out;
  };
  const sprite = (rows, cx, cy, c, raw) => {
    ctx.fillStyle = c;
    const ox = raw ? sn(cx - rows[0].length * P / 2) : cx - (rows[0].length >> 1); // raw sprites snap to the grid, or odd widths blur
    const oy = raw ? sn(cy - rows.length * P / 2) : cy - (rows.length >> 1);
    (P < 1 && !raw ? fine(rows) : rows).forEach((row, y) => {
      for (let x = 0; x < row.length; x++) if (row[x] === '#') ctx.fillRect(ox + x * P, oy + y * P, P, P);
    });
  };
  // The same sprite squashed to a fraction s of its height (rows picked evenly), so a symbol fits a flattened button.
  const spriteSquash = (rows, cx, cy, c, s, raw) => {
    const src = P < 1 && !raw ? fine(rows) : rows, T = Math.max(1, Math.round(src.length * s));
    ctx.fillStyle = c;
    const ox = raw ? sn(cx - rows[0].length * P / 2) : cx - (rows[0].length >> 1), oy = sn(cy - T * P / 2);
    for (let t = 0; t < T; t++) {
      const row = src[Math.min(src.length - 1, Math.floor((t + 0.5) * src.length / T))];
      for (let x = 0; x < row.length; x++) if (row[x] === '#') ctx.fillRect(ox + x * P, oy + t * P, P, P);
    }
  };
  // Outlined box with cut corners, light top row and dark bottom row.
  const box = (x, y, w, h, fill, hi, lo) => {
    const ins = P < 1 ? [1, 0.5] : [1]; // corner steps: fine mode gets a rounder corner
    const row = (x, y, w, h, steps, c) => {
      ctx.fillStyle = c;
      for (let r = 0; r * P < h; r++) {
        const edge = Math.min(r, Math.round(h / P) - 1 - r);
        const i = edge < steps.length ? steps[edge] : 0;
        ctx.fillRect(x + i, y + r * P, w - 2 * i, P);
      }
    };
    row(x, y, w, h, ins, C.ink);
    const inner = P < 1 ? [0.5] : [];
    row(x + P, y + P, w - 2 * P, h - 2 * P, inner, fill);
    const k = inner[0] || 0;
    rect(x + P + k, y + P, w - 2 * P - 2 * k, P, hi); rect(x + P + k, y + h - 2 * P, w - 2 * P - 2 * k, P, lo);
  };
  const ball = (cx, cy, r, fill, hi, lo, blocky) => {
    disc(cx, cy, r + (blocky ? 1 : P), C.ink, blocky); disc(cx, cy, r, fill, blocky);
    rect(cx - 1, cy - r, 1 + 2 * P, P, hi); rect(cx - 1, cy + r - (P < 1 ? P : 0), 1 + 2 * P, P, lo);
  };
  // Squish (Bun / Cat only). Each button has a spring: a press pulls it to 1 with a quick snap, and a release swings it back past
  // rest (down to about -0.4, a bouncy stretch) before it settles. A press the overlay skipped between two frames is latched
  // (latch), so a tap shorter than a frame still squashes. Springs step in real time, so mashing never leaves one stuck.
  const SQ_BUTTONS = ['l1', 'r1', 'share', 'options', 'touchpad', 'dpad_up', 'dpad_down', 'dpad_left', 'dpad_right', 'l3', 'r3', 'triangle', 'circle', 'cross', 'square'];
  const SQ_PRESS = { w: 2 * Math.PI * 7, z: 0.55 }, SQ_RELEASE = { w: 2 * Math.PI * 4.5, z: 0.3 }; // stiffness (rad/s), damping ratio
  const SQ_HOLD = 80; // ms a latched press stays on
  const sq = Object.fromEntries(SQ_BUTTONS.map(n => [n, { p: 0, v: 0, until: 0 }]));
  let sqBusy = false, sqClock = 0;
  const sn = v => Math.round(v / P) * P; // snap to the pixel grid
  const sqp = n => (squishFx ? sq[n].p : 0); // a button's squish: 0 at rest, 1 pressed, below 0 stretched
  function stepSquish(buttons) {
    const now = performance.now();
    const dt = sqClock ? Math.min((now - sqClock) / 1000, 0.05) : 0; // capped, so a hidden overlay cannot blow a spring up
    sqClock = now;
    const steps = Math.ceil(dt * 240), h = steps ? dt / steps : 0;
    sqBusy = false;
    for (const n of SQ_BUTTONS) {
      const s = sq[n], target = (buttons[n] || now < s.until) ? 1 : 0, k = target ? SQ_PRESS : SQ_RELEASE;
      const kw = k.w * k.w, cz = 2 * k.z * k.w;
      for (let i = 0; i < steps; i++) { s.v += (-kw * (s.p - target) - cz * s.v) * h; s.p += s.v * h; }
      s.p = Math.max(-0.4, Math.min(1.2, s.p));
      if (Math.abs(s.p - target) < 0.002 && Math.abs(s.v) < 0.02 && now >= s.until) { s.p = target; s.v = 0; }
      else sqBusy = true;
    }
  }
  // Called for pad states the overlay skipped: a press in them still squashes.
  function latch(buttons) {
    const now = performance.now();
    if (buttons) for (const n of SQ_BUTTONS) if (buttons[n]) sq[n].until = now + SQ_HOLD;
  }
  // Box squash geometry: shorter from the top with the bottom edge fixed (taller below 0), and wider on each side by the same amount.
  const squashed = (x, y, w, h, p) => {
    const dh = Math.min(sn(2 * p), h - 3), bl = squishFx ? sn(p) : 0;
    return { x: x - bl, y: y + dh, w: w + 2 * bl, h: h - dh };
  };
  const pBox = (x, y, w, h, fill, hi, lo, p) => {
    const g = squashed(x, y, w, h, p);
    box(g.x, g.y, g.w, g.h, fill, hi, lo);
  };
  // Filled oval, built row by row on the P grid (used for squashed round buttons).
  const oval = (cx, cy, rx, ry, c) => {
    ctx.fillStyle = c;
    for (let y = -ry; y < ry; y += P) {
      const half = sn(rx * Math.sqrt(Math.max(0, 1 - ((y + P / 2) / ry) ** 2)));
      if (half > 0) ctx.fillRect(cx - half, cy + y, half * 2, P);
    }
  };
  // Round button squash: at full press 1.5 units shorter and 1 unit wider (side scales the sideways part); a normal ball at rest.
  const ballSq = (cx, cy, r, fill, hi, lo, p, blocky, side = 1) => {
    const rx = r + sn(p * side), ry = r - sn(p * 1.5);
    if (rx === r && ry === r) return ball(cx, cy, r, fill, hi, lo, blocky);
    const t = blocky ? 1 : P; // ink ring thickness, as in ball()
    oval(cx, cy, rx + t, ry + t, C.ink);
    oval(cx, cy, rx, ry, fill);
  };

  const meterColor = f => (f < 0.34 ? C.m1 : f < 0.67 ? C.m2 : C.m3);

  // A button name (3x5 glyphs, 1-unit cells and gaps) with its top-left corner at (x, y).
  const nameText = (text, x, y, c) => {
    ctx.fillStyle = c;
    x = Math.round(x); y = Math.round(y); // whole units, or the letters blur
    [...text].forEach((ch, i) => nameGlyph(ch).forEach((row, r) => {
      for (let k = 0; k < row.length; k++) if (row[k] === '#') ctx.fillRect(x + i * 4 + k, y + r, 1, 1);
    }));
  };
  const nameWidth = text => text.length * 4 - 1;

  function trigger(x, frac, name) {
    if (squeeze) { // no meter or readout: the button sinks down and gets shorter as it is pulled (bottom edge stays put)
      const s = Math.round(frac * 10); // up to 10 px: the button ends 4 px tall (3 would merge the highlight and shadow rows)
      const w = bulgeFx ? Math.round(frac) : 0; // past half pull the button bulges 1 px out on each side, like a squeezed ball (1 px is all the wide layout has room for)
      box(x - w, 2 + s, 22 + 2 * w, 14 - s, C.gray, C.grayHi, C.grayLo);
      if (nameOn && s <= 5) nameText(name, x + 8, Math.round(6.5 + s / 2), C.text); // the name is centred in the box; it hides once the box is too short to hold it
      return;
    }
    box(x, 2, 22, 14, C.gray, C.grayHi, C.grayLo);
    rect(x + 2, 4, 6, 10, C.empty);
    if (P < 1) { // fine: 5 chunky segments with gaps instead of a continuous bar
      for (let i = 0; i < Math.round(frac * 5); i++) rect(x + 2, 12.5 - i * 2, 6, 1.5, meterColor(frac));
    } else {
      const n = Math.round(frac * 10);
      if (n > 0) rect(x + 2, 14 - n, 6, n, meterColor(frac));
    }
    const t = String(Math.round(frac * 100)).padStart(3, '0');
    for (let i = 0; i < 3; i++) {
      sprite(DIGITS[+t[i]], x + 11 + i * 4, 9, frac > 0 ? C.text : C.dim);
    }
  }

  function bumper(x, on, p, name) {
    pBox(x, 19 + (on ? 1 : 0), 22, 7, on ? C.on : C.gray, on ? C.onHi : C.grayHi, on ? C.onLo : C.grayLo, p);
    const g = squashed(x, 19 + (on ? 1 : 0), 22, 7, p); // the name shows only while the bumper is whole: 5 rows of letters do not fit a squashed one
    if (nameOn && g.h >= 7) nameText(name, Math.round(g.x + (g.w - nameWidth(name)) / 2), g.y + 1, on ? C.ink : C.text);
  }

  function pill(x, y, on, p) {
    pBox(x, y + (on ? 1 : 0), 8, 5, on ? C.on : C.gray, on ? C.onHi : C.grayHi, on ? C.onLo : C.grayLo, p);
  }

  const ARROWS = {
    up: ['..#..', '.###.', '#####'], down: ['#####', '.###.', '..#..'],
    left: ['..#', '.##', '###', '.##', '..#'], right: ['#..', '##.', '###', '##.', '#..']
  };
  function arm(x, y, w, h, on, dir, p) {
    const g = squashed(x, y + (on ? 1 : 0), w, h, p);
    box(g.x, g.y, g.w, g.h, on ? C.on : C.white, on ? C.onHi : C.white, on ? C.onLo : C.grayHi);
    // The arrow is centred on the squashed arm, on the pixel grid, so it moves and bulges with the arm.
    if (P < 1) sprite(ARROWS[dir], sn(g.x + g.w / 2), sn(g.y + g.h / 2), on ? C.brown : C.grayHi, true);
  }

  function stick(cx, cy, v, pressed, p) {
    disc(cx, cy, 11, C.ink, true); disc(cx, cy, 10, C.grayLo, true);
    const tx = cx + Math.round(v.x * 4), ty = cy + Math.round(v.y * 4) + (pressed ? 1 : 0);
    if (cat) { // no light-up: the cap keeps its coat and the paw squishes instead
      ballSq(tx, ty, 6, C.capFill, C.capHi, C.capLo, p, true, 0.5);
      const paw = pressed ? PAW_SQUISH : PAW, py = ty + (pressed ? 0.5 : 0);
      sprite(paw, tx, py + P, C.capLo, true); // drop shadow makes the paw pop
      sprite(paw, tx, py, C.bean, true);
      return;
    }
    if (bun) { // no light-up: cream cap with a pink bunny paw that squishes when pressed
      ballSq(tx, ty, 6, C.capFill, C.capHi, C.capLo, p, true, 0.5);
      const paw = pressed ? BUN_PAW_SQUISH : BUN_PAW, py = ty + (pressed ? 0.5 : 0);
      sprite(paw, tx, py + P, C.capLo, true); // soft shadow under the paw
      sprite(paw, tx, py, C.blush, true);
      return;
    }
    ball(tx, ty, 6, pressed ? C.yellow : C.gray, pressed ? C.white : C.grayHi, pressed ? C.gold : C.grayLo, true);
    disc(tx, ty, 2, pressed ? C.gold : C.grayLo, true);
  }

  // Xbox face buttons: the same four slots, labelled A (bottom) B (right) X (left) Y (top).
  const LETTERS = {
    cross: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],      // A
    circle: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],     // B
    square: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],    // X
    triangle: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..']   // Y
  };
  const XBOX_COLOUR = () => ({ cross: C.tri, circle: C.cir, square: C.crs, triangle: C.yel });
  const GUIDE_LOGO = ['#.#', '.#.', '#.#'];
  // The round Guide button sits where the touchpad is on the PlayStation pad (centre 80, 38).
  function guide(on, p) {
    const cy = 38 + (on ? 1 : 0);
    ballSq(80, cy, 5, on ? C.on : C.gray, on ? C.onHi : C.grayHi, on ? C.onLo : C.grayLo, p);
    sprite(GUIDE_LOGO, 80, cy, on ? C.white : C.dim);
  }

  function face(name, cx, cy, color, on, p) {
    cy += on ? 1 : 0;
    if (xbox) color = XBOX_COLOUR()[name];
    ballSq(cx, cy, 5, on ? color : C.gray, on ? C.white : C.grayHi, on ? C.ink : C.grayLo, p);
    const ink = on ? C.white : color;
    const k = squishFx ? sn(p * 1.5) : 0; // the same squash ballSq gives the body, so the symbol shrinks with it
    const symbol = (rows, y, raw) => (k ? spriteSquash(rows, cx, y, ink, 1 - k / 5, raw) : sprite(rows, cx, y, ink, raw));
    if (xbox) symbol(LETTERS[name], cy, false);
    else if (P < 1) symbol(FINE_SYMBOLS[name], cy + (name === 'triangle' ? -1 : 0), true); // triangle nudged up so its centre of mass sits on the button centre
    else symbol(SPRITES[name], cy, false);
  }

  function draw(state, left, right) {
    last = [state, left, right];
    state = state || {};
    const b = state.buttons || {};
    const tr = state.triggers || {};
    const touching = state.touch && state.touch.active;
    left = left || { x: 0, y: 0 }; right = right || { x: 0, y: 0 };
    // Boing once when the touchpad goes down (touch or click) and once when it comes back up; holding does nothing.
    const down = (b.touchpad && !prevClick) || (touching && !prevTouch);
    const up = (!b.touchpad && prevClick) || (!touching && prevTouch);
    if (bun && showPad && (down || up)) startBoing(down ? BOING_DOWN : BOING_UP);
    prevClick = !!b.touchpad; prevTouch = !!touching;
    // A bumper folds the ear on its side (cat and bun): L1 for the left ear, R1 for the right one.
    const l1 = !!b.l1, r1 = !!b.r1;
    if ((bun || cat) && l1 !== prevL1) fold('left', l1 ? FOLD_PRESS : FOLD_RELEASE);
    if ((bun || cat) && r1 !== prevR1) fold('right', r1 ? FOLD_PRESS : FOLD_RELEASE);
    prevL1 = l1; prevR1 = r1;
    stepSquish(b);

    // Repaint only when something visible changed (sticks move in whole units, triggers show whole percents).
    const key = [Object.values(b).join(), Math.round(left.x * 4), Math.round(left.y * 4), Math.round(right.x * 4), Math.round(right.y * 4),
      Math.round((tr.l2_norm || 0) * 100), Math.round((tr.r2_norm || 0) * 100), touching ? 1 : 0, boingFrame(),
      Math.round(foldAngle('left') * 100), Math.round(foldAngle('right') * 100),
      squishFx ? SQ_BUTTONS.map(n => Math.round(sq[n].p * 32)).join() : ''].join('|');
    if (key === lastKey) return;
    lastKey = key;

    ctx.clearRect(OX, OY, W, H);
    const at = (name, fn) => { ctx.save(); ctx.translate(...G[name]); fn(); ctx.restore(); };
    // Button names follow the controller: PlayStation L2 / R2 and L1 / R1, Xbox LT / RT and LB / RB.
    const N = xbox ? { lt: 'LT', rt: 'RT', lb: 'LB', rb: 'RB' } : { lt: 'L2', rt: 'R2', lb: 'L1', rb: 'R1' };
    at('lt', () => { trigger(22, tr.l2_norm || 0, N.lt); bumper(22, b.l1, sqp('l1'), N.lb); });
    at('rt', () => { trigger(116, tr.r2_norm || 0, N.rt); bumper(116, b.r1, sqp('r1'), N.rb); });

    // PlayStation: the touchpad is a block that bounces when touched and darkens when clicked.
    // Xbox: a round Guide button (the same 'touchpad' slot). Bun / Cat ears sit on whichever it is.
    const by = !xbox && touching ? 29 : 31;
    if (showPad) at('pad', () => {
      if (xbox) {
        if (bun) ears(33, 4);
        if (cat) catEars([[77.5, 1], [82.5, -1]], 36.5); // anchors sit inside the button's outline; the button covers the bases
        guide(b.touchpad, sqp('touchpad'));
        return;
      }
      if (bun) ears(by); // ears stay attached to the pad: they rise with it and boing on top
      if (cat) catEars([[70, 1], [90, -1]], by + 0.5, b.touchpad ? CAT_EAR_PS_DOWN : CAT_EAR_PS); // ears behind the touchpad: its top edge covers their bases
      if (bun) pBox(64, by, 32, 14, b.touchpad ? C.padLo : C.pad, b.touchpad ? C.pad : C.padHi, C.padLo, sqp('touchpad'));
      else if (themed) pBox(64, by, 32, 14, b.touchpad ? C.grayLo : C.grayHi, b.touchpad ? C.gray : C.white, C.grayLo, sqp('touchpad'));
      else pBox(64, by, 32, 14, b.touchpad ? C.brown : C.gold, b.touchpad ? C.brown : C.yellow, C.brown, sqp('touchpad'));
    });

    at('share', () => pill(51, 33, b.share, sqp('share')));
    at('options', () => pill(101, 33, b.options, sqp('options')));

    at('dpad', () => {
      arm(33, 36, 7, 8, b.dpad_up, 'up', sqp('dpad_up'));
      arm(33, 50, 7, 8, b.dpad_down, 'down', sqp('dpad_down'));
      arm(25, 43, 8, 7, b.dpad_left, 'left', sqp('dpad_left'));
      arm(40, 43, 8, 7, b.dpad_right, 'right', sqp('dpad_right'));
    });

    at('ls', () => stick(62, 56, left, b.l3, sqp('l3')));
    at('rs', () => stick(98, 56, right, b.r3, sqp('r3')));

    at('face', () => {
      face('triangle', 124, 36, C.tri, b.triangle, sqp('triangle'));
      face('circle', 133, 45, C.cir, b.circle, sqp('circle'));
      face('cross', 124, 54, C.crs, b.cross, sqp('cross'));
      face('square', 115, 45, C.sqr, b.square, sqp('square'));
    });
  }

  // Called once per overlay frame (app.js), so a squish keeps moving when no new pad state arrives.
  function tick() { if (squishFx && sqBusy) draw(...last); }
  window.RetroPad = { draw, setStyle, latch, tick };
  setStyle('classic');
})();
