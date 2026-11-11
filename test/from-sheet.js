/* Turns an export of the personal Moolah's Google Sheet into the engine's
   data model, the way an import for an existing user would. Used by the
   check against real figures; the export itself is never committed. */
const CARD_PAY = /credit\s*card\s*pay(ment)?\b/i;
const CARD_ACCT = /credit|card|visa|master|isracard|amex/i;

export function fromSheet(fx) {
  const accountNames = [...new Set(fx.transactions.map((t) => t.account).filter(Boolean))];
  const accounts = accountNames.map((name, i) => ({ id: 'a' + i, name, kind: CARD_ACCT.test(name) ? 'credit' : 'cash' }));
  const acct = new Map(accounts.map((a) => [a.name, a.id]));
  const card = accounts.find((a) => a.kind === 'credit');

  const groups = [], categories = [], trackerNames = new Set(), sheetRows = new Map();
  let group = null;
  fx.budget.forEach((r) => {
    if (r.flag === 1 && /debt/i.test(r.name)) { trackerNames.add(r.name); sheetRows.set(r.name, r); return; }
    if (r.flag === 1) {
      const pr = String(r.priority || '').toLowerCase();
      categories.push({ id: 'c' + categories.length, groupId: group, name: r.name, sort: r.row,
        priority: pr.startsWith('fix') ? 'fixed' : pr.startsWith('flex') ? 'flexible' : 'normal',
        monthlyCost: typeof r.k === 'number' ? r.k : null });
      sheetRows.set(r.name, r);
      return;
    }
    if (CARD_PAY.test(r.name)) return;           // the sheet's payment marker, not an envelope
    group = 'g' + groups.length;
    groups.push({ id: group, name: r.name, sort: r.row });
    sheetRows.set(r.name, r);
  });
  const catId = new Map(categories.map((c) => [c.name, c.id]));

  const assignments = fx.budgets.map((b) => trackerNames.has(b.name)
    ? { month: b.month, cardId: card && card.id, amount: b.amount || 0, note: b.note || '' }
    : { month: b.month, categoryId: catId.get(b.name), amount: b.amount || 0, note: b.note || '' })
    .filter((a) => a.categoryId || a.cardId);

  const transactions = fx.transactions.map((t, seq) => {
    const pay = t.category && CARD_PAY.test(t.category);
    return { id: 't' + seq, seq, by: t.by || '', date: t.date, accountId: acct.get(t.account), payee: t.payee || '',
      categoryId: !pay && t.category ? catId.get(t.category) : null,
      payCardId: pay && card ? card.id : null,
      outflow: t.out || 0, inflow: t.in || 0 };
  });
  return { data: { accounts, groups, categories, assignments, transactions }, sheetRows, trackerNames };
}
