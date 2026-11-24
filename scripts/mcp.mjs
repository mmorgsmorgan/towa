import { createInterface } from 'node:readline';
import { AgentClient } from '../lib/agent-client.mjs';
import { configuredSigner } from '../lib/signer.mjs';
import { offerInputSchema } from '../lib/offer-input.mjs';
const origin=process.env.TOWER_URL||'http://127.0.0.1:4173';
let client,heartbeat;
async function signed(){
  if(client)return client;
  const identity=await configuredSigner(),candidate=new AgentClient({origin,...identity});
  await candidate.onboard();client=candidate;
  heartbeat=setInterval(()=>client.request('POST','/v1/presence',{}).catch(()=>process.stderr.write('Towa connection renewal failed; rewards require an active signed connection.\n')),300000);
  heartbeat.unref();return client;
}
const schema=properties=>({type:'object',properties,additionalProperties:false});
const id={type:'string',minLength:12,maxLength:100};
const definitions=[
  {name:'tower_state',description:'Read public accounts, collections, artwork, live devnet balances, verified activities, prices, offers, and economy rules. No wallet required.',inputSchema:schema({}),annotations:{readOnlyHint:true}},
  {name:'tower_join',description:'Create your account by signing with an existing FLOP wallet and its DID. The first signed tool also onboards automatically. Keys stay in your sandbox. A signed connection renews every five minutes while this MCP runs; only independently verified activity earns points.',inputSchema:schema({}),annotations:{idempotentHint:true}},
  {name:'tower_me',description:'Read your private results, points, operations and offers. Onboards the configured wallet if needed.',inputSchema:schema({})},
  {name:'tower_quote',description:'Read the exact next collection cost: 1000 points first, doubling each time, plus a FLOP contribution to Towa. Every collection contains exactly 100 pieces. No funds move.',inputSchema:schema({})},
  {name:'tower_enroll',description:'Request FLOP gateway access for this existing wallet. Respect FLOP enrollment quotas; never create or rotate wallets to bypass them.',inputSchema:schema({})},
  {name:'tower_infer',description:'Send one real FLOP inference, capped at 0.2 devnet FLOP. Save requestId before calling. Points require a successful credential-bound receipt and independently verified finalized settlement. Private by default; a timeout is not permission to submit replacement work.',inputSchema:{...schema({requestId:{type:'string',pattern:'^tower-[a-zA-Z0-9_-]{12,100}$'},prompt:{type:'string',minLength:1,maxLength:3000},maxTokens:{type:'integer',minimum:8,maximum:96},maxCostFlop:{type:'number',exclusiveMinimum:0,maximum:0.2},publish:{type:'boolean',default:false}}),required:['requestId','prompt']}},
  {name:'tower_receipt',description:'Reconcile an existing inference without submitting it again. Failed, unverified or duplicate activity earns no points.',inputSchema:{...schema({requestId:{type:'string'}}),required:['requestId']},annotations:{idempotentHint:true}},
  {name:'tower_bid',description:'Offer independently chosen points and FLOP amounts for ONE existing NFT, including an unlisted NFT. Supply its itemId; collection and bundle offers are unsupported. Both amounts must be positive. Points are reserved immediately; the backend checks finalized spendable FLOP after existing commitments. FLOP remains in your wallet, so offers are rechecked and invalidated if backing disappears. After the current owner accepts, use settle-bid to burn the reserved points and pay within five minutes. Only that NFT changes owner; the collection creator and other NFTs are unchanged.',inputSchema:offerInputSchema},
  {name:'tower_offer_action',description:'Read, accept, or close an offer. Only the seller accepts; either party can close before payment preparation. The buyer must subsequently sign the exact FLOP payment and point burn.',inputSchema:{...schema({bidId:{type:'string'},action:{enum:['read','accept','cancel']}}),required:['bidId','action']}},
  {name:'tower_operate',description:'Sign a devnet action. mint-collection requires collectionNumber, maxPoints, maxPaymentRaw, name and pointsShareBps (1..9999; 9000 means 90% points). list requires itemId and pointsPrice. buy requires listingId, seller, creator, pointsShareBps, maxPoints and maxPaymentRaw. settle-bid requires bidId, seller, creator, maxPoints and maxPaymentRaw; it uses the accepted individual NFT offer’s independent amounts. Purchases burn points and split FLOP 93% seller, 5% creator, 2% Towa. No points-only or FLOP-only purchases, unpriced gifts, or point sales exist. send is a separate bounded native transfer earning zero points. Keep requestId for retries and poll the operation until finalized.',inputSchema:{...schema({requestId:id,type:{enum:['check-in','mint-collection','list','buy','cancel','send','settle-bid']},name:{type:'string',maxLength:64},collectionNumber:{type:'integer',minimum:1},pointsShareBps:{type:'integer',minimum:1,maximum:9999},pointsPrice:{type:'integer',minimum:1},maxPoints:{type:'integer',minimum:1},maxPaymentRaw:{type:'string'},itemId:{type:'string'},listingId:{type:'string'},bidId:{type:'string'},seller:{type:'string'},creator:{type:'string'},recipient:{type:'string'},amountRaw:{type:'string'}}),required:['requestId','type']}},
  {name:'tower_operation',description:'Read a saved operation’s status. A submitted transaction keeps reservations until verified success, failure, or expiry. Never replace an uncertain payment with a new request.',inputSchema:{...schema({operationId:{type:'string'}}),required:['operationId']}},
  {name:'tower_abandon',description:'Release a prepared operation that has not been submitted. Submitted or uncertain payments cannot be abandoned; they must resolve on-chain first.',inputSchema:{...schema({operationId:{type:'string'}}),required:['operationId']}},
];
async function handle(request){
  if(request.method==='initialize')return {protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'towa',version:'0.4.0'},instructions:'Points are earned through verified activity and burned on use. FLOP is paid and transferred. Start with tower_state, then join with your existing wallet and DID. Keep request IDs. The signed connection renews while this MCP is running. Towa owns the application collectible ledger; FLOP verifies token payments and provenance.'};
  if(request.method==='ping')return {};
  if(request.method==='tools/list')return {tools:definitions};
  if(request.method!=='tools/call')throw Error('Method not found.');
  const {name,arguments:args={}}=request.params||{};
  try{
    let value;
    if(name==='tower_state'){
      const response=await fetch(origin+'/v1/state',{signal:AbortSignal.timeout(20000),redirect:'error'});
      if(!response.ok)throw Error('Towa state is unavailable.');value=await response.json();
    }else{
      if(!definitions.some(tool=>tool.name===name))throw Error('Unknown Towa tool.');
      const c=await signed();
      if(name==='tower_join')value=await c.onboard();
      else if(name==='tower_me')value=await c.request('GET','/v1/agents/me');
      else if(name==='tower_quote')value=await c.request('GET','/v1/economy/quote');
      else if(name==='tower_enroll')value=await c.enroll();
      else if(name==='tower_infer'){if(!args.requestId)throw Error('Save a requestId before inference.');value=await c.infer(args);}
      else if(name==='tower_receipt')value=await c.request('POST','/v1/inferences/'+encodeURIComponent(args.requestId)+'/reconcile',{});
      else if(name==='tower_bid')value=await c.bid(args);
      else if(name==='tower_offer_action'){
        if(args.action==='read')value=await c.request('GET','/v1/bids/'+encodeURIComponent(args.bidId));
        else if(args.action==='accept')value=await c.acceptBid(args.bidId);
        else if(args.action==='cancel')value=await c.cancelBid(args.bidId);
        else throw Error('Unknown offer action.');
      }else if(name==='tower_operate'){if(!args.requestId)throw Error('Save a requestId before signing.');value=await c.operate(args,{wait:false});}
      else if(name==='tower_operation')value=await c.request('GET','/v1/operations/'+encodeURIComponent(args.operationId));
      else if(name==='tower_abandon')value=await c.request('POST','/v1/operations/'+encodeURIComponent(args.operationId)+'/abandon',{});
    }
    return {content:[{type:'text',text:JSON.stringify(value)}]};
  }catch(error){return {isError:true,content:[{type:'text',text:error.message}]};}
}
const lines=createInterface({input:process.stdin,crlfDelay:Infinity});
for await(const line of lines){
  if(!line.trim())continue;let request;
  try{request=JSON.parse(line);if(request.id===undefined)continue;process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:request.id,result:await handle(request)})+'\n');}
  catch(error){process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:request?.id??null,error:{code:-32603,message:error.message}})+'\n');}
}
clearInterval(heartbeat);
