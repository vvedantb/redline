import { useState } from 'react';
import { TABS, type TabId } from '../content';
import { CompareIcon, HistoryIcon, OverlayIcon } from './icons';
import { HistoryMock, OverlayMock, ReportMock } from './Mocks';
import { LandingSection, LandingSectionHeading } from '@vvedantb/ui';
import { LandingReveal, LandingRevealItem } from './kit';

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
    if (!next) return;
    setActive(next.id);
    document.getElementById(`tab-${next.id}`)?.focus();
  }

  return (
    <LandingSection id="features">
      <LandingReveal>
        <LandingRevealItem>
          <LandingSectionHeading eyebrow="Features" heading="See it work" intro="Three surfaces. Click through them." />
        </LandingRevealItem>
        <LandingRevealItem>
        <div className="tabs" role="tablist" aria-label="Redline surfaces">
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
        </LandingRevealItem>
        <LandingRevealItem>
        <div className="demo" id="demo-panel" role="tabpanel" aria-labelledby={`tab-${active}`}>
          <div className="demo-text">
            <h3 className="demo-title">{tab.title}</h3>
            <p className="demo-body">{tab.body}</p>
          </div>
          <div className="demo-mock" key={active}>
            {MOCKS[active]}
          </div>
        </div>
        </LandingRevealItem>
      </LandingReveal>
    </LandingSection>
  );
}
