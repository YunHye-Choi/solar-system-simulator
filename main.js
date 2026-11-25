// Solar system travel simulator: ephemeris, player movement, rendering loop, HUD and minimap.
(() => {
  'use strict';
  const { sin, cos, sqrt, abs, min, max, floor, ceil, PI, atan2, asin, exp, pow, log, tan } = Math;
  const D2R = PI / 180;
  const AU = 1.495978707e11;
  const C_LIGHT = 299792458;
  const LIMIT = 120 * AU; // heliopause: the edge of the playable volume
  const EYE = 1.7;
  const WALK = 1.4;
  const TAN_F = tan(30 * D2R);
  const B = window.BODIES;
  const NB = B.length;
  const $ = (id) => document.getElementById(id);

  // ------------------------------------------------------------ vectors
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const len = (a) => sqrt(dot(a, a));
  const norm = (a) => mul(a, 1 / (len(a) || 1));
  const rot = (v, k, a) => add(add(mul(v, cos(a)), mul(cross(k, v), sin(a))), mul(k, dot(k, v) * (1 - cos(a))));
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const mix = (a, b, t) => a + (b - a) * t;
  const smoothstep = (a, b, x) => {
    const t = clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  };
  const perp = (n) => norm(cross(n, abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));

  // ------------------------------------------------------------ frames
  const OBL = 23.4392911 * D2R;
  const eqToWorld = ([x, y, z]) => [x, -y * sin(OBL) + z * cos(OBL), -(y * cos(OBL) + z * sin(OBL))];
  const raDec = (ra, dec) => eqToWorld([cos(dec * D2R) * cos(ra * D2R), cos(dec * D2R) * sin(ra * D2R), sin(dec * D2R)]);
  const llToN = (lat, lon) => [cos(lat * D2R) * cos(lon * D2R), sin(lat * D2R), -cos(lat * D2R) * sin(lon * D2R)];
  const nToLL = (n) => [asin(clamp(n[1], -1, 1)) / D2R, atan2(-n[2], n[0]) / D2R];
  const toW = (i, v) => add(add(mul(B[i].M[0], v[0]), mul(B[i].M[1], v[1])), mul(B[i].M[2], v[2]));
  const toB = (i, v) => [dot(B[i].M[0], v), dot(B[i].M[1], v), dot(B[i].M[2], v)];

  function kepler(el, T) {
    const [a, e, I, L0, wb, Om, Lr] = el;
    const M = ((((L0 + Lr * T - wb) % 360) + 540) % 360 - 180) * D2R;
    let E = M + e * sin(M);
    for (let k = 0; k < 6; k++) E -= (E - e * sin(E) - M) / (1 - e * cos(E));
    const xp = a * (cos(E) - e);
    const yp = a * sqrt(1 - e * e) * sin(E);
    const w = (wb - Om) * D2R;
    const O = Om * D2R;
    const i = I * D2R;
    const xe = (cos(w) * cos(O) - sin(w) * sin(O) * cos(i)) * xp + (-sin(w) * cos(O) - cos(w) * sin(O) * cos(i)) * yp;
    const ye = (cos(w) * sin(O) + sin(w) * cos(O) * cos(i)) * xp + (-sin(w) * sin(O) + cos(w) * cos(O) * cos(i)) * yp;
    const ze = sin(w) * sin(i) * xp + cos(w) * sin(i) * yp;
    return [xe * AU, ze * AU, -ye * AU];
  }

  function updateBodies(tMs) {
    const d = tMs / 86400000 - 10957.5; // days since J2000
    const T = d / 36525;
    for (let i = 0; i < NB; i++) {
      const b = B[i];
      if (b.el) b.pos = kepler(b.el, T);
    }
    B[0].pos = [0, 0, 0];
    // Moon: low-precision geocentric ecliptic position
    const Mm = (134.963 + 13.064993 * d) * D2R;
    const lon = (218.316 + 13.176396 * d) * D2R + 6.289 * D2R * sin(Mm);
    const lat = 5.128 * D2R * sin((93.272 + 13.22935 * d) * D2R);
    const r = (385001 - 20905 * cos(Mm)) * 1000;
    B[10].pos = add(B[3].pos, [r * cos(lat) * cos(lon), r * sin(lat), -r * cos(lat) * sin(lon)]);
    for (let i = 0; i < NB; i++) {
      const b = B[i];
      const p = raDec(b.pole[0], b.pole[1]);
      const a = b.pole[0] * D2R;
      const N = eqToWorld([-sin(a), cos(a), 0]);
      const Q = cross(p, N);
      const W = (((b.w0 + b.wr * d) % 360) + 360) % 360 * D2R;
      let X = add(mul(N, cos(W)), mul(Q, sin(W)));
      if (i === 10) {
        const e = sub(B[3].pos, b.pos); // tidally locked: prime meridian faces Earth
        X = norm(sub(e, mul(p, dot(e, p))));
      }
      b.M = [X, p, cross(X, p)];
    }
  }

  // ------------------------------------------------------------ noise (mirrors the GLSL)
  let GP = [0, 0, 0];
  let earthPx = null;
  const EM = [0, 0, 0];
  function hsh(x, y, z, s) {
    let h = (Math.imul(x, 0x9e3779b1) ^ Math.imul(y, 0x85ebca77) ^ Math.imul(z, 0xc2b2ae3d) ^ Math.imul(s, 0x27d4eb2f)) >>> 0;
    h ^= h >>> 15;
    h = Math.imul(h, 0x2c1b3c6d) >>> 0;
    h ^= h >>> 12;
    h = Math.imul(h, 0x297a2d39) >>> 0;
    h ^= h >>> 15;
    return (h >>> 8) / 16777216;
  }
  const cellOf = (o) => {
    const s = pow(2, o - 29);
    const px = GP[0] * s;
    const py = GP[1] * s;
    const pz = GP[2] * s;
    const fx = floor(px);
    const fy = floor(py);
    const fz = floor(pz);
    return [fx & 255, fy & 255, fz & 255, px - fx, py - fy, pz - fz];
  };
  function grd(hv, x, y, z) {
    const g = floor(hv * 12);
    const u = g < 8 ? x : y;
    const v = g < 4 ? y : z;
    return ((g & 1) === 0 ? u : -u) + ((g & 2) === 0 ? v : -v);
  }
  function vn(o) {
    const [X, Y, Z, fx, fy, fz] = cellOf(o);
    const q = (t) => t * t * t * (t * (t * 6 - 15) + 10);
    const x = q(fx);
    const y = q(fy);
    const z = q(fz);
    const X1 = (X + 1) & 255;
    const Y1 = (Y + 1) & 255;
    const Z1 = (Z + 1) & 255;
    const a = mix(grd(hsh(X, Y, Z, o), fx, fy, fz), grd(hsh(X1, Y, Z, o), fx - 1, fy, fz), x);
    const b = mix(grd(hsh(X, Y1, Z, o), fx, fy - 1, fz), grd(hsh(X1, Y1, Z, o), fx - 1, fy - 1, fz), x);
    const e = mix(grd(hsh(X, Y, Z1, o), fx, fy, fz - 1), grd(hsh(X1, Y, Z1, o), fx - 1, fy, fz - 1), x);
    const g = mix(grd(hsh(X, Y1, Z1, o), fx, fy - 1, fz - 1), grd(hsh(X1, Y1, Z1, o), fx - 1, fy - 1, fz - 1), x);
    return 0.5 + 0.6 * mix(mix(a, b, y), mix(e, g, y), z);
  }
  function cr(o) {
    const [X, Y, Z, fx, fy, fz] = cellOf(o);
    if (hsh(X, Y, Z, o + 40) > 0.6) return 0;
    const r = 0.1 + 0.22 * hsh(X, Y, Z, o + 41);
    const k = 1 - 3 * r;
    const dx = fx - (0.5 + (hsh(X, Y, Z, o + 42) - 0.5) * k);
    const dy = fy - (0.5 + (hsh(X, Y, Z, o + 43) - 0.5) * k);
    const dz = fz - (0.5 + (hsh(X, Y, Z, o + 44) - 0.5) * k);
    const d = sqrt(dx * dx + dy * dy + dz * dz) / r;
    if (d > 1.5) return 0;
    const bowl = d < 1 ? d * d - 1 : 0;
    const rim = exp(-(d - 1) * (d - 1) * 25);
    return (bowl * 0.55 + rim * 0.18) * r * 0.5;
  }
  function emap(x, y, z, k) {
    if (k === 0) {
      const px = (atan2(-z, x) / (2 * PI) + 0.5) * 1024 - 0.5;
      const py = (0.5 - asin(clamp(y, -1, 1)) / PI) * 512 - 0.5;
      const ix = floor(px);
      const iy = floor(py);
      const fx = px - ix;
      const fy = py - iy;
      const x0 = ix & 1023;
      const x1 = (ix + 1) & 1023;
      const y0 = clamp(iy, 0, 511);
      const y1 = clamp(iy + 1, 0, 511);
      for (let c = 0; c < 3; c++) {
        const s = (xx, yy) => earthPx[(yy * 1024 + xx) * 4 + c] / 255;
        EM[c] = mix(mix(s(x0, y0), s(x1, y0), fx), mix(s(x0, y1), s(x1, y1), fx), fy);
      }
    }
    return EM[k];
  }

  // ------------------------------------------------------------ terrain: one source, two targets
  const expandCaps = (src) =>
    src.replace(/CAP\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)/g, (_, la, lo, rd) => {
      const a = la * D2R;
      const b = lo * D2R;
      const f = (v) => v.toFixed(8);
      return `cap(x,y,z,${f(cos(a) * cos(b))},${f(sin(a))},${f(-cos(a) * sin(b))},${f(1 / (rd * D2R))})`;
    });
  const TERRAIN_GLSL = expandCaps(window.TERRAIN_SRC);
  const terrainJs = (() => {
    const js = TERRAIN_GLSL.replace(/\bfloat\s+(\w+)\[(\d+)\];/g, 'const $1=new Float64Array($2);').replace(/\b(?:float|int|void)\s+(\w+)\s*\(([^)]*)\)\s*\{/g, (_, name, params) => `function ${name}(${params.replace(/\b(?:float|int)\s+/g, '')}){`).replace(
      /\b(?:float|int)\s+(?=\w+\s*[=;,])/g,
      'let ',
    );
    const env = {
      sin, cos, asin, sqrt, abs, min, max, exp, pow, floor, mix, clamp, smoothstep, vn, cr, emap,
      fract: (v) => v - floor(v),
      atan: (y, x) => (x === undefined ? Math.atan(y) : atan2(y, x)),
      OL: (o) => pow(2, 29 - o),
    };
    return new Function('env', `const {${Object.keys(env).join(',')}}=env;${js};return terrain;`)(env);
  })();
  function groundH(i, n, guess) {
    const b = B[i];
    GP = mul(n, b.R); // noise lives on the datum sphere, as in the shader
    const h = terrainJs(i, n[0], n[1], n[2], 31);
    return b.sea !== undefined ? max(h, b.sea) : h;
  }

  // ------------------------------------------------------------ GL
  const cv = $('c');
  const gl = cv.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance' });
  const fail = (msg) => {
    msg = window.tr(msg);
    const s = $('s');
    s.className = 'e';
    s.textContent = msg;
    throw new Error(msg);
  };
  if (!gl) fail('이 브라우저에서는 WebGL2를 사용할 수 없습니다. 최신 Chrome, Edge, Firefox에서 열어 주세요.');
  const MAX_TEX_SIZE = gl.getParameter(gl.MAX_TEXTURE_SIZE);
  const MAX_VIEWPORT = gl.getParameter(gl.MAX_VIEWPORT_DIMS);
  const MAX_RENDER_W = min(MAX_TEX_SIZE, MAX_VIEWPORT[0]);
  const MAX_RENDER_H = min(MAX_TEX_SIZE, MAX_VIEWPORT[1]);

  function program(fsSrc) {
    const mk = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) fail('셰이더 컴파일 오류:\n' + gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, mk(gl.VERTEX_SHADER, window.SHADER_VS));
    gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fsSrc));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) fail('셰이더 링크 오류:\n' + gl.getProgramInfoLog(p));
    const cache = {};
    return { p, u: (n) => (n in cache ? cache[n] : (cache[n] = gl.getUniformLocation(p, n))) };
  }

  let P; // main program
  let fbo;
  let fboTex;
  let mapFbo;
  let mapTex;
  let fboW = 0;
  let fboH = 0;
  let fboCapW = 0;
  let fboCapH = 0;
  const QUAL = [
    { scale: 0.7, steps: 72, atmN: 7, shadow: 0, stepMin: 0.08, sky: 1024 },
    { scale: 1.0, steps: 104, atmN: 10, shadow: 1, stepMin: 0.065, sky: 1024 },
    { scale: 1.55, steps: 152, atmN: 14, shadow: 1, stepMin: 0.05, sky: 2048 },
  ];
  let qi = 2;
  try {
    const v = localStorage.solarDetail;
    if (v !== undefined && v !== '') qi = clamp(+v | 0, 0, 2);
  } catch {
    /* storage unavailable: keep default */
  }
  let scale = QUAL[qi].scale;

  function resize() {
    // Render at a capped device-pixel ratio for sharper output on HiDPI screens.
    // The adaptive render scale below backs off automatically when the GPU is busy.
    const dpr = min(window.devicePixelRatio || 1, 1.5, MAX_RENDER_W / max(innerWidth, 1), MAX_RENDER_H / max(innerHeight, 1));
    const w = max(2, floor(innerWidth * dpr));
    const h = max(2, floor(innerHeight * dpr));
    if (cv.width !== w || cv.height !== h) {
      cv.width = w;
      cv.height = h;
    }
    // Keep labels and HUD in CSS pixels so their size does not shrink on HiDPI screens.
    const ov = $('ov');
    const ow = max(2, floor(innerWidth));
    const oh = max(2, floor(innerHeight));
    if (ov.width !== ow || ov.height !== oh) {
      ov.width = ow;
      ov.height = oh;
    }
    const capW = min(MAX_RENDER_W, max(fboCapW, ceil(w * QUAL[qi].scale)));
    const capH = min(MAX_RENDER_H, max(fboCapH, ceil(h * QUAL[qi].scale)));
    if (fboW !== w || fboH !== h || fboCapW !== capW || fboCapH !== capH) {
      fboW = w;
      fboH = h;
      fboCapW = capW;
      fboCapH = capH;
      gl.bindTexture(gl.TEXTURE_2D, fboTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, fboCapW, fboCapH, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    }
  }

  function buildSky(size) {
    const sp = program(window.SHADER_SKY);
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_CUBE_MAP, tex);
    for (let f = 0; f < 6; f++) gl.texImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_X + f, 0, gl.RGBA8, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.useProgram(sp.p);
    const gz = raDec(192.859, 27.128);
    const gc = raDec(266.405, -28.936);
    const gx = norm(sub(gc, mul(gz, dot(gc, gz))));
    const gy = cross(gz, gx);
    gl.uniformMatrix3fv(sp.u('uGal'), false, [...gx, ...gy, ...gz]);
    const st = [];
    const sc = [];
    window.STARS.forEach(([ra, dec, mag, cls]) => {
      st.push(...raDec(ra, dec), pow(10, -0.4 * (mag - 1)));
      sc.push(...window.STAR_COLORS[cls]);
    });
    gl.uniform4fv(sp.u('uSt'), st);
    gl.uniform3fv(sp.u('uStC'), sc);
    gl.uniform1i(sp.u('uNSt'), window.STARS.length);
    gl.uniform3fv(sp.u('uBlob'), [...raDec(80.894, -69.756), ...raDec(13.187, -72.829), ...raDec(10.685, 41.269)]);
    gl.uniform1f(sp.u('uSize'), size);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.viewport(0, 0, size, size);
    for (let f = 0; f < 6; f++) {
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_CUBE_MAP_POSITIVE_X + f, tex, 0);
      gl.uniform1i(sp.u('uFace'), f);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fb);
    gl.deleteProgram(sp.p);
    return tex;
  }

  function initGL(earthImg) {
    const c2 = document.createElement('canvas');
    c2.width = 1024;
    c2.height = 512;
    const x2 = c2.getContext('2d', { willReadFrequently: true });
    x2.drawImage(earthImg, 0, 0);
    earthPx = x2.getImageData(0, 0, 1024, 512).data;
    const et = gl.createTexture();
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, et);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1024, 512, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(earthPx.buffer));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

    gl.bindVertexArray(gl.createVertexArray());
    const sky = buildSky(QUAL[qi].sky);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_CUBE_MAP, sky);

    P = program(expandCaps(window.SHADER_MAIN(TERRAIN_GLSL)));
    gl.useProgram(P.p);
    gl.uniform1i(P.u('uSky'), 0);
    gl.uniform1i(P.u('uEarth'), 1);
    initBake();
    tq.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');

    const mkTarget = (w, h, filter) => {
      const t = gl.createTexture();
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const f = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, f);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return [f, t];
    };
    [fbo, fboTex] = mkTarget(4, 4, gl.LINEAR);
    [mapFbo, mapTex] = mkTarget(512, 256, gl.NEAREST);
    fboW = fboH = 0;
  }

  // ------------------------------------------------------------ player
  const pl = {
    frame: -1, // body index the position is expressed in, or -1 for heliocentric
    pos: [0, 0, 0],
    f: [0, 0, -1],
    up: [0, 1, 0],
    tg: [0, 0, -1],
    v: [0, 0, 0],
    mode: 'fly',
    h: 0,
    vy: 0,
    onG: true,
    lastH: 0,
    mul: 1,
    site: '',
  };
  const keys = {};
  let suppressWUntilRelease = false;
  let mouseX = 0;
  let mouseY = 0;
  let simT = Date.now();
  const RATES = [0, 1, 60, 600, 3600, 86400, 604800, 2592000];
  let rateI = 1;
  let running = false;
  let ready = false; // set once GL and the Earth map are loaded
  let showMap = false;
  let mapMode = 0; // 0 auto, 1 system, 2 galaxy
  let showLabels = true;
  let showInfo = true;
  let warn = '';
  let warnT = 0;
  // navigation: dest = { i: body, k: 0 for the body itself or 1 + site index, n: site normal or null, h, name }
  const nav = { open: false, dest: null };
  const st = { focus: 3, altR: 0, altG: 0, speed: 0, wp: [0, 0, 0], sunElev: 0 };

  const worldPos = () => (pl.frame >= 0 ? add(B[pl.frame].pos, toW(pl.frame, pl.pos)) : pl.pos);
  const dirW = (v) => (pl.frame >= 0 ? toW(pl.frame, v) : v);
  function setFrame(nf) {
    if (nf === pl.frame) return;
    const wp = worldPos();
    const vs = [pl.f, pl.up, pl.tg, pl.v].map(dirW);
    pl.frame = nf;
    const conv = (v) => (nf >= 0 ? toB(nf, v) : v);
    pl.pos = nf >= 0 ? toB(nf, sub(wp, B[nf].pos)) : wp;
    [pl.f, pl.up, pl.tg, pl.v] = vs.map(conv);
  }
  function nearest(wp) {
    let bi = 0;
    let ba = Infinity;
    for (let i = 0; i < NB; i++) {
      const a = len(sub(wp, B[i].pos)) - B[i].R;
      if (a < ba) {
        ba = a;
        bi = i;
      }
    }
    return [bi, ba];
  }

  function title(main, small) {
    const t = $('t');
    t.innerHTML = '';
    t.append(window.tr(main));
    if (small) {
      const s = document.createElement('small');
      s.textContent = window.tr(small);
      t.append(s);
    }
    t.classList.add('on');
    clearTimeout(title.timer);
    title.timer = setTimeout(() => t.classList.remove('on'), 3200);
  }
  function flash() {
    document.body.classList.add('f');
    setTimeout(() => document.body.classList.remove('f'), 260);
  }

  function sunInBody(i) {
    return i === 0 ? [1, 0, 0] : toB(i, norm(sub(B[0].pos, B[i].pos)));
  }
  function pickSite(i) {
    const b = B[i];
    const s = sunInBody(i);
    let best = null;
    let bs = -1e9;
    for (const [lat, lon, name] of b.sites) {
      const n = llToN(lat, lon);
      const e = dot(n, s);
      const score = -abs(e - 0.5);
      if ((i === 0 || e > 0.12) && score > bs) {
        bs = score;
        best = { n, name };
      }
    }
    if (best) return best;
    // No listed site is in daylight: stand where the Sun is about 35 degrees up.
    const [slat, slon] = nToLL(s);
    const lat = b.lat0 !== undefined ? b.lat0 : clamp(slat, -50, 50);
    return { n: llToN(lat, slon + 52), name: '' };
  }
  function landAt(i, n, name) {
    const b = B[i];
    pl.frame = i;
    pl.lastH = groundH(i, n, groundH(i, n, 0));
    pl.pos = mul(n, b.R + pl.lastH + EYE);
    pl.mode = 'walk';
    pl.h = 0;
    pl.vy = 0;
    pl.v = [0, 0, 0];
    pl.up = n;
    const s = sunInBody(i);
    let tg = sub(s, mul(n, dot(s, n)));
    tg = len(tg) < 1e-3 ? perp(n) : norm(tg);
    tg = rot(tg, n, 35 * D2R);
    pl.tg = tg;
    pl.f = norm(add(mul(tg, cos(0.07)), mul(n, sin(0.07))));
    pl.site = name;
  }
  function jumpTo(i) {
    updateBodies(simT);
    const b = B[i];
    flash();
    const onIt = pl.frame === i && len(pl.pos) - b.R < 0.05 * b.R;
    if (onIt) {
      const n0 = norm(pl.pos);
      const s = sunInBody(i);
      let n = norm(add(mul(n0, 0.5), mul(s, 0.85)));
      // ringed planets: rise above the sunlit face of the ring plane
      if (i === 6 || i === 7) n = norm(add(n, [0, s[1] >= 0 ? 0.5 : -0.5, 0]));
      pl.pos = mul(n, b.R * (i === 6 ? 4.6 : 3.3));
      pl.mode = 'fly';
      pl.v = [0, 0, 0];
      pl.up = n;
      const north = sub([0, 1, 0], mul(n, n[1])); // keep the body's north toward the top of the screen
      pl.tg = len(north) < 1e-3 ? perp(n) : norm(north);
      pl.f = norm(add(mul(n, -0.99), mul(pl.tg, 0.14)));
      pl.site = '';
      title(b.name, '궤도에서 내려다보는 중 · 같은 키를 다시 누르면 착륙합니다');
    } else {
      const { n, name } = pickSite(i);
      landAt(i, n, name);
      title(b.name, name || b.info.note || '표면');
    }
  }

  // ---------------------------------------------------------- navigation
  function setDest(i) {
    const b = B[i];
    const k = nav.dest && nav.dest.i === i ? (nav.dest.k + 1) % (b.sites.length + 1) : 0;
    if (k === 0) {
      nav.dest = { i, k, n: null, h: 0, name: '' };
    } else {
      const [lat, lon, name] = b.sites[k - 1];
      const n = llToN(lat, lon);
      nav.dest = { i, k, n, h: groundH(i, n, groundH(i, n, 0)), name };
    }
  }
  // Destination relative to the player, in the player's frame. A bare body means the nearest point of its surface.
  function navVector() {
    const d = nav.dest;
    const b = B[d.i];
    if (pl.frame === d.i) {
      const n = d.n || norm(pl.pos);
      return sub(mul(n, b.R + (d.n ? d.h : pl.lastH) + EYE), pl.pos);
    }
    const wp = worldPos();
    const n = d.n ? toW(d.i, d.n) : norm(sub(wp, b.pos));
    const v = sub(add(b.pos, mul(n, b.R + d.h + EYE)), wp);
    return pl.frame >= 0 ? toB(pl.frame, v) : v;
  }
  function navSteer(b, up) {
    const v = navVector();
    const dist = len(v);
    let dir = mul(v, 1 / (dist || 1));
    const flat = sub(dir, mul(up, dot(dir, up)));
    const sameBody = pl.frame === nav.dest.i;
    // On the destination body a walker follows the great circle; the chord projected on the ground gives its heading.
    const walk = sameBody && nav.dest.n && len(flat) > 1e-6 ? norm(flat) : null;
    if (b) {
      // If the body underfoot blocks the straight line, climb and go around until the line is clear.
      const tc = -dot(pl.pos, dir);
      const lim = b.R + b.hmax + 200;
      if (tc > 0 && tc < dist && dot(pl.pos, pl.pos) - tc * tc < lim * lim && len(flat) > 1e-6) dir = norm(add(norm(flat), mul(up, 0.5)));
    }
    return { dir, walk, dist };
  }
  function navArrive() {
    const d = nav.dest;
    const there = d.n ? len(navVector()) < 4 : pl.frame === d.i && pl.mode === 'walk';
    if (there) {
      title('도착', `${B[d.i].name}${d.name ? ' · ' + d.name : ''}`);
      nav.dest = null;
      keys.KeyW = false;
      suppressWUntilRelease = true;
      if (pl.mode === 'walk') pl.v = [0, 0, 0];
    }
  }

  // Find the first body sphere crossed by a movement step. Frame-to-frame point
  // collision misses a planet whenever a fast step jumps from one side to the other.
  function sweptBodyHit(start, end) {
    const delta = sub(end, start);
    const a = dot(delta, delta);
    if (a < 1) return null;
    let first = null;
    for (let i = 0; i < NB; i++) {
      const offset = sub(start, B[i].pos);
      const radius = B[i].R + B[i].hmax + EYE;
      const c = dot(offset, offset) - radius * radius;
      if (c <= 0) continue; // already near/on this body's surface
      const closestT = clamp(-dot(offset, delta) / a, 0, 1);
      const closest = add(offset, mul(delta, closestT));
      const gap = radius * radius - dot(closest, closest);
      if (gap < 0) continue;
      const t = closestT - sqrt(gap / a);
      if (t < 0 || t > 1 || (first && t >= first.t)) continue;
      const hitWorld = add(start, mul(delta, t));
      const normal = norm(toB(i, norm(sub(hitWorld, B[i].pos))));
      first = { i, t, normal };
    }
    return first;
  }

  function step(dt) {
    simT += dt * 1000 * RATES[rateI];
    updateBodies(simT);
    const stepStart = worldPos();
    const b = pl.frame >= 0 ? B[pl.frame] : null;
    let up;
    if (b) {
      up = norm(pl.pos);
    } else {
      up = norm(add(pl.up, mul(sub([0, 1, 0], pl.up), min(1, dt * 0.4))));
    }
    pl.up = up;
    // look
    const sp = clamp(dot(pl.f, up), -1, 1);
    let tg = sub(pl.f, mul(up, sp));
    tg = len(tg) < 1e-5 ? sub(pl.tg, mul(up, dot(pl.tg, up))) : tg;
    tg = len(tg) < 1e-5 ? perp(up) : norm(tg);
    const S = 0.0022;
    const pitch = clamp(asin(sp) - mouseY * S, -1.553, 1.553);
    tg = rot(tg, up, -mouseX * S);
    mouseX = mouseY = 0;
    pl.tg = tg;
    pl.f = norm(add(mul(tg, cos(pitch)), mul(up, sin(pitch))));
    const right = cross(tg, up);

    const fwd = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0);
    const str = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
    const vert = (keys.KeyE ? 1 : 0) - (keys.KeyQ ? 1 : 0);
    const fast = keys.ShiftLeft || keys.ShiftRight;
    const wp0 = worldPos();
    const [, nearAlt] = nearest(wp0);
    const k = 1 - exp(-dt * 6);
    // With a destination set, W follows the straight line to it instead of the view direction.
    const nv = nav.dest && keys.KeyW && !keys.KeyS ? navSteer(b, up) : null;
    if (nv) {
      const face = nv.walk && nv.dist <= 500 ? nv.walk : nv.dir;
      pl.f = norm(add(pl.f, mul(sub(face, pl.f), min(1, dt * 3))));
    }

    // Walk only the last stretch; anything farther (or on another body) is flown.
    const navFly = nv && (!nv.walk || nv.dist > 500);
    if (pl.mode === 'walk' && b && navFly) {
      pl.mode = 'fly';
      pl.v = mul(up, 2);
    }
    if (pl.mode === 'walk' && b) {
      let mv = add(mul(nv && nv.walk ? nv.walk : tg, fwd), mul(right, str));
      const sp2 = WALK * (fast ? 4 : 1);
      mv = len(mv) > 0 ? mul(norm(mv), sp2) : [0, 0, 0];
      pl.v = add(pl.v, mul(sub(mv, pl.v), k));
      pl.v = sub(pl.v, mul(up, dot(pl.v, up)));
      const n = norm(add(pl.pos, mul(pl.v, dt)));
      if (keys.Space && pl.onG) {
        pl.vy = 3.1;
        pl.onG = false;
      }
      pl.vy -= b.g * dt;
      pl.h += pl.vy * dt;
      if (pl.h <= 0) {
        pl.h = 0;
        pl.vy = 0;
        pl.onG = true;
      }
      pl.lastH = groundH(pl.frame, n, pl.lastH);
      pl.pos = mul(n, b.R + pl.lastH + EYE + pl.h);
      st.altG = EYE + pl.h;
      if (keys.KeyE) {
        pl.mode = 'fly';
        pl.v = mul(n, 2);
      }
    } else {
      pl.mode = 'fly';
      let dir = add(add(mul(nv ? nv.dir : pl.f, fwd), mul(right, str)), mul(up, vert));
      // speed follows the current clearance: walking pace at the ground, interplanetary in deep space
      let clr = nearAlt;
      if (b) {
        const r = len(pl.pos);
        clr = r - b.R < 0.1 * b.R ? r - (b.R + pl.lastH) : min(nearAlt, r - b.R);
      }
      // Navigating: pace by the remaining distance too, so a shallow final approach does not crawl.
      if (nv) clr = max(clr, min(0.5 * nv.dist, 2e5));
      const base = clamp(0.5 * max(clr, 0), 2, 1.5e10) * pl.mul * (fast ? 8 : 1);
      dir = len(dir) > 0 ? mul(norm(dir), base) : [0, 0, 0];
      pl.v = add(pl.v, mul(sub(dir, pl.v), k));
      pl.pos = add(pl.pos, mul(pl.v, dt));
      if (b) {
        const r = len(pl.pos);
        if (r - b.R < 0.1 * b.R) {
          const n = mul(pl.pos, 1 / r);
          pl.lastH = groundH(pl.frame, n, pl.lastH);
          const minR = b.R + pl.lastH + EYE;
          st.altG = r - (b.R + pl.lastH);
          if (r < minR) {
            pl.pos = mul(n, minR);
            st.altG = EYE;
            // touching down ends the flight, unless navigation still has ground to cover
            if (!keys.KeyE && (!navFly || (!nav.dest.n && pl.frame === nav.dest.i))) {
              pl.mode = 'walk';
              pl.h = 0;
              pl.vy = 0;
              pl.onG = true;
              pl.v = [0, 0, 0];
            }
          }
        } else {
          st.altG = r - b.R;
        }
      }
    }
    // Stop at the first surface crossed, even if this frame's movement was very fast.
    const hit = sweptBodyHit(stepStart, worldPos());
    if (hit) {
      const isDestination = nav.dest && nav.dest.i === hit.i;
      const landingNormal = isDestination && nav.dest.n ? nav.dest.n : hit.normal;
      const landingName = isDestination ? nav.dest.name : '';
      landAt(hit.i, landingNormal, landingName);
      st.altG = EYE;
      if (isDestination) {
        title('도착', `${B[hit.i].name}${landingName ? ' · ' + landingName : ''}`);
        nav.dest = null;
        keys.KeyW = false;
        suppressWUntilRelease = true;
      }
    }
    // keep inside the heliosphere
    let wp = worldPos();
    const hd = len(wp);
    if (hd > LIMIT) {
      const n = mul(wp, 1 / hd);
      setFrame(-1);
      pl.pos = mul(n, LIMIT);
      pl.v = sub(pl.v, mul(n, max(0, dot(pl.v, n))));
      wp = pl.pos;
      warn = '헬리오포즈(약 120 AU)입니다. 태양계 밖으로는 나갈 수 없습니다.';
      warnT = 3;
    }
    // choose the reference frame for the next step
    const [ni, na] = nearest(wp);
    if (pl.frame < 0) {
      if (na < 5 * B[ni].R) setFrame(ni);
    } else if (ni !== pl.frame && na < 5 * B[ni].R && na < len(pl.pos) - B[pl.frame].R) {
      setFrame(ni);
    } else if (len(pl.pos) - B[pl.frame].R > 6 * B[pl.frame].R) {
      setFrame(na < 5 * B[ni].R ? ni : -1);
    }
    if (pl.frame < 0) st.altG = na;
    st.speed = len(pl.v);
    if (warnT > 0) warnT -= dt;
    if (nav.dest) navArrive();
  }

  // ------------------------------------------------------------ render
  const fBP = new Float32Array(NB * 4);
  const fBC = new Float32Array(NB * 4);
  const fRim = new Float32Array(NB * 4);
  const fBM = new Float32Array(NB * 9);
  const iOI = new Int32Array(96);
  const fOF = new Float32Array(96);
  const cam = { R: [1, 0, 0], U: [0, 1, 0], F: [0, 0, -1], rel: [] };
  let timeS = 0;

  // Per-octave lattice offsets of a body-fixed origin, so the shader can add small relative positions exactly.
  function setOct(origin) {
    for (let o = 0; o < 32; o++) {
      const s = pow(2, o - 29);
      for (let c = 0; c < 3; c++) {
        const q = origin[c] * s;
        const fl = floor(q);
        iOI[o * 3 + c] = fl & 255;
        fOF[o * 3 + c] = q - fl;
      }
    }
    gl.uniform3iv(P.u('uOI'), iOI);
    gl.uniform3fv(P.u('uOF'), fOF);
  }

  // ---------------------------------------------------------- baked height levels
  // Ray marching reads terrain height from six nested 512x512 textures centred near the camera
  // instead of evaluating noise at every step. One stale level is re-baked per frame.
  const BN = 512;
  const BS = [8, 32, 128, 512, 2048, 8192]; // texel spacing in metres
  const bake = { ok: false, tex: null, dummy: null, fbo: null, body: -1, c0: [0, 1, 0], e1: [1, 0, 0], e2: [0, 0, 1], lv: BS.map(() => ({ cu: 0, cv: 0, valid: false })) };
  const fLv = new Float32Array(24);
  function initBake() {
    const mk = (n, layers) => {
      const t = gl.createTexture();
      gl.activeTexture(gl.TEXTURE3);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, t);
      gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.R32F, n, n, layers);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    };
    bake.dummy = mk(1, 1);
    // Rendering to and filtering float textures are extensions; without them the noise path stays in use.
    if (gl.getExtension('EXT_color_buffer_float') && gl.getExtension('OES_texture_float_linear')) {
      bake.tex = mk(BN, BS.length);
      bake.fbo = gl.createFramebuffer();
      bake.ok = true;
    }
    gl.uniform1i(P.u('uHT'), 3);
  }
  function bakeLevel(k, u, v, R) {
    const s = BS[k];
    const L = bake.lv[k];
    L.cu = Math.round(u / s) * s;
    L.cv = Math.round(v / s) * s;
    L.valid = true;
    const z = sqrt(max(1 - (L.cu * L.cu + L.cv * L.cv) / (R * R), 0.02));
    setOct(add(add(mul(bake.c0, z * R), mul(bake.e1, L.cu)), mul(bake.e2, L.cv)));
    gl.uniform1i(P.u('uMode'), 2);
    gl.uniform4f(P.u('uBk'), L.cu, L.cv, s, 0);
    gl.uniform1i(P.u('uBakeOm'), clamp(floor(29 - Math.log2(4 * s)), 0, 24));
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, bake.dummy); // the target must not be bound for sampling while drawn to
    gl.bindFramebuffer(gl.FRAMEBUFFER, bake.fbo);
    gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, bake.tex, 0, k);
    gl.viewport(0, 0, BN, BN);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, bake.tex);
    gl.uniform1i(P.u('uMode'), 0);
    setOct(cam.camB);
  }
  function updateBake() {
    const F = st.focus;
    const b = B[F];
    gl.activeTexture(gl.TEXTURE3);
    if (!bake.ok || st.altR > 0.08 * b.R) {
      gl.uniform1i(P.u('uBake'), 0);
      return;
    }
    const camB = cam.camB;
    const r0 = len(camB);
    const n = mul(camB, 1 / r0);
    // Re-anchor on a new body, after drifting a quarter radian, or once tangent coordinates grow
    // past 200 km (float32 in the shader would otherwise lose metre precision on large bodies).
    const far = max(abs(dot(n, bake.e1)), abs(dot(n, bake.e2))) * b.R > 2e5;
    if (bake.body !== F || dot(n, bake.c0) < 0.97 || far) {
      bake.body = F;
      bake.c0 = n;
      bake.e1 = perp(n);
      bake.e2 = cross(n, bake.e1);
      bake.lv.forEach((L) => (L.valid = false));
    }
    gl.uniform3fv(P.u('uE1'), bake.e1);
    gl.uniform3fv(P.u('uE2'), bake.e2);
    gl.uniform3fv(P.u('uC0'), bake.c0);
    const u = dot(n, bake.e1) * b.R;
    const v = dot(n, bake.e2) * b.R;
    for (let k = BS.length - 1; k >= 0; k--) {
      const L = bake.lv[k];
      const s = BS[k];
      if (s * 600 < st.altG) continue; // finer than this altitude can show
      if (!L.valid || max(abs(u - L.cu), abs(v - L.cv)) > (s * BN) / 4) {
        bakeLevel(k, u, v, b.R);
        break;
      }
    }
    bake.lv.forEach((L, k) => fLv.set([L.cu, L.cv, BS[k], L.valid ? 1 : 0], k * 4));
    gl.uniform4fv(P.u('uLv'), fLv);
    gl.uniform3f(P.u('uCamT'), dot(camB, bake.e1), dot(camB, bake.e2), dot(camB, bake.c0));
    gl.uniform1i(P.u('uBake'), 1);
  }

  function setUniforms() {
    const wp = worldPos();
    st.wp = wp;
    const [F] = nearest(wp);
    st.focus = F;
    const fb = B[F];
    for (let i = 0; i < NB; i++) {
      const b = B[i];
      const rel = pl.frame === i ? mul(toW(i, pl.pos), -1) : sub(b.pos, wp);
      cam.rel[i] = rel;
      fBP.set([rel[0], rel[1], rel[2], b.R], i * 4);
      const dAU = max(len(b.pos) / AU, 0.2);
      fBC.set([b.col[0], b.col[1], b.col[2], i === 0 ? 1 : clamp(pow(dAU, -0.35), 0.22, 1.3)], i * 4);
      fRim.set(b.rim, i * 4);
      fBM.set([...b.M[0], ...b.M[1], ...b.M[2]], i * 9);
    }
    const camB = pl.frame === F ? pl.pos : toB(F, mul(cam.rel[F], -1));
    const r0 = len(camB);
    const camN = mul(camB, 1 / r0);
    const altR = r0 - fb.R;
    st.altR = altR;
    cam.camB = camB;
    setOct(camB);
    const f = dirW(pl.f);
    const upW = dirW(pl.up);
    cam.F = f;
    cam.R = norm(cross(f, upW));
    cam.U = cross(cam.R, f);
    const upF = toW(F, camN);
    const sunDir = norm(cam.rel[0]);
    const dip = -Math.acos(clamp(fb.R / r0, -1, 1));
    st.sunElev = F === 0 ? 1 : asin(clamp(dot(upF, sunDir), -1, 1));
    const sunVis = F === 0 ? 1 : smoothstep(dip - 0.012, dip + 0.012, st.sunElev);
    const a = fb.atm;
    const q = QUAL[qi];
    const u = P.u;
    gl.uniform1f(u('uTime'), timeS);
    gl.uniform1f(u('uTanF'), TAN_F);
    gl.uniform1f(u('uExp'), 0.62);
    gl.uniformMatrix3fv(u('uCam'), false, [...cam.R, ...cam.U, ...cam.F]);
    gl.uniform4fv(u('uBP'), fBP);
    gl.uniform4fv(u('uBC'), fBC);
    gl.uniform4fv(u('uRim'), fRim);
    gl.uniformMatrix3fv(u('uBM'), false, fBM);
    gl.uniform1f(u('uGlare'), clamp(pow(max(len(wp) / AU, 0.05), -0.7), 0.04, 3));
    gl.uniform1f(u('uSunVis'), sunVis);
    gl.uniform1i(u('uF'), F);
    gl.uniform1i(u('uSteps'), q.steps);
    gl.uniform1i(u('uAtmN'), q.atmN);
    gl.uniform1i(u('uShadow'), q.shadow);
    gl.uniform1f(u('uStepMin'), q.stepMin);
    gl.uniformMatrix3fv(u('uFM'), false, fBM.subarray(F * 9, F * 9 + 9));
    gl.uniform1f(u('uAlt'), altR);
    gl.uniform1f(u('uR0'), r0);
    gl.uniform1f(u('uClr'), max(st.altG, 0.5));
    gl.uniform1f(u('uDisp'), 1 - smoothstep(0.04 * fb.R, 0.08 * fb.R, altR));
    gl.uniform1f(u('uHmax'), fb.hmax);
    gl.uniform1f(u('uSea'), fb.sea !== undefined ? fb.sea : -1e9);
    gl.uniform1f(u('uShell'), a.shell);
    gl.uniform3fv(u('uUp'), upF);
    gl.uniform3fv(u('uCamN'), camN);
    gl.uniform3fv(u('uBetaR'), a.bR);
    gl.uniform3fv(u('uBetaM'), a.bM);
    gl.uniform3fv(u('uBetaA'), a.bA);
    gl.uniform3fv(u('uMieF'), a.mieF);
    gl.uniform3fv(u('uAmb'), a.amb);
    gl.uniform3fv(u('uAmbS'), a.ambS);
    gl.uniform3fv(u('uDeckCol'), a.deckCol);
    gl.uniform3fv(u('uDeck'), a.deck);
    gl.uniform1f(u('uBetaMe'), a.bMe);
    gl.uniform1f(u('uHR'), a.HR);
    gl.uniform1f(u('uHM'), a.HM);
    gl.uniform1f(u('uG'), a.g);
    gl.uniform1f(u('uAtmTop'), a.top);
    gl.uniform1f(u('uLight'), fBC[F * 4 + 3]);
  }

  // GPU time of the scene pass, when the browser exposes timer queries. It drives the adaptive
  // resolution directly; frame intervals alone cannot tell a slow GPU from a 30 Hz display.
  const tq = { ext: null, q: null, ms: 0, fresh: false };
  function pollTimer() {
    if (!tq.q || !gl.getQueryParameter(tq.q, gl.QUERY_RESULT_AVAILABLE)) return;
    if (!gl.getParameter(tq.ext.GPU_DISJOINT_EXT)) {
      tq.ms = gl.getQueryParameter(tq.q, gl.QUERY_RESULT) / 1e6;
      tq.fresh = true;
    }
    gl.deleteQuery(tq.q);
    tq.q = null;
  }

  function render() {
    resize();
    pollTimer();
    const renderScale = min(scale, fboCapW / fboW, fboCapH / fboH);
    const w = min(fboCapW, max(2, floor(fboW * renderScale)));
    const h = min(fboCapH, max(2, floor(fboH * renderScale)));
    gl.useProgram(P.p);
    setUniforms();
    updateBake();
    gl.uniform1i(P.u('uMode'), 0);
    gl.uniform2f(P.u('uRes'), w, h);
    gl.uniform1f(P.u('uPix'), (2 * TAN_F) / h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, w, h);
    const timed = tq.ext && !tq.q;
    if (timed) {
      tq.q = gl.createQuery();
      gl.beginQuery(tq.ext.TIME_ELAPSED_EXT, tq.q);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (timed) gl.endQuery(tq.ext.TIME_ELAPSED_EXT);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, fbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    gl.blitFramebuffer(0, 0, w, h, 0, 0, cv.width, cv.height, gl.COLOR_BUFFER_BIT, gl.LINEAR);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  // ------------------------------------------------------------ minimap + labels
  const ov = $('ov');
  const ctx = ov.getContext('2d');
  const nativeFillText = ctx.fillText.bind(ctx);
  ctx.fillText = (text, ...args) => nativeFillText(window.tr(String(text)), ...args);
  const mapCache = {};
  function bodyMap(i) {
    if (mapCache[i]) return mapCache[i];
    gl.useProgram(P.p);
    gl.uniform1i(P.u('uMode'), 1);
    gl.uniform1i(P.u('uMapId'), i);
    gl.uniform2f(P.u('uRes'), 512, 256);
    gl.bindFramebuffer(gl.FRAMEBUFFER, mapFbo);
    gl.viewport(0, 0, 512, 256);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const px = new Uint8Array(512 * 256 * 4);
    gl.readPixels(0, 0, 512, 256, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 256;
    const x = c.getContext('2d');
    const img = x.createImageData(512, 256);
    for (let y = 0; y < 256; y++) img.data.set(px.subarray((255 - y) * 2048, (256 - y) * 2048), y * 2048);
    x.putImageData(img, 0, 0);
    mapCache[i] = c;
    return c;
  }
  const galaxy = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 320;
    const x = c.getContext('2d');
    x.fillStyle = '#05070d';
    x.fillRect(0, 0, 320, 320);
    let seed = 20261116;
    const rnd = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const K = 160 / 17; // pixels per kiloparsec
    // Four logarithmic arms from the ends of a central bar. Unobserved far-side structure is extrapolated.
    for (let arm = 0; arm < 4; arm++) {
      for (let n = 0; n < 2600; n++) {
        const t = rnd() * 5.2;
        const r = 3.2 * exp(0.21 * t);
        if (r > 16) continue;
        const a = t + (arm * PI) / 2 + 0.45 + (rnd() - 0.5) * 0.5 * (1 - r / 30);
        const rr = r + (rnd() - 0.5) * 1.1;
        const br = 0.25 + 0.6 * rnd();
        x.fillStyle = rnd() < 0.12 ? `rgba(255,170,190,${br})` : `rgba(190,210,255,${br * (1.1 - r / 18)})`;
        x.fillRect(160 + cos(a) * rr * K, 160 - sin(a) * rr * K, 1.2, 1.2);
      }
    }
    for (let n = 0; n < 2400; n++) {
      const u = (rnd() + rnd() + rnd() - 1.5) * 3.4;
      const v = (rnd() + rnd() + rnd() - 1.5) * 1.3;
      const a = 0.45;
      x.fillStyle = `rgba(255,225,170,${0.3 + 0.5 * rnd()})`;
      x.fillRect(160 + (u * cos(a) - v * sin(a)) * K, 160 - (u * sin(a) + v * cos(a)) * K, 1.3, 1.3);
    }
    const g = x.createRadialGradient(160, 160, 0, 160, 160, 26);
    g.addColorStop(0, 'rgba(255,240,200,.8)');
    g.addColorStop(1, 'rgba(255,240,200,0)');
    x.fillStyle = g;
    x.fillRect(120, 120, 80, 80);
    x.font = '600 10px "Inter","Noto Sans KR",sans-serif';
    x.fillStyle = '#9fb4dd';
    [['페르세우스 팔', 208, 250], ['궁수자리 팔', 186, 205], ['방패–센타우루스 팔', 40, 150], ['직각자자리 팔', 70, 70], ['은하 중심', 168, 150]].forEach(([s, px, py]) => x.fillText(s, px, py));
    // Sun: about 8.2 kpc (26,700 light years) from the centre, on the Orion spur.
    const sy = 160 + 8.2 * K;
    x.strokeStyle = '#ffd24a';
    x.lineWidth = 1.5;
    x.beginPath();
    x.arc(160, sy, 5, 0, 2 * PI);
    x.stroke();
    x.fillStyle = '#ffd24a';
    x.fillRect(159, sy - 1, 2, 2);
    x.fillText('태양계 (오리온 팔)', 170, sy + 4);
    return c;
  })();

  const project = (d) => {
    const z = dot(d, cam.F);
    if (z <= 1e-4) return null;
    const x = dot(d, cam.R) / z / TAN_F;
    const y = dot(d, cam.U) / z / TAN_F;
    const asp = ov.width / ov.height;
    if (abs(x) > asp * 1.05 || abs(y) > 1.05) return null;
    return [(x / asp * 0.5 + 0.5) * ov.width, (0.5 - y * 0.5) * ov.height];
  };
  function hiddenByFocus(d, dist) {
    const F = st.focus;
    const oc = cam.rel[F];
    const tc = dot(oc, d);
    if (tc <= 0 || tc > dist) return false;
    const pp = sub(oc, mul(d, tc));
    const R = B[F].R + min(0, st.altR - 1); // below the datum the horizon sits lower
    return dot(pp, pp) < R * R;
  }
  const starDirs = window.STARS.filter((s) => s[4]).map((s) => [raDec(s[0], s[1]), s[4]]).concat(window.DEEP.map((s) => [raDec(s[0], s[1]), s[2]]));

  function fmtDist(m) {
    const a = abs(m);
    if (a < 1000) return `${m.toFixed(a < 100 ? 1 : 0)} m`;
    if (a < 1e5) return `${(m / 1000).toFixed(2)} km`;
    if (a < 1.5e9) return `${Math.round(m / 1000).toLocaleString('ko-KR')} km`;
    return `${(m / AU).toFixed(a < 1.5e12 ? 3 : 2)} AU`;
  }
  function fmtSpeed(v) {
    if (v < 100) return `${v.toFixed(1)} m/s (${(v * 3.6).toFixed(1)} km/h)`;
    if (v < 1e6) return `${(v / 1000).toFixed(v < 1e4 ? 2 : 1)} km/s`;
    if (v < C_LIGHT) return `${Math.round(v / 1000).toLocaleString('ko-KR')} km/s (광속의 ${((v / C_LIGHT) * 100).toFixed(1)}%)`;
    return `광속의 ${(v / C_LIGHT).toFixed(1)}배`;
  }
  function fmtPressure(p) {
    if (p >= 1e5) return `${(p / 1e5).toFixed(p >= 1e6 ? 1 : 2)} bar`;
    if (p >= 100) return `${(p / 100).toFixed(1)} hPa`;
    if (p >= 0.01) return `${p.toFixed(2)} Pa`;
    return `${p.toExponential(1)} Pa`;
  }

  function drawOverlay() {
    ctx.clearRect(0, 0, ov.width, ov.height);
    const F = st.focus;
    const fb = B[F];
    if (showLabels) {
      ctx.font = '600 12px "Inter","Noto Sans KR",sans-serif';
      ctx.textBaseline = 'middle';
      for (let i = 0; i < NB; i++) {
        const rel = cam.rel[i];
        const dist = len(rel);
        if (i === F && st.altR < 3 * fb.R) continue;
        const d = mul(rel, 1 / dist);
        if (i !== F && hiddenByFocus(d, dist)) continue;
        const p = project(d);
        if (!p) continue;
        const ar = (B[i].R / dist / TAN_F) * 0.5 * ov.height;
        ctx.strokeStyle = 'rgba(255,217,160,.75)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(p[0], p[1], max(6, ar + 4), 0, 2 * PI);
        ctx.stroke();
        ctx.fillStyle = '#ffe6bf';
        ctx.fillText(`${B[i].name}  ${fmtDist(dist - B[i].R)}`, p[0] + max(6, ar + 4) + 5, p[1]);
      }
      const a = fb.atm;
      const dark = a.top <= 0 || st.altR > a.top * 0.6 || st.sunElev < -0.1 || F === 9;
      if (dark && F !== 0) {
        ctx.fillStyle = 'rgba(170,195,255,.8)';
        ctx.font = '500 11px "Inter","Noto Sans KR",sans-serif';
        for (const [d, name] of starDirs) {
          if (hiddenByFocus(d, Infinity)) continue;
          const p = project(d);
          if (p) ctx.fillText(name, p[0] + 7, p[1]);
        }
      }
    }
    if (nav.dest) drawNavMarker();
    if (nav.open) drawNavPanel();
    if (showMap) drawMap();
  }

  function drawNavMarker() {
    const d = nav.dest;
    const b = B[d.i];
    const n = d.n ? toW(d.i, d.n) : norm(sub(st.wp, b.pos));
    const v = sub(add(b.pos, mul(n, b.R + d.h + EYE)), st.wp);
    const dist = len(v);
    const dir = mul(v, 1 / (dist || 1));
    let p = project(dir);
    ctx.strokeStyle = '#6cf0ff';
    ctx.fillStyle = '#6cf0ff';
    ctx.lineWidth = 2;
    ctx.font = '700 13px "Inter","Noto Sans KR",sans-serif';
    ctx.textBaseline = 'middle';
    const label = `${b.name}${d.name ? ' · ' + d.name : ''}  ${fmtDist(dist)}`;
    if (p) {
      ctx.beginPath();
      ctx.moveTo(p[0], p[1] - 11);
      ctx.lineTo(p[0] + 11, p[1]);
      ctx.lineTo(p[0], p[1] + 11);
      ctx.lineTo(p[0] - 11, p[1]);
      ctx.closePath();
      ctx.stroke();
      ctx.fillText(label, p[0] + 17, p[1] - 14);
    } else {
      // off screen: an arrow on the edge pointing toward it
      const a = atan2(-dot(dir, cam.U), dot(dir, cam.R));
      const cx = ov.width / 2;
      const cy = ov.height / 2;
      const rx = cx - 60;
      const ry = cy - 60;
      p = [cx + cos(a) * rx, cy + sin(a) * ry];
      ctx.save();
      ctx.translate(p[0], p[1]);
      ctx.rotate(a);
      ctx.beginPath();
      ctx.moveTo(14, 0);
      ctx.lineTo(-8, -9);
      ctx.lineTo(-8, 9);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      ctx.textAlign = cos(a) > 0 ? 'right' : 'left';
      ctx.fillText(label, p[0] - cos(a) * 20, p[1] - sin(a) * 20 + (sin(a) > 0 ? -16 : 16));
      ctx.textAlign = 'left';
    }
  }
  function drawNavPanel() {
    const rows = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => [B[i].key, i]);
    const x0 = 24;
    const lh = 22;
    const W = 330;
    const H = lh * (rows.length + 4) + 16;
    const y0 = max(300, (ov.height - H) / 2); // stay clear of the HUD text
    ctx.fillStyle = 'rgba(4,6,12,.82)';
    ctx.fillRect(x0, y0, W, H);
    ctx.strokeStyle = 'rgba(108,240,255,.7)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x0 + 0.5, y0 + 0.5, W, H);
    ctx.textBaseline = 'middle';
    ctx.font = '700 14px "Inter","Noto Sans KR",sans-serif';
    ctx.fillStyle = '#6cf0ff';
    ctx.fillText('내비게이션 · 목적지 선택', x0 + 14, y0 + 20);
    ctx.font = '600 13px "Inter","Noto Sans KR",sans-serif';
    rows.forEach(([key, i], r) => {
      const y = y0 + 20 + lh * (r + 1.3);
      const on = nav.dest && nav.dest.i === i;
      ctx.fillStyle = on ? '#6cf0ff' : '#dfe8ff';
      const site = on ? ` → ${nav.dest.name || '가장 가까운 표면'}` : B[i].sites.length ? `  (착륙 지점 ${B[i].sites.length}곳)` : '';
      ctx.fillText(`${on ? '▶' : ' '} [${key}]  ${B[i].name}${site}`, x0 + 14, y);
    });
    ctx.fillStyle = '#9fb4dd';
    const yb = y0 + 20 + lh * (rows.length + 1.6);
    ctx.fillText('같은 키를 다시 누르면 착륙 지점이 바뀝니다', x0 + 14, yb);
    ctx.fillText('W: 목적지로 직진 · X: 해제 · N: 닫기', x0 + 14, yb + lh);
  }

  function drawMap() {
    const F = st.focus;
    const fb = B[F];
    const mode = mapMode === 0 ? (st.altR < 2 * fb.R ? 'body' : 'sys') : mapMode === 1 ? 'sys' : 'gal';
    const pad = 16;
    const W = mode === 'body' ? 320 : 260;
    const H = mode === 'body' ? 160 : 260;
    const x0 = ov.width - W - pad;
    const y0 = ov.height - H - pad - 22;
    ctx.fillStyle = 'rgba(4,6,12,.78)';
    ctx.fillRect(x0 - 6, y0 - 6, W + 12, H + 34);
    ctx.strokeStyle = 'rgba(255,217,160,.6)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x0 - 6.5, y0 - 6.5, W + 13, H + 35);
    ctx.font = '600 12px "Inter","Noto Sans KR",sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffe6bf';
    const head = cam.F;
    if (mode === 'body') {
      ctx.drawImage(bodyMap(F), x0, y0, W, H);
      const camN = norm(pl.frame === F ? pl.pos : toB(F, mul(cam.rel[F], -1)));
      const [lat, lon] = nToLL(camN);
      const mx = x0 + ((lon + 180) / 360) * W;
      const my = y0 + ((90 - lat) / 180) * H;
      const hb = toB(F, head);
      const east = norm(cross([0, 1, 0], camN));
      const north = cross(camN, east);
      const ang = atan2(dot(hb, east), dot(hb, north));
      ctx.save();
      ctx.translate(mx, my);
      ctx.rotate(ang);
      ctx.fillStyle = '#ff4d3d';
      ctx.strokeStyle = '#fff';
      ctx.beginPath();
      ctx.moveTo(0, -9);
      ctx.lineTo(5.5, 6);
      ctx.lineTo(0, 3);
      ctx.lineTo(-5.5, 6);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      ctx.fillStyle = '#ffe6bf';
      ctx.fillText(`${fb.name}  ${abs(lat).toFixed(1)}°${lat >= 0 ? 'N' : 'S'} ${abs(lon).toFixed(1)}°${lon >= 0 ? 'E' : 'W'}`, x0, y0 + H + 14);
    } else if (mode === 'sys') {
      const cx = x0 + W / 2;
      const cy = y0 + H / 2;
      const rp = (d) => ((W / 2 - 8) * log(1 + d / (0.25 * AU))) / log(1 + LIMIT / (0.25 * AU));
      const pt = (p) => {
        const d = Math.hypot(p[0], p[2]);
        const r = rp(d);
        return d < 1 ? [cx, cy] : [cx + (p[0] / d) * r, cy + (p[2] / d) * r];
      };
      ctx.strokeStyle = 'rgba(160,180,220,.28)';
      for (let i = 1; i <= 9; i++) {
        ctx.beginPath();
        ctx.arc(cx, cy, rp(B[i].el[0] * AU), 0, 2 * PI);
        ctx.stroke();
      }
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = 'rgba(255,120,100,.6)';
      ctx.beginPath();
      ctx.arc(cx, cy, rp(LIMIT), 0, 2 * PI);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = '500 10px "Inter","Noto Sans KR",sans-serif';
      for (let i = 0; i < 10; i++) {
        const [px, py] = pt(B[i].pos);
        ctx.fillStyle = `rgb(${B[i].col.map((c) => Math.round(c * 255)).join(',')})`;
        ctx.beginPath();
        ctx.arc(px, py, i === 0 ? 4 : 2.6, 0, 2 * PI);
        ctx.fill();
        ctx.fillStyle = '#c9d6f2';
        ctx.fillText(B[i].name, px + 5, py - 6);
      }
      const [px, py] = pt(st.wp);
      const ang = atan2(head[0], -head[2]);
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(ang);
      ctx.fillStyle = '#ff4d3d';
      ctx.strokeStyle = '#fff';
      ctx.beginPath();
      ctx.moveTo(0, -9);
      ctx.lineTo(5.5, 6);
      ctx.lineTo(0, 3);
      ctx.lineTo(-5.5, 6);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      ctx.font = '600 12px "Inter","Noto Sans KR",sans-serif';
      ctx.fillStyle = '#ffe6bf';
      ctx.fillText(`태양계 (로그 축척) · 태양까지 ${fmtDist(len(st.wp))}`, x0, y0 + H + 14);
    } else {
      ctx.drawImage(galaxy, x0, y0, W, H);
      ctx.fillText('우리은하 · 태양은 중심에서 약 2만 6천 광년', x0, y0 + H + 14);
    }
  }

  function drawHud() {
    const F = st.focus;
    const fb = B[F];
    const info = fb.info;
    const near = st.altR < 5 * fb.R;
    const lines = [];
    if (near) {
      const camN = norm(pl.frame === F ? pl.pos : toB(F, mul(cam.rel[F], -1)));
      const [lat, lon] = nToLL(camN);
      let site = '';
      if (st.altG < 5000) {
        let bd = 0.14;
        for (const [la, lo, name] of fb.sites) {
          const d = len(sub(llToN(la, lo), camN));
          if (d < bd) {
            bd = d;
            site = ` · ${name} 근처`;
          }
        }
      }
      lines.push(`위치  ${fb.name}${site}  (${abs(lat).toFixed(2)}°${lat >= 0 ? 'N' : 'S'} ${abs(lon).toFixed(2)}°${lon >= 0 ? 'E' : 'W'})`);
      lines.push(`고도  지표에서 ${fmtDist(st.altG)}${pl.mode === 'walk' ? ' · 도보' : ' · 비행'}`);
    } else {
      lines.push(`위치  행성 간 공간 · 태양까지 ${fmtDist(len(st.wp))}`);
      lines.push(`가장 가까운 천체  ${fb.name} ${fmtDist(st.altR)}`);
    }
    lines.push(`속도  ${fmtSpeed(st.speed)}${pl.mul !== 1 ? ` · 비행 배율 ×${pl.mul.toFixed(pl.mul < 1 ? 2 : 1)}` : ''}`);
    const dt = new Date(simT);
    const rate = RATES[rateI];
    const rs = rate === 0 ? '정지' : rate === 1 ? '실시간' : rate < 3600 ? `×${rate}` : rate < 86400 ? `1초 = ${rate / 3600}시간` : `1초 = ${rate / 86400}일`;
    lines.push(`시각  ${isNaN(dt) ? '-' : dt.toISOString().slice(0, 19).replace('T', ' ')} UTC · ${rs}`);
    if (near && st.altR < max(fb.atm.top * 12, 0.3 * fb.R)) {
      const km = st.altR / 1000;
      const layer = info.layers.find((l) => km < l[1]);
      lines.push('');
      lines.push(`대기  ${layer ? layer[0] : '행성 간 공간'}`);
      if (info.H > 0) lines.push(`기압  ${fmtPressure(info.p0 * exp(-max(st.altR, 0) / info.H))}  (표면 기준 ${fmtPressure(info.p0)})`);
      else lines.push(`기압  ${fmtPressure(info.p0)}`);
      lines.push(`조성  ${info.comp}`);
      lines.push(`기온  ${info.temp} · 중력 ${fb.g.toFixed(2)} m/s² (지구의 ${(fb.g / 9.81).toFixed(2)}배)`);
      if (info.note && st.altG < 1e5) lines.push(info.note);
    }
    if (nav.dest) {
      const d = nav.dest;
      lines.push('', `목적지  ${B[d.i].name}${d.name ? ' · ' + d.name : ''}  ${fmtDist(len(navVector()))} · W를 누르면 직진`);
    }
    if (warnT > 0) lines.push('', warn);
    if (stats.on) lines.push('', `${stats.fps.toFixed(0)} fps${stats.gpu ? ` · GPU ${stats.gpu.toFixed(1)} ms` : ''} · 해상도 ${Math.round(scale * 100)}% · ${['낮음', '보통', '높음'][qi]}`);
    $('i').textContent = showInfo ? window.tr(lines.join('\n')) : '';
  }

  // ------------------------------------------------------------ sound: wind scaled by air density
  const snd = { ctx: null, gain: null, on: true };
  let musicOn = true;
  try {
    musicOn = localStorage.solarMusic !== '0';
  } catch {
    /* storage unavailable: keep music enabled */
  }
  const music = { gain: null, voices: [], filter: null, chord: 0, note: 0, timers: [] };
  const MUSIC_CHORDS = [
    { root: 45, third: 15 }, // A minor
    { root: 41, third: 16 }, // F major
    { root: 48, third: 16 }, // C major
    { root: 43, third: 14 }, // G suspended
  ];
  const MUSIC_NOTES = [57, 60, 64, 67, 69, 72, 76, 72, 69, 67, 64, 60, 62, 67, 71, 74];
  function midiHz(note) {
    return 440 * pow(2, (note - 69) / 12);
  }
  function playMusicChord(ac) {
    const chord = MUSIC_CHORDS[music.chord++ % MUSIC_CHORDS.length];
    const notes = [chord.root, chord.root + 7, chord.root + 12, chord.root + chord.third, chord.root + 19];
    const t = ac.currentTime;
    music.voices.forEach((o, i) => o.frequency.setTargetAtTime(midiHz(notes[i]), t, 3.5));
  }
  function playMusicNote(ac) {
    const osc = ac.createOscillator();
    const env = ac.createGain();
    const t = ac.currentTime;
    osc.type = 'sine';
    osc.frequency.value = midiHz(MUSIC_NOTES[music.note++ % MUSIC_NOTES.length]);
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(0.018, t + 0.12);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 3.8);
    osc.connect(env).connect(music.filter);
    osc.start(t);
    osc.stop(t + 4);
  }
  function initMusic(ac) {
    const filter = ac.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1700;
    filter.Q.value = 0.35;
    const g = ac.createGain();
    g.gain.value = 0;
    const send = ac.createGain();
    send.gain.value = 0.2;
    const delay = ac.createDelay(2);
    delay.delayTime.value = 0.72;
    const feedback = ac.createGain();
    feedback.gain.value = 0.22;
    const damp = ac.createBiquadFilter();
    damp.type = 'lowpass';
    damp.frequency.value = 1100;
    const wet = ac.createGain();
    wet.gain.value = 0.14;
    filter.connect(g);
    filter.connect(send).connect(delay);
    delay.connect(wet).connect(g);
    delay.connect(feedback).connect(damp).connect(delay);
    g.connect(ac.destination);
    music.filter = filter;
    music.gain = g;
    const notes = [45, 52, 57, 60, 64];
    music.voices = notes.map((note, i) => {
      const osc = ac.createOscillator();
      osc.type = i === 0 ? 'sine' : 'triangle';
      osc.detune.value = (i - 2) * 2;
      osc.frequency.value = midiHz(note);
      osc.connect(filter);
      osc.start();
      return osc;
    });
    music.timers.push(setInterval(() => playMusicChord(ac), 16000));
    music.timers.push(setInterval(() => playMusicNote(ac), 4200));
    playMusicChord(ac);
    playMusicNote(ac);
  }
  function updateMusic() {
    if (!music.gain || !snd.ctx) return;
    music.gain.gain.setTargetAtTime(musicOn && running ? 0.12 : 0, snd.ctx.currentTime, 1.2);
  }
  function initSound() {
    if (snd.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ac = new AC();
    const buf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
    const d = buf.getChannelData(0);
    let v = 0;
    for (let i = 0; i < d.length; i++) {
      v = v * 0.985 + (Math.random() * 2 - 1) * 0.12;
      d[i] = v;
    }
    const src = ac.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 500;
    const g = ac.createGain();
    g.gain.value = 0;
    src.connect(lp).connect(g).connect(ac.destination);
    src.start();
    snd.ctx = ac;
    snd.gain = g;
    initMusic(ac);
    updateMusic();
  }
  function updateSound() {
    if (!snd.gain) return;
    const info = B[st.focus].info;
    const dens = info.H > 0 ? clamp((info.p0 / 101325) * exp(-max(st.altR, 0) / info.H), 0, 3) : 0;
    const target = snd.on && running ? clamp(sqrt(dens) * (0.05 + min(st.speed / 200, 1) * 0.25), 0, 0.4) : 0;
    snd.gain.gain.setTargetAtTime(target, snd.ctx.currentTime, 0.3);
  }

  // ------------------------------------------------------------ loop
  const stats = { on: false, fps: 60, ms: 16, n: 0, gpu: 0 };
  let last = 0;
  let hudT = 0;
  function frame(t) {
    requestAnimationFrame(frame);
    const dt = min((t - last) / 1000, 0.1) || 0;
    last = t;
    if (!running) return;
    timeS += dt;
    step(dt);
    render();
    drawOverlay();
    hudT -= dt;
    if (hudT <= 0) {
      hudT = 0.12;
      drawHud();
      updateSound();
    }
    // adaptive resolution: hold a usable frame rate on slower GPUs
    stats.ms = stats.ms * 0.9 + dt * 100;
    stats.fps = 1000 / stats.ms;
    const top = QUAL[qi].scale;
    if (tq.ext) {
      if (tq.fresh) {
        tq.fresh = false;
        stats.gpu = stats.gpu ? stats.gpu * 0.7 + tq.ms * 0.3 : tq.ms;
        if (stats.gpu > 18) scale = max(0.35, scale * clamp(sqrt(14 / stats.gpu), 0.7, 0.97));
        else if (stats.gpu < 11 && scale < top) scale = min(top, scale * 1.04);
      }
    } else if (++stats.n >= 10) {
      stats.n = 0;
      if (stats.ms > 24) scale = max(0.35, scale * clamp(sqrt(20 / stats.ms), 0.6, 0.95));
      else if (stats.ms < 18 && scale < top) scale = min(top, scale * 1.07);
    }
  }

  // ------------------------------------------------------------ input + menu
  const JUMP = { Digit1: 1, Digit2: 2, Digit3: 3, Digit4: 4, Digit5: 5, Digit6: 6, Digit7: 7, Digit8: 8, Digit9: 9, Digit0: 0, Backquote: 10 };
  function setRunning(on) {
    running = on;
    document.body.className = on ? 'g' : 'm';
    if (!on) {
      for (const k of Object.keys(keys)) keys[k] = false;
      suppressWUntilRelease = false;
      updateSound();
    }
    updateMusic();
  }
  function start() {
    if (!ready) return;
    initSound();
    if (snd.ctx && snd.ctx.state === 'suspended') snd.ctx.resume();
    setRunning(true);
    const r = cv.requestPointerLock && cv.requestPointerLock();
    if (r && r.catch) r.catch(() => 0);
  }
  addEventListener('keydown', (e) => {
    if (!running) {
      if (e.code === 'Enter') start();
      return;
    }
    // Browser shortcuts (Ctrl+R, Cmd+...) are not game input; macOS also drops their keyup.
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.code === 'KeyW' && suppressWUntilRelease) return;
    if (e.code === 'Tab' || e.code === 'Space' || e.code === 'Backquote') e.preventDefault();
    keys[e.code] = true;
    if (e.repeat) return;
    if (e.code === 'KeyN') nav.open = !nav.open;
    else if (nav.open && e.code in JUMP) setDest(JUMP[e.code]);
    else if (nav.open && e.code === 'KeyX') nav.dest = null;
    else if (nav.open && e.code === 'Enter') nav.open = false;
    else if (e.code in JUMP) jumpTo(JUMP[e.code]);
    else if (e.code === 'KeyM') showMap = !showMap;
    else if (e.code === 'KeyB') {
      mapMode = (mapMode + 1) % 3;
      showMap = true;
    } else if (e.code === 'KeyL') showLabels = !showLabels;
    else if (e.code === 'KeyH') {
      // cycle: info -> info + frame stats -> hidden
      if (!showInfo) showInfo = true;
      else if (!stats.on) stats.on = true;
      else {
        showInfo = false;
        stats.on = false;
      }
    } else if (e.code === 'KeyV') snd.on = !snd.on;
    else if (e.code === 'KeyJ') {
      musicOn = !musicOn;
      try {
        localStorage.solarMusic = musicOn ? '1' : '0';
      } catch {
        /* storage unavailable: use the setting for this session */
      }
      updateMusic();
    }
    else if (e.code === 'BracketRight') rateI = min(RATES.length - 1, rateI + 1);
    else if (e.code === 'BracketLeft') rateI = max(0, rateI - 1);
    else if (e.code === 'KeyP') rateI = rateI === 0 ? 1 : 0;
    else if (e.code === 'KeyR') {
      simT = Date.now();
      rateI = 1;
    } else if (e.code === 'KeyG' && pl.frame >= 0) {
      flash();
      landAt(pl.frame, norm(pl.pos), '');
    } else if (e.code === 'Escape') {
      if (document.pointerLockElement) document.exitPointerLock();
      setRunning(false);
    }
  });
  addEventListener('keyup', (e) => {
    keys[e.code] = false;
    if (e.code === 'KeyW') suppressWUntilRelease = false;
  });
  addEventListener('blur', () => {
    for (const k of Object.keys(keys)) keys[k] = false;
    suppressWUntilRelease = false;
  });
  addEventListener('mousemove', (e) => {
    if (running && document.pointerLockElement === cv) {
      mouseX += e.movementX;
      mouseY += e.movementY;
    }
  });
  addEventListener(
    'wheel',
    (e) => {
      if (running) pl.mul = clamp(pl.mul * (e.deltaY < 0 ? 1.25 : 0.8), 0.05, 20);
    },
    { passive: true },
  );
  cv.addEventListener('click', () => {
    if (running && document.pointerLockElement !== cv) start();
  });
  document.addEventListener('pointerlockchange', () => {
    if (!document.pointerLockElement && running) setRunning(false);
  });
  $('d').addEventListener('click', start);
  const qb = [...$('q').querySelectorAll('button')];
  const setQ = (i) => {
    qi = i;
    scale = QUAL[i].scale;
    qb.forEach((b, n) => b.classList.toggle('on', n === i));
    try {
      localStorage.solarDetail = i;
    } catch {
      /* storage unavailable */
    }
  };
  qb.forEach((b, i) => b.addEventListener('click', () => setQ(i)));
  setQ(qi);

  // ------------------------------------------------------------ boot
  const img = new Image();
  img.onerror = () => fail('지구 지도 데이터(earth-data.js)를 읽지 못했습니다.');
  img.onload = () => {
    initGL(img);
    updateBodies(simT);
    const { n, name } = pickSite(3);
    landAt(3, n, name);
    resize();
    document.body.className = 'm';
    ready = true;
    requestAnimationFrame(frame);
    // Draw one frame behind the menu so the start screen shows the landing site.
    step(0);
    render();
  };
  img.src = window.EARTH_PNG;

  // Handle for console tinkering and automated checks.
  window.__sim = { pl, st, B, keys, nav, bake, tq, jumpTo, landAt, llToN, step, render, drawOverlay, drawHud, groundH, setRunning, setQ };
})();
