import { GENESIS } from './config.mjs';
import { PAYMENT_TYPES } from './amounts.mjs';
export const FEE_RESERVE_RAW=50000000000000000n;
export function committedFlop(state,address,{excludeBidId,excludeOperationId}={}){
  const offers=state.bids.filter(b=>b.buyer===address&&b.id!==excludeBidId&&['open','accepted','payment-pending'].includes(b.status));
  const operations=state.operations.filter(o=>o.actor===address&&o.id!==excludeOperationId&&PAYMENT_TYPES.includes(o.type)&&o.type!=='settle-bid'&&['prepared','submitted'].includes(o.status));
  return offers.reduce((sum,b)=>sum+BigInt(b.priceRaw)+FEE_RESERVE_RAW,0n)+operations.reduce((sum,o)=>sum+BigInt(o.action.paymentRaw||o.action.priceRaw)+FEE_RESERVE_RAW,0n);
}
export function assertFunding(state,address,amountRaw,proof,exclude={}){
  if(!proof||proof.genesis!==GENESIS||proof.address!==address||!Number.isSafeInteger(proof.blockNumber)||proof.blockNumber<1||!/^0x[0-9a-f]{64}$/.test(proof.blockHash||'')||!/^\d+$/.test(proof.usableRaw||'')||!Number.isFinite(Date.parse(proof.checkedAt))||Math.abs(Date.now()-Date.parse(proof.checkedAt))>60000)throw new Error('A fresh, backend-verified FLOP balance is required.');
  const settledHeight=Math.max(0,...state.operations.filter(o=>o.actor===address&&o.status==='confirmed'&&PAYMENT_TYPES.includes(o.type)).map(o=>o.proof.blockNumber));
  if(proof.blockNumber<settledHeight)throw new Error('Balance evidence predates the latest confirmed payment. Retry with a fresh balance.');
  if(BigInt(proof.usableRaw)<committedFlop(state,address,exclude)+BigInt(amountRaw)+FEE_RESERVE_RAW)throw new Error('Insufficient spendable FLOP after existing offers, payments, and the network fee reserve.');
  return {blockNumber:proof.blockNumber,blockHash:proof.blockHash,checkedAt:proof.checkedAt,escrowed:false};
}
