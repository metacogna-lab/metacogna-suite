# Error Log

- 2025-02-14: Needed elevated permission to create git branch because `.git` sits outside workspace root; resolved via escalated `git checkout -b`.
- 2025-02-14: `bun run build` inside `gateway-api` failed because no packages define a `build` script; opted to use TypeScript type-check instead.
- 2025-02-14: Type-check initially failed (missing `@cloudflare/workers-types` and strict typing errors); fixed by adding the dev dependency and tightening request parsing.
