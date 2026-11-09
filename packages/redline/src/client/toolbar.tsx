import { useEffect, useRef, useState, type CSSProperties, type FocusEvent, type PointerEvent } from 'react';
import { matchPattern } from '../routes/pattern';
import type { BuildJob, BuildStatus, ChangedPage, CommitInfo, PagesResponse } from '../types';
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

function clampPosition(p: { x: number; y: number }): { x: number; y: number } {
  const x = Math.min(Math.max(p.x, 0), window.innerWidth - MIN_VISIBLE);
  const y = Math.min(Math.max(p.y, 0), window.innerHeight - MIN_VISIBLE);
  return { x, y };
}

/** Logo button size in px. The saved position is its top-left corner. */
const LOGO = 28;
/** A press becomes a drag once the pointer moves this far, in px. */
const DRAG_THRESHOLD = 4;
/** Delay before the toolbar collapses after the pointer leaves, so a small slip does not close it. */
const COLLAPSE_DELAY = 200;

const logoStyle: CSSProperties = {
  position: 'relative',
  flex: 'none',
  display: 'grid',
  placeItems: 'center',
  width: LOGO,
  height: LOGO,
  padding: 0,
  border: 0,
  borderRadius: 6,
  background: 'transparent',
  cursor: 'grab',
  touchAction: 'none',
};

const badgeStyle: CSSProperties = {
  position: 'absolute',
  top: -4,
  right: -4,
  boxSizing: 'border-box',
  minWidth: 14,
  height: 14,
  padding: '0 3px',
  borderRadius: 7,
  background: '#e11d48',
  color: '#fff',
  font: `10px/14px ${MONO}`,
  textAlign: 'center',
};

function RedlineMark() {
  return (
    <svg width={14} height={14} viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <rect x="1" y="1" width="12" height="12" rx="2" stroke="#e11d48" strokeWidth="2" />
      <rect x="4.5" y="4.5" width="5" height="5" rx="1" fill="#e11d48" />
    </svg>
  );
}

export interface ToolbarProps {
  prefs: ToolbarPrefs;
  status: string;
  /** Changed regions on the live app. Shown as a badge on the logo. */
  count: number;
  viewing: CommitInfo | null;
  historyOpen: boolean;
  onToggleHistory: () => void;
  /** The changed pages list, or null with no baseline pinned. The button shows whenever it is set. */
  pages: PagesState | null;
  pagesOpen: boolean;
  onTogglePages: () => void;
  onLatest: () => void;
}

/**
 * Floating toolbar. Collapsed, it is the Redline logo with a changed-region badge. It expands to show the
 * status, outline toggle, changed pages, history and view-mode indicator while the mouse is over it, keyboard
 * focus is in it, the logo was clicked to pin it, or a panel or history commit is open. The logo is also the
 * drag handle. Collapsed controls stay mounted, so the status text stays in the DOM.
 */
export function Toolbar(props: ToolbarProps) {
  const { prefs, status, count, viewing, historyOpen, onToggleHistory, pages, pagesOpen, onTogglePages, onLatest } = props;
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pinned, setPinned] = useState(false);
  // Current press on the logo: pointer offset inside the logo, start point, and whether it became a drag.
  const press = useRef<{ dx: number; dy: number; x: number; y: number; dragging: boolean } | null>(null);
  // Set when a press ended as a drag, so the click that follows does not toggle `pinned`.
  const dragged = useRef(false);
  const collapseTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(collapseTimer.current), []);

  const expanded = hovered || focused || pinned || historyOpen || pagesOpen || viewing !== null;

  const onPointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    press.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top, x: e.clientX, y: e.clientY, dragging: false };
    dragged.current = false;
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent<HTMLButtonElement>) => {
    const p = press.current;
    if (!p) return;
    if (!p.dragging && Math.hypot(e.clientX - p.x, e.clientY - p.y) <= DRAG_THRESHOLD) return;
    p.dragging = true;
    setToolbarPrefs({ position: { x: e.clientX - p.dx, y: e.clientY - p.dy } });
  };
  const endPress = () => {
    dragged.current = press.current?.dragging ?? false;
    press.current = null;
  };
  const onClick = () => {
    if (dragged.current) dragged.current = false;
    else setPinned(!pinned);
  };

  const onPointerEnter = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'mouse') return;
    clearTimeout(collapseTimer.current);
    setHovered(true);
  };
  const onPointerLeave = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'mouse') return;
    clearTimeout(collapseTimer.current);
    collapseTimer.current = setTimeout(() => setHovered(false), COLLAPSE_DELAY);
  };
  // Keyboard focus only: a mouse click on the logo focuses it too, and that must not keep the bar open.
  const onFocus = (e: FocusEvent<HTMLDivElement>) => setFocused(e.target instanceof Element && e.target.matches(':focus-visible'));
  const onBlur = (e: FocusEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget)) setFocused(false);
  };

  // Logo in the right half: grow leftwards, anchored by `right`, so the logo stays put as the bar expands.
  const at = prefs.position ? clampPosition(prefs.position) : null;
  const viewportWidth = document.documentElement.clientWidth;
  const growLeft = at !== null && at.x + LOGO / 2 > viewportWidth / 2;
  const place: CSSProperties = at
    ? growLeft
      ? { right: viewportWidth - at.x - LOGO, top: at.y }
      : { left: at.x, top: at.y }
    : { left: 12, bottom: 12 };

  return (
    <div
      role="toolbar"
      aria-label="Redline"
      data-redline-toolbar=""
      data-redline-expanded={String(expanded)}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onFocus={onFocus}
      onBlur={onBlur}
      style={{
        position: 'fixed',
        ...place,
        display: 'flex',
        flexDirection: growLeft ? 'row-reverse' : 'row',
        alignItems: 'center',
        pointerEvents: 'auto',
        font: `12px/1.4 ${MONO}`,
        color: '#fff',
        background: '#111827',
        borderRadius: 6,
        boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
        userSelect: 'none',
      }}
    >
      <button
        type="button"
        data-redline-drag=""
        aria-label={status}
        aria-expanded={expanded}
        title="Redline. Drag to move. Double-click to reset."
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPress}
        onPointerCancel={endPress}
        onClick={onClick}
        onDoubleClick={() => setToolbarPrefs({ position: null })}
        style={logoStyle}
      >
        <RedlineMark />
        {count > 0 && !viewing && (
          <span aria-hidden="true" style={badgeStyle}>
            {count}
          </span>
        )}
      </button>
      <div
        style={{
          display: expanded ? 'flex' : 'none',
          alignItems: 'center',
          gap: 6,
          padding: growLeft ? '4px 0 4px 6px' : '4px 6px 4px 0',
        }}
      >
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
        {pages && (
          <button type="button" aria-expanded={pagesOpen} onClick={onTogglePages} style={buttonStyle}>
            {pagesButtonLabel(pages)}
          </button>
        )}
        <button type="button" aria-expanded={historyOpen} onClick={onToggleHistory} style={buttonStyle}>
          History
        </button>
      </div>
    </div>
  );
}

/** Left-side panel shared by History and Changed pages. */
const sidePanel: CSSProperties = {
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
};

const panelHeader: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: '#f9fafb' };

const intro: CSSProperties = { margin: 0, padding: '8px 12px', color: '#6b7280', fontSize: 12 };

function row(active: boolean): CSSProperties {
  return {
    display: 'flex',
    gap: 10,
    alignItems: 'center',
    width: '100%',
    boxSizing: 'border-box',
    textAlign: 'left',
    padding: '8px 12px',
    border: 0,
    borderLeft: `3px solid ${active ? '#e11d48' : 'transparent'}`,
    background: active ? '#fff1f2' : 'transparent',
    color: 'inherit',
    font: 'inherit',
    textDecoration: 'none',
    cursor: 'pointer',
  };
}

export type PagesState = { status: 'loading' } | { status: 'error'; error: string } | { status: 'ready'; response: PagesResponse };

/** Toolbar button text: the count once known, `…` while loading or after an error. */
export function pagesButtonLabel(pages: PagesState): string {
  return `Changed pages (${pages.status === 'ready' ? pages.response.pages.length : '…'})`;
}

const trimSlash = (p: string) => p.replace(/\/+$/, '') || '/';

/** The page the browser is on: its link, or for a dynamic route without one, the pattern. */
export function isCurrentPage(page: ChangedPage, location: { pathname: string; search: string }): boolean {
  if (page.status === 'removed') return false;
  if (!page.url) return matchPattern(page.route, location.pathname);
  const url = new URL(page.url, 'http://x');
  return trimSlash(url.pathname) === trimSlash(location.pathname) && (!url.search || url.search === location.search);
}

function PageSource({ page }: { page: ChangedPage }) {
  const first = page.sources[0];
  if (!first) return null;
  const more = page.sources.length - 1;
  return (
    <div style={{ color: '#6b7280', fontSize: 12, wordBreak: 'break-all' }}>
      {page.confidence} confidence · <code style={{ font: `12px ${MONO}` }}>{first.file}</code>
      {more > 0 ? ` +${more} more` : ''}
    </div>
  );
}

export interface PagesPanelProps {
  pages: PagesState;
  location: { pathname: string; search: string };
  onRefresh: () => void;
  onClose: () => void;
}

/** Pages the changed files reach, as links in the same tab. Direct causes first, then removed pages. */
export function PagesPanel({ pages, location, onRefresh, onClose }: PagesPanelProps) {
  return (
    <aside role="dialog" aria-label="Redline changed pages" data-redline-pages="" style={sidePanel}>
      <header style={panelHeader}>
        <div style={{ flex: 1, fontWeight: 600 }}>Changed pages</div>
        <button type="button" onClick={onRefresh} style={{ cursor: 'pointer' }}>
          Refresh
        </button>
        <button type="button" onClick={onClose} aria-label="Close changed pages panel" style={{ cursor: 'pointer' }}>
          Close
        </button>
      </header>
      <p style={intro}>Pages that use the changed files, the most direct first. Open one to see its outlines.</p>
      <div style={{ flex: 1, overflow: 'auto' }}>
        {pages.status === 'loading' && <p style={{ padding: '8px 12px', margin: 0 }}>Loading…</p>}
        {pages.status === 'error' && (
          <p role="alert" style={{ padding: '8px 12px', margin: 0, color: '#b91c1c' }}>
            {pages.error}
          </p>
        )}
        {pages.status === 'ready' && pages.response.error && (
          <p role="alert" style={{ padding: '8px 12px', margin: 0, color: '#b91c1c', fontSize: 12 }}>
            {pages.response.error}
          </p>
        )}
        {pages.status === 'ready' && pages.response.pages.length === 0 && (
          <p style={{ padding: '8px 12px', margin: 0, color: '#6b7280' }}>No pages use the changed files.</p>
        )}
        {pages.status === 'ready' &&
          pages.response.pages.map((p) => {
            const current = isCurrentPage(p, location);
            const body = (
              <div style={{ flex: 1, minWidth: 0 }}>
                <div>
                  <code style={{ font: `12px ${MONO}`, wordBreak: 'break-all' }}>{p.url ?? p.route}</code>
                  {p.status === 'removed' && <span style={{ color: '#b91c1c', fontWeight: 600 }}> Removed</span>}
                  {current && <span style={{ color: '#e11d48', fontWeight: 600 }}> · this page</span>}
                </div>
                {p.needsExample && (
                  <div style={{ fontSize: 12 }}>Needs an example URL: add one to "seeds" in redline.config.json.</div>
                )}
                <PageSource page={p} />
              </div>
            );
            return p.url ? (
              <a key={p.route} href={p.url} data-redline-page={p.route} aria-current={current ? 'page' : undefined} style={row(current)}>
                {body}
              </a>
            ) : (
              <div key={p.route} data-redline-page={p.route} aria-current={current ? 'page' : undefined} style={{ ...row(current), cursor: 'default' }}>
                {body}
              </div>
            );
          })}
      </div>
    </aside>
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

  return (
    <aside role="dialog" aria-label="Redline history" data-redline-history="" style={sidePanel}>
      <header style={panelHeader}>
        <div style={{ flex: 1, fontWeight: 600 }}>History</div>
        <button type="button" onClick={onRefresh} style={{ cursor: 'pointer' }}>
          Refresh
        </button>
        <button type="button" onClick={onClose} aria-label="Close history panel" style={{ cursor: 'pointer' }}>
          Close
        </button>
      </header>
      <p style={intro}>
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
