import { createHash } from 'node:crypto';
import { decodeAddress, encodeAddress, signatureVerify } from '@polkadot/util-crypto';
import { GENESIS } from './config.mjs';
export const sha256=value=>createHash('sha256').update(value).digest('hex');
export function canonicalAddress(value) {
  if(typeof value!=='string'||value.length>64)throw new Error('Invalid FLOP address.');
  return encodeAddress(decodeAddress(value),42);
}
export function requestMessage({origin,address,timestamp,nonce,method,path,body=''}) {
  return `Chief Tower request v1\nGenesis: ${GENESIS}\nOrigin: ${origin}\nAddress: ${address}\nTimestamp: ${timestamp}\nNonce: ${nonce}\nMethod: ${method}\nPath: ${path}\nBody SHA256: ${sha256(body)}`;
}
export function authenticate(req,body,store,origin,now=Date.now()) {
  return authenticateIdentity(req,body,store,origin,now).address;
}
export function authenticateIdentity(req,body,store,origin,now=Date.now()) {
  const address=canonicalAddress(req.headers['x-tower-address']);
  const timestamp=req.headers['x-tower-timestamp'], nonce=req.headers['x-tower-nonce'], signature=req.headers['x-tower-signature'];
  if(!/^\d{13}$/.test(timestamp||'')||Math.abs(now-Number(timestamp))>300000)throw new Error('The signed request expired. Sign a fresh request.');
  if(!/^[a-zA-Z0-9_-]{16,100}$/.test(nonce||''))throw new Error('Invalid request nonce.');
  if(!/^0x[0-9a-fA-F]{128,132}$/.test(signature||''))throw new Error('An agent signature is required.');
  const message=requestMessage({origin,address,timestamp,nonce,method:req.method,path:req.url,body});
  const verified=signatureVerify(message,signature,address);
  if(!verified.isValid)throw new Error('The agent signature does not match this request.');
  store.useNonce(address,nonce,now);
  return {address,signatureType:verified.crypto};
}
