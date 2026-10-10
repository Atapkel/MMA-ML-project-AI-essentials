// Optional browser smoke test. Install Playwright separately; the app does not need Node.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const python = process.env.PYTHON_EXECUTABLE || (process.platform === 'win32' ? 'python' : 'python3');

(async () => {
  const server = spawn(python, ['app.py', '--port', '8765'], {cwd:root, stdio:['ignore','pipe','pipe']});
  let browser;
  try {
    await new Promise((resolve,reject) => {
      const timer=setTimeout(()=>reject(new Error('Server start timeout')),10000);
      server.stdout.on('data', b => {if(b.toString().includes('http://')) {clearTimeout(timer); resolve();}});
      server.on('error',reject);server.on('exit',code=>reject(new Error('Server exited: '+code)));
    });
    const options = {headless:true};
    if (process.env.BROWSER_EXECUTABLE) {
      options.executablePath=process.env.BROWSER_EXECUTABLE;
      options.args=['--no-sandbox','--single-process','--no-zygote','--disable-gpu'];
    }
    browser=await chromium.launch(options);
    const page=await browser.newPage({viewport:{width:1440,height:1100},deviceScaleFactor:1});
    const errors=[];let deliberateValidation=false, expectedErrors=0;
    page.on('pageerror',e=>errors.push(e.message));
    page.on('console',m=>{
      if(m.type()!=='error')return;
      if(deliberateValidation && m.text().includes('400 (Bad Request)')) expectedErrors++;
      else errors.push(m.text());
    });
    await page.goto('http://127.0.0.1:8765');await page.waitForSelector('#result:not([hidden])');
    const first=parseFloat(await page.locator('#prob-a').innerText());
    await page.screenshot({path:path.join(root,'reports/ui_desktop.png'),fullPage:true});
    await page.click('#swap');await page.waitForFunction(()=>!document.getElementById('predict').disabled&&!document.getElementById('result').hidden);
    const reversed=parseFloat(await page.locator('#prob-a').innerText());
    if(Math.abs(first+reversed-100)>.11)throw new Error('Swap probability mismatch');
    await page.click('#manual-a');await page.fill('#search-a','Demo Custom A');await page.fill('#a-age','30');
    await page.click('#predict');await page.waitForSelector('#result:not([hidden])');
    if(await page.locator('#result-a-name').innerText()!=='Demo Custom A')throw new Error('Custom fighter not used');
    await page.fill('#a-striking_accuracy','');await page.click('#predict');await page.waitForSelector('#result:not([hidden])');
    if(!(await page.locator('#warnings').innerText()).includes('missing'))throw new Error('Missingness notice absent');
    deliberateValidation=true;
    await page.fill('#a-age','100');await page.click('#predict');await page.waitForSelector('#error:not([hidden])');
    if(!(await page.locator('#error').innerText()).includes('Age must be'))throw new Error('Input validation message absent');
    deliberateValidation=false;
    await page.fill('#search-a','Merab Dvalishvili');await page.fill('#search-b','Umar Nurmagomedov');
    await page.click('#predict');await page.waitForSelector('#result:not([hidden])');
    await page.click('[data-tab="evidence"]');await page.waitForSelector('#evidence-view:not([hidden])');
    if(await page.locator('#model-table tbody tr').count()!==6)throw new Error('Experiment table incomplete');
    await page.screenshot({path:path.join(root,'reports/ui_evidence.png'),fullPage:true});
    await page.setViewportSize({width:390,height:844});await page.click('[data-tab="matchup"]');
    await page.screenshot({path:path.join(root,'reports/ui_mobile.png'),fullPage:true});
    const dims=await page.evaluate(()=>({width:document.body.scrollWidth,viewport:innerWidth}));
    if(dims.width>dims.viewport)throw new Error('Mobile horizontal overflow');
    // Check another tablet viewport, including the evidence page.
    await page.setViewportSize({width:768,height:1024});await page.click('[data-tab="evidence"]');
    const tablet=await page.evaluate(()=>({width:document.body.scrollWidth,viewport:innerWidth}));
    if(tablet.width>tablet.viewport)throw new Error('Tablet horizontal overflow');
    if(errors.length)throw new Error(JSON.stringify(errors));
    const verification={status:'passed',browser:'Chromium',checks:['Model connected','Named fighter prediction','Swap symmetry','Custom fighter','Missing statistic','Invalid age rejected','Six experiment rows','390px mobile layout','768px tablet layout'],unexpected_browser_errors:errors,expected_validation_http_errors:expectedErrors};
    fs.writeFileSync(path.join(root,'reports/browser_verification.json'),JSON.stringify(verification,null,2));
    console.log(JSON.stringify(verification,null,2));
  } finally {
    if(browser)await browser.close();server.kill('SIGTERM');
  }
})().catch(e=>{console.error(e.message);process.exit(1)});
