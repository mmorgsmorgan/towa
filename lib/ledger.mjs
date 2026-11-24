import { randomUUID } from 'node:crypto';
import { GENESIS, RESIDENTS } from './config.mjs';
import { canonicalAddress, sha256 } from './auth.mjs';
import { verifiedDid, walletDid } from './did.mjs';
import { creditPoints, REWARD_POLICY } from './rewards.mjs';
import { PAYMENT_TYPES, positivePrice } from './amounts.mjs';
import { expireBids, reserveBidPayment, releaseBidPayment, settleBidPayment, invalidateOtherBids } from './bids.mjs';
import { collectionQuote, purchaseQuote, directPurchaseQuote, pricingShare, checkPaymentLimit, ECONOMY } from './economics.mjs';
import { reservePoints as holdPoints, refundPoints } from './points.mjs';
import { assertFunding } from './funding.mjs';
import { integratedAt } from './presence.mjs';
export const MATERIALS={
  prism:{name:'Memory prism',cost:10,glyph:'◈',description:'A clear thought, given form.'},
  coil:{name:'Logic coil',cost:10,glyph:'⌘',description:'Connections made through useful work.'},
  ember:{name:'Compute ember',cost:10,glyph:'✧',description:'A spark from a completed inference.'},
};
export function agentFor(state,address){const a=state.agents.find(a=>a.address===address);if(!a)throw new Error('Register this agent with Tower first.');return a;}
export function registerAgent(state,address,name,{did,signatureType,now=new Date().toISOString()}={}){
  address=canonicalAddress(address);
  const identity=verifiedDid(did,address,signatureType);
  let agent=state.agents.find(a=>a.address===address);
  if(!agent){
    name??='agent-'+address.slice(-8).toLowerCase();
    if(typeof name!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9 _-]{1,31}$/.test(name))throw new Error('Use a 2–32 character agent name.');
    if(state.agents.some(a=>a.name.toLowerCase()===name.toLowerCase())||RESIDENTS.some(a=>a.name.toLowerCase()===name.toLowerCase()))throw new Error('That agent name is already taken.');
    if(state.agents.length>=1000)throw new Error('This devnet pilot has reached its account capacity.');
    agent={address,name,points:0,createdAt:now};state.agents.push(agent);
  }
  agent.did??=identity;agent.dids=[...new Set([...(agent.dids||[]),walletDid(address),identity])];
  if(!agent.onboardedAt){
    agent.onboardedAt=now;
    const network=state.network;
    agent.trackingFromBlock=network?.status==='connected'&&Date.parse(now)-Date.parse(network.checkedAt)<60000?network.finalizedBlock+1:null;
  }
  return agent;
}
function itemFor(state,address,id){const item=state.items.find(i=>i.id===id);if(!item||item.owner!==address||item.consumed||item.lockedBy||item.reservedBidId)throw new Error('This item is unavailable or belongs to another agent.');return item;}
function freeItem(state,address,id){const item=itemFor(state,address,id);if(item.listingId)throw new Error('Cancel the listing before using this item.');return item;}
function reservePoints(state,agent,amount,operation){
  holdPoints(state,agent.address,amount,operation);
}
export function prepareOperation(state,address,input,now=new Date().toISOString(),fundingProof){
  expireBids(state,now);
  const agent=agentFor(state,address);
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Expected an action object.');
  if(!/^[a-zA-Z0-9_-]{12,100}$/.test(input.requestId||''))throw new Error('Provide a unique requestId with 12–100 characters.');
  const requestHash=sha256(JSON.stringify(input));
  const existing=state.operations.find(o=>o.actor===address&&o.requestId===input.requestId);
  if(existing){if(existing.requestHash!==requestHash)throw new Error('This requestId belongs to a different action.');return existing;}
  if(state.operations.filter(o=>o.actor===address&&['prepared','submitted'].includes(o.status)).length>=5)throw new Error('Finish or cancel your pending actions first.');
  const op={id:randomUUID(),actor:address,type:input.type,requestId:input.requestId,requestHash,createdAt:now,preparationExpiresAt:new Date(Date.parse(now)+600000).toISOString(),status:'prepared',lockedItems:[],points:0};
  const action={type:input.type};
  const lock=item=>{item.lockedBy=op.id;op.lockedItems.push(item.id);return item;};
  switch(input.type){
    case 'mint-collection':{
      if(state.operations.some(o=>o.actor===address&&o.type==='mint-collection'&&['prepared','submitted'].includes(o.status)))throw new Error('Finish the pending collection before starting another.');
      const quote=collectionQuote(state,address);
      if(input.collectionNumber!==quote.collectionNumber||!Number.isSafeInteger(input.maxPoints)||input.maxPoints<quote.points||typeof input.maxPaymentRaw!=='string'||!/^\d{1,30}$/.test(input.maxPaymentRaw)||BigInt(input.maxPaymentRaw)<BigInt(quote.paymentRaw))throw new Error('Refresh the collection quote and supply its number, point limit, and FLOP limit.');
      const title=input.name?.trim()||`Traces ${quote.collectionNumber}`;
      if(typeof title!=='string'||title.length<1||title.length>64)throw new Error('Use a collection name of 1–64 characters.');
      reservePoints(state,agent,quote.points,op);
      Object.assign(action,{collectionId:randomUUID(),name:title,collectionNumber:quote.collectionNumber,size:100,pointsShareBps:pricingShare(input.pointsShareBps),burnPoints:quote.points,sourceDigest:sha256(JSON.stringify(op.pointSources)),paymentRaw:quote.paymentRaw,paymentLegs:quote.paymentLegs,economyVersion:ECONOMY.version});break;
    }
    case 'check-in':{
      if(agent.checkIn)throw new Error('This agent already has a finalized Tower check-in.');
      if(state.operations.some(o=>o.actor===address&&o.type==='check-in'&&['prepared','submitted'].includes(o.status)))throw new Error('This agent already has a check-in pending.');
      action.name=agent.name;break;
    }
    case 'send':{
      const recipient=canonicalAddress(input.recipient);agentFor(state,recipient);if(recipient===address)throw new Error('Choose a different recipient.');
      const amount=positivePrice(input.amountRaw);
      Object.assign(action,{recipient,priceRaw:amount,paymentRaw:amount,paymentLegs:[{recipient,amountRaw:amount,role:'recipient'}]});break;
    }
    case 'list':{
      const item=freeItem(state,address,input.itemId);if(!['piece','familiar'].includes(item.kind))throw new Error('Only finished pieces can be sold.');
      const collection=state.collections.find(c=>c.id===item.collectionId);if(!collection)throw new Error('This piece does not belong to a Towa collection.');
      const quote=purchaseQuote(input.pointsPrice,collection.pointsShareBps,address,item.creator);
      lock(item);Object.assign(action,{itemId:item.id,listingId:randomUUID(),priceRaw:quote.paymentRaw,pointsPrice:quote.points,pointsShareBps:quote.pointsShareBps});break;
    }
    case 'cancel':{
      const listing=state.listings.find(l=>l.id===input.listingId&&l.seller===address&&l.status==='open');if(!listing)throw new Error('This listing is unavailable.');
      lock(itemFor(state,address,listing.itemId));listing.status='reserved';listing.operationId=op.id;action.listingId=listing.id;break;
    }
    case 'buy':{
      const listing=state.listings.find(l=>l.id===input.listingId&&l.status==='open');if(!listing)throw new Error('This listing is no longer available.');
      if(listing.seller===address)throw new Error('An agent cannot buy its own familiar.');
      checkPaymentLimit(input.maxPaymentRaw,listing.priceRaw);
      const item=itemFor(state,listing.seller,listing.itemId),quote=purchaseQuote(listing.pointsPrice,listing.pointsShareBps,listing.seller,item.creator);
      if(input.seller!==listing.seller||input.creator!==item.creator)throw new Error('The seller or creator differs from the requested purchase.');
      if(!Number.isSafeInteger(input.maxPoints)||input.maxPoints<quote.points)throw new Error('The point burn exceeds your signed spending limit.');
      reservePoints(state,agent,quote.points,op);lock(item);listing.status='reserved';listing.operationId=op.id;
      Object.assign(action,{listingId:listing.id,itemId:listing.itemId,seller:listing.seller,creator:item.creator,priceRaw:listing.priceRaw,burnPoints:quote.points,...quote});break;
    }
    case 'settle-bid':{
      Object.assign(action,reserveBidPayment(state,address,input,op,now));
      const item=state.items.find(i=>i.id===action.itemId),quote=directPurchaseQuote(action.pointsPrice,action.priceRaw,action.seller,item.creator);
      if(input.creator!==item.creator||!Number.isSafeInteger(input.maxPoints)||input.maxPoints<quote.points)throw new Error('The creator or point burn differs from your signed spending limit.');
      if(op.points!==quote.points)throw new Error('The reserved offer points do not match the payment.');
      Object.assign(action,{creator:item.creator,burnPoints:quote.points,...quote});break;
    }
    case 'mint':case 'craft':case 'assemble':throw new Error('Create a collection with mint-collection. Every collection contains exactly 100 pieces.');
    case 'transfer':throw new Error('Use a listing or accepted offer to transfer ownership. Purchases require both earned points and FLOP, with creator and platform fees.');
    default:throw new Error('Unknown Tower action.');
  }
  op.action=action;
  if(PAYMENT_TYPES.includes(op.type))op.funding=assertFunding(state,address,action.paymentRaw,fundingProof,{excludeBidId:action.bidId});
  if(op.type==='send'){
    const spent=state.operations.filter(o=>o.actor===address&&o.type==='send'&&!['failed','cancelled'].includes(o.status)&&o.createdAt.slice(0,10)===now.slice(0,10)).reduce((sum,o)=>sum+BigInt(o.action.priceRaw),0n);
    if(spent+BigInt(action.priceRaw)>5000000000000000000n)throw new Error('This agent has reached Tower’s 5 devnet FLOP daily payment limit.');
  }
  op.remark=JSON.stringify({protocol:'chief-tower/v1',genesis:GENESIS,operationId:op.id,actor:address,action,createdAt:now});
  state.operations.push(op);return op;
}
export function releaseOperation(state,id,error,status='failed'){
  const op=state.operations.find(o=>o.id===id);if(!op||['confirmed','failed','cancelled'].includes(op.status))return op;
  if(status==='cancelled'&&op.status!=='prepared')throw new Error('A submitted transaction must resolve on-chain before cancellation.');
  refundPoints(state,op.actor,op);
  for(const item of state.items)if(item.lockedBy===op.id)delete item.lockedBy;
  for(const listing of state.listings)if(listing.operationId===op.id&&listing.status==='reserved'){listing.status='open';delete listing.operationId;}
  releaseBidPayment(state,op);
  op.status=status;op.error=error;op.completedAt=new Date().toISOString();return op;
}
export function commitOperation(state,id,proof){
  const op=state.operations.find(o=>o.id===id);if(!op)throw new Error('Unknown operation.');
  if(op.status==='confirmed'){if(op.proof.txHash!==proof.txHash)throw new Error('Conflicting settlement.');return op;}
  if(op.status!=='submitted'||proof.txHash!==op.txHash||proof.genesis!==GENESIS||!Number.isSafeInteger(proof.blockNumber)||proof.blockNumber<1||!/^0x[0-9a-f]{64}$/.test(proof.blockHash||''))throw new Error('A verified finalized transaction is required.');
  const {action,actor}=op,now=new Date().toISOString();
  const event={id:op.id,type:op.type,actor,at:now,proof};
  const mint=(kind,extras={})=>state.items.push({id:action.itemId,kind,owner:actor,creator:actor,createdAt:now,consumed:false,history:[event],...extras});
  switch(op.type){
    case 'mint-collection':{
      if(action.size!==100||state.collections.some(c=>c.id===action.collectionId))throw new Error('Invalid or duplicate collection.');
      const collection={id:action.collectionId,name:action.name,creator:actor,number:action.collectionNumber,size:100,pointsShareBps:action.pointsShareBps,pointsBurned:op.points,pointSources:op.pointSources,contributionRaw:action.paymentRaw,artSeed:sha256(op.id+action.sourceDigest).slice(0,32),artVersion:'towa-grid-v1',createdAt:now,proof};
      state.collections.push(collection);
      for(let edition=1;edition<=100;edition++)state.items.push({id:`${collection.id}-${edition}`,kind:'piece',collectionId:collection.id,edition,number:state.items.length+1,owner:actor,creator:actor,artSeed:collection.artSeed,artVersion:collection.artVersion,createdAt:now,consumed:false,ownershipRevision:0,history:[event]});
      break;
    }
    case 'check-in':agentFor(state,actor).checkIn=proof;break;
    case 'send':event.recipient=action.recipient;event.amountRaw=action.priceRaw;break;
    case 'list':{
      const item=state.items.find(i=>i.id===action.itemId);item.listingId=action.listingId;item.history.push(event);
      state.listings.push({id:action.listingId,itemId:action.itemId,seller:actor,creator:item.creator,priceRaw:action.priceRaw,pointsPrice:action.pointsPrice,pointsShareBps:action.pointsShareBps,status:'open',createdAt:now,proof});break;
    }
    case 'cancel':{
      const listing=state.listings.find(l=>l.id===action.listingId);listing.status='cancelled';delete listing.operationId;delete state.items.find(i=>i.id===listing.itemId).listingId;break;
    }
    case 'buy':{
      const listing=state.listings.find(l=>l.id===action.listingId),item=state.items.find(i=>i.id===action.itemId);
      if(listing.operationId!==op.id||item.lockedBy!==op.id||item.owner!==action.seller)throw new Error('Purchase reservation changed.');
      listing.status='sold';listing.buyer=actor;listing.payment=proof;listing.economy={pointsBurned:op.points,paymentRaw:action.paymentRaw,royaltyRaw:action.royaltyRaw,platformFeeRaw:action.platformFeeRaw,sellerNetRaw:action.sellerNetRaw};delete listing.operationId;
      item.owner=actor;item.ownershipRevision=(item.ownershipRevision||0)+1;delete item.listingId;item.history.push({...event,from:action.seller,priceRaw:action.priceRaw});invalidateOtherBids(state,item.id);break;
    }
    case 'settle-bid':settleBidPayment(state,op,proof,event);break;
  }
  for(const item of state.items)if(item.lockedBy===op.id)delete item.lockedBy;
  if(op.points)op.pointsStatus='burned';
  op.status='confirmed';op.proof=proof;op.completedAt=now;state.events.push(event);return op;
}
export function expirePreparations(state,now=Date.now()){
  for(const operation of state.operations)if(operation.status==='prepared'&&now>=Date.parse(operation.preparationExpiresAt||new Date(Date.parse(operation.createdAt)+600000).toISOString()))releaseOperation(state,operation.id,'Unsigned preparation expired.','cancelled');
  expireBids(state,new Date(now).toISOString());
}
export function awardSession(state,id,proof,now=new Date().toISOString()){
  const session=state.sessions.find(s=>s.id===id);if(!session)throw new Error('Unknown inference.');if(session.status==='verified')return session;
  if(!session.result||session.httpStatus!==200||proof.requestId!==session.id||proof.channelId!==session.receipt?.channel_id||proof.genesis!==GENESIS||!proof.txHash||!proof.blockHash||proof.blockNumber<1)throw new Error('Finalized inference evidence is required.');
  if(state.sessions.some(s=>s.id!==id&&s.proof?.requestId===proof.requestId))throw new Error('This request was already rewarded.');
  const channelAlreadyRewarded=state.activities?.some(a=>a.type==='compute-settled'&&a.channelId===proof.channelId&&a.points>0);
  const connected=integratedAt(agentFor(state,session.actor),session.createdAt);
  const reward=creditPoints(state,session.actor,{id:'inference:'+id,source:'inference',sourceId:id,points:channelAlreadyRewarded||!connected?0:10,at:now,proof,reason:!connected?'No signed Towa connection when the request started':channelAlreadyRewarded?'The direct compute channel was already rewarded':'Verified FLOP inference'});
  session.points=reward.points;session.status='verified';session.proof=proof;session.verifiedAt=now;
  state.events.push({id:randomUUID(),type:'inference-verified',actor:session.actor,sessionId:id,points:session.points,at:now,proof});return session;
}
export function publicState(state){
  const sessions=state.sessions.map(publicSession);
  const operations=state.operations.map(({rawExtrinsic,remark,requestHash,...op})=>op);
  const agents=state.agents.map(({operatorGroup,pointLots,integrationWindows,...agent})=>({...agent,nextCollection:collectionQuote(state,agent.address)}));
  const listings=state.listings.map(listing=>({...listing,quote:purchaseQuote(listing.pointsPrice,listing.pointsShareBps,listing.seller,listing.creator||state.items.find(i=>i.id===listing.itemId)?.creator)}));
  const bids=state.bids.map(({requestHash,pointSources,...bid})=>({...bid,quote:directPurchaseQuote(bid.pointsPrice,bid.priceRaw,bid.seller,bid.creator)}));
  return {...state,agents,sessions,operations,listings,bids,materials:MATERIALS,economy:ECONOMY,rewardPolicy:REWARD_POLICY,stats:{verified:sessions.filter(s=>s.status==='verified').length,activities:state.activities?.length||0,collections:state.collections.length,pending:sessions.filter(s=>['queued','running','awaiting_settlement','unresolved'].includes(s.status)).length,points:state.agents.reduce((n,a)=>n+a.points,0),items:state.items.filter(i=>!i.consumed).length,trades:state.listings.filter(l=>l.status==='sold').length+(state.bids?.filter(b=>b.status==='settled').length||0),tokens:sessions.reduce((n,s)=>n+(s.usage?.total_tokens||0),0)}};
}
export function publicSession(session){
  const {id,actor,model,status,usage,points,createdAt,completedAt,verifiedAt,proof,publish}=session;
  return {id,actor,model,status,usage,points,createdAt,completedAt,verifiedAt,proof,publish:!!publish,
    ...(session.error?{error:'The FLOP request did not complete. Its agent can inspect the details.'}:{}),
    ...(session.verificationNote?{verificationNote:'Settlement evidence is still being checked.'}:{}),
    ...(publish?{prompt:session.prompt,reply:session.result?.choices?.[0]?.message?.content??null}:{})};
}
