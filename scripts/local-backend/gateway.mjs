// Loopback-only local development router, not the production gateway.
import http from 'node:http';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { readEnv, clientEnvPath, runtimeRoot } from './env.mjs';
const { SUPABASE_ANON_KEY } = readEnv(clientEnvPath);
const serverPath = resolve(runtimeRoot, 'server.env');
const serverKey = existsSync(serverPath) ? readEnv(serverPath).SUPABASE_SERVICE_ROLE_KEY : null;
const origins = new Set(['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:4173', 'http://127.0.0.1:4173', 'http://localhost:4174', 'http://127.0.0.1:4174', 'http://localhost:8787', 'http://127.0.0.1:8787']);
const server = http.createServer((req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const origin = req.headers.origin;
  if (origin && !origins.has(origin)) { res.writeHead(403); res.end('Origin not allowed'); return; }
  if (origin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'authorization,apikey,content-type,x-client-info,x-supabase-api-version,prefer');
    res.writeHead(204); res.end(); return;
  }
  if (req.url === '/health') { res.writeHead(200, {'Content-Type': 'application/json'}); res.end('{"service":"dima-b0-local-gateway"}'); return; }
  const oauthNavigation = req.method === 'GET' && ['/auth/v1/authorize', '/auth/v1/callback'].includes(new URL(req.url, 'http://127.0.0.1').pathname);
  if (!oauthNavigation && req.headers.apikey !== SUPABASE_ANON_KEY && (!serverKey || req.headers.apikey !== serverKey)) { res.writeHead(401); res.end('API key required'); return; }
  const broadcast = req.url === '/realtime/v1/api/broadcast' && req.method === 'POST';
  if (broadcast && req.headers.apikey !== serverKey) { res.writeHead(403); res.end('Server publisher required'); return; }
  const target = broadcast ? {port:54326,prefix:'/realtime/v1'} : req.url?.startsWith('/auth/v1/') ? {port:54323,prefix:'/auth/v1'} : req.url?.startsWith('/rest/v1/') ? {port:54324,prefix:'/rest/v1'} : null;
  if (!target) { res.writeHead(404); res.end(); return; }
  const upstream = http.request({hostname:'127.0.0.1',port:target.port,path:req.url.slice(target.prefix.length),method:req.method,headers:{...req.headers,...(broadcast ? {cookie:'',host:'realtime-dev.supabase-realtime'} : {host:`127.0.0.1:${target.port}`})}}, (response) => {
    const headers = {...response.headers, 'cache-control':'no-store'};
    // The gateway owns CORS, not the upstream service.
    delete headers['access-control-allow-origin']; delete headers['access-control-allow-credentials'];
    res.writeHead(response.statusCode ?? 502, headers); response.pipe(res);
  });
  upstream.setTimeout(15000, () => upstream.destroy(new Error('upstream timeout')));
  upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end('Local backend unavailable'); });
  req.on('aborted', () => upstream.destroy()); req.pipe(upstream);
});
// Transparent WebSocket proxy to official Realtime; no custom room protocol/server.
server.on('upgrade', (req, socket, clientHead) => {
  socket.on('error', () => socket.destroy());
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const reject = status => socket.end(`HTTP/1.1 ${status} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  if (url.pathname !== '/realtime/v1/websocket') { reject(404); return; }
  if (req.headers.origin && !origins.has(req.headers.origin)) { reject(403); return; }
  if (url.searchParams.get('apikey') !== SUPABASE_ANON_KEY) { reject(401); return; }
  const headers = { ...req.headers, host: 'realtime-dev.supabase-realtime' };
  delete headers.cookie;
  delete headers.authorization;
  const upstream = http.request({ hostname: '127.0.0.1', port: 54326, path: `/socket/websocket${url.search}`, method: 'GET', headers });
  let remote;
  socket.on('error', () => { upstream.destroy(); remote?.destroy(); });
  socket.on('close', () => { upstream.destroy(); remote?.destroy(); });
  upstream.setTimeout(10000, () => upstream.destroy(new Error('upgrade timeout')));
  upstream.on('upgrade', (response, peer, serverHead) => {
    remote = peer;
    if (socket.destroyed) { peer.destroy(); return; }
    upstream.setTimeout(0); peer.setTimeout(0);
    let responseHeaders = '';
    for (let index = 0; index < response.rawHeaders.length; index += 2) responseHeaders += `${response.rawHeaders[index]}: ${response.rawHeaders[index + 1]}\r\n`;
    socket.write(`HTTP/1.1 101 Switching Protocols\r\n${responseHeaders}\r\n`);
    if (clientHead.length) peer.write(clientHead);
    if (serverHead.length) socket.write(serverHead);
    peer.on('error', () => socket.destroy());
    peer.on('close', () => socket.destroy());
    peer.pipe(socket); socket.pipe(peer);
  });
  upstream.on('response', response => { reject(response.statusCode ?? 502); response.resume(); });
  upstream.on('error', () => { if (!socket.destroyed) { if (remote) socket.destroy(); else reject(502); } });
  upstream.end();
});
server.listen(54321, '127.0.0.1', () => process.stdout.write('Dima B0 gateway listening on loopback:54321\n'));
