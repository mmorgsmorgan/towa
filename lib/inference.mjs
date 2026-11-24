import { FlopClient } from '@flop-labs/client';
import { GATEWAY, MODEL } from './config.mjs';
import { sha256 } from './auth.mjs';
import { agentFor, awardSession } from './ledger.mjs';
import { validateEnrollment, verifyEnrollmentSignature } from './enrollment.mjs';
export class Inference {
  constructor(store,chain){this.store=store;this.chain=chain;this.running=new Set();}
  async challenge(address){
    const response=await fetch(`${GATEWAY}/v1/enroll/wallet/challenge?address=${address}`,{signal:AbortSignal.timeout(20000),redirect:'error'});
    const body=await response.json();if(!response.ok){this.store.change(state=>{agentFor(state,address).gatewayStatus={state:'unavailable',message:body.message||body.error||`FLOP returned ${response.status}`,checkedAt:new Date().toISOString()};});throw new Error(`FLOP enrollment: ${body.message||body.error||response.status}`);}
    validateEnrollment(body.message,address);return body;
  }
  async enroll(address,input){
    verifyEnrollmentSignature(input.message,input.signature,address);
    const response=await fetch(GATEWAY+'/v1/enroll/wallet',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({address,message:input.message,signature:input.signature}),signal:AbortSignal.timeout(25000),redirect:'error'});
    const body=await response.json();if(!response.ok){
      const message=String(body.message||body.error?.message||body.error||`FLOP returned ${response.status}`).slice(0,300);
      this.store.change(state=>{agentFor(state,address).gatewayStatus={state:'unavailable',message,checkedAt:new Date().toISOString()};});
      throw new Error(`FLOP enrollment: ${message}`);
    }
    if(typeof body.key!=='string'||body.model!==MODEL||!Number.isFinite(body.expires_at))throw new Error('Unexpected FLOP enrollment response.');
    this.store.setCredential(address,body);
    this.store.change(state=>{agentFor(state,address).gatewayStatus={state:'connected',model:body.model,expiresAt:body.expires_at,checkedAt:new Date().toISOString()};});
    return {model:body.model,remainingQuota:body.remaining_quota,expiresAt:body.expires_at};
  }
  allowance(address){
    const credential=this.store.credential(address);
    return credential?{connected:true,model:credential.model,expiresAt:credential.expires_at,expired:Date.now()>=credential.expires_at}:{connected:false};
  }
  create(address,input){
    if(typeof input.requestId!=='string'||!/^tower-[a-zA-Z0-9_-]{12,100}$/.test(input.requestId))throw new Error('Use a unique requestId starting with tower- (18–106 characters).');
    if(typeof input.prompt!=='string'||!input.prompt.trim()||input.prompt.length>3000)throw new Error('Write a prompt between 1 and 3,000 characters.');
    const maxTokens=input.maxTokens??48,maxCostFlop=input.maxCostFlop??0.2;
    if(!Number.isSafeInteger(maxTokens)||maxTokens<8||maxTokens>96)throw new Error('Choose between 8 and 96 output tokens.');
    if(typeof maxCostFlop!=='number'||!Number.isFinite(maxCostFlop)||maxCostFlop<=0||maxCostFlop>0.2)throw new Error('Inference is capped at 0.2 devnet FLOP per request.');
    if(input.publish!==undefined&&typeof input.publish!=='boolean')throw new Error('publish must be true or false.');
    const requestHash=sha256(JSON.stringify({prompt:input.prompt,maxTokens,maxCostFlop,publish:!!input.publish}));
    const existing=this.store.read().sessions.find(s=>s.id===input.requestId);
    if(existing){if(existing.actor!==address||existing.requestHash!==requestHash)throw new Error('This requestId belongs to a different inference.');return existing;}
    const credential=this.store.credential(address);
    if(!credential)throw new Error('Connect this agent to FLOP inference first.');
    if(Date.now()>=credential.expires_at)throw new Error('This agent’s FLOP gateway allowance has expired. FLOP must issue a supported credential before more inference can run.');
    const session=this.store.change(state=>{
      agentFor(state,address);
      if(state.sessions.filter(s=>s.actor===address&&Date.now()-Date.parse(s.createdAt)<60000).length>=2)throw new Error('FLOP allows two requests per minute for this agent.');
      if(state.sessions.some(s=>s.actor===address&&['queued','running'].includes(s.status)))throw new Error('This agent already has an inference running.');
      const value={id:input.requestId,actor:address,prompt:input.prompt,publish:!!input.publish,model:credential.model,requestHash,maxTokens,maxCostFlop,status:'queued',points:0,createdAt:new Date().toISOString()};
      state.sessions.push(value);return value;
    });
    void this.run(session.id);return session;
  }
  async run(id){
    if(this.running.has(id))return;this.running.add(id);
    const start=Date.now();
    try {
      const session=this.store.change(state=>{const s=state.sessions.find(s=>s.id===id);if(s.status!=='queued')throw new Error('This inference has already been submitted.');s.status='running';s.startedAt=new Date().toISOString();return s;});
      const credential=this.store.credential(session.actor),client=new FlopClient({apiKey:credential.key});
      try {
        const result=await client.createChatCompletion({model:session.model,messages:[{role:'user',content:session.prompt}],max_tokens:session.maxTokens,max_cost_flop:session.maxCostFlop,max_wait_ms:120000,stream:false},{idempotencyKey:id,correlationId:id,signal:AbortSignal.timeout(135000)});
        this.store.change(state=>{const s=state.sessions.find(s=>s.id===id);Object.assign(s,{status:'awaiting_settlement',result,httpStatus:200,usage:result.usage??null,latencyMs:Date.now()-start,completedAt:new Date().toISOString()});});
      }catch(error){
        const message=error.body?.error?.message||error.body?.message||error.message||'Gateway response unavailable.';
        this.store.change(state=>{const s=state.sessions.find(s=>s.id===id);Object.assign(s,{status:[400,401,403,422,429].includes(error.status)?'failed':'unresolved',httpStatus:error.status??null,error:String(message).slice(0,300),latencyMs:Date.now()-start});});
      }
    }finally{this.running.delete(id);}
  }
  recoverAfterRestart(){
    this.store.change(state=>{for(const s of state.sessions)if(['running','queued'].includes(s.status)){s.status='unresolved';s.error='The server restarted. Checking the existing FLOP request; no replacement inference was submitted.';}});
  }
  async reconcileOne(id){
    const session=this.store.read().sessions.find(s=>s.id===id);if(!session)throw new Error('Unknown inference.');
    if(session.status==='verified')return session;
    const credential=this.store.credential(session.actor);if(!credential)return session;
    const response=await fetch(`${GATEWAY}/v1/keys/me/receipts/${encodeURIComponent(id)}`,{headers:{Authorization:`Bearer ${credential.key}`},signal:AbortSignal.timeout(15000),redirect:'error'});
    if(!response.ok){this.store.change(state=>{const s=state.sessions.find(s=>s.id===id);s.receiptCheckedAt=new Date().toISOString();s.verificationNote=response.status===404?'No gateway receipt available yet.':`Gateway receipt lookup returned ${response.status}.`;});return session;}
    const receipt=await response.json();
    if(receipt.request_id!==id)throw new Error('Gateway returned a different request.');
    this.store.change(state=>{const s=state.sessions.find(s=>s.id===id);s.receipt=receipt;s.receiptCheckedAt=new Date().toISOString();if(receipt.state==='released'){s.status='failed';s.verificationNote='Gateway released the reservation. No points earned.';}});
    if(receipt.state!=='settled'||!session.result||session.httpStatus!==200)return this.store.read().sessions.find(s=>s.id===id);
    try {
      const proof=await this.chain.verifyInference(session,receipt);
      this.store.change(state=>awardSession(state,id,proof));
    }catch(error){this.store.change(state=>{state.sessions.find(s=>s.id===id).verificationNote=error.message;});}
    return this.store.read().sessions.find(s=>s.id===id);
  }
  async reconcile(){
    const pending=this.store.read().sessions.filter(s=>['awaiting_settlement','unresolved'].includes(s.status)&&(!s.receiptCheckedAt||Date.now()-Date.parse(s.receiptCheckedAt)>20000)).slice(0,4);
    await Promise.allSettled(pending.map(s=>this.reconcileOne(s.id)));
  }
}
