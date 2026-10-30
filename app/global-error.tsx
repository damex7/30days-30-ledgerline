"use client";

export default function GlobalError({ retry }: { error: Error; retry: () => void }) {
  return (
    <html lang="en-NG">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: "2rem", background: "#fff", color: "#121110" }}>
        <h1>Ledgerline hit a problem</h1>
        <p>Please try again in a moment.</p>
        <button type="button" onClick={() => retry()}>
          Try again
        </button>
      </body>
    </html>
  );
}
