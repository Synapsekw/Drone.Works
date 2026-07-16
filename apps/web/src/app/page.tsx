'use client';

import { useEffect, useState } from 'react';

import { getApiHealth, type ApiHealth } from '@drone-works/contracts/client';

export default function HomePage() {
  const [health, setHealth] = useState<ApiHealth | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    void getApiHealth(window.location.origin, controller.signal)
      .then(setHealth)
      .catch(() => setHealth(null));

    return () => controller.abort();
  }, []);

  return (
    <main>
      <p className="eyebrow">Drone.Works</p>
      <h1>Local foundation</h1>
      <p>
        Web health: <strong>ok</strong>
      </p>
      <p>
        API health: <strong>{health?.status ?? 'checking'}</strong>
      </p>
    </main>
  );
}
