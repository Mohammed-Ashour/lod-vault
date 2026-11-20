import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {loadSharedStore}=require('../../tests/helpers/loaders.js');
const parser=loadSharedStore().context.LodVaultLensLookup;
import {studySeed} from '../../scripts/record-flows.mjs';
const root=process.cwd();
const source=await readFile(path.join(root,'scripts/record-phase3-flow.mjs'),'utf8');
const body=source.slice(source.indexOf('export function buildStub'),source.indexOf('// Marks a click')).replace('export ','');
const buildStub=Function(body+'; return buildStub;')();
const seed=studySeed({reviewsToday:0});
for(const id of ['HAUS1','FRA1','GOEN1','MAACHEN1','MANN1']) {
 const raw=JSON.parse(await readFile(path.join(root,'tests/fixtures/lod',id+'.json'),'utf8'));
 seed.local['lodVault.lx.'+id]=JSON.parse(JSON.stringify(parser.parseLexicon(raw.entry,{now:Date.now()})));
}
const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png'};
createServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://localhost');
 const name=url.pathname==='/'?'/media/social-2026-11-20/stage.html':url.pathname;
 const file=path.resolve(root,'.'+name);
 if(!file.startsWith(root+path.sep))throw new Error('path');
 let data=await readFile(file);
 if(name.endsWith('.html')&&name.startsWith('/pages/'))data=data.toString().replace('<head>','<head><script>'+buildStub(name.includes('stats.html')?studySeed():seed,{theme:'dark'})+'</script>');
 res.writeHead(200,{'Content-Type':mime[path.extname(name)]||'application/octet-stream'});res.end(data);
}catch(e){res.writeHead(404);res.end('Not found');}}).listen(9477,'127.0.0.1',()=>console.log('Social capture on 9477'));
