/**
 * animationConfig.js
 * -----------------------------------------------------------------------------
 * Every timing / motion value the timeline uses lives here, so you never have
 * to dig through animation logic to tune the intro.
 *
 * TIMELINE MAP (all values in seconds, absolute on a 5s timeline)
 *
 *   0.0 ─ 1.0   PHASE 1  appear    pieces fade in, scattered, tilted
 *   1.0 ─ 3.0   PHASE 2  assemble  pieces fly home + rotate to 0
 *   3.0 ─ 4.0   PHASE 3  lock      glow highlight + settle pop
 *   4.0 ─ 5.0   PHASE 4  reveal    brand name + finishing scale
 */
export const ANIMATION_CONFIG = {
  phases: {
    appear: { start: 0.0, duration: 1.0 },
    assemble: { start: 1.0, duration: 2.0 },
    lock: { start: 3.0, duration: 1.0 },
    reveal: { start: 4.0, duration: 1.0 },
  },

  // Gap between each individual piece inside a phase.
  stagger: {
    appear: 0.07,
    assemble: 0.12,
  },

  /**
   * Where pieces start, as a fraction of the SVG's shortest side.
   * A piece at index i is placed on a golden-angle spiral between `min` and
   * `max` radius, so the spread is even but never looks like a grid.
   */
  scatter: {
    spread: { min: 0.65, max: 1.35 },
    angleOffset: 0.6, // rotate the whole spiral (radians)
  },

  rotation: {
    appear: 34, // degrees each piece is tilted while scattered
  },

  scale: {
    appear: 0.45, // scale the instant a piece becomes visible
    appearEnd: 1.08, // scale at the end of Phase 1 (slight overshoot)
    lockPop: 1.03, // settle pop during Phase 3
  },

  easing: {
    appear: 'power3.out',
    assemble: 'power4.inOut', // long, weighted glide into place
    lock: 'back.out(1.4)',
    reveal: 'power3.out',
  },

  glow: {
    rgb: '255, 255, 255', // subtle white highlight against the purple
    strength: 18, // peak drop-shadow blur radius in px
    peak: 0.42, // peak alpha of the glow
  },

  // How long the overlay takes to fade out once the logo is assembled.
  overlayExit: 0.7,
};

export default ANIMATION_CONFIG;
