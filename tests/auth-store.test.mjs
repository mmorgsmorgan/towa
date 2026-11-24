import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Keyring } from '@polkadot/api';
import { cryptoWaitReady } from '@polkadot/util-crypto';
import { Store } from '../lib/store.mjs';
import { authenticate, requestMessage } from '../lib/auth.mjs';
import { Inference } from '../lib/inference.mjs';
await cryptoWaitReady();
const signer=new Keyring({type:'ed25519'}).addFromSeed(new Uint8Array(32).fill(7)),origin='https://tower.example';
function signed(body='{}',extra={}){const fields={origin,address:signer.address,timestamp:String(Date.now()),nonce:'test-nonce-01234567890',method:'POST',path:'/v1/operations',body,...extra};const signature='0x'+Buffer.from(signer.sign(new TextEncoder().encode(requestMessage(fields)))).toString('hex');return {method:fields.method,url:fields.path,headers:{'x-tower-address':fields.address,'x-tower-timestamp':fields.timestamp,'x-tower-nonce':fields.nonce,'x-tower-signature':signature}};}
test('signature is bound to exact request body, method, path and origin',()=>{for(const change of ['body','method','path','origin']){const s=new Store(':memory:'),req=signed();if(change==='method')req.method='GET';if(change==='path')req.url='/v1/gateway/enroll';assert.throws(()=>authenticate(req,change==='body'?'evil':'{}',s,change==='origin'?'https://evil.example':origin),/signature/);s.close();}});
test('replay and expired signatures are rejected',()=>{const s=new Store(':memory:'),req=signed();assert.equal(authenticate(req,'{}',s,origin),signer.address);assert.throws(()=>authenticate(req,'{}',s,origin),/already used/);assert.throws(()=>authenticate(signed('{}',{timestamp:String(Date.now()-301000)}),'{}',s,origin),/expired/);s.close();});
test('state, nonce protection and encrypted credentials survive a process restart',()=>{const file=join(mkdtempSync(join(tmpdir(),'tower-test-')),'tower.sqlite');let s=new Store(file);const req=signed();authenticate(req,'{}',s,origin);s.change(st=>{st.agents[0].points=37;});s.setCredential(signer.address,{key:'secret-gateway-fixture',expires_at:123});s.close();assert.ok(!readFileSync(file).includes(Buffer.from('secret-gateway-fixture')));s=new Store(file);assert.equal(s.read().agents[0].points,37);assert.equal(s.credential(signer.address).key,'secret-gateway-fixture');assert.throws(()=>authenticate(req,'{}',s,origin),/already used/);s.close();});
test('a server restart never automatically repeats an uncertain inference',()=>{const s=new Store(':memory:');s.change(st=>st.sessions.push({id:'uncertain',status:'running'}));const service=new Inference(s,{});service.recoverAfterRestart();assert.equal(s.read().sessions[0].status,'unresolved');assert.match(s.read().sessions[0].error,/no replacement inference/);s.close();});
