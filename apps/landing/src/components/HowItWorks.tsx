import { LaptopIcon, LockIcon, ShieldIcon } from './icons';
import { SectionHeading } from './SectionHeading';

const STEPS = [
  { index: '01', title: 'Pin', body: 'Pin a baseline commit, or any branch or ref. Redline stores it locally.' },
  { index: '02', title: 'Edit', body: 'An agent or a pull request changes your code. Keep the dev server running.' },
  {
    index: '03',
    title: 'Inspect',
    body: 'Outlines appear on changed elements. Click one for the hunk, or open History to see any commit running.',
  },
];

const FEATURES = [
  {
    icon: <ShieldIcon />,
    title: 'Dev-only by design',
    body: 'The transform and endpoints run only in dev. Production builds are untouched.',
  },
  {
    icon: <LockIcon />,
    title: 'Read-only history',
    body: 'Env files are filtered to public keys. GETs replay fixtures, and POST, PUT, PATCH and DELETE never reach the network.',
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
        <SectionHeading id="how-title" eyebrow="How it works">
          Three steps, all local
        </SectionHeading>
        <ol className="lattice">
          {STEPS.map((step) => (
            <li key={step.index} className="lattice-cell">
              <span className="step-index">{step.index}</span>
              <h3 className="step-title">{step.title}</h3>
              <p className="step-body">{step.body}</p>
            </li>
          ))}
        </ol>
        <ul className="features">
          {FEATURES.map((f) => (
            <li key={f.title} className="card feature">
              <span className="feature-icon">{f.icon}</span>
              <h3 className="feature-title">{f.title}</h3>
              <p className="feature-body">{f.body}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
