/**
 * Cloudflare Gateway Worker
 * Routes requests to appropriate services based on path prefixes
 */

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
};

const ROUTES = [
  { prefix: '/build', envKey: 'BUILD_SERVICE_URL', serviceKey: 'BUILD_SERVICE', route: 'BUILD' },
  { prefix: '/kv', envKey: 'KV_SERVICE_URL', serviceKey: 'KV_SERVICE', route: 'KV' },
  { prefix: '/core', envKey: 'CORE_SERVICE_URL', serviceKey: 'CORE_SERVICE', route: 'CORE' },
  { prefix: '/hq', envKey: 'BASE_SERVICE_URL', serviceKey: 'BASE_SERVICE', route: 'BASE' },
];

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          ...JSON_HEADERS,
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        },
      });
    }

    try {
      // Health check
      if (url.pathname === '/health' && request.method === 'GET') {
        return new Response(JSON.stringify({
          status: 'ok',
          service: 'gateway',
          timestamp: Date.now(),
        }), { headers: JSON_HEADERS });
      }

      // Auth endpoints
      if (url.pathname.startsWith('/auth/')) {
        return handleAuth(request, env);
      }

      // Route to appropriate service
      for (const route of ROUTES) {
        if (url.pathname.startsWith(route.prefix)) {
          return routeToService(request, env, route);
        }
      }

      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: JSON_HEADERS,
      });

    } catch (error) {
      console.error('Gateway error:', error);
      return new Response(JSON.stringify({ error: 'Internal server error' }), {
        status: 500,
        headers: JSON_HEADERS,
      });
    }
  },
};

// Auth handler
async function handleAuth(request, env) {
  const url = new URL(request.url);

  if (url.pathname === '/auth/github' && request.method === 'POST') {
    return handleGitHubAuth(request, env);
  }

  if (url.pathname === '/auth/admin' && request.method === 'POST') {
    return handleAdminAuth(request, env);
  }

  return new Response(JSON.stringify({ error: 'Auth endpoint not found' }), {
    status: 404,
    headers: JSON_HEADERS,
  });
}

// GitHub OAuth handler
async function handleGitHubAuth(request, env) {
  try {
    const { code } = await request.json();

    // Exchange code for token (simplified)
    const response = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        client_id: env.GITHUB_CLIENT_ID,
        client_secret: env.GITHUB_CLIENT_SECRET,
        code,
      }),
    });

    const data = await response.json();
    return new Response(JSON.stringify({ token: data.access_token }), {
      headers: JSON_HEADERS,
    });
  } catch (error) {
    console.error('GitHub auth error:', error);
    return new Response(JSON.stringify({ error: 'Auth failed' }), {
      status: 500,
      headers: JSON_HEADERS,
    });
  }
}

// Admin auth handler
async function handleAdminAuth(request, env) {
  try {
    const { password } = await request.json();

    // Simple admin auth (simplified)
    const isValid = password === 'admin123'; // In real app, hash and compare

    if (isValid) {
      return new Response(JSON.stringify({ token: 'admin-token' }), {
        headers: JSON_HEADERS,
      });
    } else {
      return new Response(JSON.stringify({ error: 'Invalid credentials' }), {
        status: 401,
        headers: JSON_HEADERS,
      });
    }
  } catch (error) {
    console.error('Admin auth error:', error);
    return new Response(JSON.stringify({ error: 'Auth failed' }), {
      status: 500,
      headers: JSON_HEADERS,
    });
  }
}

// Route to service
async function routeToService(request, env, route) {
  try {
    // Try service binding first
    if (env[route.serviceKey]) {
      const newRequest = new Request(request);
      // Add routing info to headers
      newRequest.headers.set('X-Gateway-Route', route.route);

      return await env[route.serviceKey].fetch(newRequest);
    }

    // Fallback to URL
    if (env[route.envKey]) {
      const targetUrl = env[route.envKey] + request.url.replace(/^https?:\/\/[^\/]+/, '');
      return await fetch(targetUrl, {
        method: request.method,
        headers: request.headers,
        body: request.body,
      });
    }

    return new Response(JSON.stringify({ error: 'Service not available' }), {
      status: 503,
      headers: JSON_HEADERS,
    });
  } catch (error) {
    console.error('Service routing error:', error);
    return new Response(JSON.stringify({ error: 'Service error' }), {
      status: 500,
      headers: JSON_HEADERS,
    });
  }
}