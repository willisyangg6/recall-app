-- Store listings: retailers' public recall lists, attached to the agency case
-- they list (docs/recall-retailer-notices.md, "Store listings").
--
-- NOT APPLIED. Additive: one private table and one read-only function. No
-- existing table, column, policy or grant changes.
--
-- A listing is a retailer saying "we sold this recalled product", with its
-- own stores, states and channels, and a link to the agency notice. It never
-- becomes a case and never edits one: the agency's distribution stays exactly
-- as the agency stated it, so no material change is detected and no second
-- alert can be sent. Each listing keeps its own store and states; nothing
-- here merges one retailer's states into another's.
--
-- A listing is shown only when it is LINKED to one agency case: its agency
-- link is a source URL of exactly one case, or a reviewer confirmed the case.
-- Anything uncertain stays in review and is never returned.

create table public.retailer_store_listings (
  id uuid primary key default gen_random_uuid(),
  publisher text not null check (publisher in ('walmart', 'target', 'wholefoods', 'publix')),
  native_id text not null check (native_id <> ''),
  index_url text not null,
  -- The retailer page the listing was read from (Walmart's list, Target's article).
  listing_url text not null,
  title text not null,
  -- The date the retailer printed beside the listing, when it prints one.
  listed_on date,
  -- The agency pages the retailer linked, verbatim (a Walmart link unwrapped).
  agency_urls text[] not null default '{}',
  -- The retailer's own sold-at line, verbatim.
  sold_at_text text,
  -- One element per store: {store, scope, states, channels}. Never merged.
  stores jsonb not null check (jsonb_typeof(stores) = 'array'),
  decision text not null check (decision in ('linked', 'review', 'excluded')),
  decision_reasons text[] not null default '{}',
  -- The agency case, deliberately not a foreign key (as link_case_id).
  case_id uuid,
  match_method text check (match_method in ('agency_url', 'reviewer')),
  confirmed_by text,
  confirmed_at timestamptz,
  first_seen_at timestamptz not null,
  last_seen_at timestamptz not null,
  parser_version text not null,
  unique (publisher, native_id),
  constraint retailer_store_listings_linked_has_case
    check ((decision = 'linked') = (case_id is not null and match_method is not null)),
  constraint retailer_store_listings_reviewer_pair
    check ((match_method = 'reviewer') = (confirmed_by is not null and confirmed_at is not null)),
  constraint retailer_store_listings_seen_order check (last_seen_at >= first_seen_at)
);

create index retailer_store_listings_case_idx on public.retailer_store_listings (case_id)
  where decision = 'linked';

alter table public.retailer_store_listings enable row level security;
revoke all on public.retailer_store_listings from public, anon, authenticated;
grant select, insert, update on public.retailer_store_listings to service_role;

-- The client read path: one row per (linked listing, store), display-safe
-- columns only, and only for a case that exists.
create function public.consumer_store_listings()
returns table (
  case_id uuid,
  publisher text,
  store text,
  scope text,
  states text[],
  channels text[],
  listing_url text,
  listed_on date
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    l.case_id,
    l.publisher,
    s.value ->> 'store',
    s.value ->> 'scope',
    array(select jsonb_array_elements_text(s.value -> 'states')),
    array(select jsonb_array_elements_text(s.value -> 'channels')),
    l.listing_url,
    l.listed_on
  from public.retailer_store_listings l
  cross join lateral jsonb_array_elements(l.stores) as s(value)
  where l.decision = 'linked'
    and l.case_id is not null
    and exists (select 1 from public.recall_cases c where c.id = l.case_id)
  order by l.case_id, l.publisher, s.value ->> 'store'
$$;

revoke execute on function public.consumer_store_listings() from public;
grant execute on function public.consumer_store_listings() to anon, authenticated, service_role;

do $$
declare
  leaked text;
begin
  select string_agg(grantee || ':' || privilege_type, ', ')
    into leaked
  from information_schema.role_table_grants
  where table_schema = 'public'
    and table_name = 'retailer_store_listings'
    and grantee in ('anon', 'authenticated', 'PUBLIC');
  if leaked is not null then
    raise exception 'retailer_store_listings is reachable by a client role: %', leaked;
  end if;
end $$;
