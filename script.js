// ---------------------------------------------------------------------------
// crumple.js
//
// What this does, end to end:
//  1. Turns on your webcam.
//  2. Runs MediaPipe's HandLandmarker (free, runs locally in the browser,
//     no API key, no server round-trip) on each video frame.
//  3. Finds two landmarks: the thumb tip (#4) and the ring fingertip (#16) —
//     "1st and 4th finger", same logic as the original TikTok.
//  4. Measures the distance between them, normalized by the size of the
//     hand in frame (so it works whether your hand is close or far away).
//  5. Turns that into a 0→1 "crumple amount": fingers apart = 0 (flat),
//     fingers touching = 1 (fully crumpled).
//  6. Drives an SVG feTurbulence/feDisplacementMap filter on the portrait
//     image with that value, which produces a live "crumpling paper" look
//     on ANY image you give it — no pre-rendered crumpled photo needed.
// ---------------------------------------------------------------------------

import {
  HandLandmarker,
  FilesetResolver,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";

// ---- DOM refs ---------------------------------------------------------
const video = document.getElementById("webcam");
const overlay = document.getElementById("overlay");
const overlayCtx = overlay.getContext("2d");
const camStatus = document.getElementById("camStatus");
const portrait = document.getElementById("portrait");
const turb = document.getElementById("turb");
const disp = document.getElementById("disp");
const crumpleBar = document.getElementById("crumpleBar");
const fileInput = document.getElementById("fileInput");

// ---- Let the user swap in their own photo ------------------------------
fileInput.addEventListener("change", (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  const url = URL.createObjectURL(file);
  portrait.src = url;
});

// ---- Landmark indices (MediaPipe hand model, 21 points per hand) -------
const THUMB_TIP = 4;
const RING_TIP = 16;
const WRIST = 0;
const MIDDLE_MCP = 9; // used as a stable "hand size" reference

// Hand connections, just for drawing the little skeleton in the PiP
const HAND_CONNECTIONS = [
  [0,1],[1,2],[2,3],[3,4],
  [0,5],[5,6],[6,7],[7,8],
  [0,9],[9,10],[10,11],[11,12],
  [0,13],[13,14],[14,15],[15,16],
  [0,17],[17,18],[18,19],[19,20],
  [5,9],[9,13],[13,17],
];

// ---- Tunables — adjust these to change how sensitive the pinch is ------
const NEAR_RATIO = 0.35;  // normalized distance at/below which = fully crumpled
const FAR_RATIO  = 1.3;   // normalized distance at/above which = fully flat
const SMOOTHING  = 0.25;  // 0-1, higher = snappier, lower = smoother/laggier
const MAX_TURBULENCE = 0.045; // how noisy the paper texture gets at full crumple
const MAX_DISPLACEMENT = 55;  // how much the image warps at full crumple

let smoothedCrumple = 0;
let handLandmarker;

// ---- 1. Load the MediaPipe model ---------------------------------------
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

// ---- 2. Turn on the webcam ----------------------------------------------
async function setupCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: 640, height: 480, facingMode: "user" },
    audio: false,
  });
  video.srcObject = stream;
  return new Promise((resolve) => {
    video.onloadedmetadata = () => {
      video.play();
      overlay.width = video.videoWidth;
      overlay.height = video.videoHeight;
      resolve();
    };
  });
}

// ---- helpers --------------------------------------------------------------
function dist(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y, dz = (a.z ?? 0) - (b.z ?? 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

// Map a normalized thumb-to-ring distance into a 0..1 crumple amount
function distanceToCrumple(normalizedDist) {
  const t = (normalizedDist - NEAR_RATIO) / (FAR_RATIO - NEAR_RATIO);
  return clamp01(1 - t); // close = 1 (crumpled), far = 0 (flat)
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

  // highlight the two landmarks that actually drive the effect
  overlayCtx.fillStyle = "#c9a35a";
  for (const idx of [THUMB_TIP, RING_TIP]) {
    const p = landmarks[idx];
    overlayCtx.beginPath();
    overlayCtx.arc(p.x * w, p.y * h, 5, 0, Math.PI * 2);
    overlayCtx.fill();
  }
}

// ---- 3. Per-frame loop ---------------------------------------------------
let lastVideoTime = -1;

function renderLoop() {
  if (handLandmarker && video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    const result = handLandmarker.detectForVideo(video, performance.now());

    if (result.landmarks && result.landmarks.length > 0) {
      const lm = result.landmarks[0];
      const handScale = dist(lm[WRIST], lm[MIDDLE_MCP]) || 0.0001;
      const rawDist = dist(lm[THUMB_TIP], lm[RING_TIP]) / handScale;
      const targetCrumple = distanceToCrumple(rawDist);

      smoothedCrumple = lerp(smoothedCrumple, targetCrumple, SMOOTHING);
      drawSkeleton(lm);
      camStatus.textContent = "hand detected";
    } else {
      // no hand in frame — drift back to flat
      smoothedCrumple = lerp(smoothedCrumple, 0, SMOOTHING * 0.5);
      drawSkeleton(null);
      camStatus.textContent = "show your hand";
    }

    applyCrumple(smoothedCrumple);
  }

  requestAnimationFrame(renderLoop);
}

// ---- 4. Apply the crumple amount to the SVG filter + UI -----------------
function applyCrumple(amount) {
  turb.setAttribute("baseFrequency", (amount * MAX_TURBULENCE).toFixed(4));
  disp.setAttribute("scale", (amount * MAX_DISPLACEMENT).toFixed(1));
  portrait.style.filter = `url(#crumple-filter) grayscale(${amount * 0.3}) brightness(${1 - amount * 0.25})`;
  portrait.style.transform = `scale(${1 - amount * 0.12})`;
  crumpleBar.style.width = `${Math.round(amount * 100)}%`;
}

// ---- boot -----------------------------------------------------------------
(async function init() {
  try {
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
