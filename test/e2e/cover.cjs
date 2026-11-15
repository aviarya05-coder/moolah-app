/* Covering an overspent category from several others, in full or in part,
   in a phone-sized browser on the device-only build.
   Run: npm run build:e2e-local && npm run preview &   then   node test/e2e/cover.cjs */
const { chromium, devices } = require(process.env.PLAYWRIGHT || 'playwright');
const APP = process.env.APP_URL || 'http://localhost:4173/';
(async () => {
  const b = await chromium.launch();
  const pg = await (await b.newContext({ ...devices['iPhone 13'], timezoneId: 'Asia/Jerusalem' })).newPage();
  const errs = []; pg.on('pageerror', (e) => errs.push(String(e.stack || e).split('\n').slice(0, 3).join(' @ ')));
  const ok = (cond, what) => { console.log((cond ? 'ok  ' : 'FAIL') + ' ' + what); if (!cond) process.exitCode = 1; };
  const act = (fn, args) => pg.evaluate(([fn, args]) => new Promise((r, x) => call(fn, [args], (j) => { if (j && j.state) S = j.state; renderAll(); renderMap(); r(j); }, x)), [fn, args]);
  const avail = (n) => pg.evaluate((n) => n === 'Unassigned' ? S.toBeBudgeted : S.groups.flatMap((g) => g.categories).find((c) => c.name === n).available, n);
  const srcs = () => pg.$$eval('[data-mvfamt]', (x) => x.map((i) => [i.dataset.mvfamt, i.value]));
  const dest = () => pg.$$eval('[data-mvamt]', (x) => x.map((i) => [i.dataset.mvamt, i.value]));
  const type = async (sel, v) => { await pg.fill(sel, ''); await pg.type(sel, String(v)); };

  await pg.goto(APP); await pg.waitForSelector('#suGo');
  await pg.fill('#suBal', '1000'); await pg.uncheck('#suHasCard'); await pg.tap('#suGo');
  await pg.waitForSelector('[data-asgstart]');
  await act('moveMany', { moves: [['Groceries', 100], ['Eating out', 300], ['Fuel', 200], ['Clothing', 350]].map(([to, amount]) => ({ fromUnassigned: true, to, amount })) });
  await act('addTransaction', { amount: 500, category: 'Groceries', account: 'Checking account' });
  ok(await avail('Groceries') === -400 && await avail('Unassigned') === 50, 'Groceries is 400 over, with 50 unassigned');

  // Fix: Unassigned first, then the category with most to spare, as many as it takes
  await pg.tap('[data-fix="Groceries"]'); await pg.waitForSelector('#mvGo');
  ok(JSON.stringify(await srcs()) === JSON.stringify([['Unassigned', '50'], ['Clothing', '350']]), 'several sources fill the shortfall on their own: ' + JSON.stringify(await srcs()));
  ok((await pg.textContent('#mvGo')) === 'Move ₪400 to Groceries', 'button: ' + await pg.textContent('#mvGo'));
  await pg.screenshot({ path: '/tmp/moolah-cover-auto.png' });

  // choose another by hand, then take less from Clothing: partial cover
  await pg.tap('[data-mvfadd]'); await pg.tap('[data-mvfpick="Eating out"]');
  ok(JSON.stringify(await srcs()) === JSON.stringify([['Unassigned', '50'], ['Clothing', '350'], ['Eating out', '']]), 'a source added by hand joins the list: ' + JSON.stringify(await srcs()));
  await type('[data-mvfamt="Clothing"]', 100);
  ok(JSON.stringify(await dest()) === JSON.stringify([['Groceries', '150']]), 'one destination takes what the sources give: ' + JSON.stringify(await dest()));
  ok(/250 short/.test(await pg.textContent('[data-mvst="Groceries"]')), 'and shows what stays short: ' + await pg.textContent('[data-mvst="Groceries"]'));
  ok(/stays overspent/.test(await pg.textContent('#mvBal')), 'the line above the button says so: ' + await pg.textContent('#mvBal'));
  await type('[data-mvfamt="Eating out"]', 200);
  ok((await pg.textContent('#mvGo')) === 'Move ₪350 to Groceries', 'three sources, part of the shortfall: ' + await pg.textContent('#mvGo'));
  await pg.screenshot({ path: '/tmp/moolah-cover-partial.png' });
  await pg.tap('#mvGo'); await pg.waitForTimeout(500);
  const after = { g: await avail('Groceries'), u: await avail('Unassigned'), c: await avail('Clothing'), e: await avail('Eating out') };
  ok(JSON.stringify(after) === JSON.stringify({ g: -50, u: 0, c: 250, e: 100 }), 'moved: ' + JSON.stringify(after));
  ok(/Moved ₪350 from 3 places to Groceries/.test(await pg.textContent('#toast')), 'toast: ' + await pg.textContent('#toast'));
  await pg.tap('#toast button'); await pg.waitForTimeout(500);
  ok(await avail('Groceries') === -400 && await avail('Clothing') === 350 && await avail('Unassigned') === 50, 'one Undo puts all three back');

  // a source asked for more than it has is stopped
  await pg.tap('[data-fix="Groceries"]'); await pg.waitForSelector('#mvGo');
  await type('[data-mvfamt="Unassigned"]', 80);
  ok((await pg.textContent('#mvGo')) === 'Unassigned only has ₪50' && await pg.isDisabled('#mvGo'), 'no source gives more than it has');
  await pg.tap('#mvClose');

  // a destination amount lower than the shortfall: the sources follow
  await pg.tap('[data-fix="Groceries"]'); await pg.waitForSelector('#mvGo');
  await type('[data-mvamt="Groceries"]', 120);
  ok(JSON.stringify(await srcs()) === JSON.stringify([['Unassigned', '50'], ['Clothing', '70']]), 'asking for less takes less: ' + JSON.stringify(await srcs()));
  await pg.tap('#mvGo'); await pg.waitForTimeout(500);
  ok(await avail('Groceries') === -280 && await avail('Clothing') === 280, 'part of it covered');

  // Fix all: two overspent, covered in the order listed
  await act('addTransaction', { amount: 260, category: 'Fuel', account: 'Checking account' });
  await pg.tap('[data-fixall]'); await pg.waitForSelector('#mvGo');
  ok(JSON.stringify(await dest()) === JSON.stringify([['Groceries', '280'], ['Fuel', '60']]), 'Fix all lists both: ' + JSON.stringify(await dest()));
  ok(JSON.stringify(await srcs()) === JSON.stringify([['Eating out', '300'], ['Clothing', '40']]), 'and sources for both: ' + JSON.stringify(await srcs()));
  await pg.tap('#mvGo'); await pg.waitForTimeout(500);
  ok(await avail('Groceries') === 0 && await avail('Fuel') === 0 && await avail('Eating out') === 0 && await avail('Clothing') === 240, 'both covered, the one with most to spare first');

  // Move money out of a category, back to Unassigned
  await pg.evaluate(() => openMoveSheet({ from: 'Clothing', to: ['Unassigned'] }));
  await type('[data-mvamt="Unassigned"]', 40);
  ok(JSON.stringify(await srcs()) === JSON.stringify([['Clothing', '40']]), 'moving out takes from the one chosen');
  await pg.tap('#mvGo'); await pg.waitForTimeout(500);
  ok(await avail('Clothing') === 200 && await avail('Unassigned') === 40, 'and lands in Unassigned');

  // the Log screen's "move it in" opens the same sheet
  await pg.tap('#tabbar [data-tab="log"]'); await pg.waitForTimeout(200);
  for (const k of ['3', '0', '0']) await pg.tap(`[data-k="${k}"]`);
  await pg.tap('#moreBtn'); await pg.waitForTimeout(250); await pg.tap('[data-name="Fuel"]'); await pg.waitForTimeout(200);
  await pg.tap('#coverFix'); await pg.waitForSelector('#mvGo');
  ok(JSON.stringify(await srcs()) === JSON.stringify([['Unassigned', '40'], ['Clothing', '200']]) && JSON.stringify(await dest()) === JSON.stringify([['Fuel', '300']]) && /Moves ₪240 of the ₪300/.test(await pg.textContent('#mvBal')),
    'from the Log screen too, several sources, all they have: ' + JSON.stringify(await srcs()) + ' -> ' + JSON.stringify(await dest()));
  ok(errs.length === 0, 'no page errors ' + JSON.stringify(errs));
  await b.close();
})();
