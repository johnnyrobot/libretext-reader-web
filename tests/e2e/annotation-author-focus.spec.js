import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';

// Synthetic client fixture; uses the staged reader module and CSS without API writes.
for (const width of [1440,360,320]) for (const empty of [false,true])
 test(`author grouping and composer at ${width}, empty=${empty}`,async({page})=>{
  await page.route('**/annotation-focus-fixture.html*',route=>route.fulfill({contentType:'text/html',body:readFileSync(new URL('../fixtures/annotation-focus.html',import.meta.url),'utf8')}));
  await page.route('**/annotation-focus-fixture.mjs',route=>route.fulfill({contentType:'text/javascript',body:readFileSync(new URL('../fixtures/annotation-focus.mjs',import.meta.url),'utf8')}));
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
  await question.focus();await expect(question).toBeFocused();
  await page.emulateMedia({forcedColors:'active'});
  await expect(question).toBeVisible();await expect(question).toBeFocused();
  expect(await page.locator('#sr-panel').evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true);
  await page.keyboard.press('Escape');await expect(page.locator('#sr-entry')).toBeFocused();
 });
