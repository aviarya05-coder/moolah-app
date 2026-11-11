/* The engine against a real export of the personal sheet: every category,
   group, the card, the balance and Unassigned must match the sheet's own
   formulas to the agora. Skipped when no export is present (it holds real
   finances and is never committed). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { computeMonth } from '../engine/budget.js';
import { fromSheet } from './from-sheet.js';

const FX = new URL('./fixtures/live-sheet.json', import.meta.url);
const have = fs.existsSync(FX);

test('matches the live sheet, row by row', { skip: !have && 'no sheet export' }, () => {
  const fx = JSON.parse(fs.readFileSync(FX, 'utf8'));
  const { data, sheetRows, trackerNames } = fromSheet(fx);
  const m = computeMonth(data, fx.month);
  const off = [];
  const check = (label, got, want) => { if (Math.abs((got || 0) - (want || 0)) > 0.005) off.push(`${label}: engine ${got} sheet ${want}`); };
  m.categories.forEach((c) => {
    const r = sheetRows.get(c.name);
    check(c.name + ' budgeted', c.budgeted, r.budgeted);
    check(c.name + ' activity', c.activity, r.activity);
    check(c.name + ' available', c.available, r.available);
  });
  m.groups.forEach((g) => {
    const r = sheetRows.get(g.name);
    check(g.name + ' (group) budgeted', g.budgeted, r.budgeted);
    check(g.name + ' (group) available', g.available, r.available);
  });
  const t = sheetRows.get([...trackerNames][0]);
  check('card budgeted', m.cards[0].budgeted, t.budgeted);
  check('card activity', m.cards[0].activity, t.activity);
  check('card available', m.cards[0].available, t.available);
  check('balance', m.balance, fx.balance);
  check('unassigned', m.unassigned, fx.unassigned);
  assert.deepEqual(off, [], off.join('\n'));
  console.log(`  ${m.categories.length} categories, ${m.groups.length} groups and the card match; ` +
    `balance ${m.balance}, unassigned ${m.unassigned}`);
});

/* The live app's own readState output for the same export, for the
   figures the sheet does not hold in a cell: month history, life costs. */
const ST = new URL('./fixtures/live-state.json', import.meta.url);
test('history and life costs match the live app', { skip: !(have && fs.existsSync(ST)) && 'no export' }, async () => {
  const { monthHistory, lifeCosts } = await import('../engine/ops.js');
  const fx = JSON.parse(fs.readFileSync(FX, 'utf8')), st = JSON.parse(fs.readFileSync(ST, 'utf8'));
  const { data } = fromSheet(fx);
  const h = monthHistory(data, fx.month, 6);
  assert.deepEqual(h.map((m) => [m.month.slice(0, 7), m.income, m.spent]),
                   st.history.map((m) => [m.month, m.income, m.spent]));
  const lc = lifeCosts(data, fx.month);
  assert.equal(lc.total, st.trueMonthlyTotal);
  console.log('  history', h.filter((m) => m.spent || m.income).map((m) => m.month.slice(0, 7) + ' ' + m.spent + '/' + m.income).join(', '),
    '| life costs', lc.total, '| unconfirmed', lc.categories.filter((c) => !c.confirmed).length);
});

/* The state the screens read, against the live app's readState for the same
   export: everything but the sheet's row numbers and its own card name. */
test('the screens get the same state as from the live app', { skip: !(have && fs.existsSync(ST)) && 'no export' }, async () => {
  const { buildState, CARD_PAYMENT } = await import('../engine/state.js');
  const fx = JSON.parse(fs.readFileSync(FX, 'utf8')), live = JSON.parse(fs.readFileSync(ST, 'utf8'));
  const { data } = fromSheet(fx);
  const s = buildState(data, fx.month, live.today);
  for (const k of ['monthLabel', 'monthStartISO', 'toBeBudgeted', 'accountBalance', 'trueMonthlyTotal', 'lastMonthLabel', 'cardSetDate', 'accounts'])
    assert.deepEqual(s[k], live[k], k);
  const strip = (cs) => cs.filter((c) => c.name !== CARD_PAYMENT && !/credit card pay/i.test(c.name)).map((c) => ({ ...c, row: 0 }));
  assert.deepEqual(s.groups.filter((g) => g.name !== 'Transfers').map((g) => [g.name, strip(g.categories)]),
                   live.groups.map((g) => [g.name, strip(g.categories)]).filter(([, c]) => c.length || true), 'groups and categories');
  assert.deepEqual(s.trackers.map(({ name, ...rest }) => rest), live.trackers.map(({ name, ...rest }) => rest), 'card figures');
  assert.deepEqual(s.history, live.history, 'history');
  assert.deepEqual(s.quick, live.quick, 'quick picks');
  const row = (r) => [r.date, r.amount, r.income, r.category, r.paidTo, r.account, r.by, r.thisMonth];
  assert.deepEqual(s.recent.map(row), live.recent.map(row), 'recent');
  const tx = (r) => [r.iso, r.date, r.amount, r.income, r.category, r.paidTo, r.account, r.by];
  assert.deepEqual(s.transactions.map(tx), live.transactions.map(tx), 'this and last month');
  console.log('  state matches: groups', s.groups.length - 1, '| recent', s.recent.length, '| transactions', s.transactions.length, '| quick', s.quick.join(', '));
});
