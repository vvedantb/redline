import { LaptopIcon, LockIcon, ShieldIcon } from './icons';
import { Reveal, RevealItem } from './Reveal';
import { SectionHeading } from './SectionHeading';

const STEPS = [
  { index: '01', title: 'Build', body: 'Each commit builds in its own git worktree. Your working tree is never touched.' },
  { index: '02', title: 'Capture', body: 'Every page at both commits, in headless Chromium.' },
  { index: '03', title: 'Diff', body: 'Pixel diff boxes the changed areas. Changed files trace to the pages they reach.' },
];

const FEATURES = [
  {
    icon: <ShieldIcon />,
    title: 'Dev-only overlay',
    body: 'The transform and endpoints run only in dev. Production builds are untouched.',
  },
  {
    icon: <LockIcon />,
    title: 'Read-only history',
    body: 'Env files keep public keys only. GETs replay fixtures, and writes never reach the network.',
  },
  {
    icon: <LaptopIcon />,
    title: 'Local, no backend',
    body: 'No auth and no service. It is git and your dev server.',
  },
];

export function HowItWorks() {
  return (
    <section className="section" id="how" aria-labelledby="how-title">
      <div className="shell">
        <Reveal>
          <RevealItem>
            <SectionHeading id="how-title" eyebrow="How it works">
              Three steps, all local
            </SectionHeading>
          </RevealItem>
        </Reveal>
        <div className="lattice">
          <Reveal as="ol" className="lattice-grid">
            {STEPS.map((step, i) => (
              <RevealItem as="li" key={step.index} index={i} className="lattice-cell">
                <span className="step-index">{step.index}</span>
                <h3 className="step-title">{step.title}</h3>
                <p className="step-body">{step.body}</p>
              </RevealItem>
            ))}
          </Reveal>
        </div>
        <Reveal as="ul" className="features">
          {FEATURES.map((f, i) => (
            <RevealItem as="li" key={f.title} index={i} className="feature-card">
              <span className="feature-icon">{f.icon}</span>
              <div className="feature-text">
                <h3 className="feature-title">{f.title}</h3>
                <p className="feature-body">{f.body}</p>
              </div>
            </RevealItem>
          ))}
        </Reveal>
      </div>
    </section>
  );
}
