const ROUTES = [
  { name: 'RAG Console', url: 'https://parti.metacogna.ai' },
  { name: 'Portal / KV', url: 'https://kv.metacogna.ai' },
  { name: 'Architecture Explorer', url: 'https://build.metacogna.ai' },
];

export default {
  async fetch(): Promise<Response> {
    return new Response(
      JSON.stringify({
        project: 'metacogna-base',
        status: 'placeholder',
        routes: ROUTES,
        message: 'Replace this worker with the real gateway homepage.',
      }),
      {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      },
    );
  },
};
