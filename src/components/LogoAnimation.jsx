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
  const brandRef = useRef(null);

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

    const { phases, stagger, rotation, scale, easing, glow } = config;

    // gsap.context scopes every selector to `stage` and lets ctx.revert()
    // fully undo inline styles + tweens on unmount (no leaks, no stale refs).
    const ctx = gsap.context((self) => {
      const pieces = self.selector('.logo-part');
      const brand = brandRef.current;

      const tl = gsap.timeline({ defaults: { ease: easing.assemble }, onComplete: finish });

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

    return () => ctx.revert();
  }, [play, parts.length, scatter, config]);

  return (
    <div className="logo-stage" ref={stageRef}>
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

      {brandName ? (
        <div className="logo-brand" ref={brandRef}>
          {brandName}
        </div>
      ) : null}
    </div>
  );
}
