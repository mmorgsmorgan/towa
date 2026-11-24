import { randomUUID } from 'node:crypto';
import { ApiPromise, WsProvider } from '@polkadot/api';
import { requestMessage } from './auth.mjs';
import { validateEnrollment } from './enrollment.mjs';
import { GENESIS, RPC } from './config.mjs';
import { checkedTransaction } from './operation-check.mjs';
import { keyDid, walletDid } from './did.mjs';
import { validateOfferInput } from './offer-input.mjs';
export class AgentClient {
  constructor({origin,signer,did,name}){this.origin=origin.replace(/\/$/,'');this.signer=signer;this.did=did||(signer.type==='ed25519'?keyDid(signer.publicKey):walletDid(signer.address));this.name=name;const url=new URL(this.origin);if(url.origin!==this.origin||url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)))throw new Error('Use an exact HTTPS or loopback HTTP origin for Tower.');}
  async request(method,path,input){
    const body=input===undefined?'':JSON.stringify(input),timestamp=String(Date.now()),nonce=randomUUID();
    const message=requestMessage({origin:this.origin,address:this.signer.address,timestamp,nonce,method,path,body});
    const signature='0x'+Buffer.from(await this.signer.sign(new TextEncoder().encode(message))).toString('hex');
    const response=await fetch(this.origin+path,{method,headers:{'Content-Type':'application/json','X-Tower-Address':this.signer.address,'X-Tower-Timestamp':timestamp,'X-Tower-Nonce':nonce,'X-Tower-Signature':signature},...(body?{body}:{}),signal:AbortSignal.timeout(45000),redirect:'error'});
    const result=await response.json();if(!response.ok)throw new Error(result.error||`Tower returned ${response.status}.`);return result;
  }
  register(name=this.name){return this.request('POST','/v1/agents',{name,did:this.did});}
  onboard(name=this.name){return this.register(name);}
  createMcpSession(options={}){return this.request('POST','/v1/mcp/sessions',{name:this.name,did:this.did,...options});}
  mcpSessions(){return this.request('GET','/v1/mcp/sessions');}
  revokeMcpSession(id){return this.request('POST',`/v1/mcp/sessions/${encodeURIComponent(id)}/revoke`,{});}
  bid(input){validateOfferInput(input);return this.request('POST','/v1/bids',input);}
  acceptBid(id){return this.request('POST',`/v1/bids/${encodeURIComponent(id)}/accept`,{});}
  cancelBid(id){return this.request('POST',`/v1/bids/${encodeURIComponent(id)}/cancel`,{});}
  async signEnrollment(message){validateEnrollment(message,this.signer.address);return {message,signature:'0x'+Buffer.from(await this.signer.sign(new TextEncoder().encode(message))).toString('hex')};}
  async enroll(){const {message}=await this.request('POST','/v1/gateway/challenge',{});return this.request('POST','/v1/gateway/enroll',await this.signEnrollment(message));}
  infer(input){return this.request('POST','/v1/inferences',input);}
  async signOperation(op,input){
    if(!input.requestId||op.requestId!==input.requestId||op.status!=='prepared')throw new Error('Sign only the prepared operation for your saved requestId and original intent.');
    if(BigInt(op.quote.estimatedFeeRaw)>50000000000000000n)throw new Error('The estimated network fee exceeds the 0.05 FLOP safety limit.');
    const api=new ApiPromise({provider:new WsProvider(RPC),noInitWarn:true});
    let timer;
    try{
      await Promise.race([api.isReadyOrError,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('FLOP wallet connection timed out. The preparation can be retried with the same requestId.')),25000);})]);
      clearTimeout(timer);
      if(api.genesisHash.toHex()!==GENESIS)throw new Error('Wrong chain genesis.');
      const tx=checkedTransaction(api,op,input,this.signer.address);
      if(BigInt((await tx.paymentInfo(this.signer)).partialFee.toString())>50000000000000000n)throw new Error('The current chain fee exceeds 0.05 FLOP.');
      await tx.signAsync(this.signer,{nonce:-1,era:128});
      return {operationId:op.id,extrinsic:tx.toHex()};
    }finally{clearTimeout(timer);await api.disconnect();}
  }
  async operate(input,{wait=true}={}){
    if(!input.requestId)throw new Error('Save a unique requestId before submitting an operation.');
    let op=await this.request('POST','/v1/operations',input);
    if(op.status!=='prepared')return op;
    const signed=await this.signOperation(op,input);
    op=await this.request('POST',`/v1/operations/${signed.operationId}/submit`,{extrinsic:signed.extrinsic});
    if(!wait)return op;
    const deadline=Date.now()+180000;
    while(op.status==='submitted'&&Date.now()<deadline){await new Promise(r=>setTimeout(r,2500));op=await this.request('GET',`/v1/operations/${op.id}`);}
    return op;
  }
}
