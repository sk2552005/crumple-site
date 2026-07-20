// ---------------------------------------------------------------------------
// Pastilak — Squeeze & Spill
//
// Press-and-hold the bottle. While held, gummies spawn from the bottle neck
// and get fired outward with random impulses. Matter.js (2D rigid-body
// physics) handles gravity, bouncing, rolling, and collisions between
// gummies — this is real physics, not a canned sprite animation.
// ---------------------------------------------------------------------------

const { Engine, Runner, Bodies, Body, World, Events } = Matter;

const canvas = document.getElementById("physicsCanvas");
const ctx = canvas.getContext("2d");
const bottleBtn = document.getElementById("bottleBtn");
const bottleImg = document.getElementById("bottleImg");
const resetBtn = document.getElementById("resetBtn");
const countEl = document.getElementById("count");

const GUMMY_DISPLAY_SIZE = 42; // px diameter on screen
const MAX_GUMMIES = 140;       // hard cap so it never tanks perf
const SPAWN_INTERVAL_MS = 90;  // how often a new gummy spawns while held

let spilledCount = 0;
let spawnTimer = null;
let isSqueezing = false;

// ---- canvas sizing ---------------------------------------------------
function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
resizeCanvas();
window.addEventListener("resize", resizeCanvas);

// ---- physics world -----------------------------------------------------
const engine = Engine.create();
engine.gravity.y = 1.1;
const world = engine.world;

const wallOptions = { isStatic: true, restitution: 0.35, friction: 0.6 };

let ground, leftWall, rightWall;
function buildBounds() {
  if (ground) World.remove(world, [ground, leftWall, rightWall]);
  const w = window.innerWidth, h = window.innerHeight;
  ground = Bodies.rectangle(w / 2, h + 30, w * 2, 60, wallOptions);
  leftWall = Bodies.rectangle(-30, h / 2, 60, h * 2, wallOptions);
  rightWall = Bodies.rectangle(w + 30, h / 2, 60, h * 2, wallOptions);
  World.add(world, [ground, leftWall, rightWall]);
}
buildBounds();
window.addEventListener("resize", buildBounds);

const runner = Runner.create();
Runner.run(runner, engine);

// ---- gummy sprite ------------------------------------------------------
const gummySprite = new Image();
gummySprite.src = "assets/gummy.png";

let gummyBodies = []; // { body, scale, tint }

function neckPosition() {
  const rect = bottleImg.getBoundingClientRect();
  return {
    x: rect.left + rect.width * 0.5,
    y: rect.top + rect.height * 0.12, // near the cap/neck
  };
}

function spawnGummy() {
  if (gummyBodies.length >= MAX_GUMMIES) {
    // recycle the oldest one instead of growing forever
    const oldest = gummyBodies.shift();
    World.remove(world, oldest.body);
  }

  const { x, y } = neckPosition();
  const radius = GUMMY_DISPLAY_SIZE / 2;
  const body = Bodies.circle(x, y, radius * 0.85, {
    restitution: 0.5 + Math.random() * 0.25, // slight per-gummy variation
    friction: 0.3,
    frictionAir: 0.008,
    density: 0.0018,
  });

  // Explosion impulse: mostly upward/outward in a cone, some randomness
  const angle = (-Math.PI / 2) + (Math.random() - 0.5) * 1.6; // cone around "up"
  const speed = 6 + Math.random() * 7;
  Body.setVelocity(body, { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed });
  Body.setAngularVelocity(body, (Math.random() - 0.5) * 0.5);

  World.add(world, body);
  gummyBodies.push({ body, scale: 0.85 + Math.random() * 0.3 });

  spilledCount++;
  countEl.textContent = spilledCount;
}

// ---- squeeze interaction -------------------------------------------------
function startSqueeze(e) {
  e.preventDefault();
  if (isSqueezing) return;
  isSqueezing = true;
  bottleBtn.classList.add("squeezing");
  spawnGummy(); // immediate first gummy so it feels responsive
  spawnTimer = setInterval(spawnGummy, SPAWN_INTERVAL_MS);
}

function stopSqueeze() {
  if (!isSqueezing) return;
  isSqueezing = false;
  bottleBtn.classList.remove("squeezing");
  clearInterval(spawnTimer);
  spawnTimer = null;
}

bottleBtn.addEventListener("mousedown", startSqueeze);
bottleBtn.addEventListener("touchstart", startSqueeze, { passive: false });
window.addEventListener("mouseup", stopSqueeze);
window.addEventListener("touchend", stopSqueeze);
window.addEventListener("touchcancel", stopSqueeze);

resetBtn.addEventListener("click", () => {
  for (const g of gummyBodies) World.remove(world, g.body);
  gummyBodies = [];
});

// ---- render loop ---------------------------------------------------------
function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (gummySprite.complete && gummySprite.naturalWidth > 0) {
    const aspect = gummySprite.naturalWidth / gummySprite.naturalHeight;
    for (const g of gummyBodies) {
      const { position, angle } = g.body;
      const w = GUMMY_DISPLAY_SIZE * g.scale;
      const h = w / aspect;
      ctx.save();
      ctx.translate(position.x, position.y);
      ctx.rotate(angle);
      ctx.drawImage(gummySprite, -w / 2, -h / 2, w, h);
      ctx.restore();
    }
  }

  requestAnimationFrame(render);
}
render();
