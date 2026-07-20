// ---------------------------------------------------------------------------
// crumple.js — v3
//
// You called it — v2's "scrub a pre-rendered video" theory was a weaker
// guess. This version is genuinely live: no video, no pre-baked frames.
//
// What's actually happening:
//  1. Your uploaded image is mapped as a texture onto a real 3D mesh — a
//     plane subdivided into a grid of triangles (this triangulation is
//     exactly what gives "low-poly origami" its faceted look).
//  2. MediaPipe tracks your thumb tip (#4) and ring fingertip (#16) live.
//  3. Every single frame, we recompute the position of every vertex in that
//     mesh: pulling them inward toward the center and displacing them with
//     noise, both scaled directly by how close your fingers are.
//  4. Three.js's flat-shaded material + a real directional light renders the
//     result — the faceted, catches-the-light look comes from actual WebGL
//     lighting on actual folded geometry, not a filter or a video.
//
// This is closer to what "use mediapipe + Claude + vercel" really implies:
// a mesh deformation problem, not a video player.
// ---------------------------------------------------------------------------

import {
  HandLandmarker,
  FilesetResolver,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";

import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";

// ---- DOM refs ---------------------------------------------------------
const webcamVideo = document.getElementById("webcam");
const overlay = document.getElementById("overlay");
const overlayCtx = overlay.getContext("2d");
const camStatus = document.getElementById("camStatus");
const imgInput = document.getElementById("imgInput");
const crumpleBar = document.getElementById("crumpleBar");
const glCanvas = document.getElementById("glCanvas");
const wrap = document.querySelector(".portrait-wrap");

// ===========================================================================
// PART A — the live mesh (Three.js)
// ===========================================================================

const SEGMENTS_X = 56;
const SEGMENTS_Y = 64;

let renderer, scene, camera, mesh, geometry, material;
let flatPositions = null;   // Float32Array — the resting (flat) vertex positions
let crumpleOffsets = null;  // per-vertex precomputed pull/noise direction, reused every frame
let currentCrumple = 0;     // smoothed 0..1 value driving the deformation

function initThree() {
  renderer = new THREE.WebGLRenderer({ canvas: glCanvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
  camera.position.set(0, 0, 6);

  // Lighting deliberately mimics a single dramatic key light, like the
  // reference video's black-background studio look, so facets read clearly.
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(2, 3, 4);
  scene.add(key);

  const fill = new THREE.DirectionalLight(0x88aaff, 0.4);
  fill.position.set(-3, -1, 2);
  scene.add(fill);

  scene.add(new THREE.AmbientLight(0xffffff, 0.25));

  resizeRenderer();
  window.addEventListener("resize", resizeRenderer);
}

function resizeRenderer() {
  const w = wrap.clientWidth, h = wrap.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

// Builds (or rebuilds, when a new image is uploaded) the mesh + its
// precomputed per-vertex crumple targets.
function buildMeshFromTexture(texture) {
  if (mesh) {
    scene.remove(mesh);
    geometry.dispose();
    material.dispose();
  }

  const img = texture.image;
  const aspect = img.width / img.height;
  const planeW = aspect >= 1 ? 3.2 : 3.2 * aspect;
  const planeH = aspect >= 1 ? 3.2 / aspect : 3.2;

  geometry = new THREE.PlaneGeometry(planeW, planeH, SEGMENTS_X, SEGMENTS_Y);

  material = new THREE.MeshStandardMaterial({
    map: texture,
    transparent: true,
    alphaTest: 0.35,
    side: THREE.DoubleSide,
    flatShading: true,
    roughness: 0.65,
    metalness: 0.08,
  });

  mesh = new THREE.Mesh(geometry, material);
  scene.add(mesh);

  const posAttr = geometry.attributes.position;
  flatPositions = Float32Array.from(posAttr.array);

  // Precompute, once per vertex, a random-but-stable "crumple direction" —
  // this is what makes the fold pattern look organic instead of a uniform
  // wave, and it's recomputed only when a new image loads, not every frame.
  const count = posAttr.count;
  crumpleOffsets = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const x = flatPositions[i * 3];
    const y = flatPositions[i * 3 + 1];
    const n1 = noise2D(x * 1.8, y * 1.8);
    const n2 = noise2D(x * 4.1 + 50, y * 4.1 + 50);
    const n3 = noise2D(x * 0.6 + 100, y * 0.6 + 100);
    crumpleOffsets[i * 3] = n2 * 0.35;              // in-plane x wrinkle
    crumpleOffsets[i * 3 + 1] = n3 * 0.35;           // in-plane y wrinkle
    crumpleOffsets[i * 3 + 2] = (n1 * 0.6 + n2 * 0.4); // out-of-plane fold depth
  }

  applyCrumpleToMesh(currentCrumple);
}

// Deforms the mesh for a given crumple amount (0 = flat, 1 = fully balled up).
function applyCrumpleToMesh(t) {
  if (!mesh) return;
  const posAttr = geometry.attributes.position;
  const arr = posAttr.array;
  const count = posAttr.count;

  // Inward pull: as t increases, every vertex moves toward the center,
  // shrinking the plane's footprint like paper being scrunched into a ball.
  const pull = t * 0.72;
  // Fold depth: how far vertices push out of plane along noise-driven axes.
  const fold = t * 1.15;

  for (let i = 0; i < count; i++) {
    const fx = flatPositions[i * 3];
    const fy = flatPositions[i * 3 + 1];
    const fz = flatPositions[i * 3 + 2];

    const ox = crumpleOffsets[i * 3];
    const oy = crumpleOffsets[i * 3 + 1];
    const oz = crumpleOffsets[i * 3 + 2];

    arr[i * 3]     = fx * (1 - pull) + ox * fold;
    arr[i * 3 + 1] = fy * (1 - pull) + oy * fold;
    arr[i * 3 + 2] = fz + oz * fold * 1.4;
  }

  posAttr.needsUpdate = true;
  geometry.computeVertexNormals();

  // A little tumble as it balls up sells the physicality.
  mesh.rotation.y = t * 0.9;
  mesh.rotation.x = t * 0.35;
}

function renderThree() {
  renderer.render(scene, camera);
}

// ---- minimal 2D value-noise (self-contained, no dependency) --------------
const PERM = (() => {
  const p = new Uint8Array(512);
  const base = new Uint8Array(256).map((_, i) => i);
  // deterministic shuffle so results are stable across reloads
  let seed = 1337;
  for (let i = 255; i > 0; i--) {
    seed = (seed * 16807) % 2147483647;
    const j = seed % (i + 1);
    [base[i], base[j]] = [base[j], base[i]];
  }
  for (let i = 0; i < 512; i++) p[i] = base[i & 255];
  return p;
})();

function fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
function grad(hash, x, y) {
  const h = hash & 7;
  const u = h < 4 ? x : y;
  const v = h < 4 ? y : x;
  return ((h & 1) ? -u : u) + ((h & 2) ? -2 * v : 2 * v);
}
function noise2D(x, y) {
  const X = Math.floor(x) & 255, Y = Math.floor(y) & 255;
  x -= Math.floor(x); y -= Math.floor(y);
  const u = fade(x), v = fade(y);
  const aa = PERM[X + PERM[Y]], ab = PERM[X + PERM[Y + 1]];
  const ba = PERM[X + 1 + PERM[Y]], bb = PERM[X + 1 + PERM[Y + 1]];
  const x1 = lerp(grad(aa, x, y), grad(ba, x - 1, y), u);
  const x2 = lerp(grad(ab, x, y - 1), grad(bb, x - 1, y - 1), u);
  return lerp(x1, x2, v) * 0.5;
}

// ---- placeholder texture (drawn on a canvas, no external file needed) ----
function makePlaceholderTexture() {
  const c = document.createElement("canvas");
  c.width = 480; c.height = 600;
  const ctx = c.getContext("2d");
  ctx.clearRect(0, 0, c.width, c.height);
  const grad1 = ctx.createLinearGradient(0, 0, 0, c.height);
  grad1.addColorStop(0, "#d8c3a5");
  grad1.addColorStop(1, "#8a7052");
  ctx.fillStyle = grad1;
  ctx.beginPath();
  ctx.ellipse(240, 220, 130, 160, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#2a2118";
  ctx.beginPath(); ctx.ellipse(205, 205, 9, 12, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(275, 205, 9, 12, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "#2a2118";
  ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(210, 265); ctx.quadraticCurveTo(240, 282, 270, 265); ctx.stroke();
  ctx.fillStyle = "#3a3a3a99";
  ctx.font = "14px monospace";
  ctx.textAlign = "center";
  ctx.fillText("upload your cutout photo ↓", 240, 560);
  const tex = new THREE.CanvasTexture(c);
  tex.image = c; // ensure width/height are readable for aspect calc
  return tex;
}

function loadImageAsTexture(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const loader = new THREE.TextureLoader();
    loader.load(url, (tex) => resolve(tex));
  });
}

imgInput.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  const tex = await loadImageAsTexture(file);
  buildMeshFromTexture(tex);
});

// ===========================================================================
// PART B — hand tracking (MediaPipe), same core logic as before
// ===========================================================================

const THUMB_TIP = 4;
const RING_TIP = 16;
const WRIST = 0;
const MIDDLE_MCP = 9;

const HAND_CONNECTIONS = [
  [0,1],[1,2],[2,3],[3,4],
  [0,5],[5,6],[6,7],[7,8],
  [0,9],[9,10],[10,11],[11,12],
  [0,13],[13,14],[14,15],[15,16],
  [0,17],[17,18],[18,19],[19,20],
  [5,9],[9,13],[13,17],
];

const NEAR_RATIO = 0.35;
const FAR_RATIO  = 1.3;
const SMOOTHING  = 0.18;

let handLandmarker;

async function setupHandLandmarker() {
  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
  );
  handLandmarker = await HandLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
      delegate: "GPU",
    },
    runningMode: "VIDEO",
    numHands: 1,
  });
}

async function setupCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: 640, height: 480, facingMode: "user" },
    audio: false,
  });
  webcamVideo.srcObject = stream;
  return new Promise((resolve) => {
    webcamVideo.onloadedmetadata = () => {
      webcamVideo.play();
      overlay.width = webcamVideo.videoWidth;
      overlay.height = webcamVideo.videoHeight;
      resolve();
    };
  });
}

function dist(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y, dz = (a.z ?? 0) - (b.z ?? 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
function clamp01(v) { return Math.max(0, Math.min(1, v)); }
function lerp(a, b, t) { return a + (b - a) * t; }

function distanceToCrumple(normalizedDist) {
  const t = (normalizedDist - NEAR_RATIO) / (FAR_RATIO - NEAR_RATIO);
  return clamp01(1 - t);
}

function drawSkeleton(landmarks) {
  overlayCtx.clearRect(0, 0, overlay.width, overlay.height);
  if (!landmarks) return;
  const w = overlay.width, h = overlay.height;

  overlayCtx.strokeStyle = "rgba(201,163,90,0.9)";
  overlayCtx.lineWidth = 2;
  for (const [a, b] of HAND_CONNECTIONS) {
    const p1 = landmarks[a], p2 = landmarks[b];
    overlayCtx.beginPath();
    overlayCtx.moveTo(p1.x * w, p1.y * h);
    overlayCtx.lineTo(p2.x * w, p2.y * h);
    overlayCtx.stroke();
  }
  overlayCtx.fillStyle = "#f2f0ea";
  for (const p of landmarks) {
    overlayCtx.beginPath();
    overlayCtx.arc(p.x * w, p.y * h, 2.5, 0, Math.PI * 2);
    overlayCtx.fill();
  }
  overlayCtx.fillStyle = "#c9a35a";
  for (const idx of [THUMB_TIP, RING_TIP]) {
    const p = landmarks[idx];
    overlayCtx.beginPath();
    overlayCtx.arc(p.x * w, p.y * h, 5, 0, Math.PI * 2);
    overlayCtx.fill();
  }
}

let lastVideoTime = -1;

function renderLoop() {
  if (handLandmarker && webcamVideo.currentTime !== lastVideoTime) {
    lastVideoTime = webcamVideo.currentTime;
    const result = handLandmarker.detectForVideo(webcamVideo, performance.now());

    if (result.landmarks && result.landmarks.length > 0) {
      const lm = result.landmarks[0];
      const handScale = dist(lm[WRIST], lm[MIDDLE_MCP]) || 0.0001;
      const rawDist = dist(lm[THUMB_TIP], lm[RING_TIP]) / handScale;
      const target = distanceToCrumple(rawDist);
      currentCrumple = lerp(currentCrumple, target, SMOOTHING);
      drawSkeleton(lm);
      camStatus.textContent = "hand detected";
    } else {
      currentCrumple = lerp(currentCrumple, 0, SMOOTHING * 0.5);
      drawSkeleton(null);
      camStatus.textContent = "show your hand";
    }

    crumpleBar.style.width = `${Math.round(currentCrumple * 100)}%`;
    applyCrumpleToMesh(currentCrumple);
  }

  renderThree();
  requestAnimationFrame(renderLoop);
}

// ===========================================================================
// boot
// ===========================================================================
(async function init() {
  try {
    initThree();
    buildMeshFromTexture(makePlaceholderTexture());

    camStatus.textContent = "loading model…";
    await setupHandLandmarker();
    camStatus.textContent = "requesting camera…";
    await setupCamera();
    camStatus.textContent = "show your hand";
    renderLoop();
  } catch (err) {
    console.error(err);
    camStatus.textContent = "camera/model failed — check console";
  }
})();
