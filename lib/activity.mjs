import { GENESIS, EXPLORER } from './config.mjs';
import { canonicalAddress } from './auth.mjs';
import { recordActivity } from './rewards.mjs';

function eventFields(event){
  return Object.fromEntries(event.meta.fields.map((field,index)=>[field.name.toString(),event.data[index]]));
}

// Decode only actual emitted events; a successful outer utility.batch alone
// does not establish that each nested call succeeded.
export async function activitiesInBlock(page,agents,readChannel){
  const addresses=new Set(agents.map(a=>a.address)),records=[],handled=new Set();
  const at=new Date(page.timestamp).toISOString();
  const byExtrinsic=new Map();
  page.events.forEach((record,eventIndex)=>{
    if(!record.phase.isApplyExtrinsic)return;
    const index=record.phase.asApplyExtrinsic.toNumber();
    if(!byExtrinsic.has(index))byExtrinsic.set(index,[]);
    byExtrinsic.get(index).push({event:record.event,eventIndex});
  });
  for(const [index,events] of byExtrinsic){
    const tx=page.block.extrinsics[index];
    if(!tx)continue;
    const txHash=tx.hash.toHex(),success=events.some(({event:e})=>e.section==='system'&&e.method==='ExtrinsicSuccess');
    const proof={genesis:GENESIS,txHash,blockHash:page.hash,blockNumber:page.number,extrinsicIndex:index,explorerUrl:`${EXPLORER}/extrinsics/${page.number}-${index}`};
    const towerPurchase=tx.method.section==='utility'&&JSON.stringify(tx.method.toHuman()).includes('chief-tower/v1')&&/buy|settle-bid/.test(JSON.stringify(tx.method.toHuman()));
    const add=(type,actor,eventIndex,extra={})=>{
      if(!addresses.has(actor))return;
      records.push({id:`chain:${page.hash}:${eventIndex}:${actor}`,type,actor,success,at,proof:{...proof,eventIndex},...extra});
      handled.add(`${index}:${actor}`);
    };
    if(success)for(const {event,eventIndex} of events){
      if(event.section==='balances'&&event.method==='Transfer'){
        const from=canonicalAddress(event.data[0].toString()),recipient=canonicalAddress(event.data[1].toString());
        add('transfer',from,eventIndex,{recipient,amountRaw:event.data[2].toString(),towerPurchase});
        if(recipient!==from)add('received',recipient,eventIndex,{sender:from,amountRaw:event.data[2].toString()});
      }else if(event.section==='agentIdentity'&&event.method==='AgentRegistered'){
        add('agent-registration',canonicalAddress(event.data[1].toString()),eventIndex,{agentId:event.data[0].toHex(),nativeDid:event.data[3].toUtf8()});
      }else if(event.section==='daRegistry'&&event.method==='BlobRegistered'){
        add('storage',canonicalAddress(event.data[1].toString()),eventIndex,{commitment:event.data[0].toHex(),sizeBytes:event.data[3].toString()});
      }else if(event.section==='computeChannel'&&['Settled','ForwardSettled'].includes(event.method)){
        const fields=eventFields(event),channelId=fields.channel_id.toHex();
        const channel=await readChannel(channelId,page);
        if(!channel)continue;
        const owner=channel.agent??channel.client??channel.owner;
        if(!owner)throw new Error('Compute channel ownership format changed; indexing stopped before rewards.');
        add('compute-settled',canonicalAddress(owner.toString()),eventIndex,{channelId,amountRaw:fields.miner_paid.toString(),aggregateGn:(fields.aggregate_gn??fields.delivered_gn).toString()});
      }
    }
    if(tx.isSigned){
      const actor=canonicalAddress(tx.signer.toString());
      if(addresses.has(actor)&&!handled.has(`${index}:${actor}`)){
        records.push({id:`chain:${page.hash}:extrinsic:${index}`,type:'chain-call',actor,success,at,proof,call:`${tx.method.section}.${tx.method.method}`});
      }
    }
  }
  return records;
}

export class ActivityIndexer {
  constructor(store,chain){this.store=store;this.chain=chain;}
  async sync(){
    const finalized=await this.chain.finalized();
    this.store.change(state=>{
      if(!Number.isSafeInteger(state.indexer?.nextBlock))state.indexer={startBlock:finalized.number+1,nextBlock:finalized.number+1,status:'syncing'};
      state.indexer.targetBlock=finalized.number;
      for(const agent of state.agents)if(agent.onboardedAt&&agent.trackingFromBlock===null)agent.trackingFromBlock=finalized.number+1;
    });
    const cursor=this.store.read().indexer.nextBlock;
    const to=Math.min(finalized.number,cursor+11);
    for(let start=cursor;start<=to;start+=4){
      const heights=Array.from({length:Math.min(4,to-start+1)},(_,i)=>start+i);
      const pages=await Promise.all(heights.map(height=>this.chain.inspectBlock(height)));
      for(const page of pages){
        const records=await activitiesInBlock(page,this.store.read().agents,async(channelId,p)=>{
          const record=await p.at.query.computeChannel.channels(channelId);
          return record.isSome?record.unwrap():null;
        });
        this.store.change(state=>{
          if(state.indexer.nextBlock!==page.number)throw new Error('Activity index cursor changed.');
          for(const record of records)recordActivity(state,record);
          state.indexer.nextBlock=page.number+1;
          state.indexer.lastBlockHash=page.hash;
          state.indexer.checkedAt=new Date().toISOString();
        });
      }
    }
    return this.store.change(state=>{
      Object.assign(state.indexer,{status:state.indexer.nextBlock>finalized.number?'synced':'catching-up',checkedAt:new Date().toISOString()});
      delete state.indexer.error;return state.indexer;
    });
  }
}
