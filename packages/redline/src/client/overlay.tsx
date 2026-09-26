import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { isOverlayEnabled, STORAGE_DISABLED_KEY } from '../flags';
import { matchChangedRegions, type TaggedNode } from '../match';
import { SOURCE_ATTR, parseSource } from '../source';
import type { DiffFile, DiffHunk, DiffResponse } from '../types';
import { DEFAULT_ENDPOINT, REFRESH_EVENT } from './baseline';

export interface RedlineOverlayProps {
  /** Base URL of the Redline endpoints. Default `/__redline`. */
  endpoint?: string;
  /** Force on/off. Default: on outside production builds. */
  enabled?: boolean;
  /** Diff against this git SHA instead of the pinned baseline. */
  baseline?: string | null;
  /** Refetch interval in ms. 0 turns polling off. Default 2000. */
  pollInterval?: number;
  /** Turn the overlay off when the user prefers reduced motion. Default true. */
  respectReducedMotion?: boolean;
  /** Outline colour. */
  color?: string;
}

interface Region {
  key: string;
  el: Element;
  source: string;
  file: DiffFile;
  hunk: DiffHunk;
  line: number;
}

function isProduction(): boolean {
  try {
    return process.env.NODE_ENV === 'production';
  } catch {
    return false;
  }
}

function readFlags(props: RedlineOverlayProps, serverEnabled?: boolean): boolean {
  if (typeof window === 'undefined') return false;
  let storageDisabled: string | null = null;
  try {
    storageDisabled = window.localStorage.getItem(STORAGE_DISABLED_KEY);
  } catch {
    storageDisabled = null;
  }
  return isOverlayEnabled({
    enabled: props.enabled,
    serverEnabled,
    search: window.location.search,
    storageDisabled,
    reducedMotion: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
    respectReducedMotion: props.respectReducedMotion,
    production: isProduction(),
  });
}

function collectRegions(diff: DiffResponse, root: Element | null): Region[] {
  const nodes: TaggedNode<Element>[] = [];
  document.querySelectorAll(`[${SOURCE_ATTR}]`).forEach((el) => {
    if (root?.contains(el)) return;
    const loc = parseSource(el.getAttribute(SOURCE_ATTR));
    if (loc) nodes.push({ ...loc, ref: el });
  });
  const matched = matchChangedRegions(nodes, diff.files);
  const els = new Set(matched.map((m) => m.node.ref));
  // When nested elements share a source location, keep only the deepest.
  const kept = matched.filter((m) => {
    const src = m.node.ref.getAttribute(SOURCE_ATTR);
    for (const other of els) {
      if (other !== m.node.ref && m.node.ref.contains(other) && other.getAttribute(SOURCE_ATTR) === src) return false;
    }
    return true;
  });
  return kept.map((m, i) => ({
    key: `${m.node.ref.getAttribute(SOURCE_ATTR)}#${i}`,
    el: m.node.ref,
    source: m.node.ref.getAttribute(SOURCE_ATTR) ?? '',
    file: m.file,
    hunk: m.hunk,
    line: m.line,
  }));
}

const shortSha = (sha: string | null) => (sha ? sha.replace(/^content:/, 'content ').slice(0, 15) : 'none');

/** Draws outlines around rendered elements whose source changed since the pinned baseline. */
export function RedlineOverlay(props: RedlineOverlayProps) {
  const { endpoint = DEFAULT_ENDPOINT, baseline, pollInterval = 2000, color = '#e11d48' } = props;
  const [diff, setDiff] = useState<DiffResponse | null>(null);
  const [flagTick, setFlagTick] = useState(0);
  const [layoutTick, setLayoutTick] = useState(0);
  const [regions, setRegions] = useState<Region[]>([]);
  const [selected, setSelected] = useState<Region | null>(null);
  const [mounted, setMounted] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => setMounted(true), []);

  const clientActive = useMemo(
    () => mounted && readFlags(props),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mounted, props.enabled, props.respectReducedMotion, flagTick],
  );
  const active = clientActive && diff?.enabled !== false;

  // Re-evaluate flags on navigation, storage changes and reduced-motion changes.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const bump = () => setFlagTick((t) => t + 1);
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    window.addEventListener('storage', bump);
    window.addEventListener('popstate', bump);
    window.addEventListener(REFRESH_EVENT, bump);
    mq?.addEventListener?.('change', bump);
    return () => {
      window.removeEventListener('storage', bump);
      window.removeEventListener('popstate', bump);
      window.removeEventListener(REFRESH_EVENT, bump);
      mq?.removeEventListener?.('change', bump);
    };
  }, []);

  const fetchDiff = useCallback(async () => {
    try {
      const qs = baseline ? `?baseline=${encodeURIComponent(baseline)}` : '';
      const res = await fetch(`${endpoint}/diff${qs}`, { cache: 'no-store' });
      const json = (await res.json()) as DiffResponse;
      if (!res.ok) {
        setDiff({ enabled: true, mode: 'none', baselineSha: null, headSha: null, files: [], error: json.error });
        return;
      }
      setDiff(json);
    } catch {
      setDiff(null);
    }
  }, [endpoint, baseline]);

  useEffect(() => {
    if (!clientActive) return;
    void fetchDiff();
    const onRefresh = () => void fetchDiff();
    window.addEventListener(REFRESH_EVENT, onRefresh);
    const timer = pollInterval > 0 ? window.setInterval(onRefresh, pollInterval) : undefined;
    return () => {
      window.removeEventListener(REFRESH_EVENT, onRefresh);
      if (timer) window.clearInterval(timer);
    };
  }, [clientActive, fetchDiff, pollInterval]);

  // Track DOM changes (outside the overlay) and scroll/resize to keep outlines in place.
  useEffect(() => {
    if (!active) return;
    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        setLayoutTick((t) => t + 1);
      });
    };
    const observer = new MutationObserver((records) => {
      if (records.some((r) => !rootRef.current?.contains(r.target))) schedule();
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true });
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [active]);

  useEffect(() => {
    if (!active || !diff) {
      setRegions([]);
      return;
    }
    setRegions(collectRegions(diff, rootRef.current));
  }, [active, diff, layoutTick]);

  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setSelected(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected]);

  useEffect(() => {
    if (!active) setSelected(null);
  }, [active]);

  if (!mounted || !active || typeof document === 'undefined') return null;

  const layer: CSSProperties = { position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 2147483000 };

  return createPortal(
    <div ref={rootRef} data-redline-root="" style={layer}>
      {regions.map((r) => {
        const rect = r.el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) return null;
        const label = `${r.file.path}:${r.line}`;
        return (
          <div
            key={r.key}
            data-redline-outline=""
            data-redline-target={r.source}
            style={{
              position: 'fixed',
              top: rect.top,
              left: rect.left,
              width: rect.width,
              height: rect.height,
              outline: `2px solid ${color}`,
              outlineOffset: 2,
              background: `${color}14`,
              borderRadius: 2,
              pointerEvents: 'none',
            }}
          >
            <button
              type="button"
              data-redline-hit=""
              aria-label={`Show diff for ${label}`}
              title={label}
              onClick={() => setSelected(r)}
              style={{
                position: 'absolute',
                top: rect.top > 22 ? -22 : 0,
                left: -2,
                pointerEvents: 'auto',
                font: '600 11px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace',
                color: '#fff',
                background: color,
                border: 0,
                borderRadius: 3,
                padding: '0 6px',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {r.file.path.split('/').pop()}:{r.line}
            </button>
          </div>
        );
      })}

      {diff && diff.mode !== 'none' && (
        <div
          data-redline-status=""
          role="status"
          style={{
            position: 'fixed',
            left: 12,
            bottom: 12,
            pointerEvents: 'auto',
            font: '12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace',
            color: '#fff',
            background: '#111827',
            borderRadius: 4,
            padding: '4px 8px',
          }}
        >
          Redline: {regions.length} changed region{regions.length === 1 ? '' : 's'} vs {shortSha(diff.baselineSha)}
          {diff.error ? ` (${diff.error})` : ''}
        </div>
      )}

      {selected && <HunkPanel region={selected} baselineSha={diff?.baselineSha ?? null} onClose={() => setSelected(null)} />}
    </div>,
    document.body,
  );
}

function HunkPanel({ region, baselineSha, onClose }: { region: Region; baselineSha: string | null; onClose: () => void }) {
  const lines = region.hunk.patch.split('\n');
  return (
    <aside
      role="dialog"
      aria-label="Redline diff"
      data-redline-panel=""
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        bottom: 0,
        width: 'min(480px, 100vw)',
        pointerEvents: 'auto',
        background: '#fff',
        color: '#111827',
        borderLeft: '1px solid #e5e7eb',
        boxShadow: '-4px 0 16px rgba(0,0,0,0.12)',
        display: 'flex',
        flexDirection: 'column',
        font: '13px/1.5 system-ui, sans-serif',
      }}
    >
      <header style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderBottom: '1px solid #e5e7eb' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div data-redline-panel-file="" style={{ fontWeight: 600, wordBreak: 'break-all' }}>
            {region.file.path}
          </div>
          <div style={{ color: '#6b7280', fontSize: 12 }}>
            Line {region.line} · hunk {region.hunk.startLine}–{region.hunk.endLine} · {region.file.status} · baseline{' '}
            {shortSha(baselineSha)}
          </div>
        </div>
        <button type="button" onClick={onClose} aria-label="Close diff panel" style={{ cursor: 'pointer' }}>
          Close
        </button>
      </header>
      <pre
        data-redline-patch=""
        style={{ margin: 0, padding: 12, overflow: 'auto', flex: 1, font: '12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace' }}
      >
        {lines.map((l, i) => (
          <div
            key={i}
            style={{
              background: l.startsWith('+') ? '#dcfce7' : l.startsWith('-') ? '#fee2e2' : l.startsWith('@@') ? '#eef2ff' : undefined,
              whiteSpace: 'pre',
            }}
          >
            {l || ' '}
          </div>
        ))}
      </pre>
    </aside>
  );
}
