import { useState } from 'react';
import Preloader from './components/Preloader';
import { LOGO_PARTS, LOGO_VIEWBOX } from './data/logoParts';

/**
 * Demo host page.
 *
 * Shows how a consumer wires the preloader up:
 *  - `key` on <Preloader> is the clean way to replay it on demand.
 *  - `onComplete` fires once the overlay has finished fading out.
 *
 * Delete the replay button + `.demo-page` markup for production; the preloader
 * itself is self-contained.
 */
export default function App() {
  const [runId, setRunId] = useState(0);
  const [ready, setReady] = useState(false);

  return (
    <>
      <Preloader
        key={runId}
        logoParts={LOGO_PARTS}
        viewBox={LOGO_VIEWBOX}
        brandName="Preloader"
        onComplete={() => setReady(true)}
      />

      <main className="demo-page">
        <h1>Your site content</h1>
        <p>
          The preloader overlays this page, assembles the logo, then fades away.
          {ready ? ' Intro complete.' : ' Assembling…'}
        </p>
        <button
          type="button"
          className="demo-replay"
          onClick={() => {
            setReady(false);
            setRunId((n) => n + 1);
          }}
        >
          Replay preloader
        </button>
      </main>
    </>
  );
}
