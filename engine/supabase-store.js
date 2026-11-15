/**
 * A store over Supabase: one household's five lists, read and written as the
 * signed-in person, so row security decides what they can reach.
 *
 * The engine names fields in camelCase (groupId, monthlyCost, ...); the
 * database in snake_case. Only the fields listed here go either way, so
 * nothing the engine adds for itself (seq, by) is ever written.
 */
const FIELDS = {
  accounts: { id: 'id', name: 'name', kind: 'kind', sort: 'sort', archived: 'archived' },
  groups: { id: 'id', name: 'name', sort: 'sort' },
  categories: { id: 'id', groupId: 'group_id', name: 'name', sort: 'sort', priority: 'priority', monthlyCost: 'monthly_cost', archived: 'archived' },
  assignments: { id: 'id', month: 'month', categoryId: 'category_id', cardId: 'card_id', amount: 'amount', note: 'note' },
  transactions: { id: 'id', date: 'date', accountId: 'account_id', payee: 'payee', categoryId: 'category_id', payCardId: 'pay_card_id',
    outflow: 'outflow', inflow: 'inflow', note: 'note' },
};
const TABLES = Object.keys(FIELDS);
const PAGE = 1000;   // Supabase answers at most this many rows at a time

const toRow = (table, obj) => {
  const out = {};
  for (const [k, col] of Object.entries(FIELDS[table])) if (obj[k] !== undefined) out[col] = obj[k];
  return out;
};
const fromRow = (table, row) => {
  const out = {};
  for (const [k, col] of Object.entries(FIELDS[table])) if (row[col] !== undefined) out[k] = row[col];
  return out;
};
const failed = (error) => {
  const e = new Error(/fetch|network/i.test(error.message || '') ? 'Could not reach Moolah. Nothing was written.' : error.message);
  e.cause = error;
  return e;
};

/* Every row of a table, a page at a time, in a fixed order so pages never
   overlap or skip. */
async function all(client, table, householdId, cols, order) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client.from(table).select(cols).eq('household_id', householdId)
      .order(order).range(from, from + PAGE - 1);
    if (error) throw failed(error);
    rows.push(...data);
    if (data.length < PAGE) return rows;
  }
}

export function supabaseStore(client, householdId, opts = {}) {
  const uuid = opts.uuid || (() => crypto.randomUUID());
  return {
    async load() {
      const h = await client.from('households').select('name, currency').eq('id', householdId).single();
      if (h.error) throw failed(h.error);
      const members = await client.from('members').select('user_id, display_name').eq('household_id', householdId);
      if (members.error) throw failed(members.error);
      const who = new Map(members.data.map((m) => [m.user_id, m.display_name || '']));
      const out = { household: h.data };
      for (const t of TABLES) {
        const cols = Object.values(FIELDS[t]).join(', ') + (t === 'transactions' ? ', seq, created_by' : '');
        const rows = await all(client, t, householdId, cols, t === 'transactions' ? 'seq' : 'id');
        out[t] = rows.map((r) => {
          const x = fromRow(t, r);
          if (t === 'transactions') { x.seq = Number(r.seq); x.by = who.get(r.created_by) || ''; }
          return x;
        });
      }
      return out;
    },
    async insert(table, rows) {
      const withIds = rows.map((r) => ({ ...r, id: r.id || uuid() }));
      // a field a row leaves out takes the column's default, not null
      const { error } = await client.from(table).insert(withIds.map((r) => ({ ...toRow(table, r), household_id: householdId })), { defaultToNull: false });
      if (error) throw failed(error);
      return withIds;
    },
    async update(table, id, patch) {
      const row = toRow(table, patch);
      delete row.id;
      if (table === 'transactions') row.updated_at = new Date().toISOString();
      const { error } = await client.from(table).update(row).eq('id', id).eq('household_id', householdId);
      if (error) throw failed(error);
    },
    async remove(table, id) {
      const { error } = await client.from(table).delete().eq('id', id).eq('household_id', householdId);
      if (error) throw failed(error);
    },
  };
}

/**
 * The first-run household (engine/setup.js, with its made-up local ids) made
 * ready for start_household: every id swapped for a fresh uuid, and every
 * reference to it swapped to match.
 */
export function forStart(data, uuid = () => crypto.randomUUID()) {
  const ids = new Map();
  const id = (old) => (old == null ? null : (ids.has(old) ? ids.get(old) : (ids.set(old, uuid()), ids.get(old))));
  return {
    household: data.household,
    displayName: data.displayName || '',
    accounts: data.accounts.map((a) => ({ ...a, id: id(a.id) })),
    groups: data.groups.map((g) => ({ ...g, id: id(g.id) })),
    categories: data.categories.map((c) => ({ ...c, id: id(c.id), groupId: id(c.groupId) })),
    assignments: data.assignments.map((a) => ({ ...a, categoryId: id(a.categoryId), cardId: id(a.cardId) })),
    transactions: data.transactions.map((t) => ({ ...t, accountId: id(t.accountId), categoryId: id(t.categoryId), payCardId: id(t.payCardId) })),
  };
}
