# Frontend ↔ Backend Integration Assessment

## Gateway + Landing (`metacogna.ai-landing`)
- Landing auth flows call `${VITE_GATEWAY_URL}/core/...` (`services/authService.ts`) which maps to the gateway `/core` route. When `VITE_GATEWAY_URL` is missing it falls back to `/api`, but the Vite dev server is not proxying to the worker, so local runs fail unless the env var is set.
- GitHub OAuth assumes the worker exposes `/core/auth/github`, yet the gateway currently proxies `/core/*` directly to the CORE service which is the RAG worker. There is no handler for `/core/auth/github` in `metacogna-rag/worker/src/index.ts`, so these requests 404. Either expose a dedicated portal backend or add auth endpoints to the core worker.
- The landing UI expects session cookies from `/core/session`/`/core/session/refresh`, but the RAG worker does not issue them. Define the contract (JWT vs cookie) and implement endpoints before enabling the flow.

## Gateway + RAG (`metacogna-rag`)
- `metacogna-rag/worker` routes are directly exposed at `parti.metacogna.ai/*` and also consumed by the gateway via the `CORE_SERVICE` binding. The API returns HTML pages and worker responses but there is no distinction between internal gateway requests and public UI requests. Consider enforcing `X-Gateway-Route` headers or signed JWTs on sensitive endpoints (e.g., `/api/admin/*`).
- The dashboard front-end (Vite app) uses `VITE_API_BASE_URL`/`API_BASE_URL` envs (see `.env`, `.env.production`) pointing to `https://build.metacogna.ai` and `https://api.metacogna.ai`. The Build domain is now handled by `parti-supervisor`, so the RAG UI should be updated to hit `https://api.metacogna.ai/core` instead of `build.metacogna.ai`.

## Parti Architecture Explorer
- The supervisor now owns `build.metacogna.ai` and exposes APIs under `/api/...`, but the React SPA (`parti-architecture/.env*`) still points `VITE_API_BASE_URL` at `https://build.metacogna.ai` while the gateway proxies `/build/*` separately. Clarify whether frontend requests should enter via the gateway (`https://api.metacogna.ai/build/...`) or hit the supervisor directly.
- Specialist agents (prd/data/design/logic/frontend/api/deployment) purposefully lack `routes` so they stay binding-only under the supervisor. Keep this policy when adding new agents—service-bind them and invoke through the supervisor instead of exposing fresh subdomains.
- HITL interrupt endpoints in `e2e/hitl-interrupts.spec.ts` call `/api/...` without gateway tokens. If the supervisor will stay private behind the gateway, those suite configs must be updated to include gateway-issued JWTs.

## Shared Auth & Tokens
- The gateway issues JWTs scoped per route, but downstream workers (RAG, Parti supervisor) never verify `Authorization` headers or `X-Gateway-Route`. This means frontend apps bypass the gateway entirely by hitting `parti` or `build` domains. Implement token verification helpers (`@gateway/shared`) inside RAG and Parti supervisors to align with gateway enforcement.
- There is no documented flow for propagating admin credentials: Landing login hits `/core/auth/login`, Parti supervisor seeds `auth/admins/sunyata.json`, and RAG worker has its own `/api/auth/*` endpoints. Consolidate admin login via the gateway worker and share the R2 bucket or replace with a proper IdP.
