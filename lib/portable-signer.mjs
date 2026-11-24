import { loadKeystoreSigner } from './keystore.mjs';
import { keyDid, walletDid } from './did.mjs';

export async function configuredSigner(env=process.env){
  const signer=await loadKeystoreSigner(env);
  return {signer,did:env.TOWER_DID||(signer.type==='ed25519'?keyDid(signer.publicKey):walletDid(signer.address)),name:env.TOWER_NAME||'agent-'+signer.address.slice(-8).toLowerCase()};
}
