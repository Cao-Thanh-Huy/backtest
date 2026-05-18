const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  page.on('console', msg => console.log('BROWSER LOG:', msg.text()));
  page.on('request', request => console.log('REQ:', request.method(), request.url()));
  page.on('response', response => console.log('RES:', response.status(), response.url()));

  try {
    console.log("Navigating to Target Generator...");
    await page.goto('http://localhost:3000/lab/targets');
    await page.waitForLoadState('networkidle');

    console.log("Checking for Data Preparations in dropdown...");
    const options = await page.$$eval('select option', opts => opts.map(o => o.textContent.trim()));
    console.log("Dropdown options:", options);

    const dataPreps = await page.evaluate(() => {
        // Query react query cache
        // Actually, just wait for network
    });

  } catch (e) {
    console.error(e);
  } finally {
    await browser.close();
  }
})();
