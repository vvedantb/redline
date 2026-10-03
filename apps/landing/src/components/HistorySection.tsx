import { SectionHeading } from './SectionHeading';

const COMMITS = [
  { sha: 'f4e9a21', subject: 'Tighten hero copy', status: 'Ready' as const, active: true },
  { sha: '9c03b7e', subject: 'Add pricing cards', status: 'Building' as const },
  { sha: '2d81c4a', subject: 'Refactor nav links' },
  { sha: 'a1b2c3d', subject: 'Initial layout' },
];

export function HistorySection() {
  return (
    <section className="section" id="history" aria-labelledby="history-title">
      <div className="shell split split-reverse">
        <div className="split-text">
          <SectionHeading id="history-title" eyebrow="History">
            Open any commit, running
          </SectionHeading>
          <p className="lede">
            The history panel lists recent commits. Click one and Redline builds that commit in a separate git
            worktree, then shows it in an iframe over your page. Click Latest to go back to the live app.
          </p>
          <ul className="points">
            <li>
              <span className="point-key">Worktree builds</span>
              Each commit is built on its own and served at <code>/__redline/h/&lt;sha&gt;/</code>.
            </li>
            <li>
              <span className="point-key">Hands off</span>
              Your working tree is never checked out, restored or reset.
            </li>
            <li>
              <span className="point-key">Read-only</span>
              Env files keep only public keys. GET requests replay recorded fixtures, and writes never reach the
              network.
            </li>
          </ul>
        </div>
        <HistoryMock />
      </div>
    </section>
  );
}

function HistoryMock() {
  return (
    <figure className="mock" aria-label="Illustration: the history panel with a list of commits next to a past commit running in a frame">
      <div className="history-mock" aria-hidden="true">
        <div className="commit-list">
          <div className="commit-list-head">
            <span>History</span>
            <span className="latest-btn">Latest</span>
          </div>
          <ul>
            {COMMITS.map((c) => (
              <li key={c.sha} className={c.active ? 'commit active' : 'commit'}>
                <code className="commit-sha">{c.sha}</code>
                <span className="commit-subject">{c.subject}</span>
                {c.status === 'Ready' && <span className="status status-ready">Ready</span>}
                {c.status === 'Building' && <span className="status status-building">Building…</span>}
              </li>
            ))}
          </ul>
        </div>
        <div className="frame past-frame">
          <div className="frame-bar">
            <span className="frame-dots">
              <i />
              <i />
              <i />
            </span>
            <span className="frame-url">/__redline/h/f4e9a21/</span>
          </div>
          <div className="frame-body past-body">
            <span className="past-tag">viewing f4e9a21</span>
            <div className="wire">
              <div className="wire-nav">
                <span className="blk w-16 h-3 dark" />
                <span className="wire-nav-links">
                  <span className="blk w-8 h-2" />
                  <span className="blk w-8 h-2" />
                </span>
              </div>
              <div className="wire-hero">
                <span className="blk w-60 h-5 dark" />
                <span className="blk w-50 h-2 light" />
                <span className="wire-row">
                  <span className="blk w-btn h-6 dark round" />
                </span>
              </div>
              <div className="wire-cards two">
                <span className="wire-card">
                  <span className="blk w-40 h-2 mid" />
                  <span className="blk w-80 h-2 light" />
                </span>
                <span className="wire-card">
                  <span className="blk w-40 h-2 mid" />
                  <span className="blk w-80 h-2 light" />
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </figure>
  );
}
