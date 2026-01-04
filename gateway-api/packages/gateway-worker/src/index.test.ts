import { jest } from '@jest/globals';
import worker from './index';

const createEnv = () => {
  const baseFetch = jest.fn(async () => new Response('ok', { status: 200 }));
  return {
    ACCOUNTS: {
      get: jest.fn(),
    },
    GATEWAY_JWT_SECRET: 'test-secret',
    BUILD_SERVICE_URL: 'https://build.metacogna.ai',
    KV_SERVICE_URL: 'https://kv.metacogna.ai',
    CORE_SERVICE_URL: 'https://parti.metacogna.ai',
    BASE_SERVICE_URL: 'https://hq.metacogna.ai',
    BUILD_SERVICE: { fetch: jest.fn() },
    KV_SERVICE: { fetch: jest.fn() },
    CORE_SERVICE: { fetch: jest.fn() },
    BASE_SERVICE: { fetch: baseFetch },
  } as any;
};

describe('gateway worker', () => {
  it('issues guest tokens via /auth/guest', async () => {
    const env = createEnv();
    const request = new Request('https://api.metacogna.ai/auth/guest', {
      method: 'POST',
      body: JSON.stringify({ route: 'KV' }),
    });

    const response = await worker.fetch(request, env);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.token).toEqual(expect.any(String));
  });

  it('proxies /hq/* requests to the base service binding', async () => {
    const env = createEnv();
    const request = new Request('https://api.metacogna.ai/hq/health');

    const response = await worker.fetch(request, env);
    expect(response.status).toBe(200);
    expect(env.BASE_SERVICE.fetch).toHaveBeenCalledTimes(1);
    const proxiedRequest = (env.BASE_SERVICE.fetch as jest.Mock).mock.calls[0][0] as Request;
    expect(new URL(proxiedRequest.url).pathname).toBe('/health');
  });

  it('forwards Notion webhooks to configured services', async () => {
    const env = createEnv();
    env.NOTION_WEBHOOK_SECRET = 'secret';
    const request = new Request('https://api.metacogna.ai/webhooks/notion', {
      method: 'POST',
      headers: { 'X-Notion-Signature': 'secret' },
      body: JSON.stringify({ event: 'test' }),
    });

    const response = await worker.fetch(request, env);
    expect(response.status).toBe(202);
    expect(env.BASE_SERVICE.fetch).toHaveBeenCalledTimes(1);
  });
});
