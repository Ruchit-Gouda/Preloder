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
    appear: 0.06,
    assemble: 0.1,
  },

  /**
   * Where pieces start, as a fraction of the SVG's shortest side.
   * A piece at index i is placed on a golden-angle spiral between `min` and
   * `max` radius, so the spread is even but never looks like a grid.
   */
  scatter: {
    spread: { min: 0.55, max: 1.15 },
    angleOffset: 0.6, // rotate the whole spiral (radians)
  },

  rotation: {
    appear: 26, // degrees each piece is tilted while scattered
  },

  scale: {
    appear: 0.6, // scale the instant a piece becomes visible
    appearEnd: 1.12, // scale at the end of Phase 1 (slight overshoot)
    lockPop: 1.04, // settle pop during Phase 3
  },

  easing: {
    appear: 'power2.out',
    assemble: 'power3.inOut',
    lock: 'back.out(1.7)',
    reveal: 'power2.out',
  },

  glow: {
    rgb: '125, 211, 252', // accent used for the Phase 3 highlight
    strength: 12, // peak drop-shadow blur radius in px
    peak: 0.55, // peak alpha of the glow
  },

  // How long the overlay takes to fade out once the logo is assembled.
  overlayExit: 0.6,
};

export default ANIMATION_CONFIG;
