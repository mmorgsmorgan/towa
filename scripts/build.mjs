import { readFile, writeFile, copyFile, mkdir, access } from 'node:fs/promises';
import { build } from 'esbuild';
import { packageAgent } from './package-agent.mjs';
import { buildApi } from './build-api.mjs';
const root=new URL('../',import.meta.url);
await mkdir(new URL('dist/',root),{recursive:true});
await mkdir(new URL('legacy/',root),{recursive:true});
try{await access(new URL('legacy/index.html',root));}catch{await copyFile(new URL('dist/index.html',root),new URL('legacy/index.html',root));}
const original=await readFile(new URL('legacy/index.html',root),'utf8');
const art=original.match(/<svg id="tower-art"[\s\S]*?<\/svg>/)?.[0];
if(!art)throw new Error('Original Tower illustration is missing.');
await writeFile(new URL('dist/tower.svg',root),art.replace('<svg id="tower-art"','<svg xmlns="http://www.w3.org/2000/svg" id="tower-art"'));
await copyFile(new URL('web/index.html',root),new URL('dist/index.html',root));
await copyFile(new URL('web/tower.css',root),new URL('dist/tower.css',root));
await build({entryPoints:[new URL('web/tower.mjs',root).pathname],outfile:new URL('dist/tower.mjs',root).pathname,bundle:true,format:'esm',platform:'browser',target:'es2022',minify:true,external:['/wallet.mjs'],logLevel:'info'});
console.log('Built Towa’s public live view. Agent actions use the signed API and MCP.');
await buildApi();
await packageAgent();
