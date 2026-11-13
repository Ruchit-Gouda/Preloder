import { useCallback, useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import LogoAnimation from './LogoAnimation';
import { ANIMATION_CONFIG } from '../data/animationConfig';
import { LOGO_PARTS, LOGO_VIEWBOX } from '../data/logoParts';

/**
 * Preloader
 * -----------------------------------------------------------------------------
 * The full-screen overlay that hosts the logo animation and gets out of the
 * way once assembly is done.
 *
 * Props
 *  - logoParts  : array from logoParts.js        (default: LOGO_PARTS)
 *  - viewBox    : must match the source SVG       (default: LOGO_VIEWBOX)
 *  - brandName  : text revealed in Phase 4, or null to skip
 *  - config     : ANIMATION_CONFIG override
 *  - enabled    : set false to skip the preloader entirely
 *  - onComplete : called once after the overlay has faded out
 */
export default function Preloader({
  logoParts = LOGO_PARTS,
  viewBox = LOGO_VIEWBOX,
  brandName = 'YOUR BRAND',
  config = ANIMATION_CONFIG,
  enabled = true,
  onComplete,
}) {
  const rootRef = useRef(null);
  const exitRef = useRef(null);
  const playedRef = useRef(false);

  const completeRef = useRef(onComplete);
  completeRef.current = onComplete;

  const [hidden, setHidden] = useState(!enabled);

  // Lock scroll for as long as the overlay is visible.
  useEffect(() => {
    if (!enabled || hidden) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [enabled, hidden]);

  // Fade the overlay out, then tell the app the intro is over.
  const handleLogoComplete = useCallback(() => {
    if (playedRef.current) return; // guard against double-fire
    playedRef.current = true;

    const root = rootRef.current;
    if (!root) {
      completeRef.current?.();
      return;
    }

    exitRef.current = gsap.to(root, {
      autoAlpha: 0,
      duration: config.overlayExit,
      ease: 'power2.inOut',
      onComplete: () => {
        setHidden(true);
        completeRef.current?.();
      },
    });
  }, [config.overlayExit]);

  // Kill any in-flight exit tween on unmount.
  useEffect(() => () => exitRef.current?.kill(), []);

  if (!enabled || hidden) return null;

  return (
    <div className="preloader" ref={rootRef}>
      <LogoAnimation
        parts={logoParts}
        viewBox={viewBox}
        brandName={brandName}
        config={config}
        onComplete={handleLogoComplete}
      />
    </div>
  );
}
