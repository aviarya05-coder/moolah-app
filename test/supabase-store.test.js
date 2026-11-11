// The Supabase store, against a stand-in for the Supabase client that keeps
// rows in memory the way the database does (snake_case columns, numbered
// transactions, at most 1000 rows an answer). The same budget run over it
// and over the device store must come out identical.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBackend, memoryStore } from '../engine/backend.js';
import { newHousehold } from '../engine/setup.js';
import { supabaseStore, forStart } from '../engine/supabase-store.js';

function fakeSupabase(me) {
  const db = { households: [], members: [], accounts: [], groups: [], categories: [], assignments: [], transactions: [] };
  let seq = 0;
  const query = (table) => {
    const filters = [];
    let op = 'select', payload = null, order = null, range = null, single = false;
    const q = {
      select() { return q; },
      eq(k, v) { filters.push([k, v]); return q; },
      order(c) { order = c; return q; },
      range(a, b) { range = [a, b]; return q; },
      limit(n) { range = [0, n - 1]; return q; },
      single() { single = true; return q; },
      insert(rows, opts) { op = 'insert'; payload = rows; assert.equal(opts && opts.defaultToNull, false); return q; },
      update(row) { op = 'update'; payload = row; return q; },
      delete() { op = 'delete'; return q; },
      then(ok, bad) {
        const hit = (r) => filters.every(([k, v]) => r[k] === v);
        let out = { data: null, error: null };
        if (op === 'insert') {
          for (const r of payload) {
            assert.ok(r.household_id, 'every row names its household');
            assert.ok(!('groupId' in r) && !('by' in r) && !('seq' in r), 'only database columns are written');
            db[table].push({ ...r, ...(table === 'transactions' ? { seq: ++seq, created_by: me } : {}) });
          }
        } else if (op === 'update') db[table].forEach((r) => { if (hit(r)) Object.assign(r, payload); });
        else if (op === 'delete') db[table] = db[table].filter((r) => !hit(r));
        else {
          let rows = db[table].filter(hit);
          if (order) rows = [...rows].sort((a, b) => (a[order] < b[order] ? -1 : a[order] > b[order] ? 1 : 0));
          const [a, b] = range || [0, 999];
          rows = rows.slice(a, Math.min(b + 1, a + 1000));   // never more than the server's cap of 1000
          out.data = single ? rows[0] : JSON.parse(JSON.stringify(rows));
        }
        return Promise.resolve(out).then(ok, bad);
      },
    };
    return q;
  };
  return {
    db,
    from: query,
    // what start_household does, for the test's purposes
    start(p) {
      const hid = 'h-1';
      db.households.push({ id: hid, name: p.household.name, currency: p.household.currency });
      db.members.push({ household_id: hid, user_id: me, display_name: 'Sam', role: 'owner' });
      p.accounts.forEach((a) => db.accounts.push({ id: a.id, household_id: hid, name: a.name, kind: a.kind, sort: a.sort, archived: false }));
      p.groups.forEach((g) => db.groups.push({ id: g.id, household_id: hid, name: g.name, sort: g.sort }));
      p.categories.forEach((c) => db.categories.push({ id: c.id, household_id: hid, group_id: c.groupId, name: c.name, sort: c.sort,
        priority: c.priority, monthly_cost: c.monthlyCost, archived: false }));
      p.assignments.forEach((a, i) => db.assignments.push({ id: 'as-' + i, household_id: hid, month: a.month, category_id: a.categoryId,
        card_id: a.cardId, amount: a.amount, note: a.note }));
      p.transactions.forEach((t) => db.transactions.push({ id: 'st-' + seq, household_id: hid, date: t.date, account_id: t.accountId, payee: t.payee,
        category_id: t.categoryId, pay_card_id: t.payCardId, outflow: t.outflow, inflow: t.inflow, note: null, seq: ++seq, created_by: me }));
      return hid;
    },
  };
}

const choices = { name: 'Test home', currency: 'USD', cash: { name: 'Bank', balance: 5000 }, card: { name: 'Visa', owed: 300 },
  keep: ['Groceries', 'Fuel', 'Rent or mortgage'], date: '2026-11-02' };
const day = () => '2026-11-11';

async function exercise(b) {
  await b.moveMany({ moves: [{ fromUnassigned: true, to: 'Groceries', amount: 800 }, { fromUnassigned: true, to: 'Fuel', amount: 200 }] });
  const a = await b.addTransaction({ amount: 95.5, category: 'Groceries', account: 'Visa', paidTo: 'Market', date: '2026-11-05' });
  await b.addTransaction({ amount: 40, category: 'Fuel', account: 'Bank', date: '2026-11-06' });
  await b.addTransaction({ amount: 300, category: 'Credit card payment', account: 'Bank', date: '2026-11-07' });
  await b.addTransaction({ amount: 2500, type: 'income', account: 'Bank', paidTo: 'Salary', date: '2026-11-08' });
  await b.updateTransaction({ row: a.row, amount: 99.5, paidTo: 'Market' });
  const gone = await b.addTransaction({ amount: 12, category: 'Fuel', account: 'Bank' });
  await b.deleteTransaction({ row: gone.row });
  await b.setTrueRate({ category: 'Groceries', amount: 900 });
  await b.setBalances({ checking: 7100, card: 99.5 });
  return b.getState();
}

test('a budget kept in Supabase works out exactly as one kept on the device', async () => {
  const d = newHousehold(choices);
  const local = await exercise(createBackend(memoryStore(d), { today: day }));

  const sb = fakeSupabase('user-1');
  const hid = sb.start(forStart(d));
  const remote = await exercise(createBackend(supabaseStore(sb, hid), { today: day }));

  const strip = (s) => JSON.parse(JSON.stringify(s, (k, v) => (k === 'row' || k === 'by' ? undefined : v)));
  assert.deepEqual(strip(remote), strip(local));
  assert.equal(remote.toBeBudgeted, local.toBeBudgeted);
  assert.equal(remote.currency, '$');
  assert.equal(remote.recent[0].paidTo, 'Balance adjustment');
  assert.equal(sb.db.transactions.every((t) => t.household_id === hid), true);
  assert.equal(remote.recent.find((r) => r.paidTo === 'Salary').by, 'Sam', 'who logged it comes from the member list');
});

test('forStart gives every row a fresh id and keeps the references between them', () => {
  const d = newHousehold(choices);
  let n = 0;
  const p = forStart(d, () => 'u' + (++n));
  const ids = new Set([...p.accounts, ...p.groups, ...p.categories].map((x) => x.id));
  assert.equal(ids.size, p.accounts.length + p.groups.length + p.categories.length);
  assert.ok(p.categories.every((c) => p.groups.some((g) => g.id === c.groupId)));
  assert.equal(p.assignments[0].cardId, p.accounts.find((a) => a.kind === 'credit').id);
  assert.equal(p.transactions[0].accountId, p.accounts.find((a) => a.kind === 'cash').id);
  assert.ok(![...ids].some((x) => /^(acct|grp|cat)-/.test(x)), 'no made-up local id is sent');
});

test('more than a thousand transactions are all read, a page at a time', async () => {
  const sb = fakeSupabase('user-1');
  const hid = sb.start(forStart(newHousehold({ ...choices, card: null, cash: { name: 'Bank', balance: 0 } })));
  const store = supabaseStore(sb, hid);
  const acct = sb.db.accounts[0].id, cat = sb.db.categories[0].id;
  await store.insert('transactions', Array.from({ length: 2345 }, (_, i) => ({ date: '2026-11-03', accountId: acct, categoryId: cat, outflow: 1, inflow: 0, payee: 'x' + i })));
  const data = await store.load();
  assert.equal(data.transactions.length, 2345);
  assert.deepEqual(data.transactions.map((t) => t.seq), [...data.transactions.map((t) => t.seq)].sort((a, b) => a - b));
});
