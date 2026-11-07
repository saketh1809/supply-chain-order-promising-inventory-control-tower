/**
 * End-to-end UI flows in headless Chromium (order create/confirm, AI customer update, exception resolution,
 * AI proposal approval, inventory adjustment, expedite preview). Requires `npm i -D playwright` and the
 * app running. Usage: BASE_URL=http://localhost:8080 node scripts/browser-flows.mjs
 */
import { chromium } from 'playwright';
const OUT = process.env.SHOTS_DIR ?? '.';
const BASE = process.env.BASE_URL ?? 'http://localhost:5173';
const log = (...a) => console.log(...a);
const fail = (msg) => { throw new Error(msg); };

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push('CONSOLE ' + m.text().slice(0, 240)));
  // Diagnostic logging around the customer-update click is intentionally removed from the committed script.
  page.setDefaultTimeout(15000);

  // 1. New order: preview then create & confirm
  await page.goto(BASE + '/orders/new', { waitUntil: 'networkidle' });
  const orderNo = 'UI-' + Date.now().toString().slice(-6);
  await page.fill('#orderNumber', orderNo);
  await page.fill('#customerName', 'UI Test Customer');
  await page.selectOption('#priority', 'HIGH');
  await page.selectOption('#sku-0', { label: 'SKU-PWR-65W · 65W USB-C Power Adapter' }).catch(async () => {
    const opts = await page.$$eval('#sku-0 option', (els) => els.map((e) => e.textContent));
    fail('sku option not found; options=' + JSON.stringify(opts.slice(0, 5)));
  });
  await page.fill('#qty-0', '12');
  await page.click('text=Preview fulfillment');
  await page.waitForSelector('text=Expected fulfillment');
  await page.waitForSelector('table >> text=SKU-PWR-65W', { timeout: 15000 });
  log('preview rendered');
  await page.screenshot({ path: `${OUT}/flow_new_order_preview.png` });
  await page.click('text=Create & confirm');
  await page.waitForURL(/\/orders\/\d+$/, { timeout: 15000 });
  await page.waitForSelector(`text=${orderNo}`);
  log('created & confirmed order', orderNo, 'url', page.url());
  await page.waitForSelector('text=Fully allocated', { timeout: 15000 });
  const statusText = await page.textContent('body');
  if (!/Confirmed/.test(statusText)) fail('order not confirmed in UI');

  // 2. Customer update: generate, save as sent
  await page.click('button:has-text("Generate customer update")');
  await page.waitForSelector('text=AI draft', { timeout: 15000 });
  await page.waitForSelector('#cu-body', { timeout: 15000 });
  const body = await page.inputValue('#cu-body');
  if (!body.includes(orderNo)) fail('draft does not mention the order');
  await page.screenshot({ path: `${OUT}/flow_customer_update.png` });
  await page.click('button:has-text("Save as sent")');
  await page.waitForSelector('text=Recorded as sent', { timeout: 15000 });
  log('customer update recorded as sent');

  // 3. Exceptions: open an exception, get AI explanation, resolve it
  await page.goto(BASE + '/exceptions', { waitUntil: 'networkidle' });
  await page.waitForSelector('text=EXC-', { timeout: 15000 });
  await page.click('tbody tr >> nth=0');
  await page.waitForSelector('[aria-label="Exception details"]');
  await page.click('button:has-text("Explain")');
  await page.waitForSelector('text=What happened', { timeout: 15000 });
  log('AI exception explanation rendered');
  await page.screenshot({ path: `${OUT}/flow_exception_drawer.png` });
  await page.fill('#resolve-note', 'Reviewed with customer; accepted revised date');
  await page.click('button:has-text("Mark resolved")');
  await page.waitForSelector('text=Exception resolved', { timeout: 15000 });
  log('exception resolved');

  // 4. AI planner note: propose and approve
  await page.goto(BASE + '/ai', { waitUntil: 'networkidle' });
  await page.click('text=Use the example note');
  await page.click('button:has-text("Analyse note")');
  await page.waitForSelector('text=Proposal #', { timeout: 20000 });
  const approveBtn = page.locator('button:has-text("Approve")').first();
  await approveBtn.waitFor({ timeout: 15000 });
  await page.screenshot({ path: `${OUT}/flow_ai_proposal.png`, fullPage: false });
  await approveBtn.click();
  await page.waitForSelector('text=Changes applied, text=Partially applied', { timeout: 20000 }).catch(() => {});
  const aiBody = await page.textContent('body');
  if (!/Changes applied|Partially applied|Approved/i.test(aiBody)) fail('AI approval not reflected');
  log('AI proposal approved');

  // 5. Inventory adjustment with preview
  await page.goto(BASE + '/inventory', { waitUntil: 'networkidle' });
  await page.click('button:has-text("Adjust inventory")');
  await page.selectOption('#adj-sku', { index: 1 });
  await page.selectOption('#adj-loc', { index: 1 });
  await page.fill('#adj-qty', '5');
  await page.fill('#adj-reason', 'Cycle count variance from UI test');
  await page.click('button:has-text("Preview")');
  await page.waitForSelector('text=Preview', { timeout: 10000 });
  await page.waitForSelector('[aria-live="polite"] >> text=On-hand', { timeout: 10000 });
  await page.click('button:has-text("Confirm adjustment")');
  await page.waitForSelector('text=posted', { timeout: 15000 });
  log('inventory adjustment previewed and posted');

  // 6. Expedite preview on a receipt dependency
  await page.goto(BASE + '/supply?tab=receipts', { waitUntil: 'networkidle' });
  await page.click('text=PO-22');
  await page.waitForSelector('button:has-text("Expedite")');
  await page.click('button:has-text("Expedite")');
  await page.fill('#exp-reason', 'Customer escalation from UI test');
  const d = new Date(Date.now() + 1 * 86400000).toISOString().slice(0, 10);
  await page.fill('#exp-date', d);
  await page.click('button:has-text("Preview impact")');
  await page.waitForSelector('text=Impact on dependent order lines', { timeout: 15000 });
  await page.screenshot({ path: `${OUT}/flow_expedite_preview.png` });
  log('expedite preview shown');

  console.log(JSON.stringify({ errors: errors.slice(0, 10) }, null, 2));
  await browser.close();
})().catch(async (e) => {
  console.error('FLOW FAILED:', e.message);
  process.exit(1);
});
