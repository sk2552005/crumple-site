# Crumple — hand-tracked paper effect

A recreation of the "MediaPipe + Claude + Vercel" effect from the TikTok:
pinch your thumb and ring finger together in front of your webcam, and the
portrait on screen crumples like paper, live, in the browser. No AI image/video
generation is required to make the *interactive* part work — that's pure
webcam + MediaPipe + an SVG filter.

## How it works (short version)

- `HandLandmarker` from MediaPipe's `tasks-vision` package tracks 21 points
  per hand from your webcam feed, entirely client-side, for free.
- Every frame, we measure the distance between landmark `4` (thumb tip) and
  landmark `16` (ring fingertip) — "1st and 4th finger," per the original
  video's own caption.
- That distance (normalized by hand size, so it doesn't matter how close you
  are to the camera) is mapped to a 0→1 "crumple amount."
- The crumple amount drives an SVG `feTurbulence` + `feDisplacementMap`
  filter applied to the portrait image — this is what actually produces the
  crumpled-paper distortion, live, on whatever image is loaded.

## Run it locally

You need a local server (browsers block camera access on `file://` URLs).
From this folder:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000` and allow camera access.

(Any static server works — `npx serve`, VS Code's Live Server extension, etc.)

## Use your own photo

Click "upload your own photo" in the page — no need to touch the code. If you
want a specific *starting* look (e.g. the origami-style portrait from the
video), generate that image first with a free tool like Bing Image Creator
or Google Gemini, then upload it here.

## Deploy to Vercel (free)

1. Push this folder to a GitHub repo.
2. Go to vercel.com → "Add New Project" → import the repo.
3. Framework preset: "Other" (it's static HTML/CSS/JS, no build step needed).
4. Deploy. Done — you'll get a live URL you can embed or link from your site.

## Tuning the feel

Open `script.js` and adjust the constants near the top:

- `NEAR_RATIO` / `FAR_RATIO` — how close your fingers need to be to register
  as "touching" vs "open." Lower `NEAR_RATIO` = fingers must fully touch.
- `SMOOTHING` — higher = the effect reacts faster but looks jittery; lower =
  smoother but laggier.
- `MAX_TURBULENCE` / `MAX_DISPLACEMENT` — how extreme the crumple distortion
  gets at full pinch.

## Next steps if you want to go further

- Swap the SVG filter for a real WebGL cloth/paper simulation (three.js) for
  a more physically convincing crumple.
- Track more gestures (e.g. a slow open→uncrumple animation, a full fist
  bump/crush moment) using the other landmarks.
- Replace the static placeholder with the origami-style AI image from
  Step 1 of the plan for the exact look from the original video.
