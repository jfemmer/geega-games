// Surge foil renderer — one shared WebGL context for every surge foil card.
//
// A real surge foil is a holographic metallic layer covered in irregular,
// diagonal, flowing bands: thin bright silver streaks, broader soft ones and
// darker troughs between them, with iridescent color that shifts with the
// viewing angle. CSS gradients can only draw straight, evenly spaced stripes,
// so the effect is a fragment shader: diagonal sine bands, warped by smooth
// noise at several scales, lit by a "light" whose position follows the
// (simulated or pointer-driven) tilt of the card.
//
// Browsers allow only a handful of WebGL contexts per page, and the shop grid
// can show dozens of surge cards. So there is ONE small offscreen WebGL
// canvas: each frame it renders every visible card in turn (each with its own
// seed and tilt) and copies the result into that card's own 2D canvas.
//
// The output is meant for `mix-blend-mode: hard-light` over the card picture:
// mid-gray (0.5) is "no change", lighter values brighten like light on foil,
// darker values darken a little (the troughs between bands). So the artwork
// stays exactly as printed wherever the foil isn't catching the light.
//
// Nothing here runs on the server or in tests: `isSurgeFoilSupported()` is
// false without WebGL, and callers then keep the CSS fallback.

export interface SurgeFoilInstance {
  /** The card's own canvas (2D) the frame is copied into. */
  canvas: HTMLCanvasElement;
  /** Per-card variation so neighbouring cards don't shimmer in lockstep. */
  seed: number;
  /** Where the pointer wants the tilt (-1…1 each axis); 0,0 when idle. */
  targetTilt: { x: number; y: number };
  /** Smoothed tilt actually rendered. */
  tilt: { x: number; y: number };
  /** Whether the card is on screen (only visible cards are rendered). */
  visible: boolean;
  /** Called every rendered frame with the smoothed tilt (for the 3D tilt). */
  onFrame?: (tilt: { x: number; y: number }) => void;
}

/** Render size of the shared canvas. Cards are ~200px wide in the grid. */
const RENDER_W = 200;
const RENDER_H = 279; // 488:680

const VERTEX_SHADER = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER = `
precision mediump float;
varying vec2 v_uv;
uniform float u_time;
uniform vec2 u_tilt;
uniform float u_seed;
uniform float u_strength;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 4; i++) {
    v += amp * noise(p);
    p = p * 2.03 + vec2(17.1, 9.2);
    amp *= 0.5;
  }
  return v;
}

void main() {
  // Card space, corrected to the card's 488:680 shape; y runs top to bottom.
  vec2 p = vec2(v_uv.x * 0.718, 1.0 - v_uv.y);
  vec2 s = vec2(u_seed * 13.7, u_seed * 7.3);

  // The light's travel: a slow idle drift plus the card's tilt.
  float phase = u_time * 0.045 + u_tilt.x * 0.32 + u_tilt.y * 0.22;

  // Organic warp: large slow ripples and finer distortion, so the bands
  // curve and wobble like reflections on an uneven foil, not ruled lines.
  float warp = (fbm(p * 2.6 + s) - 0.5) * 0.42
             + (fbm(p * 7.5 + s + 3.1) - 0.5) * 0.07;

  // Predominantly diagonal: bands run from upper left toward lower right.
  float d = dot(p, normalize(vec2(1.0, -0.82))) + warp;

  // Three band scales: thin bright streaks, finer hairlines, broad soft
  // sheets. Their different frequencies and speeds keep the pattern from
  // visibly repeating.
  float b1 = sin(d * 27.0 - phase * 6.2832 * 1.0 + s.x);
  float b2 = sin(d * 63.0 - phase * 6.2832 * 1.6 + 1.3 + s.y);
  float b3 = sin(d * 10.0 - phase * 6.2832 * 0.55 + 2.1);

  float streaks = pow(max(b1, 0.0), 9.0);
  float hairlines = pow(max(b2, 0.0), 22.0) * 0.65;
  float sheets = smoothstep(0.15, 1.0, b3) * 0.42;

  // Different regions catch the light at different moments.
  float catchLight = 0.35 + 0.65 * smoothstep(
    0.2, 0.85,
    0.5 + 0.5 * sin(fbm(p * 1.6 + s + 7.0) * 6.2832 + phase * 6.2832 * 0.8)
  );

  float refl = (streaks + hairlines + sheets) * catchLight;

  // Darker foil between the bands, for depth.
  float trough = smoothstep(0.25, 1.0, -b3) * (1.0 - streaks) * 0.55;

  // Iridescence: metallic silver first, a gentle spectral tint second, its
  // hue shifting along the bands and with the viewing angle.
  float hue = d * 1.6 + warp * 2.2 + phase * 0.9 + u_tilt.x * 0.25 - u_tilt.y * 0.15;
  vec3 spectral = 0.5 + 0.5 * cos(6.2832 * (hue + vec3(0.0, 0.33, 0.67)));
  vec3 silver = vec3(0.93, 0.95, 0.98);
  vec3 tint = mix(silver, spectral, 0.42);
  // The brightest highlights go nearly white, as metal does.
  tint = mix(tint, vec3(1.0), smoothstep(0.75, 1.25, refl));

  // Hard-light encoding: 0.5 = untouched artwork.
  vec3 col = mix(vec3(0.5), tint, clamp(refl, 0.0, 1.0));
  col -= vec3(trough * 0.12);

  gl_FragColor = vec4(col * u_strength, u_strength);
}
`;

interface Renderer {
  gl: WebGLRenderingContext;
  glCanvas: HTMLCanvasElement;
  uTime: WebGLUniformLocation | null;
  uTilt: WebGLUniformLocation | null;
  uSeed: WebGLUniformLocation | null;
  uStrength: WebGLUniformLocation | null;
}

let renderer: Renderer | null = null;
let failed = false;
const instances = new Set<SurgeFoilInstance>();
let rafId: number | null = null;
let lastFrame = 0;
const start = typeof performance !== "undefined" ? performance.now() : 0;

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function coarsePointer(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    && window.matchMedia("(pointer: coarse)").matches;
}

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.warn("[surgeFoil] shader compile failed", gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function createRenderer(): Renderer | null {
  const glCanvas = document.createElement("canvas");
  glCanvas.width = RENDER_W;
  glCanvas.height = RENDER_H;
  const gl = glCanvas.getContext("webgl", {
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    preserveDrawingBuffer: true,
    powerPreference: "low-power",
  });
  if (!gl) return null;

  const vs = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  if (!vs || !fs) return null;
  const program = gl.createProgram();
  if (!program) return null;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.warn("[surgeFoil] program link failed", gl.getProgramInfoLog(program));
    return null;
  }
  gl.useProgram(program);

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(program, "a_pos");
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
  gl.viewport(0, 0, RENDER_W, RENDER_H);

  glCanvas.addEventListener("webglcontextlost", (e) => {
    e.preventDefault();
    renderer = null; // re-created on the next frame that needs it
  });

  return {
    gl,
    glCanvas,
    uTime: gl.getUniformLocation(program, "u_time"),
    uTilt: gl.getUniformLocation(program, "u_tilt"),
    uSeed: gl.getUniformLocation(program, "u_seed"),
    uStrength: gl.getUniformLocation(program, "u_strength"),
  };
}

function ensureRenderer(): Renderer | null {
  if (renderer) return renderer;
  if (failed) return null;
  try {
    renderer = createRenderer();
  } catch {
    renderer = null;
  }
  if (!renderer) failed = true;
  return renderer;
}

/** True when this browser can draw the shader (else keep the CSS shimmer). */
export function isSurgeFoilSupported(): boolean {
  if (typeof window === "undefined" || typeof document === "undefined") return false;
  if (typeof WebGLRenderingContext === "undefined") return false;
  return ensureRenderer() !== null;
}

function drawInstance(r: Renderer, inst: SurgeFoilInstance, timeSeconds: number): void {
  const ctx = inst.canvas.getContext("2d");
  if (!ctx) return;
  const { gl } = r;
  gl.uniform1f(r.uTime, timeSeconds);
  gl.uniform2f(r.uTilt, inst.tilt.x, inst.tilt.y);
  gl.uniform1f(r.uSeed, inst.seed);
  gl.uniform1f(r.uStrength, 0.9);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  ctx.clearRect(0, 0, inst.canvas.width, inst.canvas.height);
  ctx.drawImage(r.glCanvas, 0, 0, inst.canvas.width, inst.canvas.height);
}

function frame(now: number): void {
  rafId = null;
  const r = ensureRenderer();
  if (!r) return;

  // Phones: 30 fps is plenty for a slow shimmer and saves battery.
  const minGap = coarsePointer() ? 1000 / 30 : 0;
  if (now - lastFrame >= minGap) {
    lastFrame = now;
    const t = (now - start) / 1000;
    for (const inst of instances) {
      if (!inst.visible) continue;
      // Smooth interpolation toward where the pointer wants the tilt.
      inst.tilt.x += (inst.targetTilt.x - inst.tilt.x) * 0.08;
      inst.tilt.y += (inst.targetTilt.y - inst.tilt.y) * 0.08;
      drawInstance(r, inst, t);
      inst.onFrame?.(inst.tilt);
    }
  }
  schedule();
}

function schedule(): void {
  if (rafId != null) return;
  if (prefersReducedMotion()) return;
  for (const inst of instances) {
    if (inst.visible) {
      rafId = requestAnimationFrame(frame);
      return;
    }
  }
}

/** Draw one still frame (reduced motion, or right after mounting). */
export function renderSurgeFoilOnce(inst: SurgeFoilInstance): void {
  const r = ensureRenderer();
  if (!r) return;
  drawInstance(r, inst, 12 + inst.seed * 40);
}

export function registerSurgeFoil(inst: SurgeFoilInstance): () => void {
  instances.add(inst);
  renderSurgeFoilOnce(inst);
  schedule();
  return () => {
    instances.delete(inst);
  };
}

/** Tell the loop a card's visibility (or pointer) changed. */
export function wakeSurgeFoil(): void {
  schedule();
}

export const surgeFoilMotionReduced = prefersReducedMotion;
