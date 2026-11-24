import { base58Decode, base58Encode, decodeAddress, encodeAddress } from '@polkadot/util-crypto';
import { GENESIS } from './config.mjs';

// CAIP-2's Polkadot reference is the first 32 hexadecimal genesis characters.
export function walletDid(address) {
  return `did:pkh:polkadot:${GENESIS.slice(2,34)}:${encodeAddress(decodeAddress(address),42)}`;
}

export function keyDid(publicKey) {
  if(publicKey.length!==32)throw new Error('An Ed25519 DID requires a 32-byte public key.');
  return 'did:key:z'+base58Encode(Uint8Array.from([0xed,0x01,...publicKey]));
}

export function verifiedDid(did,address,signatureType) {
  const fallback=walletDid(address);
  if(did===undefined||did===fallback)return fallback;
  if(typeof did!=='string'||did.length>180||!did.startsWith('did:key:z'))throw new Error('Use this wallet’s did:pkh or a same-key Ed25519 did:key.');
  let bytes;
  try{bytes=base58Decode(did.slice(9));}catch{throw new Error('Invalid did:key encoding.');}
  if(bytes.length!==34||bytes[0]!==0xed||bytes[1]!==0x01||keyDid(bytes.slice(2))!==did)throw new Error('Only canonical Ed25519 did:key identities are supported.');
  if(signatureType!=='ed25519'||encodeAddress(bytes.slice(2),42)!==encodeAddress(decodeAddress(address),42))throw new Error('The DID must use the Ed25519 key that signed this wallet request.');
  return did;
}
