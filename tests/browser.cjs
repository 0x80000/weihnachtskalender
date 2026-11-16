// Run against a local HTTP server: node tests/browser.cjs [URL]
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
(async () => {
 const browser = await chromium.launch({executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox']});
 try {
 const page = await browser.newPage({viewport:{width:1600,height:1100}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.argv[2] || 'http://127.0.0.1:8010');
 assert.equal(await page.locator('body').getAttribute('data-mode'),'simple');
 assert.equal(await page.locator('[data-bind="cut.door.cut"]').isVisible(),false);
 await page.locator('[data-mode-choice="pro"]').click();
 assert.equal(await page.locator('[data-bind="cut.door.cut"]').isVisible(),true);
 await page.reload();assert.equal(await page.locator('body').getAttribute('data-mode'),'pro');
 // Use a real image selected through the application's upload UI.
 const png=await page.screenshot();
 const fc=page.waitForEvent('filechooser');await page.locator('[data-act="coverImage"]').click();
 await (await fc).setFiles({name:'cover.png',mimeType:'image/png',buffer:png});
 await page.waitForFunction(()=>window.kalender.state.cover.img !== null);
 const initialSize=await page.locator('#stage').evaluate(e=>e.style.backgroundSize);
 await page.locator('#coverZoom').fill('1.5');await page.locator('#coverX').fill('0.2');
 assert.notEqual(await page.locator('#stage').evaluate(e=>e.style.backgroundSize),initialSize);
 assert.notEqual(await page.locator('#stage').evaluate(e=>e.style.backgroundPosition),'');
 await page.locator('[data-tool="number"]').click();
 const before=await page.evaluate(()=>({...window.kalender.state.doors[0]}));
 const box=await page.locator('.door').first().boundingBox();
 await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width*.65,box.y+box.height*.6,{steps:8});await page.mouse.up();
 let after=await page.evaluate(()=>({...window.kalender.state.doors[0]}));
 assert(after.nx>.5);assert.equal(after.x,before.x);assert.equal(after.y,before.y);
 await page.locator('[data-act="undo"]').click();assert.equal(await page.evaluate(()=>window.kalender.state.doors[0].nx),undefined);
 await page.locator('[data-act="redo"]').click();
 // Mode switching preserves the project exactly.
 const state=await page.evaluate(()=>JSON.stringify(window.kalender.state));
 await page.locator('[data-mode-choice="simple"]').click();
 assert.equal(await page.evaluate(()=>JSON.stringify(window.kalender.state)),state);
 await page.locator('[data-number-axis="nx"]').fill('70');
 await page.locator('[data-number-axis="nx"]').dispatchEvent('change');
 assert.equal(await page.evaluate(()=>window.kalender.state.doors[0].nx),.7);
 const dl=page.waitForEvent('download');await page.locator('[data-act="saveProject"]').click();const file=await (await dl).path();
 const saved=JSON.parse(require('fs').readFileSync(file,'utf8'));assert.equal(saved.state.cover.zoom,1.5);assert.equal(saved.state.doors[0].nx,.7);assert.equal(saved.images.length,1);
 await page.locator('[data-act="coverClear"]').click();
 const open=page.waitForEvent('filechooser');await page.locator('[data-act="openProject"]').click();await(await open).setFiles(file);
 await page.waitForFunction(()=>window.kalender.state.cover.img !== null);
 assert.equal(await page.evaluate(()=>window.kalender.state.doors[0].nx),.7);
 const pdf=await page.evaluate(async()=>{const b=await window.kalender.build.cover(()=>{});return {size:b.size,header:await b.slice(0,5).text()}});
 assert.equal(pdf.header,'%PDF-');assert(pdf.size>1000);
 // Legacy projects without new crop/number fields continue to work.
 delete saved.state.cover.zoom;delete saved.state.cover.cx;delete saved.state.cover.cy;saved.state.doors.forEach(d=>{delete d.nx;delete d.ny});
 const old=page.waitForEvent('filechooser');await page.locator('[data-act="openProject"]').click();await(await old).setFiles({name:'old.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(saved))});
 await page.waitForFunction(()=>window.kalender.state.cover.zoom===1);
 await page.locator('.door').first().click();assert.equal(await page.locator('[data-number-axis="nx"]').inputValue(),'50');
 await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 assert.deepEqual(errors,[]);console.log('PASS: modes, cover upload/crop/PDF, number drag/sliders/undo, project roundtrip, legacy project, mobile width.');
 } finally {await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
