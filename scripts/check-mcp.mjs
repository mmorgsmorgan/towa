import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const origin=process.env.TOWER_URL||process.argv[2]||'http://127.0.0.1:4173';
const env={...process.env,TOWER_URL:origin,TOWER_AGENT:'clone-01'};
for(const key of ['TOWER_KEYSTORE','TOWER_PASSWORD_FILE','TOWER_DID','TOWER_NAME'])delete env[key];
const child=spawn(process.execPath,['--dns-result-order=ipv4first','--use-env-proxy',new URL('./mcp.mjs',import.meta.url).pathname],{env,stdio:['pipe','pipe','pipe']});
let id=0;const pending=new Map();
const lines=createInterface({input:child.stdout});
lines.on('line',line=>{try{const msg=JSON.parse(line);pending.get(msg.id)?.(msg);}catch{}});
child.stderr.on('data',()=>{});
function rpc(method,params={}){return new Promise((resolve,reject)=>{const key=++id,timer=setTimeout(()=>{pending.delete(key);reject(Error('MCP response timed out.'));},45000);pending.set(key,message=>{clearTimeout(timer);pending.delete(key);message.error?reject(Error(message.error.message)):resolve(message.result);});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:key,method,params})+'\n');});}
const call=(name,args={})=>rpc('tools/call',{name,arguments:args});
const decode=result=>{if(result.isError)throw Error(result.content[0].text);return JSON.parse(result.content[0].text);};
try{
  const initialized=await rpc('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'towa-live-smoke',version:'1'}});
  const tools=await rpc('tools/list');assert.ok(tools.tools.some(t=>t.name==='tower_bid'&&t.inputSchema.required.includes('paymentRaw')&&t.inputSchema.required.includes('itemId')&&!t.inputSchema.properties.collectionId));
  const state=decode(await call('tower_state'));assert.equal(state.economy.pointValueRaw,'1000000000000000');
  const joined=decode(await call('tower_join'));assert.equal(joined.name,'clone-01');assert.match(joined.did,/^did:key:/);
  const me=decode(await call('tower_me'));assert.ok(me.agent.connectedUntil);assert.ok(!JSON.stringify(me).includes('encoded'));
  const quote=decode(await call('tower_quote'));assert.equal(quote.nextCollection.size,100);
  const collectionOffer=await call('tower_bid',{requestId:'mcp-smoke-collection-offer-20261107',collectionId:'unissued-collection',pointsPrice:1,paymentRaw:'1000000000000000'});
  assert.equal(collectionOffer.isError,true);assert.match(collectionOffer.content[0].text,/one NFT/);
  const invalidOffer=await call('tower_bid',{requestId:'mcp-smoke-unissued-offer-20261107',itemId:'unissued-smoke-item',pointsPrice:1,paymentRaw:'1000000000000000'});
  assert.equal(invalidOffer.isError,true);assert.match(invalidOffer.content[0].text,/unavailable/);
  const report={origin,at:new Date().toISOString(),protocol:initialized.protocolVersion,toolCount:tools.tools.length,address:joined.address,did:joined.did,points:me.agent.points,nextCollection:quote.nextCollection,collectionOfferRejected:true,unissuedItemOfferRejected:true};
  await mkdir(new URL('../outputs/',import.meta.url),{recursive:true});
  await writeFile(new URL('../outputs/mcp-smoke.json',import.meta.url),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
}finally{child.stdin.end();child.kill('SIGTERM');lines.close();}
