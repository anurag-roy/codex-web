"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderLoginPage = renderLoginPage;
function escapeHtml(value) {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;");
}
function renderLoginPage(loginUrl) {
    const escapedLoginUrl = escapeHtml(loginUrl);
    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light dark" />
    <title>Sign in · Codex</title>
    <style>
      :root {
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        color: #18181b;
        background: #f5f5f4;
      }
      * { box-sizing: border-box; }
      body {
        min-height: 100vh;
        margin: 0;
        display: grid;
        place-items: center;
        padding: 24px;
        background:
          radial-gradient(circle at 50% 0%, rgba(120, 113, 108, 0.14), transparent 38%),
          #f5f5f4;
      }
      main {
        width: min(100%, 400px);
        padding: 32px;
        border: 1px solid rgba(24, 24, 27, 0.1);
        border-radius: 20px;
        background: rgba(255, 255, 255, 0.88);
        box-shadow: 0 24px 60px rgba(24, 24, 27, 0.1);
        backdrop-filter: blur(16px);
      }
      .mark {
        display: grid;
        width: 44px;
        height: 44px;
        place-items: center;
        margin-bottom: 28px;
        border-radius: 12px;
        color: #fafafa;
        background: #18181b;
        font-size: 19px;
        font-weight: 700;
        letter-spacing: -0.04em;
      }
      h1 {
        margin: 0;
        font-size: 26px;
        line-height: 1.2;
        letter-spacing: -0.035em;
      }
      p {
        margin: 10px 0 26px;
        color: #71717a;
        font-size: 14px;
        line-height: 1.6;
      }
      a {
        display: flex;
        min-height: 46px;
        align-items: center;
        justify-content: center;
        gap: 10px;
        border-radius: 11px;
        color: #fafafa;
        background: #18181b;
        font-size: 14px;
        font-weight: 650;
        text-decoration: none;
        transition: transform 120ms ease, background 120ms ease;
      }
      a:hover { background: #27272a; transform: translateY(-1px); }
      a:focus-visible { outline: 3px solid rgba(59, 130, 246, 0.45); outline-offset: 3px; }
      svg { width: 17px; height: 17px; }
      footer {
        margin-top: 20px;
        color: #a1a1aa;
        font-size: 12px;
        line-height: 1.5;
        text-align: center;
      }
      @media (prefers-color-scheme: dark) {
        :root { color: #f4f4f5; background: #09090b; }
        body {
          background:
            radial-gradient(circle at 50% 0%, rgba(161, 161, 170, 0.12), transparent 38%),
            #09090b;
        }
        main {
          border-color: rgba(244, 244, 245, 0.12);
          background: rgba(24, 24, 27, 0.88);
          box-shadow: 0 24px 60px rgba(0, 0, 0, 0.35);
        }
        .mark, a { color: #18181b; background: #fafafa; }
        a:hover { background: #e4e4e7; }
        p { color: #a1a1aa; }
        footer { color: #71717a; }
      }
    </style>
  </head>
  <body>
    <main>
      <div class="mark" aria-hidden="true">C</div>
      <h1>Sign in to Codex</h1>
      <p>Use your central passkey to securely access this Codex host.</p>
      <a href="${escapedLoginUrl}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <circle cx="7.5" cy="15.5" r="3.5" />
          <path d="M10.5 13.5 20 4m-3 3 3 3m-6 0 3 3" />
        </svg>
        Continue with passkey
      </a>
      <footer>Authentication is handled by auth.anuragroy.dev</footer>
    </main>
  </body>
</html>`;
}
//# sourceMappingURL=login-page.js.map