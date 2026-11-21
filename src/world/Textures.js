import * as THREE from 'three';
import { PITCH } from '../config.js';

const cache = new Map();

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function finish(c, { repeatX = 1, repeatY = 1, aniso = 8 } = {}) {
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.anisotropy = aniso;
  tex.needsUpdate = true;
  return tex;
}

/* ------------------------------------------------------------------ */
/* Pitch: mown stripes, wear, and all markings drawn into one texture  */
/* ------------------------------------------------------------------ */
export function makePitchTexture() {
  if (cache.has('pitch')) return cache.get('pitch');

  const margin = PITCH.margin;
  const worldW = PITCH.width + margin * 2;
  const worldL = PITCH.length + margin * 2;
  const PX = 14; // pixels per metre
  const W = Math.round(worldW * PX);
  const H = Math.round(worldL * PX);
  const c = canvas(W, H);
  const g = c.getContext('2d');

  // world -> canvas helper (canvas u = x, v = z)
  const toPx = (mx) => (mx + worldW / 2) * PX;
  const toPz = (mz) => (mz + worldL / 2) * PX;
  const scale = (m) => m * PX;

  // Base grass
  g.fillStyle = '#1d5c30';
  g.fillRect(0, 0, W, H);

  // Mown stripes along the length of the pitch
  const stripeCount = 16;
  const stripeH = (H - scale(margin * 2)) / stripeCount;
  for (let i = 0; i < stripeCount; i++) {
    const y = scale(margin) + i * stripeH;
    g.fillStyle = i % 2 === 0 ? '#237038' : '#1c6130';
    g.fillRect(0, y, W, stripeH + 1);
  }

  // Blades / speckle noise for organic texture
  const rnd = mulberry32(9137);
  for (let i = 0; i < 26000; i++) {
    const x = rnd() * W;
    const y = rnd() * H;
    const a = 0.03 + rnd() * 0.06;
    g.fillStyle = rnd() > 0.5 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a})`;
    g.fillRect(x, y, 1.6 + rnd() * 2.4, 1 + rnd() * 2);
  }

  // Subtle worn patches near goals / centre
  const wear = [
    [0, PITCH.halfL, 16, 9, 0.10],
    [0, -PITCH.halfL, 16, 9, 0.10],
    [0, 0, 14, 7, 0.07],
  ];
  for (const [cz, wx, hw, hl, alpha] of wear.map((w) => [w[1], w[0], w[2], w[3], w[4]])) {
    void cz;
    void wx;
    const grad = g.createRadialGradient(
      toPx(0), toPz(wx), 0,
      toPx(0), toPz(wx), scale(hw)
    );
    grad.addColorStop(0, `rgba(214,204,160,${alpha})`);
    grad.addColorStop(0.6, `rgba(200,195,150,${alpha * 0.5})`);
    grad.addColorStop(1, 'rgba(200,195,150,0)');
    g.fillStyle = grad;
    g.save();
    g.translate(toPx(0), toPz(wx));
    g.scale(1, hl / hw);
    g.beginPath();
    g.arc(0, 0, scale(hw), 0, Math.PI * 2);
    g.fill();
    g.restore();
  }

  // Run-off area (darker, no lines) outside the touchlines
  g.fillStyle = 'rgba(12,42,22,0.55)';
  g.fillRect(0, 0, W, scale(margin));
  g.fillRect(0, H - scale(margin), W, scale(margin));
  g.fillRect(0, 0, scale(margin), H);
  g.fillRect(W - scale(margin), 0, scale(margin), H);

  // ---- Markings ----
  g.strokeStyle = 'rgba(250,253,255,0.92)';
  g.fillStyle = 'rgba(250,253,255,0.92)';
  g.lineWidth = Math.max(2, scale(0.13));
  g.lineJoin = 'round';

  const L = PITCH.halfL; // z extent
  const Wd = PITCH.halfW; // x extent
  const rect = (x0, z0, x1, z1) => {
    g.beginPath();
    g.rect(toPx(x0), toPz(z0), scale(x1 - x0), scale(z1 - z0));
    g.stroke();
  };

  // Touchlines & goal lines
  rect(-Wd, -L, Wd, L);

  // Halfway line + centre circle + spot
  g.beginPath();
  g.moveTo(toPx(-Wd), toPz(0));
  g.lineTo(toPx(Wd), toPz(0));
  g.stroke();
  g.beginPath();
  g.arc(toPx(0), toPz(0), scale(PITCH.circleRadius), 0, Math.PI * 2);
  g.stroke();
  g.beginPath();
  g.arc(toPx(0), toPz(0), scale(0.22), 0, Math.PI * 2);
  g.fill();

  for (const side of [-1, 1]) {
    const goalLine = side * L;
    const dir = -side; // into the pitch
    // Penalty area
    rect(-PITCH.penaltyWidth / 2, goalLine, PITCH.penaltyWidth / 2, goalLine + dir * PITCH.penaltyDepth);
    // Goal area
    rect(-PITCH.sixWidth / 2, goalLine, PITCH.sixWidth / 2, goalLine + dir * PITCH.sixDepth);
    // Penalty spot
    const spotZ = goalLine + dir * 11;
    g.beginPath();
    g.arc(toPx(0), toPz(spotZ), scale(0.2), 0, Math.PI * 2);
    g.fill();
    // Penalty arc (only the part outside the box)
    g.beginPath();
    const arcR = scale(PITCH.circleRadius);
    const boxEdgeZ = goalLine + dir * PITCH.penaltyDepth;
    const dy = Math.abs(spotZ - boxEdgeZ) * PX;
    const halfAngle = Math.acos(Math.min(1, dy / arcR));
    const baseAngle = side > 0 ? Math.PI : 0;
    g.arc(
      toPx(0),
      toPz(spotZ),
      arcR,
      baseAngle - halfAngle,
      baseAngle + halfAngle
    );
    g.stroke();
    // Goal mouth
    g.lineWidth = Math.max(3, scale(0.16));
    g.beginPath();
    g.moveTo(toPx(-PITCH.goalWidth / 2), toPz(goalLine));
    g.lineTo(toPx(PITCH.goalWidth / 2), toPz(goalLine));
    g.stroke();
    g.lineWidth = Math.max(2, scale(0.13));
  }

  // Corner arcs
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      g.beginPath();
      const cx = toPx(sx * Wd);
      const cz = toPz(sz * L);
      const r = scale(PITCH.cornerRadius);
      const start = sx > 0 ? (sz > 0 ? Math.PI : Math.PI / 2) : (sz > 0 ? Math.PI * 1.5 : 0);
      g.arc(cx, cz, r, start, start + Math.PI / 2);
      g.stroke();
    }
  }

  const tex = finish(c, { aniso: 16 });
  cache.set('pitch', tex);
  return tex;
}

/* ------------------------------------------------------------------ */
/* Goal net: transparent grid                                          */
/* ------------------------------------------------------------------ */
export function makeNetTexture() {
  if (cache.has('net')) return cache.get('net');
  const S = 256;
  const c = canvas(S, S);
  const g = c.getContext('2d');
  g.clearRect(0, 0, S, S);
  g.strokeStyle = 'rgba(255,255,255,0.85)';
  g.lineWidth = 1.6;
  const step = S / 12;
  for (let i = 0; i <= 12; i++) {
    g.beginPath();
    g.moveTo(i * step, 0);
    g.lineTo(i * step, S);
    g.stroke();
    g.beginPath();
    g.moveTo(0, i * step);
    g.lineTo(S, i * step);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  cache.set('net', tex);
  return tex;
}

/* ------------------------------------------------------------------ */
/* Crowd texture for the stands                                        */
/* ------------------------------------------------------------------ */
export function makeCrowdTexture() {
  if (cache.has('crowd')) return cache.get('crowd');
  const W = 512;
  const H = 256;
  const c = canvas(W, H);
  const g = c.getContext('2d');
  g.fillStyle = '#0f1420';
  g.fillRect(0, 0, W, H);
  const rnd = mulberry32(4242);
  const palette = ['#e8eefc', '#c9d6f2', '#f4d35e', '#8fb3e8', '#d96b6b', '#9fd6a8', '#7f8aa6', '#f0a15c', '#5b6b8c', '#b9c6dd'];
  // Individual spectators: heads plus shoulders, jittered so they don't look like pixels
  for (let y = 7; y < H; y += 11) {
    for (let x = 5; x < W; x += 8) {
      if (rnd() > 0.2) {
        const px = x + rnd() * 4;
        const py = y + rnd() * 4;
        const col = palette[(rnd() * palette.length) | 0];
        g.globalAlpha = 0.5 + rnd() * 0.5;
        // body
        g.fillStyle = col;
        g.beginPath();
        g.ellipse(px, py + 3.2, 3.1, 2.4, 0, 0, Math.PI * 2);
        g.fill();
        // head
        g.fillStyle = rnd() > 0.5 ? '#e8b48c' : '#c48f66';
        g.beginPath();
        g.arc(px, py - 1.4, 1.75, 0, Math.PI * 2);
        g.fill();
      }
    }
  }
  g.globalAlpha = 1;
  // seat rows / shadowing between rows
  for (let y = 0; y < H; y += 11) {
    g.fillStyle = 'rgba(6,10,18,0.5)';
    g.fillRect(0, y + 8, W, 3);
  }
  // darken toward the back rows
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, 'rgba(3,6,12,0.5)');
  grad.addColorStop(0.4, 'rgba(3,6,12,0.1)');
  grad.addColorStop(1, 'rgba(3,6,12,0.35)');
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  const tex = finish(c, { repeatX: 1, repeatY: 1, aniso: 16 });
  cache.set('crowd', tex);
  return tex;
}

/* ------------------------------------------------------------------ */
/* Player numbers                                                      */
/* ------------------------------------------------------------------ */
export function makeNumberTexture(number, color = '#ffffff', outline = '#101826') {
  const key = `num-${number}-${color}-${outline}`;
  if (cache.has(key)) return cache.get(key);
  const S = 128;
  const c = canvas(S, S);
  const g = c.getContext('2d');
  g.clearRect(0, 0, S, S);
  g.font = 'bold 86px Inter, Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 10;
  g.strokeStyle = outline;
  g.strokeText(String(number), S / 2, S / 2 + 4);
  g.fillStyle = color;
  g.fillText(String(number), S / 2, S / 2 + 4);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  cache.set(key, tex);
  return tex;
}

/* ------------------------------------------------------------------ */
/* Ball skin: white with dark panels                                   */
/* ------------------------------------------------------------------ */
export function makeBallTexture() {
  if (cache.has('ball')) return cache.get('ball');
  const W = 512;
  const H = 256;
  const c = canvas(W, H);
  const g = c.getContext('2d');
  g.fillStyle = '#f6f7fa';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#1a2233';
  const panel = (cx, cy, r) => {
    g.beginPath();
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (i * Math.PI * 2) / 5;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      i === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
    }
    g.closePath();
    g.fill();
  };
  // Staggered pentagon layout wrapping the sphere
  for (let i = 0; i < 4; i++) {
    panel(64 + i * 128, 74, 34);
    panel(128 + i * 128, 178, 32);
  }
  panel(0, 130, 28);
  panel(512, 130, 28);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  cache.set('ball', tex);
  return tex;
}

/* ------------------------------------------------------------------ */
export function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
