import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';
import { configuredSigner } from '../lib/signer.mjs';
import { AgentClient } from '../lib/agent-client.mjs';

// Read-only live verification using an existing identity. No inference, rewards,
// transaction signing, offers or payments are requested. Tokens never reach logs.
const origin=(process.argv[2]||process.env.TOWER_URL||'http://127.0.0.1:4173').replace(/\/$/,'');
const endpoint=new URL(origin+'/mcp');
const identity=await configuredSigner({...process.env,...(!process.env.TOWER_KEYSTORE?{TOWER_AGENT:process.argv[3]||process.env.TOWER_AGENT||'clone-01'}:{})});
const wallet=new AgentClient({origin,...identity}),clients=[];
const connect=async token=>{
  const client=new Client({name:'towa-hosted-smoke',version:'0.4.0'});clients.push(client);
  await client.connect(new StreamableHTTPClientTransport(endpoint,{requestInit:{redirect:'error',...(token?{headers:{Authorization:'Bearer '+token}}:{})}}));
  return client;
};
const decode=result=>{assert.ok(!result.isError,result.content?.[0]?.text);return JSON.parse(result.content[0].text);};
let issued,revoked=false;
try {
  const publicClient=await connect();
  const definitions=(await publicClient.listTools()).tools;
  for(const name of ['tower_prepare','tower_submit','tower_session','tower_presence','tower_bid'])assert.ok(definitions.some(tool=>tool.name===name));
  const before=decode(await publicClient.callTool({name:'tower_state',arguments:{}}));
  const card=await (await fetch(origin+'/.well-known/agent-card.json',{redirect:'error',signal:AbortSignal.timeout(20000)})).json();
  assert.equal(card.mcp.url,endpoint.href);assert.equal(card.mcp.transport,'streamable-http');
  issued=await wallet.createMcpSession({scopes:['read'],ttlSeconds:300});
  const client=await connect(issued.access_token);
  const me=decode(await client.callTool({name:'tower_me',arguments:{}}));assert.equal(me.agent.address,identity.signer.address);
  assert.equal(decode(await client.callTool({name:'tower_quote',arguments:{}})).nextCollection.size,100);
  const denied=await client.callTool({name:'tower_prepare',arguments:{requestId:'hosted-smoke-readonly-check-001',type:'check-in'}});
  assert.ok(denied.isError);assert.match(denied.content[0].text,/does not allow trade/);
  const malformed=await client.callTool({name:'tower_bid',arguments:{requestId:'hosted-smoke-invalid-offer-001',collectionId:'not-an-item',pointsPrice:1,paymentRaw:'1000000000000000'}});
  assert.ok(malformed.isError);assert.match(malformed.content[0].text,/one NFT/);
  const session=decode(await client.callTool({name:'tower_session',arguments:{}}));assert.equal(session.used.intents,0);
  const after=decode(await publicClient.callTool({name:'tower_state',arguments:{}}));
  assert.equal(after.operations.length,before.operations.length);assert.equal(after.collections.length,before.collections.length);assert.equal(after.bids.length,before.bids.length);
  await wallet.revokeMcpSession(issued.session.id);revoked=true;
  const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream','MCP-Protocol-Version':LATEST_PROTOCOL_VERSION,Authorization:'Bearer '+issued.access_token},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'tower_me',arguments:{}}}),redirect:'error',signal:AbortSignal.timeout(20000)});
  assert.equal(response.status,401);
  const report={at:new Date().toISOString(),origin,mcpUrl:endpoint.href,transport:'streamable-http',server:publicClient.getServerVersion(),toolCount:definitions.length,publicDiscovery:true,privateWalletSession:true,scopeEnforcement:true,collectionOffersRejected:true,revocationVerified:true,walletKeysLocal:true,agent:me.agent.name,liveTransactionsSubmitted:0,liveInferencesSubmitted:0,stats:after.stats};
  await writeFile(new URL('../outputs/hosted-mcp-smoke.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
  if(/^[a-z0-9-]+$/.test(me.agent.name))await writeFile(new URL('../outputs/hosted-mcp-smoke-'+me.agent.name+'.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
} finally {
  if(issued&&!revoked)await wallet.revokeMcpSession(issued.session.id).catch(()=>{});
  await Promise.allSettled(clients.map(client=>client.close()));
}
