'use client';

import { useEffect, useState } from 'react';

// A root-absolute fetch, as many apps write it. It only resolves when the build is served at `/`.
export default function Team() {
  const [names, setNames] = useState(null);
  useEffect(() => {
    fetch('/api/team')
      .then((res) => (res.ok ? res.json() : []))
      .then(setNames, () => setNames([]));
  }, []);
  return (
    <main>
      <h1>Team</h1>
      {names === null ? <p>Loading...</p> : names.length ? <ul>{names.map((n) => <li key={n}>{n}</li>)}</ul> : <p>No team yet.</p>}
    </main>
  );
}
