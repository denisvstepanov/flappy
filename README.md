````markdown
# Flappy (Canvas) — Minimal JavaScript Game

A small Flappy Bird–style game implemented in vanilla JavaScript using the HTML5 Canvas API. Built as a beginner-friendly tutorial project (no game engine, no assets required).

## Play
Once GitHub Pages is enabled for this repository, the game will be available at:

`https://denisvstepanov.github.io/flappy/`

## Controls
- **Space** or **Click/Tap**: start / jump
- **R**: return to start screen
- **M**: mute / unmute sounds
- **C**: clear stored best score (localStorage)

## Features
- HTML5 Canvas rendering
- Simple physics: gravity + jump impulse
- Procedural pipes with collision detection
- Scoring (+1 per pipe passed)
- Difficulty ramp (speed increases gently with score; gap narrows slightly with caps)
- Start screen + game over screen
- Sound effects via Web Audio API (no external files)
- Persistent best score via `localStorage`

## Project structure
This repo is intentionally minimal:

- `index.html` — page + canvas element
- `main.js` — game logic + rendering + sounds

No build step is required.

## Run locally
### Option 1: Open directly
Open `index.html` in a browser.

If your browser restricts storage or audio on `file://`, use Option 2.

### Option 2: Run a local static server
From the repository directory:

**Python**
```bash
python -m http.server 8000
````

Then open `http://localhost:8000`.

**Node (optional)**

```bash
npx serve .
```

## Notes

* Audio playback requires a user gesture in most browsers; the game unlocks audio on the first Space/click.
* Best score is stored in `localStorage` under the key `flappy_best_score_v1`.


