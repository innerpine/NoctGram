'use strict';
// «Кто-нибудь не спит?» — мультфильм для NoctGram.
// Каждый кадр рисуется функцией renderFrame(t) детерминированно, поэтому
// одну и ту же сцену можно и смотреть в браузере, и рендерить в видео.

const W = 1080, H = 1080, FPS = 24, DURATION = 62;
const cv = document.getElementById('c');
const ctx = cv.getContext('2d');

// ---------- математика ----------
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * t;
const prog = (t, a, b) => clamp((t - a) / (b - a));
const ease = t => (t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOut = t => 1 - Math.pow(1 - t, 3);
const easeIn = t => t * t * t;
const backOut = t => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
const pulse = (t, a, b) => (t >= a && t < b ? 1 : 0);

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let q = Math.imul(s ^ (s >>> 15), 1 | s);
    q = (q + Math.imul(q ^ (q >>> 7), 61 | q)) ^ q;
    return ((q ^ (q >>> 14)) >>> 0) / 4294967296;
  };
}

// Ключевые кадры [[t, ...значения]] со сглаживанием между соседними.
function kf(t, keys) {
  if (t <= keys[0][0]) return keys[0].slice(1);
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i], b = keys[i + 1];
    if (t <= b[0]) {
      const p = ease(prog(t, a[0], b[0]));
      return a.slice(1).map((v, j) => lerp(v, b[j + 1], p));
    }
  }
  return keys[keys.length - 1].slice(1);
}

// Сплайн Катмулла-Рома по точкам [[x, y]], p ∈ [0, 1].
function spline(pts, p) {
  const n = pts.length - 1;
  const f = clamp(p) * n;
  const i = Math.min(n - 1, Math.floor(f));
  const u = f - i;
  const P = k => pts[clamp(k, 0, n)];
  const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
  const cr = (a, b, c, d) => .5 * (2 * b + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u * u + (-a + 3 * b - 3 * c + d) * u * u * u);
  return [cr(p0[0], p1[0], p2[0], p3[0]), cr(p0[1], p1[1], p2[1], p3[1])];
}

function blinkAt(t, seed = 0) {
  const period = 2.6 + (seed % 5) * .45;
  return ((t + seed * 1.37) % period) < .11 ? 1 : 0;
}

// ---------- палитра ----------
const C = {
  skyTop: '#121133', skyBot: '#3A2E78',
  star: '#FFE9A8', moon: '#FFF1C9',
  wall: '#3B2F6E', wallDark: '#2B2258', far: '#2A2458', far2: '#231D4C',
  winWarm: '#F6C75A', winDark: '#1C1740', winLilac: '#C9B6FF',
  frame: '#EFE3CF', sill: '#E2D2B8', curtain: '#E98A8A',
  skin: '#F2C3A0', skinShade: '#D99B7A',
  hair: '#2B2030', hoodie: '#E3A13B',
  ink: '#3557A8', paper: '#FBF6EA', rule: '#AFC6EA', margin: '#E7A1A1',
  lilac: '#AF9ADD', lilacGlow: '#C9B6FF',
  leaf: '#5E9C6B',
};
const EYE = '#2A1F2E';

function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  let r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  if (k < 0) { r *= 1 + k; g *= 1 + k; b *= 1 + k; } else { r += (255 - r) * k; g += (255 - g) * k; b += (255 - b) * k; }
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}

// ---------- примитивы «бумажной аппликации» ----------
function shadow(k = 1) {
  if (k) {
    ctx.shadowColor = 'rgba(16,8,40,0.38)';
    ctx.shadowBlur = 9 * k; ctx.shadowOffsetX = 2 * k; ctx.shadowOffsetY = 4 * k;
  } else {
    ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
  }
}
function fill(color, path, sh = 1) {
  ctx.save(); ctx.fillStyle = color; shadow(sh); ctx.beginPath(); path(); ctx.fill(); ctx.restore();
}
function line(color, w, path, sh = 0) {
  ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = w; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  shadow(sh); ctx.beginPath(); path(); ctx.stroke(); ctx.restore();
}
function wrectPath(x, y, w, h, seed = 1, amt = 3) {
  const R = rng(seed), pts = [];
  const edge = (x0, y0, x1, y1) => {
    const n = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / 70));
    for (let i = 0; i < n; i++) { const k = i / n; pts.push([lerp(x0, x1, k) + (R() - .5) * amt, lerp(y0, y1, k) + (R() - .5) * amt]); }
  };
  edge(x, y, x + w, y); edge(x + w, y, x + w, y + h); edge(x + w, y + h, x, y + h); edge(x, y + h, x, y);
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (const p of pts) ctx.lineTo(p[0], p[1]);
  ctx.closePath();
}
function wellPath(cx, cy, rx, ry, seed = 1, amt = .03) {
  const R = rng(seed), p1 = R() * 6.28, p2 = R() * 6.28, p3 = R() * 6.28, n = 44;
  for (let i = 0; i <= n; i++) {
    const a = i / n * Math.PI * 2;
    const k = 1 + amt * (Math.sin(3 * a + p1) * .6 + Math.sin(5 * a + p2) * .4 + Math.sin(2 * a + p3) * .3);
    const x = cx + Math.cos(a) * rx * k, y = cy + Math.sin(a) * ry * k;
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  }
  ctx.closePath();
}
function circle(x, y, r) { ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, Math.PI * 2); }
function star5(x, y, r, rot = -Math.PI / 2) {
  for (let i = 0; i < 10; i++) {
    const a = rot + i * Math.PI / 5, rr = i % 2 ? r * .45 : r;
    i ? ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr) : ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
}
function star4(x, y, r) {
  ctx.moveTo(x, y - r);
  ctx.quadraticCurveTo(x, y, x + r, y); ctx.quadraticCurveTo(x, y, x, y + r);
  ctx.quadraticCurveTo(x, y, x - r, y); ctx.quadraticCurveTo(x, y, x, y - r);
  ctx.closePath();
}
function heartPath(cx, cy, s) {
  const x = cx - s / 2, y = cy - s * .45, w = s, h = s * .9;
  ctx.moveTo(x + w / 2, y + h * .3);
  ctx.bezierCurveTo(x + w / 2, y + h * .05, x, y, x, y + h * .32);
  ctx.bezierCurveTo(x, y + h * .6, x + w / 2, y + h * .8, x + w / 2, y + h);
  ctx.bezierCurveTo(x + w / 2, y + h * .8, x + w, y + h * .6, x + w, y + h * .32);
  ctx.bezierCurveTo(x + w, y, x + w / 2, y + h * .05, x + w / 2, y + h * .3);
  ctx.closePath();
}
// Полумесяц: внешний круг минус смещённый внутренний (без клипа, чтобы работала тень).
function crescentPath(x, y, r, dx, dy, r2) {
  const d = Math.hypot(dx, dy), u = Math.atan2(dy, dx);
  const a = (r * r - r2 * r2 + d * d) / (2 * d);
  const al = Math.acos(clamp(a / r, -1, 1));
  const be = Math.atan2(Math.sqrt(Math.max(0, r * r - a * a)), d - a);
  ctx.moveTo(x + Math.cos(u + al) * r, y + Math.sin(u + al) * r);
  ctx.arc(x, y, r, u + al, u + Math.PI * 2 - al, false);
  ctx.arc(x + dx, y + dy, r2, u + Math.PI + be, u + Math.PI - be, true);
  ctx.closePath();
}
function txt(s, x, y, font, color, align = 'left', base = 'alphabetic') {
  ctx.save(); shadow(0); ctx.font = font; ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = base;
  ctx.fillText(s, x, y); ctx.restore();
}
function cam(cx, cy, sc, fn) {
  ctx.save(); ctx.translate(W / 2, H / 2); ctx.scale(sc, sc); ctx.translate(-cx, -cy); fn(); ctx.restore();
}
function glow(x, y, r, color, a = 1) {
  ctx.save(); shadow(0); ctx.globalAlpha *= a;
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2); ctx.restore();
}
function rgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}

// ---------- персонажи ----------
function hairFront(st) {
  switch (st) {
    case 'messy':
      ctx.moveTo(-77, 10);
      ctx.bezierCurveTo(-84, -62, -40, -100, 4, -98);
      ctx.bezierCurveTo(50, -98, 86, -60, 77, 10);
      ctx.lineTo(66, -12); ctx.lineTo(58, -38); ctx.lineTo(42, -22); ctx.lineTo(30, -46); ctx.lineTo(12, -26);
      ctx.lineTo(-4, -48); ctx.lineTo(-22, -26); ctx.lineTo(-38, -46); ctx.lineTo(-52, -22); ctx.lineTo(-64, -34);
      ctx.closePath();
      ctx.moveTo(-8, -94); ctx.lineTo(6, -124); ctx.lineTo(14, -104); ctx.lineTo(30, -118); ctx.lineTo(26, -90); ctx.closePath();
      break;
    case 'buns':
      ctx.moveTo(-78, 14);
      ctx.bezierCurveTo(-86, -64, -40, -100, 0, -100);
      ctx.bezierCurveTo(40, -100, 86, -64, 78, 14);
      ctx.lineTo(70, -16);
      ctx.quadraticCurveTo(52, -36, 34, -26); ctx.quadraticCurveTo(18, -42, 0, -28);
      ctx.quadraticCurveTo(-18, -42, -34, -26); ctx.quadraticCurveTo(-52, -36, -70, -16);
      ctx.closePath();
      break;
    case 'short':
      ctx.moveTo(-77, 2);
      ctx.bezierCurveTo(-84, -66, -40, -100, 0, -100);
      ctx.bezierCurveTo(44, -100, 84, -66, 77, 2);
      ctx.lineTo(70, -28); ctx.quadraticCurveTo(10, -62, -40, -36); ctx.quadraticCurveTo(-62, -32, -70, -18);
      ctx.closePath();
      break;
    case 'bob': case 'long':
      ctx.moveTo(-82, 34);
      ctx.bezierCurveTo(-88, -66, -40, -100, 0, -100);
      ctx.bezierCurveTo(40, -100, 88, -66, 82, 34);
      ctx.lineTo(68, 22); ctx.quadraticCurveTo(66, -22, 40, -36);
      ctx.quadraticCurveTo(0, -24, -30, -46); ctx.quadraticCurveTo(-64, -22, -68, 22);
      ctx.closePath();
      break;
    case 'curly':
      ctx.ellipse(0, -46, 74, 50, 0, 0, Math.PI * 2);
      for (let i = 0; i <= 8; i++) {
        const a = Math.PI + i * Math.PI / 8;
        circle(Math.cos(a) * 70, -12 + Math.sin(a) * 76, 25);
      }
      break;
  }
}

function drawFace(o) {
  const expr = o.expr || 'neutral', lx = o.lx || 0, ly = o.ly || 0;
  const ex = 27, ey = 8;
  ctx.save(); shadow(0);
  ctx.fillStyle = `rgba(236,118,122,${o.blushA ?? .5})`;
  ctx.beginPath(); ctx.ellipse(-46, 32, 15, 9, 0, 0, 7); ctx.ellipse(46, 32, 15, 9, 0, 0, 7); ctx.fill();
  ctx.strokeStyle = EYE; ctx.fillStyle = EYE; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = 4.5;
  // брови
  let by = -12;
  if (expr === 'surprise') by = -22;
  ctx.beginPath();
  if (expr === 'sad' || expr === 'worried') {
    ctx.moveTo(-42, by + 2); ctx.lineTo(-17, by - 6); ctx.moveTo(42, by + 2); ctx.lineTo(17, by - 6);
  } else {
    ctx.moveTo(-42, by); ctx.quadraticCurveTo(-29, by - 6, -16, by);
    ctx.moveTo(42, by); ctx.quadraticCurveTo(29, by - 6, 16, by);
  }
  ctx.stroke();
  // глаза
  if (o.blink) {
    ctx.beginPath(); ctx.moveTo(-ex - 8, ey + 2); ctx.quadraticCurveTo(-ex, ey + 6, -ex + 8, ey + 2);
    ctx.moveTo(ex - 8, ey + 2); ctx.quadraticCurveTo(ex, ey + 6, ex + 8, ey + 2); ctx.stroke();
  } else if (expr === 'happy') {
    ctx.lineWidth = 5;
    ctx.beginPath(); ctx.arc(-ex, ey + 6, 9, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
    ctx.beginPath(); ctx.arc(ex, ey + 6, 9, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
  } else {
    const big = expr === 'surprise' ? 1.3 : 1;
    for (const s of [-1, 1]) {
      ctx.beginPath(); ctx.ellipse(s * ex + lx, ey + ly, 6.5 * big, 8.5 * big, 0, 0, 7); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(s * ex + lx + 2, ey + ly - 3, 2.2 * big, 0, 7); ctx.fill();
      ctx.fillStyle = EYE;
    }
  }
  // нос
  ctx.strokeStyle = C.skinShade; ctx.lineWidth = 3.5;
  ctx.beginPath(); ctx.moveTo(-4, 26); ctx.quadraticCurveTo(0, 31, 4, 26); ctx.stroke();
  // рот
  ctx.strokeStyle = EYE; ctx.lineWidth = 4.5; ctx.beginPath();
  const m = o.talk ? (Math.floor(o.talk * 7) % 2 ? 'open' : 'smile') : expr;
  if (m === 'sad') { ctx.moveTo(-11, 50); ctx.quadraticCurveTo(0, 42, 11, 50); ctx.stroke(); }
  else if (m === 'worried') { ctx.moveTo(-11, 47); ctx.quadraticCurveTo(-5, 43, 0, 47); ctx.quadraticCurveTo(5, 51, 11, 47); ctx.stroke(); }
  else if (m === 'smile') { ctx.moveTo(-14, 42); ctx.quadraticCurveTo(0, 54, 14, 42); ctx.stroke(); }
  else if (m === 'happy' || m === 'open') {
    ctx.fillStyle = '#7A2E3A';
    ctx.moveTo(-17, 40); ctx.quadraticCurveTo(0, 66, 17, 40); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#E7777F'; ctx.beginPath(); ctx.ellipse(0, 52, 7, 4, 0, 0, 7); ctx.fill();
  } else if (m === 'surprise') { ctx.fillStyle = '#7A2E3A'; ctx.ellipse(0, 48, 8, 10, 0, 0, 7); ctx.fill(); }
  else { ctx.moveTo(-9, 46); ctx.quadraticCurveTo(0, 49, 9, 46); ctx.stroke(); }
  ctx.restore();
}

function drawHead(o) {
  const skin = o.skin || C.skin, hair = o.hair || C.hair, st = o.style || 'messy';
  if (st === 'buns') fill(hair, () => { wellPath(-60, -82, 34, 34, 11, .05); wellPath(60, -82, 34, 34, 12, .05); }, .6);
  if (st === 'long') fill(hair, () => ctx.roundRect(-90, -70, 180, 215, [80, 80, 40, 40]), .6);
  if (st === 'bob') fill(hair, () => ctx.roundRect(-90, -70, 180, 150, [80, 80, 36, 36]), .6);
  fill(skin, () => { wellPath(-70, 12, 14, 18, 3, .05); wellPath(70, 12, 14, 18, 4, .05); }, .5);
  fill(skin, () => wellPath(0, 0, 72, 78, 5, .015), 1);
  fill(hair, () => hairFront(st), .7);
  drawFace(o);
  if (o.glasses) {
    line('#3A2F3F', 4.5, () => { circle(-27, 8, 19); circle(27, 8, 19); ctx.moveTo(-8, 6); ctx.quadraticCurveTo(0, 1, 8, 6); });
  }
  if (o.phones === 'ears') {
    line('#3B3552', 11, () => ctx.arc(0, -8, 88, Math.PI * 1.04, Math.PI * 1.96));
    fill('#3B3552', () => { ctx.roundRect(-98, -16, 28, 54, 12); ctx.roundRect(70, -16, 28, 54, 12); }, .8);
    fill(C.lilac, () => { ctx.roundRect(-94, -6, 8, 34, 4); ctx.roundRect(86, -6, 8, 34, 4); }, 0);
  }
}

// Бюст: голова с центром в (0,0), плечи ниже; o.x/o.y/o.s — положение и масштаб.
function drawBust(o) {
  ctx.save(); ctx.translate(o.x, o.y); ctx.scale(o.s, o.s); if (o.rot) ctx.rotate(o.rot);
  const sh = o.shirt || C.hoodie, sd = shade(sh, -.2), br = o.breath || 0, skin = o.skin || C.skin;
  fill(skin, () => ctx.rect(-20, 40, 40, 50), .3);
  fill(sh, () => {
    ctx.moveTo(-44, 72 - br); ctx.bezierCurveTo(-110, 76 - br, -150, 100 - br, -156, 170);
    ctx.lineTo(-166, 330); ctx.lineTo(166, 330); ctx.lineTo(156, 170);
    ctx.bezierCurveTo(150, 100 - br, 110, 76 - br, 44, 72 - br); ctx.closePath();
  }, 1);
  if (o.kind === 'hoodie') {
    fill(sd, () => ctx.ellipse(0, 80 - br, 74, 30, 0, 0, 7), .6);
    fill(shade(skin, -.12), () => ctx.ellipse(0, 76 - br, 34, 14, 0, 0, 7), 0);
    line('#F3E6CF', 5, () => { ctx.moveTo(-16, 104 - br); ctx.lineTo(-20, 176 - br); ctx.moveTo(16, 104 - br); ctx.lineTo(20, 176 - br); });
    line(sd, 4, () => ctx.roundRect(-80, 236, 160, 80, 20));
  } else if (o.kind === 'collar') {
    fill('#FBF6EA', () => {
      ctx.moveTo(-40, 72 - br); ctx.lineTo(0, 96 - br); ctx.lineTo(-18, 118 - br); ctx.lineTo(-58, 90 - br); ctx.closePath();
      ctx.moveTo(40, 72 - br); ctx.lineTo(0, 96 - br); ctx.lineTo(18, 118 - br); ctx.lineTo(58, 90 - br); ctx.closePath();
    }, .5);
  } else {
    line(sd, 9, () => ctx.ellipse(0, 76 - br, 44, 12, 0, 0, Math.PI));
  }
  if (o.phones === 'neck') {
    line('#3B3552', 11, () => { ctx.moveTo(-66, 62 - br); ctx.quadraticCurveTo(0, 124 - br, 66, 62 - br); });
    fill('#3B3552', () => { ctx.roundRect(-86, 40 - br, 30, 46, 12); ctx.roundRect(56, 40 - br, 30, 46, 12); }, .8);
    fill(C.lilac, () => { ctx.roundRect(-80, 48 - br, 18, 30, 6); ctx.roundRect(62, 48 - br, 18, 30, 6); }, 0);
  }
  ctx.save();
  ctx.translate(0, 60 + (o.headDy || 0)); ctx.rotate(o.headRot || 0); ctx.translate(0, -60);
  drawHead(o);
  ctx.restore();
  ctx.restore();
}

function drawArm(x0, y0, x1, y1, color, w = 44, hand = true, skin = C.skin, sh = 1) {
  line(color, w, () => { ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); }, sh);
  if (hand) fill(skin, () => wellPath(x1, y1, w * .5, w * .48, (x1 | 0) + 3, .05), sh);
}

// Персонаж в полный рост; (x, y) — точка между ступнями.
function drawKid(o) {
  ctx.save(); ctx.translate(o.x, o.y); ctx.scale(o.s, o.s); if (o.rot) ctx.rotate(o.rot);
  const shirt = o.shirt, skin = o.skin || C.skin, legA = o.legA || 0, bob = o.bob || 0;
  for (const side of [-1, 1]) {
    ctx.save(); ctx.translate(side * 32, -250); ctx.rotate(side * legA);
    fill(o.pants || '#3B3A5E', () => ctx.roundRect(-23, 0, 46, 222, 18), .8);
    fill(o.shoes || '#EDE6D6', () => ctx.ellipse(side * 10, 224, 36, 17, 0, 0, 7), .8);
    ctx.restore();
  }
  ctx.translate(0, -bob);
  fill(shirt, () => ctx.roundRect(-98, -452, 196, 222, [64, 64, 26, 26]), 1);
  const armA = o.armA ?? .1;
  if (!o.hold) {
    for (const side of [-1, 1]) {
      ctx.save(); ctx.translate(side * 104, -432);
      const a = side < 0 ? armA : (o.armR ?? armA);
      ctx.rotate(side * a);
      fill(shirt, () => ctx.roundRect(-21, -6, 42, 170, 21), .8);
      fill(skin, () => wellPath(0, 172, 21, 21, 40 + side, .05), .8);
      if (o.phone && side > 0) {
        fill('#1C1B2B', () => ctx.roundRect(-26, 128, 44, 74, 8), .8);
        fill('#9EC9F5', () => ctx.roundRect(-22, 132, 36, 62, 6), 0);
      }
      ctx.restore();
    }
  }
  if (o.hoodie) {
    fill(shade(shirt, -.2), () => ctx.ellipse(0, -448, 70, 26, 0, 0, 7), .5);
    line('#F3E6CF', 5, () => { ctx.moveTo(-16, -428); ctx.lineTo(-20, -372); ctx.moveTo(16, -428); ctx.lineTo(20, -372); });
  }
  if (o.phonesNeck) {
    line('#3B3552', 11, () => { ctx.moveTo(-62, -474); ctx.quadraticCurveTo(0, -414, 62, -474); });
    fill('#3B3552', () => { ctx.roundRect(-82, -494, 28, 42, 11); ctx.roundRect(54, -494, 28, 42, 11); }, .6);
  }
  if (o.hold) {
    const sb = o.sbShake || 0;
    drawArm(-88, -430, -64, -330, shirt, 42, false, skin, .8);
    drawArm(88, -430, 64, -336, shirt, 42, false, skin, .8);
    ctx.save(); ctx.translate(0, -372); ctx.rotate(-.06 + sb);
    fill('#6B4FA0', () => wrectPath(-70, -90, 140, 170, 55, 3), 1);
    fill('#FBF6EA', () => ctx.rect(-58, -84, 8, 158), 0);
    line('#8E7BC0', 3, () => ctx.roundRect(-30, -40, 60, 40, 6));
    ctx.restore();
    fill(skin, () => { wellPath(-66, -330, 22, 22, 61, .05); wellPath(64, -336, 22, 22, 62, .05); }, .8);
  }
  ctx.save(); ctx.translate(0, -536); ctx.rotate(o.headRot || 0); ctx.scale(.96, .96);
  drawHead(o);
  ctx.restore();
  ctx.restore();
}

// ---------- предметы ----------
// Рисунок Лёвы: луна с лицом. Центр в (0,0), ширина w.
function drawMoonSheet(w, h, seed = 3, sh = 1) {
  fill(C.paper, () => wrectPath(-w / 2, -h / 2, w, h, seed, w * .012), sh);
  const s = w / 300;
  ctx.save(); ctx.scale(s, s * (h / w) / (380 / 300)); shadow(0);
  ctx.fillStyle = '#F3C13A';
  ctx.beginPath(); crescentPath(-8, -14, 100, 52, -28, 86); ctx.fill();
  ctx.save(); ctx.beginPath(); crescentPath(-8, -14, 100, 52, -28, 86); ctx.clip();
  ctx.strokeStyle = 'rgba(214,140,30,.55)'; ctx.lineWidth = 3;
  for (let i = -12; i < 12; i++) { ctx.beginPath(); ctx.moveTo(-140 + i * 14, 120); ctx.lineTo(-40 + i * 14, -160); ctx.stroke(); }
  ctx.restore();
  ctx.strokeStyle = EYE; ctx.lineWidth = 5; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.arc(-58, -22, 11, Math.PI * .1, Math.PI * .9); ctx.stroke();
  ctx.beginPath(); ctx.arc(-50, 22, 14, Math.PI * .15, Math.PI * .85); ctx.stroke();
  ctx.fillStyle = 'rgba(236,118,122,.6)'; ctx.beginPath(); ctx.ellipse(-80, 8, 12, 7, 0, 0, 7); ctx.fill();
  ctx.fillStyle = C.ink;
  ctx.beginPath(); star5(96, -120, 17); star5(112, 44, 12); star5(-104, 132, 12); star5(58, -40, 8); ctx.fill();
  ctx.font = '700 34px Caveat'; ctx.fillText('лёва', 44, 158);
  ctx.restore();
}

// Бумажный самолётик, нос смотрит вправо.
function drawPlane(x, y, s, rot, alpha = 1, flip = 1) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.scale(s, s * flip); ctx.globalAlpha *= alpha;
  fill('#FDF8EC', () => { ctx.moveTo(62, 0); ctx.lineTo(-52, -30); ctx.lineTo(-26, 2); ctx.closePath(); }, .8);
  fill('#D8CFBF', () => { ctx.moveTo(62, 0); ctx.lineTo(-26, 2); ctx.lineTo(-46, 20); ctx.closePath(); }, .5);
  line('rgba(120,110,140,.5)', 2, () => { ctx.moveTo(60, 0); ctx.lineTo(-26, 2); });
  ctx.restore();
}

function drawMoon(x, y, r, t, face = true) {
  glow(x, y, r * 2.4, 'rgba(255,236,190,0.22)');
  fill(C.moon, () => crescentPath(x, y, r, r * .5, -r * .25, r * .85), 1);
  if (!face) return;
  ctx.save(); shadow(0); ctx.strokeStyle = '#6B5A7E'; ctx.lineWidth = Math.max(2, r * .05); ctx.lineCap = 'round';
  const fx = x - r * .52, fy = y + r * .1;
  const bl = blinkAt(t, 9);
  ctx.beginPath();
  if (bl) { ctx.moveTo(fx - r * .1, fy - r * .18); ctx.lineTo(fx + r * .08, fy - r * .18); }
  else ctx.arc(fx, fy - r * .2, r * .09, Math.PI * .1, Math.PI * .9);
  ctx.stroke();
  ctx.beginPath(); ctx.arc(fx + r * .05, fy + r * .12, r * .12, Math.PI * .15, Math.PI * .85); ctx.stroke();
  ctx.fillStyle = 'rgba(236,140,140,.55)'; ctx.beginPath(); ctx.ellipse(fx - r * .2, fy + r * .02, r * .09, r * .055, 0, 0, 7); ctx.fill();
  ctx.restore();
}

function drawStars(t, x0, y0, x1, y1, seed, n, scale = 1) {
  const R = rng(seed);
  ctx.save(); shadow(0); ctx.fillStyle = C.star;
  for (let i = 0; i < n; i++) {
    const x = lerp(x0, x1, R()), y = lerp(y0, y1, R()), r = (1.6 + R() * 2.6) * scale, ph = R() * 6.28, sp = R() < .2;
    ctx.globalAlpha = .35 + .65 * (.5 + .5 * Math.sin(t * 2.2 + ph));
    ctx.beginPath(); sp ? star4(x, y, r * 3.2) : circle(x, y, r); ctx.fill();
  }
  ctx.restore();
}

function drawVines(x, y0, y1, seed) {
  const R = rng(seed);
  line('#3F6B4B', 3, () => { ctx.moveTo(x, y0); for (let y = y0; y < y1; y += 40) ctx.quadraticCurveTo(x + 14, y + 20, x, y + 40); });
  for (let y = y0 + 10; y < y1; y += 26) {
    const s = R() < .5 ? -1 : 1;
    fill(R() < .5 ? C.leaf : '#4A8A5A', () => ctx.ellipse(x + s * 12, y, 11, 6, s * .6, 0, 7), .4);
  }
}

function sleeve(x0, y0, x1, y1, w = 110, color = C.hoodie) {
  line(color, w, () => { ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); }, 1.2);
  line(shade(color, -.14), w + 6, () => {
    const d = Math.hypot(x1 - x0, y1 - y0), k = 22 / d;
    ctx.moveTo(x1 + (x0 - x1) * k, y1 + (y0 - y1) * k); ctx.lineTo(x1, y1);
  }, 0);
}

// ---------- телефон ----------
const logo = new Image();
logo.src = '../../public/assets/noctgram-logo.png';

const PEOPLE = {
  leva: { style: 'messy', hair: C.hair, shirt: C.hoodie, kind: 'hoodie', bg: '#3B2F6E' },
  mila: { style: 'buns', hair: '#6B3A2A', shirt: '#9D84D6', kind: 'collar', bg: '#F2B8C6' },
  tema: { style: 'curly', hair: '#2B2030', shirt: '#4E9A7A', skin: '#C98E6A', glasses: true, bg: '#9ED0C4' },
};
function avatar(x, y, r, who, extra = {}) {
  const p = PEOPLE[who];
  ctx.save(); ctx.beginPath(); circle(x, y, r); ctx.clip();
  ctx.fillStyle = p.bg; ctx.fillRect(x - r, y - r, r * 2, r * 2);
  drawBust({ ...p, x, y: y + r * .12, s: r / 100, expr: 'smile', ...extra });
  ctx.restore();
}
function iconHeart(x, y, s, filled, color = '#fff') {
  if (filled) fill(color, () => heartPath(x, y, s), 0);
  else line(color, 3, () => heartPath(x, y, s));
}
function iconComment(x, y, s) {
  line('#fff', 3, () => { ctx.roundRect(x - s / 2, y - s * .42, s, s * .72, s * .3); ctx.moveTo(x - s * .2, y + s * .3); ctx.lineTo(x - s * .28, y + s * .5); ctx.lineTo(x, y + s * .3); });
}
function iconStar(x, y, s) { line('#FFD36A', 3, () => star5(x, y, s * .55)); }
function statusBar(time, w) {
  txt(time, 40, 50, '800 24px Nunito', '#fff');
  ctx.save(); shadow(0); ctx.fillStyle = '#fff';
  for (let i = 0; i < 4; i++) ctx.fillRect(w - 150 + i * 9, 44 - i * 5, 6, 6 + i * 5);
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.strokeRect(w - 96, 30, 44, 20);
  ctx.fillRect(w - 92, 34, 30, 12); ctx.fillRect(w - 50, 36, 4, 8);
  ctx.restore();
}

// Фото рисунка внутри карточки поста.
function photoOfDrawing(x, y, w, h) {
  ctx.save(); ctx.beginPath(); ctx.roundRect(x, y, w, h, 22); ctx.clip();
  ctx.fillStyle = '#6E4630'; ctx.fillRect(x, y, w, h);
  const g = ctx.createRadialGradient(x + w * .4, y + h * .3, 10, x + w / 2, y + h / 2, w * .8);
  g.addColorStop(0, 'rgba(255,210,150,.35)'); g.addColorStop(1, 'rgba(0,0,0,.2)');
  ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
  ctx.translate(x + w / 2, y + h / 2); ctx.rotate(-.05);
  drawMoonSheet(h * .62, h * .8, 4);
  ctx.restore();
}

// ---------- сцена 1: школьный коридор ----------
const KIDS = [
  { x: 150, style: 'bob', hair: '#6B3A2A', shirt: '#D9695F', pants: '#34325A', ph: 0 },
  { x: 300, style: 'curly', hair: '#2B2030', shirt: '#4E9A7A', skin: '#C98E6A', pants: '#2F3B55', ph: 1.3, phone: true },
  { x: 430, style: 'long', hair: '#E0B04A', shirt: '#B06FB0', pants: '#3E3A66', ph: 2.1 },
  { x: 930, style: 'buns', hair: '#2B2030', shirt: '#5FA8C9', pants: '#34325A', ph: .7 },
];
function sceneCorridor(t) {
  const [cx, cy, sc] = kf(t, [[0, 540, 610, 1.1], [5.0, 545, 615, 1.12], [6.4, 610, 690, 1.3]]);
  cam(cx, cy, sc, () => {
    ctx.fillStyle = '#E9D6B0'; ctx.fillRect(-300, -300, 1700, 1100);
    ctx.fillStyle = '#DCC49A'; ctx.fillRect(-300, 250, 1700, 14);
    // часы
    fill('#F8F1E2', () => circle(540, 140, 58), 1);
    line('#6A4E8A', 8, () => circle(540, 140, 58));
    line(EYE, 5, () => { ctx.moveTo(540, 140); ctx.lineTo(540, 104); ctx.moveTo(540, 140); ctx.lineTo(566, 152); });
    // шкафчики
    for (let i = 0; i < 12; i++) {
      const x = -120 + i * 118, col = i % 2 ? '#5C8EA8' : '#6A9DB6';
      fill(col, () => wrectPath(x, 300, 112, 420, 30 + i, 2.5), .8);
      line('#3F6D86', 3, () => { for (const yy of [330, 344, 358]) { ctx.moveTo(x + 30, yy); ctx.lineTo(x + 82, yy); } });
      fill('#E7E0CF', () => ctx.rect(x + 88, 500, 10, 36), .4);
    }
    ctx.fillStyle = '#C08D5B'; ctx.fillRect(-300, 720, 1700, 700);
    ctx.fillStyle = '#8C6139'; ctx.fillRect(-300, 710, 1700, 18);
    line('rgba(110,70,40,.35)', 3, () => { for (const yy of [800, 890, 990]) { ctx.moveTo(-300, yy); ctx.lineTo(1400, yy); } });

    const bump = 3.3;
    // группа, которая смеётся и ничего не замечает
    KIDS.forEach((k, i) => {
      const laugh = Math.abs(Math.sin(t * 7 + k.ph));
      ctx.save(); ctx.globalAlpha = .25; ctx.fillStyle = '#5A3A22';
      ctx.beginPath(); ctx.ellipse(k.x, 890, 90, 16, 0, 0, 7); ctx.fill(); ctx.restore();
      drawKid({ ...k, y: 885, s: .78, expr: 'happy', bob: laugh * 9, headRot: Math.sin(t * 3 + k.ph) * .06,
        armA: k.phone ? .1 : .1 + laugh * .05, armR: k.phone ? .9 : undefined, lx: i < 3 ? 4 : -4 });
    });
    // одноклассник, который пятится и задевает Лёву
    const bx = kf(t, [[0, 800], [2.8, 800], [3.35, 700], [3.6, 690], [4.4, 790]])[0];
    drawKid({ x: bx, y: 900, s: .84, style: 'short', hair: '#8A5A2B', shirt: '#5B7FB8', pants: '#2F3B55',
      skin: '#F0C09A', expr: 'happy', bob: Math.abs(Math.sin(t * 7)) * 9, lx: 4, headRot: Math.sin(t * 3) * .05 });

    // Лёва
    const walking = t < bump;
    const lx = walking ? lerp(-140, 560, t / bump) : 560 + kf(t, [[bump, 0], [3.42, -22], [3.8, -8]])[0];
    const ph = t * 7.8;
    const jolt = t > bump ? Math.exp(-(t - bump) * 6) * Math.sin((t - bump) * 30) : 0;
    let expr = 'neutral', ly = 3, lookX = 2;
    if (t > bump && t < 4.1) { expr = 'surprise'; ly = 0; lookX = 5; }
    else if (t >= 4.1) { expr = 'sad'; ly = 7; lookX = 5; }
    ctx.save(); ctx.globalAlpha = .28; ctx.fillStyle = '#5A3A22';
    ctx.beginPath(); ctx.ellipse(lx, 992, 100, 18, 0, 0, 7); ctx.fill(); ctx.restore();
    drawKid({ x: lx, y: 988, s: 1, style: 'messy', shirt: C.hoodie, hoodie: true, pants: '#3E3A66', shoes: '#EDE6D6',
      phonesNeck: true, hold: true, sbShake: jolt * .2, rot: jolt * .05,
      legA: walking ? Math.sin(ph) * .32 : 0, bob: walking ? (1 - Math.abs(Math.sin(ph))) * 9 : 0,
      expr, ly, lx: lookX, blink: t > 4.6 ? blinkAt(t, 2) : 0,
      headRot: t > 4.1 ? .08 : 0 });

    // выпавший рисунок
    if (t > bump) {
      const p = prog(t, bump, 5.3);
      const y = p < .18 ? 650 - 110 * easeOut(p / .18) : lerp(540, 1000, ease((p - .18) / .82));
      const x = 590 + 150 * p + 50 * Math.sin(p * 10) * (1 - p);
      const rot = Math.sin(p * 10) * .7 * (1 - p) + p * .2;
      const flat = lerp(1, .42, ease(prog(p, .8, 1)));
      ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.scale(1, flat);
      drawMoonSheet(118, 150, 5, 1.2);
      ctx.restore();
    }
  });
}

// ---------- сцена 1б: рисунок на полу ----------
function shoeTop(x, y, rot, flip) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.scale(flip, 1);
  fill('#F3EEE4', () => ctx.roundRect(-46, -110, 92, 220, 46), 1.4);
  fill('#D9695F', () => ctx.roundRect(-46, 20, 92, 26, 10), 0);
  line('#B9B2A6', 4, () => { for (let i = 0; i < 4; i++) { ctx.moveTo(-20, -60 + i * 18); ctx.lineTo(20, -60 + i * 18); } });
  ctx.restore();
}
function sceneFloor(t) {
  const lt = t - 6.4;
  ctx.fillStyle = '#C08D5B'; ctx.fillRect(0, 0, W, H);
  const R = rng(81);
  line('rgba(110,70,40,.4)', 3, () => { for (let x = 0; x < W; x += 150) { ctx.moveTo(x, 0); ctx.lineTo(x, H); } });
  line('rgba(110,70,40,.18)', 2, () => { for (let i = 0; i < 40; i++) { const x = R() * W, y = R() * H; ctx.moveTo(x, y); ctx.lineTo(x + (R() - .5) * 8, y + 60 + R() * 80); } });
  // чужие шаги поверх рисунка
  const steps = [[-.1, 140, -60], [.12, 300, 90], [.34, 470, 40], [.56, 640, 150], [.78, 820, 100], [1.0, 1000, 210], [1.22, 1180, 170]];
  steps.forEach(([st, x, y], i) => {
    if (lt > st && lt < st + .45) {
      const a = 1 - prog(lt, st + .3, st + .45);
      ctx.save(); ctx.globalAlpha = a; shoeTop(x, y, 1.35, i % 2 ? -1 : 1); ctx.restore();
    }
  });
  const lift = ease(prog(t, 7.55, 8.0));
  ctx.save(); ctx.translate(540, 620 - lift * 150); ctx.rotate(-.12 + lift * .1); ctx.scale(1 + lift * .08, 1 + lift * .08);
  drawMoonSheet(460, 580, 6, 1 + lift * 2);
  ctx.restore();
  // рука Лёвы
  const reach = ease(prog(t, 7.15, 7.55));
  if (reach > 0) {
    const hx = 600, hy = lerp(-160, 360, reach) - lift * 150;
    sleeve(640, -300, hx + 20, hy - 70, 130);
    fill(C.skin, () => wellPath(hx, hy, 66, 56, 91, .06), 1.2);
    fill(C.skin, () => { wellPath(hx - 62, hy + 30, 22, 28, 92, .05); }, .8);
  }
}

// ---------- сцена 2: ночной дом и окна ----------
function drawWindow(x, y, w, h, interior, t, opt = {}) {
  fill(C.frame, () => wrectPath(x - 24, y - 24, w + 48, h + 48, (x | 0) + 7, 3), 1.2);
  ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.translate(x, y); interior(w, h, t);
  if (opt.curtain !== false) {
    const cc = opt.curtain || C.curtain, sway = Math.sin(t * 1.3 + x) * 4;
    fill(cc, () => { ctx.moveTo(0, 0); ctx.lineTo(w * .17, 0); ctx.quadraticCurveTo(w * .09 + sway, h * .55, w * .14, h); ctx.lineTo(0, h); ctx.closePath(); }, .9);
    fill(cc, () => { ctx.moveTo(w, 0); ctx.lineTo(w * .83, 0); ctx.quadraticCurveTo(w * .91 - sway, h * .55, w * .86, h); ctx.lineTo(w, h); ctx.closePath(); }, .9);
  }
  ctx.fillStyle = 'rgba(255,255,255,.05)';
  ctx.beginPath(); ctx.moveTo(w * .55, 0); ctx.lineTo(w * .75, 0); ctx.lineTo(w * .35, h); ctx.lineTo(w * .15, h); ctx.fill();
  ctx.restore();
  fill(C.sill, () => wrectPath(x - 42, y + h + 6, w + 84, 28, (x | 0) + 9, 2), 1.2);
}

function inFamily(w, h, t) {
  ctx.fillStyle = '#F4C35C'; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#E9B04A'; for (let i = 0; i < 40; i++) ctx.fillRect((i * 97) % w, (i * 53) % 300, 6, 6);
  glow(210, 120, 260, 'rgba(255,240,190,.5)');
  line('#5A3A30', 3, () => { ctx.moveTo(210, 0); ctx.lineTo(210, 64); });
  fill('#E9744F', () => { ctx.moveTo(172, 64); ctx.lineTo(248, 64); ctx.lineTo(270, 106); ctx.lineTo(150, 106); ctx.closePath(); }, .8);
  const b = k => Math.abs(Math.sin(t * 6 + k)) * 6;
  drawBust({ x: 92, y: 232 - b(0), s: .42, style: 'short', hair: '#4A3222', shirt: '#5B7FB8', expr: 'happy', glasses: true, headRot: Math.sin(t * 2) * .06 });
  drawBust({ x: 328, y: 236 - b(1), s: .42, style: 'long', hair: '#7A3B2A', shirt: '#D9695F', expr: 'happy', headRot: -Math.sin(t * 2.3) * .06 });
  drawBust({ x: 210, y: 276 - b(2), s: .34, style: 'bob', hair: '#2B2030', shirt: '#7FB069', expr: 'happy', blink: blinkAt(t, 3) });
  fill('#A0643F', () => ctx.rect(-10, 330, w + 20, 100), 1);
  fill('#F3E6CF', () => ctx.rect(-10, 322, w + 20, 34), .8);
  fill('#fff', () => { ctx.ellipse(110, 336, 44, 10, 0, 0, 7); ctx.ellipse(310, 336, 44, 10, 0, 0, 7); }, .5);
  fill('#E9744F', () => { ctx.ellipse(210, 330, 38, 12, 0, 0, 7); }, .5);
}
function kidBack(x, y, s, hair, shirt, armsUp) {
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
  if (armsUp > 0) {
    for (const sd of [-1, 1]) {
      ctx.save(); ctx.translate(sd * 110, 90); ctx.rotate(sd * lerp(.2, 2.5, armsUp));
      fill(shirt, () => ctx.roundRect(-24, 0, 48, 150, 24), .8);
      fill(C.skin, () => circle(0, 156, 24), .8);
      ctx.restore();
    }
  }
  fill(shirt, () => ctx.roundRect(-150, 60, 300, 280, [130, 130, 0, 0]), 1);
  fill(C.skin, () => { wellPath(-70, 10, 14, 18, 3); wellPath(70, 10, 14, 18, 4); }, .5);
  fill(hair, () => wellPath(0, -6, 78, 84, 17, .05), 1);
  ctx.restore();
}
function inGaming(w, h, t) {
  ctx.fillStyle = '#2E3B73'; ctx.fillRect(0, 0, w, h);
  const fl = .5 + .5 * Math.sin(t * 17) * Math.sin(t * 5.3);
  glow(210, 150, 300, `rgba(120,200,255,${.35 + fl * .2})`);
  fill('#1C1B33', () => ctx.roundRect(80, 60, 260, 170, 12), 1);
  ctx.fillStyle = fl > .5 ? '#9FDDF7' : '#7FCCEF'; ctx.fillRect(92, 72, 236, 146);
  ctx.fillStyle = '#5DBB63'; ctx.fillRect(92, 188, 236, 30);
  ctx.fillStyle = '#E9744F'; ctx.fillRect(150 + (t * 60) % 120, 160 - Math.abs(Math.sin(t * 5)) * 40, 20, 26);
  ctx.fillStyle = '#FFD36A'; ctx.beginPath(); star5(280, 110, 14); ctx.fill();
  fill('#8C4A6B', () => ctx.roundRect(10, 320, 400, 140, 36), 1);
  const win = ease(prog(t, 12.05, 12.35)) * (1 - ease(prog(t, 12.7, 13.0)));
  const bnc = k => Math.abs(Math.sin(t * 6 + k)) * 8 + win * 20;
  kidBack(130, 300 - bnc(0), .55, '#2B2030', '#E9744F', win);
  kidBack(295, 305 - bnc(1.4), .55, '#C98A3A', '#6C5BB5', win);
}
function inTalk(w, h, t) {
  ctx.fillStyle = '#F2B8A0'; ctx.fillRect(0, 0, w, h);
  line('#5A3A30', 2, () => { ctx.moveTo(0, 40); ctx.quadraticCurveTo(w / 2, 90, w, 40); });
  const cols = ['#FFD36A', '#C9B6FF', '#9EE6C8', '#FF9EA8'];
  for (let i = 0; i < 9; i++) {
    const x = 20 + i * 46, y = 40 + Math.sin(i / 8 * Math.PI) * 45 + 8;
    glow(x, y, 26, rgba(cols[i % 4].replace('#', '#'), .6));
    fill(cols[i % 4], () => circle(x, y, 7), 0);
  }
  const talkA = (t % 2.4) < 1.2;
  drawBust({ x: 118, y: 240, s: .44, style: 'bob', hair: '#2B2030', shirt: '#6C5BB5', lx: 5, expr: talkA ? 'smile' : 'happy', talk: talkA ? t : 0, headRot: .06, blink: blinkAt(t, 4) });
  drawBust({ x: 304, y: 236, s: .44, style: 'curly', hair: '#3A2A20', skin: '#C98E6A', shirt: '#E9744F', lx: -5, expr: talkA ? 'happy' : 'smile', talk: talkA ? 0 : t, headRot: -.06 });
  fill('#7A4E6E', () => ctx.rect(-10, 350, w + 20, 80), 1);
  for (const mx of [150, 270]) {
    fill('#FBF6EA', () => ctx.roundRect(mx - 20, 318, 40, 40, 6), .6);
    line('rgba(255,255,255,.6)', 3, () => { for (let k = 0; k < 2; k++) { const ox = mx - 6 + k * 12; ctx.moveTo(ox, 310); ctx.quadraticCurveTo(ox + 8 * Math.sin(t * 3 + k), 290, ox, 270); } });
  }
}
function inLeva(w, h, t, mood = 'sad') {
  ctx.fillStyle = '#2A2452'; ctx.fillRect(0, 0, w, h);
  glow(60, 250, 260, 'rgba(255,200,120,.45)');
  fill('#E0B04A', () => { ctx.moveTo(30, 230); ctx.lineTo(96, 230); ctx.lineTo(80, 196); ctx.lineTo(46, 196); ctx.closePath(); }, .6);
  ctx.save(); ctx.translate(326, 110); ctx.rotate(.08); drawMoonSheet(76, 96, 8, .6); ctx.restore();
  const breath = (Math.sin(t * 1.3) * .5 + .5) * 8;
  drawBust({ x: 210, y: 250, s: .46, style: 'messy', shirt: C.hoodie, kind: 'hoodie', phones: 'ears',
    expr: mood, ly: 7, lx: -2, breath, headDy: breath * .4, headRot: -.05, blink: blinkAt(t, 1) });
  fill('#5A3F5E', () => ctx.rect(-10, 356, w + 20, 80), 1);
}
function inCurtained(w, h, t, seed) {
  ctx.fillStyle = '#F6C75A'; ctx.fillRect(0, 0, w, h);
  glow(w / 2, h / 2, 260, 'rgba(255,230,170,.4)');
  const cc = seed % 2 ? '#8FB8A8' : '#D98AA8';
  fill(cc, () => { ctx.rect(0, 0, w / 2 - 4, h); }, .6);
  fill(shade(cc, -.1), () => { ctx.rect(w / 2 + 4, 0, w / 2, h); }, .6);
  if (seed % 3 === 0) {
    fill('#2B2458', () => { ctx.ellipse(w * .7, h - 40, 40, 36, 0, 0, 7); circle(w * .7, h - 96, 28); ctx.moveTo(w * .7 - 24, h - 118); ctx.lineTo(w * .7 - 18, h - 142); ctx.lineTo(w * .7 - 6, h - 122); ctx.moveTo(w * .7 + 24, h - 118); ctx.lineTo(w * .7 + 18, h - 142); ctx.lineTo(w * .7 + 6, h - 122); }, 0);
  } else {
    fill('#3E7A55', () => { for (let i = 0; i < 5; i++) ctx.ellipse(w * .3 + (i - 2) * 16, h - 70 - Math.abs(i - 2) * -10, 12, 36, (i - 2) * .4, 0, 7); }, .5);
    fill('#C9744F', () => ctx.roundRect(w * .3 - 34, h - 50, 68, 50, 6), .6);
  }
}

function drawFacade(t, opt = {}) {
  fill(C.far2, () => {
    ctx.moveTo(-600, 320); const R = rng(44);
    for (let x = -600; x < 3200; x += 120) { const hh = 120 + R() * 180; ctx.lineTo(x, 320 - hh); ctx.lineTo(x + 110, 320 - hh); }
    ctx.lineTo(3200, 320); ctx.closePath();
  }, 0);
  ctx.fillStyle = C.wall; ctx.fillRect(-400, 300, 3300, 1200);
  const R = rng(12);
  line('rgba(255,255,255,.06)', 3, () => { for (let i = 0; i < 220; i++) { const x = -400 + R() * 3300, y = 320 + R() * 1100; ctx.moveTo(x, y); ctx.lineTo(x + 40, y); } });
  fill(C.wallDark, () => ctx.rect(-400, 282, 3300, 34), 1);
  const wx = [155, 705, 1255, 1805];
  const ins = [inFamily, inGaming, inTalk, (w, h, tt) => inLeva(w, h, tt, 'sad')];
  const cur = ['#E98A8A', '#6C8FD6', '#E9B04A', '#4B4A8A'];
  wx.forEach((x, i) => drawWindow(x, 380, 420, 420, ins[i], t, { curtain: cur[i] }));
  wx.forEach((x, i) => drawWindow(x, 960, 420, 420, (w, h, tt) => inCurtained(w, h, tt, i), t, { curtain: false }));
  drawVines(40, 300, 1500, 5); drawVines(2330, 300, 1500, 6);
  ctx.fillStyle = '#231C45'; ctx.fillRect(-400, 1480, 3300, 700);
}

function sceneFacade(t) {
  const [cx, cy, sc] = kf(t, [
    [8.0, 1200, 640, .44], [9.4, 1200, 620, .5], [10.2, 365, 590, 1.35], [11.3, 365, 590, 1.4],
    [11.8, 915, 590, 1.4], [12.8, 915, 590, 1.42], [13.3, 1465, 590, 1.42], [14.2, 1465, 590, 1.44],
    [14.8, 2015, 590, 1.4], [16.0, 2015, 600, 1.62],
  ]);
  const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, C.skyTop); g.addColorStop(1, C.skyBot);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  cam(cx, cy, sc, () => {
    drawStars(t, -800, -900, 3000, 200, 101, 160, 1.6);
    drawMoon(560, -330, 150, t);
    drawFacade(t);
  });
}

// ---------- сцена 3: тетрадь ----------
function drawDesk(lamp = 1) {
  ctx.fillStyle = '#6E4630'; ctx.fillRect(0, 0, W, H);
  line('rgba(40,20,10,.25)', 3, () => { for (let y = 60; y < H; y += 180) { ctx.moveTo(0, y); ctx.lineTo(W, y); } });
  const R = rng(5);
  line('rgba(40,20,10,.14)', 2, () => { for (let i = 0; i < 50; i++) { const x = R() * W, y = R() * H; ctx.moveTo(x, y); ctx.lineTo(x + 60 + R() * 120, y + (R() - .5) * 6); } });
  if (lamp) glow(520, 480, 720, `rgba(255,200,140,${.32 * lamp})`);
  ctx.save(); ctx.globalAlpha = 1 - lamp * .5;
  const v = ctx.createRadialGradient(540, 540, 200, 540, 540, 820);
  v.addColorStop(0, 'rgba(20,10,40,0)'); v.addColorStop(1, 'rgba(20,10,40,.6)');
  ctx.fillStyle = v; ctx.fillRect(0, 0, W, H); ctx.restore();
}
function notebookBack() {
  fill('#5B3F8C', () => wrectPath(170, 150, 740, 840, 71, 4), 1.4);
}
function paperPage(x, y, w, h, seed) {
  fill(C.paper, () => wrectPath(x, y, w, h, seed, 3), .8);
  line(C.rule, 3, () => { for (let yy = y + 150; yy < y + h - 20; yy += 85) { ctx.moveTo(x + 8, yy); ctx.lineTo(x + w - 8, yy); } });
  line(C.margin, 3, () => { ctx.moveTo(x + 84, y + 10); ctx.lineTo(x + 84, y + h - 10); });
}
function spiral() {
  for (let i = 0; i < 15; i++) {
    const x = 214 + i * 46;
    fill('#3A2F4F', () => circle(x, 196, 7), 0);
    line('#9A96B0', 6, () => ctx.ellipse(x, 176, 8, 24, 0, Math.PI * .9, Math.PI * 2.1));
  }
}
// Постепенно «пишет» строку; возвращает положение кончика ручки.
function writeLine(s, x, y, size, p) {
  ctx.save(); shadow(0); ctx.font = `700 ${size}px Caveat`;
  const w = ctx.measureText(s).width;
  ctx.beginPath(); ctx.rect(x - 10, y - size, w * p + 10, size * 1.5); ctx.clip();
  ctx.fillStyle = C.ink; ctx.fillText(s, x, y);
  ctx.restore();
  return [x + w * p, y - size * .22 + Math.sin(p * 40) * size * .12];
}
function drawWritingHand(px, py, t) {
  px += Math.sin(t * 37) * 2; py += Math.cos(t * 29) * 3;
  sleeve(px + 520, py + 820, px + 118, py + 150, 128);
  line('#2B3F80', 13, () => { ctx.moveTo(px, py); ctx.lineTo(px + 74, py - 86); }, .6);
  fill('#E9EDF5', () => circle(px + 2, py - 2, 5), 0);
  fill(C.skin, () => wellPath(px + 78, py + 42, 62, 52, 77, .06), 1.2);
  line(C.skinShade, 3, () => { ctx.moveTo(px + 60, py + 10); ctx.quadraticCurveTo(px + 80, py + 4, px + 100, py + 14); });
  fill(C.skin, () => wellPath(px + 32, py + 18, 24, 20, 78, .05), .8);
}
const SHAPE_RECT = [[0, -1], [1, -1], [1, 1], [0, 1], [-1, 1], [-1, -1]];
const SHAPE_HOUSE = [[0, -1], [1, -.25], [1, 1], [0, 1], [-1, 1], [-1, -.25]];
const SHAPE_PLANE = [[0, -1], [.82, .62], [.16, .5], [0, .8], [-.16, .5], [-.82, .62]];
function morphShape(m) {
  const A = m < 1 ? SHAPE_RECT : SHAPE_HOUSE, B = m < 1 ? SHAPE_HOUSE : SHAPE_PLANE, k = ease(m < 1 ? m : m - 1);
  return A.map((p, i) => [lerp(p[0], B[i][0], k), lerp(p[1], B[i][1], k)]);
}
function sceneNotebook(t, T) {
  const [w1a, w1b, w2a, w2b, lift0, fold0, fold1, fly0, fly1] = T;
  drawDesk(1);
  notebookBack();
  paperPage(200, 170, 680, 790, 72);
  spiral();
  const detached = t > lift0;
  const PX = 540, PY = 565;
  if (!detached) {
    paperPage(200, 170, 680, 790, 73);
    spiral();
    const p1 = prog(t, w1a, w1b), p2 = prog(t, w2a, w2b);
    let pen = writeLine('кто-нибудь', 285, 470, 128, p1);
    if (t > w2a) pen = writeLine('не спит?', 285, 650, 128, p2);
    const writing = t > w1a - .25;
    if (writing) {
      const idle = t < w1a ? prog(t, w1a - .25, w1a) : 1;
      drawWritingHand(pen[0] + (1 - idle) * 300, pen[1] + (1 - idle) * 300, t);
    }
    spiral();
    return;
  }
  // страница отрывается и складывается в самолётик
  const lp = ease(prog(t, lift0, fold0));
  const m = prog(t, fold0, fold1) * 2;
  const fp = easeIn(prog(t, fly0, fly1));
  const cx = PX + fp * 700, cy = PY - 30 * lp - fp * 900;
  const sc = (1 + .04 * lp) * lerp(1, .62, ease(prog(t, fold0, fold1))) * (1 - fp * .5);
  const rot = -.05 * lp + ease(prog(t, fold0, fold1)) * .5 + fp * .3;
  const pts = morphShape(Math.min(m, 1.999));
  const sx = 340, sy = 395;
  ctx.save(); ctx.translate(cx, cy); ctx.rotate(rot); ctx.scale(sc, sc);
  fill(C.paper, () => { pts.forEach((p, i) => (i ? ctx.lineTo(p[0] * sx, p[1] * sy) : ctx.moveTo(p[0] * sx, p[1] * sy))); ctx.closePath(); }, 1 + lp * 2);
  ctx.save(); ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p[0] * sx, p[1] * sy) : ctx.moveTo(p[0] * sx, p[1] * sy))); ctx.clip();
  const ta = 1 - prog(m, 0, .6);
  if (ta > 0) {
    ctx.globalAlpha = ta; ctx.translate(-PX, -PY);
    line(C.rule, 3, () => { for (let yy = 320; yy < 940; yy += 85) { ctx.moveTo(208, yy); ctx.lineTo(872, yy); } });
    txt('кто-нибудь', 285, 470, '700 128px Caveat', C.ink);
    txt('не спит?', 285, 650, '700 128px Caveat', C.ink);
    ctx.translate(PX, PY); ctx.globalAlpha = 1;
  }
  if (m > .3) {
    ctx.fillStyle = 'rgba(120,100,140,.16)';
    ctx.beginPath(); ctx.moveTo(0, -sy); ctx.lineTo(0, sy); ctx.lineTo(-sx, sy); ctx.lineTo(-sx, -sy); ctx.fill();
    line('rgba(120,100,140,.5)', 3, () => { ctx.moveTo(0, -sy); ctx.lineTo(0, sy); });
  }
  ctx.restore();
  ctx.restore();
  // обрывки бумаги
  const bits = prog(t, lift0, lift0 + .6);
  if (bits > 0 && bits < 1) {
    const R = rng(33);
    for (let i = 0; i < 9; i++) {
      const bx = 230 + R() * 620, vy = 120 + R() * 160;
      fill(C.paper, () => wellPath(bx + (R() - .5) * 80 * bits, 176 - vy * bits + 300 * bits * bits, 8, 5, i + 2, .2), .5);
    }
  }
  // руки держат лист по краям
  if (fp < .2) {
    const hx = sx * lerp(1, .55, ease(prog(t, fold0, fold1))) * sc;
    const hy = cy + 120 * sc;
    sleeve(-80, 1200, cx - hx - 40, hy + 90, 118);
    sleeve(1160, 1200, cx + hx + 40, hy + 90, 118);
    fill(C.skin, () => { wellPath(cx - hx - 10, hy + 40, 50, 58, 101, .06); wellPath(cx + hx + 10, hy + 40, 50, 58, 102, .06); }, 1.2);
  }
}

// ---------- сцена 3б / финал: окно Лёвы снаружи ----------
function drawExterior(t, mode) {
  const g = ctx.createLinearGradient(0, -1400, 0, 1080);
  g.addColorStop(0, '#0B0A26'); g.addColorStop(.55, C.skyTop); g.addColorStop(1, C.skyBot);
  ctx.fillStyle = g; ctx.fillRect(-200, -1500, 1500, 2700);
  drawStars(t, -100, -1500, 1180, 380, 202, 150, 1.3);
  if (mode === 'fail') drawMoon(880, 150, 70, t);
  // дальний город справа
  const R = rng(61);
  const bl = [[520, 430, 170], [690, 520, 150], [840, 380, 140], [980, 470, 160]];
  bl.forEach(([x, y, w], i) => {
    fill(i % 2 ? C.far : C.far2, () => ctx.rect(x, y, w, 900 - y), .6);
    for (let yy = y + 30; yy < 860; yy += 62) for (let xx = x + 22; xx < x + w - 30; xx += 44) {
      const r = R();
      let col = null;
      if (mode === 'fly') col = r < .5 ? C.winLilac : r < .8 ? C.winWarm : null;
      else col = r < .45 ? C.winWarm : null;
      if (col) { ctx.fillStyle = col; ctx.fillRect(xx, yy, 20, 28); if (col === C.winLilac) glow(xx + 10, yy + 14, 40, 'rgba(201,182,255,.35)'); }
      else { ctx.fillStyle = C.winDark; ctx.fillRect(xx, yy, 20, 28); }
    }
  });
  if (mode === 'fly') {
    // окна друзей
    for (const [fx, fy, who] of [[720, 560, 'mila'], [1000, 640, 'tema']]) {
      glow(fx + 40, fy + 40, 160, 'rgba(201,182,255,.55)');
      fill(C.frame, () => ctx.rect(fx - 8, fy - 8, 96, 96), .8);
      ctx.save(); ctx.beginPath(); ctx.rect(fx, fy, 80, 80); ctx.clip();
      ctx.fillStyle = C.winLilac; ctx.fillRect(fx, fy, 80, 80);
      drawBust({ ...PEOPLE[who], x: fx + 40, y: fy + 44, s: .22, expr: 'happy', phones: 'ears' });
      ctx.restore();
    }
  }
  // улица
  ctx.fillStyle = '#241E45'; ctx.fillRect(-200, 900, 1500, 400);
  ctx.fillStyle = '#322A5C'; ctx.fillRect(-200, 900, 1500, 18);
  line('#1B1636', 8, () => { ctx.moveTo(1010, 900); ctx.lineTo(1010, 700); ctx.quadraticCurveTo(1010, 680, 990, 680); });
  fill('#FFE3A0', () => ctx.ellipse(986, 690, 16, 9, 0, 0, 7), 0);
  glow(986, 700, 180, 'rgba(255,220,150,.35)');
  if (mode === 'fail') {
    fill('#3B3570', () => ctx.ellipse(800, 978, 120, 26, 0, 0, 7), 0);
    fill('rgba(255,241,201,.5)', () => crescentPath(760, 978, 16, 8, -4, 13), 0);
  }
  // дом Лёвы
  fill(C.wall, () => ctx.rect(-200, 40, 740, 1300), 1.5);
  const Rb = rng(14);
  line('rgba(255,255,255,.06)', 3, () => { for (let i = 0; i < 60; i++) { const x = -200 + Rb() * 720, y = 60 + Rb() * 1000; ctx.moveTo(x, y); ctx.lineTo(x + 38, y); } });
  fill(C.wallDark, () => ctx.rect(-200, 22, 760, 36), 1);
  fill(C.wallDark, () => { ctx.rect(360, -40, 60, 70); }, .8);
  drawVines(26, 40, 1100, 8);
}
function drawLevaWindow(t, mode, pose) {
  const mood = pose.expr;
  drawWindow(110, 180, 340, 360, (w, h) => {
    ctx.fillStyle = mode === 'fly' ? '#3A2F6E' : '#2A2452'; ctx.fillRect(0, 0, w, h);
    glow(40, 200, 240, mode === 'fly' ? 'rgba(255,210,130,.6)' : 'rgba(255,200,120,.35)');
    if (mode === 'fly') glow(170, 260, 260, 'rgba(201,182,255,.35)');
    ctx.save(); ctx.translate(270, 70); ctx.rotate(.08); drawMoonSheet(60, 76, 8, .6); ctx.restore();
    drawBust({ x: 170, y: 250 + (pose.dy || 0), s: .6, style: 'messy', shirt: C.hoodie, kind: 'hoodie', phones: 'neck',
      expr: mood, lx: pose.lx || 0, ly: pose.ly || 0, headRot: pose.hr || 0, blink: pose.blink || 0, breath: pose.breath || 0 });
  }, t, { curtain: '#4B4A8A' });
  // руки на подоконнике
  drawArm(160, 574, 238, 566, C.hoodie, 46, true);
  if (!pose.throwArm) drawArm(400, 574, 322, 566, C.hoodie, 46, true);
  else drawArm(360, 470, pose.throwArm[0], pose.throwArm[1], C.hoodie, 46, true);
}

function sceneExteriorFail(t) {
  drawExterior(t, 'fail');
  const thr = prog(t, 21.0, 21.35);
  const arm = t < 21.6 ? [lerp(380, 440, thr), lerp(470, 390, thr)] : null;
  let pose = { expr: 'smile', lx: 5, ly: -3 };
  if (t > 22.3) pose = { expr: 'worried', lx: 6, ly: 4 };
  if (t > 23.15) pose = { expr: 'sad', ly: 7, dy: 8, hr: -.06, blink: t > 23.6 && t < 23.8 ? 1 : 0, breath: Math.sin((t - 23.15) * 3) * 6 };
  pose.throwArm = arm;
  drawLevaWindow(t, 'fail', pose);
  const pts = [[440, 390], [560, 320], [700, 290], [760, 330], [770, 470], [790, 700], [800, 968]];
  const p = prog(t, 21.3, 23.1);
  if (t < 21.3) drawPlane(arm[0], arm[1] - 10, .9, -.4);
  else if (p < 1) {
    const q = p < .45 ? p / .45 * .5 : .5 + easeIn((p - .45) / .55) * .5;
    const a = spline(pts, q), b = spline(pts, Math.min(1, q + .01));
    drawPlane(a[0], a[1], .9, Math.atan2(b[1] - a[1], b[0] - a[0]) + Math.sin(t * 14) * .1 * (q > .5 ? 1 : 0));
  } else {
    drawPlane(800, 972, .9, .35, .8);
    const sp = prog(t, 23.1, 23.9);
    if (sp < 1) {
      for (let i = 0; i < 7; i++) {
        const a = -Math.PI * (.15 + i * .1), d = sp * 90;
        fill('rgba(170,190,255,.8)', () => circle(800 + Math.cos(a) * d, 960 + Math.sin(a) * d * 1.2 + sp * sp * 80, 6 * (1 - sp)), 0);
      }
    }
    for (let k = 0; k < 2; k++) {
      const rp = prog(t, 23.1 + k * .2, 24.0);
      if (rp > 0 && rp < 1) line(`rgba(200,210,255,${.7 * (1 - rp)})`, 3, () => ctx.ellipse(800, 978, 30 + rp * 90, 6 + rp * 20, 0, 0, 7));
    }
  }
}

// ---------- сцена 4: телефон на столе ----------
function phoneBody(w, h, lit) {
  fill('#16151F', () => ctx.roundRect(-w / 2, -h / 2, w, h, w * .15), 1.4);
  ctx.save(); ctx.beginPath(); ctx.roundRect(-w / 2 + 12, -h / 2 + 12, w - 24, h - 24, w * .12); ctx.clip();
  ctx.fillStyle = '#0B0A12'; ctx.fillRect(-w / 2, -h / 2, w, h);
  if (lit > 0) {
    ctx.globalAlpha = lit;
    const g = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
    g.addColorStop(0, '#2A2060'); g.addColorStop(1, '#0C0B18');
    ctx.fillStyle = g; ctx.fillRect(-w / 2, -h / 2, w, h);
    txt('02:14', 0, -h / 2 + 140, `900 ${w * .26}px Nunito`, '#fff', 'center');
    txt('четверг, 25 сентября', 0, -h / 2 + 180, `700 ${w * .06}px Nunito`, 'rgba(255,255,255,.7)', 'center');
  }
  ctx.restore();
}
function notifCard(x, y, w, a, title, body) {
  ctx.save(); ctx.globalAlpha *= a;
  fill('rgba(34,30,56,.94)', () => ctx.roundRect(x, y, w, 110, 24), .8);
  if (logo.complete) { ctx.save(); ctx.beginPath(); circle(x + 44, y + 40, 24); ctx.fillStyle = '#fff'; ctx.fill(); ctx.drawImage(logo, x + 22, y + 18, 44, 44); ctx.restore(); }
  txt('NoctGram', x + 80, y + 40, '900 24px Nunito', '#fff');
  txt('сейчас', x + w - 20, y + 40, '700 18px Nunito', 'rgba(255,255,255,.55)', 'right');
  txt(title, x + 80, y + 70, '800 21px Nunito', '#fff');
  if (body) txt(body, x + 80, y + 96, '700 19px Nunito', 'rgba(255,255,255,.7)');
  ctx.restore();
}
function scenePhoneDesk(t) {
  const [cx, cy, sc] = kf(t, [[24.0, 540, 540, 1], [25.4, 540, 540, 1], [26.6, 610, 470, 1.55]]);
  cam(cx, cy, sc, () => {
    drawDesk(.25);
    ctx.save(); ctx.translate(250, 620); ctx.rotate(.16); drawMoonSheet(300, 380, 9); ctx.restore();
    line('#3B3552', 16, () => ctx.arc(860, 900, 120, Math.PI * 1.1, Math.PI * 1.9));
    fill('#3B3552', () => { ctx.ellipse(752, 930, 44, 56, .3, 0, 7); ctx.ellipse(968, 930, 44, 56, -.3, 0, 7); }, 1);
    const buzz = pulse(t, 24.5, 24.8) + pulse(t, 25.1, 25.4) + pulse(t, 25.7, 26.0);
    const lit = ease(prog(t, 24.55, 24.8));
    glow(610, 520, 620, 'rgba(175,154,221,.55)', lit);
    ctx.save(); ctx.translate(610 + buzz * Math.sin(t * 95) * 5, 500); ctx.rotate(-.1 + buzz * Math.sin(t * 70) * .015);
    phoneBody(330, 660, lit);
    notifCard(-150, -80, 300, ease(prog(t, 24.75, 25.05)), 'Ночью тоже кто-то рядом', 'Загляни — тут не спят');
    ctx.restore();
    if (buzz) {
      line('rgba(255,255,255,.7)', 4, () => {
        for (const s of [-1, 1]) for (let k = 0; k < 2; k++) { const rx = 610 + s * (200 + k * 26); ctx.moveTo(rx, 440); ctx.quadraticCurveTo(rx + s * 14, 500, rx, 560); }
      });
    }
  });
}

// ---------- сцена 4б / 6б: лицо в свете экрана ----------
function sceneFace(t, variant) {
  const t0 = variant === 'first' ? 26.8 : 41.0;
  const lt = t - t0;
  ctx.fillStyle = '#1D1838'; ctx.fillRect(0, 0, W, H);
  fill('#2A2452', () => ctx.rect(640, 60, 380, 360), 0);
  fill(C.frame, () => { ctx.rect(630, 50, 400, 14); ctx.rect(630, 416, 400, 14); ctx.rect(630, 50, 14, 380); ctx.rect(1016, 50, 14, 380); }, .6);
  ctx.save(); ctx.beginPath(); ctx.rect(644, 64, 372, 352); ctx.clip();
  const g = ctx.createLinearGradient(0, 64, 0, 416); g.addColorStop(0, C.skyTop); g.addColorStop(1, C.skyBot);
  ctx.fillStyle = g; ctx.fillRect(644, 64, 372, 352);
  drawStars(t, 650, 70, 1010, 410, 303, 30);
  drawMoon(900, 170, 50, t);
  ctx.restore();
  ctx.save(); ctx.translate(190, 200); ctx.rotate(-.1); drawMoonSheet(150, 190, 10); ctx.restore();

  let expr = 'sad', ly = 7, dy = 6, blush = .45, hr = 0;
  if (variant === 'first') {
    if (lt > .5) { expr = 'surprise'; ly = 2; dy = -8 * Math.exp(-(lt - .5) * 5); }
    if (lt > 1.5) { expr = 'smile'; ly = 6; dy = 0; blush = .6; }
  } else {
    expr = 'surprise'; ly = 3; dy = -6 * Math.exp(-lt * 5);
    if (lt > .55) { expr = 'happy'; blush = lerp(.6, .95, prog(lt, .55, 1.2)); hr = Math.sin(lt * 3) * .05; dy = Math.abs(Math.sin(lt * 5)) * -6; }
  }
  const breath = (Math.sin(t * 1.4) * .5 + .5) * 8;
  drawBust({ x: 540, y: 520, s: 1.35, style: 'messy', shirt: C.hoodie, kind: 'hoodie', phones: 'neck',
    expr, ly, lx: 0, headDy: dy, headRot: hr, blushA: blush, breath, blink: expr !== 'happy' ? blinkAt(t, 6) : 0 });
  // телефон в руках, светит в лицо
  ctx.save(); ctx.translate(540, 1000); ctx.rotate(.04);
  fill('#16151F', () => ctx.roundRect(-120, -150, 240, 420, 34), 1.4);
  fill('#2A2838', () => ctx.roundRect(-92, -126, 64, 64, 18), 0);
  ctx.restore();
  sleeve(160, 1240, 400, 1010, 120); sleeve(920, 1240, 680, 1010, 120);
  fill(C.skin, () => { wellPath(420, 960, 52, 46, 111, .06); wellPath(660, 960, 52, 46, 112, .06); }, 1.2);
  ctx.save(); ctx.globalCompositeOperation = 'screen';
  const lg = ctx.createRadialGradient(540, 860, 40, 540, 700, 700);
  lg.addColorStop(0, 'rgba(175,154,221,.75)'); lg.addColorStop(.5, 'rgba(175,154,221,.28)'); lg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = lg; ctx.fillRect(0, 0, W, H); ctx.restore();
  if (variant === 'happy') {
    const R = rng(55);
    for (let i = 0; i < 9; i++) {
      const st = .5 + R() * 2, x0 = 380 + R() * 320, sp = 160 + R() * 120;
      const p = prog(lt, st, st + 1.6);
      if (p > 0 && p < 1) {
        const x = x0 + Math.sin(p * 8 + i) * 24, y = 860 - p * sp * 3;
        ctx.save(); ctx.globalAlpha = 1 - p;
        fill(i % 2 ? '#F07A9A' : C.lilacGlow, () => heartPath(x, y, 34 + (i % 3) * 8), .5); ctx.restore();
      }
    }
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * Math.PI * 2 + lt, tw = .5 + .5 * Math.sin(lt * 6 + i * 2);
      fill(`rgba(255,233,168,${tw})`, () => star4(540 + Math.cos(a) * 280, 380 + Math.sin(a) * 200, 16 + tw * 10), 0);
    }
  }
  if (variant === 'first') {
    const f = ease(prog(t, 29.25, 30.0));
    if (f > 0) fill(C.lilacGlow, () => circle(540, 900, f * 1500), 0);
  }
}

// ---------- сцена 5-6: приложение NoctGram ----------
const PH = { x: 250, y: 40, w: 580, h: 1180 };
const SC = { x: PH.x + 16, y: PH.y + 16, w: PH.w - 32 };
function thumb(tx, ty, press) {
  ctx.save(); ctx.translate(tx, ty); ctx.rotate(-.55); ctx.scale(.85 - press * .05, .85 - press * .05);
  sleeve(40, 460, 30, 330, 150);
  fill(C.skin, () => wellPath(20, 300, 110, 100, 121, .05), 1.4);
  fill(C.skin, () => ctx.roundRect(-38, 0, 76, 250, 38), 1.4 - press);
  fill('#F7DCC8', () => ctx.roundRect(-24, 8, 48, 56, 20), 0);
  ctx.restore();
}
function uiCompose(t) {
  const w = SC.w;
  txt('‹', 30, 116, '800 44px Nunito', '#fff');
  txt('Новая публикация', 70, 110, '900 30px Nunito', '#fff');
  ctx.fillStyle = 'rgba(255,255,255,.08)'; ctx.fillRect(0, 140, w, 2);
  avatar(60, 200, 30, 'leva');
  txt('лёва', 104, 194, '800 25px Nunito', '#fff');
  txt('@leva.moon', 104, 222, '700 20px Nunito', '#999');
  const cap = 'нарисовал луну, пока не спалось';
  const n = Math.floor(cap.length * prog(t, 30.35, 31.6));
  txt(cap.slice(0, n), 30, 290, '700 26px Nunito', '#fff');
  if (Math.floor(t * 3) % 2 === 0 || t < 31.6) {
    ctx.save(); ctx.font = '700 26px Nunito'; const cw = ctx.measureText(cap.slice(0, n)).width; ctx.restore();
    ctx.fillStyle = C.lilac; ctx.fillRect(32 + cw, 266, 3, 30);
  }
  photoOfDrawing(30, 320, w - 60, 470);
  const pressed = pulse(t, 33.05, 33.3);
  const flash = prog(t, 33.2, 33.45);
  fill(pressed ? '#D8D8D8' : '#fff', () => ctx.roundRect(30, 830, w - 60, 80, 40), 0);
  txt('Опубликовать', w / 2, 881, '900 28px Nunito', '#000', 'center');
  if (flash > 0 && flash < 1) { ctx.save(); ctx.globalAlpha = 1 - flash; fill('#fff', () => ctx.roundRect(30 - flash * 20, 830 - flash * 20, w - 60 + flash * 40, 80 + flash * 40, 50), 0); ctx.restore(); }
  txt('Сохранить черновик', w / 2, 960, '700 20px Nunito', '#777', 'center');
}
function uiFeed(t) {
  const w = SC.w;
  if (logo.complete) { ctx.save(); ctx.beginPath(); circle(50, 100, 24); ctx.fillStyle = '#fff'; ctx.fill(); ctx.drawImage(logo, 26, 76, 48, 48); ctx.restore(); }
  txt('NoctGram', 86, 112, '900 32px Nunito', '#fff');
  line('#fff', 3, () => { circle(w - 94, 98, 13); ctx.moveTo(w - 85, 107); ctx.lineTo(w - 76, 116); });
  line('#fff', 3, () => { ctx.moveTo(w - 50, 110); ctx.quadraticCurveTo(w - 50, 84, w - 38, 84); ctx.quadraticCurveTo(w - 26, 84, w - 26, 110); ctx.closePath(); });
  const card = { x: 14, y: 150, w: w - 28, h: 860 };
  fill('#0C0C0C', () => ctx.roundRect(card.x, card.y, card.w, card.h, 28), 0);
  line('rgba(255,255,255,.08)', 2, () => ctx.roundRect(card.x, card.y, card.w, card.h, 28));
  avatar(60, 206, 28, 'leva');
  txt('лёва', 100, 200, '800 24px Nunito', '#fff');
  txt('@leva.moon · только что', 100, 228, '700 19px Nunito', '#999');
  txt('⋯', w - 56, 212, '900 34px Nunito', '#fff', 'center');
  txt('нарисовал луну, пока не спалось', 34, 284, '700 24px Nunito', '#fff');
  photoOfDrawing(30, 304, w - 60, 400);
  const likes = t > 39.7 ? 3 : t > 39.1 ? 2 : t > 38.25 ? 1 : 0;
  const comments = t > 39.8 ? 2 : t > 38.4 ? 1 : 0;
  const popT = [38.25, 39.1, 39.7].reduce((a, s) => (t >= s ? s : a), -9);
  const pop = 1 + .4 * Math.sin(prog(t, popT, popT + .3) * Math.PI);
  ctx.save(); ctx.translate(50, 748); ctx.scale(pop, pop); iconHeart(0, 0, 34, likes > 0, likes > 0 ? '#F07A9A' : '#fff'); ctx.restore();
  txt(String(likes), 80, 758, '800 24px Nunito', '#fff');
  iconComment(150, 748, 34); txt(String(comments), 180, 758, '800 24px Nunito', '#fff');
  iconStar(250, 748, 34); txt('0', 278, 758, '800 24px Nunito', '#fff');
  const rows = [[38.4, 'mila', 'mila.sova', 'а можно такую луну на обои?'], [39.8, 'tema', 'tema_lofi', 'ты тоже слушаешь это в 2 ночи?']];
  rows.forEach(([st, who, name, text], i) => {
    const a = ease(prog(t, st, st + .35));
    if (a <= 0) return;
    ctx.save(); ctx.globalAlpha = a; ctx.translate((1 - a) * 30, 0);
    const y = 808 + i * 84;
    avatar(58, y + 26, 24, who);
    txt(name, 94, y + 18, '800 20px Nunito', '#fff');
    txt(text, 94, y + 46, '700 21px Nunito', '#ddd');
    ctx.restore();
  });
  // меню публикации
  const mo = ease(prog(t, 36.4, 36.6)) * (1 - ease(prog(t, 38.0, 38.15)));
  if (mo > 0) {
    ctx.save(); ctx.globalAlpha = mo; ctx.translate(w - 250, 230); ctx.scale(lerp(.9, 1, mo), lerp(.9, 1, mo));
    fill('#161616', () => ctx.roundRect(0, 0, 230, 190, 22), 1.5);
    line('rgba(255,255,255,.14)', 2, () => ctx.roundRect(0, 0, 230, 190, 22));
    txt('Закрепить', 24, 48, '800 22px Nunito', '#fff');
    txt('Ссылка', 24, 106, '800 22px Nunito', '#fff');
    ctx.fillStyle = 'rgba(255,255,255,.08)'; ctx.fillRect(0, 128, 230, 2);
    txt('Удалить', 24, 166, '800 22px Nunito', '#EF4444');
    ctx.restore();
  }
  // тост «Опубликовано»
  const ta = prog(t, 33.7, 33.95) * (1 - prog(t, 34.5, 34.8));
  if (ta > 0) {
    ctx.save(); ctx.globalAlpha = ta;
    fill('#fff', () => ctx.roundRect(w / 2 - 120, 960, 240, 56, 28), 0);
    txt('Опубликовано', w / 2, 996, '900 22px Nunito', '#000', 'center'); ctx.restore();
  }
  // уведомления сверху
  const banners = [[38.0, 39.3, 'mila', 'mila.sova', 'а можно такую луну на обои?'], [39.45, 40.6, 'tema', 'tema_lofi', 'ты тоже слушаешь это в 2 ночи?']];
  for (const [b0, b1, who, name, text] of banners) {
    const inP = backOut(prog(t, b0, b0 + .3)), outP = ease(prog(t, b1, b1 + .25));
    if (t < b0 || outP >= 1) continue;
    const y = lerp(-150, 66, inP) - outP * 230;
    fill('#161616', () => ctx.roundRect(14, y, w - 28, 108, 28), 1.5);
    line('rgba(175,154,221,.7)', 2, () => ctx.roundRect(14, y, w - 28, 108, 28));
    avatar(66, y + 54, 30, who);
    txt(name + ' · новый комментарий', 110, y + 44, '800 20px Nunito', '#fff');
    txt(text, 110, y + 76, '700 21px Nunito', '#ddd');
  }
}
function scenePhoneUI(t) {
  ctx.fillStyle = '#17132E'; ctx.fillRect(0, 0, W, H);
  glow(540, 520, 700, 'rgba(175,154,221,.35)');
  const R = rng(9);
  for (let i = 0; i < 12; i++) glow(R() * W, R() * H, 60 + R() * 60, 'rgba(255,220,160,.08)');
  sleeve(-60, 1300, 190, 900, 150);
  fill(C.skin, () => wellPath(250, 860, 70, 110, 131, .05), 1.2);
  fill('#16151F', () => ctx.roundRect(PH.x, PH.y, PH.w, PH.h, 70), 2);
  line('#2E2B40', 4, () => ctx.roundRect(PH.x + 2, PH.y + 2, PH.w - 4, PH.h - 4, 68));
  ctx.save(); ctx.beginPath(); ctx.roundRect(SC.x, SC.y, SC.w, PH.h - 32, 56); ctx.clip();
  ctx.translate(SC.x, SC.y);
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, SC.w, PH.h);
  const clock = t < 34.3 ? '02:14' : t < 34.8 ? '02:15' : t < 35.3 ? '02:17' : t < 35.8 ? '02:20' : '02:23';
  const slide = ease(prog(t, 33.4, 33.75));
  if (slide < 1) { ctx.save(); ctx.translate(-slide * SC.w, 0); uiCompose(t); ctx.restore(); }
  if (slide > 0) { ctx.save(); ctx.translate((1 - slide) * SC.w, 0); uiFeed(t); ctx.restore(); }
  statusBar(clock, SC.w);
  fill('#000', () => ctx.roundRect(SC.w / 2 - 70, 14, 140, 38, 19), 0);
  ctx.restore();
  // пальцы левой руки на краю телефона
  fill(C.skin, () => { for (let i = 0; i < 3; i++) wellPath(PH.x + 6, 700 + i * 70, 22, 30, 140 + i, .05); }, .8);
  // большой палец правой руки
  const rest = [760, 1010];
  const tp = kf(t, [
    [30.0, ...rest], [31.7, ...rest], [32.15, 560, 900], [32.5, 590, 960], [32.8, 575, 915], [33.05, 560, 905],
    [33.35, 600, 980], [33.8, ...rest], [36.0, ...rest], [36.3, SC.x + SC.w - 56, 262], [36.6, SC.x + SC.w - 40, 330],
    [37.2, SC.x + SC.w - 50, 400], [37.9, SC.x + SC.w - 58, 462], [38.0, SC.x + SC.w - 58, 462], [38.5, ...rest],
  ]);
  const press = pulse(t, 33.05, 33.3) + pulse(t, 36.3, 36.45);
  thumb(tp[0], tp[1], press);
  const f = 1 - ease(prog(t, 30.0, 30.4));
  if (f > 0) { ctx.save(); ctx.globalAlpha = f; ctx.fillStyle = C.lilacGlow; ctx.fillRect(0, 0, W, H); ctx.restore(); }
}

// ---------- сцена 7: звонок втроём ----------
function noteShape(x, y, s) {
  ctx.moveTo(x + s * .35, y); ctx.ellipse(x, y, s * .36, s * .27, -.4, 0, 7);
  ctx.rect(x + s * .26, y - s * 1.1, s * .1, s * 1.1);
  ctx.moveTo(x + s * .36, y - s * 1.1); ctx.quadraticCurveTo(x + s * .8, y - s * .8, x + s * .6, y - s * .45);
  ctx.quadraticCurveTo(x + s * .66, y - s * .75, x + s * .36, y - s * .82); ctx.closePath();
}
function tile(x, y, w, h, bg, fn) {
  ctx.save(); ctx.beginPath(); ctx.roundRect(x, y, w, h, 30); ctx.clip();
  ctx.fillStyle = bg; ctx.fillRect(x, y, w, h); fn(); ctx.restore();
}
function sceneCall(t) {
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  glow(540, 540, 800, 'rgba(175,154,221,.18)');
  fill('#3ECF8E', () => circle(52, 58, 8), 0);
  txt('Звонок · 3 участника', 72, 68, '900 30px Nunito', '#fff');
  const sec = 192 + Math.floor(t - 44);
  txt(`0${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`, 1040, 68, '800 26px Nunito', '#999', 'right');
  const beat = k => Math.abs(Math.sin(Math.PI * (t - 38) / .75 + k));
  const react = t > 46.5;
  tile(40, 100, 490, 440, PEOPLE.mila.bg, () => {
    line('#6B3A2A', 2, () => { ctx.moveTo(40, 150); ctx.quadraticCurveTo(285, 200, 530, 150); });
    for (let i = 0; i < 8; i++) fill(['#FFD36A', '#fff', '#9D84D6'][i % 3], () => circle(70 + i * 60, 156 + Math.sin(i / 7 * Math.PI) * 24, 8), 0);
    drawBust({ ...PEOPLE.mila, x: 285, y: 330 - beat(0) * 10, s: .64, phones: 'ears', headRot: Math.sin(t * 2.7) * .08,
      expr: react ? (t < 46.9 ? 'surprise' : 'happy') : 'smile', blink: blinkAt(t, 7) });
  });
  tile(550, 100, 490, 440, PEOPLE.tema.bg, () => {
    fill('#E9744F', () => ctx.roundRect(880, 150, 110, 150, 6), .6);
    fill('#FFD36A', () => circle(935, 210, 26), 0);
    drawBust({ ...PEOPLE.tema, x: 795, y: 330 - beat(.8) * 10, s: .64, phones: 'ears', headRot: -Math.sin(t * 2.7) * .08,
      expr: react ? (t < 47.0 ? 'surprise' : 'happy') : 'happy', blink: blinkAt(t, 8) });
  });
  tile(40, 560, 1000, 340, PEOPLE.leva.bg, () => {
    glow(160, 700, 300, 'rgba(255,200,120,.35)');
    drawStars(t, 60, 580, 1020, 700, 404, 20);
    drawBust({ ...PEOPLE.leva, x: 470, y: 740 - beat(1.6) * 10, s: .64, phones: 'ears', headRot: Math.sin(t * 2.7 + 1) * .08,
      expr: 'happy', breath: 0 });
    const up = backOut(prog(t, 46.0, 46.45));
    if (up > 0) {
      ctx.save(); ctx.translate(700, lerp(1080, 740, up)); ctx.rotate(.1); drawMoonSheet(190, 240, 12, 1.2); ctx.restore();
      drawArm(560, 980, 640, lerp(1100, 820, up), C.hoodie, 46, true);
    }
  });
  const labels = [[60, 520, 'мила'], [570, 520, 'тёма'], [60, 880, 'лёва (вы)']];
  for (const [x, y, s] of labels) {
    ctx.save(); ctx.font = '800 20px Nunito'; const tw = ctx.measureText(s).width; ctx.restore();
    fill('rgba(0,0,0,.45)', () => ctx.roundRect(x, y - 30, tw + 28, 38, 19), 0);
    txt(s, x + 14, y - 4, '800 20px Nunito', '#fff');
  }
  if (react) {
    for (let i = 0; i < 6; i++) {
      const p = prog(t, 46.6 + i * .12, 47.8 + i * .12);
      if (p > 0 && p < 1) {
        const x = (i % 2 ? 795 : 285) + Math.sin(p * 7 + i) * 40, y = 460 - p * 260;
        ctx.save(); ctx.globalAlpha = 1 - p; fill('#F07A9A', () => heartPath(x, y, 40), .4); ctx.restore();
      }
    }
  }
  // музыка
  fill('#161616', () => ctx.roundRect(40, 920, 1000, 130, 32), 0);
  fill(C.lilac, () => ctx.roundRect(60, 940, 90, 90, 18), 0);
  fill(C.moon, () => crescentPath(100, 985, 28, 14, -7, 24), 0);
  txt('Слушаете вместе', 172, 970, '700 20px Nunito', '#999');
  txt('лунный вальс — noct lofi', 172, 1006, '900 28px Nunito', '#fff');
  for (let i = 0; i < 5; i++) {
    const hh = 14 + Math.abs(Math.sin(t * 7 + i * 1.3)) * 40;
    fill(C.lilac, () => ctx.roundRect(900 + i * 22, 1010 - hh, 12, hh, 6), 0);
  }
  ctx.fillStyle = 'rgba(255,255,255,.12)'; ctx.fillRect(172, 1026, 680, 5);
  ctx.fillStyle = C.lilac; ctx.fillRect(172, 1026, 680 * (.3 + (t - 44) * .02), 5);
  for (let i = 0; i < 7; i++) {
    const p = ((t - 44) * .35 + i / 7) % 1;
    ctx.save(); ctx.globalAlpha = Math.sin(p * Math.PI) * .9;
    fill(i % 2 ? C.lilacGlow : '#FFD36A', () => noteShape(80 + i * 140 + Math.sin(p * 6 + i) * 30, 900 - p * 700, 34), .4);
    ctx.restore();
  }
  // тост о канале
  const ta = backOut(prog(t, 47.0, 47.35));
  if (ta > 0) {
    const y = lerp(-120, 120, ta);
    fill('#161616', () => ctx.roundRect(170, y, 740, 90, 45), 1.5);
    line('rgba(175,154,221,.8)', 2, () => ctx.roundRect(170, y, 740, 90, 45));
    fill(C.lilac, () => circle(222, y + 45, 28), 0);
    fill(C.moon, () => crescentPath(218, y + 45, 16, 8, -4, 13), 0);
    txt('Создан канал «ночные рисунки»', 268, y + 55, '900 28px Nunito', '#fff');
  }
}

// ---------- сцена 7б: окна города загораются ----------
const CITY = (() => {
  const R = rng(777), b = [];
  let x = -60;
  while (x < 1140) {
    const w = 130 + R() * 120, h = 280 + R() * 420;
    b.push({ x, w, top: 1080 - h, col: [C.far, C.far2, C.wall][Math.floor(R() * 3)] });
    x += w + 6;
  }
  const wins = [];
  b.forEach((bd, bi) => {
    for (let yy = bd.top + 40; yy < 1040; yy += 64) for (let xx = bd.x + 24; xx < bd.x + bd.w - 34; xx += 46) wins.push({ x: xx, y: yy, bi, r: R() });
  });
  const lit = wins.filter(w => w.r < .16).map((w, i) => ({ ...w, at: 48.4 + (w.r / .16) * 1.9 }));
  // по одному горящему окну в каждой четверти вокруг окна Лёвы (520, 760)
  const friends = [0, 1, 2, 3].map(q => {
    const pick = lit.filter(w => {
      const dx = w.x + 11 - 520, dy = w.y + 15 - 760, d = Math.hypot(dx, dy);
      const ang = (Math.atan2(dy, dx) + Math.PI * 2) % (Math.PI * 2);
      return d > 180 && d < 520 && Math.floor(ang / (Math.PI / 2)) === q;
    }).sort((u, v) => u.at - v.at)[0];
    return pick ? [pick.x + 11, pick.y + 15] : null;
  }).filter(Boolean);
  return { b, wins, lit, friends };
})();
function sceneCityLights(t) {
  const sc = lerp(1.14, 1, ease(prog(t, 48, 52)));
  const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, C.skyTop); g.addColorStop(1, C.skyBot);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  cam(540, 600, sc, () => {
    drawStars(t, -100, -100, 1180, 600, 505, 90, 1.2);
    drawMoon(820, 160, 80, t);
    for (const bd of CITY.b) fill(bd.col, () => ctx.rect(bd.x, bd.top, bd.w, 1200), .8);
    for (const w of CITY.wins) { ctx.fillStyle = C.winDark; ctx.fillRect(w.x, w.y, 22, 30); }
    for (const w of CITY.lit) {
      const a = ease(prog(t, w.at, w.at + .25));
      if (a <= 0) continue;
      glow(w.x + 11, w.y + 15, 70 * a, 'rgba(201,182,255,.5)');
      ctx.save(); ctx.globalAlpha = a; ctx.fillStyle = C.winLilac; ctx.fillRect(w.x, w.y, 22, 30);
      ctx.fillStyle = '#6E5AA8'; ctx.beginPath(); circle(w.x + 11, w.y + 16, 6); ctx.fill(); ctx.fillRect(w.x + 3, w.y + 22, 16, 8); ctx.restore();
    }
    // окно Лёвы
    const LX = 520, LY = 760;
    const la = ease(prog(t, 50.4, 50.8));
    fill(la > 0 ? C.frame : '#4A3F80', () => ctx.rect(LX - 42, LY - 42, 84, 92), .6);
    ctx.fillStyle = la > 0 ? C.winWarm : C.winDark; ctx.fillRect(LX - 36, LY - 36, 72, 80);
    if (la > 0) {
      glow(LX, LY, 260 * la, 'rgba(255,210,120,.6)');
      ctx.save(); ctx.beginPath(); ctx.rect(LX - 36, LY - 36, 72, 80); ctx.clip();
      drawBust({ ...PEOPLE.leva, x: LX, y: LY + 8, s: .2, expr: 'happy', phones: 'neck' }); ctx.restore();
    }
    // созвездие между окнами друзей
    const friends = CITY.friends;
    const lp = prog(t, 50.8, 51.9);
    if (lp > 0) {
      ctx.save(); ctx.setLineDash([6, 12]); ctx.lineDashOffset = -t * 30;
      friends.forEach(([fx, fy], i) => {
        const p = clamp(lp * 1.6 - i * .2);
        if (p <= 0) return;
        line('rgba(201,182,255,.9)', 3, () => { ctx.moveTo(LX, LY); ctx.lineTo(lerp(LX, fx, p), lerp(LY, fy, p)); });
        if (p >= 1) fill(C.star, () => star4(fx, fy, 16), 0);
      });
      ctx.restore();
    }
  });
}

// ---------- сцена 8: финал ----------
const FLEET = (() => {
  const cx = 540, cy = -560, r = 250;
  const starts = [
    [54.6, [[440, 390], [600, 250], [760, 60], [700, -200]]],
    [55.0, [[760, 600], [860, 380], [900, 100], [820, -200]]],
    [55.3, [[1040, 680], [1060, 420], [980, 120], [900, -250]]],
    [55.5, [[1200, 760], [1100, 400], [1000, 100], [860, -300]]],
    [55.7, [[-120, 200], [120, 60], [260, -150], [320, -350]]],
    [55.9, [[1150, 200], [1020, 60], [900, -150], [760, -380]]],
    [56.1, [[-150, -100], [60, -200], [180, -350], [300, -480]]],
    [56.3, [[1200, -300], [1060, -350], [900, -450], [800, -560]]],
  ];
  return starts.map(([t0, pts], i) => {
    const a = .75 + i * (3.85 / 7);
    const slot = [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
    return { t0, t1: 57.3 + i * .04, pts: [...pts, slot], a };
  });
})();
function sceneFinale(t) {
  const camY = kf(t, [[54.2, 0], [55.4, 0], [57.2, -1000]])[0];
  ctx.save(); ctx.translate(0, -camY);
  drawExterior(t, 'fly');
  let pose = { expr: 'smile', lx: 5, ly: -3 };
  const thr = prog(t, 54.25, 54.55);
  if (t > 54.6) pose = { expr: 'happy', lx: 5, ly: -5, hr: .05 };
  pose.throwArm = t < 54.9 ? [lerp(380, 440, thr), lerp(470, 390, thr)] : null;
  drawLevaWindow(t, 'fly', pose);
  if (t < 54.6) drawPlane(pose.throwArm[0], pose.throwArm[1] - 10, .9, -.4);
  // самолётики собираются в полумесяц
  const moonIn = ease(prog(t, 57.7, 58.5));
  FLEET.forEach((pl, i) => {
    if (t < pl.t0) return;
    let x, y, rot;
    if (t < pl.t1) {
      const q = easeOut(prog(t, pl.t0, pl.t1)) * .999;
      [x, y] = spline(pl.pts, q);
      const b = spline(pl.pts, Math.min(1, q + .01));
      rot = Math.atan2(b[1] - y, b[0] - x);
    } else {
      const a = pl.a + (t - pl.t1) * .35;
      x = 540 + Math.cos(a) * 250; y = -560 + Math.sin(a) * 250; rot = a + Math.PI / 2;
    }
    drawPlane(x, y, 1, rot, 1 - moonIn);
    if (t < pl.t1) {
      ctx.save(); ctx.globalAlpha = .35 * (1 - moonIn); ctx.setLineDash([4, 10]);
      line('#fff', 2, () => { const b = spline(pl.pts, Math.max(0, easeOut(prog(t, pl.t0, pl.t1)) - .12)); ctx.moveTo(b[0], b[1]); ctx.lineTo(x, y); });
      ctx.restore();
    }
  });
  if (moonIn > 0) {
    ctx.save(); ctx.globalAlpha = moonIn;
    const r = 210 * lerp(.85, 1, backOut(moonIn));
    drawMoon(540, -580, r, t);
    ctx.restore();
    const fl = Math.sin(prog(t, 57.7, 58.6) * Math.PI);
    glow(540, -580, 520, `rgba(255,240,200,${.45 * fl})`);
  }
  ctx.restore();
  // титр и логотип
  const tp = prog(t, 58.6, 59.8);
  if (tp > 0) {
    ctx.save(); shadow(0); ctx.font = '700 108px Caveat';
    const s = 'Ночью не одиноко.', tw = ctx.measureText(s).width, x = 540 - tw / 2;
    ctx.beginPath(); ctx.rect(x - 10, 660, tw * ease(tp) + 20, 180); ctx.clip();
    ctx.fillStyle = 'rgba(10,8,30,.35)'; ctx.fillText(s, x + 3, 793);
    ctx.fillStyle = C.moon; ctx.fillText(s, x, 790);
    ctx.restore();
  }
  const la = backOut(prog(t, 59.9, 60.35));
  if (la > 0) {
    ctx.save(); ctx.translate(540, 920); ctx.scale(la, la);
    ctx.font = '900 60px Nunito'; const tw = ctx.measureText('NoctGram').width, total = 84 + 20 + tw;
    const x0 = -total / 2;
    fill('#fff', () => circle(x0 + 42, 0, 42), 1);
    if (logo.complete) ctx.drawImage(logo, x0 + 2, -40, 80, 80);
    txt('NoctGram', x0 + 104, 21, '900 60px Nunito', '#fff');
    ctx.restore();
  }
}

// ---------- монтаж ----------
const NB1 = [16.2, 17.5, 17.6, 18.6, 19.4, 19.8, 20.6, 20.65, 21.0];
const NB2 = [52.1, 52.8, 52.85, 53.35, 53.75, 53.85, 54.1, 54.1, 54.2];
const SCENES = [
  [0, 6.4, sceneCorridor],
  [6.4, 8.0, sceneFloor],
  [8.0, 16.0, sceneFacade],
  [16.0, 21.0, t => sceneNotebook(t, NB1)],
  [21.0, 24.0, sceneExteriorFail],
  [24.0, 26.8, scenePhoneDesk],
  [26.8, 30.0, t => sceneFace(t, 'first')],
  [30.0, 41.0, scenePhoneUI],
  [41.0, 44.0, t => sceneFace(t, 'happy')],
  [44.0, 48.0, sceneCall],
  [48.0, 52.0, sceneCityLights],
  [52.0, 54.2, t => sceneNotebook(t, NB2)],
  [54.2, 62.1, sceneFinale],
];

// Бумажная фактура поверх кадра.
const grain = document.createElement('canvas');
grain.width = grain.height = 512;
{
  const g = grain.getContext('2d'), img = g.createImageData(512, 512), R = rng(7);
  for (let i = 0; i < img.data.length; i += 4) { const v = 128 + (R() - .5) * 70; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255; }
  g.putImageData(img, 0, 0);
  g.globalAlpha = .3;
  for (let i = 0; i < 700; i++) {
    g.strokeStyle = R() < .5 ? '#fff' : '#000'; g.lineWidth = .7;
    const x = R() * 512, y = R() * 512, a = R() * 6.28, l = 4 + R() * 16;
    g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + Math.cos(a + 1) * l * .5, y + Math.sin(a + 1) * l * .5, x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
  }
}
let grainPattern = null;
function postFX(t) {
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); shadow(0);
  if (!grainPattern) grainPattern = ctx.createPattern(grain, 'repeat');
  const f = Math.floor(t * 8), R = rng(f + 1);
  ctx.translate(-R() * 512, -R() * 512); ctx.scale(1.4, 1.4);
  ctx.globalCompositeOperation = 'overlay'; ctx.globalAlpha = .3;
  ctx.fillStyle = grainPattern; ctx.fillRect(0, 0, W + 800, H + 800);
  ctx.restore();
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
  const v = ctx.createRadialGradient(W / 2, H / 2, W * .38, W / 2, H / 2, W * .78);
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(10,5,30,.38)');
  ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
  const fade = Math.max(1 - prog(t, 0, .5), prog(t, 61.3, 62));
  if (fade > 0) { ctx.globalAlpha = fade; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); }
  ctx.restore();
}

function renderFrame(t) {
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; shadow(0);
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  const sc = SCENES.find(s => t >= s[0] && t < s[1]) || SCENES[SCENES.length - 1];
  ctx.save(); sc[2](t); ctx.restore();
  postFX(t);
}

window.cartoon = { W, H, FPS, DURATION, renderFrame };
window.renderToDataURL = (t, type = 'image/jpeg', q = .95) => { renderFrame(t); return cv.toDataURL(type, q); };
window.cartoonReady = Promise.all([
  document.fonts.load('700 40px Caveat', 'кто-нибудь abc'),
  document.fonts.load('900 40px Nunito', 'Новая abc'),
  document.fonts.load('700 40px Nunito', 'Новая abc'),
  new Promise(r => { if (logo.complete) r(); else { logo.onload = r; logo.onerror = r; } }),
]).then(() => document.fonts.ready);

// Просмотр в браузере: открыть index.html; ?t=12 — начать с 12-й секунды, пробел — пауза.
if (!new URLSearchParams(location.search).has('render')) {
  window.cartoonReady.then(() => {
    let start = performance.now() - (parseFloat(new URLSearchParams(location.search).get('t')) || 0) * 1000, paused = false, pt = 0;
    addEventListener('keydown', e => {
      if (e.code === 'Space') { paused = !paused; if (!paused) start = performance.now() - pt * 1000; }
    });
    const loop = now => {
      if (!paused) { pt = ((now - start) / 1000) % DURATION; renderFrame(pt); }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });
}
