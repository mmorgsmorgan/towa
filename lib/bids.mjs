import { randomUUID } from 'node:crypto';
import { sha256 } from './auth.mjs';
import { directPurchaseQuote, checkPaymentLimit } from './economics.mjs';
import { reservePoints, refundPoints, movePoints } from './points.mjs';
import { assertFunding, committedFlop } from './funding.mjs';
import { validateOfferInput } from './offer-input.mjs';

export function bidFor(state,id){
  const bid=state.bids.find(b=>b.id===id);
  if(!bid)throw new Error('Offer not found.');
  return bid;
}
function releaseReservation(state,bid){
  refundPoints(state,bid.buyer,bid);
  const item=state.items.find(i=>i.id===bid.itemId);
  if(item?.reservedBidId===bid.id)delete item.reservedBidId;
  for(const listing of state.listings)if(listing.bidId===bid.id){delete listing.bidId;if(listing.status==='reserved')listing.status='open';}
}
export function expireBids(state,now=new Date().toISOString()){
  for(const bid of state.bids)if(['open','accepted'].includes(bid.status)&&Date.parse(bid.paymentDeadline||bid.expiresAt)<=Date.parse(now)){
    releaseReservation(state,bid);bid.status='expired';bid.completedAt=now;
  }
}
export function reconcileBidFunding(state,snapshot){
  for(const balance of snapshot.balances){
    const frozen=BigInt(balance.frozenRaw),ed=BigInt(snapshot.existentialDepositRaw||'0'),keep=frozen>ed?frozen:ed,free=BigInt(balance.freeRaw),available=free>keep?free-keep:0n;
    const offers=state.bids.filter(b=>b.buyer===balance.address&&['open','accepted'].includes(b.status)).sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt));
    for(const bid of offers){
      if(committedFlop(state,balance.address)<=available)break;
      releaseReservation(state,bid);bid.status='underfunded';bid.completedAt=snapshot.checkedAt;bid.reason='The wallet no longer covers its outstanding offers and fee reserves.';
    }
  }
}
export function createBid(state,address,input,now=new Date().toISOString(),fundingProof){
  validateOfferInput(input);
  expireBids(state,now);
  const requestHash=sha256(JSON.stringify(input));
  const existing=state.bids.find(b=>b.buyer===address&&b.requestId===input.requestId);
  if(existing){if(existing.requestHash!==requestHash)throw new Error('This requestId belongs to a different offer.');return existing;}
  const item=state.items.find(i=>i.id===input.itemId&&!i.consumed&&['piece','familiar'].includes(i.kind));
  if(!item||item.lockedBy||item.reservedBidId)throw new Error('This piece is unavailable for offers.');
  if(item.owner===address)throw new Error('An agent cannot bid on its own piece.');
  if(state.bids.filter(b=>b.buyer===address&&['open','accepted','payment-pending'].includes(b.status)).length>=20)throw new Error('Finish or withdraw existing offers first.');
  const minutes=input.durationMinutes??60;
  const collection=state.collections.find(c=>c.id===item.collectionId);
  if(!collection)throw new Error('This piece does not belong to a Towa collection.');
  const quote=directPurchaseQuote(input.pointsPrice,input.paymentRaw,item.owner,item.creator),priceRaw=quote.paymentRaw;
  if((state.agents.find(a=>a.address===address)?.points||0)<quote.points)throw new Error(`Earn at least ${quote.points} Towa Points before making this offer.`);
  const funding=assertFunding(state,address,priceRaw,fundingProof);
  const bid={id:randomUUID(),requestId:input.requestId,requestHash,itemId:item.id,seller:item.owner,creator:item.creator,buyer:address,ownershipRevision:item.ownershipRevision||0,priceRaw,pointsPrice:quote.points,funding,status:'open',createdAt:now,expiresAt:new Date(Date.parse(now)+minutes*60000).toISOString()};
  reservePoints(state,address,quote.points,bid);
  state.bids.push(bid);return bid;
}
export function acceptBid(state,address,id,now=new Date().toISOString(),fundingProof){
  expireBids(state,now);const bid=bidFor(state,id);
  if(bid.seller!==address)throw new Error('Only the seller can accept this offer.');
  if(['accepted','payment-pending','settled'].includes(bid.status))return bid;
  if(bid.status!=='open')throw new Error('This offer is no longer open.');
  bid.funding=assertFunding(state,bid.buyer,bid.priceRaw,fundingProof,{excludeBidId:bid.id});
  const item=state.items.find(i=>i.id===bid.itemId);
  if(!item||item.owner!==address||item.consumed||item.lockedBy||item.reservedBidId||(item.ownershipRevision||0)!==bid.ownershipRevision)throw new Error('The piece’s ownership or availability changed.');
  const listing=state.listings.find(l=>l.id===item.listingId);
  if(listing&&listing.status!=='open')throw new Error('The piece is already reserved for a purchase.');
  if(listing){listing.status='reserved';listing.bidId=bid.id;}
  item.reservedBidId=bid.id;bid.status='accepted';bid.acceptedAt=now;
  bid.paymentDeadline=new Date(Math.min(Date.parse(bid.expiresAt),Date.parse(now)+5*60000)).toISOString();
  return bid;
}
export function cancelBid(state,address,id,now=new Date().toISOString()){
  expireBids(state,now);const bid=bidFor(state,id);
  if(![bid.buyer,bid.seller].includes(address))throw new Error('Only a party to this offer can close it.');
  if(bid.status==='payment-pending')throw new Error('The payment operation must resolve before this offer can close.');
  if(!['open','accepted'].includes(bid.status))return bid;
  releaseReservation(state,bid);bid.status=address===bid.buyer?'withdrawn':'rejected';bid.completedAt=now;return bid;
}
export function reserveBidPayment(state,address,input,operation,now){
  expireBids(state,now);const bid=bidFor(state,input.bidId);
  if(bid.buyer!==address||bid.status!=='accepted')throw new Error('Only the buyer can pay an accepted, unexpired offer.');
  checkPaymentLimit(input.maxPaymentRaw,bid.priceRaw);
  if(input.seller!==bid.seller)throw new Error('The offer seller differs from your requested payment recipient.');
  const item=state.items.find(i=>i.id===bid.itemId);
  if(!item||item.owner!==bid.seller||item.reservedBidId!==bid.id||item.lockedBy||(item.ownershipRevision||0)!==bid.ownershipRevision)throw new Error('The accepted piece is no longer reserved for this buyer.');
  item.lockedBy=operation.id;operation.lockedItems.push(item.id);bid.status='payment-pending';bid.operationId=operation.id;
  movePoints(bid,operation);
  return {type:'settle-bid',bidId:bid.id,itemId:bid.itemId,seller:bid.seller,priceRaw:bid.priceRaw,pointsPrice:bid.pointsPrice};
}
export function releaseBidPayment(state,operation){
  const bid=state.bids.find(b=>b.operationId===operation.id&&b.status==='payment-pending');
  if(bid){releaseReservation(state,bid);bid.status='failed';bid.pointsStatus='refunded';bid.completedAt=new Date().toISOString();delete bid.operationId;}
}
export function invalidateOtherBids(state,itemId,exceptId){
  for(const bid of state.bids)if(bid.itemId===itemId&&bid.id!==exceptId&&['open','accepted'].includes(bid.status)){
    releaseReservation(state,bid);bid.status='invalidated';bid.completedAt=new Date().toISOString();
  }
}
export function settleBidPayment(state,operation,proof,event){
  const bid=bidFor(state,operation.action.bidId),item=state.items.find(i=>i.id===bid.itemId);
  if(bid.status!=='payment-pending'||bid.operationId!==operation.id||item.lockedBy!==operation.id||item.owner!==bid.seller)throw new Error('Offer payment reservation changed.');
  const listing=state.listings.find(l=>l.id===item.listingId);
  if(listing){listing.status='sold-by-bid';listing.buyer=bid.buyer;listing.payment=proof;delete listing.bidId;}
  bid.status='settled';bid.payment=proof;bid.completedAt=event.at;delete bid.operationId;
  bid.pointsStatus='burned';
  bid.economy={pointsBurned:operation.points,paymentRaw:operation.action.paymentRaw,royaltyRaw:operation.action.royaltyRaw,platformFeeRaw:operation.action.platformFeeRaw,sellerNetRaw:operation.action.sellerNetRaw};
  item.owner=bid.buyer;item.ownershipRevision=(item.ownershipRevision||0)+1;delete item.reservedBidId;delete item.listingId;
  item.history.push({...event,from:bid.seller,priceRaw:bid.priceRaw});
  invalidateOtherBids(state,item.id,bid.id);
}
