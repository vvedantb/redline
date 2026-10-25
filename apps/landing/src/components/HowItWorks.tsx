import { Reveal, RevealItem } from './Reveal';

const STEPS = [
  { index: '01', title: 'Build', body: 'Each commit builds in its own git worktree.' },
  { index: '02', title: 'Capture', body: 'Every page at both commits, in headless Chromium.' },
  { index: '03', title: 'Diff', body: 'Pixel diff boxes the changed areas and traces files to pages.' },
];

export function HowItWorks() {
  return (
    <section className="section" id="how" aria-labelledby="how-title">
      <Reveal className="shell">
        <RevealItem className="section-head">
          <h2 id="how-title" className="section-title">
            Three steps, all local
          </h2>
        </RevealItem>
        <ol className="lattice">
          {STEPS.map((step, i) => (
            <RevealItem as="li" key={step.index} index={i + 1} className="lattice-cell">
              <span className="step-index">{step.index}</span>
              <h3 className="step-title">{step.title}</h3>
              <p className="step-body">{step.body}</p>
            </RevealItem>
          ))}
        </ol>
      </Reveal>
    </section>
  );
}
