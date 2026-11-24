import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Store } from '../lib/store.mjs';
import { prepareOperation, releaseOperation, commitOperation, awardSession, publicState, registerAgent } from '../lib/ledger.mjs';
import { createBid as rawCreateBid, acceptBid as rawAcceptBid, cancelBid, expireBids, reconcileBidFunding } from '../lib/bids.mjs';
import { collectionQuote, purchaseQuote, combinedPayments, TREASURY } from '../lib/economics.mjs';
import { renewIntegration } from '../lib/presence.mjs';
import { sha256 } from '../lib/auth.mjs';
import { GENESIS, RESIDENTS, MODEL } from '../lib/config.mjs';
const alice=RESIDENTS[1].address,bob=RESIDENTS[2].address,charlie=RESIDENTS[3].address;
const proof=(id='fixture')=>({genesis:GENESIS,txHash:'0x'+sha256(id),blockHash:'0x'+'b'.repeat(64),blockNumber:123});
const open=()=>new Store(':memory:');
const funding=address=>({genesis:GENESIS,address,blockNumber:1000,blockHash:'0x'+'b'.repeat(64),usableRaw:'1000000000000000000000',checkedAt:new Date().toISOString()});
const createBid=(state,address,input,now)=>rawCreateBid(state,address,{paymentRaw:'100000000000000000',...input},now,funding(address));
const acceptBid=(state,address,id,now)=>rawAcceptBid(state,address,id,now,funding(state.bids.find(b=>b.id===id).buyer));
function prepare(store,actor,input){return store.change(s=>prepareOperation(s,actor,{requestId:randomUUID(),...input},new Date().toISOString(),funding(actor)));}
function finalize(store,op){const p=proof(op.id);store.change(s=>{const o=s.operations.find(o=>o.id===op.id);o.status='submitted';o.txHash=p.txHash;});return store.change(s=>commitOperation(s,op.id,p));}
function fixturePoints(store,actor=alice,points=1000){store.change(s=>{const a=s.agents.find(a=>a.address===actor);a.points=points;a.pointLots=[{sessionId:'isolated-test-fixture',total:points,available:points}];});}
function createCollection(store,{actor=alice,mix=9000}={}){
  const quote=collectionQuote(store.read(),actor);
  fixturePoints(store,actor,quote.points);
  const op=prepare(store,actor,{type:'mint-collection',name:'Test collection',pointsShareBps:mix,collectionNumber:quote.collectionNumber,maxPoints:quote.points,maxPaymentRaw:quote.paymentRaw});
  finalize(store,op);return store.read().collections.at(-1);
}
function listing(store,pointsPrice=900){
  createCollection(store);
  const item=store.read().items[0];
  finalize(store,prepare(store,alice,{type:'list',itemId:item.id,pointsPrice}));
  return store.read().listings[0];
}
function buyInput(l){return {type:'buy',listingId:l.id,maxPoints:l.pointsPrice,maxPaymentRaw:l.priceRaw,seller:l.seller,creator:l.creator,pointsShareBps:l.pointsShareBps};}
function bidInput(b){return {type:'settle-bid',bidId:b.id,maxPoints:b.pointsPrice,maxPaymentRaw:b.priceRaw,seller:b.seller,creator:b.creator,pointsShareBps:b.pointsShareBps};}

test('fresh ledger has no simulated points and no route to buy or transfer them',()=>{
  const s=open();assert.ok(s.read().agents.every(a=>a.points===0));
  for(const type of ['buy-points','transfer-points','redeem','mint','craft','assemble','transfer'])assert.throws(()=>prepare(s,alice,{type,points:1000,recipient:bob}));
  const q=collectionQuote(s.read(),alice);
  assert.throws(()=>prepare(s,alice,{type:'mint-collection',pointsShareBps:9000,collectionNumber:1,maxPoints:1000,maxPaymentRaw:q.paymentRaw}),/1000 verified points/);s.close();
});
test('collection quote keeps the 90/10 creation split and doubles separately per creator',()=>{
  const s=open();assert.equal(collectionQuote(s.read(),alice).points,1000);
  assert.equal(collectionQuote(s.read(),alice).paymentRaw,'111111111111111112');
  createCollection(s);assert.equal(collectionQuote(s.read(),alice).points,2000);
  assert.equal(collectionQuote(s.read(),bob).points,1000);
  createCollection(s);assert.equal(collectionQuote(s.read(),alice).points,4000);
  assert.equal(s.read().collections.length,2);assert.equal(s.read().items.length,200);s.close();
});
test('a collection creates exactly 100 pieces only after finality and burns its sources once',()=>{
  const s=open();fixturePoints(s);
  const q=collectionQuote(s.read(),alice),op=prepare(s,alice,{type:'mint-collection',pointsShareBps:1000,collectionNumber:1,maxPoints:1000,maxPaymentRaw:q.paymentRaw});
  assert.equal(s.read().items.length,0);assert.equal(s.read().agents[1].points,0);
  assert.throws(()=>s.change(st=>commitOperation(st,op.id,proof(op.id))),/finalized transaction/);
  finalize(s,op);s.change(st=>commitOperation(st,op.id,proof(op.id)));
  const state=s.read();assert.equal(state.items.length,100);assert.equal(new Set(state.items.map(i=>i.id)).size,100);
  assert.deepEqual(state.items.map(i=>i.edition),Array.from({length:100},(_,i)=>i+1));
  assert.equal(state.collections[0].pointsBurned,1000);assert.equal(state.collections[0].pointSources[0].points,1000);
  assert.equal(state.agents[1].pointLots[0].available,0);s.close();
});
test('collection preparation rejects concurrent generation and rolls back invalid mixes',()=>{
  const s=open();fixturePoints(s,alice,3000);const q=collectionQuote(s.read(),alice);
  const input={type:'mint-collection',pointsShareBps:9000,collectionNumber:1,maxPoints:1000,maxPaymentRaw:q.paymentRaw};
  const before=s.read();for(const mix of [0,10000,-1,1.1])assert.throws(()=>prepare(s,alice,{...input,pointsShareBps:mix}));
  assert.deepEqual(s.read(),before);const op=prepare(s,alice,input);
  assert.throws(()=>prepare(s,alice,input),/pending collection/);
  s.change(st=>releaseOperation(st,op.id,'cancel','cancelled'));s.change(st=>releaseOperation(st,op.id,'cancel','cancelled'));
  assert.equal(s.read().agents[1].points,3000);assert.equal(s.read().collections.length,0);s.close();
});
test('request ID reuse returns the original action and rejects a changed payload',()=>{
  const s=open();const input={type:'check-in',requestId:'repeated-request-0001'};
  const a=prepare(s,alice,input),b=prepare(s,alice,input);assert.equal(a.id,b.id);
  assert.throws(()=>prepare(s,alice,{...input,type:'send',recipient:bob,amountRaw:'1000000000000000'}),/different action/);s.close();
});
test('creator pricing permits both mixes, requires both assets, and computes exact example fees',()=>{
  const q=purchaseQuote(900,9000,alice,alice);
  assert.equal(q.paymentRaw,'100000000000000000');
  assert.equal(q.sellerNetRaw,'93000000000000000');assert.equal(q.royaltyRaw,'5000000000000000');assert.equal(q.platformFeeRaw,'2000000000000000');
  assert.deepEqual(combinedPayments(q.paymentLegs,bob),[{recipient:alice,amountRaw:'98000000000000000'},{recipient:TREASURY,amountRaw:'2000000000000000'}]);
  assert.equal(purchaseQuote(100,1000,alice,alice).paymentRaw,'900000000000000000');
  for(const [points,mix] of [[0,9000],[1,0],[1,10000],[-1,5000],[1.5,5000]])assert.throws(()=>purchaseQuote(points,mix,alice,alice));
});
test('a funded buyer without earned points cannot buy a piece or make an offer',()=>{
  const s=open(),l=listing(s);
  assert.throws(()=>prepare(s,bob,buyInput(l)),/900 verified points/);
  assert.throws(()=>s.change(st=>createBid(st,bob,{requestId:randomUUID(),itemId:l.itemId,pointsPrice:900})),/Earn at least/);
  assert.equal(s.read().listings[0].status,'open');s.close();
});
test('purchase reserves buyer points, prevents double sale, and finality transfers no points to seller',()=>{
  const s=open(),l=listing(s);fixturePoints(s,bob,900);fixturePoints(s,charlie,900);
  const op=prepare(s,bob,buyInput(l));
  assert.equal(s.read().agents[2].points,0);assert.equal(s.read().items[0].owner,alice);
  assert.throws(()=>prepare(s,charlie,buyInput(l)),/no longer available/);
  finalize(s,op);const state=s.read();
  assert.equal(state.items[0].owner,bob);assert.equal(state.agents[1].points,0);
  assert.equal(state.listings[0].economy.pointsBurned,900);assert.equal(state.listings[0].economy.royaltyRaw,'5000000000000000');
  s.change(st=>commitOperation(st,op.id,proof(op.id)));assert.equal(s.read().agents[2].points,0);s.close();
});
test('failed payment restores the exact buyer point lots and seller ownership',()=>{
  const s=open(),l=listing(s);fixturePoints(s,bob,900);const op=prepare(s,bob,buyInput(l));
  s.change(st=>{st.operations.find(o=>o.id===op.id).status='submitted';});
  assert.throws(()=>s.change(st=>releaseOperation(st,op.id,'cancel','cancelled')),/resolve on-chain/);
  s.change(st=>releaseOperation(st,op.id,'on-chain failure'));
  assert.equal(s.read().agents[2].points,900);assert.equal(s.read().agents[2].pointLots[0].available,900);
  assert.equal(s.read().items[0].owner,alice);assert.equal(s.read().listings[0].status,'open');s.close();
});
test('resales retain the original creator and collection mix',()=>{
  const s=open(),l=listing(s);fixturePoints(s,bob,900);finalize(s,prepare(s,bob,buyInput(l)));
  finalize(s,prepare(s,bob,{type:'list',itemId:l.itemId,pointsPrice:1800}));
  const resale=s.read().listings.at(-1);assert.equal(resale.creator,alice);assert.equal(resale.seller,bob);assert.equal(resale.pointsShareBps,9000);
  fixturePoints(s,charlie,1800);const op=prepare(s,charlie,buyInput(resale));
  assert.equal(op.action.paymentLegs[1].recipient,alice);assert.equal(op.action.royaltyRaw,'10000000000000000');
  finalize(s,op);assert.equal(s.read().items[0].owner,charlie);assert.equal(s.read().agents[2].points,0);s.close();
});
test('signed point, FLOP, creator and seller limits cannot be silently changed',()=>{
  const s=open(),l=listing(s);fixturePoints(s,bob,900);
  for(const patch of [{maxPoints:899},{maxPaymentRaw:'1'},{seller:charlie},{creator:charlie}])assert.throws(()=>prepare(s,bob,{...buyInput(l),...patch}));
  assert.equal(s.read().agents[2].points,900);assert.equal(s.read().listings[0].status,'open');s.close();
});
test('offers require seller acceptance, then only the buyer can pay with both assets',()=>{
  const s=open();createCollection(s);fixturePoints(s,bob,900);fixturePoints(s,charlie,900);
  const bid=s.change(st=>createBid(st,bob,{requestId:randomUUID(),itemId:st.items[0].id,pointsPrice:900}));
  assert.throws(()=>prepare(s,bob,bidInput(bid)),/accepted/);
  assert.throws(()=>s.change(st=>acceptBid(st,charlie,bid.id)),/Only the seller/);
  s.change(st=>acceptBid(st,alice,bid.id));
  assert.throws(()=>prepare(s,alice,{type:'list',itemId:bid.itemId,pointsPrice:900}),/unavailable/);
  assert.throws(()=>prepare(s,charlie,bidInput(bid)),/Only the buyer/);
  const op=prepare(s,bob,bidInput(bid));assert.throws(()=>s.change(st=>cancelBid(st,alice,bid.id)),/resolve/);
  s.change(st=>expireBids(st,new Date(Date.now()+86400000).toISOString()));
  assert.equal(s.read().bids[0].status,'payment-pending');
  finalize(s,op);assert.equal(s.read().items[0].owner,bob);assert.equal(s.read().bids[0].status,'settled');assert.equal(s.read().agents[2].points,0);s.close();
});
test('offer expiry releases an unpaid piece, and buying invalidates competing offers',()=>{
  const s=open();createCollection(s);fixturePoints(s,bob,900);fixturePoints(s,charlie,900);
  const make=buyer=>s.change(st=>createBid(st,buyer,{requestId:randomUUID(),itemId:st.items[0].id,pointsPrice:900}));
  const one=make(bob),two=make(charlie);
  s.change(st=>acceptBid(st,alice,one.id));s.change(st=>expireBids(st,new Date(Date.now()+360000).toISOString()));
  assert.equal(s.read().bids[0].status,'expired');assert.ok(!s.read().items[0].reservedBidId);
  s.change(st=>acceptBid(st,alice,two.id));finalize(s,prepare(s,charlie,bidInput(two)));assert.equal(s.read().items[0].owner,charlie);s.close();
});
test('inference rewards need a successful bound settlement and a signed connection when work started',()=>{
  const s=open(),id='tower-fixture-inference-0001',channel='0x'+'c'.repeat(64);
  s.change(st=>{registerAgent(st,alice);renewIntegration(st,alice,'2026-11-07T12:00:00.000Z');st.sessions.push({id,actor:alice,createdAt:'2026-11-07T12:01:00.000Z',model:MODEL,status:'awaiting_settlement',httpStatus:200,result:{choices:[{message:{content:'Test fixture'}}]},receipt:{channel_id:channel},points:0});});
  assert.throws(()=>s.change(st=>awardSession(st,id,{...proof(),requestId:id,channelId:'wrong'})));
  assert.throws(()=>s.change(st=>awardSession(st,id,{...proof(),genesis:'wrong',requestId:id,channelId:channel})));
  s.change(st=>awardSession(st,id,{...proof(),requestId:id,channelId:channel}));s.change(st=>awardSession(st,id,{...proof(),requestId:id,channelId:channel}));
  assert.equal(s.read().agents[1].points,10);s.close();
});
test('public analytics omit private prompts, results, integration windows, and signed transaction bytes',()=>{
  const s=open();s.change(st=>{st.sessions.push({id:'private',actor:alice,prompt:'private prompt',result:{choices:[{message:{content:'private result'}}]},publish:false});st.operations.push({id:'op',rawExtrinsic:'private bytes',remark:'record',requestHash:'hash'});st.agents[1].integrationWindows=[{from:'private integration timestamp',until:'later'}];});
  const serialized=JSON.stringify(publicState(s.read()));
  for(const text of ['private prompt','private result','private bytes','private integration timestamp'])assert.ok(!serialized.includes(text));s.close();
});
test('an offer reserves points immediately and rejects fake or insufficient FLOP backing',()=>{
  const s=open();createCollection(s);fixturePoints(s,bob,900);
  const input={requestId:randomUUID(),itemId:s.read().items[0].id,pointsPrice:900,paymentRaw:'100000000000000000'};
  assert.throws(()=>s.change(st=>rawCreateBid(st,bob,input)),/balance is required/);
  assert.throws(()=>s.change(st=>rawCreateBid(st,bob,input,undefined,{...funding(bob),usableRaw:'1'})),/Insufficient spendable/);
  assert.equal(s.read().agents[2].points,900);
  const bid=s.change(st=>createBid(st,bob,input));assert.equal(s.read().agents[2].points,0);
  assert.throws(()=>s.change(st=>createBid(st,bob,{...input,requestId:randomUUID(),itemId:st.items[1].id})),/Earn at least/);
  s.change(st=>cancelBid(st,bob,bid.id));s.change(st=>cancelBid(st,bob,bid.id));assert.equal(s.read().agents[2].points,900);s.close();
});
test('offers may propose independent positive point and FLOP amounts; neither leg may be zero',()=>{
  const s=open();createCollection(s);fixturePoints(s,bob,100);
  for(const fields of [{pointsPrice:0,paymentRaw:'1000'},{pointsPrice:10,paymentRaw:'0'}])assert.throws(()=>s.change(st=>createBid(st,bob,{requestId:randomUUID(),itemId:st.items[0].id,...fields})));
  const bid=s.change(st=>createBid(st,bob,{requestId:randomUUID(),itemId:st.items[0].id,pointsPrice:10,paymentRaw:'10000000000000000'}));
  assert.equal(bid.pointsPrice,10);assert.equal(bid.priceRaw,'10000000000000000');s.change(st=>acceptBid(st,alice,bid.id));
  const op=prepare(s,bob,bidInput(bid));assert.equal(op.points,10);assert.equal(op.action.platformFeeRaw,'200000000000000');finalize(s,op);assert.equal(s.read().agents[2].points,90);s.close();
});
test('the same FLOP cannot back multiple offers, and outside spending invalidates unfunded offers',()=>{
  const s=open();createCollection(s);fixturePoints(s,bob,1800);
  const input={requestId:randomUUID(),itemId:s.read().items[0].id,pointsPrice:900,paymentRaw:'100000000000000000'};
  const balance={...funding(bob),usableRaw:'150000000000000000'};
  const bid=s.change(st=>rawCreateBid(st,bob,input,undefined,balance));
  assert.throws(()=>s.change(st=>rawCreateBid(st,bob,{...input,requestId:randomUUID(),itemId:st.items[1].id},undefined,balance)),/Insufficient spendable/);
  assert.throws(()=>s.change(st=>rawAcceptBid(st,alice,bid.id,undefined,{...balance,usableRaw:'1'})),/Insufficient spendable/);
  s.change(st=>reconcileBidFunding(st,{balances:[{address:bob,freeRaw:'0',frozenRaw:'0'}],checkedAt:new Date().toISOString()}));
  assert.equal(s.read().bids[0].status,'underfunded');assert.equal(s.read().agents[2].points,1800);s.close();
});

test('collection and bundle bids are rejected without reserving points or NFTs',()=>{
  const s=open();createCollection(s);fixturePoints(s,bob,1800);
  const state=s.read(),input={requestId:randomUUID(),itemId:state.items[0].id,pointsPrice:900,paymentRaw:'100000000000000000'};
  for(const patch of [
    {itemId:undefined,collectionId:state.collections[0].id},
    {itemId:state.collections[0].id},
    {itemId:[state.items[0].id,state.items[1].id]},
    {itemIds:[state.items[0].id,state.items[1].id]},
    {collectionId:state.collections[0].id},
    {quantity:100},
  ])assert.throws(()=>s.change(st=>createBid(st,bob,{...input,...patch})),/one NFT|one specific NFT|unavailable/);
  assert.deepEqual(s.read(),state);s.close();
});

test('settling one NFT offer leaves the other 99 pieces and their offers independently tradable',()=>{
  const s=open();createCollection(s);fixturePoints(s,bob,900);fixturePoints(s,charlie,1800);
  const before=s.read(),itemId=before.items[41].id,siblingId=before.items[42].id;
  const offer=(buyer,id)=>s.change(st=>createBid(st,buyer,{requestId:randomUUID(),itemId:id,pointsPrice:900}));
  const winner=offer(bob,itemId),competing=offer(charlie,itemId),sibling=offer(charlie,siblingId);
  s.change(st=>acceptBid(st,alice,winner.id));
  assert.equal(s.read().items.filter(i=>i.reservedBidId).length,1);
  const op=prepare(s,bob,bidInput(winner));assert.deepEqual(op.lockedItems,[itemId]);
  finalize(s,op);
  const state=s.read();
  assert.equal(state.items.find(i=>i.id===itemId).owner,bob);
  assert.deepEqual(state.items.filter(i=>i.id!==itemId),before.items.filter(i=>i.id!==itemId));
  assert.deepEqual(state.collections,before.collections);
  assert.equal(state.bids.find(b=>b.id===competing.id).status,'invalidated');
  assert.equal(state.bids.find(b=>b.id===sibling.id).status,'open');
  assert.equal(state.agents.find(a=>a.address===charlie).points,900);
  assert.equal(state.agents.find(a=>a.address===bob).points,0);
  s.change(st=>acceptBid(st,alice,sibling.id));
  finalize(s,prepare(s,charlie,bidInput(sibling)));
  finalize(s,prepare(s,bob,{type:'list',itemId,pointsPrice:900}));
  assert.equal(s.read().items.find(i=>i.id===siblingId).owner,charlie);
  assert.equal(s.read().listings.at(-1).creator,alice);
  assert.equal(s.read().listings.at(-1).seller,bob);s.close();
});
