import { stringToHex } from '@polkadot/util';
import { GENESIS } from './config.mjs';
import { PAYMENT_TYPES } from './amounts.mjs';
import { directPurchaseQuote, combinedPayments, checkPaymentLimit, ECONOMY, TREASURY, POINT_VALUE_RAW } from './economics.mjs';
export function checkedTransaction(api,operation,input,address){
  if(operation.actor!==address||operation.type!==input.type||operation.requestId!==input.requestId||operation.quote?.genesis!==GENESIS||api.genesisHash.toHex()!==GENESIS)throw new Error('The prepared action does not match this agent, saved request, and network.');
  const action=operation.action;
  for(const field of ['itemId','listingId','bidId','recipient','seller','creator','pointsPrice','pointsShareBps','collectionNumber'])if(input[field]!==undefined&&action[field]!==input[field])throw new Error(`The prepared ${field} differs from the requested action.`);
  if(input.type==='send'&&action.paymentRaw!==input.amountRaw)throw new Error('The transfer amount changed.');
  if(input.type==='mint-collection'){
    if(!Number.isSafeInteger(input.collectionNumber)||input.collectionNumber<1||input.collectionNumber>44)throw new Error('Invalid collection number.');
    const points=1000n*(2n**BigInt(input.collectionNumber-1)),payment=(points*POINT_VALUE_RAW+8n)/9n;
    if(action.size!==100||action.burnPoints!==Number(points)||operation.points!==Number(points)||!Number.isSafeInteger(input.maxPoints)||input.maxPoints<Number(points)||action.paymentRaw!==payment.toString()||JSON.stringify(action.paymentLegs)!==JSON.stringify([{recipient:TREASURY,amountRaw:payment.toString(),role:'collection contribution'}]))throw new Error('The collection burn or platform contribution differs from the requested rule.');
    checkPaymentLimit(input.maxPaymentRaw,action.paymentRaw);
  }
  if(['buy','settle-bid'].includes(input.type)){
    if(!input.seller||!input.creator||!Number.isSafeInteger(input.maxPoints))throw new Error('Supply the seller, original creator, and point limit.');
    const quote=directPurchaseQuote(action.points,action.paymentRaw,input.seller,input.creator);
    if(action.burnPoints!==quote.points||operation.points!==quote.points||quote.points>input.maxPoints||action.paymentRaw!==quote.paymentRaw||JSON.stringify(action.paymentLegs)!==JSON.stringify(quote.paymentLegs))throw new Error('The points, seller payment, or fee split changed.');
    checkPaymentLimit(input.maxPaymentRaw,quote.paymentRaw);
  }
  if(['buy','settle-bid','mint-collection'].includes(input.type)&&action.economyVersion!==ECONOMY.version)throw new Error('The economy version changed. Refresh and review its rules.');
  const commitment=JSON.parse(operation.remark);
  if(commitment.protocol!=='chief-tower/v1'||commitment.genesis!==GENESIS||commitment.actor!==address||commitment.operationId!==operation.id||JSON.stringify(commitment.action)!==JSON.stringify(action))throw new Error('The provenance commitment does not match the prepared action.');
  const anchor=api.tx.system.remarkWithEvent(stringToHex(operation.remark));
  let expected=anchor;
  if(PAYMENT_TYPES.includes(input.type)){
    if(input.type==='send'&&JSON.stringify(action.paymentLegs)!==JSON.stringify([{recipient:input.recipient,amountRaw:input.amountRaw,role:'recipient'}]))throw new Error('The token recipient changed.');
    expected=api.tx.utility.batchAll([...combinedPayments(action.paymentLegs,address).map(leg=>api.tx.balances.transferKeepAlive(leg.recipient,leg.amountRaw)),anchor]);
  }
  const proposed=api.tx(operation.quote.unsignedExtrinsic);
  if(proposed.isSigned||proposed.method.toHex()!==expected.method.toHex()||operation.quote.callData!==expected.method.toHex())throw new Error('Refusing an unexpected transaction from Tower.');
  return expected;
}
