// Optional CRT look (Settings > CRT: off / subtle / strong), a post-process over the 2D game canvas.
// When on, a WebGL canvas sits exactly on top of #game (pointer-events: none, so input still lands on
// #game) and every frame the 2D canvas is uploaded as a texture and drawn through a fragment shader:
// barrel curvature, scanlines, aperture mask, soft bloom, vignette, slight chromatic aberration and a
// faint flicker. Without WebGL a pre-rendered 2D overlay adds just scanlines + a vignette.
// When off nothing exists or runs: no overlay, frame() returns at once, map() is never applied.

const PRESETS = {
  // curve: barrel amount, scan/mask: darkening, bloom: glow added, vig: vignette power, ca: RGB split in CSS px
  subtle: { curve: 0.022, scan: 0.22, mask: 0.05, bloom: 0.20, vig: 0.14, ca: 0.35, flick: 0.004, warm: 0.015 },
  strong: { curve: 0.055, scan: 0.5, mask: 0.11, bloom: 0.3, vig: 0.2, ca: 0.9, flick: 0.01, warm: 0.03 },
};
const BG = [8 / 255, 9 / 255, 13 / 255]; // page background (index.html) for the area outside the curved glass
const MAX_DPR = 2, MAX_W = 2880; // backing-store cap: crisp scanlines/mask without a 4K fragment bill

const VS = `attribute vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }`;
const FS = `precision mediump float;
uniform sampler2D tex;
uniform vec2 res, texSize;
uniform float curve, scan, maskK, bloom, vig, ca, flick, warm, time;
uniform vec3 bg;
vec2 distort(vec2 q) { vec2 c = q * 2.0 - 1.0; c *= 1.0 + curve * c.yx * c.yx; return c * 0.5 + 0.5; }
// "sharp bilinear": nearest-looking texels, but antialiased where the curvature lands between them
vec3 px(vec2 uv) {
  vec2 sc = max(res / texSize, vec2(1.0));
  vec2 t = uv * texSize, fl = floor(t), d = t - fl - 0.5, r = 0.5 - 0.5 / sc;
  return texture2D(tex, (fl + 0.5 + (d - clamp(d, -r, r)) * sc) / texSize).rgb;
}
void main() {
  vec2 q = vec2(gl_FragCoord.x / res.x, 1.0 - gl_FragCoord.y / res.y);
  vec2 uv = distort(q);
  // rounded, antialiased edge of the glass
  vec2 e = min(uv, 1.0 - uv) * res;
  float rad = 0.012 * res.y * (curve > 0.0 ? 1.0 : 0.0);
  vec2 k = max(vec2(rad) - e, 0.0);
  // the rounded-corner term only applies with curvature: with rad = 0 it would be 0.5 everywhere and blend the whole
  // picture halfway into the background (CRT CURVE OFF looked darker and lost its glow)
  float edge = clamp(min(e.x, e.y) + 0.5, 0.0, 1.0);
  if (rad > 0.0) edge = min(edge, clamp(rad - length(k) + 0.5, 0.0, 1.0));
  if (edge <= 0.0) { gl_FragColor = vec4(bg, 1.0); return; }
  // chromatic aberration: red and blue pulled apart a little, more toward the sides
  vec2 c = uv * 2.0 - 1.0;
  float off = ca * (0.35 + 0.65 * abs(c.x)) / res.x;
  vec3 col = vec3(px(uv + vec2(off, 0.0)).r, px(uv).g, px(uv - vec2(off, 0.0)).b);
  // soft bloom: a ring of linear taps a few texels wide, squared so mostly the bright bits glow
  vec3 b = vec3(0.0);
  vec2 o = 1.6 / texSize, o2 = 3.2 / texSize;
  b += texture2D(tex, uv + vec2(o.x, 0.0)).rgb + texture2D(tex, uv - vec2(o.x, 0.0)).rgb;
  b += texture2D(tex, uv + vec2(0.0, o.y)).rgb + texture2D(tex, uv - vec2(0.0, o.y)).rgb;
  b += texture2D(tex, uv + o2 * vec2(0.7, 0.7)).rgb + texture2D(tex, uv - o2 * vec2(0.7, 0.7)).rgb;
  b += texture2D(tex, uv + o2 * vec2(0.7, -0.7)).rgb + texture2D(tex, uv - o2 * vec2(0.7, -0.7)).rgb;
  b /= 8.0;
  // scanlines: one per game row, box-filtered over the output pixel so they fade out (no moire)
  // when the screen is too small to show them
  float w = texSize.y / res.y;
  float sinc = w >= 1.0 ? 0.0 : sin(3.14159 * w) / (3.14159 * w);
  float f = fract(uv.y * texSize.y);
  float lum = dot(col, vec3(0.3, 0.55, 0.15));
  float sl = 1.0 - scan * (1.0 - 0.45 * lum) * (0.5 - 0.5 * cos(6.28318 * (f - 0.25)) * sinc);
  col *= sl / (1.0 - scan * 0.5 * (1.0 - 0.45 * lum) * 0.85);
  // aperture grille at the display resolution
  float m = mod(floor(gl_FragCoord.x), 3.0);
  vec3 mk = vec3(m < 0.5 ? 1.0 : 1.0 - maskK, m > 0.5 && m < 1.5 ? 1.0 : 1.0 - maskK, m > 1.5 ? 1.0 : 1.0 - maskK);
  col *= mk / (1.0 - maskK * 0.667);
  col += bloom * b * b;
  // warm tint, vignette, flicker
  col *= vec3(1.0 + warm, 1.0 + warm * 0.3, 1.0 - warm);
  float v = clamp(uv.x * uv.y * (1.0 - uv.x) * (1.0 - uv.y) * 16.0, 0.0, 1.0);
  col *= pow(v, vig);
  col *= 1.0 + flick * sin(time * 47.0) * sin(time * 13.0) + flick * 0.6 * sin((uv.y - time * 0.12) * 6.28318);
  gl_FragColor = vec4(mix(bg, clamp(col, 0.0, 1.0), edge), 1.0);
}`;

export const CRT = {
  mode: 'off', on: false, curveOn: true,
  src: null, el: null, gl: null, prog: null, tex: null, u: null, fallback: false,
  rect: { left: 0, top: 0, width: 0, height: 0 },

  init(canvas) { this.src = canvas; },

  // 'off' | 'subtle' | 'strong'; anything else reads as off (old saves have no key).
  set(mode) {
    mode = PRESETS[mode] ? mode : 'off';
    this.mode = mode;
    this.on = mode !== 'off' && !!this.src;
    if (!this.on) { if (this.el) this.el.style.display = 'none'; return; }
    if (!this.el) this.create();
    this.el.style.display = 'block';
    this.resize();
    this.frame();
  },

  // Settings > CURVE: the curved glass (barrel distortion + rounded corners) on or off; off = a flat screen.
  setCurve(on) { this.curveOn = on !== false; if (this.on) this.frame(); },
  curve() { return this.curveOn ? PRESETS[this.mode].curve : 0; },

  create() {
    const mk = () => {
      const el = this.el = document.createElement('canvas');
      el.id = 'crt';
      el.setAttribute('aria-hidden', 'true');
      Object.assign(el.style, { position: 'absolute', pointerEvents: 'none', imageRendering: 'auto', zIndex: '1', left: '0', top: '0' });
      this.src.after(el);
      return el;
    };
    const el = mk();
    el.addEventListener('webglcontextlost', e => { e.preventDefault(); this.gl = null; });
    el.addEventListener('webglcontextrestored', () => { this.setupGL(); this.frame(); });
    // no WebGL (or the shader failed): a fresh canvas for the 2D overlay
    if (!this.setupGL()) { el.remove(); this.fallback = true; mk(); }
  },

  setupGL() {
    if (this.fallback) return false;
    const gl = this.el.getContext('webgl', { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: false });
    if (!gl) return false;
    const sh = (type, src) => {
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    try {
      const prog = gl.createProgram();
      gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
      gl.useProgram(prog);
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW); // one big triangle
      const loc = gl.getAttribLocation(prog, 'p');
      gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      // LINEAR so the bloom taps blur for free; the main image is kept crisp by px() in the shader
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      const u = {};
      for (const n of ['tex', 'res', 'texSize', 'curve', 'scan', 'maskK', 'bloom', 'vig', 'ca', 'flick', 'warm', 'time', 'bg']) u[n] = gl.getUniformLocation(prog, n);
      gl.uniform1i(u.tex, 0);
      Object.assign(this, { gl, prog, tex, u });
      return true;
    } catch (e) {
      console.warn('CRT: WebGL setup failed, using the 2D overlay', e);
      return false;
    }
  },

  // Follow #game's on-screen box (core.js calls this after it re-sizes the canvas; frame() re-checks).
  resize() {
    if (!this.on || !this.el) return;
    const r = this.src.getBoundingClientRect();
    if (!r.width || !r.height) return;
    this.rect = { left: r.left, top: r.top, width: r.width, height: r.height };
    const st = this.el.style;
    st.left = r.left + window.scrollX + 'px'; st.top = r.top + window.scrollY + 'px';
    st.width = r.width + 'px'; st.height = r.height + 'px';
    const k = Math.min(window.devicePixelRatio || 1, MAX_DPR, MAX_W / r.width);
    const bw = Math.max(1, Math.round(r.width * k)), bh = Math.max(1, Math.round(r.height * k));
    if (this.el.width !== bw || this.el.height !== bh || (this.fallback && this._fbMode !== this.mode)) {
      this.el.width = bw; this.el.height = bh;
      if (this.fallback) this.drawFallback();
    }
  },

  // Per-frame hook, after the game frame is drawn. Off (or the 2D fallback, which is static): returns at once.
  frame() {
    if (!this.on || this.fallback) return;
    const gl = this.gl;
    if (!gl) return;
    const r = this.src.getBoundingClientRect();
    if (r.left !== this.rect.left || r.top !== this.rect.top || r.width !== this.rect.width || r.height !== this.rect.height) this.resize();
    const P = PRESETS[this.mode], u = this.u;
    gl.viewport(0, 0, this.el.width, this.el.height);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, this.src);
    gl.uniform2f(u.res, this.el.width, this.el.height);
    gl.uniform2f(u.texSize, this.src.width, this.src.height);
    gl.uniform1f(u.curve, this.curve()); gl.uniform1f(u.scan, P.scan); gl.uniform1f(u.maskK, P.mask);
    gl.uniform1f(u.bloom, P.bloom); gl.uniform1f(u.vig, P.vig); gl.uniform1f(u.ca, P.ca * this.el.width / Math.max(1, this.rect.width));
    gl.uniform1f(u.flick, P.flick); gl.uniform1f(u.warm, P.warm); gl.uniform1f(u.time, performance.now() / 1000 % 1000);
    gl.uniform3f(u.bg, BG[0], BG[1], BG[2]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  },

  // No WebGL: a static transparent overlay with scanlines (one per game row) and a vignette.
  drawFallback() {
    const P = PRESETS[this.mode], el = this.el, ctx = el.getContext('2d');
    if (!ctx) return;
    this._fbMode = this.mode;
    ctx.clearRect(0, 0, el.width, el.height);
    const rows = this.src.height, rowH = el.height / rows;
    if (rowH >= 2) {
      ctx.fillStyle = `rgba(0,0,0,${P.scan * 0.8})`;
      for (let i = 0; i < rows; i++) ctx.fillRect(0, Math.round((i + 0.5) * rowH), el.width, Math.max(1, Math.round(rowH / 2)));
    }
    const g = ctx.createRadialGradient(el.width / 2, el.height / 2, el.height * 0.35, el.width / 2, el.height / 2, Math.hypot(el.width, el.height) / 2);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(0,0,0,${P.vig * 2})`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, el.width, el.height);
  },

  // Screen -> game pixel under the curvature, the same function as distort() in the shader, so a click
  // lands on the game pixel drawn under it. x, y and the result are game coordinates (0..w, 0..h).
  map(x, y, w, h) {
    if (!this.on || this.fallback || !this.gl) return [x, y];
    const k = this.curve();
    if (!k) return [x, y];
    const cx = x / w * 2 - 1, cy = y / h * 2 - 1;
    return [(cx * (1 + k * cy * cy) + 1) / 2 * w, (cy * (1 + k * cx * cx) + 1) / 2 * h];
  },
};
