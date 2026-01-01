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

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/health') {
      return jsonResponse({ status: 'ok', service: 'metacogna-base', timestamp: Date.now() });
    }

    return jsonResponse({
      project: 'metacogna-base',
      status: 'placeholder',
      routes: ROUTES,
      message: 'Replace this worker with the real gateway homepage.',
    });
  },
};
