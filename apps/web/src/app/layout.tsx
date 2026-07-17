import type { ReactNode } from 'react';

import './styles.css';
import 'maplibre-gl/dist/maplibre-gl.css';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
