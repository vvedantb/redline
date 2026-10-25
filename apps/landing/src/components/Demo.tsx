import { useState } from 'react';
import { TABS, type TabId } from '../content';
import { CompareIcon, HistoryIcon, OverlayIcon } from './icons';
import { HistoryMock, OverlayMock, ReportMock } from './Mocks';
import { Reveal } from './Reveal';

const ICONS = { compare: <CompareIcon />, overlay: <OverlayIcon />, history: <HistoryIcon /> } as const;
const MOCKS = { compare: <ReportMock />, overlay: <OverlayMock />, history: <HistoryMock /> } as const;

export function Demo() {
  const [active, setActive] = useState<TabId>('compare');
  const tab = TABS.find((t) => t.id === active) ?? TABS[0];

  function onKeyDown(event: React.KeyboardEvent, index: number) {
    const dir = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!dir) return;
    event.preventDefault();
    const next = TABS[(index + dir + TABS.length) % TABS.length];
    setActive(next.id);
    document.getElementById(`tab-${next.id}`)?.focus();
  }

  return (
    <section className="section" id="features" aria-labelledby="features-title">
      <Reveal className="shell">
        <div className="section-head reveal-item">
          <h2 id="features-title" className="section-title">
            See it work
          </h2>
          <p className="section-sub">Three surfaces. Click through them.</p>
        </div>
        <div className="tabs reveal-item" role="tablist" aria-label="Redline surfaces" style={{ '--i': 1 } as React.CSSProperties}>
          {TABS.map((t, i) => (
            <button
              key={t.id}
              id={`tab-${t.id}`}
              type="button"
              role="tab"
              aria-selected={t.id === active}
              aria-controls="demo-panel"
              tabIndex={t.id === active ? 0 : -1}
              className="tab"
              onClick={() => setActive(t.id)}
              onKeyDown={(e) => onKeyDown(e, i)}
            >
              {ICONS[t.id]}
              {t.label}
            </button>
          ))}
        </div>
        <div className="demo reveal-item" id="demo-panel" role="tabpanel" aria-labelledby={`tab-${active}`} style={{ '--i': 2 } as React.CSSProperties}>
          <div className="demo-text">
            <h3 className="demo-title">{tab.title}</h3>
            <p className="demo-body">{tab.body}</p>
          </div>
          <div className="demo-mock" key={active}>
            {MOCKS[active]}
          </div>
        </div>
      </Reveal>
    </section>
  );
}
