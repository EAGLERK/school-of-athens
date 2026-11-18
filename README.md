# The School of Athens · The Death of Socrates

A one-page scroll film. `site/` is the deployable static site; `build/` regenerates everything in it from the two source paintings.

## Run it

```bash
cd build && npm install && npm run serve    # http://localhost:8123
```

Any static host works. Serve `.bin` files as-is (no transcoding).

### Vercel

`vercel.json` serves `site/` directly: no install, no build. Import the repo at vercel.com/new (framework preset "Other", leave every setting as is) and each push to `main` redeploys. Film, textures, audio and fonts are cached for a day at the edge, then revalidated; `index.html` and `js/app.min.js` are not cached, so a new deploy shows up straight away. Run `npm run bundle` and commit `site/js/app.min.js` after changing the JS: Vercel does not build it.

## Quality

Seven levels, picked from the GPU, pointer type and memory, then stepped down live if frames drop under ~38 fps. Pin a level with `?q=0` (everything) to `?q=6` (bare). Portrait phones always get the 720×1280 film; levels 0–2 get the 1080p film, 3–6 the 720p one.

| q | pixel ratio | sun shadows | floor mirror | lamp shadow | film |
|---|---|---|---|---|---|
| 0 | 2 | 4096 | full res | yes | 1080p |
| 1 | 2 | 2048 | 0.75 | yes | 1080p |
| 2 | 1.5 | 2048 | 0.5 | no | 1080p |
| 3 | 1.25 | 1024 | 0.5 | no | 720p |
| 4 | 1 | 1024 | 0.35 | no | 720p |
| 5 | 1 | 512 | off | no | 720p |
| 6 | 0.75 | off | off | no | 720p |

## Rebuild

```bash
cd build
npm run assets   # textures, fresco lunette mask, card images, ambient loops
npm run film     # cuts the crowd layer, renders 540 frames × 3 tiers (~4 min on 4 cores), packs them
npm run bundle   # js/main.js + three.js -> js/app.min.js
```

Sources in `build/source/`: `athens.jpg` (Wikimedia Commons, 3820×2964) and `socrates.jpg` (Wikimedia Commons thumbnail of the Met's Open Access scan, 3840×2522). Both are public domain.

## The walk past Plato and Aristotle

From frame 72 the fresco is rendered as two layers (`build/layers.py` writes `source/fg.png` and `source/bg.png`). The near layer is everything below the skyline of heads: Plato and Aristotle are traced by hand, the rest of the top-step crowd is found by GrabCut seeded from those traces, and three small carve-outs fix leaks around Plato's hand and Aristotle's hair. The far layer is the hall with the crowd removed; the hole is filled with the architecture just above the heads, carried down to the eye line, and the landing's floor colour below it. While you walk, the crowd scales about the vanishing point as a near plane and the hall as a plane three times farther away, so the figures part and pass instead of stretching.

## How the seams work

Each film frame is a virtual camera over a painting: centre `(cx, cy)` and visible height `H` in source pixels (`build/film.py`). The first frame (`1915, 1658, 1367`) and the last (`1920, 1261, 2160`) are copied into `FIRST` / `LAST` in `site/js/main.js`. The page places the 3D camera so the wall shows exactly that crop under the same cover-fit as the film canvas, so the switch between 3D and film is pixel-identical. If you change the keyframes, change both files.
