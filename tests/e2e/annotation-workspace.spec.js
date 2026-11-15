import {test,expect} from '@playwright/test';
import {readFileSync,mkdirSync} from 'node:fs';
const route='/social_psychology/13%3A_Competition_and_Cooperation_in_Our_Social_Worlds/13.01%3A_Conflict_Cooperation_Morality_and_Fairness/';
const credentialsFile=process.env.SR_CREDENTIALS_FILE;
test.skip(!credentialsFile,'Designated isolated synthetic credentials required');
test.use({screenshot:'off',trace:'off',video:'off'});
async function signIn(page,actor='alice'){
 const credentials=JSON.parse(readFileSync(credentialsFile,'utf8'));
 const response=await page.request.post('/social-reading/api/login',{headers:{Origin:new URL(page.url()).origin},data:{username:actor,password:credentials[actor]}});
 expect(response.status()).toBe(200);
 await page.reload();
}
async function select(page,start=0,end=24){
 await page.evaluate(({start,end})=>{const m=JSON.parse(document.querySelector('#sr-page-context').textContent),p=document.querySelectorAll('main p')[Number(m.blocks[0].block.slice(2))];p.scrollIntoView({block:'center'});const text=document.createTreeWalker(p,NodeFilter.SHOW_TEXT).nextNode(),range=document.createRange();range.setStart(text,start);range.setEnd(text,end);getSelection().removeAllRanges();getSelection().addRange(range);},{start,end});
 await expect(page.locator('#sr-quick-actions')).toBeVisible();
}
async function save(page,note,tags='revision'){
 await select(page);await page.getByRole('button',{name:'Highlight',exact:true}).click();
 await expect(page.locator('#sr-personal')).toBeVisible();
 if(!await page.getByRole('textbox',{name:'Personal note (optional)',exact:true}).isVisible())
  await page.getByText('Add a personal note or topics',{exact:true}).click();
 await page.getByRole('textbox',{name:'Personal note (optional)',exact:true}).fill(note);
 await page.locator('#sr-personal').getByRole('textbox',{name:'Topics (optional, comma separated)',exact:true}).fill(tags);
 await page.getByRole('button',{name:'Save highlight',exact:true}).click();
 await expect(page.locator('#sr-highlight-list')).toContainText(note);
}
test('private passage persists, shows after reload, stays private and explicitly discusses',async({page})=>{
 await page.goto(route);await signIn(page);const note='personal-'+Date.now();await save(page,note);
 const before=await page.locator('main').innerHTML();await page.getByRole('button',{name:'Close discussion',exact:true}).click();await page.reload();
 await page.locator('#sr-entry').click();await page.getByRole('button',{name:'My highlights',exact:true}).click();await expect(page.locator('#sr-highlight-list')).toContainText(note);
 expect(await page.locator('main').innerHTML()).toBe(before);
 const own=await(await page.request.get('/social-reading/api/highlights')).json();expect(own.some(m=>m.text===note)).toBe(true);
 await page.getByRole('button',{name:'Hide highlights',exact:true}).click();expect(await(await page.request.get('/social-reading/api/highlights')).json()).toEqual(own);
 await page.getByRole('button',{name:'Show highlights',exact:true}).click();
 const row=page.locator('.sr-mark').filter({hasText:note});await row.getByRole('button',{name:'Discuss this highlight',exact:true}).click();
 await page.getByRole('textbox',{name:'Your question',exact:true}).fill('course-'+note);await page.getByRole('button',{name:'Post question',exact:true}).click();await expect(page.locator('#sr-threads')).toContainText('course-'+note);
 await signIn(page,'bob');await page.locator('#sr-entry').click();await page.getByRole('button',{name:'My highlights',exact:true}).click();await expect(page.locator('#sr-highlight-list')).not.toContainText(note);
 await page.getByRole('button',{name:'Find & export',exact:true}).click();await page.getByRole('searchbox',{name:'Search this page',exact:true}).fill(note);await page.getByRole('button',{name:'Search annotations',exact:true}).click();await expect(page.locator('#sr-search-results')).toContainText('course-'+note);await expect(page.locator('#sr-search-results')).not.toContainText('Only you');
});
test('topic search and standards JSON export include only permitted results',async({page})=>{
 await page.goto(route);await signIn(page);const note='export-'+Date.now();await save(page,note,'unique-study-topic');
 await page.getByRole('button',{name:'Find & export',exact:true}).click();await page.getByRole('searchbox',{name:'Search this page',exact:true}).fill('unique-study-topic');await page.getByRole('button',{name:'Search annotations',exact:true}).click();await expect(page.locator('#sr-search-results')).toContainText(note);
 const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Export JSON',exact:true}).click();const download=await downloadPromise;const data=JSON.parse(readFileSync(await download.path(),'utf8'));expect(data.type).toBe('AnnotationPage');expect(data.items.length).toBeGreaterThan(0);expect(JSON.stringify(data)).toContain(note);expect(JSON.stringify(data)).toContain('TextQuoteSelector');
});
for(const width of [1440,360,320])test(`workspace keyboard and panel bounds ${width}`,async({page})=>{
 await page.setViewportSize({width,height:900});await page.goto(route);await page.locator('#sr-entry').focus();await page.keyboard.press('Enter');
 await expect(page.locator('#sr-panel')).toBeVisible();await expect(page.getByText('Both sign-in fields are required.',{exact:true})).toHaveCount(0);
 const bounds=await page.locator('#sr-panel').boundingBox();expect(bounds.x).toBeGreaterThanOrEqual(-1);expect(bounds.x+bounds.width).toBeLessThanOrEqual(width+1);
 await page.getByText('Choose a passage with the keyboard',{exact:true}).click();await page.getByRole('button',{name:'Use whole passage',exact:true}).focus();await page.keyboard.press('Enter');await expect(page.getByRole('blockquote',{name:'Selected passage'})).toBeVisible();
 await page.keyboard.press('Escape');await expect(page.locator('#sr-entry')).toBeFocused();
});

test('overlapping marks offer explicit choices, keyboard jump preserves focus and hiding retains records',async({page})=>{
 await page.goto(route);await signIn(page);const note='overlap-'+Date.now();
 await save(page,note+'-one');await page.getByRole('button',{name:'Close discussion',exact:true}).click();
 await save(page,note+'-two');await page.getByRole('button',{name:'Close discussion',exact:true}).click();
 await page.reload();
 await expect.poll(()=>page.evaluate(()=>CSS.highlights.get('sr-personal')?.size??0)).toBeGreaterThanOrEqual(2);
 const point=await page.evaluate(()=>{
  const range=[...CSS.highlights.get('sr-personal')][0];range.startContainer.parentElement.scrollIntoView({block:'center'});
  getSelection().removeAllRanges();const r=range.getClientRects()[0];return {x:r.x+Math.min(50,r.width/2),y:r.y+r.height/2};
 });
 await page.mouse.click(point.x,point.y);
 await expect(page.getByRole('heading',{name:'Choose an overlapping annotation',exact:true})).toBeVisible();
 const row=page.locator('.sr-mark').filter({hasText:note+'-two'}),jump=row.getByRole('button',{name:'Jump to passage',exact:true});
 await jump.focus();await page.keyboard.press('Enter');await expect(jump).toBeFocused();
 await expect(page.getByRole('status')).toHaveText('Passage located in the reading.');
 await page.getByRole('button',{name:'Hide highlights',exact:true}).click();
 expect(await page.evaluate(()=>CSS.highlights.has('sr-personal'))).toBe(false);
 await page.getByRole('button',{name:'Show highlights',exact:true}).click();
 expect(await page.evaluate(()=>CSS.highlights.get('sr-personal').size)).toBeGreaterThanOrEqual(2);
});

test('lost highlight acknowledgment reconciles one saved mark without reposting',async({page})=>{
 await page.goto(route);await signIn(page);const note='receipt-'+Date.now();let commands=0;
 await page.route('**/social-reading/api/highlights',async route=>{
  if(route.request().method()!=='POST')return route.continue();
  commands++;await route.fetch();await route.abort('failed');
 });
 await select(page);await page.getByRole('button',{name:'Highlight',exact:true}).click();
 await page.getByText('Add a personal note or topics',{exact:true}).click();
 await page.getByRole('textbox',{name:'Personal note (optional)',exact:true}).fill(note);
 await page.getByRole('button',{name:'Save highlight',exact:true}).click();
 await expect(page.getByRole('status')).toContainText('Highlight outcome unknown');
 await page.getByRole('button',{name:'Check pending highlight',exact:true}).click();
 await expect(page.locator('#sr-highlight-list')).toContainText(note);expect(commands).toBe(1);
 const marks=await(await page.request.get('/social-reading/api/highlights')).json();
 expect(marks.filter(m=>m.text===note)).toHaveLength(1);
});

test('course contribution receives a second-account reply without exposing its personal origin',async({page})=>{
 await page.goto(route);await signIn(page);const note='discussion-'+Date.now();await save(page,note+'-private');
 await page.locator('.sr-mark').filter({hasText:note+'-private'}).getByRole('button',{name:'Discuss this highlight',exact:true}).click();
 await page.getByRole('textbox',{name:'Your question',exact:true}).fill(note+'-course');
 await page.getByRole('button',{name:'Post question',exact:true}).click();
 await expect(page.locator('#sr-threads')).toContainText(note+'-course');
 await signIn(page,'bob');await page.locator('#sr-entry').click();
 const thread=page.locator('.sr-thread').filter({hasText:note+'-course'});
 await thread.locator('textarea').fill(note+'-reply');await thread.getByRole('button',{name:'Post reply',exact:true}).click();
 await expect(thread).toContainText(note+'-reply');await page.reload();await page.locator('#sr-entry').click();
 await expect(page.locator('#sr-threads')).toContainText(note+'-reply');
 await page.getByRole('button',{name:'Find & export',exact:true}).click();
 await page.getByRole('searchbox',{name:'Search this page',exact:true}).fill(note);
 await page.getByRole('button',{name:'Search annotations',exact:true}).click();
 await expect(page.locator('#sr-search-results')).toContainText(note+'-course');
 await expect(page.locator('#sr-search-results')).not.toContainText(note+'-private');
});

test('personal notes edit and author search stay explicit at desktop and mobile widths',async({page})=>{
 await page.goto(route);await signIn(page);const note='review-note-'+Date.now();await save(page,note,'cooperation, revisit');
 const row=page.locator('.sr-mark').filter({hasText:note});
 await row.getByRole('button',{name:'Edit personal note',exact:true}).click();
 await page.getByRole('textbox',{name:'Personal note (optional)',exact:true}).fill(note+'-edited');
 await page.getByRole('button',{name:'Save changes',exact:true}).click();
 await expect(page.locator('#sr-highlight-list')).toContainText(note+'-edited');
 await page.getByRole('button',{name:'Find & export',exact:true}).click();
 await page.getByRole('searchbox',{name:'Search this page',exact:true}).fill(note);
 await page.getByRole('textbox',{name:'Author (optional)',exact:true}).fill('alice');
 await page.getByRole('button',{name:'Search annotations',exact:true}).click();
 await expect(page.locator('#sr-search-results')).toContainText(note+'-edited');
 await page.locator('#sr-search-results .sr-mark').filter({hasText:note+'-edited'}).getByRole('button',{name:'Edit personal note',exact:true}).click();
 await expect(page.getByRole('textbox',{name:'Personal note (optional)',exact:true})).toBeVisible();
 await expect(page.getByRole('textbox',{name:'Personal note (optional)',exact:true})).toHaveValue(note+'-edited');
 const exported=await(await page.request.get('/social-reading/api/annotation-export?book=social_psychology')).json();
 for(const item of exported.items){
  expect(item.type).toBe('Annotation');expect(item.target.type).toBe('SpecificResource');
  expect(item.target['sr:anchor'].revision).toBeTruthy();
  if(item['sr:audience']==='private-owner')expect(item.creator).toBe('alice');
 }
 await page.getByRole('button',{name:'My highlights',exact:true}).click();
 mkdirSync('.scratch/annotation-redesign/evidence',{recursive:true});
 for(const width of [1440,768,360,320]){
  await page.setViewportSize({width,height:900});
  await page.locator('#sr-panel .sr-content').evaluate(node=>node.scrollTop=0);
  await page.screenshot({path:`.scratch/annotation-redesign/evidence/workspace-${width}.png`});
 }
 await page.locator('.sr-mark').filter({hasText:note+'-edited'}).getByRole('button',{name:'Delete my highlight',exact:true}).click();
 await expect(page.locator('#sr-highlight-list')).not.toContainText(note+'-edited');
});

test('sign-out clears an unsaved personal note and topics before another account signs in',async({page})=>{
 await page.goto(route);await signIn(page);await select(page);
 await page.getByRole('button',{name:'Highlight',exact:true}).click();
 await page.getByText('Add a personal note or topics',{exact:true}).click();
 const note=page.getByRole('textbox',{name:'Personal note (optional)',exact:true});
 await note.fill('Alice private unsaved thought');
 await page.locator('#sr-personal').getByRole('textbox',{name:'Topics (optional, comma separated)',exact:true}).fill('alice-private-topic');
 await page.getByRole('button',{name:'Discuss',exact:true}).click();
 await page.getByText('Add topics',{exact:true}).click();
 await page.locator('#sr-course').getByRole('textbox',{name:'Topics (optional, comma separated)',exact:true}).fill('alice-unposted-course-topic');
 await page.getByRole('button',{name:'My highlights',exact:true}).click();
 await page.getByRole('button',{name:'Sign out',exact:true}).click();
 const credentials=JSON.parse(readFileSync(credentialsFile,'utf8'));
 await page.locator('input[name=username]').fill('bob');await page.locator('input[name=password]').fill(credentials.bob);
 await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await expect(page.getByRole('button',{name:'Sign out',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'My highlights',exact:true}).click();
 await expect(note).toHaveValue('');
 await expect(page.locator('#sr-personal').getByRole('textbox',{name:'Topics (optional, comma separated)',exact:true})).toHaveValue('');
 await page.getByRole('button',{name:'Discuss',exact:true}).click();
 await expect(page.locator('#sr-course').getByRole('textbox',{name:'Topics (optional, comma separated)',exact:true})).toHaveValue('');
});
