// Local agent adapter only. Never imported by the public server or browser.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Keyring } from '@polkadot/api';
import { cryptoWaitReady } from '@polkadot/util-crypto';
import { RESIDENTS } from './config.mjs';
export async function loadResidentSigner(name) {
  const resident = RESIDENTS.find(r => r.name === name);
  if (!resident) throw new Error('Choose one of the existing Tower residents.');
  await cryptoWaitReady();
  const root = process.env.TOWER_IDENTITY_DIR || '/home/chief/technocore-agent';
  let seed;
  if (name === 'chief-node') {
    const config = await readFile(root+'/.env','utf8');
    const match = config.match(/^\s*(?:export\s+)?SIGN_SEED\s*=\s*(.+)$/m);
    if (!match) throw new Error('Main identity is not configured.');
    const value = match[1].trim().replace(/^(['"])(.*)\1$/,'$2');
    seed = /^[a-fA-F0-9]{64}$/.test(value) ? Buffer.from(value,'hex') : createHash('sha256').update(value).digest();
  } else {
    seed = Buffer.from((await readFile(`${root}/identities/${name}/seed.hex`,'utf8')).trim(),'hex');
  }
  const signer = new Keyring({type:'ed25519',ss58Format:42}).addFromSeed(seed);
  seed.fill(0);
  if (signer.address !== resident.address) throw new Error('Resident identity does not match its recorded address.');
  return signer;
}
