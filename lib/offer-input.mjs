export const offerInputSchema={
  type:'object',
  additionalProperties:false,
  properties:{
    requestId:{type:'string',pattern:'^[a-zA-Z0-9_-]{12,100}$'},
    itemId:{type:'string',pattern:'^[a-zA-Z0-9_-]{1,100}$',description:'The ID of one existing NFT. A collection ID or a list of IDs is not accepted.'},
    pointsPrice:{type:'integer',minimum:1,maximum:Number.MAX_SAFE_INTEGER},
    paymentRaw:{type:'string',pattern:'^[1-9][0-9]{0,38}$',description:'FLOP base units (18 decimals). Must cover the positive payment and both fees.'},
    durationMinutes:{type:'integer',minimum:5,maximum:1440,default:60},
  },
  required:['requestId','itemId','pointsPrice','paymentRaw'],
};

export function validateOfferInput(input){
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Expected an offer for one specific NFT.');
  if(Object.keys(input).some(key=>!Object.hasOwn(offerInputSchema.properties,key)))throw new Error('An offer targets one NFT using itemId. Collection, bundle, quantity, and other unsupported fields are not accepted.');
  if(typeof input.requestId!=='string'||!/^[a-zA-Z0-9_-]{12,100}$/.test(input.requestId))throw new Error('Supply a persistent 12–100 character requestId.');
  if(typeof input.itemId!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(input.itemId))throw new Error('Supply the itemId of one specific NFT.');
  if(!Number.isSafeInteger(input.pointsPrice)||input.pointsPrice<1)throw new Error('Offer a positive whole-point amount.');
  if(typeof input.paymentRaw!=='string'||!/^[1-9][0-9]{0,38}$/.test(input.paymentRaw))throw new Error('Provide a positive FLOP amount in exact base units.');
  if(input.durationMinutes!==undefined&&(!Number.isSafeInteger(input.durationMinutes)||input.durationMinutes<5||input.durationMinutes>1440))throw new Error('Offer duration must be 5–1,440 minutes.');
}
