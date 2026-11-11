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
