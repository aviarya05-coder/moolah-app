/**
 * Every action the screens perform, over a store.
 *
 * The screens call `backend[fn](payload)` exactly as the personal Moolah
 * called its server (addTransaction, moveMany, setBalances, ...), and get the
 * same answers back: { ok, ..., state } or { ok: false, error }. Here the
 * work is done by the engine against a store, which is the in-browser one
 * while there is no account (and in the preview), and Supabase once there is.
 *
 * A store holds one household's five lists and saves changes:
 *   load()                 -> { household, accounts, groups, categories, assignments, transactions }
 *   insert(table, rows)    -> rows with ids
 *   update(table, id, patch)
 *   remove(table, id)
 */
import { computeMonth, monthOf, cents } from './budget.js';
import { moveMoney as planMoves, setBalances as planBalances, lifeCosts } from './ops.js';
import { buildState, CARD_PAYMENT } from './state.js';

const isPay = (name) => /credit\s*card\s*pay(ment)?\b/i.test(String(name || ''));

export function createBackend(store, opts = {}) {
  const today = opts.today || (() => {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  });
  const me = () => (opts.me ? opts.me() : '') || '';
  let data = null;
  const load = async () => (data = await store.load());
  const month = () => monthOf(today());
  const state = () => buildState(data, month(), today(), {
    currency: data.household && data.household.currency, me: opts.me ? { name: me() } : null,
  });
  const done = async (extra) => { await load(); return { ok: true, ...extra, state: state() }; };
  const byName = (list, name) => list.find((x) => x.name.toLowerCase() === String(name || '').trim().toLowerCase());
  const account = (name) => byName(data.accounts, name);
  const category = (name) => byName(data.categories, name);
  const card = (name) => data.accounts.find((a) => a.kind === 'credit' && (!name || a.name.toLowerCase() === String(name).toLowerCase()))
    || data.accounts.find((a) => a.kind === 'credit');
  const nextSeq = () => (data.transactions || []).reduce((m, t) => Math.max(m, t.seq ?? 0), 0) + 1;
  const validDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ''));

  /* Turns a screen's choice of target into the engine's: a category name, a
     card's name (the screens show the card like a category), or Unassigned. */
  const target = (name, unassigned) => {
    if (unassigned) return 'unassigned';
    const c = category(name);
    if (c) return c.id;
    const k = data.accounts.find((a) => a.kind === 'credit' && a.name.toLowerCase() === String(name || '').toLowerCase());
    return k ? { cardId: k.id } : null;
  };

  const api = {
    async getState() { await load(); return state(); },

    async addTransaction(p) {
      await load();
      const amount = cents(Math.abs(Number(p.amount) || 0));
      if (!amount) return { ok: false, error: 'Enter an amount.' };
      const date = validDate(p.date) ? p.date : today();
      const acct = account(p.account) || data.accounts.find((a) => a.kind === 'cash');
      if (!acct) return { ok: false, error: 'Add an account first.' };
      const row = { date, accountId: acct.id, payee: String(p.paidTo || '').slice(0, 120), by: me(), seq: nextSeq(),
        categoryId: null, payCardId: null, outflow: 0, inflow: 0 };
      if (p.type === 'income') row.inflow = amount;
      else if (isPay(p.category)) {
        if (acct.kind === 'credit') return { ok: false, error: 'A card payment comes from a bank account, not the card.' };
        const k = card();
        if (!k) return { ok: false, error: 'There is no credit card to pay.' };
        row.payCardId = k.id; row.outflow = amount;
      } else {
        const c = category(p.category);
        if (!c) return { ok: false, error: 'Pick a category.' };
        row.categoryId = c.id; row.outflow = amount;
      }
      const [saved] = await store.insert('transactions', [row]);
      return done({ row: saved.id });
    },

    async deleteTransaction(p) {
      await load();
      if (!data.transactions.some((t) => t.id === p.row)) return { ok: false, error: 'That transaction is already gone.' };
      await store.remove('transactions', p.row);
      return done();
    },

    async updateTransaction(p) {
      await load();
      const t = data.transactions.find((x) => x.id === p.row);
      if (!t) return { ok: false, error: 'That transaction is gone.' };
      const amount = cents(Math.abs(Number(p.amount) || 0));
      if (!amount) return { ok: false, error: 'Enter an amount.' };
      const patch = { payee: p.paidTo !== undefined ? String(p.paidTo).slice(0, 120) : t.payee };
      const income = !t.categoryId && !t.payCardId && !(Number(t.outflow) || 0);
      if (income) patch.inflow = amount;
      else {
        patch.outflow = amount; patch.inflow = 0;
        if (p.category) {
          if (isPay(p.category)) { patch.payCardId = (card() || {}).id || null; patch.categoryId = null; }
          else { const c = category(p.category); if (!c) return { ok: false, error: 'Pick a category.' }; patch.categoryId = c.id; patch.payCardId = null; }
        }
      }
      await store.update('transactions', t.id, patch);
      return done();
    },

    async moveMoney(p) { return api.moveMany({ moves: [p] }); },

    async moveMany(p) {
      await load();
      const moves = [];
      for (const m of p.moves || []) {
        const from = target(m.from, m.fromUnassigned), to = target(m.to, m.toUnassigned);
        if (!from || !to) return { ok: false, error: 'Every move needs both sides.' };
        moves.push({ from, to, amount: m.amount });
      }
      const r = planMoves(data, month(), moves);
      if (!r.ok) return r;
      await store.insert('assignments', r.assignments);
      return done({ count: moves.length });
    },

    async setTrueRate(p) {
      await load();
      const c = data.categories.find((x) => x.id === p.row) || category(p.category);
      if (!c) return { ok: false, error: 'Unknown category.' };
      const amount = p.amount === null || p.amount === undefined || p.amount === '' ? null : cents(Math.abs(Number(p.amount)));
      await store.update('categories', c.id, { monthlyCost: amount });
      return done({ category: c.name, amount });
    },

    async confirmRestMonthly() {
      await load();
      const todo = lifeCosts(data, month()).categories.filter((c) => !c.confirmed);
      for (const c of todo) await store.update('categories', c.id, { monthlyCost: c.cost });
      return done({ count: todo.length, categories: todo.map((c) => c.name) });
    },

    async setBalances(p) {
      await load();
      const k = card();
      const r = planBalances(data, month(), { cash: p.checking, card: p.card, clearOverspent: p.clearOverspent === true,
        date: validDate(p.date) ? p.date : today(), cardId: k && k.id });
      if (!r.ok) return r;
      const day = validDate(p.date) ? p.date : today();
      const cardGiven = p.card !== null && p.card !== undefined && String(p.card).trim() !== '';
      if (r.transactions.length) await store.insert('transactions', r.transactions.map((t) => ({ ...t, by: me(), seq: nextSeq() })));
      // the day the card figure was given, even when it already matched, so a
      // statement imported later knows which charges it already holds
      const rows = r.assignments.slice();
      if (cardGiven && k && !rows.some((x) => x.cardId)) rows.push({ month: month(), cardId: k.id, amount: 0, note: 'card balance set ' + day });
      if (rows.length) await store.insert('assignments', rows);
      return done({ cash: r.cash, card: r.card, cleared: r.cleared, unchanged: r.unchanged });
    },

    /* The whole register, compactly, for matching statements in the screen. */
    async reconcileData() {
      await load();
      const name = (id) => (data.accounts.find((a) => a.id === id) || {}).name || '';
      const cat = (t) => t.payCardId ? CARD_PAYMENT : ((data.categories.find((c) => c.id === t.categoryId) || {}).name || '');
      return { ok: true, rows: data.transactions.map((t) => ({ row: t.id, date: t.date, account: name(t.accountId),
        paidTo: t.payee || '', category: cat(t), out: Number(t.outflow) || 0, inn: Number(t.inflow) || 0 })) };
    },

    /* An approved reconciliation: fixes first (each checked against what the
       screen saw, and the whole thing refused if any row changed), then the
       new entries. */
    async reconcileApply(p) {
      await load();
      for (const f of p.fixes || []) {
        const t = data.transactions.find((x) => x.id === f.row);
        const acctName = t && (data.accounts.find((a) => a.id === t.accountId) || {}).name;
        if (!t || (f.expect && (t.date !== f.expect.date || acctName !== f.expect.account ||
            cents(t.outflow) !== cents(f.expect.out) || cents(t.inflow) !== cents(f.expect.inn)))) {
          return { ok: false, error: 'A row changed since the comparison. Nothing was written — compare again.' };
        }
      }
      for (const f of p.fixes || []) {
        const t = data.transactions.find((x) => x.id === f.row), patch = {};
        if (f.amount !== null && f.amount !== undefined) { if (Number(t.inflow) && !Number(t.outflow)) patch.inflow = cents(f.amount); else patch.outflow = cents(f.amount); }
        if (f.account) { const a = account(f.account); if (a) patch.accountId = a.id; }
        await store.update('transactions', t.id, patch);
      }
      const rows = [];
      let seq = nextSeq();
      for (const a of p.adds || []) {
        const acct = account(a.account) || data.accounts.find((x) => x.kind === 'cash');
        const amt = Number(a.amount) || 0;
        const row = { date: validDate(a.date) ? a.date : today(), accountId: acct.id, payee: String(a.paidTo || '').slice(0, 120),
          by: me(), seq: seq++, categoryId: null, payCardId: null, outflow: 0, inflow: 0 };
        if (a.income) row.inflow = Math.abs(amt);
        else if (isPay(a.category)) { row.payCardId = (card() || {}).id || null; row.outflow = amt; }
        else { const c = category(a.category); row.categoryId = c ? c.id : null; row.outflow = amt; }
        rows.push(row);
      }
      if (rows.length) await store.insert('transactions', rows);
      return done({ added: rows.length, fixed: (p.fixes || []).length });
    },
  };
  return api;
}

/* A store in memory, saved to the browser (localStorage) when one is given:
   for using the app before signing up, and for the preview and tests. */
export function memoryStore(initial, persist) {
  let db = JSON.parse(JSON.stringify(initial));
  let n = 0;
  const id = () => 'l' + Date.now().toString(36) + (n++).toString(36);
  const save = () => { if (persist) persist(JSON.parse(JSON.stringify(db))); };
  return {
    async load() { return JSON.parse(JSON.stringify(db)); },
    async insert(table, rows) {
      const out = rows.map((r) => ({ id: id(), ...r }));
      db[table] = (db[table] || []).concat(out); save(); return out;
    },
    async update(table, rid, patch) {
      db[table] = (db[table] || []).map((r) => (r.id === rid ? { ...r, ...patch } : r)); save();
    },
    async remove(table, rid) { db[table] = (db[table] || []).filter((r) => r.id !== rid); save(); },
    dump() { return JSON.parse(JSON.stringify(db)); },
  };
}
