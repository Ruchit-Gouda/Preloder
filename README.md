# Logo Assembly Preloader

A cinematic, brand-intro preloader: your logo starts as scattered pieces and
assembles itself over **5 seconds** using **React + GSAP + SVG**.

No raster images, no spinner, no scroll gimmicks — just independent SVG paths
flying into place.

---

## Your logo, already split

Your `logo.svg` (the Potrace vector of the mark, `viewBox="0 0 2893 2662"`) has
been split into **9 independent vector pieces** by
`scripts/split-logo-svg.mjs`, and wired into `src/data/logoParts.js`.

The split is **exact, not a re-trace**: the script reads your path data,
flattens the curves, applies your `scale(0.1,-0.1)` transform, and clips the
outline along the artwork's own structure — not an arbitrary grid. The cuts
follow the logo:

- **`part-sail-1…4`** — the curved upper mass, fanned into 4 radial wedges from
  the corner where its straight edges meet.
- **`part-band-1…5`** — the lower diagonal band, sliced into 5 segments
  perpendicular to its measured principal axis.

The horizontal seam at `y ≈ 0.691·height` is an edge that already exists in the
artwork. Every cut is a plane through one convex region, so the pieces partition
the artwork exactly: shared edges, no gaps, no overlaps.

Verified in a real browser by rasterising the assembled pieces and comparing to
your source SVG:

| Metric | Result |
|---|---|
| IoU vs `logo.svg` | **0.99935** |
| Logo coverage | **99.962%** |
| Missing pixels | 0.038% |
| Extra pixels | 0.027% |

The tiny residuals are sub-pixel edge anti-aliasing, not gaps or overlaps.

`public/logo-reference.svg` is the assembled artwork (all 9 pieces) — open it
in a browser to eyeball the result. It's a verification artifact, not used by
the app; delete it if you like.

---

## Visual design

- **Background:** solid premium purple `#6C35D4` — no gradients, borders, cards,
  or decoration.
- **Logo:** pure white `#FFFFFF`, every piece included, for strong contrast.
- **No clipping:** the pieces are plain `<path>` elements. There is no
  `clipPath`, no `mask`, no image cropping, and no clip-based reveal anywhere —
  the geometric cut happens offline in the build script, and only GSAP
  `transform`/`opacity` drives the animation at runtime.
- **Verified in-browser:** `backgroundColor: rgb(108, 53, 212)`,
  `backgroundImage: none`, piece `fill: rgb(255, 255, 255)`, and **0**
  clip-path / mask / gradient elements.

---

## Quick start

```bash
npm install
npm run dev      # opens http://localhost:5173
npm run build    # production build
```

---

## Project structure

```
logo.svg                    ← your source vector (input to the splitter)
scripts/
  split-logo-svg.mjs        ← splits logo.svg into pieces (no dependencies)
src/
  components/
    Preloader.jsx           overlay: hosts the animation, fades out when done
    LogoAnimation.jsx       owns the <svg> + the GSAP timeline
    LogoParts.jsx           pure renderer: LOGO_PARTS -> <g class="logo-part">
  data/
    logoParts.js            ← GENERATED pieces (paths + viewBox)
    animationConfig.js      ← ALL TIMING / MOTION TUNING LIVES HERE
  styles/
    preloader.css           responsive styling + per-piece transform origins
tools/
  svg-splitter.html         interactive browser splitter (no install)
public/
  logo-reference.svg        the assembled pieces (verification only)
```

**Separation of concerns:** shapes are data (`logoParts.js`), timing is data
(`animationConfig.js`), rendering is `LogoParts.jsx`, motion is
`LogoAnimation.jsx`.

---

## Re-splitting along the logo's features

```bash
npm run logo:split          # node scripts/split-logo-svg.mjs
```

Edit the `FEATURES` block at the top of `scripts/split-logo-svg.mjs`:

```js
const SRC = 'logo.svg';     // any vector SVG
const FEATURES = {
  seamY: 0.6913,            // horizontal seam, as a fraction of artwork height
  sailCornerX: 0.459,       // fan origin, as a fraction of artwork width
  sailSlices: 4,            // radial wedges in the upper "sail"
  bandSegments: 5,          // slices across the lower diagonal band
};
const FLATTEN_TOL = 1;      // curve flattening tolerance (source units)
const MIN_AREA = 120;       // drop slivers smaller than this
```

- **More pieces?** Raise `sailSlices` / `bandSegments`. More pieces = more
  staggered, puzzle-like assembly. Lower `stagger.assemble` if you add many.
- **Fewer, chunkier pieces?** `sailSlices: 2`, `bandSegments: 3`.
- **Different logo?** Measure its own features first — where the two masses
  meet horizontally (`seamY`) and where the upper mass's straight edges meet
  (`sailCornerX`). The band axis is measured automatically from the geometry,
  so it need not be 45°.
- **Higher fidelity?** Lower `FLATTEN_TOL` (e.g. `0.5`).

The script prints a per-piece report (area, bounding box, total partition delta)
and rewrites `src/data/logoParts.js` and `public/logo-reference.svg`. A healthy
run reports `total piece area == artwork area` with a `0.0000%` delta.

> The cuts are deterministic and structural. For hand-picked groups, use
> `tools/svg-splitter.html` (below) or hand-author `logoParts.js`.

---

## Using a different SVG

1. Replace `logo.svg` with your file.
2. Run `npm run logo:split`.
3. That's it — the script reads the SVG's own `viewBox` and any
   `translate`/`scale`/`matrix` transform on the top-level group, so no manual
   coordinate maths is needed.

**Supported path commands:** `M m L l H h V v C c S s Q q T t Z z`.
(`A`/`a` arcs aren't supported — expand them first, or use the browser tool.)

### Interactive option: `tools/svg-splitter.html`

Open it directly in a browser (no install). Paste or load an SVG, click the
shapes you want as pieces, rename them, and export a ready-to-paste
`logoParts.js`. Use this when:

- your SVG already has `<g id="…">` groups you want to keep, or
- you want to pick pieces by hand rather than by an automatic cut.

### Manual option

Wrap each shape in its own group and copy the `d` values across:

```xml
<g id="part-wing-left"><path d="M..."/></g>
```

```js
export const LOGO_VIEWBOX = '0 0 240 240';
export const LOGO_PARTS = [
  { id: 'part-wing-left', d: 'M...', fill: 'currentColor' },
];
```

Rules for a pixel-perfect reconstruction:

- All pieces share **one coordinate system** and the same `viewBox`.
- **Never** bake a `transform` into one piece to compensate for another — GSAP
  overwrites `transform` on the pieces. Flatten transforms into the path
  coordinates (the splitter script does this automatically).
- Verify with `play={false}` (below): the static render must match your logo.

---

## How the timeline works (5s)

| Phase | Time | What happens | Config keys |
|-------|------|--------------|-------------|
| 1 · Appear | 0–1s | Pieces fade in, scattered around the screen, tilted | `phases.appear`, `scatter`, `rotation.appear`, `scale.appear` |
| 2 · Assemble | 1–3s | Pieces fly home, rotation → 0, scale → 1, staggered | `phases.assemble`, `stagger.assemble`, `easing.assemble` |
| 3 · Lock | 3–4s | Pieces align exactly + glow highlight + settle pop | `phases.lock`, `glow`, `scale.lockPop` |
| 4 · Reveal | 4–5s | Brand name fades up, subtle finishing scale | `phases.reveal`, `easing.reveal` |

All timings are **absolute offsets** on one timeline.

---

## Tuning it (`src/data/animationConfig.js`)

### Change the total duration

```js
phases: {
  appear:   { start: 0.0, duration: 1.0 },
  assemble: { start: 1.0, duration: 2.0 },
  lock:     { start: 3.0, duration: 1.0 },
  reveal:   { start: 4.0, duration: 1.0 },
},
```

> Each `start` must equal the previous `start + duration`, or you'll get gaps.
> A quick 3s version: `appear 0/0.6`, `assemble 0.6/1.4`, `lock 2.0/0.6`,
> `reveal 2.6/0.4`.

### Change where pieces start (Phase 1 positions)

```js
scatter: {
  spread: { min: 0.65, max: 1.35 }, // radius as a fraction of the SVG's short side
  angleOffset: 0.6,                  // rotate the whole spiral (radians)
},
```

Increase `max` to throw pieces further off-screen; set `min === max` for a
uniform ring. Positions are **deterministic** (golden-angle spiral) — identical
on every replay.

### Change rotation

```js
rotation: { appear: 34 }, // degrees of tilt while scattered; animates to 0
```

### Change stagger

```js
stagger: { appear: 0.07, assemble: 0.12 }, // seconds between consecutive pieces
```

### Change scale / glow / easing

```js
scale:  { appear: 0.45, appearEnd: 1.08, lockPop: 1.03 },
glow:   { rgb: '255, 255, 255', strength: 18, peak: 0.42 },
easing: { appear: 'power3.out', assemble: 'power4.inOut', lock: 'back.out(1.4)', reveal: 'power3.out' },
```

### Per-piece transform origin

By default each piece rotates/scales around **its own bounding-box centre**
(`transform-box: fill-box` + `transform-origin: center` in `preloader.css`).
Override for a specific piece when its natural pivot differs:

```js
{ id: 'part-sail-1', d: 'M...', fill: 'currentColor', origin: '10% 90%' },
```

---

## Using it in your app

```jsx
import Preloader from './components/Preloader';
import { LOGO_PARTS, LOGO_VIEWBOX } from './data/logoParts';

export default function App() {
  return (
    <>
      <Preloader
        logoParts={LOGO_PARTS}
        viewBox={LOGO_VIEWBOX}
        brandName="Preloader"       // or null to skip the name reveal
        onComplete={() => console.log('intro done')}
      />
      {/* your site */}
    </>
  );
}
```

### Props

| Prop | Default | Purpose |
|------|---------|---------|
| `logoParts` | `LOGO_PARTS` | the split logo data |
| `viewBox` | `LOGO_VIEWBOX` | must match the source artwork |
| `brandName` | `'YOUR BRAND'` | text revealed in Phase 4; `null` to skip |
| `config` | `ANIMATION_CONFIG` | override timing/motion |
| `enabled` | `true` | `false` skips the preloader entirely |
| `onComplete` | — | called once, after the overlay fades out |

### Replaying on demand

Give `<Preloader>` a changing `key` — that's the clean remount:

```jsx
<Preloader key={runId} onComplete={…} />
// runId++ to replay
```

---

## Behaviour guarantees

- **No replay on re-render.** The timeline effect depends only on stable values
  (`parts.length`, memoized scatter, config), and `onComplete` is read through a
  ref, so a new callback identity never restarts the animation.
- **No leaks.** The timeline lives inside `gsap.context(…, stage)` and is torn
  down with `ctx.revert()` on unmount, restoring all inline styles. The overlay
  fade tween is killed on unmount too.
- **Double-fire guard.** `onComplete` can only run once per mount.
- **Reduced motion.** `prefers-reduced-motion: reduce` snaps straight to the
  assembled logo and completes almost immediately.
- **60 FPS.** Only `transform` and `opacity` are animated (compositor-friendly);
  the Phase-3 glow is a single `drop-shadow` on one element, not per piece.
- **Scroll lock.** `body` overflow is locked while the overlay is visible.
- **Responsive.** The SVG is `min(46vmin, 82vw)`; typography uses `clamp()`.
  Pieces travel outside the `viewBox`, so the SVG uses `overflow: visible`.

---

## Production checklist

- [ ] Set your `brandName` (currently `"Preloader"` in `src/App.jsx`) or pass `null`.
- [ ] Confirm the palette in `preloader.css`: solid purple `--preloader-bg`
      (`#6C35D4`) and white pieces `--preloader-logo-color` (`#FFFFFF`).
- [ ] Re-tune `animationConfig.js` timings to taste.
- [ ] Delete the `.demo-page` markup and replay button in `src/App.jsx`
      (and its CSS at the bottom of `preloader.css`).
- [ ] Optionally delete `public/logo-reference.svg`.
