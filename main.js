const canvas = document.getElementById("game");
if (!canvas) throw new Error('Canvas with id="game" not found.');
const ctx = canvas.getContext("2d");

// ----- Constants (tuning knobs) -----
const GRAVITY = 1800;
const JUMP_VELOCITY = -550;
const BIRD_X = 90;
const BIRD_RADIUS = 14;

const PIPE_WIDTH = 70;

// Difficulty ramp (gentle, capped)
const BASE_PIPE_SPEED = 220;
const SPEED_PER_POINT = 6;
const MAX_PIPE_SPEED = 360;

const BASE_PIPE_GAP = 170;
const GAP_SHRINK_PER_POINT = 1.2;
const MIN_PIPE_GAP = 135;

const BASE_SPAWN_EVERY = 1.35;
const MIN_SPAWN_EVERY = 1.10;
const SPAWN_ACCEL_PER_POINT = 0.01;

const PIPE_MARGIN = 80;

const GROUND_HEIGHT = 70;
const FLOOR_Y = canvas.height - GROUND_HEIGHT;

// Visual tweaks
const PIPE_CAP_HEIGHT = 18;
const PIPE_CAP_OVERHANG = 6;

// ----- Persistence -----
const BEST_SCORE_KEY = "flappy_best_score_v1";

function loadBestScore() {
  try {
    const raw = localStorage.getItem(BEST_SCORE_KEY);
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
  } catch {
    return 0;
  }
}

function saveBestScore(value) {
  try {
    localStorage.setItem(BEST_SCORE_KEY, String(value));
  } catch {}
}

// ----- Sound (Web Audio beeps) -----
const Sound = (() => {
  let ctxAudio = null;
  let muted = false;

  function ensureContext() {
    if (!ctxAudio) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      ctxAudio = new AudioCtx();
    }
    return ctxAudio;
  }

  async function unlock() {
    // Must be called from a user gesture (Space/click) in most browsers.
    const ac = ensureContext();
    if (ac.state === "suspended") {
      try {
        await ac.resume();
      } catch {
        // ignore
      }
    }
  }

  function beep({ freq = 440, duration = 0.08, type = "sine", gain = 0.05, ramp = 0.02 }) {
    if (muted) return;
    const ac = ensureContext();
    if (ac.state !== "running") return; // not unlocked yet

    const now = ac.currentTime;

    const osc = ac.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);

    const g = ac.createGain();
    // Simple envelope to avoid clicks: ramp up quickly, then ramp down
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(gain, now + Math.max(0.001, ramp));
    g.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    osc.connect(g);
    g.connect(ac.destination);

    osc.start(now);
    osc.stop(now + duration + 0.01);
  }

  function jump() {
    beep({ freq: 720, duration: 0.07, type: "square", gain: 0.045, ramp: 0.01 });
  }

  function score() {
    beep({ freq: 980, duration: 0.06, type: "sine", gain: 0.05, ramp: 0.01 });
    // small second tone for "ding" feel
    setTimeout(() => beep({ freq: 1220, duration: 0.05, type: "sine", gain: 0.04, ramp: 0.01 }), 35);
  }

  function hit() {
    beep({ freq: 180, duration: 0.12, type: "triangle", gain: 0.08, ramp: 0.01 });
  }

  function toggleMute() {
    muted = !muted;
    return muted;
  }

  function isMuted() {
    return muted;
  }

  return { unlock, jump, score, hit, toggleMute, isMuted };
})();

// ----- Game state -----
const State = {
  START: "START",
  PLAYING: "PLAYING",
  GAME_OVER: "GAME_OVER",
};

let state = State.START;

const bird = {
  y: canvas.height * 0.35,
  vy: 0,
};

let pipes = []; // { x, gapY, scored }
let spawnTimer = 0;

let score = 0;
let bestScore = loadBestScore();

let last = performance.now();

function setBestScore(newValue) {
  if (newValue > bestScore) {
    bestScore = newValue;
    saveBestScore(bestScore);
  }
}

function resetRun() {
  bird.y = canvas.height * 0.35;
  bird.vy = 0;

  pipes = [];
  spawnTimer = 0;

  score = 0;
}

function goToStart() {
  resetRun();
  state = State.START;
}

function startPlaying(withJump = true) {
  resetRun();
  state = State.PLAYING;
  if (withJump) {
    bird.vy = JUMP_VELOCITY;
    Sound.jump();
  }
}

// ----- Input -----
async function onPrimaryAction() {
  await Sound.unlock();

  if (state === State.START) {
    startPlaying(true);
    return;
  }
  if (state === State.GAME_OVER) {
    startPlaying(true);
    return;
  }

  // PLAYING
  bird.vy = JUMP_VELOCITY;
  Sound.jump();
}

window.addEventListener("keydown", (e) => {
  if (e.code === "Space") {
    e.preventDefault();
    onPrimaryAction();
  } else if (e.code === "KeyR") {
    goToStart();
  } else if (e.code === "KeyC") {
    try {
      localStorage.removeItem(BEST_SCORE_KEY);
    } catch {}
    bestScore = 0;
  } else if (e.code === "KeyM") {
    Sound.toggleMute();
  }
});

canvas.addEventListener("pointerdown", () => {
  onPrimaryAction();
});

// ----- Helpers -----
function rand(min, max) {
  return min + Math.random() * (max - min);
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(v, hi));
}

function currentPipeSpeed() {
  return clamp(BASE_PIPE_SPEED + score * SPEED_PER_POINT, BASE_PIPE_SPEED, MAX_PIPE_SPEED);
}

function currentPipeGap() {
  return clamp(BASE_PIPE_GAP - score * GAP_SHRINK_PER_POINT, MIN_PIPE_GAP, BASE_PIPE_GAP);
}

function currentSpawnEvery() {
  return clamp(BASE_SPAWN_EVERY - score * SPAWN_ACCEL_PER_POINT, MIN_SPAWN_EVERY, BASE_SPAWN_EVERY);
}

function circleIntersectsRect(cx, cy, r, rx, ry, rw, rh) {
  const closestX = Math.max(rx, Math.min(cx, rx + rw));
  const closestY = Math.max(ry, Math.min(cy, ry + rh));
  const dx = cx - closestX;
  const dy = cy - closestY;
  return dx * dx + dy * dy <= r * r;
}

// ----- Visual helpers -----
function drawBackground() {
  ctx.fillStyle = "#87CEEB";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.globalAlpha = 0.12;
  ctx.fillStyle = "#ffffff";
  for (let y = 60; y < FLOOR_Y; y += 90) {
    ctx.fillRect(0, y, canvas.width, 18);
  }
  ctx.globalAlpha = 1;
}

function drawGround() {
  ctx.fillStyle = "#D2B48C";
  ctx.fillRect(0, FLOOR_Y, canvas.width, GROUND_HEIGHT);

  ctx.fillStyle = "#3CB371";
  ctx.fillRect(0, FLOOR_Y, canvas.width, 10);

  ctx.globalAlpha = 0.18;
  ctx.fillStyle = "#000000";
  for (let x = 0; x < canvas.width; x += 18) {
    ctx.fillRect(x, FLOOR_Y + 25, 10, 2);
  }
  ctx.globalAlpha = 1;
}

function drawPipePair(p, pipeGap) {
  const gapTop = p.gapY - pipeGap / 2;
  const gapBottom = p.gapY + pipeGap / 2;

  const x = p.x;

  ctx.fillStyle = "#2ecc71";
  ctx.fillRect(x, 0, PIPE_WIDTH, gapTop);
  ctx.fillRect(x, gapBottom, PIPE_WIDTH, FLOOR_Y - gapBottom);

  ctx.fillStyle = "#27ae60";
  const capW = PIPE_WIDTH + PIPE_CAP_OVERHANG * 2;
  const capX = x - PIPE_CAP_OVERHANG;

  const topCapY = Math.max(0, gapTop - PIPE_CAP_HEIGHT);
  ctx.fillRect(capX, topCapY, capW, PIPE_CAP_HEIGHT);
  ctx.fillRect(capX, gapBottom, capW, PIPE_CAP_HEIGHT);

  ctx.globalAlpha = 0.12;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(x + 10, 0, 8, gapTop);
  ctx.fillRect(x + 10, gapBottom, 8, FLOOR_Y - gapBottom);
  ctx.globalAlpha = 1;
}

function drawBird() {
  const x = BIRD_X;
  const y = bird.y;

  ctx.fillStyle = "#FFD54F";
  ctx.beginPath();
  ctx.arc(x, y, BIRD_RADIUS, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "#F4B400";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(x - 3, y + 2, 8, Math.PI * 0.2, Math.PI * 1.1);
  ctx.stroke();

  ctx.fillStyle = "#000000";
  ctx.beginPath();
  ctx.arc(x + 5, y - 4, 2.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#FF8C00";
  ctx.beginPath();
  ctx.moveTo(x + BIRD_RADIUS - 1, y);
  ctx.lineTo(x + BIRD_RADIUS + 10, y - 4);
  ctx.lineTo(x + BIRD_RADIUS + 10, y + 4);
  ctx.closePath();
  ctx.fill();
}

function drawHUD(pipeSpeed, pipeGap) {
  ctx.fillStyle = "#000000";

  ctx.font = "22px system-ui";
  ctx.fillText(String(score), 12, 32);

  ctx.font = "12px system-ui";
  ctx.fillText(`speed: ${Math.round(pipeSpeed)}  gap: ${Math.round(pipeGap)}`, 12, 52);

  ctx.font = "14px system-ui";
  ctx.fillText("Space/click: action  |  R: start  |  M: mute  |  C: clear best", 10, canvas.height - 12);

  ctx.font = "14px system-ui";
  ctx.fillText(`Best: ${bestScore}`, canvas.width - 90, 22);

  if (Sound.isMuted()) {
    ctx.font = "12px system-ui";
    ctx.fillText("MUTED", canvas.width - 70, 42);
  }
}

function drawStartScreen() {
  ctx.fillStyle = "#000000";
  ctx.font = "28px system-ui";
  ctx.fillText("FLAPPY", 130, 240);

  ctx.font = "16px system-ui";
  ctx.fillText("Press Space or click to start", 80, 280);

  ctx.font = "14px system-ui";
  ctx.fillText(`Best: ${bestScore}`, 150, 310);

  ctx.font = "12px system-ui";
  ctx.fillText("Tip: press M to mute", 122, 335);
}

function drawGameOver() {
  ctx.fillStyle = "#000000";
  ctx.font = "30px system-ui";
  ctx.fillText("GAME OVER", 88, 260);

  ctx.font = "16px system-ui";
  ctx.fillText(`Score: ${score}`, 135, 295);
  ctx.fillText(`Best: ${bestScore}`, 136, 318);

  ctx.font = "14px system-ui";
  ctx.fillText("Press Space/click to restart", 95, 350);
  ctx.fillText("Press R for start screen", 115, 372);
}

// ----- Update + render -----
function update(dt) {
  if (state !== State.PLAYING) return;

  const pipeSpeed = currentPipeSpeed();
  const pipeGap = currentPipeGap();
  const spawnEvery = currentSpawnEvery();

  // bird physics
  bird.vy += GRAVITY * dt;
  bird.y += bird.vy * dt;

  const top = BIRD_RADIUS;
  const bottom = FLOOR_Y - BIRD_RADIUS;

  if (bird.y < top) {
    bird.y = top;
    bird.vy = 0;
  }
  if (bird.y >= bottom) {
    bird.y = bottom;
    bird.vy = 0;
    state = State.GAME_OVER;
    setBestScore(score);
    Sound.hit();
    return;
  }

  // spawn pipes
  spawnTimer += dt;
  if (spawnTimer >= spawnEvery) {
    spawnTimer = 0;

    const minGapY = PIPE_MARGIN + pipeGap / 2;
    const maxGapY = FLOOR_Y - PIPE_MARGIN - pipeGap / 2;

    pipes.push({
      x: canvas.width + PIPE_WIDTH,
      gapY: rand(minGapY, maxGapY),
      scored: false,
    });
  }

  // move pipes
  for (const p of pipes) {
    p.x -= pipeSpeed * dt;
  }
  pipes = pipes.filter((p) => p.x + PIPE_WIDTH > 0);

  // scoring
  for (const p of pipes) {
    if (!p.scored && p.x + PIPE_WIDTH < BIRD_X) {
      p.scored = true;
      score += 1;
      setBestScore(score);
      Sound.score();
    }
  }

  // collision
  const birdX = BIRD_X;
  const birdY = bird.y;

  for (const p of pipes) {
    const gapTop = p.gapY - pipeGap / 2;
    const gapBottom = p.gapY + pipeGap / 2;

    const hitTop = circleIntersectsRect(birdX, birdY, BIRD_RADIUS, p.x, 0, PIPE_WIDTH, gapTop);
    const hitBottom = circleIntersectsRect(
      birdX,
      birdY,
      BIRD_RADIUS,
      p.x,
      gapBottom,
      PIPE_WIDTH,
      FLOOR_Y - gapBottom
    );

    if (hitTop || hitBottom) {
      state = State.GAME_OVER;
      bird.vy = 0;
      setBestScore(score);
      Sound.hit();
      break;
    }
  }
}

function render() {
  const pipeSpeed = currentPipeSpeed();
  const pipeGap = currentPipeGap();

  drawBackground();

  if (state !== State.START) {
    for (const p of pipes) drawPipePair(p, pipeGap);
  }

  drawGround();
  drawBird();
  drawHUD(pipeSpeed, pipeGap);

  if (state === State.START) drawStartScreen();
  else if (state === State.GAME_OVER) drawGameOver();
}

function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  update(dt);
  render();

  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
