-- Club sponsors shown as logo banners through the app. Tiers set prominence:
--   main → team/main sponsor (most prominent), kit → kit sponsor (smaller),
--   motm → man-of-the-match sponsor (a small line by the MOTM).
create table if not exists sponsors (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references clubs(id) on delete cascade,
  name text not null,
  logo_url text,
  website text,
  tier text not null default 'main' check (tier in ('main','kit','motm')),
  sort_order int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table sponsors enable row level security;
drop policy if exists sponsors_select on sponsors;
create policy sponsors_select on sponsors for select to authenticated using (club_id = current_club_id());
drop policy if exists sponsors_admin_write on sponsors;
create policy sponsors_admin_write on sponsors for all to authenticated
  using (club_id = current_club_id() and is_admin(auth.uid()))
  with check (club_id = current_club_id() and is_admin(auth.uid()));
grant select, insert, update, delete on sponsors to authenticated;
