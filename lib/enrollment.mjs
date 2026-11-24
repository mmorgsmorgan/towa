import { GENESIS, GATEWAY } from './config.mjs';
import { signatureVerify } from '@polkadot/util-crypto';
export function verifyEnrollmentSignature(message,signature,address,now=Date.now()) {
  validateEnrollment(message,address,now);
  if(typeof signature!=='string'||!/^0x[0-9a-fA-F]{128,132}$/.test(signature)||!signatureVerify(message,signature,address).isValid)throw new Error('The FLOP enrollment message must be signed locally by this agent’s wallet.');
}
export function validateEnrollment(message, address, now=Date.now()) {
  if (typeof message !== 'string') throw new Error('Missing gateway challenge.');
  const lines = message.split('\n');
  if (lines.length !== 8 || lines[0] !== `${new URL(GATEWAY).host} wants you to enroll a FLOP devnet gateway key with your account:` || lines[1] !== address || lines[2] !== '' || lines[3] !== 'Action: flop-devnet-enroll/v1' || lines[4] !== `Genesis: ${GENESIS}` || !/^Nonce: [0-9a-f]{64}$/.test(lines[5])) throw new Error('Unrecognized gateway enrollment challenge.');
  const issued=Date.parse(lines[6].replace('Issued At: ',''));
  const expires=Date.parse(lines[7].replace('Expiration Time: ',''));
  if (!Number.isFinite(issued)||!Number.isFinite(expires)||issued>now+5000||expires<=now||expires-issued>300000) throw new Error('Invalid gateway challenge lifetime.');
  return message;
}
