import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, open, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url)),data=new URL('../data/',import.meta.url);
await mkdir(data,{recursive:true,mode:0o700});
const enableMcp=process.argv.includes('--enable-mcp'),disableMcp=process.argv.includes('--disable-mcp');
if(enableMcp&&disableMcp)throw new Error('Choose one MCP state.');
if((enableMcp||disableMcp)&&!process.argv.includes('--restart'))throw new Error('Changing MCP state requires --restart.');
if(enableMcp)await unlink(new URL('mcp-disabled',data)).catch(error=>{if(error.code!=='ENOENT')throw error;});
if(disableMcp)await writeFile(new URL('mcp-disabled',data),'Hosted MCP disabled by operator at '+new Date().toISOString()+'\n',{mode:0o600});
const originIndex=process.argv.indexOf('--origin');
const origin=originIndex<0?'':process.argv[originIndex+1];
if(origin&&new URL(origin).protocol!=='https:')throw new Error('Public origin must use HTTPS.');
const pidFile=new URL('preview-process.json',data);
let old;
try{old=JSON.parse(await readFile(pidFile,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
if(old?.pid){
  try{
    const command=await readFile(`/proc/${old.pid}/cmdline`,'utf8');
    if(command.includes(root+'server.mjs')){
      if(!process.argv.includes('--restart')){console.log(JSON.stringify({running:true,pid:old.pid,url:old.origin||'http://127.0.0.1:4173'}));process.exit(0);}
      process.kill(old.pid,'SIGTERM');await new Promise(r=>setTimeout(r,1200));
    }
  }catch(error){if(!['ENOENT','ESRCH'].includes(error.code))throw error;}
}
const log=await open(new URL('server.log',data),'a',0o600);
const child=spawn(process.execPath,['--dns-result-order=ipv4first','--use-env-proxy',root+'server.mjs'],{cwd:root,env:{...process.env,...(origin?{TOWER_ORIGIN:origin}:{}),...(enableMcp?{TOWER_MCP_ENABLED:'1'}:disableMcp?{TOWER_MCP_ENABLED:'0'}:{})},detached:true,stdio:['ignore',log.fd,log.fd]});
child.unref();await log.close();
await writeFile(pidFile,JSON.stringify({pid:child.pid,origin,startedAt:new Date().toISOString()}),{mode:0o600});
console.log(JSON.stringify({started:true,pid:child.pid,url:origin||'http://127.0.0.1:4173'}));
