-- Least privilege for the Data API roles in `public`.
--
-- Every relation in `public` granted anon and authenticated TRUNCATE,
-- REFERENCES, TRIGGER and MAINTAIN (ACL letters D, x, t, m). None of these
-- came from a migration in this repository: they come from the platform's
-- default ACL for relations `postgres` creates in `public`, which withholds
-- SELECT/INSERT/UPDATE/DELETE from the Data API roles but still hands out the
-- other four. Nothing in the app or the server uses them, and TRUNCATE is not
-- subject to RLS, so they are removed — on every existing relation and from
-- the default ACL, so a future table is not created with them again.
--
-- Deliberately untouched:
--   * The SELECT grants the feed reads through (recall_cases,
--     affected_products, product_visuals, consumer_feed_manifest).
--   * EXECUTE on the security-definer RPCs — the app's only writes.
--   * service_role — the server's secret-key role.
--   * RLS policies.
--   * supabase_admin's default ACL in `public`. Only a member of
--     supabase_admin may alter it and `postgres` is not one; every relation
--     in `public` is created by `postgres` through these migrations.
--
-- No transaction statements: the CLI applies each migration file in its own
-- transaction, so a failed assertion below rolls back both revokes.

revoke truncate, references, trigger, maintain
  on all tables in schema public
  from anon, authenticated;

alter default privileges for role postgres in schema public
  revoke truncate, references, trigger, maintain on tables
  from anon, authenticated;

-- Fail closed: abort the migration if a Data API role still holds one of the
-- four privileges on any relation or in the default ACL, or if a deliberate
-- feed read was lost.
do $$
declare
  v_leftover text;
  v_default text;
  v_lost text;
begin
  select string_agg(c.relname || ':' || r.rolname || ':' || p.priv, ', ')
    into v_leftover
  from pg_class c
  cross join (values ('anon'), ('authenticated')) r(rolname)
  cross join (values ('TRUNCATE'), ('REFERENCES'), ('TRIGGER'), ('MAINTAIN')) p(priv)
  where c.relnamespace = 'public'::regnamespace
    and c.relkind in ('r', 'v', 'm', 'p', 'f')
    and has_table_privilege(r.rolname, c.oid, p.priv);

  if v_leftover is not null then
    raise exception 'Data API roles still hold: %', v_leftover;
  end if;

  select string_agg(a.grantee::regrole::text || ':' || a.privilege_type, ', ')
    into v_default
  from pg_default_acl d
  cross join lateral aclexplode(d.defaclacl) a
  where d.defaclrole = 'postgres'::regrole
    and d.defaclnamespace = 'public'::regnamespace
    and d.defaclobjtype = 'r'
    and a.grantee in ('anon'::regrole, 'authenticated'::regrole)
    and a.privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN');

  if v_default is not null then
    raise exception 'Default ACL still grants Data API roles: %', v_default;
  end if;

  select string_agg(t.relname || ':' || r.rolname, ', ')
    into v_lost
  from (values ('recall_cases'), ('affected_products'), ('product_visuals'),
               ('consumer_feed_manifest')) t(relname)
  cross join (values ('anon'), ('authenticated')) r(rolname)
  where not has_table_privilege(r.rolname, ('public.' || t.relname)::regclass, 'SELECT');

  if v_lost is not null then
    raise exception 'Deliberate SELECT grant lost: %', v_lost;
  end if;
end;
$$;
