import { readFile, writeFile } from 'node:fs/promises';
import { createHash, createDecipheriv } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { ApiPromise, HttpProvider } from '@polkadot/api';
import { Chain } from '../lib/chain.mjs';
import { RESIDENTS, GATEWAY, EXPLORER, GENESIS } from '../lib/config.mjs';
import { loadResidentSigner } from '../lib/identities.mjs';
import { keyDid } from '../lib/did.mjs';

// Read-only readiness report. Never enroll, sign a transaction, or request inference.
const chain = new Chain();
const timeout = setTimeout(() => { console.error('Devnet readiness timed out.'); process.exit(1); }, 90000);
const asJson = value => value?.toJSON?.() ?? value;
const safeFetch = async (url, headers) => {
  const response = await fetch(url, { headers, redirect: 'error', signal: AbortSignal.timeout(18000) });
  const text = await response.text();
  let body; try { body = JSON.parse(text); } catch { body = text.slice(0,12000); }
  return { url, status: response.status, body };
};
const checked = async fn => { try { return await fn(); } catch(error) { return {error:String(error.message).slice(0,240)}; } };
const page = async query => {
  if(!query) return {unavailable:true};
  const entries = await query.entriesPaged({args:[],pageSize:25});
  return {pageLimit:25,possiblyMore:entries.length===25,entries:entries.map(([k,v])=>({key:k.args.map(asJson),value:asJson(v)}))};
};
try {
  const signer = await loadResidentSigner('chief-node');
  const did = keyDid(signer.publicKey);
  const profileHash = createHash('sha256').update(did).digest('hex').slice(0,16);
  if(process.argv.includes('--http-rpc')) {
    const api=await ApiPromise.create({provider:new HttpProvider('https://rpc.devnet.flop.network'),noInitWarn:true});
    if(api.genesisHash.toHex()!==GENESIS||api.registry.chainDecimals[0]!==18){await api.disconnect();throw new Error('Unexpected FLOP network.');}
    chain.api=api;
  }
  const finalized = process.argv.includes('--http-only') ? {error:'RPC was not queried in HTTP-only mode.'} : await checked(()=>chain.finalized());
  const {api,at,hash,number,timestamp} = finalized;
  const tasks = {
    accounts: async () => Promise.all(RESIDENTS.map(async resident => {
      const [account,wallet,funds,agents] = await Promise.all([
        at.query.system.account(resident.address),at.query.agentWallet.wallets(resident.address),
        at.query.agentWallet.walletFunds(resident.address),at.query.agentIdentity.agentsByOwner(resident.address),
      ]);
      return {...resident,freeRaw:account.data.free.toString(),reservedRaw:account.data.reserved.toString(),nonce:account.nonce.toString(),wallet:asJson(wallet),walletFundsRaw:funds.toString(),agentIds:asJson(agents)};
    })),
    models: () => page(at.query.modelRegistry.models),
    miners: () => page(at.query.minerStaking.miners),
    appraisalProfiles: () => page(at.query.attest?.profiles),
    storageProviders: () => page(at.query.daRegistry?.providers),
    storageProfile: async () => ({profile:asJson(await at.query.paidStorage.profile()),rent:asJson(await at.query.paidStorage.rentProfile()),memory:asJson(await at.query.paidStorage.memoryProfile())}),
    computeState: async () => ({mainActiveReservations:asJson(await at.query.computeChannel.activeReservationCount(signer.address)),admissionsPaused:asJson(await at.query.computeChannel.fcuPrimaryAdmissionsPaused()),massSlashPaused:asJson(await at.query.computeChannel.fcuMassSlashPaused())}),
    sessionOffers: () => safeFetch(EXPLORER+'/api/session-offers?limit=20'),
    catalog: () => safeFetch(GATEWAY+'/v1/models'),
    explorerHealth: () => safeFetch(EXPLORER+'/api/health'),
    gateway: async () => {
      let credential, source='local gateway record', priorRequests=[];
      try {credential=JSON.parse(await readFile(new URL('../data/chief-node.gateway.json',import.meta.url),'utf8'));}
      catch(error) {if(error.code!=='ENOENT')throw error;}
      if(!credential) {
        try {credential=JSON.parse(await readFile('/home/chief/technocore-agent/private/tower-gateway.json','utf8'));source='existing main Technocore gateway credential';priorRequests.push({requestId:'chief-tower-materials-pilot-20261105-01',status:'previously attempted; response not confirmed'});}
        catch(error){if(error.code!=='ENOENT')throw error;}
      }
      if(!credential) {
        const db=new DatabaseSync(new URL('../data/tower.sqlite',import.meta.url),{readOnly:true});
        try {
          const row=db.prepare('SELECT sealed FROM credentials WHERE address=?').get(signer.address);
          const state=JSON.parse(db.prepare('SELECT json FROM state WHERE id=1').get().json);
          priorRequests=state.sessions.filter(s=>s.actor===signer.address).map(s=>({requestId:s.id,status:s.status,httpStatus:s.httpStatus}));
          if(row) {
            const key=await readFile(new URL('../data/credential-key',import.meta.url));
            const bytes=Buffer.from(row.sealed,'base64'),decipher=createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12));
            decipher.setAAD(Buffer.from(signer.address));decipher.setAuthTag(bytes.subarray(12,28));
            credential=JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)),decipher.final()]).toString('utf8'));
            key.fill(0);source='existing encrypted Towa credential';
          }
        } finally {db.close();}
      }
      if(!credential)return {credentialPresent:false,priorRequests};
      const result = await safeFetch(GATEWAY+'/v1/keys/me',{Authorization:`Bearer ${credential.key}`});
      const allowed = ['error','message','code','model','models','expires_at','remaining_quota','wallet_address','address','status'];
      const pick = obj => obj && typeof obj==='object' ? Object.fromEntries(Object.entries(obj).filter(([key])=>allowed.includes(key)).map(([key,value])=>[key,typeof value==='object'?pick(value):value])) : obj;
      const report={credentialPresent:true,source,status:result.status,body:pick(result.body),priorRequests};
      try {
        const prior=JSON.parse(await readFile(new URL('../data/chief-node.inference.json',import.meta.url),'utf8'));
        report.priorRequests.push({requestId:prior.requestId,status:prior.status,httpStatus:prior.httpStatus});
        if(prior.requestId) {
          const receipt=await safeFetch(GATEWAY+'/v1/keys/me/receipts/'+encodeURIComponent(prior.requestId),{Authorization:`Bearer ${credential.key}`});
          report.receipt={status:receipt.status,body:pick(receipt.body)};
        }
      } catch(error) {if(error.code!=='ENOENT')throw error;}
      return report;
    },
    didProfile: () => safeFetch(`https://technocore.chat/kv/did-${profileHash.slice(0,2)}/${profileHash.slice(2)}`),
    towaRoom: () => safeFetch('https://technocore.chat/r/d-towa?format=json&limit=5'),
    towaOwner: () => safeFetch('https://technocore.chat/kv/room-owners/d-towa'),
    flopRoom: () => safeFetch('https://technocore.chat/r/flop?format=json&limit=8'),
    devRoom: () => safeFetch('https://technocore.chat/r/dev?format=json&limit=8'),
    inferenceRoom: () => safeFetch('https://technocore.chat/r/inference-agents?format=json&limit=8'),
  };
  if(!at) for(const name of ['accounts','models','miners','appraisalProfiles','storageProviders','storageProfile','computeState']) delete tasks[name];
  const names=Object.keys(tasks);
  const results=await Promise.allSettled(names.map(name=>checked(tasks[name])));
  const findings=Object.fromEntries(names.map((name,i)=>[name,results[i].status==='fulfilled'?results[i].value:{error:String(results[i].reason)}]));
  const report={checkedAt:new Date().toISOString(),readOnly:true,identity:{name:'chief-node',address:signer.address,did},finalized:api?{hash,number,timestamp:new Date(timestamp).toISOString(),specVersion:api.runtimeVersion.specVersion.toString()}:finalized,queryNames:at?{attest:Object.keys(at.query.attest||{}),daRegistry:Object.keys(at.query.daRegistry||{}),hwCalibration:Object.keys(at.query.hwCalibration||{})}:{},...findings};
  await writeFile(new URL('../outputs/direct-devnet-'+(api?'readiness':'http-readiness')+'.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
  const summary={...report};
  for(const key of ['models','miners','storageProviders'])if(summary[key]?.entries)summary[key]={returned:summary[key].entries.length,possiblyMore:summary[key].possiblyMore};
  if(summary.catalog?.body?.data)summary.catalog={status:summary.catalog.status,models:summary.catalog.body.data.map(m=>({id:m.id,pricing:m.pricing,priceSources:m['x-flop']?.price_sources?.length}))};
  for(const key of ['flopRoom','devRoom','inferenceRoom'])if(summary[key]?.body?.messages)summary[key]={status:summary[key].status,room:summary[key].body.room,lastSeq:summary[key].body.last_seq,returned:summary[key].body.messages.length};
  console.log(JSON.stringify(summary,null,2));
} finally {clearTimeout(timeout);await chain.close();}
