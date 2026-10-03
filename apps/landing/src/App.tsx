import { Footer } from './components/Footer';
import { Hero } from './components/Hero';
import { HistorySection } from './components/HistorySection';
import { HowItWorks } from './components/HowItWorks';
import { Nav } from './components/Nav';
import { OverlaySection } from './components/OverlaySection';
import { Quickstart } from './components/Quickstart';

export function App() {
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <Nav />
      <main id="main">
        <Hero />
        <OverlaySection />
        <HistorySection />
        <HowItWorks />
        <Quickstart />
      </main>
      <Footer />
    </>
  );
}
