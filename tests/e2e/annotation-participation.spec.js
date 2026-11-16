import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';

test.beforeEach(async({page})=>{
 await page.route('**/annotation-focus-fixture.html*',route=>route.fulfill({contentType:'text/html',body:readFileSync(new URL('../fixtures/annotation-focus.html',import.meta.url),'utf8').replace('<main', '<style>body{font-family:Arial,sans-serif}</style><main')}));
 await page.route('**/annotation-focus-fixture.mjs',route=>route.fulfill({contentType:'text/javascript',body:readFileSync(new URL('../fixtures/annotation-focus.mjs',import.meta.url),'utf8')}));
});
for(const width of [1440,360])test(`participation is separated from utilities at ${width}`,async({page},info)=>{
 await page.setViewportSize({width,height:1000});await page.goto('/annotation-focus-fixture.html');
 await expect(page.locator('.sr-author')).toHaveCount(3);
 await page.locator('#sr-panel').screenshot({path:`.scratch/participation/evidence/after-${info.project.name||'chromium'}-${width}.png`});
 for(const selector of ['.sr-passage','.sr-question','.sr-conversations']){
  const e=page.locator(selector);await expect(e).toHaveCSS('border-inline-start-width','4px');
  expect(await e.evaluate(e=>parseFloat(getComputedStyle(e).paddingInlineStart))).toBeGreaterThanOrEqual(12);
 }
 await expect(page.getByRole('heading',{name:'Passage context',exact:true})).toBeVisible();
 await expect(page.getByRole('heading',{name:'Conversations',exact:true})).toBeVisible();
 const thread=page.locator('.sr-thread'),reply=page.locator('.sr-reply').first();
 expect((await reply.boundingBox()).x-(await thread.boundingBox()).x).toBeGreaterThanOrEqual(20);
 await expect(reply).toHaveCSS('border-inline-start-width','2px');
 await reply.scrollIntoViewIfNeeded();
 await page.locator('#sr-panel').screenshot({path:`.scratch/participation/evidence/replies-${info.project.name||'chromium'}-${width}.png`});
 await expect(page.locator('.sr-reply-composer')).toHaveCSS('border-inline-start-width','2px');
 const q=page.getByRole('textbox',{name:'Your question',exact:true});await q.fill('Synthetic retained draft');
 await page.getByRole('button',{name:'Find & export',exact:true}).click();
 await expect(page.locator('.sr-question')).toBeHidden();
 await expect(page.getByRole('button',{name:'Search annotations',exact:true})).toBeVisible();
 await page.locator('#sr-panel').screenshot({path:`.scratch/participation/evidence/utilities-${info.project.name||'chromium'}-${width}.png`});
 await page.getByRole('button',{name:'Discuss',exact:true}).click();await expect(q).toHaveValue('Synthetic retained draft');
 await q.focus();await expect(q).toBeFocused();await expect(q).toHaveCSS('outline-width','3px');
 await page.emulateMedia({forcedColors:'active'});await expect(page.locator('.sr-question')).toHaveCSS('border-inline-start-width','4px');
 await expect(reply).toHaveCSS('border-inline-start-width','2px');
 expect(await page.locator('#sr-panel').evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true);
 await page.locator('#sr-panel').screenshot({path:`.scratch/participation/evidence/forced-${info.project.name||'chromium'}-${width}.png`});
 await page.keyboard.press('Escape');await expect(page.locator('#sr-entry')).toBeFocused();
});
test('empty state and 200 percent text reflow retain the participation boundary',async({page})=>{
 await page.setViewportSize({width:360,height:1000});await page.goto('/annotation-focus-fixture.html?empty');
 await page.evaluate(()=>document.documentElement.style.fontSize='200%');
 await expect(page.getByText('No questions on this passage yet.',{exact:true})).toBeVisible();
 await expect(page.locator('.sr-question')).toHaveCSS('border-inline-start-width','4px');
 expect(await page.locator('#sr-panel').evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true);
 await page.locator('#sr-panel').screenshot({path:'.scratch/participation/evidence/empty-200-percent.png'});
});
