import { SectionHeading } from './SectionHeading';

export function OverlaySection() {
  return (
    <section className="section" id="overlay" aria-labelledby="overlay-title">
      <div className="shell split">
        <div className="split-text">
          <SectionHeading id="overlay-title" eyebrow="The overlay">
            Changed elements, outlined where they render
          </SectionHeading>
          <p className="lede">
            Pin a baseline commit. After an agent or a pull request edits your code, Redline outlines each rendered
            element whose source changed since that baseline. It updates live as you work.
          </p>
          <ul className="points">
            <li>
              <span className="point-key">Outline</span>
              Each changed element gets an outline with a small label.
            </li>
            <li>
              <span className="point-key">Diff panel</span>
              Click a label to open a side panel with the file path, line numbers and hunk.
            </li>
            <li>
              <span className="point-key">Toolbar</span>
              Shows how many regions changed and the baseline. Hide outlines or open History from here.
            </li>
          </ul>
        </div>
        <OverlayMock />
      </div>
    </section>
  );
}

function OverlayMock() {
  return (
    <figure className="mock" aria-label="Illustration: an app with three red outlines, a diff panel and the Redline toolbar">
      <div className="frame">
        <div className="frame-bar" aria-hidden="true">
          <span className="frame-dots">
            <i />
            <i />
            <i />
          </span>
          <span className="frame-url">localhost:5173</span>
        </div>
        <div className="frame-body overlay-body" aria-hidden="true">
          <div className="wire">
            <div className="wire-nav">
              <span className="blk w-16 h-3 dark" />
              <span className="wire-nav-links">
                <span className="blk w-8 h-2" />
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
              <span className="outline" style={{ inset: '-8px -10px' }}>
                <span className="outline-tag">src/Hero.tsx:4-9</span>
              </span>
            </div>
            <div className="wire-cards">
              <span className="wire-card">
                <span className="blk w-40 h-2 mid" />
                <span className="blk w-80 h-2 light" />
                <span className="blk w-60 h-2 light" />
              </span>
              <span className="wire-card">
                <span className="blk w-40 h-2 mid" />
                <span className="blk w-80 h-2 light" />
                <span className="blk w-60 h-2 light" />
                <span className="outline outline-pulse" style={{ inset: '-5px' }}>
                  <span className="outline-tag">src/Card.tsx:12</span>
                </span>
              </span>
              <span className="wire-card">
                <span className="blk w-40 h-2 mid" />
                <span className="blk w-80 h-2 light" />
                <span className="blk w-60 h-2 light" />
              </span>
            </div>
            <div className="wire-foot">
              <span className="blk w-24 h-2 light" />
              <span className="outline" style={{ inset: '-5px -6px' }}>
                <span className="outline-tag">src/Footer.tsx:7-8</span>
              </span>
            </div>
          </div>

          <div className="diff-panel">
            <div className="diff-head">
              <span className="diff-file">src/Hero.tsx</span>
              <span className="diff-lines">lines 4–9</span>
            </div>
            <pre className="diff-code">
              <span className="dl ctx">@@ -4,6 +4,6 @@</span>
              <span className="dl ctx"> {'<section className="hero">'}</span>
              <span className="dl del">-  {'<h1>Ship faster</h1>'}</span>
              <span className="dl add">+  {'<h1>Ship with care</h1>'}</span>
              <span className="dl ctx">   {'<p>{tagline}</p>'}</span>
            </pre>
          </div>

          <div className="toolbar">
            <span className="toolbar-grip">⠿</span>
            <span className="toolbar-status">
              <b>3</b> regions changed · baseline <code>a1b2c3d</code>
            </span>
            <span className="toolbar-btn">Hide outlines</span>
            <span className="toolbar-btn">History</span>
          </div>
        </div>
      </div>
    </figure>
  );
}
