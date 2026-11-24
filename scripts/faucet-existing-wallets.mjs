import { readFile, writeFile, rename } from 'node:fs/promises';
import { Chain } from '../lib/chain.mjs';
import { GENESIS, RESIDENTS } from '../lib/config.mjs';

// Claims only for the six existing wallets. No signing keys, new identities,
// sponsorship, human-proof grants, or automatic re-submission of uncertain claims.
const day=new Date().toISOString().slice(0,10);
const file=new URL(`../data/faucet-claims-${day}.json`,import.meta.url);
const output=new URL(`../outputs/faucet-claims-${day}.json`,import.meta.url);
let report;
try{report=JSON.parse(await readFile(file,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
report??={day,genesis:GENESIS,createdAt:new Date().toISOString(),wallets:RESIDENTS.map(r=>({...r,status:'planned'}))};
if(report.genesis!==GENESIS||report.wallets.length!==RESIDENTS.length||report.wallets.some((r,i)=>r.address!==RESIDENTS[i].address))throw new Error('Saved faucet run has different wallets or network.');
async function save(){const temp=new URL(`../data/faucet-claims-${day}.tmp`,import.meta.url);await writeFile(temp,JSON.stringify(report,null,2)+'\n',{mode:0o600});await rename(temp,file);}
async function get(url,options={}){
  const response=await fetch(url,{...options,redirect:'error',signal:AbortSignal.timeout(options.method==='POST'?45000:20000)});
  const raw=await response.text();let body;try{body=JSON.parse(raw);}catch{body={error:raw.slice(0,500)};}
  return {status:response.status,retryAfter:response.headers.get('retry-after'),body};
}
const chain=new Chain();
try{
  const [network,rpc,health]=await Promise.all([
    get('https://faucet.flop.network/chain'),
    get('https://rpc.devnet.flop.network',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'chain_getBlockHash',params:[0]})}),
    get('https://faucet.flop.network/health'),
  ]);
  if(network.status!==200||rpc.status!==200||network.body.genesisHash!==GENESIS||rpc.body.result!==GENESIS||network.body.decimals!==18)throw new Error('Cannot confirm the faucet and RPC are the pinned FLOP devnet.');
  report.checkedAt=new Date().toISOString();report.faucetNetwork=network.body;report.faucetHealth=health.body;await save();
  try{const snapshot=await chain.snapshot(RESIDENTS.map(r=>r.address));if(!report.before)report.before=snapshot;}catch(error){report.balanceReadError=String(error.message||'RPC unavailable.').slice(0,200);}
  if(process.argv.includes('--retry-unavailable')){
    if(health.body?.dependencies?.indexer?.ok!==true)throw new Error('The faucet indexer is still unavailable; no claims retried.');
    for(const wallet of report.wallets){
      if(wallet.status!=='unconfirmed'||wallet.httpStatus!==503||wallet.response?.error!=='Indexer unavailable; retry later'||wallet.response?.txHash)continue;
      const seconds=Number(wallet.retryAfter);
      if(!Number.isFinite(seconds)||seconds<0)throw new Error('Unknown faucet retry window.');
      const retryAt=Date.parse(wallet.finishedAt)+seconds*1000;
      wallet.attempts??=[];wallet.attempts.push({startedAt:wallet.startedAt,finishedAt:wallet.finishedAt,httpStatus:wallet.httpStatus,response:wallet.response,retryAfter:wallet.retryAfter});
      wallet.retryNotBefore=new Date(retryAt).toISOString();wallet.retryNeedsBalanceCheck=true;
      wallet.status='planned';delete wallet.startedAt;delete wallet.finishedAt;delete wallet.response;delete wallet.httpStatus;delete wallet.retryAfter;
    }
  }
  await save();
  if(process.argv.includes('--claim')){
    const gap=Math.max(11000,Number(health.body?.limits?.ipCooldownMs||10000)+1000);
    let lastPost=0;
    for(const wallet of report.wallets){
      if(wallet.startedAt)continue; // Accepted, rejected and uncertain outcomes all remain recorded.
      const pause=Math.max(lastPost+gap,Date.parse(report.nextClaimAfter||'1970-01-01'),Date.parse(wallet.retryNotBefore||'1970-01-01'))-Date.now();
      if(pause>60000){report.stoppedUntil=new Date(Date.now()+pause).toISOString();break;}
      if(pause>0)await new Promise(resolve=>setTimeout(resolve,pause));
      if(wallet.retryNeedsBalanceCheck){
        const current=await chain.snapshot([wallet.address]),before=report.before?.balances.find(b=>b.address===wallet.address);
        if(!before||current.balances[0].freeRaw!==before.freeRaw)throw new Error(`Reconcile ${wallet.name}'s changed balance before retrying its faucet claim.`);
        delete wallet.retryNeedsBalanceCheck;
      }
      wallet.status='requested';wallet.startedAt=new Date().toISOString();await save();
      lastPost=Date.now();
      try{
        const result=await get('https://faucet.flop.network/fund',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({address:wallet.address})});
        wallet.httpStatus=result.status;wallet.response=result.body;wallet.retryAfter=result.retryAfter;
        wallet.status=result.status>=200&&result.status<300&&result.body.success===true?'accepted':result.status>=500?'unconfirmed':'rejected';
      }catch(error){wallet.status='unconfirmed';wallet.error=String(error.message||'Faucet response unavailable.').slice(0,200);}
      wallet.finishedAt=new Date().toISOString();await save();
      console.log(JSON.stringify({wallet:wallet.name,status:wallet.status,httpStatus:wallet.httpStatus,amount:wallet.response?.amount,txHash:wallet.response?.txHash,error:wallet.response?.error||wallet.error,retryAfter:wallet.retryAfter}));
      if(wallet.httpStatus>=500&&/^\d+$/.test(wallet.retryAfter||'')){report.nextClaimAfter=new Date(Date.now()+Number(wallet.retryAfter)*1000).toISOString();await save();}
      if(wallet.httpStatus===429&&/\bIP\b|prefix|global|daily cap/i.test(String(wallet.response?.error||''))){report.stoppedForSharedLimit=true;break;}
    }
  }
  const deadline=Date.now()+35000;
  do{
    try{
      report.after=await chain.snapshot(RESIDENTS.map(r=>r.address));
      for(const wallet of report.wallets){
        const before=report.before?.balances.find(b=>b.address===wallet.address),after=report.after.balances.find(b=>b.address===wallet.address);
        wallet.finalizedBalanceRaw=after.freeRaw;
        if(before)wallet.balanceIncreaseRaw=(BigInt(after.freeRaw)-BigInt(before.freeRaw)).toString();
        if(wallet.status==='accepted'&&before&&BigInt(wallet.balanceIncreaseRaw)>=25000000000000000000n){wallet.balanceConfirmed=true;wallet.confirmedAtBlock=report.after.finalizedBlock;}
      }
    }catch(error){report.balanceReadError=String(error.message||'RPC unavailable.').slice(0,200);break;}
    if(!report.wallets.some(w=>w.status==='accepted'&&!w.balanceConfirmed))break;
    await new Promise(resolve=>setTimeout(resolve,3000));
  }while(Date.now()<deadline);
  report.finishedAt=new Date().toISOString();await save();await writeFile(output,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({finishedAt:report.finishedAt,accepted:report.wallets.filter(w=>w.status==='accepted').length,balanceConfirmed:report.wallets.filter(w=>w.balanceConfirmed).length,wallets:report.wallets.map(w=>({name:w.name,status:w.status,amount:w.response?.amount,txHash:w.response?.txHash,balanceConfirmed:!!w.balanceConfirmed,finalizedBalanceRaw:w.finalizedBalanceRaw,balanceIncreaseRaw:w.balanceIncreaseRaw,error:w.response?.error||w.error,retryAfter:w.retryAfter})),reportFile:output.pathname},null,2));
}finally{await chain.close();}
