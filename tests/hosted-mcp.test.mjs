import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Keyring } from '@polkadot/api';
import { cryptoWaitReady } from '@polkadot/util-crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';
import { Store } from '../lib/store.mjs';
import { createHttpApp } from '../lib/http-app.mjs';
import { AgentClient } from '../lib/agent-client.mjs';
import { McpSessions } from '../lib/mcp-sessions.mjs';
import { requestMessage, authenticateIdentity, sha256 } from '../lib/auth.mjs';
import { inferenceLimitRaw } from '../lib/hosted-mcp.mjs';
import { registerAgent, prepareOperation, commitOperation } from '../lib/ledger.mjs';
import { GENESIS, GATEWAY } from '../lib/config.mjs';
import { keyDid } from '../lib/did.mjs';
import { verifyEnrollmentSignature } from '../lib/enrollment.mjs';

await cryptoWaitReady();
const keyring = new Keyring({type:'ed25519'});
const alice = keyring.addFromSeed(new Uint8Array(32).fill(101));
const bob = keyring.addFromSeed(new Uint8Array(32).fill(102));
const charlie = keyring.addFromSeed(new Uint8Array(32).fill(103));
const funding = address => ({genesis:GENESIS,address,blockNumber:999,blockHash:'0x'+'a'.repeat(64),usableRaw:'1000000000000000000000000',checkedAt:new Date().toISOString()});
const rich = {scopes:['read','trade','infer','enroll'],limits:{maxPoints:10000,maxPaymentRaw:'10000000000000000000',maxInferenceRaw:'400000000000000000'}};
const decode = response => { assert.equal(response.isError,undefined,response.content?.[0]?.text); return JSON.parse(response.content[0].text); };

async function fixture(t, {mcpEnabled=true}={}) {
  const store = new Store(':memory:');
  const calls = {funding:0,submit:0,infer:0};
  const chain = {
    funding: async address => { calls.funding++; await new Promise(resolve=>setImmediate(resolve)); return funding(address); },
    quote: async op => ({genesis:GENESIS,estimatedFeeRaw:'1000',unsignedExtrinsic:'0x0102',callData:'0x0304',paymentRaw:op.action.paymentRaw||'0'}),
    submit: async () => { calls.submit++; throw new Error('Fixture chain rejects unsigned or unverified bytes.'); },
  };
  const inference = {
    allowance: () => ({connected:false}),
    create: (address,input) => {
      calls.infer++;
      const existing=store.read().sessions.find(s=>s.id===input.requestId);
      if(existing)return existing;
      return store.change(state=>{const session={id:input.requestId,actor:address,prompt:input.prompt,status:'unresolved',createdAt:new Date().toISOString()};state.sessions.push(session);return session;});
    },
    reconcileOne: async id => store.read().sessions.find(s=>s.id===id),
  };
  const app = createHttpApp({store,chain,inference,mcpEnabled});
  const server = http.createServer(app.handler);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin = 'http://127.0.0.1:'+server.address().port;
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));store.close();});
  const sdk = signer => new AgentClient({origin,signer});
  const issue = (signer=alice,options={}) => sdk(signer).createMcpSession(options);
  const rpc = async (method,params={},token,headers={},extra={}) => {
    const response = await fetch(origin+'/mcp',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream','MCP-Protocol-Version':LATEST_PROTOCOL_VERSION,...(token?{Authorization:'Bearer '+token}:{}),...headers},body:JSON.stringify({jsonrpc:'2.0',id:randomUUID(),method,params,...extra})});
    return {status:response.status,headers:response.headers,body:response.status===202?null:await response.json()};
  };
  const call = async (token,name,args={}) => {
    const response=await rpc('tools/call',{name,arguments:args},token);
    assert.equal(response.status,200,JSON.stringify(response.body));return response.body.result;
  };
  return {...app,store,chain,inference,calls,server,origin,sdk,issue,rpc,call};
}

test('operator shutdown revokes existing MCP sessions and leaves signed HTTP and the website available',async t=>{
  const enabled=await fixture(t),grant=await enabled.issue();
  createHttpApp({store:enabled.store,chain:enabled.chain,inference:enabled.inference,mcpEnabled:false});
  assert.ok(enabled.store.db.prepare('SELECT revoked_at FROM mcp_sessions WHERE id=?').get(grant.session.id).revoked_at);
  assert.equal((await enabled.rpc('tools/call',{name:'tower_me',arguments:{}},grant.access_token)).status,401);
  const disabled=await fixture(t,{mcpEnabled:false});
  assert.equal((await disabled.rpc('tools/list')).status,503);
  for(const method of ['GET','HEAD','DELETE'])assert.equal((await fetch(disabled.origin+'/mcp',{method})).status,503);
  await assert.rejects(disabled.issue(),/disabled/i);
  assert.equal(disabled.store.db.prepare('SELECT COUNT(*) AS n FROM mcp_sessions').get().n,0);
  const card=await (await fetch(disabled.origin+'/.well-known/agent-card.json')).json();
  assert.equal(card.mcp.enabled,false);assert.equal(card.mcp.url,null);
  const state=await (await fetch(disabled.origin+'/api/state')).json();
  assert.equal(state.services.mcp.enabled,false);
  assert.equal((await fetch(disabled.origin+'/')).status,200);
  await disabled.sdk(alice).onboard();
  assert.ok(disabled.store.read().agents.some(agent=>agent.address===alice.address));
  assert.deepEqual(disabled.calls,{funding:0,submit:0,infer:0});
});

test('official MCP client negotiates hosted Streamable HTTP and reads public/private tools',async t=>{
  const f=await fixture(t), publicClient=new Client({name:'public-fixture',version:'1'});
  await publicClient.connect(new StreamableHTTPClientTransport(new URL(f.origin+'/mcp')));
  assert.equal(publicClient.getServerVersion().name,'towa');
  const definitions=(await publicClient.listTools()).tools;
  assert.ok(definitions.some(tool=>tool.name==='tower_prepare'));
  assert.ok(!definitions.some(tool=>tool.name==='tower_operate'));
  assert.equal(decode(await publicClient.callTool({name:'tower_state',arguments:{}})).stats.collections,0);
  await publicClient.close();
  const grant=await f.issue();
  const privateClient=new Client({name:'private-fixture',version:'1'});
  await privateClient.connect(new StreamableHTTPClientTransport(new URL(f.origin+'/mcp'),{requestInit:{headers:{Authorization:'Bearer '+grant.access_token}}}));
  assert.equal(decode(await privateClient.callTool({name:'tower_me',arguments:{}})).agent.address,alice.address);
  await privateClient.close();
});

test('wallet proof creates a DID-bound session; altered, replayed, or foreign DID proofs fail',async t=>{
  const f=await fixture(t),body=JSON.stringify({did:keyDid(alice.publicKey),ttlSeconds:900});
  const fields={origin:f.origin,address:alice.address,timestamp:String(Date.now()),nonce:randomUUID(),method:'POST',path:'/v1/mcp/sessions',body};
  const signature='0x'+Buffer.from(alice.sign(new TextEncoder().encode(requestMessage(fields)))).toString('hex');
  const headers={'Content-Type':'application/json','X-Tower-Address':alice.address,'X-Tower-Timestamp':fields.timestamp,'X-Tower-Nonce':fields.nonce,'X-Tower-Signature':signature};
  const altered=await fetch(f.origin+fields.path,{method:'POST',headers,body:body.replace('900','3600')});assert.equal(altered.status,401);
  const valid=await fetch(f.origin+fields.path,{method:'POST',headers,body});assert.equal(valid.status,200);
  const grant=await valid.json();assert.equal(grant.session.did,keyDid(alice.publicKey));assert.equal(grant.session.limits.maxPaymentRaw,'0');
  const replay=await fetch(f.origin+fields.path,{method:'POST',headers,body});assert.equal(replay.status,401);
  await assert.rejects(f.issue(bob,{did:keyDid(alice.publicKey)}),/DID|key/i);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM mcp_sessions').get().n,1);
  assert.ok(!JSON.stringify(f.store.db.prepare('SELECT * FROM mcp_sessions').all()).includes(grant.access_token));
});

test('anonymous callers, URL credentials, transport IDs and browser origin/host spoofing cannot act',async t=>{
  const f=await fixture(t),grant=await f.issue();
  const unauth=await f.rpc('tools/call',{name:'tower_me',arguments:{}});assert.equal(unauth.status,401);
  assert.match(unauth.headers.get('www-authenticate'),/Bearer/);
  assert.equal((await f.rpc('tools/call',{name:'tower_me',arguments:{}},undefined,{'MCP-Session-Id':grant.session.id})).status,400);
  assert.equal((await f.rpc('tools/list',{},grant.access_token,{Origin:'https://attacker.invalid'})).status,403);
  const spoofedHost=await new Promise((resolve,reject)=>{const request=http.request(f.origin+'/mcp',{method:'POST',headers:{Host:'attacker.invalid','Content-Type':'application/json'}},response=>{response.resume();resolve(response.statusCode);});request.on('error',reject);request.end('{}');});
  assert.equal(spoofedHost,403);
  const urlToken=await fetch(f.origin+'/mcp?access_token='+grant.access_token,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(urlToken.status,400);
  assert.equal((await fetch(f.origin+'/mcp')).status,405);
  const attempt=await fetch(f.origin+'/v1/mcp/sessions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+grant.access_token},body:'{}'});assert.equal(attempt.status,401);
  const mutationNotification=await f.rpc('tools/call',{name:'tower_presence',arguments:{}},grant.access_token,{}, {id:undefined});assert.equal(mutationNotification.status,400);
});

test('concurrent agents cannot change actor, read private operations or access another agent’s prompt',async t=>{
  const f=await fixture(t),[a,b]=await Promise.all([f.issue(alice,rich),f.issue(bob,rich)]);
  const responses=await Promise.all(Array.from({length:12},(_,i)=>f.call(i%2?a.access_token:b.access_token,'tower_me')));
  responses.forEach((response,i)=>assert.equal(decode(response).agent.address,i%2?alice.address:bob.address));
  for(const fields of [{actor:bob.address},{address:bob.address},{did:keyDid(bob.publicKey)},{privateKey:'forbidden'}])assert.equal((await f.call(a.access_token,'tower_me',fields)).isError,true);
  f.store.change(state=>{state.operations.push({id:'bobs-op',actor:bob.address,status:'prepared'});state.sessions.push({id:'tower-bobs-private-inference',actor:bob.address,prompt:'private-fixture-prompt',result:{secret:'private-fixture-result'},publish:false});});
  assert.equal((await f.call(a.access_token,'tower_operation',{operationId:'bobs-op'})).isError,true);
  assert.equal((await f.call(a.access_token,'tower_submit',{operationId:'bobs-op',extrinsic:'0x0000'})).isError,true);
  assert.equal((await f.call(a.access_token,'tower_receipt',{requestId:'tower-bobs-private-inference'})).isError,true);
  assert.ok(!JSON.stringify(decode(await f.call(a.access_token,'tower_me'))).includes('private-fixture-prompt'));
  assert.ok(!JSON.stringify(decode(await f.call(undefined,'tower_state'))).includes('private-fixture-result'));
  assert.equal(f.calls.submit,0);
});

test('read sessions cannot trade or infer and strict schemas reject fake accounting or collection bids',async t=>{
  const f=await fixture(t),a=await f.issue();
  const send={requestId:'remote-readonly-send-001',type:'send',recipient:bob.address,amountRaw:'1000000000000000'};
  assert.match((await f.call(a.access_token,'tower_prepare',send)).content[0].text,/does not allow trade/);
  assert.match((await f.call(a.access_token,'tower_infer',{requestId:'tower-readonly-inference-001',prompt:'Fixture'})).content[0].text,/does not allow infer/);
  const b=await f.issue(alice,rich);
  assert.equal((await f.call(b.access_token,'tower_prepare',{...send,points:1000000,proof:{verified:true}})).isError,true);
  assert.equal((await f.call(b.access_token,'tower_bid',{requestId:'remote-bundle-offer-001',collectionId:'collection',pointsPrice:1,paymentRaw:'1000'})).isError,true);
  assert.equal(f.calls.funding,0);assert.equal(f.calls.infer,0);assert.equal(f.store.read().operations.length,0);
});

test('concurrent requests cannot overspend a grant; exact retries debit once and changed arguments fail',async t=>{
  const f=await fixture(t);await f.issue(bob);
  const grant=await f.issue(alice,{scopes:['read','trade'],limits:{maxPaymentRaw:'1000000000000000'}});
  const input={requestId:'remote-budget-send-001',type:'send',recipient:bob.address,amountRaw:'1000000000000000'};
  const responses=await Promise.all([f.call(grant.access_token,'tower_prepare',input),f.call(grant.access_token,'tower_prepare',{...input,requestId:'remote-budget-send-002'})]);
  assert.equal(responses.filter(r=>!r.isError).length,1);
  const op=decode(responses.find(r=>!r.isError)),saved={...input,requestId:op.requestId};
  assert.equal(decode(await f.call(grant.access_token,'tower_prepare',saved)).id,op.id);
  assert.match((await f.call(grant.access_token,'tower_prepare',{...saved,amountRaw:'2000000000000000'})).content[0].text,/different arguments/);
  const state=decode(await f.call(grant.access_token,'tower_session'));
  assert.equal(state.used.intents,1);assert.equal(state.used.paymentRaw,'1000000000000000');
  assert.equal(f.store.read().operations.length,1);assert.equal(f.calls.submit,0);
  assert.equal(decode(await f.call(grant.access_token,'tower_abandon',{operationId:op.id})).status,'cancelled');
  assert.equal(decode(await f.call(grant.access_token,'tower_session')).used.paymentRaw,'1000000000000000');
});

test('session revocation during a funding lookup prevents a later reservation',async t=>{
  const f=await fixture(t);await f.issue(bob);
  const grant=await f.issue(alice,rich);
  f.chain.funding=async address=>{f.sessions.revoke(alice.address,grant.session.id,f.origin);return funding(address);};
  const response=await f.call(grant.access_token,'tower_prepare',{requestId:'remote-revoke-during-funding',type:'send',recipient:bob.address,amountRaw:'1000000000000000'});
  assert.equal(response.isError,true);assert.match(response.content[0].text,/revoked/);assert.equal(f.store.read().operations.length,0);
});

test('inference delegation uses cumulative exact caps, preserves request IDs, and awards no unverified points',async t=>{
  const f=await fixture(t),grant=await f.issue(alice,{scopes:['read','infer'],limits:{maxInferenceRaw:'200000000000000000'}});
  const args={requestId:'tower-remote-budget-inference',prompt:'Fixture only',maxCostFlop:0.2};
  const first=decode(await f.call(grant.access_token,'tower_infer',args));
  assert.equal(decode(await f.call(grant.access_token,'tower_infer',args)).id,first.id);
  assert.equal((await f.call(grant.access_token,'tower_infer',{...args,requestId:'tower-remote-budget-inference-two'})).isError,true);
  assert.equal((await f.call(grant.access_token,'tower_infer',{...args,prompt:'Changed intent'})).isError,true);
  const session=decode(await f.call(grant.access_token,'tower_session'));
  assert.equal(session.used.inferenceRaw,'200000000000000000');assert.equal(session.used.intents,1);
  assert.equal(f.store.read().sessions.length,1);assert.equal(decode(await f.call(grant.access_token,'tower_me')).agent.points,0);
  assert.equal(inferenceLimitRaw(0.10000000000000002),'100000000000000020');
  assert.equal(inferenceLimitRaw(1e-7),'100000000000');assert.equal(inferenceLimitRaw(1e-30),'1');
});

test('one-NFT offer and settlement share delegation allowance; other pieces and creator royalties stay separate',async t=>{
  const f=await fixture(t),creator=await f.issue(alice,rich),buyer=await f.issue(bob,{scopes:['read','trade'],limits:{maxPoints:10,maxPaymentRaw:'10000000000000000'}});
  // Fixture issuance is isolated from the live database and never invokes FLOP.
  f.store.change(state=>{const agent=state.agents.find(a=>a.address===alice.address);agent.points=1000;agent.pointLots=[{sourceId:'fixture-creator',available:1000,sourceType:'fixture'}];});
  const creation=f.store.change(state=>prepareOperation(state,alice.address,{requestId:'remote-fixture-collection-001',type:'mint-collection',collectionNumber:1,maxPoints:1000,maxPaymentRaw:'111111111111111112',pointsShareBps:9000},undefined,funding(alice.address)));
  const proof={genesis:GENESIS,blockNumber:100,blockHash:'0x'+'b'.repeat(64),txHash:'0x'+'c'.repeat(64)};
  f.store.change(state=>{Object.assign(state.operations.find(o=>o.id===creation.id),{status:'submitted',txHash:proof.txHash});commitOperation(state,creation.id,proof);const b=state.agents.find(a=>a.address===bob.address);b.points=10;b.pointLots=[{sourceId:'fixture-buyer',available:10,sourceType:'fixture'}];});
  const items=f.store.read().items,untouched=structuredClone(items.slice(1));
  const offer=decode(await f.call(buyer.access_token,'tower_bid',{requestId:'remote-one-nft-offer-001',itemId:items[0].id,pointsPrice:10,paymentRaw:'10000000000000000'}));
  assert.equal((await f.call(buyer.access_token,'tower_offer_action',{bidId:offer.id,action:'accept'})).isError,true);
  decode(await f.call(creator.access_token,'tower_offer_action',{bidId:offer.id,action:'accept'}));
  const op=decode(await f.call(buyer.access_token,'tower_prepare',{requestId:'remote-one-nft-settlement-001',type:'settle-bid',bidId:offer.id,seller:alice.address,creator:alice.address,maxPoints:10,maxPaymentRaw:'10000000000000000'}));
  assert.equal(decode(await f.call(buyer.access_token,'tower_session')).used.points,10);
  assert.equal(op.action.royaltyRaw,'500000000000000');assert.equal(op.action.platformFeeRaw,'200000000000000');
  const bad=await f.call(buyer.access_token,'tower_submit',{operationId:op.id,extrinsic:'0x0000'});assert.equal(bad.isError,true);assert.equal(f.calls.submit,1);
  assert.equal(f.store.read().items[0].owner,alice.address);assert.equal(f.store.read().operations.find(o=>o.id===op.id).pointsStatus,'held');
  f.store.change(state=>{Object.assign(state.operations.find(o=>o.id===op.id),{status:'submitted',txHash:proof.txHash});commitOperation(state,op.id,proof);});
  assert.equal(f.store.read().items[0].owner,bob.address);assert.deepEqual(f.store.read().items.slice(1),untouched);
  assert.equal(f.store.read().collections[0].creator,alice.address);assert.equal(f.store.read().operations.find(o=>o.id===op.id).pointsStatus,'burned');
});

test('grant secrets, budgets, proof nonces, expiry and revocation survive a database restart',()=>{
  const directory=mkdtempSync(join(tmpdir(),'towa-remote-auth-')),file=join(directory,'tower.sqlite');
  let store=new Store(file),sessions=new McpSessions(store);
  try {
    const origin='https://towa.example',now=Date.now(),body='{}',fields={origin,address:alice.address,timestamp:String(now),nonce:randomUUID(),method:'POST',path:'/v1/mcp/sessions',body};
    const request={method:fields.method,url:fields.path,headers:{'x-tower-address':alice.address,'x-tower-timestamp':fields.timestamp,'x-tower-nonce':fields.nonce,'x-tower-signature':'0x'+Buffer.from(alice.sign(new TextEncoder().encode(requestMessage(fields)))).toString('hex')}};
    const identity=authenticateIdentity(request,body,store,origin),issued=sessions.issue(identity,origin,{scopes:['read','trade'],ttlSeconds:60,limits:{maxPoints:10}});
    const grant=sessions.authenticate('Bearer '+issued.access_token,origin);
    sessions.reserve(grant,'trade',{key:'fixture-intent',fingerprint:sha256('intent'),points:10});
    store.close();assert.ok(!readFileSync(file).includes(Buffer.from(issued.access_token)));
    store=new Store(file);sessions=new McpSessions(store);
    assert.equal(sessions.authenticate('Bearer '+issued.access_token,origin).used.points,10);
    assert.throws(()=>authenticateIdentity(request,body,store,origin),/already used/);
    assert.throws(()=>sessions.reserve(grant,'trade',{key:'second-intent',fingerprint:sha256('other'),points:1}),/limit/);
    assert.throws(()=>sessions.authenticate('Bearer '+issued.access_token,'https://other.example'),/another origin/);
    assert.throws(()=>sessions.authenticate('Bearer '+issued.access_token,origin,now+61000),/expired/);
    assert.throws(()=>sessions.revoke(bob.address,grant.id,origin),/does not belong/);
    sessions.revoke(alice.address,grant.id,origin);store.close();store=new Store(file);sessions=new McpSessions(store);
    assert.throws(()=>sessions.authenticate('Bearer '+issued.access_token,origin),/revoked/);
  } finally { store.close();rmSync(directory,{recursive:true,force:true}); }
});

test('gateway enrollment requires a locally signed challenge for the same wallet and network',async()=>{
  const message=`${new URL(GATEWAY).host} wants you to enroll a FLOP devnet gateway key with your account:\n${alice.address}\n\nAction: flop-devnet-enroll/v1\nGenesis: ${GENESIS}\nNonce: ${'a'.repeat(64)}\nIssued At: ${new Date().toISOString()}\nExpiration Time: ${new Date(Date.now()+120000).toISOString()}`;
  const client=new AgentClient({origin:'https://towa.example',signer:alice});
  const signed=await client.signEnrollment(message);
  assert.doesNotThrow(()=>verifyEnrollmentSignature(message,signed.signature,alice.address));
  const wrongSignature='0x'+Buffer.from(bob.sign(new TextEncoder().encode(message))).toString('hex');
  assert.throws(()=>verifyEnrollmentSignature(message,wrongSignature,alice.address),/signed locally/);
  await assert.rejects(new AgentClient({origin:'https://towa.example',signer:bob}).signEnrollment(message),/Unrecognized/);
  await assert.rejects(client.signEnrollment(message.replace(GENESIS,'0x'+'f'.repeat(64))),/Unrecognized/);
});
