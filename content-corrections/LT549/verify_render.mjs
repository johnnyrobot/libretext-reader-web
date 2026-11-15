// Native, loopback-only semantic evidence. No AT, catalog admission or source edits.
import { chromium, firefox, webkit } from '@playwright/test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { createHash } from 'node:crypto';
import { evidenceDirectory, localResourceFailures } from './render_checks.mjs';
const { values } = parseArgs({ options: { before: {type:'string'}, after:{type:'string'}, base:{type:'string'}, output:{type:'string'} } });
for (const key of ['before','after','base','output']) if (!values[key]) throw Error('--'+key+' required');
const base = new URL(values.base);
if (!['127.0.0.1','localhost'].includes(base.hostname)) throw Error('Only an isolated loopback stage is permitted');
const bundle = JSON.parse(await readFile(new URL('./bundle.json',import.meta.url)));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
values.output = await evidenceDirectory(values.before, values.after, values.output);
await mkdir(values.output); // Refuse an existing evidence directory.
const results=[];
const inspect = () => {
  const tables=[...document.querySelectorAll('table')].map(table=>({
    text: table.textContent.replace(/[\s\u00a0]/g,''),
    rows:[...table.rows].map(row=>[...row.cells].map(cell=>{
      const r=cell.getBoundingClientRect(),s=getComputedStyle(cell);
      return {tag:cell.tagName,scope:cell.scope,id:cell.id,headers:cell.headers,
        headerRefs:cell.headers.split(/\s+/).filter(Boolean).map(id=>{
          const nodes=[...document.querySelectorAll('[id]')].filter(e=>e.id===id);
          return {id,count:nodes.length,text:nodes[0]?.textContent,table:nodes[0]?.closest('table')===table};
        }),text:cell.textContent,span:cell.colSpan,style:{weight:s.fontWeight,align:s.textAlign},
        rect:{left:r.left,right:r.right,top:r.top,bottom:r.bottom}};
    }))
  }));
  return {tables,iframes:[...document.querySelectorAll('iframe')].map(e=>({src:e.getAttribute('src'),title:e.title})),
    images:[...document.querySelectorAll('img')].map(e=>({src:e.getAttribute('src'),alt:e.getAttribute('alt'),link:e.closest('a')?.textContent})),
    ids:[...document.querySelectorAll('[id]')].map(e=>e.id)};
};
for(const [engine,type] of [['Chromium',chromium],['Firefox',firefox],['WebKit',webkit]]) {
 const browser=await type.launch();
 try {
  for(const page of bundle.pages) {
   const states={};const failures=[];
   for(const mode of ['before','after']) {
    const raw=await readFile(join(values[mode],page.path));
    if(sha(raw)!==page[mode+'Sha256']) throw Error('Native input drift '+page.path);
    const p=await browser.newPage({viewport:{width:1280,height:900}});p.setDefaultTimeout(10000);
    const url=new URL(page.path.replace(/index\.html$/,''),base).href;
    const missing=[],blocked=[];
    await p.route('**/*', async route=>{
      const request=route.request(),u=new URL(request.url());
      if(u.origin!==base.origin){blocked.push(u.origin);return route.abort()}
      if(request.isNavigationRequest()&&request.frame()===p.mainFrame()) {
        const response=await route.fetch();return route.fulfill({response,body:raw.toString('utf8')});
      }
      return route.continue();
    });
    p.on('response',r=>{if(r.status()>=400)missing.push({url:r.url(),status:r.status()})});
    await p.goto(url,{waitUntil:'domcontentloaded'});
    const expectsMathJax=/<script[^>]+src=["'][^"']*mathjax/i.test(raw.toString('utf8'));
    if(expectsMathJax) await p.waitForFunction(()=>window.MathJax?.startup?.document,{},{timeout:10000});
    await p.evaluate(async()=>{if(window.MathJax?.startup?.promise)await window.MathJax.startup.promise;});
    // The source-order comparison uses the native inert parser, before MathJax
    // replaces formula markup. Rendered roles/geometry below use the live page.
    const sourceOrder=await p.evaluate(html=>{
      const d=new DOMParser().parseFromString(html,'text/html');
      return [...d.querySelectorAll('table')].map(e=>e.textContent.replace(/[\s\u00a0]/g,''));
    },raw.toString('utf8'));
    const native=await p.evaluate(inspect);
    const targets=[...new Set(page.edits.filter(e=>e.kind==='cell'||e.kind==='rowcells').map(e=>e.target.table))];
    const snapshots={};for(const table of targets)snapshots[table]=await p.locator('table').nth(table-1).ariaSnapshot();
    states[mode]={...native,sourceOrder,snapshots,missing,mathjaxExpected:expectsMathJax,blockedOrigins:[...new Set(blocked)]};
    if(mode==='after') {
      // Responsive coverage verifies geometry/scroll containers; no touch or AT claim.
      await p.setViewportSize({width:320,height:800});
      states[mode].narrow=await p.locator('table').evaluateAll(tables=>tables.map(t=>{
        const r=t.getBoundingClientRect(),parent=t.parentElement;
        return {width:r.width,scrollWidth:t.scrollWidth,parentWidth:parent.clientWidth,parentScrollWidth:parent.scrollWidth,overflow:getComputedStyle(parent).overflowX};
      }));
      if(targets.length) {
        await p.locator('table').nth(targets[0]-1).scrollIntoViewIfNeeded();
        await p.screenshot({path:join(values.output,engine+'-'+results.length+'.png')});
      }
    }
    await p.close();
   }
   const before=states.before,after=states.after;
   failures.push(...localResourceFailures(states));
   if(JSON.stringify(before.sourceOrder)!==JSON.stringify(after.sourceOrder))failures.push('Table scientific text/order changed');
   for(const edit of page.edits) {
    const t=edit.target;
    if(edit.kind==='cell') {
      const cell=after.tables[t.table-1].rows[t.row-1][t.column-1];
      if(/<th\b/.test(edit.after)&&cell.tag!=='TH')failures.push(edit.id+':missing native header');
      const scope=edit.after.match(/scope="(row|col)"/)?.[1];
      if(scope&&cell.scope!==scope)failures.push(edit.id+':scope mismatch');
      const rows=after.tables[t.table-1].rows;
      if(scope==='col')for(const row of rows.slice(t.row)) {
        const other=row[t.column-1];
        if(row.length===rows[t.row-1].length&&cell.span===1&&other?.span===1&&
          (Math.abs(cell.rect.left-other.rect.left)>1||Math.abs(cell.rect.right-other.rect.right)>1))failures.push(edit.id+':rendered column association misaligned');
      }
      if(scope==='row'&&rows[t.row-1].slice(t.column).some(c=>c.rect.left<cell.rect.right-1))failures.push(edit.id+':rendered row order overlap');
      const role=scope==='row'?'rowheader':scope==='col'?'columnheader':null;
      if(role&&!after.snapshots[t.table].includes(role))failures.push(edit.id+':native role absent');
      if(cell.headerRefs.some(r=>r.count!==1||!r.table))failures.push(edit.id+':invalid header reference');
      if(cell.id&&after.ids.filter(id=>id===cell.id).length!==1)failures.push(edit.id+':duplicate header id');
    } else if(edit.kind==='rowcells') {
      const row=after.tables[t.table-1].rows[t.row-1];
      if(row.length!==2||row[0].tag!=='TH'||row[0].scope!=='row'||row[0].span!==4)failures.push(edit.id+':reaction grouping absent');
    } else if(edit.kind==='element'&&t.tag==='iframe') {
      if(after.iframes[t.index-1].title!==edit.after.match(/title="([^"]*)"/)?.[1]||after.iframes[t.index-1].src!==before.iframes[t.index-1].src)failures.push(edit.id+':frame name/URL');
    } else if(edit.kind==='element'&&t.tag==='img'&&!edit.after) {
      if(JSON.stringify(before.images.filter((_,i)=>i!==t.index-1))!==JSON.stringify(after.images))failures.push(edit.id+':removal altered another image');
    } else if(edit.kind==='element'&&t.tag==='img'&&edit.after) {
      const alt=edit.after.match(/alt="([^"]*)"/)?.[1];
      if(after.images[t.index-1].alt!==alt)failures.push(edit.id+':image name mismatch');
      if(alt===''&&!after.images[t.index-1].link?.trim())failures.push(edit.id+':unnamed navigation link');
    }
   }
   results.push({engine,version:browser.version(),page:page.path,result:failures.length?'FAIL':'PASS',failures,states});
   console.log(engine,page.path,failures.length?'FAIL':'PASS');
  }
 } finally {await browser.close()}
}
await writeFile(join(values.output,'native-render.json'),JSON.stringify({scope:'Native rendered roles/header references/geometry and inert-source order; not audible AT or full layout acceptance',results},null,2)+'\n');
if(results.some(r=>r.result==='FAIL'))process.exitCode=1;
