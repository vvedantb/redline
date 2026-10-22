import { useEffect, useState } from 'react';
import Layout from '../components/Layout';

// A root-absolute fetch, as many apps write it. It only resolves when the build is served at `/`.
export default function Team() {
  const [names, setNames] = useState(null);
  useEffect(() => {
    fetch('/team.json')
      .then((res) => (res.ok ? res.json() : []))
      .then(setNames, () => setNames([]));
  }, []);
  return (
    <Layout>
      <h1>Team</h1>
      {names === null ? <p>Loading...</p> : names.length ? <ul>{names.map((n) => <li key={n}>{n}</li>)}</ul> : <p>No team yet.</p>}
    </Layout>
  );
}
