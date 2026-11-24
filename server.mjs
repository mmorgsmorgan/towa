import http from 'node:http';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cryptoWaitReady } from '@polkadot/util-crypto';
import { Store } from './lib/store.mjs';
import { Chain } from './lib/chain.mjs';
import { Inference } from './lib/inference.mjs';
import { createHttpApp } from './lib/http-app.mjs';
import { expirePreparations } from './lib/ledger.mjs';
import { reconcileBidFunding } from './lib/bids.mjs';
import { ActivityIndexer } from './lib/activity.mjs';
import { GENESIS } from './lib/config.mjs';
const root=fileURLToPath(new URL('.',import.meta.url));
const port=Number(process.env.PORT||4173),host=process.env.HOST||'127.0.0.1';
const configuredOrigin=process.env.TOWER_ORIGIN?.replace(/\/$/,'');
const dataDirectory=process.env.TOWER_DATA_DIR||join(root,'data');
const mcpEnabled=process.env.TOWER_MCP_ENABLED!=='0'&&!existsSync(join(dataDirectory,'mcp-disabled'));
const store=new Store(join(dataDirectory,'tower.sqlite'));
const chain=new Chain(),inference=new Inference(store,chain);
const activity=new ActivityIndexer(store,chain);
await cryptoWaitReady();inference.recoverAfterRestart();
const busy=new Set();
function tick(name,fn){
  if(busy.has(name))return;busy.add(name);let timer;
  const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{if(name!=='inference')void chain.reset();reject(new Error('FLOP did not respond before the update deadline.'));},40000);});
  Promise.race([Promise.resolve().then(fn),timeout]).catch(error=>{
    if(name==='network')store.change(s=>{s.network={...s.network,status:'unavailable',error:error.message,checkedAt:new Date().toISOString()};});
    if(name==='activity')store.change(s=>{s.indexer={...s.indexer,status:'unavailable',error:error.message,checkedAt:new Date().toISOString()};});
  }).finally(()=>{clearTimeout(timer);busy.delete(name);});
}
const network=()=>chain.snapshot(store.read().agents.map(a=>a.address)).then(snapshot=>store.change(state=>{state.network=snapshot;reconcileBidFunding(state,snapshot);}));
tick('network',network);
const intervals=[setInterval(()=>tick('network',network),15000),setInterval(()=>tick('transactions',()=>chain.reconcileOperations(store)),2500),setInterval(()=>tick('inference',()=>inference.reconcile()),10000),setInterval(()=>tick('activity',()=>activity.sync()),6000),setInterval(()=>store.change(s=>expirePreparations(s)),5000)];
const {handler}=createHttpApp({store,chain,inference,configuredOrigin,root,mcpEnabled});
const server=http.createServer({headersTimeout:15000,requestTimeout:30000},handler);
server.listen(port,host,()=>console.log(`Chief Tower listening at http://${host}:${port}; genesis ${GENESIS}`));
async function shutdown(){intervals.forEach(clearInterval);server.close();await chain.close();store.close();process.exit(0);}
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
