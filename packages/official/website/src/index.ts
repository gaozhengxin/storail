// Copyright (C) 2026 Defa Wang

interface Env {
  ASSETS: Fetcher;
  GITHUB_URL?: string;
  DOCS_PATH?: string;
  WEBSITE_CANONICAL_URL?: string;
}

const DEFAULT_GITHUB_URL = "https://github.com/gaozhengxin/storail";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/" || url.pathname === "/index.html") {
      return html(renderHome(env), env);
    }

    if (url.pathname === "/docs") {
      url.pathname = "/docs/";
      return Response.redirect(url.toString(), 301);
    }

    if (url.pathname === "/docs/") {
      const assetUrl = new URL(request.url);
      assetUrl.pathname = "/docs/index.html";
      return env.ASSETS.fetch(new Request(assetUrl, request));
    }

    return env.ASSETS.fetch(request);
  },
};

function renderHome(env: Env): string {
  const githubUrl = env.GITHUB_URL || DEFAULT_GITHUB_URL;
  const docsPath = env.DOCS_PATH || "/docs/";
  const canonical = env.WEBSITE_CANONICAL_URL || "";
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    ${canonical ? `<link rel="canonical" href="${escapeAttribute(canonical)}">` : ""}
    <title>Storail</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f7f8f5;
        --text: #202124;
        --muted: #5f6368;
        --line: #d8ddd6;
        --accent: #0f766e;
        --accent-strong: #115e59;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        color: var(--text);
        background: var(--bg);
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .shell {
        min-height: 100vh;
        display: grid;
        grid-template-rows: auto 1fr auto;
      }
      header, main, footer {
        width: min(1040px, calc(100% - 40px));
        margin: 0 auto;
      }
      header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 24px 0;
        border-bottom: 1px solid var(--line);
      }
      .brand {
        font-size: 18px;
        font-weight: 700;
      }
      nav {
        display: flex;
        gap: 18px;
      }
      a {
        color: var(--accent-strong);
        text-decoration: none;
      }
      a:hover { text-decoration: underline; }
      main {
        display: grid;
        align-content: center;
        padding: 72px 0 84px;
      }
      .hero {
        max-width: 780px;
      }
      h1 {
        margin: 0 0 22px;
        font-size: clamp(42px, 8vw, 88px);
        line-height: 0.98;
        letter-spacing: 0;
      }
      p {
        margin: 0;
        color: var(--muted);
        font-size: 19px;
        line-height: 1.65;
      }
      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 14px;
        margin-top: 34px;
      }
      .button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 44px;
        padding: 0 18px;
        border: 1px solid var(--line);
        border-radius: 6px;
        background: #fff;
        font-weight: 650;
      }
      .button.primary {
        color: #fff;
        border-color: var(--accent);
        background: var(--accent);
      }
      .notes {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 18px;
        margin-top: 58px;
        max-width: 920px;
      }
      .note {
        border-top: 1px solid var(--line);
        padding-top: 16px;
      }
      .note strong {
        display: block;
        margin-bottom: 7px;
      }
      .note span {
        color: var(--muted);
        line-height: 1.55;
      }
      footer {
        padding: 22px 0 30px;
        color: var(--muted);
        border-top: 1px solid var(--line);
      }
      @media (max-width: 760px) {
        header {
          align-items: flex-start;
          gap: 16px;
          flex-direction: column;
        }
        nav { flex-wrap: wrap; }
        main { padding: 52px 0 64px; }
        .notes { grid-template-columns: 1fr; }
      }
    </style>
  </head>
  <body>
    <div class="shell">
      <header>
        <div class="brand">Storail</div>
        <nav>
          <a href="${escapeAttribute(docsPath)}">Docs</a>
          <a href="${escapeAttribute(`${docsPath.replace(/\/$/, "")}/contact`)}">Contact</a>
          <a href="${escapeAttribute(githubUrl)}" rel="noreferrer">GitHub</a>
        </nav>
      </header>
      <main>
        <section class="hero">
          <h1>Consensus-backed app state without operating a backend.</h1>
          <p>Storail is a low-cost serverless stack for permissioned event logs, gasless writes, and verifiable content references on public EVM infrastructure.</p>
          <div class="actions">
            <a class="button primary" href="${escapeAttribute(docsPath)}">Read Documentation</a>
            <a class="button" href="${escapeAttribute(githubUrl)}" rel="noreferrer">View GitHub</a>
          </div>
        </section>
        <section class="notes" aria-label="Storail capabilities">
          <div class="note">
            <strong>Permissioned event log</strong>
            <span>Namespaces and delegated writers are enforced by the on-chain hub.</span>
          </div>
          <div class="note">
            <strong>Gasless writes</strong>
            <span>Users sign typed data while a serverless relay submits transactions.</span>
          </div>
          <div class="note">
            <strong>Serverless app path</strong>
            <span>Contracts, worker, subgraph, storage provider, SDK, and frontend compose without an app server.</span>
          </div>
        </section>
      </main>
      <footer>Copyright (C) 2026 Defa Wang. Released under GPL-3.0-only.</footer>
    </div>
  </body>
</html>`;
}

function html(body: string, env: Env): Response {
  return new Response(body, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "x-storail-site": env.WEBSITE_CANONICAL_URL || "official",
    },
  });
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
