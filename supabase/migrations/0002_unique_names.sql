-- Names are how people pick things on screen, and how statements and the
-- screens find them, so no household has two accounts, two groups or two
-- categories with the same name (ignoring case and surrounding spaces).
create unique index accounts_name_unique   on public.accounts   (household_id, lower(btrim(name)));
create unique index groups_name_unique     on public.groups     (household_id, lower(btrim(name)));
create unique index categories_name_unique on public.categories (household_id, lower(btrim(name)));
