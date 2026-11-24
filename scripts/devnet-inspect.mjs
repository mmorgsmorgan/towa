import { writeFile } from 'node:fs/promises';
import { Chain } from '../lib/chain.mjs';
import { RESIDENTS, GENESIS } from '../lib/config.mjs';
import { loadResidentSigner } from '../lib/identities.mjs';
import { keyDid } from '../lib/did.mjs';

// Direct, read-only FLOP inspection. No Towa MCP, signing, enrollment or payments.
const chain=new Chain(),timer=setTimeout(()=>{console.error('Direct devnet inspection timed out.');process.exit(1);},60000);
try {
  const signer=await loadResidentSigner('chief-node'),snapshot=await chain.snapshot(RESIDENTS.map(r=>r.address)),api=await chain.connect();
  const pallets=Object.keys(api.tx);
  const selected=pallets.filter(name=>/agent|compute|miner|model|storage|htlc|apprais|tee|session|staking/i.test(name));
  const capabilities=Object.fromEntries(selected.map(name=>[name,{
    calls:Object.entries(api.tx[name]).map(([call,tx])=>({call,args:tx.meta.args.toJSON(),docs:tx.meta.docs.map(v=>v.toString()).join(' ')})),
    storage:Object.entries(api.query[name]||{}).map(([key,query])=>({key,meta:query.meta.toJSON()})),
    constants:Object.fromEntries(Object.entries(api.consts[name]||{}).map(([key,value])=>[key,value.toJSON()])),
  }]));
  const rpcMethods=(await api.rpc.rpc.methods()).methods.map(v=>v.toString()).filter(name=>/flop|compute|agent|miner|model|htlc|tee|storage|apprais/i.test(name));
  const report={checkedAt:new Date().toISOString(),readOnly:true,identity:{name:'chief-node',address:signer.address,did:keyDid(signer.publicKey)},network:snapshot,pallets,rpcMethods,capabilities};
  await writeFile(new URL('../outputs/direct-devnet-capabilities.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({checkedAt:report.checkedAt,identity:report.identity,network:snapshot,pallets,rpcMethods,capabilities:Object.fromEntries(Object.entries(capabilities).map(([name,value])=>[name,{calls:value.calls,storage:value.storage.map(q=>({key:q.key,type:q.meta.type,docs:q.meta.docs})),constants:value.constants}]))},null,2));
} finally {clearTimeout(timer);await chain.close();}
