# Repository Guidelines

## Project Structure & Module Organization
Five Bun/TypeScript packages live at the root: `gateway-api/` (Cloudflare worker in `packages/gateway-worker` with shared auth in `packages/shared`), `metacogna-rag/` (RAG console plus Prisma `db/` and worker code), `metacogna.ai-landing/` (Vite marketing site), `parti-architecture/` (architecture explorer with `workers/*`), and `metacogna-base/` (placeholder worker that the gateway binds to for future cross-project navigation). Keep docs beside each module (`docs/`, `deployment/`, `analysis/`), colocate state with `store/` and domain logic under `services/`, and file integration or e2e specs inside `__tests__/`, `e2e/`, or `worker/tests`.

## Build, Test, and Development Commands
- `cd gateway-api && bun install && bun run dev` — installs workspace deps and spins up the local worker stack (use `bun run build` when bundling shared packages).
- `cd metacogna-rag && bun run dev` to launch the Vite dashboard; `bun run test`, `bun run test:worker`, and `bun run test:e2e` cover Jest, worker harness, and Playwright flows.
- `cd metacogna.ai-landing && bun run dev` previews the site; `bun run lint` (TypeScript) is the required gate before pushing.
- `cd parti-architecture && bun run dev` during iteration, `bun run build` to emit `dist/`, and `bun run deploy:all` to push every worker.

## Coding Style & Naming Conventions
Use TypeScript with 2-space indentation, semicolons, and ES modules. React components and Zustand stores adopt PascalCase filenames, hooks/utilities remain camelCase, shared schema/constants use uppercase, imports flow external→internal, and lint/tsc scripts must pass before committing; model new APIs with `zod` when feasible.

## Testing Guidelines
Name specs with the `.test.ts` suffix beside the code (`metacogna-rag/__tests__`, `packages/shared/src`). Worker behaviors stay under `worker/tests` (run with `bun run test:worker`), and UI or integration flows extend the Playwright suites in each `e2e/` folder; keep fixtures deterministic and let the Playwright CLI populate `playwright-report/`.

## Commit & Pull Request Guidelines
History mixes short imperatives and ticket-prefixed messages such as `[PRA-53] feat: ...`; mirror that style, keep subjects under 72 characters, and start with a verb. PRs should summarize scope, list verification commands (e.g., `bun run test:e2e`), link issues, attach UI screenshots when touching `components/`, `views/`, or `Layout.tsx`, and note any wrangler or DB scripts executed.

## Security & Configuration Tips
Never commit `.env*` files—bootstrap from `metacogna-rag/.env.example` or the landing/architecture samples and manage secrets with `wrangler secret put` or platform vaults. Run Cloudflare helpers (`bun run vector:create`, `bun run db:init`) only inside the intended account, keep Supabase keys scoped to development, and document new environment variables in the nearest README or metadata file.
