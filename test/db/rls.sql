-- Two households, Ana's and Bea's, each signed in as themselves: neither can
-- see, change or point at the other's data. Every check raises on failure.
\set ON_ERROR_STOP 1
\set ana '11111111-1111-1111-1111-111111111111'
\set bea '22222222-2222-2222-2222-222222222222'

create or replace function pg_temp.as_user(u text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', u, false); end $$;
create or replace function pg_temp.check(ok boolean, what text) returns void language plpgsql as $$
begin if not ok then raise exception 'FAILED: %', what; end if; raise notice 'ok  %', what; end $$;

set role authenticated;

-- each starts a household with an account, a group and a category
select pg_temp.as_user(:'ana');
select public.create_household('Ana home') as ana_h \gset
insert into public.accounts (household_id, name, kind) values (:'ana_h', 'Checking', 'cash') returning id as ana_acct \gset
insert into public.groups (household_id, name) values (:'ana_h', 'Home') returning id as ana_grp \gset
insert into public.categories (household_id, group_id, name) values (:'ana_h', :'ana_grp', 'Groceries') returning id as ana_cat \gset
insert into public.transactions (household_id, date, account_id, category_id, outflow) values (:'ana_h', '2026-11-03', :'ana_acct', :'ana_cat', 120);
select set_config('my.ana_h', :'ana_h', false), set_config('my.ana_cat', :'ana_cat', false) \gset x_

select pg_temp.as_user(:'bea');
select public.create_household('Bea home', 'USD', 'en-US') as bea_h \gset
insert into public.accounts (household_id, name, kind) values (:'bea_h', 'Bank', 'cash') returning id as bea_acct \gset
select set_config('my.bea_h', :'bea_h', false), set_config('my.bea_acct', :'bea_acct', false) \gset x_

-- Bea sees only her own household and nothing of Ana's
select pg_temp.check((select count(*) from public.households) = 1, 'Bea sees one household');
select pg_temp.check((select count(*) from public.transactions) = 0, 'Bea sees none of Ana''s transactions');
select pg_temp.check((select count(*) from public.categories) = 0, 'Bea sees none of Ana''s categories');
select pg_temp.check((select count(*) from public.members) = 1, 'Bea sees only her own membership');

-- Bea cannot write into Ana's household
do $$ begin
  insert into public.groups (household_id, name) values (current_setting('my.ana_h')::uuid, 'Sneaky');
  raise exception 'FAILED: Bea wrote into Ana''s household';
exception when insufficient_privilege then raise notice 'ok  Bea cannot write into Ana''s household'; end $$;

-- nor point her own transaction at Ana's category (the household-scoped keys)
do $$ begin
  insert into public.transactions (household_id, date, account_id, category_id, outflow)
    values (current_setting('my.bea_h')::uuid, '2026-11-04', current_setting('my.bea_acct')::uuid, current_setting('my.ana_cat')::uuid, 5);
  raise exception 'FAILED: Bea used Ana''s category';
exception when foreign_key_violation then raise notice 'ok  Bea cannot use Ana''s category'; end $$;

-- nor change or delete what she cannot see
update public.transactions set outflow = 0;
delete from public.categories;
select pg_temp.as_user(:'ana');
select pg_temp.check((select outflow from public.transactions limit 1) = 120, 'Ana''s transaction unchanged by Bea');
select pg_temp.check((select count(*) from public.categories) = 1, 'Ana''s category still there');

-- signed out: nothing at all
reset role; set role anon;
do $$ begin
  perform count(*) from public.households;
  raise exception 'FAILED: signed-out access';
exception when insufficient_privilege then raise notice 'ok  signed out sees nothing'; end $$;
reset role; set role authenticated;

-- an assignment names exactly one target, on the first of a month
do $$ begin
  insert into public.assignments (household_id, month, amount) values (current_setting('my.ana_h')::uuid, '2026-11-01', 10);
  raise exception 'FAILED: assignment with no target';
exception when check_violation then raise notice 'ok  an assignment needs one target'; end $$;
do $$ begin
  insert into public.assignments (household_id, month, category_id, amount) values (current_setting('my.ana_h')::uuid, '2026-11-15', current_setting('my.ana_cat')::uuid, 10);
  raise exception 'FAILED: mid-month assignment';
exception when check_violation then raise notice 'ok  assignments are for a month'; end $$;

-- deleting your data removes the household you own, and only yours
select pg_temp.as_user(:'bea');
select pg_temp.check(public.delete_my_data() = 1, 'Bea deletes her household');
reset role;
select pg_temp.check((select count(*) from public.households) = 1, 'only Ana''s household is left');
select pg_temp.check((select count(*) from public.accounts where household_id = :'bea_h') = 0, 'Bea''s accounts went with it');

-- no two categories with the same name in one household (any case), but two
-- households may each have one
set role authenticated;
select pg_temp.as_user(:'ana');
do $$ begin
  insert into public.categories (household_id, group_id, name)
    select household_id, group_id, ' groceries ' from public.categories limit 1;
  raise exception 'FAILED: duplicate category name';
exception when unique_violation then raise notice 'ok  a category name is used once per household'; end $$;
select public.create_household('Ana second home') as ana_h2 \gset
insert into public.groups (household_id, name) values (:'ana_h2', 'Home') returning id as g2 \gset
insert into public.categories (household_id, group_id, name) values (:'ana_h2', :'g2', 'Groceries');
select pg_temp.check(true, 'another household can have its own Groceries');

-- a brand-new account, signed in for the first time, sees nothing at all
-- until it creates its own household, and that household starts empty
set role authenticated;
select pg_temp.as_user('33333333-3333-3333-3333-333333333333');
select pg_temp.check((select count(*) from public.households) = 0, 'a new account sees no household');
select pg_temp.check((select count(*) from public.transactions) + (select count(*) from public.categories)
  + (select count(*) from public.accounts) + (select count(*) from public.assignments) = 0, 'a new account sees no budget data');
select public.create_household('Cara home') as cara_h \gset
select pg_temp.check((select count(*) from public.households) = 1, 'a new account sees only the household it made');
select pg_temp.check((select count(*) from public.transactions where household_id = :'cara_h') = 0
  and (select count(*) from public.categories where household_id = :'cara_h') = 0, 'a new household starts empty');
