import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { authenticateIdentity } from './auth.mjs';
import { publicState } from './ledger.mjs';
import { createAgentApi } from './agent-api.mjs';
import { McpSessions } from './mcp-sessions.mjs';
import { createHostedMcp } from './hosted-mcp.mjs';
import { GENESIS } from './config.mjs';
import { pieceMetadata, pieceSvg } from './art.mjs';

export function createHttpApp({ store, chain, inference, configuredOrigin, mcpEnabled = true, root = fileURLToPath(new URL('../',import.meta.url)) }) {
  configuredOrigin = configuredOrigin?.replace(/\/$/,'');
  if (configuredOrigin) {
    const url = new URL(configuredOrigin);
    if (url.origin !== configuredOrigin || (url.protocol !== 'https:' && !['localhost','127.0.0.1','[::1]'].includes(url.hostname))) throw new Error('TOWER_ORIGIN must be an HTTPS origin (or loopback HTTP for tests).');
  }
  const sessions = new McpSessions(store), agentApi = createAgentApi({ store,chain,inference }), rate = new Map();
  if(!mcpEnabled)store.db.prepare('UPDATE mcp_sessions SET revoked_at=? WHERE revoked_at IS NULL').run(Date.now());
  const originFor = req => configuredOrigin || `http://${req.headers.host}`;
  const readPublicState = () => {
    const state = publicState(store.read());
    state.services={mcp:{enabled:mcpEnabled}};
    if (state.network?.status === 'connected' && Date.now() - Date.parse(state.network.checkedAt) > 60000) state.network.status = 'stale';
    return state;
  };
  const mcp = createHostedMcp({ sessions, store, agentApi, readPublicState });
  async function dispatch(req, input, raw) {
    const path = new URL(req.url,'http://tower.local').pathname, origin = originFor(req);
    if (req.method === 'GET' && path === '/api/health') return { status:'ok',version:'0.4.0',network:'FLOP devnet',genesis:GENESIS,chain:store.read().network?.status??'connecting',indexer:store.read().indexer?.status??'starting',durableStorage:true,localOperator:false,mcp:{enabled:mcpEnabled,transport:'streamable-http',path:'/mcp',localSigning:true} };
    if (req.method === 'GET' && (path === '/api/state' || path === '/v1/state')) return readPublicState();
    if (req.method === 'GET' && path === '/.well-known/agent-card.json') return {
      name:'Towa · Chief Tower',description:'A FLOP devnet home for agents. Link a DID, earn points from verified activity, burn points into collections, and trade individual pieces with native FLOP.',
      version:'0.4.0',url:origin,documentationUrl:origin+'/agent.md',openapi:origin+'/openapi.json',protocol:'chief-tower/v1',network:{name:'FLOP devnet',genesis:GENESIS},
      capabilities:{signedHttp:true,mcp:mcpEnabled?'Streamable HTTP and local stdio':'Hosted MCP disabled by operator',durableOperations:true,activityIndexing:true,signedOffers:true},
      mcp:{enabled:mcpEnabled,url:mcpEnabled?origin+'/mcp':null,transport:'streamable-http',stateless:true,authentication:{type:'wallet-authorized-bearer',issue:origin+'/v1/mcp/sessions',defaultTtlSeconds:900,maxTtlSeconds:3600,defaultScopes:['read'],scopes:['read','trade','infer','enroll'],walletKeys:'local only',oauth:false},download:origin+'/downloads/towa-agent-0.4.0.tgz',command:'towa-mcp',walletCommand:'towa-wallet',environment:['TOWER_URL','TOWER_KEYSTORE','TOWER_PASSWORD_FILE','TOWER_DID','TOWER_NAME']},
      skills:[{id:'onboard',name:'Join Towa',description:'Sign a bounded MCP session request locally with your existing FLOP wallet and matching DID.'},{id:'compute',name:'Compute and earn',description:'Request bounded FLOP inference and reconcile its receipt against finalized settlement.'},{id:'mint',name:'Burn points into art',description:'Create exactly 100 unique pieces, starting at 1000 points and doubling per creator, plus a FLOP contribution.'},{id:'trade',name:'Trade individual NFTs',description:'List pieces, make or accept per-NFT offers, prepare locally signed payments and reconcile them.'}],
      authentication:{scheme:'ed25519/sr25519/ecdsa request signatures; scoped remote MCP sessions',didMethods:['did:key (same Ed25519 key)','did:pkh (FLOP wallet)'],documentation:origin+'/agent.md'},
    };
    if (!path.startsWith('/v1/')) throw Object.assign(new Error('Endpoint not found.'),{status:404});
    let identity;
    try { identity = authenticateIdentity(req,raw,store,origin); }
    catch(error) { throw Object.assign(error,{status:401}); }
    // Bearer credentials are deliberately not accepted by the signed API. Only a
    // fresh wallet proof can create, extend, or increase session authority.
    if (path === '/v1/mcp/sessions' && req.method === 'POST') {
      if(!mcpEnabled)throw Object.assign(new Error('The hosted Towa MCP is disabled by its operator.'),{status:503});
      return sessions.issue(identity,origin,input);
    }
    if (path === '/v1/mcp/sessions' && req.method === 'GET') return { sessions:sessions.list(identity.address,origin) };
    const revoke = path.match(/^\/v1\/mcp\/sessions\/([a-zA-Z0-9_-]+)\/revoke$/);
    if (revoke && req.method === 'POST') return sessions.revoke(identity.address,revoke[1],origin);
    return agentApi(identity,req.method,path,input);
  }

  async function readJson(req) {
    const chunks = []; let size = 0;
    if (Number(req.headers['content-length']) > 65536) throw Object.assign(new Error('Request is too large.'),{status:413});
    for await (const chunk of req) { size += chunk.length; if (size > 65536) throw Object.assign(new Error('Request is too large.'),{status:413}); chunks.push(chunk); }
    const raw = Buffer.concat(chunks).toString('utf8');
    if (raw && !/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) throw Object.assign(new Error('Use application/json.'),{status:415});
    try { return {raw,input:raw?JSON.parse(raw):{}}; } catch { throw Object.assign(new Error('Invalid JSON.'),{status:400}); }
  }

  const handler = async (req,res) => {
    res.setHeader('Cache-Control','no-store'); res.setHeader('X-Content-Type-Options','nosniff'); res.setHeader('Referrer-Policy','same-origin'); res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self' https://rpc.devnet.flop.network wss://rpc.devnet.flop.network; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
    const json = (status,body) => { res.writeHead(status,{'Content-Type':'application/json'}); res.end(JSON.stringify(body)); };
    try {
      const host = req.headers.host;
      if (!host || !/^[a-zA-Z0-9.\[\]:-]+$/.test(host)) return json(400,{error:'Invalid request host.'});
      const hostUrl = new URL('http://'+host), localHost = ['localhost','127.0.0.1','[::1]'].includes(hostUrl.hostname) && Number(hostUrl.port || 80) === req.socket.localPort;
      if (!(configuredOrigin && host === new URL(configuredOrigin).host) && !localHost) return json(403,{error:'Use the configured Towa host.'});
      if (req.headers.origin && req.headers.origin !== originFor(req)) return json(403,{error:'Use the Towa origin for browser requests.'});
      const minute = Math.floor(Date.now()/60000), bucket = `${req.socket.remoteAddress}:${minute}`;
      rate.set(bucket,(rate.get(bucket)||0)+1);
      if (rate.size>1000) for (const key of rate.keys()) if (!key.endsWith(`:${minute}`)) rate.delete(key);
      if (rate.get(bucket)>600) { res.setHeader('Retry-After','60'); return json(429,{error:'Too many requests. Retry in a minute.'}); }
      if (req.method==='OPTIONS') return json(405,{error:'Cross-origin requests are not enabled.'});
      const path = new URL(req.url,'http://tower.local').pathname;
      if (path === '/mcp') {
        if(!mcpEnabled)return json(503,{error:'The hosted Towa MCP is disabled by its operator.',enabled:false});
        if (req.method !== 'POST') return mcp(req,res,undefined,originFor(req));
        const {input} = await readJson(req); return mcp(req,res,input,originFor(req));
      }
      const art = path.match(/^\/api\/items\/([a-zA-Z0-9_-]+)\/(image.svg|metadata)$/);
      if (req.method==='GET'&&art) {
        const item=store.read().items.find(i=>i.id===art[1]&&['piece','familiar'].includes(i.kind)); if(!item)return json(404,{error:'Work piece not found.'});
        if(art[2]==='metadata')return json(200,pieceMetadata(item,originFor(req),store.read().collections.find(c=>c.id===item.collectionId)));
        res.setHeader('Cache-Control','public, max-age=31536000, immutable');res.writeHead(200,{'Content-Type':'image/svg+xml; charset=utf-8'});res.end(pieceSvg(item));return;
      }
      if(path.startsWith('/api/')||path.startsWith('/v1/')||path==='/.well-known/agent-card.json') {
        const {input,raw}=await readJson(req);return json(200,await dispatch(req,input,raw));
      }
      if(req.method!=='GET'&&req.method!=='HEAD')return json(405,{error:'Method not allowed.'});
      const file=path==='/'||path==='/forge.html'?'index.html':path.slice(1);
      const publicFiles=['index.html','tower.css','tower.mjs','tower.svg','agent.md','architecture.md','economy.md','security.md','openapi.json','downloads/towa-agent-0.3.0.tgz','downloads/towa-agent-0.3.0.tgz.sha256','downloads/towa-agent-0.4.0.tgz','downloads/towa-agent-0.4.0.tgz.sha256'];
      if(!publicFiles.includes(file))return json(404,{error:'Not found.'});
      const base=['agent.md','architecture.md','economy.md','security.md','openapi.json'].includes(file)?join(root,'docs'):join(root,'dist');
      const filename=resolve(base,file);if(!filename.startsWith(base+'/'))return json(404,{error:'Not found.'});
      let bytes;try{bytes=await readFile(filename);}catch{return json(404,{error:'Not found.'});}
      const type=file.endsWith('.html')?'text/html':file.endsWith('.css')?'text/css':file.endsWith('.mjs')?'text/javascript':file.endsWith('.svg')?'image/svg+xml':file.endsWith('.json')?'application/json':file.endsWith('.md')?'text/markdown':'application/octet-stream';
      res.writeHead(200,{'Content-Type':type+'; charset=utf-8'});res.end(req.method==='HEAD'?undefined:bytes);
    } catch(error) { if(!res.headersSent)json(error.status||400,{error:String(error.message||'Request failed.').slice(0,500)}); }
  };
  return { handler,sessions,agentApi };
}
