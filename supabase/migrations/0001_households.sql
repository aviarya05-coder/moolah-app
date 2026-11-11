-- Moolah: households and their budgets.
--
-- Every row belongs to a household. A user sees and changes only the
-- households they are a member of: row-level security on every table, and
-- foreign keys that include household_id, so no row can point at another
-- household's account, group or category even by a guessed id.
--
-- The budget itself is five lists, the same ones engine/budget.js reads:
-- accounts, groups, categories, assignments (money given a job in a month)
-- and transactions. Nothing is a running total; every figure is worked out
-- from these.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- households
create table public.households (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(name) between 1 and 80),
  currency    text not null default 'ILS' check (currency ~ '^[A-Z]{3}$'),
  locale      text not null default 'en-IL',
  created_at  timestamptz not null default now()
);

create table public.members (
  household_id uuid not null references public.households (id) on delete cascade,
  user_id      uuid not null,
  role         text not null default 'member' check (role in ('owner', 'member')),
  display_name text,
  joined_at    timestamptz not null default now(),
  primary key (household_id, user_id)
);
create index members_user on public.members (user_id);

-- Is the signed-in user a member of this household? Security definer so the
-- policies below can call it without recursing into members' own policy.
create function public.is_member(hid uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members m where m.household_id = hid and m.user_id = auth.uid())
$$;
create function public.is_owner(hid uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members m where m.household_id = hid and m.user_id = auth.uid() and m.role = 'owner')
$$;

-- ------------------------------------------------------------------ budget
create table public.accounts (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name         text not null check (length(name) between 1 and 60),
  kind         text not null check (kind in ('cash', 'credit')),
  sort         int not null default 0,
  archived     boolean not null default false,
  unique (household_id, id)
);

create table public.groups (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name         text not null check (length(name) between 1 and 60),
  sort         int not null default 0,
  unique (household_id, id)
);

create table public.categories (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  group_id     uuid not null,
  name         text not null check (length(name) between 1 and 60),
  sort         int not null default 0,
  priority     text check (priority in ('fixed', 'flexible', 'normal')),
  monthly_cost numeric(14, 2) check (monthly_cost >= 0),   -- what it costs in a normal month
  archived     boolean not null default false,
  unique (household_id, id),
  foreign key (household_id, group_id) references public.groups (household_id, id)
);

-- Money given a job in a month: to a category, or held for a credit card.
-- Moving money is two rows (out of one, into the other); giving it back to
-- Unassigned is one negative row.
create table public.assignments (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  month        date not null check (extract(day from month) = 1),
  category_id  uuid,
  card_id      uuid,
  amount       numeric(14, 2) not null,
  note         text check (length(note) <= 200),
  created_by   uuid default auth.uid(),
  created_at   timestamptz not null default now(),
  check ((category_id is null) <> (card_id is null)),
  foreign key (household_id, category_id) references public.categories (household_id, id),
  foreign key (household_id, card_id) references public.accounts (household_id, id)
);
create index assignments_month on public.assignments (household_id, month);

-- A purchase has a category; income has neither; a card payment is an
-- outflow from a cash account with pay_card_id. A refund is an inflow with
-- a category.
create table public.transactions (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  date         date not null,
  account_id   uuid not null,
  payee        text not null default '' check (length(payee) <= 120),
  category_id  uuid,
  pay_card_id  uuid,
  outflow      numeric(14, 2) not null default 0,
  inflow       numeric(14, 2) not null default 0 check (inflow >= 0),
  note         text check (length(note) <= 200),
  created_by   uuid default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check (not (category_id is not null and pay_card_id is not null)),
  foreign key (household_id, account_id) references public.accounts (household_id, id),
  foreign key (household_id, category_id) references public.categories (household_id, id),
  foreign key (household_id, pay_card_id) references public.accounts (household_id, id)
);
create index transactions_date on public.transactions (household_id, date);

-- ------------------------------------------------------------ row security
alter table public.households   enable row level security;
alter table public.members      enable row level security;
alter table public.accounts     enable row level security;
alter table public.groups       enable row level security;
alter table public.categories   enable row level security;
alter table public.assignments  enable row level security;
alter table public.transactions enable row level security;

create policy "members read their household" on public.households
  for select to authenticated using (public.is_member(id));
create policy "owners rename their household" on public.households
  for update to authenticated using (public.is_owner(id)) with check (public.is_owner(id));
-- a household is created and deleted only through the functions below

create policy "members see each other" on public.members
  for select to authenticated using (public.is_member(household_id));
create policy "members change their own name" on public.members
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

do $$
declare t text;
begin
  foreach t in array array['accounts', 'groups', 'categories', 'assignments', 'transactions'] loop
    execute format('create policy "members use their budget" on public.%I for all to authenticated
                    using (public.is_member(household_id)) with check (public.is_member(household_id))', t);
  end loop;
end $$;

-- ------------------------------------------------------------- functions
-- Start a household: the caller becomes its owner.
create function public.create_household(p_name text, p_currency text default 'ILS', p_locale text default 'en-IL')
  returns uuid language plpgsql security definer set search_path = public as $$
declare hid uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  insert into public.households (name, currency, locale) values (p_name, p_currency, p_locale) returning id into hid;
  insert into public.members (household_id, user_id, role) values (hid, auth.uid(), 'owner');
  return hid;
end $$;

-- Leave everything: the caller's memberships go, and any household left
-- with no owner is deleted with all its data. (Deleting the sign-in itself
-- is done by a server function with the service key; the stores require
-- both to be possible from inside the app.)
create function public.delete_my_data() returns int
  language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  with mine as (select household_id from public.members where user_id = auth.uid() and role = 'owner')
  delete from public.households h using mine
   where h.id = mine.household_id
     and not exists (select 1 from public.members m where m.household_id = h.id and m.role = 'owner' and m.user_id <> auth.uid());
  get diagnostics n = row_count;
  delete from public.members where user_id = auth.uid();
  return n;
end $$;

revoke all on function public.create_household(text, text, text) from public, anon;
revoke all on function public.delete_my_data() from public, anon;
grant execute on function public.create_household(text, text, text) to authenticated;
grant execute on function public.delete_my_data() to authenticated;
grant select, update on public.households to authenticated;
grant select, update on public.members to authenticated;
grant select, insert, update, delete on public.accounts, public.groups, public.categories,
  public.assignments, public.transactions to authenticated;
