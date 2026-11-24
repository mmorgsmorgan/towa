import { ApiPromise, WsProvider, HttpProvider } from '@polkadot/api';
import { stringToHex } from '@polkadot/util';
import { GENESIS, RPC, EXPLORER } from './config.mjs';
import { canonicalAddress } from './auth.mjs';
import { commitOperation, releaseOperation } from './ledger.mjs';
import { PAYMENT_TYPES } from './amounts.mjs';
import { combinedPayments } from './economics.mjs';
const hashPattern=/^0x[0-9a-f]{64}$/;
export class Chain {
  constructor(){this.connecting=null;this.api=null;this.connectedEndpoint=null;}
  async connect(){
    if(this.api?.isConnected)return this.api;
    if(this.connecting)return this.connecting;
    this.connecting=(async()=>{
      // The backend polls finalized state; it does not need subscriptions.
      // HTTPS works through the configured proxy when WebSockets cannot connect.
      const http=RPC.replace(/^wss:/,'https:');
      const endpoints=[{url:http,provider:()=>new HttpProvider(http)},{url:RPC,provider:()=>new WsProvider(RPC,2000,{},20000)}];
      let lastError;
      for(const endpoint of endpoints){
        const api=new ApiPromise({provider:endpoint.provider(),noInitWarn:true});
        let timer;
        try {
          await Promise.race([api.isReadyOrError,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('FLOP RPC connection timed out.')),25000);})]);
          if(api.genesisHash.toHex()!==GENESIS||api.registry.chainDecimals[0]!==18)throw new Error('Unexpected FLOP network.');
          for(const [pallet,call] of [['system','remarkWithEvent'],['balances','transferKeepAlive'],['utility','batchAll']])if(!api.tx[pallet]?.[call])throw new Error(`This runtime is missing ${pallet}.${call}.`);
          this.api=api;this.connectedEndpoint=endpoint.url;return api;
        } catch(error){lastError=error;await api.disconnect();}finally{clearTimeout(timer);}
      }
      throw lastError;
    })().finally(()=>{this.connecting=null;});return this.connecting;
  }
  async finalized(){
    const api=await this.connect(),hash=await api.rpc.chain.getFinalizedHead();
    const [at,header]=await Promise.all([api.at(hash),api.rpc.chain.getHeader(hash)]);
    const timestamp=Number((await at.query.timestamp.now()).toString());
    if(Math.abs(Date.now()-timestamp)>120000)throw new Error('FLOP finalized head is stale.');
    return {api,at,hash:hash.toHex(),number:header.number.toNumber(),timestamp};
  }
  async snapshot(addresses){
    const {api,at,hash,number,timestamp}=await this.finalized();
    const balances=[];
    for(let start=0;start<addresses.length;start+=100){
      const batch=addresses.slice(start,start+100),accounts=await at.query.system.account.multi(batch);
      accounts.forEach((value,i)=>{const data=value.data;balances.push({address:batch[i],freeRaw:data.free.toString(),reservedRaw:data.reserved.toString(),frozenRaw:(data.frozen??data.miscFrozen??0).toString()});});
    }
    return {name:'FLOP devnet',genesis:GENESIS,decimals:18,symbol:'FLOP',rpc:this.connectedEndpoint||RPC,explorer:EXPLORER,existentialDepositRaw:api.consts.balances.existentialDeposit.toString(),specVersion:api.runtimeVersion.specVersion.toString(),finalizedBlock:number,finalizedHash:hash,blockTime:new Date(timestamp).toISOString(),checkedAt:new Date().toISOString(),balances,status:'connected'};
  }
  async funding(address){
    const {api,at,hash,number}=await this.finalized(),account=await at.query.system.account(address);
    const free=BigInt(account.data.free.toString()),frozen=BigInt((account.data.frozen??account.data.miscFrozen??0).toString()),ed=BigInt(api.consts.balances.existentialDeposit.toString());
    const keep=frozen>ed?frozen:ed;
    return {genesis:GENESIS,address,blockHash:hash,blockNumber:number,usableRaw:(free>keep?free-keep:0n).toString(),checkedAt:new Date().toISOString()};
  }
  async call(op){
    const api=await this.connect();
    const anchor=api.tx.system.remarkWithEvent(stringToHex(op.remark));
    if(!PAYMENT_TYPES.includes(op.type))return anchor;
    const legs=combinedPayments(op.action.paymentLegs||[{recipient:op.action.seller||op.action.recipient,amountRaw:op.action.priceRaw}],op.actor);
    return api.tx.utility.batchAll([...legs.map(leg=>api.tx.balances.transferKeepAlive(leg.recipient,leg.amountRaw)),anchor]);
  }
  async quote(op){
    const call=await this.call(op);
    const fee=await call.paymentInfo(op.actor);
    return {genesis:GENESIS,callData:call.method.toHex(),unsignedExtrinsic:call.toHex(),estimatedFeeRaw:fee.partialFee.toString(),paymentRaw:PAYMENT_TYPES.includes(op.type)?op.action.paymentRaw||op.action.priceRaw:'0',paymentLegs:op.action.paymentLegs||[],pointsBurned:op.points,eraPeriod:128};
  }
  async submit(store,id,address,raw){
    const op=store.read().operations.find(o=>o.id===id);
    if(!op||op.actor!==address)throw new Error('Unknown operation for this agent.');
    if(typeof raw!=='string'||!/^0x[0-9a-f]+$/i.test(raw)||raw.length>32768)throw new Error('Invalid signed transaction.');
    const {api,number}=await this.finalized();
    const tx=api.tx(raw),expected=await this.call(op),txHash=tx.hash.toHex();
    if(!tx.isSigned||canonicalAddress(tx.signer.toString())!==address||tx.method.toHex()!==expected.method.toHex())throw new Error('The signed transaction does not match this Tower action.');
    if(!tx.era.isMortalEra||tx.era.asMortalEra.period.toNumber()>256)throw new Error('Use a mortal transaction with an era of at most 256 blocks.');
    if(op.status!=='prepared'){
      if(op.txHash===txHash)return op;
      throw new Error('This operation already has a transaction or was cancelled.');
    }
    if(op.preparationExpiresAt&&Date.parse(op.preparationExpiresAt)<=Date.now())throw new Error('This unsigned preparation expired.');
    const death=Number(tx.era.asMortalEra.death(number).toString());
    if(death<=number)throw new Error('The signed transaction has expired.');
    store.change(state=>{
      const current=state.operations.find(o=>o.id===id);if(current.status!=='prepared')throw new Error('This operation changed; refresh before signing.');
      Object.assign(current,{status:'submitted',rawExtrinsic:raw,txHash,submittedAt:new Date().toISOString(),submittedHeight:number,scanHeight:number,expiresAtBlock:death});
    });
    try {
      const returned=await api.rpc.author.submitExtrinsic(raw);
      if(returned.toHex()!==txHash)throw new Error('RPC returned an unexpected transaction hash.');
    } catch(error){
      // A transport error does not prove that the transaction failed. Retain locks
      // and scan its complete mortal lifetime before releasing anything.
      store.change(state=>{state.operations.find(o=>o.id===id).broadcastError=String(error.message).slice(0,300);});
    }
    return store.read().operations.find(o=>o.id===id);
  }
  async inspectBlock(height){
    const api=await this.connect(),hash=await api.rpc.chain.getBlockHash(height);
    const [block,at]=await Promise.all([api.rpc.chain.getBlock(hash),api.at(hash)]);
    const [events,timestamp]=await Promise.all([at.query.system.events(),at.query.timestamp.now()]);
    return {hash:hash.toHex(),number:height,block:block.block,events,at,timestamp:Number(timestamp.toString())};
  }
  transactionEvidence(page,op){
    const index=page.block.extrinsics.findIndex(tx=>tx.hash.toHex()===op.txHash);if(index<0)return null;
    const tx=page.block.extrinsics[index];
    const events=page.events.filter(record=>record.phase.isApplyExtrinsic&&record.phase.asApplyExtrinsic.toNumber()===index).map(record=>record.event);
    if(events.some(e=>e.section==='system'&&e.method==='ExtrinsicFailed'))return {failed:true,error:'The finalized transaction failed on-chain.'};
    if(!events.some(e=>e.section==='system'&&e.method==='ExtrinsicSuccess'))throw new Error('No extrinsic success event.');
    if(canonicalAddress(tx.signer.toString())!==op.actor)throw new Error('Finalized signer mismatch.');
    if(!events.some(e=>e.section==='system'&&e.method==='Remarked'&&canonicalAddress(e.data[0].toString())===op.actor))throw new Error('The provenance event is missing.');
    if(PAYMENT_TYPES.includes(op.type)){
      const legs=combinedPayments(op.action.paymentLegs||[{recipient:op.action.seller||op.action.recipient,amountRaw:op.action.priceRaw}],op.actor);
      for(const leg of legs)if(!events.some(e=>e.section==='balances'&&e.method==='Transfer'&&canonicalAddress(e.data[0].toString())===op.actor&&canonicalAddress(e.data[1].toString())===leg.recipient&&e.data[2].toString()===leg.amountRaw))throw new Error('An expected seller, creator, or platform payment is missing.');
    }
    return {genesis:GENESIS,txHash:op.txHash,blockHash:page.hash,blockNumber:page.number,extrinsicIndex:index,explorerUrl:`${EXPLORER}/extrinsic/${op.txHash}`};
  }
  async reconcileOperations(store){
    const pending=store.read().operations.filter(o=>o.status==='submitted');if(!pending.length)return;
    const {number}=await this.finalized();
    const from=Math.min(...pending.map(o=>o.scanHeight)),to=Math.min(number,from+23);
    if(from>to)return;
    const pages=[];
    for(let height=from;height<=to;height+=6){
      pages.push(...await Promise.all(Array.from({length:Math.min(6,to-height+1)},(_,i)=>this.inspectBlock(height+i))));
    }
    for(const op of pending){
      let evidence;
      for(const page of pages){if(page.number<op.scanHeight)continue;evidence=this.transactionEvidence(page,op);if(evidence)break;}
      store.change(state=>{
        const current=state.operations.find(o=>o.id===op.id);if(current.status!=='submitted')return;
        if(evidence?.failed)releaseOperation(state,op.id,evidence.error);
        else if(evidence)commitOperation(state,op.id,evidence);
        else if(to>=current.scanHeight){
          current.scanHeight=to+1;
          if(to>=current.expiresAtBlock)releaseOperation(state,op.id,'Transaction expired without finalized inclusion. Reserved items and points were released.');
        }
      });
    }
  }
  async verifyInference(session,receipt){
    if(receipt.request_id!==session.id||receipt.model.toLowerCase()!==session.model.toLowerCase()||receipt.state!=='settled'||receipt.response_status!==200||!/^\d+$/.test(receipt.settled_spend_raw||'')||BigInt(receipt.settled_spend_raw)<=0n||!hashPattern.test(receipt.channel_id||'')||!receipt.terminal_event)throw new Error('Gateway allocation is not settled yet.');
    const response=await fetch(`${EXPLORER}/api/compute-channels/${receipt.channel_id}`,{signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw new Error('Channel evidence has not reached the indexer yet.');
    const json=await response.json(),channel=json.data??json,locator=channel.settlement;
    if(channel.channelId!==receipt.channel_id||channel.paymentStatus!=='PAID'||locator?.kind!=='settled'||!Number.isSafeInteger(locator.blockNumber)||locator.blockNumber<1||!hashPattern.test(locator.blockHash||'')||!hashPattern.test(locator.extrinsicHash||''))throw new Error('Channel settlement is not available yet.');
    const {api,number}=await this.finalized();if(locator.blockNumber>number)throw new Error('Settlement has not finalized.');
    const page=await this.inspectBlock(locator.blockNumber);
    if(page.hash!==locator.blockHash)throw new Error('Settlement block is not canonical.');
    const tx=page.block.extrinsics[locator.extrinsicIndex];
    if(!tx||tx.hash.toHex()!==locator.extrinsicHash)throw new Error('Settlement transaction mismatch.');
    const events=page.events.filter(e=>e.phase.isApplyExtrinsic&&e.phase.asApplyExtrinsic.toNumber()===locator.extrinsicIndex).map(e=>e.event);
    if(!events.some(e=>e.section==='system'&&e.method==='ExtrinsicSuccess'))throw new Error('Settlement transaction did not succeed.');
    const settled=events.find(e=>e.section==='computeChannel'&&e.method==='Settled'&&e.data[0].toHex()===receipt.channel_id);
    if(!settled||BigInt(settled.data[1].toString())<=0n||BigInt(settled.data[3].toString())<=0n)throw new Error('No matching paid-compute settlement event.');
    const at=await api.at(page.hash),stored=await at.query.computeChannel.channels(receipt.channel_id);
    if(stored.isNone)throw new Error('Settled channel is missing from chain storage.');
    const record=stored.unwrap();
    if(canonicalAddress(record.miner.toString())!==canonicalAddress(channel.miner))throw new Error('Serving miner mismatch.');
    const model=await at.query.modelRegistry.models(record.modelHash);
    if(model.isNone||model.unwrap().modelName.toUtf8().toLowerCase()!==session.model.toLowerCase())throw new Error('Settled model does not match the inference request.');
    return {genesis:GENESIS,requestId:session.id,channelId:receipt.channel_id,txHash:locator.extrinsicHash,blockHash:page.hash,blockNumber:page.number,extrinsicIndex:locator.extrinsicIndex,miner:channel.miner,requestSpendRaw:receipt.settled_spend_raw,channelMinerPaidRaw:settled.data[1].toString(),aggregateGn:settled.data[3].toString(),allocationSource:'FLOP gateway credential ledger',settlementSource:'FLOP finalized chain',explorerUrl:`${EXPLORER}/compute-channels/${receipt.channel_id}`};
  }
  async reset(){const api=this.api;this.api=null;this.connecting=null;this.connectedEndpoint=null;await api?.disconnect();}
  async close(){await this.reset();}
}
