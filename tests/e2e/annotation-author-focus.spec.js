import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';

test.beforeEach(async({page,request})=>{
 const asset=await request.get('/_assets/reader/annotations.mjs');
 test.skip(!asset.ok() || !(await asset.text()).includes('mountAnnotations'), 'Annotation assets must be staged');
  await page.route('**/annotation-focus-fixture.html*',route=>route.fulfill({contentType:'text/html',body:readFileSync(new URL('../fixtures/annotation-focus.html',import.meta.url),'utf8')}));
  await page.route('**/annotation-focus-fixture.mjs',route=>route.fulfill({contentType:'text/javascript',body:readFileSync(new URL('../fixtures/annotation-focus.mjs',import.meta.url),'utf8')}));
});

// Synthetic client fixture; uses the staged reader module and CSS without API writes.
for (const width of [1440,360,320]) for (const empty of [false,true])
 test(`author grouping and composer at ${width}, empty=${empty}`,async({page})=>{
  await page.setViewportSize({width,height:1000});
  await page.goto(`/annotation-focus-fixture.html${empty?'?empty':''}`);
  await expect(page.locator('#sr-panel')).toBeVisible();
  await expect(page.getByRole('form',{name:'Ask about this passage',exact:true})).toBeVisible();
  await expect(page.locator('.sr-author')).toHaveCount(empty?0:3);
  if(!empty){
   const authors=page.locator('.sr-author');
   const before=await authors.evaluateAll(es=>es.map(e=>getComputedStyle(e).color));
   expect(new Set(before).size).toBe(3);
   await page.getByRole('button',{name:'Refresh discussion',exact:true}).click();
   await expect(authors).toHaveCount(3);
   expect(await authors.evaluateAll(es=>es.map(e=>getComputedStyle(e).color))).toEqual(before);
   await expect(page.getByRole('heading',{name:'Alexandra Longname with several family names',exact:true})).toBeVisible();
   expect(await page.locator('.sr-initials').evaluateAll(es=>es.every(e=>e.getAttribute('aria-hidden')==='true'))).toBe(true);
  }
  const question=page.getByRole('textbox',{name:'Your question',exact:true});
  // Follow the browser's tab order from a surviving control.
  await page.getByRole('button',{name:'Discuss',exact:true}).focus();
  for(let i=0;i<12 && !await question.evaluate(e=>e===document.activeElement);i++)await page.keyboard.press('Tab');
  await expect(question).toBeFocused();
  await page.emulateMedia({forcedColors:'active'});
  await expect(question).toBeVisible();await expect(question).toBeFocused();
  expect(await page.locator('#sr-panel').evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true);
  await page.keyboard.press('Escape');await expect(page.locator('#sr-entry')).toBeFocused();
 });

for(const state of ['orphan','pending'])test(`disabled reply remains visually and behaviorally disabled: ${state}`,async({page})=>{
 await page.goto(`/annotation-focus-fixture.html?${state}`);
 const reply=page.getByRole('button',{name:'Post reply',exact:true});
 await expect(reply).toBeVisible();
 await page.locator('.sr-thread blockquote').focus();
 await page.keyboard.press('Tab');
 const textarea=page.getByRole('textbox',{name:'Your reply',exact:true});
 await expect(textarea).toBeFocused();
 await expect(textarea).toHaveCSS('outline-width','3px');
 if(state==='pending'){
  await page.getByRole('textbox',{name:'Your reply',exact:true}).fill('Synthetic pending reply');
  await reply.click();
  await expect(page.getByRole('status')).toContainText('Submission outcome unknown');
 }
 await expect(reply).toBeDisabled();
 const colors=()=>reply.evaluate(e=>{const s=getComputedStyle(e);return {background:s.backgroundColor,color:s.color,border:s.borderTopColor};});
 const disabled={background:'rgb(233, 238, 242)',color:'rgb(82, 103, 116)',border:'rgb(194, 205, 212)'};
 expect(await colors()).toEqual(disabled);
 await reply.scrollIntoViewIfNeeded();
 const rect=await reply.boundingBox();
 await page.mouse.move(rect.x+rect.width/2,rect.y+rect.height/2);
 expect(await colors()).toEqual(disabled);
 await page.mouse.click(rect.x+rect.width/2,rect.y+rect.height/2);
 expect(await page.evaluate(()=>window.syntheticCommands)).toBe(state==='pending'?1:0);
 if(state==='pending'){
  await page.getByRole('button',{name:'Check pending submission',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('Synthetic receipt unavailable');
  await expect(reply).toBeDisabled();expect(await colors()).toEqual(disabled);
  expect(await page.evaluate(()=>window.syntheticCommands)).toBe(1);
 }
});

test('name-only author accent is independent of message IDs',async({page})=>{
 await page.goto('/annotation-focus-fixture.html?name-only');
 const authors=page.locator('.sr-author');await expect(authors).toHaveCount(3);
 const colors=await authors.evaluateAll(es=>es.map(e=>getComputedStyle(e).color));
 expect(colors[0]).toBe(colors[1]);
});
