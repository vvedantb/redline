import { LandingPageLayout, landingShellClass } from '@vvedantb/ui';
import { Demo } from './components/Demo';
import { HowItWorks } from './components/HowItWorks';
import { LandingCta, LandingFooter, LandingHero, LandingNav } from './components/LandingChrome';
import { OverlayMock } from './components/Mocks';
import { Quickstart } from './components/Quickstart';
import { LandingReveal, LandingRevealItem } from './components/kit';

export function App() {
  return (
    <LandingPageLayout nav={<LandingNav />} hero={<LandingHero />} footer={<LandingFooter />}>
      <LandingReveal className={`${landingShellClass} pt-12 sm:pt-16`}>
        <LandingRevealItem>
          <OverlayMock />
        </LandingRevealItem>
      </LandingReveal>
      <Demo />
      <HowItWorks />
      <Quickstart />
      <LandingCta />
    </LandingPageLayout>
  );
}
