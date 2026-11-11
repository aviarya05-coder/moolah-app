/* First run in a phone-sized browser: set-up, the starting figures, assigning,
   a card purchase from the Log screen, surviving a reload, the other screens,
   and another browser starting empty. Needs Playwright and `npm run preview`.
   Run: npm run build:e2e-local && npm run preview &   then   npm run test:e2e:local */
const { chromium, devices } = require(process.env.PLAYWRIGHT || 'playwright');
const URL = process.env.APP_URL || 'http://localhost:4173/';
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ ...devices['iPhone 13'], timezoneId: 'Asia/Jerusalem' });
  const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', e => errs.push(String(e.stack || e).split('\n').slice(0,4).join(' @ '))); pg.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await pg.goto(URL); await pg.waitForSelector('#suGo');
  console.log('1 setup shown:', await pg.isVisible('#setup'), '| app hidden:', !(await pg.isVisible('#tabbar')));
  await pg.screenshot({ path: '/tmp/moolah-setup.png' });
  await pg.fill('#suName', 'Test home'); await pg.fill('#suBal', '12,000'); await pg.fill('#suOwed', '1,500');
  await pg.uncheck('[data-sucat="Childcare"]'); await pg.uncheck('[data-sucat="School"]');
  await pg.tap('#suGo'); await pg.waitForSelector('[data-asgstart]', { timeout: 5000 });
  const st = () => pg.evaluate(() => ({ un: S.toBeBudgeted, bal: S.accountBalance, card: S.trackers[0] && S.trackers[0].available,
    cats: S.groups.reduce((n, g) => n + g.categories.length, 0), kids: (S.groups.find(g => g.name === 'Kids') || { categories: [] }).categories.map(c => c.name) }));
  console.log('2 after setup:', JSON.stringify(await st()));
  console.log('  summary:', (await pg.innerText('#summary')).replace(/\n+/g, ' | '));
  await pg.screenshot({ path: '/tmp/moolah-map.png' });
  // assign, then a card purchase from the Log screen
  await pg.evaluate(() => new Promise(r => call('moveMany', [{ moves: [{ fromUnassigned: true, to: 'Groceries', amount: 2000 }] }], j => { S = j.state; renderAll(); renderMap(); r(); })));
  await pg.tap('#tabbar [data-tab="log"]'); await pg.waitForTimeout(200);
  for (const k of ['1', '2', '0']) await pg.tap(`[data-k="${k}"]`);
  await pg.tap('#moreBtn'); await pg.waitForTimeout(250); await pg.tap('[data-name="Groceries"]'); await pg.waitForTimeout(200);
  console.log('3 log:', await pg.textContent('#amt'), '| category', await pg.evaluate(() => picked && picked.name), '| account', await pg.textContent('#acctBtn'));
  await pg.tap('#save'); await pg.waitForTimeout(500);
  const g = await pg.evaluate(() => { const c = S.groups.flatMap(x => x.categories).find(x => x.name === 'Groceries'); return [c.available, S.trackers[0].available, S.toBeBudgeted, S.recent[0] && S.recent[0].amount]; });
  console.log('  after logging 120 on the card: groceries/card/unassigned/recent', JSON.stringify(g), '| toast', await pg.textContent('#toast'));
  // reload: still there
  await pg.reload(); await pg.waitForSelector('[data-asgstart]', { timeout: 5000 });
  console.log('4 after reload:', JSON.stringify(await st()), '| recent', await pg.evaluate(() => S.recent.length));
  // the other screens open without errors
  for (const t of ['import', 'more', 'log', 'map']) { await pg.tap(`#tabbar [data-tab="${t}"]`); await pg.waitForTimeout(250); }
  await pg.tap('#tabbar [data-tab="more"]'); await pg.tap('#morescreen [data-tab="activity"]'); await pg.waitForTimeout(300);
  console.log('5 activity rows:', await pg.$$eval('#actBody .rec', x => x.length));
  await pg.tap('#tabbar [data-tab="more"]'); await pg.tap('#moreLife'); await pg.waitForTimeout(300);
  console.log('  life costs head:', (await pg.innerText('.thead')).replace(/\n/g, ' / ').slice(0, 90));
  console.log('  errors', JSON.stringify(errs));
  // someone else, another browser: starts empty
  const other = await (await b.newContext({ ...devices['iPhone 13'] })).newPage();
  await other.goto(URL); await other.waitForSelector('#suGo');
  console.log('6 another browser starts at set-up:', await other.isVisible('#suGo'), '| stored budgets:', await other.evaluate(() => Object.keys(localStorage).length));
  await b.close();
})();
