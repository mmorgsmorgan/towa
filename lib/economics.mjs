import { RESIDENTS } from './config.mjs';

// Pricing weight, not a redemption promise. Points never leave their earner.
export const POINT_VALUE_RAW=1000000000000000n; // 0.001 devnet FLOP
export const TREASURY=RESIDENTS[0].address;
export const ECONOMY={
  version:'collections-v1',collectionSize:100,firstCollectionPoints:1000,costMultiplier:2,
  pointValueRaw:POINT_VALUE_RAW.toString(),pointsExpire:false,
  collection:{pointsPercent:90,flopPercent:10},purchase:{creatorChoosesMix:true,minPointsShareBps:1,maxPointsShareBps:9999,defaultPointsShareBps:1000},
  fees:{creatorBps:500,platformBps:200,sellerBps:9300,basis:'FLOP component only',treasury:TREASURY},
  pointsMustBeEarned:true,pointsAreBurned:true,pointsTransferable:false,
};
const ceilDiv=(a,b)=>(a+b-1n)/b;
export function collectionQuote(state,address){
  const created=state.collections.filter(c=>c.creator===address).length;
  const points=1000n*(2n**BigInt(created));
  if(points>BigInt(Number.MAX_SAFE_INTEGER))throw new Error('Collection point cost exceeds the supported integer range.');
  // The point leg is 90%, so the token leg is its value divided by nine.
  const paymentRaw=ceilDiv(points*POINT_VALUE_RAW,9n).toString();
  return {economyVersion:ECONOMY.version,collectionNumber:created+1,size:100,points:Number(points),paymentRaw,recipient:TREASURY,rounding:'FLOP contribution rounds up by less than one base unit',paymentLegs:[{recipient:TREASURY,amountRaw:paymentRaw,role:'collection contribution'}]};
}
export function pricingShare(value){
  if(!Number.isSafeInteger(value)||value<1||value>9999)throw new Error('Choose a points share from 0.01% to 99.99%. Both points and FLOP are required.');
  return value;
}
export function purchaseQuote(pointsPrice,pointsShareBps,seller,creator){
  if(!Number.isSafeInteger(pointsPrice)||pointsPrice<1)throw new Error('Set a positive whole-point price.');
  pricingShare(pointsShareBps);
  const pointValue=BigInt(pointsPrice)*POINT_VALUE_RAW;
  const flop=ceilDiv(pointValue*BigInt(10000-pointsShareBps),BigInt(pointsShareBps));
  return {...directPurchaseQuote(pointsPrice,flop.toString(),seller,creator),pointsShareBps};
}
export function directPurchaseQuote(pointsPrice,paymentRaw,seller,creator){
  if(!Number.isSafeInteger(pointsPrice)||pointsPrice<1)throw new Error('Offer a positive whole-point amount.');
  if(typeof paymentRaw!=='string'||!/^[1-9]\d{0,38}$/.test(paymentRaw)||BigInt(paymentRaw)<100n||BigInt(paymentRaw)>340282366920938463463374607431768211455n)throw new Error('Provide a positive FLOP amount in exact base units, sufficient for both fees.');
  const pointValue=BigInt(pointsPrice)*POINT_VALUE_RAW,flop=BigInt(paymentRaw);
  const royalty=flop*500n/10000n,fee=flop*200n/10000n,sellerNet=flop-royalty-fee;
  return {economyVersion:ECONOMY.version,totalReferenceRaw:(pointValue+flop).toString(),points:pointsPrice,paymentRaw:flop.toString(),royaltyRaw:royalty.toString(),platformFeeRaw:fee.toString(),sellerNetRaw:sellerNet.toString(),paymentLegs:[{recipient:seller,amountRaw:sellerNet.toString(),role:'seller'},{recipient:creator,amountRaw:royalty.toString(),role:'creator royalty'},{recipient:TREASURY,amountRaw:fee.toString(),role:'platform fee'}]};
}
export function checkPaymentLimit(maximum,amount){
  if(typeof maximum!=='string'||!/^\d{1,40}$/.test(maximum)||BigInt(maximum)<BigInt(amount))throw new Error('The FLOP payment exceeds your signed spending limit.');
}
export function combinedPayments(legs,payer){
  const totals=new Map();
  for(const {recipient,amountRaw} of legs)if(recipient!==payer)totals.set(recipient,(totals.get(recipient)||0n)+BigInt(amountRaw));
  return [...totals].filter(([,amount])=>amount>0n).map(([recipient,amount])=>({recipient,amountRaw:amount.toString()}));
}
