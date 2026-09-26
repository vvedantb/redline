import { RedlineOverlay } from '@vedantb/redline';
import { useState } from 'react';
import { Footer } from './components/Footer';
import { Header } from './components/Header';
import { Hero } from './components/Hero';
import { RedlineControls } from './components/RedlineControls';
import { Signup } from './components/Signup';
import { Stats } from './components/Stats';

const DISABLED_KEY = 'redlineDisabled';

function initialOverlayOn(): boolean {
  try {
    return window.localStorage.getItem(DISABLED_KEY) !== '1';
  } catch {
    return true;
  }
}

export function App({ cloud }: { cloud: boolean }) {
  const [overlayOn, setOverlayOn] = useState(initialOverlayOn);
  // Set when a signed-in user chooses to diff against their Convex baseline.
  const [cloudSha, setCloudSha] = useState<string | null>(null);

  const toggleOverlay = (on: boolean) => {
    try {
      if (on) window.localStorage.removeItem(DISABLED_KEY);
      else window.localStorage.setItem(DISABLED_KEY, '1');
    } catch {
      // Storage unavailable: the prop still controls the overlay.
    }
    setOverlayOn(on);
  };

  return (
    <>
      <RedlineControls
        cloud={cloud}
        overlayOn={overlayOn}
        onToggleOverlay={toggleOverlay}
        cloudSha={cloudSha}
        onUseCloudSha={setCloudSha}
      />
      <div className="page">
        <Header />
        <main>
          <Hero />
          <Stats />
          <Signup />
        </main>
        <Footer />
      </div>
      <RedlineOverlay enabled={overlayOn} baseline={cloudSha} />
    </>
  );
}
