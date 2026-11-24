import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { FlopClient } from '@flop-labs/client';
import { loadResidentSigner } from '../lib/identities.mjs';
import { validateEnrollment } from '../lib/enrollment.mjs';
import { GATEWAY, MODEL } from '../lib/config.mjs';
const name = process.argv[2] || 'clone-01';
const signer = await loadResidentSigner(name);
const directory = new URL('../data/',import.meta.url);
await mkdir(directory,{recursive:true,mode:0o700});
const file = new URL(`${name}.gateway.json`,directory);
let credential;
try { credential=JSON.parse(await readFile(file,'utf8')); } catch(error) { if(error.code!=='ENOENT')throw error; }
if(!credential){
  const response=await fetch(`${GATEWAY}/v1/enroll/wallet/challenge?address=${signer.address}`,{signal:AbortSignal.timeout(25000)});
  const challenge=await response.json();
  if(!response.ok)throw Error(`Challenge ${response.status}: ${challenge.message||challenge.error}`);
  validateEnrollment(challenge.message,signer.address);
  const signature='0x'+Buffer.from(signer.sign(new TextEncoder().encode(challenge.message))).toString('hex');
  const enrolled=await fetch(GATEWAY+'/v1/enroll/wallet',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({address:signer.address,message:challenge.message,signature}),signal:AbortSignal.timeout(25000)});
  credential=await enrolled.json();
  if(!enrolled.ok)throw Error(`Enrollment ${enrolled.status}: ${credential.message||credential.error}`);
  await writeFile(file,JSON.stringify(credential),{mode:0o600});
  console.log(JSON.stringify({agent:name,address:signer.address,enrolled:true,model:credential.model,remaining:credential.remaining_quota,expiresAt:credential.expires_at}));
}
const requestId=`chief-tower-${name}-devnet-proof-v2-20261107`;
const resultFile = new URL(`${name}.inference.json`,directory);
const client=new FlopClient({apiKey:credential.key});
if(process.argv.includes('--inference')) {
  let prior;
  try {prior=JSON.parse(await readFile(resultFile,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
  if(!prior){
    const start=Date.now();
    const prompt='Give one practical step an agent can take to verify a technical guide is accurate. Answer in one sentence.';
    await writeFile(resultFile,JSON.stringify({requestId,agent:name,address:signer.address,prompt,startedAt:new Date().toISOString(),status:'submitted'}),{mode:0o600});
    try {
      const result=await client.createChatCompletion({model:credential.model||MODEL,messages:[{role:'user',content:prompt}],max_tokens:48,max_cost_flop:0.2,max_wait_ms:120000,stream:false},{idempotencyKey:requestId,correlationId:requestId,signal:AbortSignal.timeout(135000)});
      const record={requestId,agent:name,address:signer.address,prompt,receivedAt:new Date().toISOString(),latencyMs:Date.now()-start,status:'completed',result};
      await writeFile(resultFile,JSON.stringify(record,null,2),{mode:0o600});
      console.log(JSON.stringify(record));
    } catch(error) {
      const record={requestId,agent:name,address:signer.address,prompt,status:'unresolved',httpStatus:error.status,error:error.body||error.message};
      await writeFile(resultFile,JSON.stringify(record,null,2),{mode:0o600});
      console.log(JSON.stringify(record));
    }
  } else console.log(JSON.stringify({priorRequest:prior.requestId,status:prior.status,note:'No inference re-submitted.'}));
}
for(const route of ['/v1/keys/me','/v1/keys/me/receipts/'+encodeURIComponent(requestId)]){
  const response=await fetch(GATEWAY+route,{headers:{Authorization:`Bearer ${credential.key}`},signal:AbortSignal.timeout(25000)});
  const body=await response.json();
  console.log(JSON.stringify({route,status:response.status,body},(key,value)=>/key|secret/i.test(key)&&typeof value==='string'?'[redacted]':value));
  if(route.includes('/receipts/')&&response.ok)await writeFile(new URL(`${name}.gateway-receipt.json`,directory),JSON.stringify(body,null,2),{mode:0o600});
}
