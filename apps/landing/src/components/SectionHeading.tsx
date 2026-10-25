import type { ReactNode } from 'react';

type Props = { id: string; eyebrow: string; children: ReactNode; intro?: string };

export function SectionHeading({ id, eyebrow, children, intro }: Props) {
  return (
    <div className="section-heading">
      <p className="eyebrow">{eyebrow}</p>
      <h2 id={id} className="section-title">
        {children}
      </h2>
      {intro ? <p className="lede">{intro}</p> : null}
    </div>
  );
}
