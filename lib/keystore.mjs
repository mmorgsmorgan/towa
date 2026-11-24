import { readFile, stat } from 'node:fs/promises';
import { Keyring } from '@polkadot/api';
import { cryptoWaitReady } from '@polkadot/util-crypto';

export async function loadKeystoreSigner(env=process.env){
  if(!env.TOWER_KEYSTORE||!env.TOWER_PASSWORD_FILE)throw new Error('Set TOWER_KEYSTORE and TOWER_PASSWORD_FILE to your existing encrypted wallet and its private password file.');
  await cryptoWaitReady();
  for(const file of [env.TOWER_KEYSTORE,env.TOWER_PASSWORD_FILE]){
    const info=await stat(file);
    if(!info.isFile()||(process.platform!=='win32'&&(info.mode&0o077)!==0))throw new Error('Keep the keystore and password in files readable only by your user (chmod 600).');
  }
  const json=JSON.parse(await readFile(env.TOWER_KEYSTORE,'utf8'));
  if(!json.encoded||!json.encoding?.type?.includes('scrypt'))throw new Error('Use an encrypted Polkadot JSON keystore.');
  const password=(await readFile(env.TOWER_PASSWORD_FILE,'utf8')).replace(/\r?\n$/,'');
  const signer=new Keyring({ss58Format:42}).addFromJson(json);
  try{signer.decodePkcs8(password);}catch{throw new Error('The local keystore could not be unlocked.');}
  return signer;
}
