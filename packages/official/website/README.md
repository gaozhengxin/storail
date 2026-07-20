# Storail Official Website

This package builds the Markdown files in `docs/` into the `/docs/` section of the official Storail website.

The website is an official singleton deployment. It is not part of the operator facility stack and it is not an application developer package.

The home page is served by a Cloudflare Worker so links such as `GITHUB_URL` can be configured in worker vars.

Build locally:

```bash
pnpm --dir packages/official/website build
```

Deploy to Cloudflare Workers:

```bash
pnpm --dir packages/official/website deploy:cloudflare
```

The default Worker URL is assigned by Cloudflare under `workers.dev`.

To use a custom domain, configure the `routes` section in `wrangler.jsonc` after the Cloudflare zone exists. That cannot be made universal in code because Cloudflare needs the actual zone.
