import { spawn, execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir, open, chmod } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

// Exposes only the app's existing public/signed routes. No static workspace serving.
const root=fileURLToPath(new URL('../',import.meta.url)),data=join(root,'data');
const [binaryArgument,expectedHash]=process.argv.slice(2);
if(!binaryArgument||!/^[0-9a-f]{64}$/.test(expectedHash||''))throw new Error('Supply the cloudflared executable and its official SHA-256 digest.');
const binary=resolve(binaryArgument),actualHash=createHash('sha256').update(await readFile(binary)).digest('hex');
if(actualHash!==expectedHash)throw new Error('The cloudflared binary does not match the official release digest.');
await mkdir(data,{recursive:true,mode:0o700});
const recordFile=join(data,'tunnel-process.json'),logFile=join(data,'tunnel.log');
let record;
try{
  const prior=JSON.parse(await readFile(recordFile,'utf8'));
  const command=await readFile(`/proc/${prior.pid}/cmdline`,'utf8');
  if(command.includes(binary)&&/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(prior.origin)){
    if(process.argv.includes('--renew')){
      process.kill(prior.pid,'SIGTERM');
      await new Promise(resolve=>setTimeout(resolve,1000));
    }else record=prior;
  }
}catch(error){if(!['ENOENT','ESRCH'].includes(error.code))throw error;}
if(!record){
  await chmod(binary,0o700);
  const log=await open(logFile,'w',0o600);
  const child=spawn(binary,['tunnel','--url','http://127.0.0.1:4173','--protocol','http2','--no-autoupdate','--metrics','127.0.0.1:0'],{cwd:root,detached:true,stdio:['ignore',log.fd,log.fd]});
  let spawnError;child.on('error',error=>{spawnError=error;});child.unref();await log.close();
  const deadline=Date.now()+45000;
  while(Date.now()<deadline){
    if(spawnError)throw spawnError;
    const output=await readFile(logFile,'utf8');
    const origin=output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com\b/)?.[0];
    if(origin){record={pid:child.pid,origin,binary,startedAt:new Date().toISOString()};break;}
    if(child.exitCode!==null)throw new Error('The preview tunnel exited before creating a URL. Inspect data/tunnel.log.');
    await new Promise(resolve=>setTimeout(resolve,500));
  }
  if(!record){child.kill('SIGTERM');throw new Error('The preview tunnel did not obtain a URL before the deadline.');}
  await writeFile(recordFile,JSON.stringify(record,null,2)+'\n',{mode:0o600});
}
const backend=JSON.parse(execFileSync(process.execPath,[join(root,'scripts','preview.mjs'),'--restart','--origin',record.origin],{cwd:root,encoding:'utf8',timeout:15000}));
const report={origin:record.origin,startedAt:record.startedAt,publicWithoutSignIn:true,mode:'temporary Cloudflare tunnel; requires this machine and both processes to stay running'};
await writeFile(join(root,'outputs','preview.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({...report,backendPid:backend.pid},null,2));
