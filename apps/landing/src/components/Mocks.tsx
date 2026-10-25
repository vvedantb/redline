const PAGES = [
  { route: '/checkout', status: 'broken', label: 'Looks broken', files: 'src/Checkout.tsx' },
  { route: '/pricing', status: 'changed', label: 'Changed', files: 'src/Pricing.tsx' },
  { route: '/docs/start', status: 'new', label: 'New', files: 'src/pages/docs/start.tsx' },
  { route: '/legacy', status: 'removed', label: 'Removed', files: 'src/pages/legacy.tsx' },
] as const;

const COMMITS = [
  { sha: 'f4e9a21', subject: 'Tighten hero copy', status: 'Ready' },
  { sha: '9c03b7e', subject: 'Add pricing cards', status: 'Building…' },
  { sha: '2d81c4a', subject: 'Refactor nav links' },
  { sha: 'a1b2c3d', subject: 'Initial layout' },
] as const;

function Bar({ url }: { url: string }) {
  return (
    <div className="frame-bar" aria-hidden="true">
      <span className="frame-dots">
        <i />
        <i />
        <i />
      </span>
      <span className="frame-url">{url}</span>
    </div>
  );
}

function Wire({ compact = false }: { compact?: boolean }) {
  return (
    <div className="wire" aria-hidden="true">
      <div className="wire-nav">
        <span className="blk w-16 h-3 dark" />
        <span className="wire-nav-links">
          <span className="blk w-8 h-2" />
          <span className="blk w-8 h-2" />
        </span>
      </div>
      <div className="wire-hero">
        <span className="blk w-70 h-5 dark" />
        <span className="blk w-50 h-5 dark" />
        <span className="blk w-60 h-2 light" />
        <span className="wire-row">
          <span className="blk w-btn h-6 dark round" />
          <span className="blk w-btn h-6 light round" />
        </span>
        <span className="outline o1" style={{ inset: '-8px -10px' }}>
          <span className="outline-tag">src/Hero.tsx:4-9</span>
        </span>
      </div>
      {compact ? null : (
        <div className="wire-cards">
          {[0, 1, 2].map((n) => (
            <span key={n} className="wire-card">
              <span className="blk w-40 h-2 mid" />
              <span className="blk w-80 h-2 light" />
              {n === 1 ? (
                <span className="outline o2" style={{ inset: '-5px' }}>
                  <span className="outline-tag">src/Card.tsx:12</span>
                </span>
              ) : null}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function OverlayMock() {
  return (
    <figure className="frame" aria-label="Illustration: an app with red outlines on changed elements, a diff panel and the Redline toolbar">
      <Bar url="localhost:5173" />
      <div className="frame-body overlay-body">
        <Wire />
        <div className="diff-panel" aria-hidden="true">
          <div className="diff-head">
            <span className="diff-file">src/Hero.tsx</span>
            <span className="diff-lines">lines 4–9</span>
          </div>
          <pre className="diff-code">
            <span className="dl ctx">@@ -4,6 +4,6 @@</span>
            <span className="dl del">-  {'<h1>Ship faster</h1>'}</span>
            <span className="dl add">+  {'<h1>Ship with care</h1>'}</span>
            <span className="dl ctx">   {'<p>{tagline}</p>'}</span>
          </pre>
        </div>
        <div className="toolbar" aria-hidden="true">
          <span className="toolbar-status">
            <b>2</b> regions changed · baseline <code>a1b2c3d</code>
          </span>
          <span className="toolbar-btn">Hide</span>
          <span className="toolbar-btn">History</span>
        </div>
      </div>
    </figure>
  );
}

export function ReportMock() {
  return (
    <figure className="frame" aria-label="Illustration: a Redline report with before and after screenshots and a list of pages">
      <Bar url=".redline/report/index.html" />
      <div className="frame-body report-body" aria-hidden="true">
        <div className="ba-pair">
          <div className="ba-pane">
            <span className="ba-label">Before</span>
            <div className="wire">
              <span className="blk w-60 h-5 dark" />
              <span className="blk w-80 h-2 light" />
              <span className="blk w-btn h-6 dark round" />
            </div>
          </div>
          <div className="ba-pane">
            <span className="ba-label">After</span>
            <div className="wire">
              <span className="blk w-70 h-5 dark" />
              <span className="blk w-80 h-2 light" />
              <span className="wire-row rel">
                <span className="blk w-btn h-6 dark round" />
                <span className="outline o1" style={{ inset: '-4px -6px' }}>
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

export function HistoryMock() {
  return (
    <figure className="frame" aria-label="Illustration: the history panel listing commits next to a past commit running in a frame">
      <Bar url="/__redline/h/f4e9a21/" />
      <div className="frame-body history-body" aria-hidden="true">
        <div className="commit-list">
          <div className="commit-list-head">
            <span>History</span>
            <span className="latest-btn">Latest</span>
          </div>
          <ul>
            {COMMITS.map((c, i) => (
              <li key={c.sha} className={i === 0 ? 'commit active' : 'commit'}>
                <code className="commit-sha">{c.sha}</code>
                <span className="commit-subject">{c.subject}</span>
                {'status' in c ? <span className={c.status === 'Ready' ? 'commit-status ready' : 'commit-status building'}>{c.status}</span> : null}
              </li>
            ))}
          </ul>
        </div>
        <div className="past">
          <span className="past-tag">viewing f4e9a21</span>
          <Wire compact />
        </div>
      </div>
    </figure>
  );
}
