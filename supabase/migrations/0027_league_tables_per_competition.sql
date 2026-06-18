-- ============================================================================
-- Migration 0027: §1.5 — league tables become per competition.
-- team_id becomes nullable (a table belongs to a competition, not one of our
-- teams) and existing rows are migrated to a competition matching the team's
-- league_name (created if it doesn't already exist).
-- ============================================================================
alter table league_tables alter column team_id drop not null;

do $$
declare r record; v_comp uuid;
begin
  for r in select distinct lt.club_id, lt.season_id, t.league_name
           from league_tables lt join teams t on t.id = lt.team_id
           where lt.competition_id is null and t.league_name is not null and btrim(t.league_name) <> '' loop
    select id into v_comp from competitions
      where club_id = r.club_id and season_id = r.season_id and name = r.league_name;
    if v_comp is null then
      insert into competitions (club_id, season_id, name, type)
      values (r.club_id, r.season_id, r.league_name, 'league') returning id into v_comp;
    end if;
    update league_tables lt set competition_id = v_comp
      from teams t
      where t.id = lt.team_id and lt.competition_id is null
        and lt.club_id = r.club_id and lt.season_id = r.season_id and t.league_name = r.league_name;
  end loop;
end $$;
