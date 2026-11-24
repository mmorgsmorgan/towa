import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createInterface } from 'node:readline';
import { mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomBytes, createHash } from 'node:crypto';
import { Keyring } from '@polkadot/api';
import { cryptoWaitReady, signatureVerify } from '@polkadot/util-crypto';
import { Store } from '../lib/store.mjs';
import { authenticateIdentity } from '../lib/auth.mjs';
import { registerAgent, publicState, agentFor } from '../lib/ledger.mjs';
import { validateOfferInput } from '../lib/offer-input.mjs';
import { McpSessions } from '../lib/mcp-sessions.mjs';
import { GENESIS, GATEWAY } from '../lib/config.mjs';

// Isolated package/identity check. No real wallet, devnet call, points or live ledger writes.
const install=process.argv[2];
if(!install)throw new Error('Pass the directory containing the installed towa-agent package.');
const directory=join(install,'node_modules','towa-agent');
const manifest=JSON.parse(await readFile(join(directory,'package.json'),'utf8'));
assert.equal(manifest.bin['towa-mcp'],'./bin.mjs');
assert.equal(manifest.bin['towa-wallet'],'./wallet-bin.mjs');
for(const file of ['mcp.mjs','client.mjs','wallet.mjs']){
  const source=await readFile(join(directory,file),'utf8');
  for(const forbidden of ['seed.hex','TOWER_IDENTITY_DIR','/home/chief','node:sqlite'])assert.ok(!source.includes(forbidden),`${file} includes a private/local server adapter`);
}
await cryptoWaitReady();
const temporary=await mkdtemp(join(tmpdir(),'towa-package-identity-'));
const store=new Store(':memory:');
const mcpSessions=new McpSessions(store);
let child,lines,origin,signedRequests=0,bidRequests=0,stdout='',stderr='';
const pending=new Map();
const server=http.createServer(async(req,res)=>{
  try{
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    const raw=Buffer.concat(chunks).toString('utf8'),input=raw?JSON.parse(raw):{};
    let result;
    if(req.method==='GET'&&req.url==='/v1/state')result=publicState(store.read());
    else{
      const identity=authenticateIdentity(req,raw,store,origin);signedRequests++;
      if(req.method==='POST'&&req.url==='/v1/mcp/sessions')result=mcpSessions.issue(identity,origin,input);
      else if(req.method==='GET'&&req.url==='/v1/mcp/sessions')result={sessions:mcpSessions.list(identity.address,origin)};
      else if(req.method==='POST'&&/^\/v1\/mcp\/sessions\/[a-zA-Z0-9_-]+\/revoke$/.test(req.url))result=mcpSessions.revoke(identity.address,req.url.split('/')[4],origin);
      else if(req.method==='POST'&&req.url==='/v1/agents')result=store.change(s=>registerAgent(s,identity.address,input.name,{did:input.did,signatureType:identity.signatureType}));
      else if(req.method==='GET'&&req.url==='/v1/agents/me')result={agent:agentFor(store.read(),identity.address)};
      else if(req.method==='POST'&&req.url==='/v1/bids'){bidRequests++;validateOfferInput(input);throw new Error('This isolated test has no issued NFTs.');}
      else throw new Error('Unexpected package request: '+req.method+' '+req.url);
    }
    res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(result));
  }catch(error){res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:error.message}));}
});
try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
  const signer=new Keyring({type:'ed25519',ss58Format:42}).addFromSeed(randomBytes(32));
  const password=randomBytes(32).toString('hex'),wallet=signer.toJson(password);
  const keystore=join(temporary,'agent.json'),passwordFile=join(temporary,'password.txt');
  await writeFile(keystore,JSON.stringify(wallet),{mode:0o600});await writeFile(passwordFile,password+'\n',{mode:0o600});
  child=spawn(join(install,'node_modules','.bin','towa-mcp'),[],{env:{...process.env,TOWER_URL:origin,TOWER_KEYSTORE:keystore,TOWER_PASSWORD_FILE:passwordFile,TOWER_NAME:'portable-smoke',TOWER_DID:'',TOWER_AGENT:''},stdio:['pipe','pipe','pipe']});
  child.stdout.on('data',chunk=>{stdout+=chunk;});child.stderr.on('data',chunk=>{stderr+=chunk;});
  lines=createInterface({input:child.stdout});
  lines.on('line',line=>{try{const message=JSON.parse(line);pending.get(message.id)?.(message);}catch{}});
  let id=0;
  const rpc=(method,params={})=>new Promise((resolve,reject)=>{
    const key=++id,timer=setTimeout(()=>{pending.delete(key);reject(new Error('Installed MCP did not respond.'));},15000);
    pending.set(key,message=>{clearTimeout(timer);pending.delete(key);message.error?reject(new Error(message.error.message)):resolve(message.result);});
    child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:key,method,params})+'\n');
  });
  const call=(name,args={})=>rpc('tools/call',{name,arguments:args});
  const decode=result=>{assert.ok(!result.isError,result.content?.[0]?.text);return JSON.parse(result.content[0].text);};
  const initialization=await rpc('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'isolated-package-test',version:'1'}});
  assert.equal(initialization.serverInfo.name,'towa');
  const definitions=(await rpc('tools/list')).tools;
  const offer=definitions.find(tool=>tool.name==='tower_bid');
  assert.ok(offer.inputSchema.required.includes('itemId'));
  assert.equal(offer.inputSchema.additionalProperties,false);assert.ok(!offer.inputSchema.properties.collectionId);
  assert.equal(decode(await call('tower_state')).stats.collections,0);
  const joined=decode(await call('tower_join'));assert.equal(joined.address,signer.address);assert.match(joined.did,/^did:key:/);
  assert.equal(decode(await call('tower_me')).agent.points,0);
  const malformed=await call('tower_bid',{requestId:'isolated-package-offer-0001',collectionId:'collection',pointsPrice:10,paymentRaw:'10000000000000000'});
  assert.equal(malformed.isError,true);assert.match(malformed.content[0].text,/one NFT/);assert.equal(bidRequests,0);
  const unissued=await call('tower_bid',{requestId:'isolated-package-offer-0002',itemId:'unissued-piece',pointsPrice:10,paymentRaw:'10000000000000000'});
  assert.equal(unissued.isError,true);assert.match(unissued.content[0].text,/no issued NFTs/);assert.equal(bidRequests,1);
  const {AgentClient}=await import(pathToFileURL(join(directory,'client.mjs')).href);
  const sdk=new AgentClient({origin,signer,name:'portable-smoke'});
  assert.equal((await sdk.onboard()).address,signer.address);
  assert.equal((await sdk.request('GET','/v1/agents/me')).agent.points,0);
  const helper=promisify(execFile),helperPath=join(install,'node_modules','.bin','towa-wallet');
  const helperOptions={env:{...process.env,TOWER_URL:origin,TOWER_KEYSTORE:keystore,TOWER_PASSWORD_FILE:passwordFile,TOWER_NAME:'portable-smoke',TOWER_DID:'',TOWER_AGENT:''},timeout:20000};
  const optionsFile=join(temporary,'session-options.json'),configFile=join(temporary,'mcp.private.json');
  await writeFile(optionsFile,JSON.stringify({scopes:['read'],ttlSeconds:900}));
  const opened=await helper(helperPath,['session',optionsFile,configFile],helperOptions);
  const config=JSON.parse(await readFile(configFile,'utf8')),issued=JSON.parse(opened.stdout),header=config.mcpServers.towa.headers.Authorization;
  assert.equal(config.mcpServers.towa.url,origin+'/mcp');assert.equal((await stat(configFile)).mode&0o777,0o600);
  assert.equal(mcpSessions.authenticate(header,origin).address,signer.address);
  assert.ok(!opened.stdout.includes(header.slice(7))&&!opened.stderr.includes(header.slice(7)));
  const listed=await helper(helperPath,['sessions'],helperOptions);assert.equal(JSON.parse(listed.stdout).sessions[0].id,issued.session.id);
  await helper(helperPath,['revoke',issued.session.id],helperOptions);assert.throws(()=>mcpSessions.authenticate(header,origin),/revoked/);
  const challengeFile=join(temporary,'challenge.json'),signedFile=join(temporary,'enrollment.private.json');
  const message=`${new URL(GATEWAY).host} wants you to enroll a FLOP devnet gateway key with your account:\n${signer.address}\n\nAction: flop-devnet-enroll/v1\nGenesis: ${GENESIS}\nNonce: ${'a'.repeat(64)}\nIssued At: ${new Date().toISOString()}\nExpiration Time: ${new Date(Date.now()+120000).toISOString()}`;
  await writeFile(challengeFile,JSON.stringify({message}));await helper(helperPath,['sign-enrollment',challengeFile,signedFile],helperOptions);
  const signed=JSON.parse(await readFile(signedFile,'utf8'));assert.equal(signed.message,message);assert.ok(signatureVerify(message,signed.signature,signer.address).isValid);
  await assert.rejects(sdk.signOperation({status:'prepared',requestId:'wrong-intent'},{requestId:'saved-intent'}),/saved requestId/);
  await assert.rejects(sdk.signOperation({status:'prepared',requestId:'saved-intent',quote:{estimatedFeeRaw:'50000000000000001'}},{requestId:'saved-intent'}),/0.05 FLOP/);
  for(const secret of [password,wallet.encoded])assert.ok(!stdout.includes(secret)&&!stderr.includes(secret),'A wallet secret reached MCP output.');
  const archive=await readFile(new URL('../dist/downloads/towa-agent-'+manifest.version+'.tgz',import.meta.url));
  const report={at:new Date().toISOString(),version:manifest.version,sha256:createHash('sha256').update(archive).digest('hex'),installedPackage:true,encryptedKeystoreOnboarding:true,sdkVerified:true,walletHelper:true,privateRemoteConfiguration:true,sessionRevocation:true,localEnrollmentSignature:true,signerIntentAndFeeLimits:true,individualOfferSchema:true,collectionOfferRejected:true,signedRequests,fixtureOnly:true,liveTransactionsSubmitted:0};
  await writeFile(new URL('../outputs/package-smoke.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
}finally{
  if(child){const closed=new Promise(resolve=>child.once('exit',resolve));child.stdin.end();child.kill('SIGTERM');await Promise.race([closed,new Promise(resolve=>{const timer=setTimeout(resolve,3000);timer.unref();})]);}
  lines?.close();await new Promise(resolve=>server.close(resolve));store.close();await rm(temporary,{recursive:true,force:true});
}
