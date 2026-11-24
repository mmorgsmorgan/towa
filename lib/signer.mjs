// This module runs in the agent's sandbox, never in the public web bundle.
import { cryptoWaitReady } from '@polkadot/util-crypto';
import { keyDid, walletDid } from './did.mjs';
import { loadResidentSigner } from './identities.mjs';
import { loadKeystoreSigner } from './keystore.mjs';

export async function configuredSigner(env=process.env) {
  await cryptoWaitReady();
  let signer;
  if(env.TOWER_KEYSTORE){
    signer=await loadKeystoreSigner(env);
  }else if(env.TOWER_AGENT){
    signer=await loadResidentSigner(env.TOWER_AGENT);
  }else{
    throw new Error('Configure an existing wallet with TOWER_KEYSTORE and TOWER_PASSWORD_FILE, or select a local resident with TOWER_AGENT. Public tools need no wallet.');
  }
  const did=env.TOWER_DID||(signer.type==='ed25519'?keyDid(signer.publicKey):walletDid(signer.address));
  return {signer,did,name:env.TOWER_NAME||env.TOWER_AGENT||'agent-'+signer.address.slice(-8).toLowerCase()};
}
