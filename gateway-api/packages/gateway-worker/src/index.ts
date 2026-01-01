import {
  ProjectRoute,
  GatewayErrorSchema,
  createGatewayToken,
  verifyGatewayToken,
} from '@gateway/shared';

interface R2ObjectBody {
  text: () => Promise<string>;
  json: () => Promise<any>;
}

interface R2Bucket {
  get(key: string): Promise<R2ObjectBody | null>;
  head?(key: string): Promise<any>;
  put(key: string, value: string, options?: { httpMetadata?: Record<string, string> }): Promise<void>;
}

interface ServiceBinding {
  fetch(request: Request | string, init?: RequestInit): Promise<Response>;
}

interface Env {
  ACCOUNTS: R2Bucket;
  GATEWAY_JWT_SECRET: string;
  BUILD_SERVICE_URL?: string;
  KV_SERVICE_URL?: string;
  CORE_SERVICE_URL?: string;
  BUILD_SERVICE?: ServiceBinding;
  KV_SERVICE?: ServiceBinding;
  CORE_SERVICE?: ServiceBinding;
}

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
};

const ROUTES = [
  { prefix: '/build', envKey: 'BUILD_SERVICE_URL' as const, serviceKey: 'BUILD_SERVICE' as const, route: ProjectRoute.BUILD },
  { prefix: '/kv', envKey: 'KV_SERVICE_URL' as const, serviceKey: 'KV_SERVICE' as const, route: ProjectRoute.KV },
  { prefix: '/core', envKey: 'CORE_SERVICE_URL' as const, serviceKey: 'CORE_SERVICE' as const, route: ProjectRoute.CORE },
];

type RouteMatch = typeof ROUTES[number];

const toBase64 = (buffer: ArrayBuffer) => {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.length;
  for (let i = 0; i < len; i++) {
    const byte = bytes[i];
    if (byte === undefined) continue;
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
};

async function hashCredential(salt: string, password: string) {
  const encoder = new TextEncoder();
  const buffer = encoder.encode(`${salt}${password}`);
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return toBase64(digest);
}

const jsonResponse = (body: any, status = 200, extraHeaders: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...extraHeaders },
  });

const errorResponse = (route: ProjectRoute, status: number, code: string, message: string, details?: any) =>
  jsonResponse(
    GatewayErrorSchema.parse({
      route,
      status,
      code,
      message,
      requestId: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      details,
    }),
    status,
  );

async function handleLogin(request: Request, env: Env) {
  const { username, password } = (await request.json().catch(() => ({}))) as {
    username?: string;
    password?: string;
  };
  if (!username || !password) {
    return errorResponse(ProjectRoute.AUTH, 400, 'INVALID_REQUEST', 'Username and password are required');
  }

  const key = `auth/admins/${username}.json`;
  const recordObject = await env.ACCOUNTS.get(key);
  if (!recordObject) {
    return errorResponse(ProjectRoute.AUTH, 401, 'INVALID_CREDENTIALS', 'Invalid credentials');
  }

  const record = JSON.parse(await recordObject.text());
  const computedHash = await hashCredential(record.salt, password);
  if (computedHash !== record.hash) {
    return errorResponse(ProjectRoute.AUTH, 401, 'INVALID_CREDENTIALS', 'Invalid credentials');
  }

  const token = await createGatewayToken(
    {
      projectId: record.username || username,
      route: ProjectRoute.AUTH,
      scopes: ['admin'],
      environment: 'production',
      issuedBy: 'gateway.metacogna.ai',
    },
    env.GATEWAY_JWT_SECRET,
  );

  return jsonResponse({
    success: true,
    token,
    user: {
      username: record.username || username,
      role: record.role || 'admin',
    },
  });
}

const normalizeRoute = (value?: string): ProjectRoute => {
  if (!value) return ProjectRoute.BUILD;
  const upper = value.toUpperCase();
  if (upper in ProjectRoute) {
    return (ProjectRoute as any)[upper] as ProjectRoute;
  }
  return ProjectRoute.BUILD;
};

async function handleGuestToken(request: Request, env: Env) {
  const body = (await request.json().catch(() => ({}))) as {
    route?: string;
  };
  const route = normalizeRoute(body.route);
  const token = await createGatewayToken(
    {
      projectId: 'guest',
      route,
      scopes: ['guest'],
      environment: 'staging',
      issuedBy: 'gateway.metacogna.ai',
    },
    env.GATEWAY_JWT_SECRET,
  );

  return jsonResponse({ success: true, token, route });
}

async function verifyToken(request: Request, env: Env, route: ProjectRoute) {
  const auth = request.headers.get('Authorization');
  if (!auth || !auth.startsWith('Bearer ')) {
    throw new Error('missing_token');
  }
  const token = auth.replace('Bearer ', '').trim();
  const { claims } = await verifyGatewayToken(token, env.GATEWAY_JWT_SECRET);
  if (claims.route !== route && claims.route !== ProjectRoute.CORE && claims.route !== ProjectRoute.AUTH) {
    throw new Error('route_mismatch');
  }
  return claims;
}

const stripRoutePrefix = (url: URL, match: RouteMatch) => url.pathname.substring(match.prefix.length) || '/';

function rewriteUrl(url: URL, match: RouteMatch, target: string) {
  const strippedPath = stripRoutePrefix(url, match);
  const targetUrl = new URL(target);
  targetUrl.pathname = `${targetUrl.pathname.replace(/\/$/, '')}${strippedPath}`;
  targetUrl.search = url.search;
  return targetUrl;
}

const createProxyInit = (request: Request, route: ProjectRoute): RequestInit => {
  const headers = new Headers(request.headers);
  headers.delete('Authorization');
  headers.set('X-Gateway-Route', route);

  return {
    method: request.method,
    headers,
    body: request.body,
    redirect: 'manual',
  };
};

async function handleProxy(request: Request, env: Env, match: RouteMatch) {
  const shouldVerify = match.route === ProjectRoute.BUILD || request.headers.has('Authorization');

  if (shouldVerify) {
    try {
      await verifyToken(request, env, match.route);
    } catch (err: any) {
      const code = err?.message === 'missing_token' ? 'MISSING_TOKEN' : 'INVALID_TOKEN';
      const status = err?.message === 'missing_token' ? 401 : 403;
      return errorResponse(match.route, status, code, 'Unauthorized request');
    }
  }

  const url = new URL(request.url);
  const proxyInit = createProxyInit(request, match.route);
  const serviceBinding = match.serviceKey ? ((env as any)[match.serviceKey] as ServiceBinding | undefined) : undefined;

  if (serviceBinding?.fetch) {
    const internalUrl = new URL('https://service.binding');
    const strippedPath = stripRoutePrefix(url, match);
    internalUrl.pathname = strippedPath;
    internalUrl.search = url.search;

    const proxyReq = new Request(internalUrl.toString(), proxyInit);
    return serviceBinding.fetch(proxyReq);
  }

  const targetBase = match.envKey ? ((env as any)[match.envKey] as string | undefined) : undefined;
  if (!targetBase) {
    return errorResponse(match.route, 502, 'MISSING_TARGET', `Missing target for ${match.prefix}`);
  }
  const targetUrl = rewriteUrl(url, match, targetBase);

  const proxyReq = new Request(targetUrl.toString(), proxyInit);

  return fetch(proxyReq);
}

function handleOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
      'Access-Control-Max-Age': '86400',
    },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return handleOptions();
    }

    if (url.pathname === '/auth/login' && request.method === 'POST') {
      return handleLogin(request, env);
    }

    if (url.pathname === '/auth/guest' && request.method === 'POST') {
      return handleGuestToken(request, env);
    }

    for (const match of ROUTES) {
      if (url.pathname.startsWith(match.prefix)) {
        return handleProxy(request, env, match);
      }
    }

    return errorResponse(ProjectRoute.CORE, 404, 'NOT_FOUND', 'Route not handled');
  },
};
