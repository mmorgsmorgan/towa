import test from 'node:test';
import assert from 'node:assert/strict';
import { Keyring } from '@polkadot/api';
import { cryptoWaitReady } from '@polkadot/util-crypto';
import { Store } from '../lib/store.mjs';
import { registerAgent } from '../lib/ledger.mjs';
import { keyDid, walletDid, verifiedDid } from '../lib/did.mjs';
import { renewIntegration, integratedAt } from '../lib/presence.mjs';
import { recordActivity } from '../lib/rewards.mjs';
import { ActivityIndexer, activitiesInBlock } from '../lib/activity.mjs';
import { GENESIS, RESIDENTS } from '../lib/config.mjs';
await cryptoWaitReady();
const pair=new Keyring({type:'ed25519',ss58Format:42}).addFromSeed(new Uint8Array(32).fill(13));
const alice=RESIDENTS[1].address,bob=RESIDENTS[2].address;
const at='2026-11-07T12:00:00.000Z';
function joined(){const s=new Store(':memory:');s.change(st=>{st.network={status:'connected',finalizedBlock:100,checkedAt:at};registerAgent(st,alice,undefined,{now:at});registerAgent(st,bob,undefined,{now:at});renewIntegration(st,alice,at);renewIntegration(st,bob,at);});return s;}
function activity(id,type='compute-settled',extra={}){return {id,actor:alice,type,success:true,at:'2026-11-07T12:01:00.000Z',channelId:id,amountRaw:'100',aggregateGn:'1',proof:{genesis:GENESIS,txHash:'0x'+'a'.repeat(64),blockHash:'0x'+'b'.repeat(64),blockNumber:101},...extra};}
test('a DID must be the actual signing wallet key; arbitrary claims and other curves fail',()=>{
  const did=keyDid(pair.publicKey);assert.equal(verifiedDid(did,pair.address,'ed25519'),did);
  assert.equal(verifiedDid(undefined,pair.address),walletDid(pair.address));
  assert.throws(()=>verifiedDid(did,alice,'ed25519'),/signed/);assert.throws(()=>verifiedDid(did,pair.address,'sr25519'),/signed/);
  assert.throws(()=>verifiedDid('did:web:someone.example',pair.address,'ed25519'));
  const s=new Store(':memory:');s.change(st=>registerAgent(st,pair.address,'outside-agent',{did,signatureType:'ed25519'}));
  s.change(st=>registerAgent(st,pair.address,'outside-agent',{did,signatureType:'ed25519'}));
  assert.equal(s.read().agents.filter(a=>a.address===pair.address).length,1);s.close();
});
test('signed connections are bounded and cannot retroactively qualify old activity',()=>{
  const s=joined(),agent=s.read().agents[1];
  assert.ok(integratedAt(agent,'2026-11-07T12:29:59.000Z'));assert.ok(!integratedAt(agent,'2026-11-07T12:31:00.000Z'));assert.ok(!integratedAt(agent,'2026-11-07T11:59:59.000Z'));
  const late=activity('late','compute-settled',{at:'2026-11-07T12:31:00.000Z'});s.change(st=>recordActivity(st,late));assert.equal(s.read().agents[1].points,0);s.close();
});
test('duplicate activity, duplicate channels, failed work, and wrong-genesis claims cannot multiply rewards',()=>{
  const s=joined();const one=activity('one');s.change(st=>recordActivity(st,one));s.change(st=>recordActivity(st,one));
  s.change(st=>recordActivity(st,activity('duplicate-channel','compute-settled',{channelId:'one'})));
  s.change(st=>recordActivity(st,activity('failed','compute-settled',{success:false})));
  assert.throws(()=>s.change(st=>recordActivity(st,{...activity('forged'),proof:{...one.proof,genesis:'fake'}})),/evidence/);
  assert.equal(s.read().agents[1].points,10);s.close();
});
test('real transfers, including same-operator and back-and-forth transfers, award zero points',()=>{
  const s=joined();for(let i=0;i<20;i++)s.change(st=>recordActivity(st,activity('transfer-'+i,'transfer',{actor:i%2?bob:alice,recipient:i%2?alice:bob,amountRaw:'1000000000000000000'})));
  assert.equal(s.read().activities.length,20);assert.equal(s.read().agents[1].points,0);assert.equal(s.read().agents[2].points,0);s.close();
});
test('daily verified activity caps apply without making old awards eligible again',()=>{
  const s=joined();for(let i=0;i<15;i++)s.change(st=>recordActivity(st,activity('compute-'+i)));
  assert.equal(s.read().agents[1].points,100);assert.equal(s.read().rewards.reduce((sum,r)=>sum+r.points,0),100);
  s.change(st=>recordActivity(st,activity('compute-0','compute-settled',{at:'2026-11-08T12:01:00.000Z'})));assert.equal(s.read().agents[1].points,100);s.close();
});
test('the activity cursor survives outages and does not skip unprocessed finalized blocks',async()=>{
  const s=joined();s.change(st=>{st.indexer={startBlock:101,nextBlock:101};});
  let fail=true;const inspected=[];
  const chain={finalized:async()=>({number:103}),inspectBlock:async height=>{inspected.push(height);if(height===102&&fail)throw Error('temporary outage');return {number:height,hash:'0x'+'b'.repeat(64),timestamp:Date.parse(at),block:{extrinsics:[]},events:[]};}};
  const indexer=new ActivityIndexer(s,chain);await assert.rejects(indexer.sync(),/outage/);assert.equal(s.read().indexer.nextBlock,101);
  fail=false;await indexer.sync();assert.equal(s.read().indexer.nextBlock,104);assert.equal(s.read().indexer.status,'synced');assert.ok(inspected.includes(101));s.close();
});
test('a successful outer call without compute evidence never becomes a compute reward',async()=>{
  const tx={isSigned:true,signer:{toString:()=>alice},hash:{toHex:()=> '0x'+'a'.repeat(64)},method:{section:'system',method:'remarkWithEvent',toHuman:()=>({})}};
  const page={hash:'0x'+'b'.repeat(64),number:101,timestamp:Date.parse(at),block:{extrinsics:[tx]},events:[{phase:{isApplyExtrinsic:true,asApplyExtrinsic:{toNumber:()=>0}},event:{section:'system',method:'ExtrinsicSuccess'}}]};
  const records=await activitiesInBlock(page,[{address:alice}],()=>{throw Error('unexpected channel query');});
  assert.equal(records.length,1);assert.equal(records[0].type,'chain-call');const s=joined();s.change(st=>recordActivity(st,records[0]));assert.equal(s.read().agents[1].points,0);s.close();
});
