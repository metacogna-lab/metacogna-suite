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
  BASE_SERVICE_URL?: string;
  BUILD_SERVICE?: ServiceBinding;
  KV_SERVICE?: ServiceBinding;
  CORE_SERVICE?: ServiceBinding;
  BASE_SERVICE?: ServiceBinding;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  NOTION_WEBHOOK_SECRET?: string;
}

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
};

const ROUTES = [
  { prefix: '/build', envKey: 'BUILD_SERVICE_URL' as const, serviceKey: 'BUILD_SERVICE' as const, route: ProjectRoute.BUILD },
  { prefix: '/kv', envKey: 'KV_SERVICE_URL' as const, serviceKey: 'KV_SERVICE' as const, route: ProjectRoute.KV },
  { prefix: '/core', envKey: 'CORE_SERVICE_URL' as const, serviceKey: 'CORE_SERVICE' as const, route: ProjectRoute.CORE },
  { prefix: '/hq', envKey: 'BASE_SERVICE_URL' as const, serviceKey: 'BASE_SERVICE' as const, route: ProjectRoute.BASE },
];

const WEBHOOK_TARGETS: Record<string, ReadonlyArray<keyof Env>> = {
  notion: ['BASE_SERVICE', 'KV_SERVICE', 'CORE_SERVICE'],
};

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

type AdminRecord = {
  username?: string;
  role?: string;
  salt: string;
  hash: string;
};

const fetchAdminRecord = async (env: Env, username: string): Promise<AdminRecord | null> => {
  const key = `auth/admins/${username}.json`;
  const recordObject = await env.ACCOUNTS.get(key);
  if (!recordObject) {
    return null;
  }
  return JSON.parse(await recordObject.text());
};

const issueGatewayToken = async (
  env: Env,
  projectId: string,
  route: ProjectRoute,
  role: string,
) => {
  const token = await createGatewayToken(
    {
      projectId,
      route,
      scopes: [role],
      environment: 'production',
      issuedBy: 'gateway.metacogna.ai',
    },
    env.GATEWAY_JWT_SECRET,
  );

  return { token, role };
};

const successAuthResponse = (username: string, role: string, token: string) =>
  jsonResponse({
    success: true,
    token,
    user: {
      username,
      role,
    },
  });

async function handleLogin(request: Request, env: Env) {
  const { username, password } = (await request.json().catch(() => ({}))) as {
    username?: string;
    password?: string;
  };
  if (!username || !password) {
    return errorResponse(ProjectRoute.AUTH, 400, 'INVALID_REQUEST', 'Username and password are required');
  }

  const record = await fetchAdminRecord(env, username);
  if (!record) {
    return errorResponse(ProjectRoute.AUTH, 401, 'INVALID_CREDENTIALS', 'Invalid credentials');
  }

  const computedHash = await hashCredential(record.salt, password);
  if (computedHash !== record.hash) {
    return errorResponse(ProjectRoute.AUTH, 401, 'INVALID_CREDENTIALS', 'Invalid credentials');
  }

  const { token, role } = await issueGatewayToken(env, record.username || username, ProjectRoute.AUTH, record.role || 'admin');
  return successAuthResponse(record.username || username, role, token);
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

async function handleCoreLogin(request: Request, env: Env) {
  const { username, password } = (await request.json().catch(() => ({}))) as {
    username?: string;
    password?: string;
  };
  if (!username || !password) {
    return errorResponse(ProjectRoute.CORE, 400, 'INVALID_REQUEST', 'Username and password are required');
  }

  const record = await fetchAdminRecord(env, username);
  if (!record) {
    return errorResponse(ProjectRoute.CORE, 401, 'INVALID_CREDENTIALS', 'Invalid credentials');
  }

  const computedHash = await hashCredential(record.salt, password);
  if (computedHash !== record.hash) {
    return errorResponse(ProjectRoute.CORE, 401, 'INVALID_CREDENTIALS', 'Invalid credentials');
  }

  const { token, role } = await issueGatewayToken(env, record.username || username, ProjectRoute.CORE, record.role || 'admin');
  return successAuthResponse(record.username || username, role, token);
}

async function fetchGithubProfile(code: string, redirectUri: string | undefined, env: Env) {
  if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) {
    throw new Error('missing_github_secrets');
  }

  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: redirectUri,
    }),
  });

  if (!tokenRes.ok) {
    const payload = await tokenRes.text();
    throw new Error(`github_token_failed:${payload}`);
  }

  const tokenJson = (await tokenRes.json()) as { access_token?: string; error?: string };
  if (!tokenJson.access_token) {
    throw new Error('github_token_missing');
  }

  const profileRes = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${tokenJson.access_token}`,
      'User-Agent': 'metacogna-gateway',
      Accept: 'application/json',
    },
  });

  if (!profileRes.ok) {
    const payload = await profileRes.text();
    throw new Error(`github_profile_failed:${payload}`);
  }

  const profile = (await profileRes.json()) as {
    login?: string;
    name?: string;
    avatar_url?: string;
    html_url?: string;
  };
  return {
    username: profile.login || `gh-${code.slice(-6)}`,
    name: profile.name,
    avatarUrl: profile.avatar_url,
    htmlUrl: profile.html_url,
  };
}

async function handleCoreGithub(request: Request, env: Env) {
  const { code, redirectUri } = (await request.json().catch(() => ({}))) as { code?: string; redirectUri?: string };
  if (!code) {
    return errorResponse(ProjectRoute.CORE, 400, 'INVALID_REQUEST', 'Missing GitHub code');
  }

  try {
    const profile = await fetchGithubProfile(code, redirectUri, env);
    const { token, role } = await issueGatewayToken(env, profile.username, ProjectRoute.CORE, 'admin');
    return jsonResponse({
      success: true,
      token,
      user: {
        username: profile.username,
        role,
        name: profile.name,
        avatarUrl: profile.avatarUrl,
        githubUrl: profile.htmlUrl,
      },
    });
  } catch (err: any) {
    console.error('github_auth_failed', err);
    if (err?.message === 'missing_github_secrets') {
      return errorResponse(ProjectRoute.CORE, 500, 'GITHUB_NOT_CONFIGURED', 'GitHub OAuth is not configured');
    }
    return errorResponse(ProjectRoute.CORE, 502, 'GITHUB_AUTH_FAILED', 'Unable to authenticate with GitHub');
  }
}

async function handleCoreSession(request: Request, env: Env) {
  try {
    const claims = await verifyToken(request, env, ProjectRoute.CORE);
    return jsonResponse({
      success: true,
      token: request.headers.get('Authorization')?.replace('Bearer ', ''),
      user: {
        username: claims.projectId,
        role: (claims.scopes?.[0] as string) || 'admin',
      },
    });
  } catch (err: any) {
    const status = err?.message === 'missing_token' ? 401 : 403;
    return errorResponse(ProjectRoute.CORE, status, 'INVALID_SESSION', 'Session invalid or expired');
  }
}

async function handleCoreSessionRefresh(request: Request, env: Env) {
  try {
    const auth = await verifyToken(request, env, ProjectRoute.CORE);
    const { token } = await issueGatewayToken(env, auth.projectId, ProjectRoute.CORE, (auth.scopes?.[0] as string) || 'admin');
    return successAuthResponse(auth.projectId, (auth.scopes?.[0] as string) || 'admin', token);
  } catch (err: any) {
    const status = err?.message === 'missing_token' ? 401 : 403;
    return errorResponse(ProjectRoute.CORE, status, 'REFRESH_FAILED', 'Unable to refresh session');
  }
}

function handleCoreLogout() {
  return jsonResponse({ success: true });
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

    if (url.pathname.startsWith('/webhooks/')) {
      return handleWebhook(request, env);
    }

    if (url.pathname === '/auth/login' && request.method === 'POST') {
      return handleLogin(request, env);
    }

    if (url.pathname === '/auth/guest' && request.method === 'POST') {
      return handleGuestToken(request, env);
    }

    if (url.pathname === '/core/auth/login' && request.method === 'POST') {
      return handleCoreLogin(request, env);
    }

    if (url.pathname === '/core/auth/github' && request.method === 'POST') {
      return handleCoreGithub(request, env);
    }

    if (url.pathname === '/core/session' && request.method === 'GET') {
      return handleCoreSession(request, env);
    }

    if (url.pathname === '/core/session/refresh' && request.method === 'POST') {
      return handleCoreSessionRefresh(request, env);
    }

    if (url.pathname === '/core/logout' && request.method === 'POST') {
      return handleCoreLogout();
    }

    for (const match of ROUTES) {
      if (url.pathname.startsWith(match.prefix)) {
        return handleProxy(request, env, match);
      }
    }

    return errorResponse(ProjectRoute.CORE, 404, 'NOT_FOUND', 'Route not handled');
  },
};

async function handleWebhook(request: Request, env: Env) {
  const url = new URL(request.url);
  const [, , sourceRaw] = url.pathname.split('/');
  const source = sourceRaw?.toLowerCase();
  if (!source) {
    return errorResponse(ProjectRoute.WEBHOOK, 400, 'INVALID_SOURCE', 'Webhook source missing');
  }

  if (source === 'notion') {
    return handleNotionWebhook(request, env);
  }

  return errorResponse(ProjectRoute.WEBHOOK, 404, 'UNKNOWN_SOURCE', `Webhook source ${source} not supported`);
}

function resolveWebhookTargets(source: string, request: Request, env: Env) {
  const headerTargets = request.headers.get('X-Gateway-Webhook-Targets');
  const candidateNames = headerTargets
    ? headerTargets.split(',').map((v) => v.trim()).filter(Boolean)
    : (WEBHOOK_TARGETS[source] as string[] | undefined) || [];

  const deduped = Array.from(new Set(candidateNames));
  return deduped
    .map((name) => ({ name, binding: (env as any)[name] as ServiceBinding | undefined }))
    .filter((entry) => Boolean(entry.binding?.fetch));
}

async function handleNotionWebhook(request: Request, env: Env) {
  if (!env.NOTION_WEBHOOK_SECRET) {
    return errorResponse(ProjectRoute.WEBHOOK, 500, 'NOTION_SECRET_MISSING', 'Notion secret not configured');
  }

  const signature = request.headers.get('X-Notion-Signature');
  if (!signature || signature !== env.NOTION_WEBHOOK_SECRET) {
    return errorResponse(ProjectRoute.WEBHOOK, 401, 'INVALID_SIGNATURE', 'Notion signature invalid');
  }

  const bodyText = await request.text();
  const headers = new Headers(request.headers);
  headers.set('X-Gateway-Source', 'notion');

  const targets = resolveWebhookTargets('notion', request, env);
  if (targets.length === 0) {
    return errorResponse(ProjectRoute.WEBHOOK, 502, 'NO_TARGETS', 'No services configured for this webhook');
  }

  const forwardResults = await Promise.all(
    targets.map(async ({ name, binding }) => {
      const forwardRequest = new Request(`https://${name.toLowerCase()}.internal/webhooks/notion`, {
        method: request.method,
        headers,
        body: bodyText,
      });
      const response = await binding!.fetch(forwardRequest);
      return { target: name, status: response.status };
    }),
  );

  return jsonResponse({ success: true, forwarded: forwardResults }, 202);
}
