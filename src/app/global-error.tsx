"use client";

import { useEffect } from "react";

/**
 * Last-resort boundary for an error thrown by app/layout.tsx itself (the one
 * case app/error.tsx cannot catch, since it lives inside that same layout).
 * Replaces the entire document, so it must render its own <html>/<body> and
 * cannot assume any app shell/CSS class survived - inline styles only.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="ja">
      <body style={{ margin: 0, fontFamily: "sans-serif" }}>
        <div
          style={{
            display: "flex",
            minHeight: "100vh",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "1rem",
            padding: "1rem",
            textAlign: "center",
          }}
        >
          <p style={{ fontSize: "1rem", fontWeight: 600 }}>問題が発生しました</p>
          <p style={{ fontSize: "0.875rem", color: "#666" }}>
            一時的なエラーが発生しました。しばらくしてから、もう一度お試しください。
          </p>
          <button
            onClick={() => reset()}
            style={{
              marginTop: "0.5rem",
              padding: "0.5rem 1rem",
              borderRadius: "0.375rem",
              border: "1px solid #ccc",
              background: "white",
              cursor: "pointer",
            }}
          >
            再試行する
          </button>
        </div>
      </body>
    </html>
  );
}
