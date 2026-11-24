import { ApiPromise, WsProvider } from '@polkadot/api';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { GENESIS, RPC, GATEWAY, RESIDENTS } from '../lib/config.mjs';
if(process.argv.includes('--network')){
  const dns=await import('node:dns/promises');
  console.log(JSON.stringify({proxyVariables:Object.keys(process.env).filter(k=>/proxy/i.test(k)),nodeOptions:process.env.NODE_OPTIONS?'set':'unset'}));
  const checks=await Promise.allSettled([dns.lookup('api.flop.network',{all:true}),dns.resolve4('api.flop.network'),fetch(GATEWAY+'/v1/models',{signal:AbortSignal.timeout(20000)}).then(r=>({status:r.status}))]);
  checks.forEach((r,i)=>console.log(JSON.stringify({check:i,value:r.status==='fulfilled'?r.value:String(r.reason),cause:r.reason?.cause?.code})));
  process.exit(0);
}
const timeout = setTimeout(() => { console.error('Devnet diagnosis timed out'); process.exit(1); }, 90000);
const api = await ApiPromise.create({ provider: new WsProvider(RPC), noInitWarn: true });
try {
  if (api.genesisHash.toHex() !== GENESIS) throw new Error('Unexpected chain genesis');
  if(process.argv.includes('--capabilities')){
    const pallets=['agentIdentity','agentWallet','paidStorage','daRegistry','computeChannel','system','utility'];
    const selected=Object.fromEntries(pallets.map(pallet=>[pallet,Object.entries(api.tx[pallet]||{}).filter(([name])=>pallet!=='computeChannel'||/Forward|forward|SessionEvidence|forceOpen/.test(name)).map(([name,tx])=>({name,args:tx.meta.args.toJSON(),docs:tx.meta.docs.map(x=>x.toString()).join(' ')}))]));
    console.log(JSON.stringify({genesis:GENESIS,specVersion:api.runtimeVersion.specVersion.toString(),pallets:Object.keys(api.tx),selected},null,2));
    await writeFile(new URL('../outputs/runtime-capabilities.json',import.meta.url),JSON.stringify({genesis:GENESIS,specVersion:api.runtimeVersion.specVersion.toString(),pallets:Object.keys(api.tx),selected},null,2));
    await api.disconnect();clearTimeout(timeout);process.exit(0);
  }
  const hash = await api.rpc.chain.getFinalizedHead();
  const at = await api.at(hash);
  const header = await api.rpc.chain.getHeader(hash);
  const wallets = await Promise.all(RESIDENTS.map(async resident => {
    const account = await at.query.system.account(resident.address);
    return { ...resident, free: account.data.free.toString(), reserved: account.data.reserved.toString(), nonce: account.nonce.toString() };
  }));
  const palletNames = Object.keys(api.tx);
  const interesting = ['system','balances','utility','agentWallet','computeChannel','modelRegistry','minerRegistry'];
  const metadata = Object.fromEntries(interesting.filter(k=>api.tx[k]).map(k=>[k,{
    calls:Object.keys(api.tx[k]), storage:Object.keys(api.query[k]||{}),
  }]));
  const report = { checkedAt:new Date().toISOString(), genesis:GENESIS, specVersion:api.runtimeVersion.specVersion.toString(), decimals:api.registry.chainDecimals[0], token:api.registry.chainTokens[0], finalizedBlock:header.number.toString(), finalizedHash:hash.toHex(), existentialDeposit:api.consts.balances.existentialDeposit.toString(), wallets, pallets:palletNames, metadata };
  await mkdir(new URL('../outputs/', import.meta.url), { recursive:true });
  await writeFile(new URL('../outputs/devnet-status.json', import.meta.url), JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
  try {
    const credentials = JSON.parse(await readFile('/home/chief/technocore-agent/private/tower-gateway.json','utf8'));
    const response = await fetch(GATEWAY+'/v1/keys/me',{headers:{Authorization:`Bearer ${credentials.key}`},signal:AbortSignal.timeout(20000)});
    const body = await response.json();
    console.log(JSON.stringify({gatewayStatus:response.status, allowance:body},(k,v)=>/key|secret|token/i.test(k)&&typeof v==='string'?'[redacted]':v));
  } catch (error) { console.log(JSON.stringify({gatewayCheck:error.message})); }
} finally { await api.disconnect(); clearTimeout(timeout); }
