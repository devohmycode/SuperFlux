import http from 'http';
import { URL } from 'url';

const PORT = 3001;

// User-Agent pour les requêtes RSS (identifié comme lecteur RSS)
const RSS_USER_AGENT = 'SuperFlux/1.0 (RSS Reader; +https://github.com/user/superflux)';

// Certains sites nécessitent un User-Agent de navigateur
const BROWSER_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function getHeadersForUrl(url) {
  const hostname = url.hostname.toLowerCase();

  // Reddit bloque les User-Agents non-navigateur avec 403
  if (hostname.includes('reddit.com')) {
    return {
      'User-Agent': BROWSER_USER_AGENT,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9,fr;q=0.8',
    };
  }

  // YouTube
  if (hostname.includes('youtube.com')) {
    return {
      'User-Agent': RSS_USER_AGENT,
      'Accept': 'application/atom+xml, application/xml, text/xml, */*',
    };
  }

  // Par défaut, User-Agent de navigateur
  return {
    'User-Agent': BROWSER_USER_AGENT,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9,fr;q=0.8',
  };
}

// Read full request body as a string
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  const parsedUrl = new URL(req.url, `http://localhost:${PORT}`);

  // Generic HTTP proxy endpoint: POST /api
  if (parsedUrl.pathname === '/api' && req.method === 'POST') {
    try {
      const rawBody = await readBody(req);
      const { method, url, headers: customHeaders, body: requestBody } = JSON.parse(rawBody);

      if (!url || !method) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing method or url' }));
        return;
      }

      const fetchOpts = {
        method,
        headers: { ...customHeaders },
        redirect: 'follow',
      };

      if (requestBody && method !== 'GET') {
        fetchOpts.body = requestBody;
      }

      const proxyRes = await fetch(url, fetchOpts);
      const respBody = await proxyRes.text();

      // Collect response headers
      const respHeaders = {};
      proxyRes.headers.forEach((value, key) => {
        respHeaders[key] = value;
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: proxyRes.status,
        body: respBody,
        headers: respHeaders,
      }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Proxy error: ${err.message}` }));
    }
    return;
  }

  // Legacy RSS fetch endpoint: GET /?url=...
  const urlParam = parsedUrl.searchParams.get('url');

  if (!urlParam) {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('Missing ?url= parameter');
    return;
  }

  try {
    const targetUrl = new URL(urlParam);
    const headers = getHeadersForUrl(targetUrl);

    // Use built-in fetch (undici) — handles redirects automatically
    // and avoids TLS fingerprinting issues that block http.request()
    const proxyRes = await fetch(targetUrl.href, {
      method: 'GET',
      headers,
      redirect: 'follow',
    });

    // Forward the response
    const contentType = proxyRes.headers.get('content-type') || 'application/octet-stream';
    res.writeHead(proxyRes.status, { 'Content-Type': contentType });

    const body = await proxyRes.arrayBuffer();
    res.end(Buffer.from(body));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end(`Proxy error: ${err.message}`);
  }
});

server.listen(PORT, () => {
  console.log(`Proxy server running at http://localhost:${PORT}`);
  console.log(`Usage: http://localhost:${PORT}/?url=https://example.com`);
});
