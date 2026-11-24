import { ApiPromise, WsProvider } from '@polkadot/api';
import { decodeAddress, encodeAddress } from '@polkadot/util-crypto';
import { stringToHex } from '@polkadot/util';
import { GENESIS, RPC } from '../lib/config.mjs';
import { checkedTransaction } from '../lib/operation-check.mjs';
import { validateEnrollment } from '../lib/enrollment.mjs';
let current;
export function extensions(){return Object.keys(window.injectedWeb3||{});}
export async function accounts(extension){const injected=await window.injectedWeb3[extension].enable('Chief Tower');const accounts=await injected.accounts.get();return accounts.map(account=>({...account,rawAddress:account.address,address:encodeAddress(decodeAddress(account.address),42),injected}));}
export function select(account){current=account;return account.address;}
async function signature(message){if(!current?.injected.signer.signRaw)throw new Error('This wallet does not support signing agent messages.');return (await current.injected.signer.signRaw({address:current.rawAddress,data:stringToHex(message),type:'bytes'})).signature;}
export async function request(method,path,input){
  if(!current)throw new Error('Connect an agent first.');
  const body=input===undefined?'':JSON.stringify(input),timestamp=String(Date.now()),nonce=crypto.randomUUID();
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(body));
  const hash=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
  const message=`Chief Tower request v1\nGenesis: ${GENESIS}\nOrigin: ${location.origin}\nAddress: ${current.address}\nTimestamp: ${timestamp}\nNonce: ${nonce}\nMethod: ${method}\nPath: ${path}\nBody SHA256: ${hash}`;
  const signed=await signature(message);
  const response=await fetch(path,{method,headers:{'Content-Type':'application/json','X-Tower-Address':current.address,'X-Tower-Timestamp':timestamp,'X-Tower-Nonce':nonce,'X-Tower-Signature':signed},...(body?{body}:{}),signal:AbortSignal.timeout(45000)});
  const result=await response.json();if(!response.ok)throw new Error(result.error||'Tower could not complete this request.');return result;
}
export async function enroll(){const {message}=await request('POST','/v1/gateway/challenge',{});validateEnrollment(message,current.address);return request('POST','/v1/gateway/enroll',{message,signature:await signature(message)});}
export async function operate(input){
  const op=await request('POST','/v1/operations',input);if(op.status!=='prepared')return op;
  const api=await ApiPromise.create({provider:new WsProvider(RPC),noInitWarn:true});
  try{
    const tx=checkedTransaction(api,op,input,current.address);
    if(BigInt((await tx.paymentInfo(current.address)).partialFee.toString())>50000000000000000n)throw new Error('The current network fee exceeds 0.05 FLOP.');
    await tx.signAsync(current.rawAddress,{signer:current.injected.signer,nonce:-1,era:128});
    return await request('POST',`/v1/operations/${op.id}/submit`,{extrinsic:tx.toHex()});
  }finally{await api.disconnect();}
}
