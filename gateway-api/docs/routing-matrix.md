# Gateway Routing Matrix

## Current State

| Domain | Worker | Notes |
| --- | --- | --- |
| `api.metacogna.ai` | _(none)_ | Gateway worker has no `routes` entry, so deployments land on `*.workers.dev`. |
| `parti.metacogna.ai` | `metacogna` (`metacogna-rag/worker`) | Direct route defined in `metacogna-rag/worker/wrangler.toml`. |
| `kv.metacogna.ai` | `metacogna-ai-worker` (`metacogna.ai-landing/workers`) | Intended via `[env] route`, but Wrangler ignores this block so the worker is only reachable on `workers.dev`. |
| `build.metacogna.ai` | _(unknown)_ | Gateway forwards `/build` traffic here but no worker config exists in this repo. |

## Target State

| Domain | Worker | Binding | Notes |
| --- | --- | --- | --- |
| `api.metacogna.ai/*` | `metacogna-gateway` | `routes` entry + `workers_dev = false` | The single public ingress. |
| `parti.metacogna.ai/*` | `metacogna` | service binding `CORE_SERVICE` | Accessed internally by the gateway; optional public route is gated via Access. |
| `kv.metacogna.ai/*` | `metacogna-ai-worker` | service binding `KV_SERVICE` | Provide admin APIs while remaining private behind the gateway (now also explicitly routed via Wrangler). |
| `build.metacogna.ai/*` | `parit-supervisor` | service binding `BUILD_SERVICE` | Architecture supervisor worker handles build orchestration via gateway binding. |

### Notes

- Service bindings remove the need to expose each downstream worker publicly and keep credentials off the wire while falling back to HTTPS targets when bindings are missing.

## Implementation Status

- ✅ `kv.metacogna.ai` worker now uses proper `routes` + `workers_dev = false`.
- ✅ `parit-supervisor` binds to `build.metacogna.ai/*` and is exposed internally to the gateway via `BUILD_SERVICE`.
- ✅ `metacogna` worker disables `workers_dev` to prevent unintended access outside `parti.metacogna.ai`.
- Public DNS records should still point to the relevant worker routes for staging/debug but production traffic should enter through the gateway.
