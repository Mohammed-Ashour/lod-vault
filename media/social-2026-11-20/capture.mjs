import {spawn,spawnSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
const out=path.resolve('media/social-2026-11-20');mkdirSync(out+'/frames',{recursive:true});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const server=spawn(process.execPath,['media/social-2026-11-20/serve.mjs'],{stdio:'ignore'});
const chrome=spawn('/usr/bin/chromium',['--headless=new','--disable-gpu','--hide-scrollbars','--mute-audio','--remote-debugging-port=9368','--user-data-dir=/tmp/lod-social-chromium','about:blank'],{stdio:'ignore'});
let ws;
try{
 let tab;for(let i=0;i<30;i++){try{tab=await (await fetch('http://127.0.0.1:9368/json/new?about:blank',{method:'PUT'})).json();break;}catch{await sleep(250)}}
 ws=new WebSocket(tab.webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r));
 const pending=new Map();let id=0;ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id&&pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(m.error):p.resolve(m.result)}});
 const send=(method,params={})=>new Promise((resolve,reject)=>{pending.set(++id,{resolve,reject});ws.send(JSON.stringify({id,method,params}))});
 await send('Page.enable');await send('Runtime.enable');await send('Emulation.setDeviceMetricsOverride',{width:1080,height:1350,deviceScaleFactor:1,mobile:false});await send('Page.navigate',{url:'http://127.0.0.1:9477/'});await sleep(1600);
 const shot=async()=>Buffer.from((await send('Page.captureScreenshot',{format:'jpeg',quality:92,fromSurface:true})).data,'base64');
 writeFileSync(out+'/poster.jpg',await shot());
 if(process.argv.includes('--poster'))process.exitCode=0;
 else{
  let done=false,problem;const started=Date.now();const run=send('Runtime.evaluate',{expression:'window.play()',awaitPromise:true,returnByValue:true}).then(r=>{if(r.exceptionDetails)problem=r.exceptionDetails;done=true});
  const frames=[];while(!done){const at=Date.now();const name=`frames/frame-${String(frames.length).padStart(5,'0')}.jpg`;writeFileSync(out+'/'+name,await shot());frames.push({name,time:(Date.now()-started)/1000});await sleep(Math.max(0,100-(Date.now()-at)))}await run;
  if(problem)throw Error(JSON.stringify(problem));
  writeFileSync(out+'/frames.txt',frames.map((f,i)=>`file '${f.name}'\nduration ${i<frames.length-1?Math.max(.01,frames[i+1].time-f.time):.1}`).join('\n')+`\nfile '${frames.at(-1).name}'\n`);
  console.log('Captured',frames.length,'frames in',(Date.now()-started)/1000,'seconds');
  const ff=spawnSync('ffmpeg',['-y','-loglevel','error','-f','concat','-safe','0','-i',out+'/frames.txt','-vf','fps=30,format=yuv420p','-c:v','libx264','-preset','medium','-crf','19','-movflags','+faststart',out+'/lodvault-study-update.mp4'],{stdio:'inherit'});if(ff.status)throw Error('encoding failed');
 }
}finally{ws?.close();chrome.kill();server.kill()}
