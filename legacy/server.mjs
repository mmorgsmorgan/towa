import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../dist/',import.meta.url));
let pending;
const server=http.createServer(async(req,res)=>{
 const json=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data))};
 if(!['127.0.0.1:4173','localhost:4173'].includes(req.headers.host)){json(403,{message:'Local access only.'});return}
 if(req.url==='/api/devnet-probe'){
 if(req.method!=='POST'||req.headers['x-tower-request']!=='probe'||(req.headers.origin&&!['http://localhost:4173','http://127.0.0.1:4173'].includes(req.headers.origin))){json(403,{message:'Use the local forge page.'});return}
 if(!pending)pending=new Promise(resolve=>execFile(process.execPath,['/home/chief/technocore-agent/sdk-runtime/run-tower-inference.mjs'],{timeout:130000,maxBuffer:1024*1024},(error,out)=>{let data;try{data=JSON.parse(out)}catch{data={}}resolve({message:error?`Devnet request did not complete: ${data.body?.error?.message||'gateway unavailable'}. No points awarded.`:'Live inference returned. Settlement verification is pending; no points awarded. The response is saved privately.'})})).finally(()=>{pending=null});
 json(200,await pending);return}
 if(req.method!=='GET'){res.writeHead(405);res.end();return}
 const path=req.url.split('?')[0];const name=path==='/'?'index.html':path.slice(1);
 if(!/^[a-zA-Z0-9_-]+\.(html|css|js|mjs)$/.test(name)){res.writeHead(404);res.end();return}
 try{const data=await readFile(root+name);res.writeHead(200,{'Content-Type':name.endsWith('html')?'text/html':name.endsWith('css')?'text/css':'text/javascript','Cache-Control':'no-store'});res.end(data)}catch{res.writeHead(404);res.end()}
});server.listen(4173,'127.0.0.1',()=>console.log('Tower: http://localhost:4173/forge.html'));
