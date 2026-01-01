# Task Errors

- 2025-02-14: Needed elevated permission to create git branch because `.git` lives in home directory; used escalated `git checkout -b`.
- 2025-02-14: `bun run build` inside `gateway-api` failed (no package had `build` scripts); used TypeScript `tsc --noEmit` instead.
- 2025-02-14: Initial type-check failed (missing `@cloudflare/workers-types` and stricter request typing); fixed by installing the dependency and adding safe JSON parsing.
