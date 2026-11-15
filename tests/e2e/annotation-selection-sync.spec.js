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

async function signIn(page,actor='alice'){
 const credentials=JSON.parse(readFileSync(credentialsFile,'utf8'));
 await page.goto(path);
 const response=await page.request.post('/social-reading/api/login',{headers:{Origin:new URL(page.url()).origin},data:{username:actor,password:credentials[actor]}});
 expect(response.status()).toBe(200);
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
// The fix may update the passage directly, or re-offer the floating action while the
// panel is open; accept either, then require the exact new quotation.
async function adopt(page,action,quote){
 await page.waitForTimeout(300);
 const offered=quick(page).getByRole('button',{name:action,exact:true});
 if(await passage(page).textContent()!==quote&&await offered.isVisible())await offered.click();
 await expect(passage(page),'Selected passage must show the newly highlighted text').toHaveText(quote,{timeout:5000});
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
  await drag(page,target);await adopt(page,'Highlight',target.quote);
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
  await drag(page,target);await adopt(page,'Discuss',target.quote);
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
 await drag(page,OTHER);await adopt(page,'Discuss',OTHER.quote);
 await expect(question).toHaveValue('');
 await drag(page,A);await adopt(page,'Discuss',A.quote);
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
