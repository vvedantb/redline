'use client';

import { useEffect, useState } from 'react';

export default function StatusWidget() {
  const [status, setStatus] = useState(null);
  useEffect(() => {
    setStatus(JSON.parse('{"services": [}'));
  }, []);
  return <div className="card">{status ? status.services.length + ' services' : 'Checking...'}</div>;
}
