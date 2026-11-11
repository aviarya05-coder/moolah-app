/**
 * A new household, from the first-run choices: a name, a currency, the
 * accounts, which starter categories to keep, and (optionally) what the
 * accounts hold today.
 *
 * It starts empty: starter categories are names only, nothing is assigned,
 * and the only transactions are the opening balances the person typed in.
 * No figure from anyone else's budget is ever part of it.
 */
import { cents } from './budget.js';

/* Generic starters: common envelopes, grouped. People untick what they do
   not need and add their own later. */
export const STARTER = [
  { group: 'Home', categories: [['Rent or mortgage', 'fixed'], ['Home insurance', 'fixed'], ['Repairs', 'normal'], ['Cleaning', 'normal']] },
  { group: 'Bills', categories: [['Electricity', 'fixed'], ['Water', 'fixed'], ['Gas', 'fixed'], ['Phone', 'fixed'], ['Internet', 'fixed']] },
  { group: 'Food', categories: [['Groceries', 'normal'], ['Eating out', 'flexible']] },
  { group: 'Transport', categories: [['Fuel', 'normal'], ['Car insurance', 'fixed'], ['Car maintenance', 'normal'], ['Public transport', 'normal'], ['Parking', 'normal']] },
  { group: 'Health', categories: [['Health insurance', 'fixed'], ['Pharmacy', 'normal'], ['Doctor and dentist', 'normal']] },
  { group: 'Kids', categories: [['Childcare', 'fixed'], ['School', 'fixed'], ['Activities', 'normal'], ['Allowance', 'normal']] },
  { group: 'Personal', categories: [['Clothing', 'flexible'], ['Haircuts and beauty', 'flexible'], ['Subscriptions', 'fixed'], ['Gifts', 'flexible'], ['Fitness', 'normal']] },
  { group: 'Saving for', categories: [['Holidays', 'flexible'], ['Emergency fund', 'normal']] },
  { group: 'Other', categories: [['Giving', 'normal'], ['Forgot to budget for', 'flexible']] },
];

export const CURRENCIES = [
  ['ILS', '₪ Israeli shekel'], ['USD', '$ US dollar'], ['EUR', '€ Euro'], ['GBP', '£ British pound'],
  ['CAD', '$ Canadian dollar'], ['AUD', '$ Australian dollar'],
];

/**
 * choices: { name, currency, cash: { name, balance? }, card?: { name, owed? },
 *            keep: [category names] (default: all), date: 'YYYY-MM-DD' }
 * Returns the household's five lists, ready for a store, or { error }.
 */
export function newHousehold(choices) {
  const name = String(choices.name || '').trim() || 'Our household';
  const currency = CURRENCIES.some(([c]) => c === choices.currency) ? choices.currency : 'ILS';
  const cashName = String((choices.cash && choices.cash.name) || '').trim() || 'Checking account';
  const cardName = choices.card ? (String(choices.card.name || '').trim() || 'Credit card') : null;
  if (cardName && cardName.toLowerCase() === cashName.toLowerCase()) return { error: 'Give the card and the bank account different names.' };
  const keep = choices.keep ? new Set(choices.keep.map((n) => n.toLowerCase())) : null;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(choices.date || '')) ? choices.date : new Date().toISOString().slice(0, 10);

  const accounts = [{ id: 'acct-cash', name: cashName, kind: 'cash', sort: 1 }];
  if (cardName) accounts.push({ id: 'acct-card', name: cardName, kind: 'credit', sort: 2 });
  const groups = [], categories = [];
  STARTER.forEach((g, gi) => {
    const kept = g.categories.filter(([n]) => !keep || keep.has(n.toLowerCase()));
    if (!kept.length) return;
    const gid = 'grp-' + gi;
    groups.push({ id: gid, name: g.group, sort: gi + 1 });
    kept.forEach(([n, priority], ci) => categories.push({ id: 'cat-' + gi + '-' + ci, groupId: gid, name: n, sort: ci + 1, priority, monthlyCost: null }));
  });

  // opening balances, if given: money in the bank is income to give jobs to;
  // what is owed on the card is held for it, so it is not double-spent
  const transactions = [], assignments = [];
  const bal = cents(choices.cash && choices.cash.balance);
  if (bal) transactions.push({ date, accountId: 'acct-cash', payee: 'Starting balance', categoryId: null, payCardId: null,
    outflow: bal < 0 ? -bal : 0, inflow: bal > 0 ? bal : 0, seq: 1 });
  const owed = cents(choices.card && choices.card.owed);
  if (cardName && owed > 0) assignments.push({ month: date.slice(0, 7) + '-01', cardId: 'acct-card', amount: owed, note: 'card balance set ' + date });

  return { household: { name, currency }, accounts, groups, categories, assignments, transactions };
}
