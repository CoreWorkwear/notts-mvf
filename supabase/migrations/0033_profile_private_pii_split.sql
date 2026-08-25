-- ============================================================================
-- Migration 0033: split PII off profiles into profile_private (BACKLOG 🔒)
-- RLS on profiles is row-level, so any authenticated club member could select
-- email / phone / dob / ec_name / ec_phone for EVERY club profile straight off
-- the API (the app never surfaced it — but the query was craftable). Fix is
-- the split-contact-table design: profiles keeps the squad-visible columns;
-- the five PII columns move to profile_private, readable/writable ONLY by the
-- person themself or an admin. All the name embeds around the app
-- (availability, lineups, results, memberships) are untouched.
--
-- Ships with frontend changes in the same deploy: usePlayers/PlayerForm/
-- Profile/ProfileEdit read+write profile_private; WhosInSheet stops selecting
-- phone (it never rendered it). Verify with supabase/tests/rls_test.sql (T11).
-- ============================================================================

create table public.profile_private (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  email    text not null,
  phone    text not null,
  dob      date,
  ec_name  text,
  ec_phone text
);

alter table public.profile_private enable row level security;

-- Self, or an admin of the SAME club (is_admin is global, so the club check
-- matters once multi-tenant Beta lands) — nobody else, which is the entire
-- point of the table. The exists() rides profiles' own club-scoped RLS.
create policy profile_private_select on public.profile_private
  for select to authenticated
  using ((profile_id = (select auth.uid()))
         or ((select is_admin(auth.uid()))
             and exists (select 1 from public.profiles p
                         where p.id = profile_private.profile_id
                           and p.club_id = (select current_club_id()))));
create policy profile_private_insert on public.profile_private
  for insert to authenticated
  with check ((profile_id = (select auth.uid()))
              or ((select is_admin(auth.uid()))
                  and exists (select 1 from public.profiles p
                              where p.id = profile_private.profile_id
                                and p.club_id = (select current_club_id()))));
create policy profile_private_update on public.profile_private
  for update to authenticated
  using ((profile_id = (select auth.uid()))
         or ((select is_admin(auth.uid()))
             and exists (select 1 from public.profiles p
                         where p.id = profile_private.profile_id
                           and p.club_id = (select current_club_id()))))
  with check ((profile_id = (select auth.uid()))
              or ((select is_admin(auth.uid()))
                  and exists (select 1 from public.profiles p
                              where p.id = profile_private.profile_id
                                and p.club_id = (select current_club_id()))));
create policy profile_private_delete on public.profile_private
  for delete to authenticated
  using ((select is_admin(auth.uid()))
         and exists (select 1 from public.profiles p
                     where p.id = profile_private.profile_id
                       and p.club_id = (select current_club_id())));

-- Admin duplicate-email guard looks up by email.
create index profile_private_email_idx on public.profile_private (email);

-- Move the existing data across.
insert into public.profile_private (profile_id, email, phone, dob, ec_name, ec_phone)
select id, email, phone, dob, ec_name, ec_phone from public.profiles
on conflict (profile_id) do nothing;

-- Signup trigger now writes the PII to profile_private, not profiles.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_club_id uuid; v_team_key text; v_team_id uuid; v_team_count int := 0;
  v_is_player boolean := coalesce((new.raw_user_meta_data->>'is_player')::boolean, true);
begin
  select id into v_club_id from clubs order by created_at limit 1;
  insert into profiles (id, club_id, first_name, last_name, positions, preferred,
                        role, active, approved, is_player)
  values (new.id, v_club_id,
    new.raw_user_meta_data->>'first_name', new.raw_user_meta_data->>'last_name',
    coalesce((select array_agg(value) from jsonb_array_elements_text(new.raw_user_meta_data->'positions')), '{}'),
    nullif(new.raw_user_meta_data->>'preferred',''),
    'player', true, false, v_is_player);  -- forced: player / active / PENDING
  insert into profile_private (profile_id, email, phone, dob)
  values (new.id, new.email, new.raw_user_meta_data->>'phone',
    nullif(new.raw_user_meta_data->>'dob','')::date);
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
end; $function$;

-- And the PII leaves the club-readable table for good.
alter table public.profiles
  drop column email,
  drop column phone,
  drop column dob,
  drop column ec_name,
  drop column ec_phone;
