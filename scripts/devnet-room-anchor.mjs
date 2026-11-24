import { readFile, writeFile, rename } from 'node:fs/promises';
import { stringToHex } from '@polkadot/util';
import { blake2AsHex } from '@polkadot/util-crypto';
import { Chain } from '../lib/chain.mjs';
import { GENESIS, EXPLORER } from '../lib/config.mjs';
import { loadResidentSigner } from '../lib/identities.mjs';
import { keyDid } from '../lib/did.mjs';

// One bounded native remark binds the existing main wallet to Towa's rooms.
// Re-running only reconciles the saved transaction; it never signs a replacement.
const file=new URL('../data/direct-devnet-room-anchor.json',import.meta.url);
const output=new URL('../outputs/direct-devnet-room-anchor.json',import.meta.url);
const chain=new Chain();
const timer=setTimeout(()=>{console.error(record?'Finality wait ended; reconcile the saved transaction before any further submission.':'FLOP RPC initialization timed out; no transaction was signed or submitted.');process.exit(1);},85000);
let record;
try{record=JSON.parse(await readFile(file,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
async function save(){const temp=new URL('../data/direct-devnet-room-anchor.tmp',import.meta.url);await writeFile(temp,JSON.stringify(record,null,2)+'\n',{mode:0o600});await rename(temp,file);}
function report(){const {signedExtrinsic,...safe}=record;return safe;}
try {
  const signer=await loadResidentSigner('chief-node'),did=keyDid(signer.publicKey);
  const statement=JSON.stringify({app:'towa',type:'room-announcement-anchor',version:1,did,announcements:'https://technocore.chat/r/d-towa',discussion:'https://technocore.chat/r/towa'});
  if(record&&(record.genesis!==GENESIS||record.address!==signer.address||record.statement!==statement))throw new Error('Saved room anchor has a different identity or network.');
  if(record?.status==='finalized'){console.log(JSON.stringify(report(),null,2));}
  else {
    const api=await chain.connect();
    if(!record){
      const journal=JSON.parse(await readFile(new URL('../data/technocore-direct-journal.json',import.meta.url),'utf8'));
      if(journal.did!==did||journal.actions.claim?.status!=='confirmed'||!Object.values(journal.actions).some(a=>a.room==='d-towa'&&a.status==='confirmed')||!Object.values(journal.actions).some(a=>a.room==='towa'&&a.status==='confirmed'))throw new Error('Both signed rooms must be confirmed before anchoring.');
      const {at,hash,number}=await chain.finalized(),account=await at.query.system.account(signer.address);
      const nonce=await api.rpc.system.accountNextIndex(signer.address);
      if(nonce.toString()!==account.nonce.toString())throw new Error('Main wallet has a pending transaction; reconcile it first.');
      const tx=api.tx.system.remarkWithEvent(stringToHex(statement)),fee=await tx.paymentInfo(signer.address);
      const feeRaw=BigInt(fee.partialFee.toString()),feeCap=10000000000000000n;
      if(feeRaw>feeCap)throw new Error('Room-anchor fee exceeds the 0.01 test FLOP ceiling.');
      if(BigInt(account.data.free.toString())<BigInt(api.consts.balances.existentialDeposit.toString())+feeCap)throw new Error('Insufficient fee headroom.');
      await tx.signAsync(signer,{nonce,era:64,blockHash:hash});
      record={id:'towa-room-anchor-20261110',genesis:GENESIS,address:signer.address,did,statement,remarkHash:blake2AsHex(statement),status:'submitted',txHash:tx.hash.toHex(),signedExtrinsic:tx.toHex(),nonce:nonce.toString(),estimatedFeeRaw:feeRaw.toString(),feeCeilingRaw:feeCap.toString(),transferredRaw:'0',pointsAwarded:0,scanHeight:number,expiresAtBlock:Number(tx.era.asMortalEra.death(number).toString()),submittedAt:new Date().toISOString()};
      await save();
      try{const returned=await api.rpc.author.submitExtrinsic(record.signedExtrinsic);if(returned.toHex()!==record.txHash)throw new Error('Unexpected submitted hash.');}
      catch(error){record.broadcastError=String(error.message||'RPC submission response unavailable.').slice(0,200);await save();}
      console.log(JSON.stringify({status:'submitted',txHash:record.txHash,estimatedFeeRaw:record.estimatedFeeRaw,transferredRaw:'0'}));
    }
    while(record.status==='submitted'){
      const {number}=await chain.finalized();
      const to=Math.min(number,record.scanHeight+23,record.expiresAtBlock);
      for(let height=record.scanHeight;height<=to;height++){
        const page=await chain.inspectBlock(height),index=page.block.extrinsics.findIndex(tx=>tx.hash.toHex()===record.txHash);
        record.scanHeight=height+1;
        if(index>=0){
          const tx=page.block.extrinsics[index],events=page.events.filter(e=>e.phase.isApplyExtrinsic&&e.phase.asApplyExtrinsic.toNumber()===index).map(e=>e.event);
          const failed=events.find(e=>e.section==='system'&&e.method==='ExtrinsicFailed');
          if(failed){record.status='failed';record.failure=failed.data.toJSON();await save();throw new Error('The room-anchor transaction failed at finality.');}
          if(tx.signer.toString()!==signer.address||!events.some(e=>e.section==='system'&&e.method==='ExtrinsicSuccess')||!events.some(e=>e.section==='system'&&e.method==='Remarked'&&e.data[0].toString()===signer.address&&e.data[1].toHex()===record.remarkHash))throw new Error('Finalized room-anchor evidence does not match.');
          const fee=events.find(e=>e.section==='transactionPayment'&&e.method==='TransactionFeePaid');
          const account=await page.at.query.system.account(signer.address);
          Object.assign(record,{status:'finalized',blockNumber:height,blockHash:page.hash,extrinsicIndex:index,finalizedAt:new Date(page.timestamp).toISOString(),actualFeeRaw:fee?.data?.[1]?.toString()??null,balanceAfterRaw:account.data.free.toString(),explorerUrl:`${EXPLORER}/extrinsic/${record.txHash}`});
          await save();break;
        }
      }
      if(record.status==='submitted'&&record.scanHeight>record.expiresAtBlock){record.status='expired';await save();throw new Error('Room-anchor transaction expired without finalized inclusion.');}
      await save();
      if(record.status==='submitted')await new Promise(resolve=>setTimeout(resolve,2500));
    }
    await writeFile(output,JSON.stringify(report(),null,2)+'\n');console.log(JSON.stringify(report(),null,2));
  }
} catch(error) {
  const failure={checkedAt:new Date().toISOString(),status:record?.status??'not_submitted',txHash:record?.txHash??null,error:String(error.message||'FLOP RPC unavailable.').slice(0,300)};
  await writeFile(new URL('../outputs/direct-devnet-room-anchor-preflight.json',import.meta.url),JSON.stringify(failure,null,2)+'\n');
  console.error(JSON.stringify(failure));process.exitCode=1;
} finally {clearTimeout(timer);await chain.close();}
