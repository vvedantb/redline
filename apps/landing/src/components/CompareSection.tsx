import { Reveal, RevealItem } from './Reveal';
import { SectionHeading } from './SectionHeading';

const PAGES = [
  { route: '/checkout', status: 'broken', label: 'Looks broken', files: 'src/Checkout.tsx' },
  { route: '/pricing', status: 'changed', label: 'Changed', files: 'src/Pricing.tsx, src/Card.tsx' },
  { route: '/docs/start', status: 'new', label: 'New', files: 'src/pages/docs/start.tsx' },
  { route: '/legacy', status: 'removed', label: 'Removed', files: 'src/pages/legacy.tsx' },
] as const;

export function CompareSection() {
  return (
    <section className="section" id="compare" aria-labelledby="compare-title">
      <Reveal className="shell split">
        <RevealItem className="split-text">
          <SectionHeading id="compare-title" eyebrow="Compare">
            Every page, before and after
          </SectionHeading>
          <p className="lede">
            Run <code>redline compare</code> on any two commits. The report lists pages that look broken, changed, new or
            removed, with the files they most likely came from.
          </p>
          <ul className="points">
            <li>
              <span className="point-key">Before and after</span>
              Side by side, with numbered boxes on the changed areas and a slider.
            </li>
            <li>
              <span className="point-key">Likely files</span>
              Changed files are traced through the import graph to the pages that use them.
            </li>
            <li>
              <span className="point-key">Static report</span>
              Open it from disk or host it anywhere. <code>report.json</code> holds the same data.
            </li>
          </ul>
        </RevealItem>
        <RevealItem index={1}>
          <ReportMock />
        </RevealItem>
      </Reveal>
    </section>
  );
}

function ReportMock() {
  return (
    <figure className="mock" aria-label="Illustration: a Redline report with before and after screenshots and a ranked list of pages">
      <div className="frame" aria-hidden="true">
        <div className="frame-bar">
          <span className="frame-dots">
            <i />
            <i />
            <i />
          </span>
          <span className="frame-url">.redline/report/index.html</span>
        </div>
        <div className="ba-pair">
          <div className="ba-pane">
            <span className="ba-label">Before</span>
            <div className="wire">
              <span className="blk w-60 h-5 dark" />
              <span className="blk w-80 h-2 light" />
              <span className="wire-row">
                <span className="blk w-btn h-6 dark round" />
              </span>
            </div>
          </div>
          <div className="ba-pane">
            <span className="ba-label">After</span>
            <div className="wire">
              <span className="blk w-70 h-5 dark" />
              <span className="blk w-80 h-2 light" />
              <span className="wire-row" style={{ position: 'relative' }}>
                <span className="blk w-btn h-6 dark round" />
                <span className="outline" style={{ inset: '-4px -6px' }}>
                  <span className="ba-num">1</span>
                </span>
              </span>
            </div>
          </div>
        </div>
        <div className="report-list">
          {PAGES.map((page) => (
            <div key={page.route} className="report-row">
              <span className="report-route">{page.route}</span>
              <span className="report-files">{page.files}</span>
              <span className={`tag ${page.status}`}>{page.label}</span>
            </div>
          ))}
        </div>
      </div>
    </figure>
  );
}
