# Crumple — live hand-tracked paper mesh

Pinch your thumb and ring finger together in front of your webcam, and an
origami-style image of you folds and crumples into a ball — live, no
pre-rendered video.

## Version history / why this looks the way it does

- **v1** faked the crumple with a CSS/SVG distortion filter on a circle-cropped
  image. Looked nothing like real paper.
- **v2** guessed the original used a pre-rendered AI video, scrubbed by hand
  position. Better shape, but still not "live."
- **v3 (this version)** is a genuinely live 3D mesh deformation: your image is
  mapped onto a triangulated plane in WebGL (via Three.js), and every frame
  we directly recompute where each triangle's corners sit based on your hand.
  The faceted, light-catching look comes from real-time lighting on real
  folded geometry — the same reason actual folded paper looks the way it
  does.

## What you need to provide

Just **one image** — ideally a cutout with a transparent background so only
your figure/portrait shows (no background rectangle). Generate one for free
with Bing Image Creator or Google Gemini using a prompt like:

> "Transform this photo into a low-poly origami paper sculpture, faceted
> triangular surfaces, full figure, transparent background, natural
> silhouette, no crop, dramatic single-light studio lighting"

If your tool can't output transparency, a plain black background also reads
fine against this page's black stage.

Upload it via the button under the mesh — no code changes needed.

## How the deformation works

- The image sits on a `PlaneGeometry` subdivided into a 56×64 grid of
  triangles — that grid *is* the "low-poly facets."
- For every vertex, we precompute a stable pseudo-random "crumple direction"
  once (using a small built-in noise function), so the fold pattern looks
  organic instead of a uniform ripple.
- Every animation frame, each vertex's position is recomputed as a blend of:
  - **inward pull** — vertices move toward the center, shrinking the plane's
    footprint like paper being scrunched inward
  - **fold displacement** — vertices push out of plane along their
    precomputed noise direction
  - both scaled directly by your live pinch amount (0 = flat, 1 = fully
    balled up)
- `MeshStandardMaterial` with `flatShading: true` plus a directional key
  light is what turns that folded geometry into the faceted, shiny-paper
  look — this is real WebGL lighting, not an image effect.
- Hand tracking itself is unchanged from before: MediaPipe's `HandLandmarker`
  tracks landmark `4` (thumb tip) and `16` (ring fingertip) from your webcam,
  and the normalized distance between them drives the crumple amount.

## Run it locally

```bash
python3 -m http.server 8000
```
Open `http://localhost:8000`, allow camera access.

## Deploy to Vercel

Same as before — push to GitHub, import into Vercel, framework preset
"Other," deploy. No build step.

## Tuning the feel

In `script.js`:

- `SEGMENTS_X` / `SEGMENTS_Y` — mesh resolution. Higher = smoother folds but
  more GPU work.
- `pull` and `fold` inside `applyCrumpleToMesh()` — how far vertices move
  inward vs. how deep the folds push, at full crumple (t = 1).
- `NEAR_RATIO` / `FAR_RATIO` — how close your fingers need to be to register
  as fully crumpled vs. fully flat.
- `SMOOTHING` — reactivity vs. smoothness of the tracking.

## Honest caveat

This is a believable *approximation* of paper crumpling (inward pull + noise
folding), not a true physics cloth/paper simulation with self-collision. It
will look convincing but won't perfectly replicate real paper mechanics —
getting closer would mean a proper mass-spring or position-based-dynamics
simulation, which is a meaningfully bigger project if you want to push
further.
