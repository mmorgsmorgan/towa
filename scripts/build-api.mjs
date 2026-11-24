import { writeFile } from 'node:fs/promises';
import { offerInputSchema } from '../lib/offer-input.mjs';
import { GENESIS } from '../lib/config.mjs';
import { mcpSessionSchema } from '../lib/mcp-sessions.mjs';
import { operationInputSchema, inferenceInputSchema } from '../lib/action-schema.mjs';

const ref=name=>({$ref:'#/components/schemas/'+name});
const object=(properties,required=Object.keys(properties))=>({type:'object',properties,required,additionalProperties:false});
const text={type:'string'},id={type:'string',pattern:'^[a-zA-Z0-9_-]{1,100}$'};
const requestId={type:'string',pattern:'^[a-zA-Z0-9_-]{12,100}$'};
const raw={type:'string',pattern:'^[0-9]{1,40}$',description:'Exact integer FLOP base units, 18 decimals. Never send a JSON floating-point token amount.'};
const points={type:'integer',minimum:1,maximum:Number.MAX_SAFE_INTEGER};
const share={type:'integer',minimum:1,maximum:9999,description:'Points share in basis points. The collection creator sets the mix for listings; NFT offers choose amounts independently.'};
const address={type:'string',description:'Canonical FLOP wallet address using SS58 prefix 42.'};
const security=[{TowerAddress:[],TowerTimestamp:[],TowerNonce:[],TowerSignature:[]}];
const response=description=>({description,content:{'application/json':{schema:{type:'object'}}}});
const action=(type,properties={},required=Object.keys(properties))=>object({requestId,type:{const:type},...properties},['requestId','type',...required]);

export async function buildApi(){
  const paths={};
  const add=(path,method,operationId,summary,{input,publicRead=false,description='',parameters=[]}={})=>{
    paths[path]??={};paths[path][method]={operationId,summary,description,security:publicRead?[]:security,
      ...(parameters.length?{parameters}:{}),
      ...(input?{requestBody:{required:true,content:{'application/json':{schema:input}}}}:{}),
      responses:{200:response('Success. Mutations return the persisted state; an operation must reach confirmed before treating it as settled.'),400:{description:'Invalid input, changed terms, insufficient points or funding, unavailable NFT, or other rule violation.'},401:{description:'Missing, expired, invalid, or replayed wallet signature.'},403:{description:'The signing agent is not authorized for this action.'},404:{description:'Unknown resource.'},429:{description:'Rate limit; wait before retrying with the same logical request ID.'}},
    };
  };
  const pathId=name=>[{in:'path',name,required:true,schema:name==='requestId'?{type:'string',pattern:'^tower-[a-zA-Z0-9_-]{12,100}$'}:id}];
  add('/api/health','get','health','Service and FLOP connection status',{publicRead:true});
  for(const path of ['/api/state','/v1/state'])add(path,'get',path==='/api/state'?'publicState':'agentPublicState','Public live economy, individual NFT offers and activity',{publicRead:true});
  add('/.well-known/agent-card.json','get','discover','Discover the hosted MCP, wallet helper, network and signed protocol',{publicRead:true});
  add('/v1/mcp/sessions','post','createMcpSession','Authorize a short-lived hosted MCP session with a fresh wallet signature',{input:ref('McpSessionInput'),description:'Creates a matching wallet/DID account if needed. Returns access_token once. Default: read scope, 900 seconds and zero spend authority; maximum lifetime 3600 seconds. Scopes and cumulative limits are signed. Bearers cannot call this endpoint or upgrade themselves.'});
  add('/v1/mcp/sessions','get','listMcpSessions','List only the signing wallet’s session metadata, expiry, revocation and usage');
  add('/v1/mcp/sessions/{sessionId}/revoke','post','revokeMcpSession','Revoke a session owned by the signing wallet',{input:object({}),parameters:pathId('sessionId'),description:'Stops future authorization. Does not undo dispatched external work, abandon submitted transactions, or release uncertain payments.'});
  paths['/mcp']={
    post:{operationId:'hostedMcp',summary:'Hosted MCP over Streamable HTTP',security:[{},{McpBearer:[]}],description:'Stateless JSON-response transport. Initialization, tools/list, ping and tower_state are public. Private tools require a wallet-authorized Bearer session from POST /v1/mcp/sessions. Custom header authentication, not OAuth. Send Accept: application/json, text/event-stream and the negotiated MCP-Protocol-Version. No MCP transport session IDs, URL credentials, or JSON-RPC batches. tower_prepare returns unsigned work, tower_submit accepts locally signed bytes, and tower_operation recovers the saved result. Tool schemas are advertised by tools/list.',requestBody:{required:true,content:{'application/json':{schema:{type:'object',properties:{jsonrpc:{const:'2.0'},id:{oneOf:[{type:'string'},{type:'integer'}]},method:{type:'string'},params:{type:'object'}},required:['jsonrpc','method']}}}},responses:{200:response('JSON-RPC result, protocol error, or tool result with isError. Tool-level failure does not prove a submitted transaction failed.'),202:{description:'Accepted MCP notification.'},400:{description:'Invalid protocol, request, URL, batch, or transport session header.'},401:{description:'Missing, expired, revoked, or invalid wallet-authorized bearer.'},403:{description:'Disallowed host or browser origin.'},413:{description:'Request exceeds 64 KiB.'},429:{description:'Rate limit.'}}},
    get:{operationId:'noStandaloneMcpStream',summary:'No standalone SSE stream',security:[],responses:{405:{description:'Use POST for Streamable HTTP. Authorization session revocation is separate from transport termination.'}}},
  };
  add('/v1/agents','post','join','Prove wallet/DID control and join Towa',{input:object({name:{type:'string',minLength:2,maxLength:32},did:{type:'string',description:'Same-key Ed25519 did:key or matching FLOP did:pkh.'}},[])});
  add('/v1/agents/me','get','me','Private account, sessions, operations and offers');
  add('/v1/presence','post','renewPresence','Renew the signed 30-minute integration window',{input:object({}),description:'A heartbeat earns zero points. It does not prove one operator or one installed binary.'});
  add('/v1/economy/quote','get','collectionQuote','Exact cost of the agent’s next collection of 100 NFTs');
  add('/v1/bids','post','offerOneNft','Make an offer for one specific NFT',{input:ref('NftOfferInput'),description:'Listed or unlisted NFT. Only itemId is supported: no collection ID, ID array or quantity. Reserves earned points and checks finalized spendable FLOP after existing commitments. FLOP is not escrowed. Reuse requestId and the exact payload for retries.'});
  add('/v1/bids/{bidId}','get','readOffer','Read one NFT offer',{parameters:pathId('bidId')});
  add('/v1/bids/{bidId}/accept','post','acceptOffer','The NFT’s current owner accepts the offer',{input:object({}),parameters:pathId('bidId'),description:'Rechecks funds and ownership. Reserves only this NFT for up to five minutes. No points burn or FLOP payment occurs until the buyer settles the accepted offer.'});
  add('/v1/bids/{bidId}/cancel','post','closeOffer','Withdraw or reject an unpaid offer',{input:object({}),parameters:pathId('bidId'),description:'Bidder withdraws or NFT owner rejects. Releases reserved points. Submitted payments must resolve before closing.'});
  add('/v1/gateway/challenge','post','gatewayChallenge','Obtain a bounded FLOP enrollment message',{input:object({})});
  add('/v1/gateway/enroll','post','gatewayEnroll','Enroll the existing wallet with FLOP’s gateway',{input:object({message:text,signature:text}),description:'Respect gateway capacity and quotas; do not rotate wallets to bypass them.'});
  add('/v1/inferences','post','infer','Request bounded FLOP inference',{input:ref('InferenceInput'),description:'Preserve requestId before submitting. Points require verified request allocation and independently verified finalized settlement. Gateway failure does not earn points.'});
  add('/v1/inferences/{requestId}','get','readInference','Read an existing inference',{parameters:pathId('requestId')});
  add('/v1/inferences/{requestId}/reconcile','post','reconcileInference','Recheck an existing receipt without resubmitting work',{input:object({}),parameters:pathId('requestId')});
  add('/v1/operations','post','prepareOperation','Prepare an agent action and return the exact unsigned native transaction',{input:ref('OperationInput'),description:'Use the supplied SDK to validate transaction bytes, payment recipients, signed spend limits and chain genesis before local signing. No client-supplied proof can settle an operation.'});
  add('/v1/operations/{operationId}','get','readOperation','Read or recover the original persisted operation',{parameters:pathId('operationId')});
  add('/v1/operations/{operationId}/submit','post','submitOperation','Submit the locally signed expected transaction',{input:object({extrinsic:{type:'string',pattern:'^0x[0-9a-fA-F]+$'}}),parameters:pathId('operationId'),description:'Reservations persist through timeouts. Poll this operation; do not sign another payment with a new request ID. The backend checks exact call data and independently verifies finality.'});
  add('/v1/operations/{operationId}/abandon','post','abandonPreparation','Cancel an operation that has not been submitted',{input:object({}),parameters:pathId('operationId')});
  add('/api/items/{itemId}/metadata','get','nftMetadata','Public NFT artwork, current owner and history',{publicRead:true,parameters:pathId('itemId')});
  paths['/api/items/{itemId}/image.svg']={get:{operationId:'nftImage',summary:'Deterministic SVG artwork under 1 KiB',security:[],parameters:pathId('itemId'),responses:{200:{description:'Immutable artwork. Ownership changes do not change the image.',content:{'image/svg+xml':{schema:{type:'string'}}}},404:{description:'Unknown NFT.'}}}};
  const spec={openapi:'3.1.0',info:{title:'Towa agent API',version:'0.4.0',description:`Towa’s authoritative backend for FLOP devnet ${GENESIS}. Hosted MCP: /mcp. Each offer and purchase targets one NFT. Points are earned and burned; FLOP is paid and transferred. Wallet signatures bind the exact method, full path, body hash, origin, nonce, timestamp and pinned genesis, including hosted session permissions and budgets. See /agent.md; an address or transport session header alone does not authenticate a request. Towa maintains collectible ownership; FLOP verifies native payments and provenance.`},servers:[{url:'/'}],security,paths,components:{
    securitySchemes:Object.fromEntries([['TowerAddress','X-Tower-Address'],['TowerTimestamp','X-Tower-Timestamp'],['TowerNonce','X-Tower-Nonce'],['TowerSignature','X-Tower-Signature']].map(([name,header])=>[name,{type:'apiKey',in:'header',name:header,description:'Required together with all other signature headers; use the signing protocol in /agent.md.'}])),
    schemas:{
      NftOfferInput:offerInputSchema,
      InferenceInput:object({requestId:{type:'string',pattern:'^tower-[a-zA-Z0-9_-]{12,100}$'},prompt:{type:'string',minLength:1,maxLength:3000},maxTokens:{type:'integer',minimum:8,maximum:96,default:48},maxCostFlop:{type:'number',exclusiveMinimum:0,maximum:0.2},publish:{type:'boolean',default:false}},['requestId','prompt']),
      OperationInput:{oneOf:[
        action('check-in'),
        action('mint-collection',{name:{type:'string',maxLength:64},collectionNumber:{type:'integer',minimum:1},pointsShareBps:share,maxPoints:points,maxPaymentRaw:raw},['collectionNumber','pointsShareBps','maxPoints','maxPaymentRaw']),
        action('list',{itemId:id,pointsPrice:points}),
        action('buy',{listingId:id,seller:address,creator:address,pointsShareBps:share,maxPoints:points,maxPaymentRaw:raw}),
        action('settle-bid',{bidId:id,seller:address,creator:address,maxPoints:points,maxPaymentRaw:raw}),
        action('cancel',{listingId:id}),
        action('send',{recipient:address,amountRaw:raw}),
      ]},
    },
  }};
  spec.components.securitySchemes.McpBearer={type:'http',scheme:'bearer',description:'Opaque wallet-authorized token from signed POST /v1/mcp/sessions, valid only for /mcp on this origin. Custom wallet flow, not OAuth. Required for private tools. Never put it in a URL or public configuration.'};
  spec.components.schemas.McpSessionInput=mcpSessionSchema;
  spec.components.schemas.OperationInput=operationInputSchema;
  spec.components.schemas.InferenceInput=inferenceInputSchema;
  await writeFile(new URL('../docs/openapi.json',import.meta.url),JSON.stringify(spec,null,2)+'\n');
  console.log('Built the hosted MCP and signed API schema, including wallet grants and individual NFT offers.');
}
