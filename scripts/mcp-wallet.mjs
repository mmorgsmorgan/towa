import { readFile, open, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { AgentClient } from '../lib/agent-client.mjs';
import { configuredSigner } from '../lib/signer.mjs';

// Optional local helper. Hosted Towa never imports this file or loads wallet keys.
const [command, ...args] = process.argv.slice(2);
const commands = { session: 2, 'sign-operation': 3, 'sign-enrollment': 2, sessions: 0, revoke: 1 };
if (!Object.hasOwn(commands, command) || args.length !== commands[command]) throw new Error('Usage: towa-wallet session OPTIONS.json PRIVATE-CONFIG.json | sign-operation OPERATION.json SAVED-INTENT.json SIGNED.json | sign-enrollment CHALLENGE.json SIGNED.json | sessions | revoke SESSION_ID');
if (!process.env.TOWER_URL) throw new Error('Set TOWER_URL to the exact Towa HTTPS origin.');
const identity = await configuredSigner(), client = new AgentClient({ origin: process.env.TOWER_URL, ...identity });
const readJson = async file => JSON.parse(await readFile(resolve(file),'utf8'));

async function privateOutput(filename, make) {
  const path = resolve(filename), file = await open(path,'wx',0o600);
  let complete = false;
  try {
    const { payload, summary } = await make();
    await file.writeFile(JSON.stringify(payload,null,2)+'\n'); await file.sync(); complete = true;
    return { file:path,...summary };
  } finally { await file.close(); if (!complete) await unlink(path); }
}

let result;
if (command === 'session') {
  const options = await readJson(args[0]);
  result = await privateOutput(args[1],async () => {
    const issued = await client.createMcpSession(options);
    return { payload: { mcpServers: { towa: { type:'http',url:client.origin+'/mcp',headers:{ Authorization:'Bearer '+issued.access_token } } } }, summary: { session:issued.session } };
  });
} else if (command === 'sign-operation') {
  const operation = await readJson(args[0]), intent = await readJson(args[1]);
  result = await privateOutput(args[2],async () => ({ payload:await client.signOperation(operation,intent),summary:{operationId:operation.id,submitted:false} }));
} else if (command === 'sign-enrollment') {
  const challenge = await readJson(args[0]);
  result = await privateOutput(args[1],async () => ({ payload:await client.signEnrollment(challenge.message),summary:{signed:true,submitted:false} }));
} else if (command === 'sessions') result = await client.mcpSessions();
else result = await client.revokeMcpSession(args[0]);
// The bearer and signed payload stay in private output files, not terminal logs.
process.stdout.write(JSON.stringify(result,null,2)+'\n');
