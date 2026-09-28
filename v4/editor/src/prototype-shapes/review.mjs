// PROTOTYPE review sheet: renders eight views of a variant and prints the stats line
// (loose pieces, parts outside the rim). Run it after every chassis change.
//   npm run dev   (in v4/editor)
//   node src/prototype-shapes/review.mjs "variant=skeletyl&thumbs=none" ["variant=..." ...]
// Row 1: iso, front, back, left. Row 2: right, top, bottom and under-iso (both
// with the bottom plate hidden). Needs ImageMagick (`magick`) for the sheet.
// Env: REVIEW_URL (default http://127.0.0.1:5188), REVIEW_OUT (default the OS
// temp dir), CHROME (Chrome binary; defaults to the macOS install).
import {chromium} from 'playwright';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const url=process.env.REVIEW_URL||'http://127.0.0.1:5188',out=process.env.REVIEW_OUT||tmpdir();
const views={iso:'-150,-150,120',front:'-20,-220,50',back:'-20,220,70',left:'-220,-20,50',right:'220,-10,50',top:'-20,-21,250',bottom:'-20,-21,-250',underIso:'-130,-130,-110'};
const b=await chromium.launch({executablePath:process.env.CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const p=await b.newPage({viewport:{width:900,height:650}}),errs=[];p.on('pageerror',e=>errs.push(e.message));
for(const base of process.argv.slice(2)){const files=[],tag=base.replace(/[^a-z0-9]+/gi,'_');let stats='';
 for(const [name,cam] of Object.entries(views)){
  const plate=name==='bottom'||name==='underIso'?'&plate=0':'';
  await p.goto(`${url}/prototype-shapes.html?${base}&caps=0&cam=${cam}${plate}`);
  await p.waitForFunction(()=>!document.getElementById('stats').textContent.includes('Building'),null,{timeout:120000});
  stats=await p.textContent('#stats');
  await p.addStyleTag({content:'body > *:not(canvas){display:none!important}'});await p.waitForTimeout(300);
  const f=join(out,`rv_${tag}_${name}.png`);await p.screenshot({path:f});files.push(f);
 }
 const sheet=join(out,`review_${tag}.png`);
 execFileSync('magick',['(',...files.slice(0,4),'-resize','600x','+append',')','(',...files.slice(4),'-resize','600x','+append',')','-append',sheet]);
 console.log(base,'|',stats.split('·').slice(-1)[0].trim(),'|',sheet);
}
if(errs.length)console.log(errs.join('\n'));await b.close();
