import { jest } from '@jest/globals';
import worker from '../src/index';

const createEnv = () => ({
  BASE_DB: {} as any,
  BASE_KV: {} as any,
  BASE_STORAGE: {} as any,
  ENVIRONMENT: 'test',
});

describe('metacogna-base worker', () => {
  it('exposes a health endpoint', async () => {
    const request = new Request('https://hq.metacogna.ai/health');
    const response = await worker.fetch(request, createEnv());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe('ok');
    expect(body.service).toBe('metacogna-base');
  });
});
