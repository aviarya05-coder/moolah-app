/* A new household starts empty: names, no money but what the person types. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newHousehold, STARTER } from '../engine/setup.js';
import { createBackend, memoryStore } from '../engine/backend.js';

test('a new household has no figures of its own', async () => {
  const d = newHousehold({ name: 'Test', currency: 'USD', cash: { name: 'Bank' }, date: '2026-11-10' });
  assert.equal(d.transactions.length, 0);
  assert.equal(d.assignments.length, 0);
  assert.ok(d.categories.every((c) => c.monthlyCost === null));
  assert.equal(d.categories.length, STARTER.reduce((n, g) => n + g.categories.length, 0));
  const s = await createBackend(memoryStore(d), { today: () => '2026-11-10' }).getState();
  assert.equal(s.currency, '$');
  assert.equal(s.toBeBudgeted, 0);
  assert.equal(s.accountBalance, 0);
  assert.equal(s.trueMonthlyTotal, 0);
  assert.deepEqual([s.recent.length, s.transactions.length, s.trackers.length], [0, 0, 0]);
  assert.ok(s.groups.every((g) => g.categories.every((c) => !c.budgeted && !c.activity && !c.available)));
});

test('opening balances, the card, and a trimmed category list', async () => {
  const d = newHousehold({ name: 'T', cash: { name: 'Checking', balance: '12,500'.replace(',', '') }, card: { name: 'Visa', owed: 2300 },
    keep: ['Groceries', 'Fuel', 'Holidays'], date: '2026-11-10' });
  assert.deepEqual(d.groups.map((g) => g.name), ['Food', 'Transport', 'Saving for']);
  const s = await createBackend(memoryStore(d), { today: () => '2026-11-10' }).getState();
  assert.equal(s.accountBalance, 12500);
  assert.equal(s.trackers[0].available, 2300);          // held for the card
  assert.equal(s.toBeBudgeted, 10200);                  // what is left to give jobs to
  assert.equal(s.cardSetDate, '2026-11-10');
  assert.equal(s.currency, '₪');
  assert.ok(newHousehold({ cash: { name: 'Visa' }, card: { name: 'visa' } }).error);
});
