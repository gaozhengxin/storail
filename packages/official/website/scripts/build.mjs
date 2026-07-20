// Copyright (C) 2026 Defa Wang

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const docsDir = path.join(rootDir, "docs");
const outDir = path.join(rootDir, "packages/official/website/dist");
const explorerDir = path.join(rootDir, "packages/official/website/explorer");

const pages = [
  { source: "index.md", output: "docs/index.html", href: "/docs/", title: "Documentation" },
  {
    source: "operate-a-storail-facility.md",
    output: "docs/operate-a-storail-facility/index.html",
    href: "/docs/operate-a-storail-facility/",
    title: "Operate A Facility",
  },
  {
    source: "build-on-storail.md",
    output: "docs/build-on-storail/index.html",
    href: "/docs/build-on-storail/",
    title: "Build On Storail",
  },
  {
    source: "serverless-app-backend.md",
    output: "docs/serverless-app-backend/index.html",
    href: "/docs/serverless-app-backend/",
    title: "Serverless App Backend",
  },
  {
    source: "dedicated-l2-app.md",
    output: "docs/dedicated-l2-app/index.html",
    href: "/docs/dedicated-l2-app/",
    title: "Dedicated L2 App",
  },
  { source: "sdk.md", output: "docs/sdk/index.html", href: "/docs/sdk/", title: "SDK Interface Guide" },
  {
    source: "deployments.md",
    output: "docs/deployments/index.html",
    href: "/docs/deployments/",
    title: "Current Deployments",
  },
  { source: "contact.md", output: "docs/contact/index.html", href: "/docs/contact/", title: "Contact" },
];

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

fs.writeFileSync(path.join(outDir, "index.html"), renderHome());
if (fs.existsSync(path.join(explorerDir, "index.html"))) {
  const explorerOutDir = path.join(outDir, "explorer");
  fs.mkdirSync(explorerOutDir, { recursive: true });
  fs.copyFileSync(path.join(explorerDir, "index.html"), path.join(explorerOutDir, "index.html"));
}

for (const page of pages) {
  const markdown = fs.readFileSync(path.join(docsDir, page.source), "utf8");
  fs.mkdirSync(path.dirname(path.join(outDir, page.output)), { recursive: true });
  fs.writeFileSync(path.join(outDir, page.output), renderPage(page, renderMarkdown(markdown)));
}

fs.writeFileSync(path.join(outDir, "robots.txt"), "User-agent: *\nAllow: /\n");
fs.writeFileSync(path.join(outDir, "_headers"), "/docs/*\n  Content-Type: text/html; charset=utf-8\n");
fs.writeFileSync(
  path.join(outDir, "_redirects"),
  [
    "/docs /docs/ 301",
    "/viewer /explorer/ 301",
    "/viewer/ /explorer/ 301",
    ...pages
      .filter((page) => page.href !== "/docs/")
      .flatMap((page) => [
        `/docs/${page.source.replace(/\.md$/, ".html")} ${page.href} 301`,
        `/${page.source.replace(/\.md$/, ".html")} ${page.href} 301`,
      ]),
    "",
  ].join("\n"),
);

function renderHome() {
  const githubUrl = process.env.GITHUB_URL || "https://github.com/gaozhengxin/storail";
  const docsPath = process.env.DOCS_PATH || "/docs/";
  const canonical = process.env.WEBSITE_CANONICAL_URL || "https://storail.pages.dev/";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link rel="canonical" href="${escapeAttribute(canonical)}">
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
          ${fs.existsSync(path.join(explorerDir, "index.html")) ? '<a href="/explorer/">Explorer</a>' : ""}
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
      <footer></footer>
    </div>
  </body>
</html>`;
}

function renderPage(page, body) {
  const nav = pages
    .map((item) => {
      const active = item.output === page.output ? " aria-current=\"page\"" : "";
      return `<a href="${escapeAttribute(item.href)}"${active}>${escapeHtml(item.title)}</a>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(page.title)} - Storail</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #fbfbf8;
        --panel: #ffffff;
        --text: #202124;
        --muted: #62666d;
        --line: #d9d9d2;
        --accent: #0f766e;
        --code: #f0f2ef;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        color: var(--text);
        background: var(--bg);
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        line-height: 1.6;
      }
      .layout {
        display: grid;
        grid-template-columns: 260px minmax(0, 1fr);
        min-height: 100vh;
      }
      nav {
        border-right: 1px solid var(--line);
        padding: 28px 20px;
        background: var(--panel);
      }
      nav strong {
        display: block;
        margin-bottom: 18px;
        font-size: 18px;
      }
      nav a {
        display: block;
        color: var(--muted);
        text-decoration: none;
        padding: 7px 0;
      }
      nav a[aria-current="page"] {
        color: var(--accent);
        font-weight: 650;
      }
      main {
        width: min(880px, 100%);
        padding: 42px 32px 72px;
      }
      h1, h2, h3 {
        line-height: 1.25;
        margin: 1.6em 0 0.55em;
      }
      h1 { margin-top: 0; font-size: 34px; }
      h2 { font-size: 24px; border-top: 1px solid var(--line); padding-top: 24px; }
      h3 { font-size: 19px; }
      p, ul, ol, pre { margin: 0 0 16px; }
      a { color: var(--accent); }
      code {
        background: var(--code);
        padding: 2px 5px;
        border-radius: 4px;
      }
      pre {
        overflow-x: auto;
        background: #1f2428;
        color: #f4f6f8;
        padding: 16px;
        border-radius: 6px;
      }
      pre code {
        background: transparent;
        padding: 0;
        color: inherit;
      }
      @media (max-width: 760px) {
        .layout { display: block; }
        nav { border-right: 0; border-bottom: 1px solid var(--line); }
        main { padding: 28px 20px 56px; }
      }
    </style>
  </head>
  <body>
    <div class="layout">
      <nav>
        <strong>Storail Docs</strong>
        ${nav}
      </nav>
      <main>${body}</main>
    </div>
  </body>
</html>
`;
}

function renderMarkdown(markdown) {
  const lines = markdown.split(/\r?\n/);
  const blocks = [];
  let paragraph = [];
  let list = [];
  let code = null;

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push(`<p>${renderInline(paragraph.join(" "))}</p>`);
      paragraph = [];
    }
  };
  const flushList = () => {
    if (list.length > 0) {
      blocks.push(`<ul>${list.map((item) => `<li>${renderInline(item)}</li>`).join("")}</ul>`);
      list = [];
    }
  };

  for (const line of lines) {
    if (code) {
      if (line.startsWith("```")) {
        blocks.push(`<pre><code>${escapeHtml(code.lines.join("\n"))}</code></pre>`);
        code = null;
      } else {
        code.lines.push(line);
      }
      continue;
    }

    if (line.startsWith("```")) {
      flushParagraph();
      flushList();
      code = { lines: [] };
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }

    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1].length;
      blocks.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      continue;
    }

    const bullet = /^-\s+(.+)$/.exec(line);
    if (bullet) {
      flushParagraph();
      list.push(bullet[1]);
      continue;
    }

    paragraph.push(line.trim());
  }

  flushParagraph();
  flushList();
  return blocks.join("\n");
}

function renderInline(value) {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, text, href) => {
      const htmlHref = href.endsWith(".md") || href.endsWith(".html") ? `${href.replace(/\.(md|html)$/, "")}/` : href;
      return `<a href="${escapeAttribute(htmlHref)}">${text}</a>`;
    });
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("'", "&#39;");
}
