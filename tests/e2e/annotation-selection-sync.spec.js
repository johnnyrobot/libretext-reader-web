import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
// LT-560: a new text selection made with a real pointer while the annotation panel is
// open must replace the "Selected passage" quotation, and what is saved or posted must
// be anchored to that new selection. Every selection here is an actual mouse
// down/move/up; nothing writes to the Selection API.
const path='/social_psychology/13%3A_Competition_and_Cooperation_in_Our_Social_Worlds/13.01%3A_Conflict_Cooperation_Morality_and_Fairness/';
const credentialsFile=process.env.SR_CREDENTIALS_FILE;
test.skip(!credentialsFile,'Designated isolated synthetic credentials required');
test.use({screenshot:'off',trace:'off',video:'off'});
const A={block:'p-0',quote:'we cooperate'};
const SAME={block:'p-0',quote:'human behaviors'};
const OTHER={block:'p-1',quote:'between groups'};
const passage=page=>page.getByRole('blockquote',{name:'Selected passage',exact:true});
const quick=page=>page.locator('#sr-quick-actions');

// One real login per actor per worker: the local backend rate-limits /login, and this
// file now signs in more often than the limit allows. Later tests reuse the session cookie.
const sessions=new Map();
async function signIn(page,actor='alice'){
 if(sessions.has(actor)){
  await page.context().addCookies(sessions.get(actor));
  await page.goto(path);
  return;
 }
 const credentials=JSON.parse(readFileSync(credentialsFile,'utf8'));
 await page.goto(path);
 const response=await page.request.post('/social-reading/api/login',{headers:{Origin:new URL(page.url()).origin},data:{username:actor,password:credentials[actor]}});
 expect(response.status()).toBe(200);
 sessions.set(actor,await page.context().cookies());
 await page.reload();
}
// Real pointer drag over `quote` inside the paragraph for manifest block `block`.
async function drag(page,{block,quote}){
 const points=await page.evaluate(({block,quote})=>{
  const paragraph=document.querySelectorAll('main p')[Number(block.slice(2))];
  paragraph.scrollIntoView({block:'center'});
  const text=document.createTreeWalker(paragraph,NodeFilter.SHOW_TEXT).nextNode();
  const offset=text.data.indexOf(quote);
  if(offset<0)throw Error('fixture quote not in first text node: '+quote);
  const measurement=document.createRange();measurement.setStart(text,offset);measurement.setEnd(text,offset+quote.length);
  const rects=measurement.getClientRects();if(rects.length!==1)throw Error('quote wraps lines: '+quote);
  const r=rects[0],y=r.top+r.height/2,start={x:r.left+0.2,y},end={x:r.right+0.2,y};
  // Precondition: the pointer lands on the reading text, not on the panel or quick actions.
  for(const p of [start,{x:r.right-0.5,y}])if(!paragraph.contains(document.elementFromPoint(p.x,p.y)))throw Error('reading text is covered at drag point for '+quote);
  return {start,end};
 },{block,quote});
 await page.mouse.move(points.start.x,points.start.y);await page.mouse.down();
 await page.mouse.move(points.end.x,points.end.y,{steps:20});await page.mouse.up();
 // Precondition: the browser's own selection is exactly the intended text.
 await expect.poll(()=>page.evaluate(()=>getSelection().toString().replace(/\s+/g,' ').trim()),{message:'precondition: native pointer selection',timeout:5000}).toBe(quote);
}
// Open the panel for the current selection through the floating action.
async function openWith(page,action,quote){
 await quick(page).getByRole('button',{name:action,exact:true}).click();
 await expect(passage(page)).toHaveText(quote);
 // Let sign-in, thread and mark loading settle so a later drag measures the final DOM.
 await page.waitForLoadState('networkidle');
}
// Chief decision: the open panel must follow the new selection on its own. No
// floating-action fallback is accepted, and the floating action must not be needed.
async function adopt(page,quote){
 await expect(passage(page),'Selected passage must update automatically to the newly highlighted text').toHaveText(quote,{timeout:5000});
 const exact=await page.locator('#sr-panel').getByLabel('Exact quote (optional)',{exact:true}).inputValue({timeout:5000});
 expect(['',quote],'Exact quote input must not keep a stale quotation').toContain(exact);
}
async function search(page,nonce){
 const manifest=await page.locator('#sr-page-context').evaluate(node=>JSON.parse(node.textContent));
 return (await page.request.get('/social-reading/api/annotation-search?'+new URLSearchParams({book:manifest.book,page:manifest.page,q:nonce}))).json();
}

for(const [name,target] of [['same paragraph',SAME],['other supported paragraph',OTHER]]){
 test(`Highlight: new pointer selection in the ${name} replaces the quotation and is what gets saved`,async({page,browserName})=>{
  await signIn(page);
  await drag(page,A);await openWith(page,'Highlight',A.quote);
  await drag(page,target);await adopt(page,target.quote);
  const nonce=`lt560-h-${target.block}-${browserName}-${Date.now()}`;
  await page.getByText('Add a personal note or topics',{exact:true}).click();
  await page.getByRole('textbox',{name:'Personal note (optional)',exact:true}).fill('Selection sync '+nonce);
  await page.getByRole('button',{name:'Save highlight',exact:true}).click();
  await expect(page.locator('#sr-highlight-list')).toContainText(nonce);
  const found=await search(page,nonce);
  expect(found.highlights).toHaveLength(1);
  expect(found.highlights[0].anchor.block).toBe(target.block);
  expect(found.highlights[0].anchor.selector.quote).toBe(target.quote);
 });
 test(`Discuss: new pointer selection in the ${name} replaces the quotation and is what gets posted`,async({page,browserName})=>{
  await signIn(page);
  await drag(page,A);await openWith(page,'Discuss',A.quote);
  await drag(page,target);await adopt(page,target.quote);
  const nonce=`lt560-d-${target.block}-${browserName}-${Date.now()}`;
  await page.getByRole('textbox',{name:'Your question',exact:true}).fill('Selection sync question '+nonce);
  await page.getByRole('button',{name:'Post question',exact:true}).click();
  await expect(page.locator('.sr-thread').filter({hasText:nonce})).toContainText(target.quote);
  const found=await search(page,nonce);
  expect(found.threads).toHaveLength(1);
  expect(found.threads[0].anchor.block).toBe(target.block);
  expect(found.threads[0].anchor.selector.quote).toBe(target.quote);
 });
}

test('drafts follow the passage across pointer reselection',async({page})=>{
 await signIn(page);
 await drag(page,A);await openWith(page,'Discuss',A.quote);
 const question=page.getByRole('textbox',{name:'Your question',exact:true});
 await question.fill('Draft for passage A');
 await drag(page,OTHER);await adopt(page,OTHER.quote);
 await expect(question).toHaveValue('');
 await drag(page,A);await adopt(page,A.quote);
 await expect(question).toHaveValue('Draft for passage A');
});

test('selecting text inside the open panel does not replace the quotation (guard)',async({page})=>{
 await signIn(page);
 await drag(page,A);await openWith(page,'Highlight',A.quote);
 // Drag across the panel's own copy of the quotation: panel text, not reading text.
 const box=await passage(page).evaluate(node=>{node.scrollIntoView({block:'center'});const r=node.getBoundingClientRect();
  const y=r.top+r.height/2,start={x:r.left+2,y},end={x:r.right-2,y};
  for(const p of [start,end])if(!node.contains(document.elementFromPoint(p.x,p.y)))throw Error('panel quotation not reachable');
  return {start,end};});
 await page.mouse.move(box.start.x,box.start.y);await page.mouse.down();
 await page.mouse.move(box.end.x,box.end.y,{steps:20});await page.mouse.up();
 await expect.poll(()=>page.evaluate(()=>getSelection().toString().length),{timeout:5000}).toBeGreaterThan(0);
 await page.waitForTimeout(300);
 await expect(passage(page)).toHaveText(A.quote);
 await expect(quick(page)).toBeHidden();
});

test('a pending submission keeps its passage when the reader selects elsewhere (guard)',async({page,browserName})=>{
 await signIn(page);
 await drag(page,A);await openWith(page,'Discuss',A.quote);
 let release;const held=new Promise(resolve=>{release=resolve;});
 await page.route('**/social-reading/api/commands',async route=>{if(route.request().method()==='POST')await held;await route.continue();});
 const nonce=`lt560-p-${browserName}-${Date.now()}`;
 await page.getByRole('textbox',{name:'Your question',exact:true}).fill('Pending question '+nonce);
 await page.getByRole('button',{name:'Post question',exact:true}).click();
 await drag(page,OTHER);
 await page.waitForTimeout(300);
 await expect(passage(page)).toHaveText(A.quote);
 release();
 await expect(page.locator('.sr-thread').filter({hasText:nonce})).toContainText(A.quote);
 const found=await search(page,nonce);
 expect(found.threads).toHaveLength(1);
 expect(found.threads[0].anchor.selector.quote).toBe(A.quote);
});

// ---- Extended LT-560 coverage (QA). Same rules: real pointer or keyboard input only.
const panelBox=(page,name)=>page.locator('#sr-panel').getByRole('textbox',{name,exact:true}).filter({visible:true});
const statusLine=page=>page.locator('#sr-panel [role="status"]');
const UNCHANGED='Check the pending operation before changing passages. The current passage is unchanged.';
// Real pointer drag from the start of `from.quote` in its paragraph to the end of `to.quote` in another.
async function dragAcross(page,from,to){
 await page.evaluate(block=>{document.querySelectorAll('main p')[Number(block.slice(2))].scrollIntoView({block:'center',behavior:'instant'});},from.block);
 await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 const points=await page.evaluate(({from,to})=>{
  const at=({block,quote},end)=>{const p=document.querySelectorAll('main p')[Number(block.slice(2))];
   const t=document.createTreeWalker(p,NodeFilter.SHOW_TEXT).nextNode();const o=t.data.indexOf(quote);
   const r=document.createRange();r.setStart(t,o);r.setEnd(t,o+quote.length);const b=r.getClientRects()[0];
   const pt=end?{x:b.right-0.5,y:b.top+b.height/2}:{x:b.left+0.2,y:b.top+b.height/2};
   if(!p.contains(document.elementFromPoint(pt.x,pt.y)))throw Error('reading text is covered for '+quote);
   // Stay clear of the viewport edges so the browser does not auto-scroll mid-drag.
   if(pt.y<60||pt.y>innerHeight-60)throw Error('drag point too close to the viewport edge for '+quote);return pt;};
  return {start:at(from,false),end:at(to,true)};
 },{from,to});
 await page.mouse.move(points.start.x,points.start.y);await page.mouse.down();
 await page.mouse.move(points.end.x,points.end.y,{steps:30});await page.mouse.up();
 await expect.poll(()=>page.evaluate(()=>{const r=getSelection().rangeCount&&getSelection().getRangeAt(0);
  const ps=[...document.querySelectorAll('main p')],el=n=>n.nodeType===1?n:n.parentElement;
  return r?[ps.indexOf(el(r.startContainer).closest('p')),ps.indexOf(el(r.endContainer).closest('p'))].join('->'):'none';}),{message:'precondition: selection spans the two paragraphs',timeout:5000}).toBe(`${from.block.slice(2)}->${to.block.slice(2)}`);
}

test('Discuss drafts (question and course topics) follow the passage A -> B -> A',async({page})=>{
 await signIn(page);
 await drag(page,A);await openWith(page,'Discuss',A.quote);
 await page.locator('#sr-panel').getByText('Add topics',{exact:true}).click();
 await panelBox(page,'Your question').fill('Question for A');
 await panelBox(page,'Topics (optional, comma separated)').fill('topic-a');
 await drag(page,OTHER);await adopt(page,OTHER.quote);
 await expect(panelBox(page,'Your question')).toHaveValue('');
 await expect(panelBox(page,'Topics (optional, comma separated)')).toHaveValue('');
 await panelBox(page,'Your question').fill('Question for B');
 await drag(page,A);await adopt(page,A.quote);
 await expect(panelBox(page,'Your question')).toHaveValue('Question for A');
 await expect(panelBox(page,'Topics (optional, comma separated)')).toHaveValue('topic-a');
 await drag(page,OTHER);await adopt(page,OTHER.quote);
 await expect(panelBox(page,'Your question')).toHaveValue('Question for B');
});

test('Highlight drafts (personal note and topics) follow the passage A -> B -> A',async({page})=>{
 await signIn(page);
 await drag(page,A);await openWith(page,'Highlight',A.quote);
 await page.getByText('Add a personal note or topics',{exact:true}).click();
 await panelBox(page,'Personal note (optional)').fill('Note for A');
 await panelBox(page,'Topics (optional, comma separated)').fill('tag-a');
 await drag(page,OTHER);await adopt(page,OTHER.quote);
 await expect(panelBox(page,'Personal note (optional)')).toHaveValue('');
 await expect(panelBox(page,'Topics (optional, comma separated)')).toHaveValue('');
 await drag(page,A);await adopt(page,A.quote);
 await expect(panelBox(page,'Personal note (optional)')).toHaveValue('Note for A');
 await expect(panelBox(page,'Topics (optional, comma separated)')).toHaveValue('tag-a');
});

for(const action of ['Discuss','Highlight']){
 test(`${action}: a selection across two paragraphs disables saving instead of keeping the stale passage`,async({page})=>{
  await signIn(page);
  await drag(page,A);await openWith(page,action,A.quote);
  const submit=page.locator('#sr-panel').getByRole('button',{name:action==='Discuss'?'Post question':'Save highlight',exact:true});
  if(action==='Discuss')await panelBox(page,'Your question').fill('Draft kept for A');
  await expect(submit).toBeEnabled();
  // Start outside the live selection A: pressing on selected text starts a native text drag instead.
  await dragAcross(page,{block:'p-0',quote:'Whether'},OTHER);
  await expect(passage(page)).toHaveText('Select text within one supported paragraph.');
  await expect(passage(page)).not.toContainText(A.quote);
  await expect(submit).toBeDisabled();
  // Recovering with a supported selection restores both the passage and A's draft.
  // First collapse the cross-paragraph selection with a real click on later reading text:
  // pressing on selected text would start a native text drag instead of a new selection.
  const spot=await page.evaluate(()=>{const p=document.querySelectorAll('main p')[2];p.scrollIntoView({block:'center',behavior:'instant'});
   const t=document.createTreeWalker(p,NodeFilter.SHOW_TEXT).nextNode(),m=document.createRange();m.setStart(t,10);m.setEnd(t,11);
   const r=m.getClientRects()[0],pt={x:r.left+r.width/2,y:r.top+r.height/2};if(!p.contains(document.elementFromPoint(pt.x,pt.y)))throw Error('p-2 covered');return pt;});
  await page.mouse.click(spot.x,spot.y);
  await expect.poll(()=>page.evaluate(()=>getSelection().isCollapsed),{message:'precondition: selection collapsed by click'}).toBe(true);
  await expect(passage(page)).toHaveText('Select text within one supported paragraph.');
  await expect(submit).toBeDisabled();
  await drag(page,A);await adopt(page,A.quote);
  await expect(submit).toBeEnabled();
  if(action==='Discuss')await expect(panelBox(page,'Your question')).toHaveValue('Draft kept for A');
 });
}

test('unknown submission outcome keeps the immutable target and says why a reselection was refused',async({page,browserName})=>{
 await signIn(page);
 await drag(page,A);await openWith(page,'Discuss',A.quote);
 let fail=true;
 await page.route('**/social-reading/api/commands',route=>fail&&route.request().method()==='POST'?route.abort('connectionreset'):route.continue());
 const nonce=`lt560-u-${browserName}-${Date.now()}`;
 await panelBox(page,'Your question').fill('Unknown outcome '+nonce);
 await page.locator('#sr-panel').getByRole('button',{name:'Post question',exact:true}).click();
 await expect(statusLine(page)).toContainText('Submission outcome unknown');
 await drag(page,OTHER);
 await expect(statusLine(page)).toHaveText(UNCHANGED);
 await expect(passage(page)).toHaveText(A.quote);
 fail=false;
 await page.locator('#sr-panel').getByRole('button',{name:'Check pending submission',exact:true}).click();
 await expect(page.locator('.sr-thread').filter({hasText:nonce})).toContainText(A.quote);
 const found=await search(page,nonce);
 expect(found.threads).toHaveLength(1);
 expect(found.threads[0].anchor.selector.quote).toBe(A.quote);
});

test('unknown highlight outcome keeps the immutable target and says why a reselection was refused',async({page,browserName})=>{
 await signIn(page);
 await drag(page,A);await openWith(page,'Highlight',A.quote);
 let fail=true;
 await page.route('**/social-reading/api/highlights*',route=>fail&&route.request().method()==='POST'?route.abort('connectionreset'):route.continue());
 const nonce=`lt560-hu-${browserName}-${Date.now()}`;
 await page.getByText('Add a personal note or topics',{exact:true}).click();
 await panelBox(page,'Personal note (optional)').fill('Unknown highlight '+nonce);
 await page.locator('#sr-panel').getByRole('button',{name:'Save highlight',exact:true}).click();
 await expect(statusLine(page)).toContainText('Highlight outcome unknown');
 await drag(page,OTHER);
 await expect(statusLine(page)).toHaveText(UNCHANGED);
 await expect(passage(page)).toHaveText(A.quote);
 fail=false;
 await page.locator('#sr-panel').getByRole('button',{name:'Check pending highlight',exact:true}).click();
 await expect.poll(async()=>(await search(page,nonce)).highlights?.map(h=>h.anchor.selector.quote),{timeout:10000}).toEqual([A.quote]);
});

// KNOWN SOURCE BUG (QA, 2026-11-15, ad79455): syncOpenSelection refuses any reselection while
// `busy` (the thread reload started by the previous reselection) and never re-applies it, so
// the second selection is dropped and "Check the pending operation..." is shown with nothing
// pending. Fails in Chromium, Firefox and WebKit. Remove test.fail once the source is fixed.
test('a fast second reselection while the first is still loading ends on the latest passage',async({page})=>{
 await signIn(page);
 await drag(page,A);await openWith(page,'Discuss',A.quote);
 // Slow sign-in checks and thread loads, as on a real network, so the first sync is still busy.
 await page.route(/social-reading\/api\/(session|threads)/,async route=>{await new Promise(r=>setTimeout(r,1500));await route.continue();});
 await drag(page,OTHER);
 await expect(passage(page)).toHaveText(OTHER.quote,{timeout:5000});
 await drag(page,SAME);
 await expect(passage(page),'latest pointer selection must win after loading settles').toHaveText(SAME.quote,{timeout:10000});
 await page.unroute(/social-reading\/api\/(session|threads)/);
 await page.waitForLoadState('networkidle');
 await expect(passage(page)).toHaveText(SAME.quote);
});

test('selecting text inside panel form fields does not replace the quotation (guard)',async({page})=>{
 await signIn(page);
 await drag(page,A);await openWith(page,'Discuss',A.quote);
 const question=panelBox(page,'Your question');
 await question.fill('typed words in the question box');
 // Keyboard select-all inside the field.
 await question.focus();await page.keyboard.press('ControlOrMeta+a');
 await page.keyboard.press('Shift+ArrowLeft');
 // Real pointer drag inside the field.
 const box=await question.boundingBox();
 await page.mouse.move(box.x+4,box.y+box.height/2);await page.mouse.down();
 await page.mouse.move(box.x+box.width-4,box.y+box.height/2,{steps:15});await page.mouse.up();
 // And inside the Exact quote input.
 const exact=page.locator('#sr-panel').getByLabel('Exact quote (optional)',{exact:true});
 if(await exact.isVisible()){await exact.focus();await page.keyboard.press('ControlOrMeta+a');}
 await page.waitForTimeout(300);
 await expect(passage(page)).toHaveText(A.quote);
 await expect(question).toHaveValue(/typed words/);
});

// KNOWN SOURCE BUG (QA, 2026-11-15, ad79455), Chromium only: while open() awaits authorize
// (`busy`), Chromium fires selectionchange with the reading selection still live, so
// syncOpenSelection announces the refusal and that also suppresses "Signed in.". Firefox and
// WebKit pass. Remove test.fail once the source is fixed.
test('opening the panel from a selection does not announce a refused reselection',async({page,browserName})=>{
 await signIn(page);
 await drag(page,A);await openWith(page,'Discuss',A.quote);
 await expect(statusLine(page),'nothing is pending, so the refusal must not be announced').not.toHaveText(UNCHANGED,{timeout:3000});
});
