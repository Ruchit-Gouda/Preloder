import { memo } from 'react';

/**
 * LogoParts
 * -----------------------------------------------------------------------------
 * Purely presentational. It knows nothing about GSAP — it just turns the
 * `LOGO_PARTS` data into an SVG structure where every piece is its own group:
 *
 *   <g id="part-wing-left" class="logo-part"> <path .../> </g>
 *
 * The `logo-part` class is the hook the animation layer selects on, so adding
 * or removing pieces never requires touching animation code.
 */
function LogoParts({ parts }) {
  return parts.map((part, index) => {
    const paths = part.paths ?? [part.d];

    return (
      <g
        key={part.id}
        id={part.id}
        className="logo-part"
        data-part-index={index}
        // Per-piece origin. When omitted, CSS falls back to the piece's own
        // bounding-box center (transform-box: fill-box).
        style={part.origin ? { transformOrigin: part.origin } : undefined}
      >
        {paths.map((d, i) => (
          <path
            key={`${part.id}-${i}`}
            d={d}
            fill={part.fill ?? 'currentColor'}
            fillOpacity={part.opacity ?? 1}
            fillRule={part.fillRule ?? 'nonzero'}
            clipRule={part.clipRule ?? 'nonzero'}
          />
        ))}
      </g>
    );
  });
}

export default memo(LogoParts);
