-- Anonymise-on-delete support: line-ups keep a name snapshot so a since-deleted
-- player still shows in past line-ups (their profile link goes null, not gone).
alter table lineups add column if not exists player_name text;
alter table lineups alter column profile_id drop not null;
update lineups l set player_name = p.first_name || ' ' || p.last_name
  from profiles p where p.id = l.profile_id and l.player_name is null;
-- profile delete should null the link (keep the row), not cascade it away.
alter table lineups drop constraint lineups_profile_id_fkey;
alter table lineups add constraint lineups_profile_id_fkey
  foreign key (profile_id) references profiles(id) on delete set null;
