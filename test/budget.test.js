/* The budget rules, on a small made-up household. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeMonth, monthEnd, addMonths } from '../engine/budget.js';
import { moveMoney, setBalances, lifeCosts, monthHistory } from '../engine/ops.js';

const base = () => ({
  accounts: [{ id: 'chk', name: 'Checking', kind: 'cash' }, { id: 'cc', name: 'Visa', kind: 'credit' }],
  groups: [{ id: 'g1', name: 'Home', sort: 1 }, { id: 'g2', name: 'Fun', sort: 2 }],
  categories: [
    { id: 'rent', groupId: 'g1', name: 'Rent', sort: 1 },
    { id: 'food', groupId: 'g1', name: 'Groceries', sort: 2 },
    { id: 'trip', groupId: 'g2', name: 'Holiday', sort: 1, monthlyCost: 500 },
  ],
  assignments: [
    { month: '2026-09-01', categoryId: 'rent', amount: 4000 },
    { month: '2026-09-01', categoryId: 'food', amount: 2000 },
    { month: '2026-09-01', categoryId: 'trip', amount: 500 },
    { month: '2026-10-01', categoryId: 'rent', amount: 4000 },
    { month: '2026-10-01', categoryId: 'food', amount: 1500 },
    { month: '2026-10-01', categoryId: 'trip', amount: 500 },
  ],
  transactions: [
    { date: '2026-09-01', accountId: 'chk', payee: 'Salary', categoryId: null, outflow: 0, inflow: 10000 },
    { date: '2026-09-02', accountId: 'chk', payee: 'Landlord', categoryId: 'rent', outflow: 4000, inflow: 0 },
    { date: '2026-09-10', accountId: 'cc', payee: 'Shop', categoryId: 'food', outflow: 1800, inflow: 0 },
    { date: '2026-10-01', accountId: 'chk', payee: 'Salary', categoryId: null, outflow: 0, inflow: 10000 },
    { date: '2026-10-02', accountId: 'chk', payee: 'Landlord', categoryId: 'rent', outflow: 4000, inflow: 0 },
    { date: '2026-10-05', accountId: 'cc', payee: 'Shop', categoryId: 'food', outflow: 1900, inflow: 0 },
    { date: '2026-10-07', accountId: 'cc', payee: 'Shop refund', categoryId: 'food', outflow: 0, inflow: 100 },
    { date: '2026-10-08', accountId: 'chk', payee: 'Visa', categoryId: null, payCardId: 'cc', outflow: 1800, inflow: 0 },
    { date: '2026-11-03', accountId: 'cc', payee: 'Instalment 2/3', categoryId: 'food', outflow: 300, inflow: 0 },
  ],
});

test('dates', () => {
  assert.equal(monthEnd('2026-02-01'), '2026-02-28');
  assert.equal(monthEnd('2028-02-01'), '2028-02-29');
  assert.equal(addMonths('2026-11-01', 2), '2027-01-01');
  assert.equal(addMonths('2026-01-01', -1), '2025-12-01');
});

test('rollover, the card, and Unassigned in October', () => {
  const m = computeMonth(base(), '2026-10-01');
  const c = Object.fromEntries(m.categories.map((x) => [x.id, x]));
  assert.deepEqual([c.rent.budgeted, c.rent.activity, c.rent.available], [4000, 4000, 0]);
  // Groceries: 3,500 given, 1,800 + 1,900 − 100 spent; the 200 over in October carries
  assert.deepEqual([c.food.budgeted, c.food.activity, c.food.available], [1500, 1800, -100]);
  assert.equal(c.trip.available, 1000);                        // a sinking fund builds
  // the card holds every purchase less the payment: 1,800 + 1,900 − 100 − 1,800
  assert.deepEqual([m.cards[0].activity, m.cards[0].available], [0, 1800]);
  // balance: 20,000 in, 4,000 + 4,000 rent and the 1,800 payment out
  assert.equal(m.balance, 10200);
  assert.equal(m.unassigned, 10200 - (0 - 100 + 1000 + 1800));
  assert.equal(m.groups[0].available, -100);
});

test('a card purchase never changes Unassigned; a payment never does either', () => {
  const d = base();
  const before = computeMonth(d, '2026-10-01').unassigned;
  d.transactions.push({ date: '2026-10-20', accountId: 'cc', categoryId: 'food', outflow: 250, inflow: 0 });
  assert.equal(computeMonth(d, '2026-10-01').unassigned, before);
  d.transactions.push({ date: '2026-10-21', accountId: 'chk', categoryId: null, payCardId: 'cc', outflow: 250, inflow: 0 });
  assert.equal(computeMonth(d, '2026-10-01').unassigned, before);
});

test('a row dated into a later month waits for it', () => {
  const oct = computeMonth(base(), '2026-10-01'), nov = computeMonth(base(), '2026-11-01');
  const f = (m) => m.categories.find((x) => x.id === 'food');
  assert.equal(f(oct).available, -100);
  assert.equal(f(nov).available, -400);
  assert.equal(f(nov).activity, 300);
});

test('moving money, and refusing what Unassigned cannot cover', () => {
  const d = base();
  const u = computeMonth(d, '2026-10-01').unassigned;
  const r = moveMoney(d, '2026-10-01', [{ from: 'unassigned', to: 'food', amount: 100 }, { from: 'trip', to: 'rent', amount: 50 }]);
  assert.ok(r.ok);
  d.assignments.push(...r.assignments);
  const m = computeMonth(d, '2026-10-01');
  assert.equal(m.unassigned, u - 100);
  assert.equal(m.categories.find((x) => x.id === 'food').available, 0);
  assert.equal(m.categories.find((x) => x.id === 'trip').available, 950);
  assert.ok(!moveMoney(d, '2026-10-01', [{ from: 'unassigned', to: 'rent', amount: u + 1 }]).ok);
  assert.ok(!moveMoney(d, '2026-10-01', [{ from: 'rent', to: 'rent', amount: 5 }]).ok);
  // back to Unassigned
  const back = moveMoney(d, '2026-10-01', [{ from: 'trip', to: 'unassigned', amount: 950 }]);
  d.assignments.push(...back.assignments);
  assert.equal(computeMonth(d, '2026-10-01').unassigned, u - 100 + 950);
});

test('setting balances lands exactly on them, and clears overspending when asked', () => {
  const d = base();
  const r = setBalances(d, '2026-10-01', { cash: 10000, card: 2000, clearOverspent: true, date: '2026-10-31' });
  assert.ok(r.ok);
  d.transactions.push(...r.transactions); d.assignments.push(...r.assignments);
  const m = computeMonth(d, '2026-10-01');
  assert.equal(m.balance, 10000);
  assert.equal(m.cards[0].available, 2000);
  assert.ok(m.categories.every((c) => c.available >= 0));
  // the same figures again change nothing
  assert.ok(setBalances(d, '2026-10-01', { cash: 10000, card: 2000, date: '2026-10-31' }).unchanged);
  assert.ok(!setBalances(d, '2026-10-01', { card: -1 }).ok);
});

test('life costs and the month-by-month history', () => {
  const lc = lifeCosts(base(), '2026-11-01');
  const by = Object.fromEntries(lc.categories.map((c) => [c.id, c]));
  assert.deepEqual([by.rent.cost, by.rent.confirmed, by.rent.suggest.from], [4000, false, '2026-10-01']);
  assert.deepEqual([by.trip.cost, by.trip.confirmed], [500, true]);
  assert.equal(lc.total, 4000 + 1500 + 500);
  const h = monthHistory(base(), '2026-11-01', 2);
  assert.deepEqual(h.map((x) => [x.month, x.income, x.spent]), [
    ['2026-09-01', 10000, 5800], ['2026-10-01', 10000, 5800], ['2026-11-01', 0, 300]]);
});
