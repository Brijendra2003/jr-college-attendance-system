'use client';

// Last-resort error page (the root layout itself failed). Must render its own <html>.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', display: 'grid', placeItems: 'center', minHeight: '100vh', margin: 0, background: '#f6f7fb' }}>
        <div style={{ maxWidth: 420, padding: 32, background: '#fff', borderRadius: 14, border: '1px solid #e5e7eb', textAlign: 'center' }}>
          <h1 style={{ fontSize: 18, margin: 0 }}>Something went wrong</h1>
          <p style={{ fontSize: 14, color: '#4b5563' }}>
            Please try again. If it keeps happening, tell the office and mention reference <code>{error.digest ?? 'n/a'}</code>.
          </p>
          <button onClick={reset} style={{ padding: '8px 16px', borderRadius: 8, border: 0, background: '#2f4ac0', color: '#fff', cursor: 'pointer' }}>
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
