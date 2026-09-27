import { Suspense, use, useState } from 'react';

interface Note {
  id: string;
  text: string;
}

// Started once at module load. In History, the Redline network bootstrap has already patched
// fetch, so this replays `network-fixtures.json` instead of calling the live API.
const notesRequest: Promise<Note[]> = fetch('/api/demo/notes')
  .then((res) => res.json())
  .then((data: { notes?: Note[] }) => data.notes ?? [])
  .catch(() => []);

// Set on the live dev server in E2E. History builds strip it from the build environment.
const backendUrl: string = import.meta.env.VITE_CONVEX_URL ?? 'unset';

function NoteList() {
  const notes = use(notesRequest);
  return (
    <ul className="notes-list">
      {notes.map((note) => (
        <li key={note.id} data-testid="demo-note">
          {note.text}
        </li>
      ))}
    </ul>
  );
}

export function NotesFeed() {
  const [result, setResult] = useState<'saved' | 'read-only' | 'failed' | null>(null);
  const write = async () => {
    try {
      const res = await fetch('/api/demo/notes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'New note' }),
      });
      const body: { readOnly?: boolean } = await res.json();
      setResult(res.headers.get('x-redline-read-only') === '1' || body.readOnly ? 'read-only' : 'saved');
    } catch {
      setResult('failed');
    }
  };
  return (
    <section className="notes" data-testid="demo-notes">
      <h2>Notes</h2>
      <Suspense fallback={<p>Loading notes…</p>}>
        <NoteList />
      </Suspense>
      <button type="button" className="cta" data-testid="demo-notes-write" onClick={write}>
        Add note
      </button>
      {result && <p data-testid="demo-notes-write-result">{result}</p>}
      <p className="notes-env" data-testid="demo-backend-url">
        Backend URL: {backendUrl}
      </p>
    </section>
  );
}
