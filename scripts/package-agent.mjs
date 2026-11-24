import { mkdtemp, mkdir, readFile, writeFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';

export async function packageAgent(){
  const root=fileURLToPath(new URL('../',import.meta.url));
  const project=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
  const temporary=await mkdtemp(join(tmpdir(),'towa-package-'));
  const directory=join(temporary,'package'),downloads=join(root,'dist','downloads');
  await mkdir(directory);await mkdir(downloads,{recursive:true});
  try{
    const options={bundle:true,format:'esm',platform:'node',target:'node24',packages:'external',logLevel:'silent'};
    const walletOnly={
      name:'portable-wallet-only',
      setup(builder){builder.onResolve({filter:/signer\.mjs$/},args=>args.path==='../lib/signer.mjs'?{path:join(root,'lib','portable-signer.mjs')}:undefined);},
    };
    await build({...options,entryPoints:[join(root,'scripts','mcp.mjs')],outfile:join(directory,'mcp.mjs'),plugins:[walletOnly]});
    await build({...options,entryPoints:[join(root,'scripts','mcp-wallet.mjs')],outfile:join(directory,'wallet.mjs'),plugins:[walletOnly]});
    await build({...options,entryPoints:[join(root,'lib','agent-client.mjs')],outfile:join(directory,'client.mjs')});
    await writeFile(join(directory,'bin.mjs'),`#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const script=process.argv[1].endsWith('wallet-bin.mjs')||process.argv[1].endsWith('towa-wallet')?'wallet.mjs':'mcp.mjs';
const child=spawn(process.execPath,['--dns-result-order=ipv4first','--use-env-proxy',fileURLToPath(new URL('./'+script,import.meta.url)),...process.argv.slice(2)],{stdio:'inherit'});
child.on('error',error=>{process.stderr.write(error.message+'\\n');process.exitCode=1;});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
child.on('exit',(code,signal)=>{process.exitCode=code??(signal?1:0);});
`);
    await chmod(join(directory,'bin.mjs'),0o755);
    await writeFile(join(directory,'wallet-bin.mjs'),await readFile(join(directory,'bin.mjs')));
    await chmod(join(directory,'wallet-bin.mjs'),0o755);
    await writeFile(join(directory,'package.json'),JSON.stringify({
      name:'towa-agent',version:project.version,private:true,type:'module',
      description:'Local wallet helper, optional stdio MCP, and SDK for hosted Towa. Keys stay in the agent sandbox.',
      engines:{node:'>=24.5.0'},bin:{'towa-mcp':'./bin.mjs','towa-wallet':'./wallet-bin.mjs'},exports:{'.':'./client.mjs'},
      files:['bin.mjs','wallet-bin.mjs','wallet.mjs','mcp.mjs','client.mjs','README.md'],
      dependencies:Object.fromEntries(Object.entries(project.dependencies).filter(([name])=>name.startsWith('@polkadot/'))),
    },null,2)+'\n');
    await writeFile(join(directory,'README.md'),`# Towa agent\n\nInstall this archive with Node 24.5 or later: \`npm install --global ./towa-agent-${project.version}.tgz\`. Run \`towa-mcp\` as an MCP stdio server.\n\nSet \`TOWER_URL\` to the HTTPS Towa origin, \`TOWER_KEYSTORE\` to an existing encrypted Polkadot JSON wallet, and \`TOWER_PASSWORD_FILE\` to its local password file. Both files must be private (mode 600 on Unix). Optional: \`TOWER_NAME\`, \`TOWER_DID\`. No keys are included or uploaded.\n\nRead \`/agent.md\`, \`/openapi.json\`, and \`/.well-known/agent-card.json\` on that origin for the protocol and tools. Public \`tower_state\` requires no wallet.\n\nOffers target one individual NFT by \`itemId\`. Both earned points and FLOP are required. Points are reserved, then burned on a completed purchase; FLOP pays 93% to the seller, 5% to the original creator and 2% to Towa. FLOP stays in the bidder’s wallet until payment, so a checked offer is not escrow.\n\nFor the JavaScript SDK, import \`{ AgentClient }\` from \`towa-agent\`. Preserve each request ID through retries and reconcile uncertain payments.\n`);
    await writeFile(join(directory,'README.md'),await readFile(new URL('../docs/agent.md',import.meta.url),'utf8'));
    const result=JSON.parse(execFileSync('npm',['pack','--offline','--ignore-scripts','--json','--pack-destination',downloads],{cwd:directory,encoding:'utf8',env:{...process.env,npm_config_cache:join(temporary,'npm-cache')},timeout:60000}));
    const filename=result[0].filename;
    const checksum=createHash('sha256').update(await readFile(join(downloads,filename))).digest('hex');
    await writeFile(join(downloads,filename+'.sha256'),checksum+'  '+filename+'\n');
    console.log(`Built ${filename} (${result[0].size} bytes), with SHA-256 checksum.`);
  }finally{await rm(temporary,{recursive:true,force:true});}
}
