-- Approval gate + account type.
--  approved  : manager sign-off. Self-registrations land false (pending = view-only).
--  is_player : true = squad player; false = supporter (app user, not in the squad).
alter table profiles add column if not exists approved  boolean not null default false;
alter table profiles add column if not exists is_player boolean not null default true;

-- Everyone already in the app is legit — approve them so nobody gets locked out.
update profiles set approved = true;

-- Helper: may this user set availability? (approved, a player, and active.)
create or replace function public.is_active_player(uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select approved and is_player and active from profiles where id = uid), false);
$$;

-- New signups are pending players by default; is_player can be set from metadata.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_club_id uuid; v_team_key text; v_team_id uuid; v_team_count int := 0;
  v_is_player boolean := coalesce((new.raw_user_meta_data->>'is_player')::boolean, true);
begin
  select id into v_club_id from clubs order by created_at limit 1;
  insert into profiles (id, club_id, first_name, last_name, email, phone, dob, positions, preferred,
                        role, xl_eligible, active, approved, is_player)
  values (new.id, v_club_id,
    new.raw_user_meta_data->>'first_name', new.raw_user_meta_data->>'last_name',
    new.email, new.raw_user_meta_data->>'phone',
    nullif(new.raw_user_meta_data->>'dob','')::date,
    coalesce((select array_agg(value) from jsonb_array_elements_text(new.raw_user_meta_data->'positions')), '{}'),
    nullif(new.raw_user_meta_data->>'preferred',''),
    'player', false, true, false, v_is_player);  -- forced: player / not-eligible / PENDING
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

-- Protect approved + is_player from self-service (admins only).
create or replace function public.protect_profile_columns()
returns trigger language plpgsql as $$
begin
  if current_user in ('postgres','supabase_admin','service_role','supabase_auth_admin') then return new; end if;
  if not is_admin(auth.uid()) then
    new.role := old.role; new.xl_eligible := old.xl_eligible; new.active := old.active;
    new.club_id := old.club_id; new.approved := old.approved; new.is_player := old.is_player;
  end if;
  if new.id = auth.uid() then
    if old.role = 'admin' and new.role is distinct from old.role then raise exception 'You cannot change your own admin role'; end if;
    if old.active = true and new.active = false then raise exception 'You cannot deactivate your own account'; end if;
  end if;
  return new;
end; $$;

-- Availability writes now require an approved, active player.
drop policy if exists availability_insert on availability;
create policy availability_insert on availability for insert to authenticated
  with check (profile_id = auth.uid() and can_select_fixture(fixture_id, auth.uid()) and is_active_player(auth.uid()));
drop policy if exists availability_update on availability;
create policy availability_update on availability for update to authenticated
  using (profile_id = auth.uid() and is_active_player(auth.uid()))
  with check (profile_id = auth.uid() and can_select_fixture(fixture_id, auth.uid()) and is_active_player(auth.uid()));
