/**
 * The state the screens draw from, built from the five lists.
 *
 * The screens came from the personal Moolah, which read this exact shape
 * from its spreadsheet server (readState). Building the same shape here
 * lets them run unchanged on the new data: categories, groups and the card
 * with their figures, Unassigned, recent and this-and-last-month
 * transactions, the quick picks on the Log screen, life costs and the
 * month-by-month history.
 *
 * Ids stand in for the sheet's row numbers (`row`). A payment to a credit
 * card is shown as the category "Credit card payment", as the sheet had it;
 * the backend turns that choice back into a payment (payCardId).
 */
import { computeMonth, addMonths, cents } from './budget.js';
import { lifeCosts, monthHistory, assignedIn } from './ops.js';

export const CARD_PAYMENT = 'Credit card payment';
const SYMBOL = { ILS: '₪', USD: '$', EUR: '€', GBP: '£', CAD: '$', AUD: '$' };

const label = (monthISO, opts) => new Date(monthISO + 'T12:00:00Z').toLocaleDateString('en-GB', { ...opts, timeZone: 'UTC' });
const shortDate = (iso) => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

export function buildState(data, month, today, opts = {}) {
  const m = computeMonth(data, month);
  const accounts = [...(data.accounts || [])].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
  const acctName = new Map(accounts.map((a) => [a.id, a.name]));
  const cats = new Map((data.categories || []).map((c) => [c.id, c]));
  const catName = (id) => (cats.get(id) || {}).name || '';
  const prevMonth = addMonths(month, -1);
  const lastAssigned = assignedIn(data, prevMonth);
  const lc = lifeCosts(data, month);
  const life = new Map(lc.categories.map((c) => [c.id, c]));
  const monthName = (iso) => (iso ? label(iso, { month: 'long' }) : '');

  const groups = m.groups.map((g) => ({
    name: g.name,
    categories: g.categories.map((c) => {
      const src = cats.get(c.id) || {}, l = life.get(c.id);
      return {
        name: c.name, row: c.id, budgeted: c.budgeted, activity: c.activity, available: c.available,
        group: g.name, transferable: true, priority: src.priority || 'normal',
        trueMonthly: l ? l.cost : 0, trueState: l && l.confirmed ? 'set' : 'unreviewed',
        trueSuggest: l ? l.suggest.amount : 0, trueFrom: l ? monthName(l.suggest.from) : '',
        lastMonth: lastAssigned.get(c.id) || 0,
      };
    }),
  }));
  // a card payment is chosen like a category, so the screens list it as one
  if (m.cards.length) {
    groups.push({ name: 'Transfers', categories: [{
      name: CARD_PAYMENT, row: 'pay:' + m.cards[0].id, budgeted: 0, activity: 0, available: 0, group: 'Transfers',
      transferable: false, priority: 'fixed', trueMonthly: 0, trueState: 'none', trueSuggest: 0, trueFrom: '', lastMonth: 0,
    }] });
  }

  // in the order they were entered, as the sheet kept them: "recent" means
  // most recently logged, not latest dated
  const txs = [...(data.transactions || [])].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  const shape = (t) => {
    const out = Number(t.outflow) || 0, inn = Number(t.inflow) || 0;
    const income = !t.categoryId && !t.payCardId && !out && inn > 0;
    const category = t.payCardId ? CARD_PAYMENT : catName(t.categoryId);
    return { row: t.id, iso: t.date, date: shortDate(t.date),
      // a refund shows as a negative purchase, the way the sheet kept them
      amount: income ? inn : (out || -inn), income, category,
      paidTo: t.payee || '', account: acctName.get(t.accountId) || '', by: t.by || '' };
  };

  const end = addMonths(month, 1), lastStart = prevMonth;
  const transactions = txs.filter((t) => t.date >= lastStart && t.date < end && ((Number(t.outflow) || 0) || (Number(t.inflow) || 0))).map(shape);

  const recent = [], counts = {};
  const cutoff = new Date(new Date(today + 'T12:00:00Z').getTime() - 60 * 86400000).toISOString().slice(0, 10);
  for (let i = txs.length - 1; i >= 0; i--) {
    const t = txs[i];
    const name = t.payCardId ? CARD_PAYMENT : catName(t.categoryId);
    if (name && (Number(t.outflow) || 0)) counts[name] = (counts[name] || 0) + (t.date >= cutoff ? 1 : 0.35);
    if (recent.length >= 10) continue;
    const s = shape(t);
    if (!s.amount && !s.category) continue;
    recent.push({ row: s.row, date: s.date, amount: s.amount,
      income: s.income, category: s.category || (s.income ? 'Income' : ''), paidTo: s.paidTo,
      account: s.account, by: s.by, thisMonth: t.date >= month });
  }

  // quick picks on the Log screen: the everyday categories used most lately
  const quick = groups.flatMap((g) => g.categories).filter((c) => c.priority !== 'fixed')
    .sort((a, b) => ((counts[b.name] || 0) - (counts[a.name] || 0)) || (b.budgeted - a.budgeted))
    .slice(0, 4).map((c) => c.name);

  const history = monthHistory(data, month, 6).map((h) => ({
    month: h.month.slice(0, 7), label: label(h.month, { month: 'short' }), current: h.current,
    income: h.income, spent: h.spent,
    cats: Object.fromEntries(Object.entries(h.cats).map(([id, v]) => [catName(id), cents(v)])),
  }));

  let cardSetDate = '';
  (data.assignments || []).forEach((a) => {
    const x = /card balance set (\d{4}-\d{2}-\d{2})/i.exec(String(a.note || ''));
    if (a.cardId && x && x[1] > cardSetDate) cardSetDate = x[1];
  });

  return {
    ok: true,
    currency: SYMBOL[opts.currency] || opts.currency || '₪',
    build: opts.build || 'local',
    quick,
    monthLabel: label(month, { month: 'long', year: 'numeric' }),
    today,
    monthStartISO: month,
    toBeBudgeted: m.unassigned,
    goals: 0,
    accountBalance: m.balance,
    trueMonthlyTotal: lc.total,
    trackers: m.cards.map((c) => ({ name: c.name, budgeted: c.budgeted, activity: c.activity, available: c.available })),
    cardSetDate,
    groups,
    accounts: accounts.filter((a) => !a.archived).map((a) => a.name),
    recent,
    transactions,
    history,
    lastMonthLabel: monthName(prevMonth),
    me: opts.me || null,
    prefs: opts.prefs || {},
  };
}
