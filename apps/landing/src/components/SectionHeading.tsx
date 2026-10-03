import type { ReactNode } from 'react';

type Props = { id: string; eyebrow: string; children: ReactNode };

export function SectionHeading({ id, eyebrow, children }: Props) {
  return (
    <div className="section-heading">
      <p className="eyebrow">{eyebrow}</p>
      <h2 id={id} className="section-title">
        {children}
      </h2>
    </div>
  );
}
