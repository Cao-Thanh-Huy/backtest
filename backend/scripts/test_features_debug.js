const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  const errors = [];
  const responses = [];

  page.on('console', msg => {
    console.log('BROWSER LOG:', msg.text());
    if (msg.type() === 'error') errors.push(msg.text());
  });
  
  page.on('requestfailed', request => {
    console.log('REQ FAILED:', request.method(), request.url());
    errors.push(`Failed: ${request.url()}`);
  });
  
  page.on('response', response => {
    const url = response.url();
    const status = response.status();
    if (status !== 200 && status !== 304) {
      console.log('RES:', status, url);
      responses.push(`${status} ${url}`);
      if (status === 404) {
        errors.push(`404 Not Found: ${url}`);
      }
    }
  });

  try {
    console.log("\n=== Testing Feature Selection Page ===\n");
    await page.goto('http://localhost:3000/lab/feature-selection', { waitUntil: 'networkidle', timeout: 60000 });
    
    console.log("\n✓ Page loaded successfully");
    
    // Wait for React to stabilize
    await page.waitForTimeout(3000);
    
    // Check page state
    console.log("\n--- Checking page elements ---");
    
    // Check title
    const titleText = await page.textContent('body');
    console.log("Page contains 'Feature Selection':", titleText?.includes('Feature Selection') || false);
    
    // Get React errors from window
    const windowErrors = await page.evaluate(() => {
      return {
        hasError: typeof window.__REACT_DEVTOOLS_GLOBAL_HOOK__ !== 'undefined',
        title: document.title
      };
    });
    console.log("Window state:", windowErrors);
    
    // Check button
    const btn = page.locator('button:has-text("Analyze")');
    const btnCount = await btn.count();
    console.log(`"Analyze" buttons found: ${btnCount}`);

  } catch (e) {
    errors.push(`Exception: ${e.message}`);
    console.error('✗ ERROR:', e.message);
  } finally {
    console.log("\n--- Summary ---");
    if (errors.length > 0) {
      console.log("Errors encountered:");
      errors.forEach(e => console.log("  -", e));
    } else {
      console.log("✓ No errors found");
    }
    
    if (responses.length > 0) {
      console.log("\nNon-200 Responses:");
      responses.forEach(r => console.log("  -", r));
    }
    
    await browser.close();
  }
})();
