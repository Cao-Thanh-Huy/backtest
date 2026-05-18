const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 500 });
  const context = await browser.newContext();
  const page = await context.newPage();

  page.on('console', msg => console.log('BROWSER LOG:', msg.text()));
  page.on('request', request => console.log('REQ:', request.method(), request.url().replace('http://localhost:3000', '')));
  page.on('response', response => console.log('RES:', response.status(), response.url().replace('http://localhost:3000', '')));
  page.on('pageerror', err => console.error('PAGE ERROR:', err));

  try {
    console.log("\n=== Navigating to Feature Selection page ===");
    await page.goto('http://localhost:3000/lab/feature-selection', { waitUntil: 'domcontentloaded', timeout: 30000 });
    console.log("✓ Page loaded");

    // Wait for network to stabilize
    await page.waitForTimeout(2000);
    console.log("✓ Network stabilized");

    // Check for the page title
    const title = await page.locator('text=Feature Selection').first();
    const titleVisible = await title.isVisible({ timeout: 5000 }).catch(() => false);
    console.log(titleVisible ? "✓ Page title found" : "✗ Page title not found");

    // Check for the "Analyze & Create" button
    const createBtn = await page.locator('button:has-text("Analyze & Create")').first();
    const btnVisible = await createBtn.isVisible({ timeout: 5000 }).catch(() => false);
    console.log(btnVisible ? "✓ Create button found" : "✗ Create button not found");

    if (btnVisible) {
      // Click to open the panel
      console.log("\n=== Opening feature selection panel ===");
      await createBtn.click();
      await page.waitForTimeout(1000);
      
      // Check for dataset dropdown
      const datasetSelect = await page.locator('select').nth(0);
      const selectVisible = await datasetSelect.isVisible({ timeout: 5000 }).catch(() => false);
      console.log(selectVisible ? "✓ Dataset select found" : "✗ Dataset select not found");

      if (selectVisible) {
        // Get options
        const options = await datasetSelect.locator('option').allTextContents();
        console.log(`✓ Dataset options count: ${options.length}`);
        console.log("  Options:", options.slice(0, 5).map(o => o.trim()));
        
        if (options.length <= 1) {
          console.log("⚠ WARNING: Only '--select labeled dataset--' option available (no completed datasets)");
        }
      }
    }

    console.log("\n=== Test completed ===");
  } catch (e) {
    console.error('✗ ERROR:', e.message);
    console.error(e.stack);
  } finally {
    await browser.close();
  }
})();
