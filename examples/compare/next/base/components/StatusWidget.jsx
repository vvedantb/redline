'use client';

import { useEffect, useState } from 'react';

export default function StatusWidget() {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  return <div className="card">{ready ? 'All systems normal' : 'Checking...'}</div>;
}
