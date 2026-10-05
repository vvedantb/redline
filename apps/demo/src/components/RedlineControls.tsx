import { clearBaseline, getBaseline, pinBaseline, REFRESH_EVENT, type BaselineState } from '@vvedantb/redline/overlay';
import { useCallback, useEffect, useState } from 'react';

interface Props {
  overlayOn: boolean;
  onToggleOverlay: (on: boolean) => void;
}

const short = (sha: string | null | undefined) => (sha ? sha.slice(0, 12) : 'none');

export function RedlineControls({ overlayOn, onToggleOverlay }: Props) {
  const [state, setState] = useState<BaselineState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState(await getBaseline());
  }, []);

  useEffect(() => {
    void load();
    window.addEventListener(REFRESH_EVENT, load);
    return () => window.removeEventListener(REFRESH_EVENT, load);
  }, [load]);

  const run = async (fn: () => Promise<BaselineState>) => {
    setError(null);
    try {
      setState(await fn());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <aside className="controls" aria-label="Redline controls">
      <div>
        Current SHA: <code data-testid="head-sha">{short(state?.headSha)}</code>
      </div>
      <div>
        Pinned: <code data-testid="pinned-sha">{short(state?.baseline?.sha)}</code>
        {state?.baseline && <span className="muted"> ({state.baseline.mode})</span>}
      </div>
      <button type="button" onClick={() => run(() => pinBaseline())}>
        Pin baseline (HEAD)
      </button>
      <button type="button" onClick={() => run(() => clearBaseline())}>
        Clear
      </button>
      <label>
        <input type="checkbox" checked={overlayOn} onChange={(e) => onToggleOverlay(e.target.checked)} /> Overlay
      </label>
      {error && <span className="error">{error}</span>}
    </aside>
  );
}
