export const PAYMENT_TYPES=['buy','send','settle-bid','mint-collection'];
export function positivePrice(value){
  if(typeof value!=='string'||!/^[1-9]\d{0,18}$/.test(value)||BigInt(value)<1000000000000000n||BigInt(value)>1000000000000000000n)throw new Error('Price must be between 0.001 and 1 devnet FLOP, in exact integer base units.');
  return value;
}
