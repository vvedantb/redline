import { IconCamera, IconGitCompare, IconGitBranch } from '@tabler/icons-react';
import { LandingFeatureCard, LandingLattice, LandingSection, LandingSectionHeading } from '@vvedantb/ui';
import { LandingReveal, LandingRevealItem } from './kit';

const STEPS = [
  { icon: IconGitBranch, title: 'Build', description: 'Each commit builds in its own git worktree.' },
  { icon: IconCamera, title: 'Capture', description: 'Every page at both commits, in headless Chromium.' },
  { icon: IconGitCompare, title: 'Diff', description: 'Pixel diff boxes the changed areas and traces files to pages.' },
];

export function HowItWorks() {
  return (
    <LandingSection id="how">
      <LandingReveal>
        <LandingRevealItem>
          <LandingSectionHeading eyebrow="How it works" heading="Three steps, all local" />
        </LandingRevealItem>
        <LandingRevealItem className="mt-10">
          <LandingLattice className="md:grid-cols-3">
            {STEPS.map((step) => (
              <LandingFeatureCard key={step.title} {...step} />
            ))}
          </LandingLattice>
        </LandingRevealItem>
      </LandingReveal>
    </LandingSection>
  );
}
