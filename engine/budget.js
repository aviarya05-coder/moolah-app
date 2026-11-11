/**
 * The budget engine: every figure Moolah shows, worked out from five lists.
 *
 * It replaces the formulas in the personal Moolah's Google Sheet, rule for
 * rule, so a household moved across gets exactly the numbers it had:
 *
 *   category Available   everything ever assigned to it up to this month,
 *                        less everything spent in it up to the end of this
 *                        month. Money left over rolls forward; so does an
 *                        overspend, until something covers it.
 *   card Available       what is held to pay a credit card: assigned to it,
 *                        plus every purchase on it, less every payment to it.
 *                        A purchase moves money from its category to the
 *                        card, so it never changes Unassigned.
 *   balance              the cash accounts: every inflow less every outflow.
 *   Unassigned           the balance less everything held in categories and
 *                        for cards: money with no job yet.
 *
 * Pure functions over plain data, no I/O, so the same code runs in the app,
 * on a server and in tests.
 *
 * Data
 *   accounts      { id, name, kind: 'cash' | 'credit' }
 *   groups        { id, name, sort }
 *   categories    { id, groupId, name, sort, monthlyCost? }
 *   assignments   { month: 'YYYY-MM-01', categoryId? | cardId?, amount }
 *                 money given a job that month (negative takes it back)
 *   transactions  { date: 'YYYY-MM-DD', accountId, categoryId?, payCardId?,
 *                   outflow, inflow }
 *                 a purchase has a category; income has neither; a card
 *                 payment is an outflow from a cash account with payCardId.
 *                 A refund is an inflow with a category (or a negative
 *                 outflow, as the sheet recorded them).
 */

export const cents = (n) => {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  return v === 0 ? 0 : v;           // no -0
};

/** 'YYYY-MM-01' for the month a date falls in. */
export const monthOf = (iso) => String(iso).slice(0, 7) + '-01';

/** The last day of a month, as 'YYYY-MM-DD'. */
export function monthEnd(monthISO) {
  const y = +monthISO.slice(0, 4), m = +monthISO.slice(5, 7);
  const d = new Date(Date.UTC(y, m, 0));
  return d.toISOString().slice(0, 10);
}

/** The month n months after (or before) a month. */
export function addMonths(monthISO, n) {
  const y = +monthISO.slice(0, 4), m = +monthISO.slice(5, 7) - 1 + n;
  const d = new Date(Date.UTC(y, m, 1));
  return d.toISOString().slice(0, 10);
}

const net = (t) => (Number(t.outflow) || 0) - (Number(t.inflow) || 0);

/**
 * Everything the screens show for one month.
 *
 * Returns
 *   { month, balance, held, unassigned,
 *     categories: [{ id, groupId, name, budgeted, activity, available }],
 *     groups:     [{ id, name, budgeted, activity, available, categories }],
 *     cards:      [{ id, name, budgeted, activity, available }] }
 */
export function computeMonth(data, month) {
  const end = monthEnd(month);
  const accounts = data.accounts || [];
  const kind = new Map(accounts.map((a) => [a.id, a.kind]));
  const cats = new Map((data.categories || []).map((c) => [c.id, {
    id: c.id, groupId: c.groupId, name: c.name, sort: c.sort ?? 0,
    budgeted: 0, activity: 0, available: 0,
  }]));
  const cards = new Map(accounts.filter((a) => a.kind === 'credit').map((a) => [a.id, {
    id: a.id, name: a.name, budgeted: 0, activity: 0, available: 0,
  }]));

  for (const a of data.assignments || []) {
    if (a.month > month) continue;
    const row = a.categoryId != null ? cats.get(a.categoryId) : cards.get(a.cardId);
    if (!row) continue;
    row.available += Number(a.amount) || 0;
    if (a.month === month) row.budgeted += Number(a.amount) || 0;
  }

  let balance = 0;
  for (const t of data.transactions || []) {
    if (t.date > end) continue;                     // dated into a later month
    const thisMonth = t.date >= month;
    const k = kind.get(t.accountId);
    if (k === 'cash') balance += (Number(t.inflow) || 0) - (Number(t.outflow) || 0);

    const c = t.categoryId != null ? cats.get(t.categoryId) : null;
    if (c) {
      c.available -= net(t);
      if (thisMonth) c.activity += net(t);
    }
    // a purchase on a card: the money it held moves to the card
    const onCard = k === 'credit' ? cards.get(t.accountId) : null;
    if (onCard && !t.payCardId) {
      onCard.available += net(t);
      if (thisMonth) onCard.activity += net(t);
    }
    // a payment to a card: the money held for it leaves
    const paid = t.payCardId != null ? cards.get(t.payCardId) : null;
    if (paid) {
      paid.available -= net(t);
      if (thisMonth) paid.activity -= net(t);
    }
  }

  const round = (r) => { r.budgeted = cents(r.budgeted); r.activity = cents(r.activity); r.available = cents(r.available); return r; };
  const categories = [...cats.values()].map(round);
  const cardRows = [...cards.values()].map(round);
  const held = cents(categories.reduce((s, c) => s + c.available, 0) +
                     cardRows.reduce((s, c) => s + c.available, 0));

  const groups = [...(data.groups || [])].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0)).map((g) => {
    const mine = categories.filter((c) => c.groupId === g.id).sort((a, b) => a.sort - b.sort);
    return round({
      id: g.id, name: g.name, categories: mine,
      budgeted: mine.reduce((s, c) => s + c.budgeted, 0),
      activity: mine.reduce((s, c) => s + c.activity, 0),
      available: mine.reduce((s, c) => s + c.available, 0),
    });
  });

  return {
    month, balance: cents(balance), held, unassigned: cents(balance - held),
    categories, groups, cards: cardRows,
  };
}
