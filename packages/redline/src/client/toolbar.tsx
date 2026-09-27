import { useRef, type CSSProperties, type PointerEvent } from 'react';
import type { BuildJob, BuildStatus, CommitInfo } from '../types';
import { setToolbarPrefs, type ToolbarPrefs } from './prefs';

const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';

const buttonStyle: CSSProperties = {
  font: `12px/1.4 ${MONO}`,
  color: '#fff',
  background: '#374151',
  border: 0,
  borderRadius: 3,
  padding: '2px 8px',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

/** Keep at least this much of the toolbar on screen when restoring a saved position. */
const MIN_VISIBLE = 48;

function clampPosition(p: { x: number; y: number }): CSSProperties {
  const x = Math.min(Math.max(p.x, 0), window.innerWidth - MIN_VISIBLE);
  const y = Math.min(Math.max(p.y, 0), window.innerHeight - MIN_VISIBLE);
  return { left: x, top: y };
}

export interface ToolbarProps {
  prefs: ToolbarPrefs;
  status: string;
  viewing: CommitInfo | null;
  historyOpen: boolean;
  onToggleHistory: () => void;
  onLatest: () => void;
}

/** Floating toolbar: drag handle, status, outline toggle, history and view-mode indicator. */
export function Toolbar({ prefs, status, viewing, historyOpen, onToggleHistory, onLatest }: ToolbarProps) {
  // Pointer offset inside the toolbar for the current drag gesture. Not render state.
  const grab = useRef<{ dx: number; dy: number } | null>(null);

  const onPointerDown = (e: PointerEvent<HTMLSpanElement>) => {
    const bar = e.currentTarget.parentElement;
    if (!bar || e.button !== 0) return;
    const rect = bar.getBoundingClientRect();
    grab.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  const onPointerMove = (e: PointerEvent<HTMLSpanElement>) => {
    if (!grab.current) return;
    setToolbarPrefs({ position: { x: e.clientX - grab.current.dx, y: e.clientY - grab.current.dy } });
  };
  const endDrag = () => {
    grab.current = null;
  };

  const place = prefs.position ? clampPosition(prefs.position) : { left: 12, bottom: 12 };

  return (
    <div
      role="toolbar"
      aria-label="Redline"
      data-redline-toolbar=""
      style={{
        position: 'fixed',
        ...place,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        pointerEvents: 'auto',
        font: `12px/1.4 ${MONO}`,
        color: '#fff',
        background: '#111827',
        borderRadius: 6,
        padding: '4px 6px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
        userSelect: 'none',
      }}
    >
      <span
        data-redline-drag=""
        aria-hidden="true"
        title="Drag to move. Double-click to reset."
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={() => setToolbarPrefs({ position: null })}
        style={{ cursor: 'grab', padding: '0 2px', color: '#9ca3af', touchAction: 'none' }}
      >
        ⠿
      </span>
      <span data-redline-status="" role="status">
        {status}
      </span>
      {viewing && (
        <>
          <span data-redline-viewing={viewing.sha} style={{ color: '#fbbf24' }}>
            Viewing {viewing.shortSha}
          </span>
          <button type="button" onClick={onLatest} style={buttonStyle}>
            Latest
          </button>
        </>
      )}
      <button
        type="button"
        aria-pressed={!prefs.outlines}
        onClick={() => setToolbarPrefs({ outlines: !prefs.outlines })}
        style={buttonStyle}
      >
        {prefs.outlines ? 'Hide outlines' : 'Show outlines'}
      </button>
      <button type="button" aria-expanded={historyOpen} onClick={onToggleHistory} style={buttonStyle}>
        History
      </button>
    </div>
  );
}

export type HistoryState =
  | { status: 'loading' }
  | { status: 'error'; error: string }
  | { status: 'ready'; headSha: string | null; commits: CommitInfo[] };

export interface HistoryPanelProps {
  endpoint: string;
  history: HistoryState;
  builds: Record<string, BuildJob>;
  buildError: string | null;
  viewing: CommitInfo | null;
  onSelect: (commit: CommitInfo) => void;
  onRetry: (commit: CommitInfo) => void;
  onLatest: () => void;
  onRefresh: () => void;
  onClose: () => void;
}

const BUILD_LABEL: Record<BuildStatus, string> = {
  queued: 'Queued',
  building: 'Building',
  ready: 'Ready',
  failed: 'Failed',
};

const BUILD_COLOR: Record<BuildStatus, string> = {
  queued: '#6b7280',
  building: '#b45309',
  ready: '#047857',
  failed: '#b91c1c',
};

function BuildBadge({ job }: { job: BuildJob | undefined }) {
  if (!job) return <span style={{ color: '#9ca3af' }}>Not built</span>;
  return (
    <span data-redline-build={job.status} style={{ color: BUILD_COLOR[job.status], fontWeight: 600 }}>
      {BUILD_LABEL[job.status]}
      {job.status === 'building' || job.status === 'queued' ? '…' : ''}
    </span>
  );
}

/** Screenshot of a ready build, or a grey placeholder while there is none. */
function Thumb({ endpoint, job }: { endpoint: string; job: BuildJob | undefined }) {
  const box: CSSProperties = { flex: 'none', width: 64, height: 40, borderRadius: 3, background: '#e5e7eb', overflow: 'hidden' };
  if (job?.thumbnail !== 'ready') return <div aria-hidden="true" data-redline-thumb={job?.thumbnail ?? 'none'} style={box} />;
  return (
    <img
      alt=""
      data-redline-thumb=""
      src={`${endpoint}/build/thumb?sha=${job.sha}&t=${encodeURIComponent(job.finishedAt ?? '')}`}
      style={{ ...box, objectFit: 'cover', objectPosition: 'top' }}
    />
  );
}

function LogTail({ lines }: { lines: string[] | undefined }) {
  if (!lines?.length) return null;
  return (
    <pre
      data-redline-log=""
      style={{
        margin: '4px 0 0',
        padding: 6,
        maxHeight: 120,
        overflow: 'auto',
        background: '#f3f4f6',
        borderRadius: 3,
        font: `11px/1.4 ${MONO}`,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-all',
      }}
    >
      {lines.join('\n')}
    </pre>
  );
}

function timeAgo(iso: string): string {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (!Number.isFinite(s)) return '';
  if (s < 60) return 'just now';
  const units: [number, string][] = [
    [60, 'm'],
    [60, 'h'],
    [24, 'd'],
    [30, 'mo'],
    [12, 'y'],
  ];
  let value = s;
  let unit = 's';
  for (const [size, name] of units) {
    if (value < size) break;
    value = Math.floor(value / size);
    unit = name;
  }
  return `${value}${unit} ago`;
}

/** Commit list. Selecting a commit queues a production build of it and shows it when ready. */
export function HistoryPanel(props: HistoryPanelProps) {
  const { endpoint, history, builds, buildError, viewing, onSelect, onRetry, onLatest, onRefresh, onClose } = props;
  const row = (active: boolean): CSSProperties => ({
    display: 'flex',
    gap: 10,
    alignItems: 'center',
    width: '100%',
    textAlign: 'left',
    padding: '8px 12px',
    border: 0,
    borderLeft: `3px solid ${active ? '#e11d48' : 'transparent'}`,
    background: active ? '#fff1f2' : 'transparent',
    color: 'inherit',
    font: 'inherit',
    cursor: 'pointer',
  });

  return (
    <aside
      role="dialog"
      aria-label="Redline history"
      data-redline-history=""
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        bottom: 0,
        width: 'min(360px, 100vw)',
        pointerEvents: 'auto',
        background: '#fff',
        color: '#111827',
        boxShadow: '4px 0 16px rgba(0,0,0,0.12)',
        display: 'flex',
        flexDirection: 'column',
        font: '13px/1.5 system-ui, sans-serif',
      }}
    >
      <header style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: '#f9fafb' }}>
        <div style={{ flex: 1, fontWeight: 600 }}>History</div>
        <button type="button" onClick={onRefresh} style={{ cursor: 'pointer' }}>
          Refresh
        </button>
        <button type="button" onClick={onClose} aria-label="Close history panel" style={{ cursor: 'pointer' }}>
          Close
        </button>
      </header>
      <p style={{ margin: 0, padding: '8px 12px', color: '#6b7280', fontSize: 12 }}>
        Pick a commit to build it and see the app as it was. Builds run in a separate git worktree, so your files are
        not touched. Latest returns to the live app.
      </p>
      {buildError && (
        <p role="alert" style={{ padding: '0 12px 8px', margin: 0, color: '#b91c1c', fontSize: 12 }}>
          {buildError}
        </p>
      )}
      <div style={{ flex: 1, overflow: 'auto' }}>
        <button type="button" data-redline-commit="latest" aria-current={!viewing} onClick={onLatest} style={row(!viewing)}>
          <div>
            <div style={{ fontWeight: 600 }}>Latest</div>
            <div style={{ color: '#6b7280', fontSize: 12 }}>Live app with outlines</div>
          </div>
        </button>
        {history.status === 'loading' && <p style={{ padding: '8px 12px', margin: 0 }}>Loading…</p>}
        {history.status === 'error' && (
          <p role="alert" style={{ padding: '8px 12px', margin: 0, color: '#b91c1c' }}>
            {history.error}
          </p>
        )}
        {history.status === 'ready' &&
          history.commits.map((c) => {
            const active = viewing?.sha === c.sha;
            const job = builds[c.sha];
            return (
              <div key={c.sha}>
                <button
                  type="button"
                  data-redline-commit={c.sha}
                  aria-current={active}
                  onClick={() => onSelect(c)}
                  title={c.sha}
                  style={row(active)}
                >
                  <Thumb endpoint={endpoint} job={job} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.subject}</div>
                    <div style={{ color: '#6b7280', fontSize: 12 }}>
                      <code style={{ font: `12px ${MONO}` }}>{c.shortSha}</code>
                      {c.sha === history.headSha ? ' · HEAD' : ''} · {c.author} · {timeAgo(c.date)}
                    </div>
                    <div style={{ fontSize: 12 }}>
                      <BuildBadge job={job} />
                    </div>
                  </div>
                </button>
                {job && (job.status === 'building' || job.status === 'failed') && (
                  <div style={{ padding: '0 12px 8px 15px' }}>
                    {job.error && <div style={{ color: '#b91c1c', fontSize: 12 }}>{job.error}</div>}
                    <LogTail lines={job.logTail} />
                    {job.status === 'failed' && (
                      <button type="button" onClick={() => onRetry(c)} style={{ ...buttonStyle, marginTop: 4 }}>
                        Retry
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
      </div>
    </aside>
  );
}

export interface HistoryFrameProps {
  commit: CommitInfo;
  job: BuildJob | undefined;
  error: string | null;
  onRetry: () => void;
}

/**
 * The selected commit's production build in an iframe, or its build status until it is ready.
 * Rendered under the toolbar and History panel, so both stay usable.
 */
export function HistoryFrame({ commit, job, error, onRetry }: HistoryFrameProps) {
  const surface: CSSProperties = {
    position: 'fixed',
    inset: 0,
    width: '100%',
    height: '100%',
    border: 0,
    pointerEvents: 'auto',
    background: '#fff',
  };
  if (job?.status === 'ready') {
    return <iframe data-redline-frame={commit.sha} title={`Redline build of ${commit.shortSha}`} src={job.basePath} style={surface} />;
  }
  const label = job ? BUILD_LABEL[job.status] : error ? 'Failed' : 'Queued';
  return (
    <div
      data-redline-frame-status={job?.status ?? 'queued'}
      style={{ ...surface, display: 'grid', placeItems: 'center', color: '#111827', font: '13px/1.5 system-ui, sans-serif' }}
    >
      <div style={{ width: 'min(560px, 90vw)' }}>
        <div style={{ fontWeight: 600 }}>
          {label} <code style={{ font: `13px ${MONO}` }}>{commit.shortSha}</code>
          {job?.status === 'building' || job?.status === 'queued' ? '…' : ''}
        </div>
        <div style={{ color: '#6b7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {commit.subject}
        </div>
        {(job?.error ?? error) && <div style={{ color: '#b91c1c', marginTop: 4 }}>{job?.error ?? error}</div>}
        <LogTail lines={job?.logTail} />
        {(job?.status === 'failed' || (!job && error)) && (
          <button type="button" onClick={onRetry} style={{ ...buttonStyle, marginTop: 8 }}>
            Retry
          </button>
        )}
      </div>
    </div>
  );
}
