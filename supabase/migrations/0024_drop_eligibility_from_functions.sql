-- ============================================================================
-- Migration 0024: §1 cleanup — stop the trigger inserting xl_eligible and the
-- protect trigger guarding it, so no DB object references the column. It keeps
-- its default (false) until physically dropped in a later migration, AFTER the
-- send-push + run-reminders edge functions are redeployed (their source no
-- longer selects it) — avoiding a window where a stale function queries a
-- missing column.
-- ============================================================================
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_club_id uuid; v_team_key text; v_team_id uuid; v_team_count int := 0;
  v_is_player boolean := coalesce((new.raw_user_meta_data->>'is_player')::boolean, true);
begin
  select id into v_club_id from clubs order by created_at limit 1;
  insert into profiles (id, club_id, first_name, last_name, email, phone, dob, positions, preferred,
                        role, active, approved, is_player)
  values (new.id, v_club_id,
    new.raw_user_meta_data->>'first_name', new.raw_user_meta_data->>'last_name',
    new.email, new.raw_user_meta_data->>'phone',
    nullif(new.raw_user_meta_data->>'dob','')::date,
    coalesce((select array_agg(value) from jsonb_array_elements_text(new.raw_user_meta_data->'positions')), '{}'),
    nullif(new.raw_user_meta_data->>'preferred',''),
    'player', true, false, v_is_player);  -- forced: player / active / PENDING
  if v_is_player then
    for v_team_key in select value from jsonb_array_elements_text(new.raw_user_meta_data->'teams') loop
      select id into v_team_id from teams where club_id = v_club_id and key = v_team_key;
      if v_team_id is not null then
        insert into team_memberships (profile_id, team_id) values (new.id, v_team_id) on conflict do nothing;
        v_team_count := v_team_count + 1;
      end if;
    end loop;
    if v_team_count = 0 then
      select id into v_team_id from teams where club_id = v_club_id and key = 'community';
      if v_team_id is not null then insert into team_memberships (profile_id, team_id) values (new.id, v_team_id) on conflict do nothing; end if;
    end if;
  end if;
  return new;
end; $$;

create or replace function public.protect_profile_columns()
returns trigger language plpgsql as $$
begin
  if current_user in ('postgres','supabase_admin','service_role','supabase_auth_admin') then return new; end if;
  if not is_admin(auth.uid()) then
    new.role := old.role; new.active := old.active;
    new.club_id := old.club_id; new.approved := old.approved; new.is_player := old.is_player;
  end if;
  if new.id = auth.uid() then
    if old.role = 'admin' and new.role is distinct from old.role then raise exception 'You cannot change your own admin role'; end if;
    if old.active = true and new.active = false then raise exception 'You cannot deactivate your own account'; end if;
  end if;
  return new;
end; $$;
