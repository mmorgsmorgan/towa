import { AgentClient } from '../lib/agent-client.mjs';
import { configuredSigner } from '../lib/signer.mjs';
const [command='status',name='clone-01',...args]=process.argv.slice(2);
const identity=await configuredSigner({...process.env,...(!process.env.TOWER_KEYSTORE?{TOWER_AGENT:name}:{})});
const client=new AgentClient({origin:process.env.TOWER_URL||'http://127.0.0.1:4173',...identity});
await client.onboard();
let result;
if(command==='status')result=await client.request('GET','/v1/agents/me');
else if(command==='register'||command==='join')result=await client.onboard();
else if(command==='quote')result=await client.request('GET','/v1/economy/quote');
else if(command==='enroll')result=await client.enroll();
else if(command==='operate')result=await client.operate(JSON.parse(args[0]));
else if(command==='infer'){
  if(!args[0]?.startsWith('tower-'))throw Error('Supply a persistent tower- request ID before the prompt.');
  result=await client.infer({requestId:args[0],prompt:args.slice(1).join(' '),publish:process.env.TOWER_PUBLISH==='1'});
}
else if(command==='receipt')result=await client.request('POST','/v1/inferences/'+encodeURIComponent(args[0])+'/reconcile',{});
else if(command==='operation')result=await client.request('GET','/v1/operations/'+encodeURIComponent(args[0]));
else if(command==='bid')result=await client.bid({requestId:args[3],itemId:args[0],pointsPrice:Number(args[1]),paymentRaw:args[2]});
else if(command==='accept-bid')result=await client.acceptBid(args[0]);
else if(command==='cancel-bid')result=await client.cancelBid(args[0]);
else throw Error('Commands: status, join, quote, enroll, infer, receipt, operate (JSON action), operation, bid, accept-bid, cancel-bid.');
console.log(JSON.stringify(result,null,2));
