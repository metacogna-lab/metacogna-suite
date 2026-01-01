const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
};

const ROUTES = [
  { name: 'RAG Console', url: 'https://parti.metacogna.ai' },
  { name: 'Portal / KV', url: 'https://kv.metacogna.ai' },
  { name: 'Architecture Explorer', url: 'https://build.metacogna.ai' },
];

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: JSON_HEADERS,
  });

interface Env {
  BASE_DB: D1Database;
  BASE_KV: KVNamespace;
  BASE_STORAGE: R2Bucket;
  ENVIRONMENT?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/health') {
      const healthy = Boolean(env.BASE_DB && env.BASE_KV && env.BASE_STORAGE);
      return jsonResponse({
        status: healthy ? 'ok' : 'degraded',
        service: 'metacogna-base',
        environment: env.ENVIRONMENT || 'development',
        timestamp: Date.now(),
        bindings: {
          db: env.BASE_DB ? 'bound' : 'missing',
          kv: env.BASE_KV ? 'bound' : 'missing',
          storage: env.BASE_STORAGE ? 'bound' : 'missing',
        },
      });
    }

    return jsonResponse({
      project: 'metacogna-base',
      environment: env.ENVIRONMENT || 'development',
      routes: ROUTES,
      message: 'Replace this worker with the real gateway homepage.',
    });
  },
};
