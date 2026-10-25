import { Demo } from './components/Demo';
import { Footer } from './components/Footer';
import { Hero } from './components/Hero';
import { HowItWorks } from './components/HowItWorks';
import { Nav } from './components/Nav';
import { Quickstart } from './components/Quickstart';

export function App() {
  return (
    <div id="top" className="page">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <Nav />
      <main id="main">
        <Hero />
        <Demo />
        <HowItWorks />
        <Quickstart />
      </main>
      <Footer />
    </div>
  );
}
