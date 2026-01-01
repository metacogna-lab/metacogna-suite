# gateway-api

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run index.ts
```

This project was created using `bun init` in bun v1.3.2. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.

## Secrets

The gateway worker signs JWTs, so `GATEWAY_JWT_SECRET` **must** be stored as a Cloudflare secret instead of in `wrangler.toml`.

```bash
cd packages/gateway-worker
wrangler secret put GATEWAY_JWT_SECRET
```

For local development copy the value into a `.dev.vars` file (ignored by git) rather than checking it into source control.

### GitHub OAuth

- Set `GITHUB_CLIENT_ID` under `[vars]` (safe to commit) to match your GitHub OAuth app.
- Store `GITHUB_CLIENT_SECRET` via `wrangler secret put GITHUB_CLIENT_SECRET`.
- These values power `/core/auth/github`, `/core/session`, and `/core/logout` which are consumed by the landing portal.
