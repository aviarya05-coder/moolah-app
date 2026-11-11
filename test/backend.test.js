/* The actions the screens call, end to end over the in-memory store. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBackend, memoryStore } from '../engine/backend.js';

const household = () => ({
  household: { name: 'Test', currency: 'ILS' },
  accounts: [{ id: 'chk', name: 'Checking account', kind: 'cash', sort: 1 }, { id: 'cc', name: 'Credit Card', kind: 'credit', sort: 2 }],
  groups: [{ id: 'g1', name: 'Home', sort: 1 }],
  categories: [{ id: 'food', groupId: 'g1', name: 'Groceries', sort: 1 }, { id: 'rent', groupId: 'g1', name: 'Rent', sort: 2, priority: 'fixed' }],
  assignments: [], transactions: [],
});
const make = (d = household()) => { const store = memoryStore(d); return { store, b: createBackend(store, { today: () => '2026-11-10', me: () => 'Sam' }) }; };
const cat = (s, n) => s.groups.flatMap((g) => g.categories).find((c) => c.name === n);

test('income, assigning, a card purchase and paying the card', async () => {
  const { b } = make();
  let r = await b.addTransaction({ type: 'income', amount: 10000, account: 'Checking account', paidTo: 'Salary' });
  assert.equal(r.state.toBeBudgeted, 10000);
  r = await b.moveMany({ moves: [{ fromUnassigned: true, to: 'Groceries', amount: 2000 }, { fromUnassigned: true, to: 'Rent', amount: 4000 }] });
  assert.equal(r.state.toBeBudgeted, 4000);
  r = await b.addTransaction({ type: 'spend', amount: 350, category: 'Groceries', account: 'Credit Card', paidTo: 'Shop' });
  assert.equal(cat(r.state, 'Groceries').available, 1650);
  assert.equal(r.state.trackers[0].available, 350);
  assert.equal(r.state.toBeBudgeted, 4000);                                    // a card purchase moves money, it does not spend Unassigned
  r = await b.addTransaction({ type: 'spend', amount: 350, category: 'Credit card payment', account: 'Checking account' });
  assert.equal(r.state.trackers[0].available, 0);
  assert.equal(r.state.accountBalance, 9650);
  assert.equal(r.state.toBeBudgeted, 4000);
  assert.equal(r.state.recent[0].category, 'Credit card payment');
  assert.equal(r.state.recent[0].by, 'Sam');
  // a card payment from the card itself makes no sense
  assert.ok(!(await b.addTransaction({ type: 'spend', amount: 5, category: 'Credit card payment', account: 'Credit Card' })).ok);
  assert.ok(!(await b.addTransaction({ type: 'spend', amount: 5, category: 'Nope' })).ok);
  // quick picks leave fixed categories out
  assert.deepEqual(r.state.quick, ['Groceries']);
});

test('editing, deleting, and refusing to over-assign', async () => {
  const { b } = make();
  await b.addTransaction({ type: 'income', amount: 1000, account: 'Checking account' });
  await b.moveMany({ moves: [{ fromUnassigned: true, to: 'Groceries', amount: 500 }] });
  let r = await b.addTransaction({ type: 'spend', amount: 100, category: 'Groceries', account: 'Checking account' });
  const id = r.row;
  r = await b.updateTransaction({ row: id, amount: 120, category: 'Rent', paidTo: 'fixed' });
  assert.equal(cat(r.state, 'Rent').available, -120);
  assert.equal(cat(r.state, 'Groceries').available, 500);
  r = await b.deleteTransaction({ row: id });
  assert.equal(cat(r.state, 'Rent').available, 0);
  assert.ok(!(await b.deleteTransaction({ row: id })).ok);
  assert.ok(!(await b.moveMany({ moves: [{ fromUnassigned: true, to: 'Rent', amount: 501 }] })).ok);
  r = await b.moveMany({ moves: [{ from: 'Groceries', toUnassigned: true, amount: 200 }] });
  assert.equal(r.state.toBeBudgeted, 700);
});

test('set balances, and the day it leaves for statement imports', async () => {
  const { b } = make();
  await b.addTransaction({ type: 'income', amount: 5000, account: 'Checking account' });
  await b.addTransaction({ type: 'spend', amount: 80, category: 'Groceries', account: 'Credit Card' });
  let r = await b.setBalances({ checking: 4800, card: 300, clearOverspent: true, date: '2026-11-10' });
  assert.ok(r.ok);
  assert.equal(r.state.accountBalance, 4800);
  assert.equal(r.state.trackers[0].available, 300);
  assert.equal(cat(r.state, 'Groceries').available, 0);
  assert.equal(r.state.cardSetDate, '2026-11-10');
  r = await b.setBalances({ checking: '', card: 300, date: '2026-11-12' });        // already matches: the day is still noted
  assert.equal(r.state.cardSetDate, '2026-11-12');
});

test('life costs: confirm all, then set one', async () => {
  const d = household();
  d.assignments.push({ id: 'a1', month: '2026-10-01', categoryId: 'food', amount: 4300 }, { id: 'a2', month: '2026-10-01', categoryId: 'rent', amount: 7000 });
  const { b } = make(d);
  let s = await b.getState();
  assert.equal(s.trueMonthlyTotal, 11300);
  assert.equal(cat(s, 'Groceries').trueFrom, 'October');
  let r = await b.confirmRestMonthly();
  assert.equal(r.count, 2);
  assert.ok(r.state.groups[0].categories.every((c) => c.trueState === 'set'));
  r = await b.setTrueRate({ row: 'food', amount: 4500 });
  assert.equal(r.state.trueMonthlyTotal, 11500);
  // assigning money never moves life costs
  r = await b.moveMany({ moves: [{ fromUnassigned: true, to: 'Groceries', amount: 0.01 }] }).catch(() => null);
  assert.equal((await b.getState()).trueMonthlyTotal, 11500);
});

test('statement import: adds, a fix, and refusing a stale fix', async () => {
  const { b } = make();
  const r0 = await b.addTransaction({ type: 'spend', amount: 99, category: 'Groceries', account: 'Checking account', date: '2026-11-02' });
  const rows = (await b.reconcileData()).rows;
  assert.deepEqual(rows.map((x) => [x.date, x.account, x.category, x.out]), [['2026-11-02', 'Checking account', 'Groceries', 99]]);
  let r = await b.reconcileApply({
    fixes: [{ row: r0.row, expect: { date: '2026-11-02', account: 'Checking account', out: 99, inn: 0 }, amount: 100, account: 'Credit Card' }],
    adds: [{ date: '2026-11-03', account: 'Credit Card', paidTo: 'SUPER', category: 'Groceries', amount: 40 },
           { date: '2026-11-04', account: 'Credit Card', paidTo: 'REFUND', category: 'Groceries', amount: -10 },
           { date: '2026-11-05', account: 'Checking account', paidTo: 'Salary', income: true, amount: 3000 }] });
  assert.equal(r.added, 3);
  assert.equal(cat(r.state, 'Groceries').activity, 130);
  assert.equal(r.state.trackers[0].available, 130);
  assert.equal(r.state.accountBalance, 3000);
  r = await b.reconcileApply({ fixes: [{ row: r0.row, expect: { date: '2026-11-02', account: 'Checking account', out: 99, inn: 0 }, amount: 1 }] });
  assert.ok(!r.ok);
});
