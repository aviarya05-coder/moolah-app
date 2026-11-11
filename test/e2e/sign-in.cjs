/* Signing in, in a phone-sized browser, against a stand-in for Supabase that
   answers the same requests the real one does (sign-in by emailed code, the
   database's REST calls with row security, start_household, delete-account).
   It checks that a new account always starts at an empty set-up, that a
   budget survives a reload, that signing out leaves nothing on the phone,
   that a second person on the same phone sees none of the first one's
   figures, and that deleting the account deletes the budget.

   Run: npm run build:e2e-signin && npm run preview &   then   npm run test:e2e:sign-in */
const { chromium, devices } = require(process.env.PLAYWRIGHT || 'playwright');
const APP = process.env.APP_URL || 'http://localhost:4173/';
const SB = 'https://mock.supabase.test';
const CODE = '123456';

/* ---- the stand-in ---------------------------------------------------- */
const users = new Map();             // email -> { id, email }
const db = { households: [], members: [], accounts: [], groups: [], categories: [], assignments: [], transactions: [] };
let seq = 0, n = 0, started = null;
const uid = () => '00000000-0000-4000-8000-' + String(++n).padStart(12, '0');
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const token = (u) => [b64({ alg: 'HS256', typ: 'JWT' }), b64({ sub: u.id, email: u.email, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 }), 'sig'].join('.');
const whoFrom = (req) => {
  const t = (req.headers()['authorization'] || '').replace(/^Bearer /, '').split('.')[1];
  try { const p = JSON.parse(Buffer.from(t, 'base64url').toString()); return p.sub ? p : null; } catch (e) { return null; }
};
const memberOf = (u) => new Set(db.members.filter((m) => m.user_id === u).map((m) => m.household_id));

async function supabase(route) {
  const req = route.request(), url = new URL(req.url()), path = url.pathname, method = req.method();
  const json = (status, body) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: body === undefined ? '' : JSON.stringify(body) });
  if (method === 'OPTIONS') return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
  const body = req.postData() ? JSON.parse(req.postData()) : null;

  if (path === '/auth/v1/otp') { if (!users.has(body.email)) users.set(body.email, { id: uid(), email: body.email }); return json(200, {}); }
  if (path === '/auth/v1/verify') {
    const u = users.get(body.email);
    if (!u || body.token !== CODE) return json(403, { code: 403, error_code: 'otp_expired', msg: 'Token has expired or is invalid' });
    const user = { id: u.id, email: u.email, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() };
    return json(200, { access_token: token(u), token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'r-' + u.id, user });
  }
  if (path === '/auth/v1/logout') return json(204);
  const who = whoFrom(req);
  if (path === '/auth/v1/user') return who ? json(200, { id: who.sub, email: who.email, aud: 'authenticated' }) : json(401, { msg: 'no' });
  if (!who) return json(401, { message: 'JWT required' });
  const mine = memberOf(who.sub);

  if (path === '/functions/v1/delete-account') {
    const owned = db.members.filter((m) => m.user_id === who.sub && m.role === 'owner').map((m) => m.household_id);
    for (const t of Object.keys(db)) db[t] = db[t].filter((r) => !owned.includes(t === 'households' ? r.id : r.household_id));
    db.members = db.members.filter((m) => m.user_id !== who.sub);
    for (const [e, u] of users) if (u.id === who.sub) users.delete(e);
    return json(200, { ok: true });
  }
  if (path === '/rest/v1/rpc/start_household') {
    if (mine.size) return json(400, { message: 'You already have a budget.' });
    const p = body.p; started = p;
    const hid = uid();
    db.households.push({ id: hid, name: p.household.name, currency: p.household.currency });
    db.members.push({ household_id: hid, user_id: who.sub, role: 'owner', display_name: p.displayName || null });
    p.accounts.forEach((a) => db.accounts.push({ id: a.id, household_id: hid, name: a.name, kind: a.kind, sort: a.sort, archived: false }));
    p.groups.forEach((g) => db.groups.push({ id: g.id, household_id: hid, name: g.name, sort: g.sort }));
    p.categories.forEach((c) => db.categories.push({ id: c.id, household_id: hid, group_id: c.groupId, name: c.name, sort: c.sort, priority: c.priority, monthly_cost: c.monthlyCost, archived: false }));
    p.assignments.forEach((a) => db.assignments.push({ id: uid(), household_id: hid, month: a.month, category_id: a.categoryId || null, card_id: a.cardId || null, amount: a.amount, note: a.note }));
    p.transactions.forEach((t) => db.transactions.push({ id: uid(), household_id: hid, date: t.date, account_id: t.accountId, payee: t.payee, category_id: t.categoryId || null, pay_card_id: t.payCardId || null, outflow: t.outflow, inflow: t.inflow, note: null, seq: ++seq, created_by: who.sub }));
    return json(200, hid);
  }
  const table = path.replace('/rest/v1/', '');
  if (!db[table]) return json(404, { message: 'no table ' + table });
  const visible = (r) => mine.has(table === 'households' ? r.id : r.household_id);
  const filters = [...url.searchParams].filter(([k, v]) => v.startsWith('eq.')).map(([k, v]) => [k, v.slice(3)]);
  const hit = (r) => visible(r) && filters.every(([k, v]) => String(r[k]) === v);
  if (method === 'GET') {
    let rows = db[table].filter(hit);
    const order = url.searchParams.get('order');
    if (order) { const c = order.split('.')[0]; rows.sort((a, b) => (a[c] < b[c] ? -1 : a[c] > b[c] ? 1 : 0)); }
    const off = Number(url.searchParams.get('offset') || 0), lim = Math.min(Number(url.searchParams.get('limit') || 1000), 1000);
    rows = rows.slice(off, off + lim);
    if ((req.headers()['accept'] || '').includes('vnd.pgrst.object')) return rows.length === 1 ? json(200, rows[0]) : json(406, { message: 'not one row' });
    return json(200, rows);
  }
  if (method === 'POST') {
    for (const r of [].concat(body)) {
      if (!mine.has(r.household_id)) return json(403, { code: '42501', message: 'new row violates row-level security policy' });
      db[table].push({ id: uid(), category_id: null, card_id: null, pay_card_id: null, note: null, ...r,
        ...(table === 'transactions' ? { seq: ++seq, created_by: who.sub } : {}) });
    }
    return json(201);
  }
  if (method === 'PATCH') { db[table].forEach((r) => { if (hit(r)) Object.assign(r, body); }); return json(204); }
  if (method === 'DELETE') { db[table] = db[table].filter((r) => !hit(r)); return json(204); }
  return json(405, {});
}

/* ---- the run ---------------------------------------------------------- */
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ ...devices['iPhone 13'], timezoneId: 'Asia/Jerusalem' });
  await ctx.route(SB + '/**', supabase);
  const pg = await ctx.newPage(); const errs = [];
  pg.on('pageerror', (e) => errs.push(String(e.stack || e).split('\n').slice(0, 3).join(' @ ')));
  pg.on('dialog', (d) => d.accept());
  const ok = (cond, what) => { console.log((cond ? 'ok  ' : 'FAIL') + ' ' + what); if (!cond) process.exitCode = 1; };
  const signIn = async (email, code = CODE) => {
    await pg.waitForSelector('#inEmail'); await pg.fill('#inEmail', email); await pg.tap('#inSend');
    await pg.waitForSelector('#inCode'); await pg.fill('#inCode', code); await pg.tap('#inGo');
  };
  const st = () => pg.evaluate(() => S && { un: S.toBeBudgeted, bal: S.accountBalance, card: S.trackers[0] && S.trackers[0].available, n: S.recent.length });
  const deviceKeys = () => pg.evaluate(() => Object.keys(localStorage).filter((k) => /^(moolah\.|sb-|lastState)/.test(k)));

  await pg.goto(APP);
  await pg.waitForSelector('#inEmail');
  ok(!(await pg.isVisible('#tabbar')), 'signed out, only the sign-in shows');
  await pg.screenshot({ path: '/tmp/moolah-signin.png' });
  await signIn('ana@example.test', '000000');
  await pg.waitForFunction(() => document.getElementById('inErr').textContent.length > 0);
  ok(/wrong or has expired/.test(await pg.textContent('#inErr')), 'a wrong code is refused: ' + await pg.textContent('#inErr'));
  await pg.fill('#inCode', CODE); await pg.tap('#inGo');
  await pg.waitForSelector('#suGo');
  ok(true, 'a new account starts at the set-up');
  await pg.fill('#suName', 'Test home'); await pg.fill('#suBal', '12,000'); await pg.fill('#suOwed', '1,500');
  await pg.tap('#suGo'); await pg.waitForSelector('[data-asgstart]', { timeout: 8000 });
  const ids = [...started.accounts, ...started.groups, ...started.categories].map((x) => x.id);
  ok(ids.every((x) => /^[0-9a-f-]{36}$/.test(x)), 'set-up sends fresh ids, none of the made-up local ones');
  ok(JSON.stringify(await st()) === JSON.stringify({ un: 10500, bal: 12000, card: 1500, n: 1 }), 'the started budget: ' + JSON.stringify(await st()));

  await pg.evaluate(() => new Promise((r) => call('moveMany', [{ moves: [{ fromUnassigned: true, to: 'Groceries', amount: 2000 }] }], (j) => { S = j.state; renderAll(); r(); })));
  await pg.evaluate(() => new Promise((r, x) => call('addTransaction', [{ amount: 120, category: 'Groceries', account: 'Credit card', paidTo: 'Market' }], (j) => { S = j.state; renderAll(); r(); }, x)));
  const hid = db.households[0].id;
  ok(db.transactions.length === 2 && db.transactions.every((t) => t.household_id === hid), 'what is logged is saved in the household');
  await pg.reload(); await pg.waitForSelector('[data-asgstart]', { timeout: 8000 });
  // the last figures paint at once, then the database's replace them
  await pg.waitForFunction(() => S && S.recent.length === 2, null, { timeout: 8000 }).catch(() => {});
  ok(JSON.stringify(await st()) === JSON.stringify({ un: 8500, bal: 12000, card: 1620, n: 2 }), 'still signed in after a reload, figures from the database: ' + JSON.stringify(await st()));

  await pg.tap('#tabbar [data-tab="more"]'); await pg.waitForSelector('#acctOut');
  ok((await pg.innerText('#acctOut')).includes('ana@example.test'), 'More shows who is signed in');
  await pg.screenshot({ path: '/tmp/moolah-more.png' });
  await pg.tap('#acctOut'); await pg.waitForSelector('#inEmail', { timeout: 8000 });
  ok((await deviceKeys()).length === 0, 'signing out leaves nothing on the phone: ' + JSON.stringify(await deviceKeys()));

  await signIn('bea@example.test');
  await pg.waitForSelector('#suGo');
  ok(await pg.evaluate(() => typeof S === 'undefined' || S === null), 'someone else on the same phone starts at an empty set-up, with none of the figures');

  await pg.reload(); await pg.waitForSelector('#suGo');
  await pg.evaluate(() => localStorage.clear()); await pg.reload();
  await signIn('ana@example.test');
  await pg.waitForSelector('[data-asgstart]', { timeout: 8000 });
  ok((await st()).un === 8500, 'signing back in brings the budget back');

  await pg.tap('#tabbar [data-tab="more"]'); await pg.waitForSelector('#acctDel');
  await pg.tap('#acctDel'); await pg.waitForSelector('#inEmail', { timeout: 8000 });
  ok(db.households.length === 0 && db.transactions.length === 0 && db.categories.length === 0, 'deleting the account deletes the budget');
  ok((await deviceKeys()).length === 0, 'and leaves nothing on the phone');
  ok(errs.length === 0, 'no page errors ' + JSON.stringify(errs));
  await b.close();
})();
