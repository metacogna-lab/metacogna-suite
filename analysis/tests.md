# Test Strategy

## Gateway API
- Install deps: `cd gateway-api && bun install`
- Run Jest suite: `bun run --filter "@gateway/worker" test`

## Metacogna Base
- `cd metacogna-base && npm install && npm test`

## Metacogna RAG Worker
- `cd metacogna-rag && bun install && bun run test:worker:jest`

## Parti Supervisor
- `cd parti-architecture && bun install && bun run test`

## Landing Playwright
- `cd metacogna.ai-landing && bun install`
- Install browsers once: `npx playwright install --with-deps`
- Run: `bun run test:e2e` (uses envs `E2E_LANDING_URL` / `E2E_GATEWAY_URL`)

CI executes all suites via `.github/workflows/tests.yml`.
