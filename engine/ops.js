/**
 * The changes the screens make, as pure functions: each takes the data and
 * a request, checks it against the numbers computeMonth gives, and returns
 * the rows to add. Nothing is ever edited in place, so every change can be
 * undone by adding its opposite, and the history stays whole.
 */
import { computeMonth, cents, addMonths } from './budget.js';

const UNASSIGNED = 'unassigned';

/**
 * Give money a job, or move it between jobs, in one go.
 * moves: [{ from, to, amount }] where from/to is a category id, a card as
 * { cardId }, or 'unassigned'. Returns { ok, assignments } or { ok:false, error }.
 * Refused when it would leave Unassigned below zero.
 */
export function moveMoney(data, month, moves) {
  if (!Array.isArray(moves) || !moves.length) return { ok: false, error: 'Nothing to move.' };
  const rows = [];
  let fromU = 0, toU = 0;
  const side = (x, amount) => {
    if (x === UNASSIGNED) return null;
    if (x && typeof x === 'object' && x.cardId) return { month, cardId: x.cardId, amount };
    return { month, categoryId: x, amount };
  };
  for (const m of moves) {
    const amount = cents(Math.abs(m.amount));
    if (!amount) return { ok: false, error: 'Every move needs an amount.' };
    if (!m.from || !m.to) return { ok: false, error: 'Every move needs both sides.' };
    if (m.from === m.to) return { ok: false, error: 'A category cannot cover itself.' };
    if (m.from === UNASSIGNED && m.to === UNASSIGNED) return { ok: false, error: 'Every move needs both sides.' };
    const a = side(m.from, -amount), b = side(m.to, amount);
    if (a) rows.push(a); else fromU += amount;
    if (b) rows.push(b); else toU += amount;
  }
  const now = computeMonth(data, month);
  if (cents(now.unassigned - fromU + toU) < 0) {
    return { ok: false, error: 'Not enough unassigned for that. Nothing was moved.' };
  }
  return { ok: true, assignments: rows };
}

/**
 * Reset to what the bank and card company show, without going line by line.
 * The checking gap becomes one uncategorised "Balance adjustment" on the
 * cash account; the card gap moves what is held for the card, so Unassigned
 * moves the other way; with clearOverspent, every category below zero is
 * covered from Unassigned. Refused, before anything, if Unassigned would go
 * below zero while clearing.
 */
export function setBalances(data, month, p) {
  const want = (v) => (v === null || v === undefined || String(v).trim() === '') ? null : cents(v);
  const cash = want(p.cash), owed = want(p.card);
  if (cash === null && owed === null && !p.clearOverspent) return { ok: false, error: 'Enter at least one balance.' };
  if (owed !== null && owed < 0) return { ok: false, error: 'What is owed on the card cannot be negative.' };
  const now = computeMonth(data, month);
  const cashAcct = (data.accounts || []).find((a) => a.id === p.cashAccountId) || (data.accounts || []).find((a) => a.kind === 'cash');
  const card = now.cards.find((c) => c.id === p.cardId) || now.cards[0];
  if (owed !== null && !card) return { ok: false, error: 'There is no credit card to set.' };
  const dCash = cash === null ? 0 : cents(cash - now.balance);
  const dCard = owed === null ? 0 : cents(owed - card.available);
  const covers = p.clearOverspent ? now.categories.filter((c) => c.available < 0) : [];
  const covered = cents(covers.reduce((s, c) => s - c.available, 0));
  if (covers.length && cents(now.unassigned + dCash - dCard - covered) < 0) {
    return { ok: false, error: 'Not enough unassigned to clear all the overspending. Nothing was changed.' };
  }
  const transactions = [], assignments = [];
  if (dCash) transactions.push({ date: p.date, accountId: cashAcct.id, payee: 'Balance adjustment', categoryId: null,
    outflow: dCash < 0 ? -dCash : 0, inflow: dCash > 0 ? dCash : 0 });
  if (dCard) assignments.push({ month, cardId: card.id, amount: dCard, note: 'card balance set ' + p.date });
  covers.forEach((c) => assignments.push({ month, categoryId: c.id, amount: cents(-c.available) }));
  return { ok: true, transactions, assignments, cash: dCash, card: dCard, cleared: covers.length, unchanged: !dCash && !dCard && !covers.length };
}

/**
 * What each category was given in a month (for "add last month's amounts"
 * and the life-cost suggestion).
 */
export function assignedIn(data, month) {
  const out = new Map();
  for (const a of data.assignments || []) {
    if (a.month !== month || a.categoryId == null) continue;
    out.set(a.categoryId, cents((out.get(a.categoryId) || 0) + (Number(a.amount) || 0)));
  }
  return out;
}

/**
 * What your life costs: every category at its monthly cost. A category
 * without one counts at what it got in the last full month, or the month
 * before when that was nothing, until it is confirmed.
 */
export function lifeCosts(data, month) {
  const prev = assignedIn(data, addMonths(month, -1)), prev2 = assignedIn(data, addMonths(month, -2));
  const rows = (data.categories || []).map((c) => {
    const a = prev.get(c.id) || 0, b = prev2.get(c.id) || 0;
    const suggest = a > 0 ? { amount: a, from: addMonths(month, -1) } : (b > 0 ? { amount: b, from: addMonths(month, -2) } : { amount: 0, from: null });
    const set = typeof c.monthlyCost === 'number' && isFinite(c.monthlyCost);
    return { id: c.id, name: c.name, cost: set ? c.monthlyCost : suggest.amount, confirmed: set, suggest };
  });
  return { total: cents(rows.reduce((s, r) => s + r.cost, 0)), categories: rows };
}

/**
 * Month by month, for checking the plan against what happened: income
 * (inflows with no category, on cash accounts), spending (purchases less
 * refunds) and spending per category. Card payments and balance
 * adjustments are neither.
 */
export function monthHistory(data, month, back = 6) {
  const months = [];
  for (let k = -back; k <= 0; k++) months.push({ month: addMonths(month, k), current: k === 0, income: 0, spent: 0, cats: {} });
  const at = new Map(months.map((m) => [m.month.slice(0, 7), m]));
  for (const t of data.transactions || []) {
    const m = at.get(String(t.date).slice(0, 7));
    if (!m || t.payCardId) continue;
    if (t.categoryId == null && /^balance adjustment$/i.test(String(t.payee || '').trim())) continue;
    const out = Number(t.outflow) || 0, inn = Number(t.inflow) || 0;
    if (t.categoryId == null && !out) { m.income += inn; continue; }
    m.spent += out - inn;                        // purchases less refunds, uncategorised ones too
    if (t.categoryId != null) m.cats[t.categoryId] = (m.cats[t.categoryId] || 0) + out - inn;
  }
  months.forEach((m) => { m.income = cents(m.income); m.spent = cents(m.spent); });
  return months;
}
