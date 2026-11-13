import { useEffect, useMemo, useRef } from 'react';
import gsap from 'gsap';
import LogoParts from './LogoParts';
import { ANIMATION_CONFIG } from '../data/animationConfig';

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/** "0 0 240 240" -> [0, 0, 240, 240] */
function parseViewBox(viewBox) {
  const n = String(viewBox)
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  return n.length === 4 && n.every((v) => Number.isFinite(v)) ? n : [0, 0, 240, 240];
}

/**
 * Deterministic scatter layout. Each piece gets a start offset on a
 * golden-angle spiral so the spread looks organic but is identical on every
 * replay (no random jitter between renders).
 */
function buildScatter(count, [, , w, h], config) {
  const unit = Math.min(w, h);
  const { min, max } = config.scatter.spread;
  const pieces = [];

  for (let i = 0; i < count; i += 1) {
    const t = count === 1 ? 0 : i / (count - 1);
    const angle = i * GOLDEN_ANGLE + config.scatter.angleOffset;
    const radius = unit * (min + (max - min) * t);
    pieces.push({
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
      dir: i % 2 === 0 ? 1 : -1,
    });
  }
  return pieces;
}

/**
 * Fit a staggered tween inside its phase window.
 *
 * GSAP staggers extend a group's total time by `stagger * (count - 1)`. Left
 * unchecked, a 2s "assemble" phase with N pieces would overrun into the next
 * phase. This caps the total stagger at 70% of the window and shortens each
 * piece's tween so the whole group always finishes exactly on the phase
 * boundary — regardless of how many pieces the grid produces.
 */
function fitStagger(phaseDuration, perPieceStagger, count) {
  const gaps = Math.max(0, count - 1);
  const totalStagger = Math.min(perPieceStagger * gaps, phaseDuration * 0.7);
  return {
    duration: Math.max(0.1, phaseDuration - totalStagger),
    stagger: gaps > 0 ? totalStagger / gaps : 0,
  };
}

/**
 * LogoAnimation
 * -----------------------------------------------------------------------------
 * Owns the SVG element and the GSAP timeline. All paths live in LogoParts;
 * all tuning values live in ANIMATION_CONFIG.
 *
 * Props
 *  - parts      : array from logoParts.js
 *  - viewBox    : must match the source SVG
 *  - brandName  : optional string revealed in Phase 4
 *  - config     : ANIMATION_CONFIG override
 *  - play       : when false, renders the assembled logo statically
 *  - onComplete : called once, when the 5s timeline finishes
 */
export default function LogoAnimation({
  parts,
  viewBox = '0 0 240 240',
  brandName,
  config = ANIMATION_CONFIG,
  play = true,
  onComplete,
}) {
  const stageRef = useRef(null);
  const parallaxRef = useRef(null);
  const brandRef = useRef(null);
  const brandDepthRef = useRef(null);

  // Keep the latest callback without making it a dependency of the timeline
  // effect (a new function identity must never restart the animation).
  const completeRef = useRef(onComplete);
  completeRef.current = onComplete;

  const parsedViewBox = useMemo(() => parseViewBox(viewBox), [viewBox]);
  const scatter = useMemo(
    () => buildScatter(parts.length, parsedViewBox, config),
    [parts.length, parsedViewBox, config],
  );

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return undefined;

    // Static mode: show the fully assembled logo with no motion. Used to verify
    // that logoParts.js reconstructs the original SVG exactly.
    if (!play) {
      gsap.set(stage, { opacity: 1 });
      if (brandRef.current) gsap.set(brandRef.current, { opacity: 1 });
      return undefined;
    }

    const finish = () => completeRef.current?.();

    // Accessibility: honour the OS "reduce motion" setting by snapping to the
    // assembled logo and completing almost immediately.
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      const pieces = stage.querySelectorAll('.logo-part');
      gsap.set(stage, { opacity: 1 });
      gsap.set(pieces, { opacity: 1, x: 0, y: 0, rotation: 0, scale: 1 });
      if (brandRef.current) gsap.set(brandRef.current, { opacity: 1, y: 0 });
      const call = gsap.delayedCall(0.4, finish);
      return () => call.kill();
    }

    const { phases, stagger, rotation, scale, easing, glow, parallax } = config;

    // Set by a timeline callback at `parallax.activateAt`, so the effect can be
    // held back until the mark has assembled (or start immediately at 0).
    let parallaxActive = false;
    let detachParallax = () => {};

    // gsap.context scopes every selector to `stage` and lets ctx.revert()
    // fully undo inline styles + tweens on unmount (no leaks, no stale refs).
    const ctx = gsap.context((self) => {
      const pieces = self.selector('.logo-part');
      const brand = brandRef.current;

      const tl = gsap.timeline({ defaults: { ease: easing.assemble }, onComplete: finish });

      if (parallax?.enabled) {
        tl.call(
          () => {
            parallaxActive = true;
          },
          null,
          Math.max(0, parallax.activateAt ?? 0),
        );
      }

      /* ── PHASE 1 · appear ─────────────────────────────────────────────── */
      // Reveal the stage itself (CSS starts it at opacity 0 to avoid a flash).
      tl.to(stage, { opacity: 1, duration: 0.2, ease: 'power1.out' }, phases.appear.start);

      tl.set(
        pieces,
        {
          opacity: 0,
          scale: scale.appear,
          x: (i) => scatter[i].x,
          y: (i) => scatter[i].y,
          rotation: (i) => scatter[i].dir * rotation.appear,
        },
        phases.appear.start,
      );

      const appearTiming = fitStagger(phases.appear.duration, stagger.appear, pieces.length);
      tl.to(
        pieces,
        {
          opacity: 1,
          scale: scale.appearEnd,
          duration: appearTiming.duration,
          stagger: appearTiming.stagger,
          ease: easing.appear,
        },
        phases.appear.start,
      );

      /* ── PHASE 2 · assemble ───────────────────────────────────────────── */
      const assembleTiming = fitStagger(phases.assemble.duration, stagger.assemble, pieces.length);
      tl.to(
        pieces,
        {
          x: 0,
          y: 0,
          rotation: 0,
          scale: 1,
          duration: assembleTiming.duration,
          stagger: assembleTiming.stagger,
          ease: easing.assemble,
        },
        phases.assemble.start,
      );

      /* ── PHASE 3 · lock + glow ────────────────────────────────────────── */
      const glowState = { v: 0 };
      tl.to(
        glowState,
        {
          v: 1,
          duration: phases.lock.duration * 0.6,
          ease: easing.lock,
          onUpdate: () => {
            const v = glowState.v;
            stage.style.filter = `drop-shadow(0 0 ${(glow.strength * v).toFixed(2)}px rgba(${glow.rgb}, ${(
              glow.peak * v
            ).toFixed(3)}))`;
          },
        },
        phases.lock.start,
      );

      tl.to(
        pieces,
        {
          scale: scale.lockPop,
          duration: phases.lock.duration * 0.4,
          ease: easing.lock,
          yoyo: true,
          repeat: 1,
        },
        phases.lock.start,
      );

      /* ── PHASE 4 · reveal ─────────────────────────────────────────────── */
      if (brand) {
        tl.fromTo(
          brand,
          { opacity: 0, y: 14 },
          { opacity: 1, y: 0, duration: phases.reveal.duration * 0.6, ease: easing.reveal },
          phases.reveal.start,
        );
      }

      tl.to(
        stage,
        {
          scale: 1.02,
          duration: phases.reveal.duration * 0.5,
          ease: easing.reveal,
          yoyo: true,
          repeat: 1,
        },
        phases.reveal.start,
      );

      // Pad the timeline so it always runs the full 5s even if a phase is
      // shortened while tuning.
      tl.to({}, { duration: phases.reveal.duration }, phases.reveal.start);
    }, stage);

    /* ── Pointer zoom parallax ──────────────────────────────────────────────
     * Runs on a dedicated wrapper so it never fights the timeline's piece or
     * stage transforms. quickTo keeps this allocation-free at 60 FPS; the brand
     * sits on a shallower inner layer and travels a fraction of the distance.
     */
    if (parallax?.enabled) {
      const layer = parallaxRef.current;
      const brandLayer = brandDepthRef.current;

      if (layer) {
        const p = parallax;
        const smooth = { duration: p.smoothing, ease: 'power3.out' };

        gsap.set(layer, {
          transformPerspective: p.perspective,
          transformOrigin: '50% 50%',
        });

        const xTo = gsap.quickTo(layer, 'x', smooth);
        const yTo = gsap.quickTo(layer, 'y', smooth);
        const rotXTo = gsap.quickTo(layer, 'rotationX', smooth);
        const rotYTo = gsap.quickTo(layer, 'rotationY', smooth);
        // `quickTo('scale')` can't resetTo() a split property — use the axis pair.
        const zoomXTo = gsap.quickTo(layer, 'scaleX', smooth);
        const zoomYTo = gsap.quickTo(layer, 'scaleY', smooth);

        const bxTo = brandLayer ? gsap.quickTo(brandLayer, 'x', smooth) : null;
        const byTo = brandLayer ? gsap.quickTo(brandLayer, 'y', smooth) : null;

        const onPointerMove = (event) => {
          if (!parallaxActive) return;

          // -1 .. 1 from the viewport centre.
          const nx = (event.clientX / window.innerWidth - 0.5) * 2;
          const ny = (event.clientY / window.innerHeight - 0.5) * 2;
          const reach = Math.min(1, Math.hypot(nx, ny));

          xTo(nx * p.shift);
          yTo(ny * p.shift);
          rotYTo(nx * p.tilt);
          rotXTo(-ny * p.tilt);
          const zoom = 1 + p.zoom * reach;
          zoomXTo(zoom);
          zoomYTo(zoom);

          if (bxTo) {
            bxTo(nx * p.shift * p.brandDepth);
            byTo(ny * p.shift * p.brandDepth);
          }
        };

        const reset = () => {
          if (!parallaxActive) return;
          xTo(0);
          yTo(0);
          rotXTo(0);
          rotYTo(0);
          zoomXTo(1);
          zoomYTo(1);
          bxTo?.(0);
          byTo?.(0);
        };

        window.addEventListener('pointermove', onPointerMove, { passive: true });
        window.addEventListener('blur', reset);
        document.addEventListener('pointerleave', reset);

        detachParallax = () => {
          window.removeEventListener('pointermove', onPointerMove);
          window.removeEventListener('blur', reset);
          document.removeEventListener('pointerleave', reset);
          const layers = [layer, brandLayer].filter(Boolean);
          gsap.killTweensOf(layers);
          gsap.set(layers, { clearProps: 'transform,transformPerspective' });
        };
      }
    }

    return () => {
      detachParallax();
      ctx.revert();
    };
  }, [play, parts.length, scatter, config]);

  return (
    <div className="logo-stage" ref={stageRef}>
      <div className="logo-parallax" ref={parallaxRef}>
        <svg
          className="logo-svg"
          viewBox={viewBox}
          xmlns="http://www.w3.org/2000/svg"
          role="img"
          aria-label={brandName ? `${brandName} logo` : 'Logo'}
          preserveAspectRatio="xMidYMid meet"
        >
          <LogoParts parts={parts} />
        </svg>
      </div>

      {brandName ? (
        <div className="logo-brand" ref={brandRef}>
          <span className="logo-brand-depth" ref={brandDepthRef}>
            {brandName}
          </span>
        </div>
      ) : null}
    </div>
  );
}
