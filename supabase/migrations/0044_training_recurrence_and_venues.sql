-- Existing clients keep their original booking and change RPCs and receipts.
begin;

alter table public.training_sessions
  add column address text,
  add column postcode text,
  add column w3w text,
  add column venue_lat numeric,
  add column venue_lng numeric,
  add constraint training_venue_coordinates check (
    (venue_lat is null and venue_lng is null) or
    (venue_lat is not null and venue_lng is not null and
     venue_lat between -90 and 90 and venue_lng between -180 and 180)
  ),
  add constraint training_venue_text_lengths check (
    length(address) <= 300 and length(postcode) <= 16 and length(w3w) <= 120
  );

-- The week's first period starts on Monday. For months and years advance from
-- the first of the original month, so a missing 29th/30th/31st cannot drift.
create function public.create_training_series(
  p_request_id uuid, p_date date, p_time time, p_venue text, p_town text, p_audience text,
  p_focus text, p_frequency text, p_interval integer, p_weekdays integer[], p_until date, p_count integer,
  p_address text, p_postcode text, p_w3w text, p_venue_lat numeric, p_venue_lng numeric
) returns uuid
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  actor uuid := auth.uid();
  club uuid := public.current_club_id();
  receipt public.training_requests%rowtype;
  payload jsonb;
  weekdays integer[];
  offsets integer[];
  day_offset integer;
  period_start date := p_date;
  period_step interval;
  candidate date;
  dates date[] := '{}';
  first_id uuid := gen_random_uuid();
  series uuid;
begin
  if actor is null or not public.is_admin(actor) then
    raise exception 'Only a manager can publish training' using errcode = '42501';
  end if;
  if p_request_id is null then
    raise exception 'A request id is required' using errcode = '22023';
  end if;
  select coalesce(array_agg(distinct d order by d), '{}'::integer[]) into weekdays from unnest(p_weekdays) d;
  -- The postcode lookup is best effort. Replaying the same published details
  -- after a network timeout may produce different derived coordinates.
  payload := jsonb_build_array(p_date, p_time, p_venue, p_town, p_audience, p_focus,
                               p_frequency, p_interval, weekdays, p_until, p_count,
                               p_address, p_postcode, p_w3w);
  perform pg_advisory_xact_lock(hashtextextended(actor::text || p_request_id::text, 0));
  select * into receipt from public.training_requests where actor_id = actor and request_id = p_request_id;
  if found then
    if receipt.operation <> 'create_series' or receipt.payload <> payload then
      raise exception 'Request id was used for a different change' using errcode = '22023';
    end if;
    return receipt.session_id;
  end if;

  if p_date is null or not isfinite(p_date) or p_time is null or p_time >= time '24:00' then
    raise exception 'Choose a training date and start time' using errcode = '22023';
  end if;
  if p_audience is null or p_audience not in ('xl','community','club') or p_venue is null
      or length(btrim(p_venue)) not between 1 and 160 or length(coalesce(p_town,'')) > 120 or length(p_focus) > 1000 then
    raise exception 'Check the training details' using errcode = '22023';
  end if;
  if p_frequency is null or p_frequency not in ('once','day','week','month','year')
      or p_interval is null or p_interval not between 1 and 52 then
    raise exception 'Choose a frequency and an interval from 1 to 52' using errcode = '22023';
  end if;
  if num_nonnulls(p_until,p_count) <> 1 or p_count not between 1 and 500
      or (p_until is not null and (not isfinite(p_until) or p_until < p_date)) then
    raise exception 'Choose an inclusive end date or 1 to 500 sessions' using errcode = '22023';
  end if;
  if p_frequency = 'once' and (p_interval <> 1 or p_count is distinct from 1) then
    raise exception 'A one-off booking must contain one session' using errcode = '22023';
  end if;
  if p_frequency = 'week' then
    if cardinality(weekdays) = 0 or exists(select 1 from unnest(weekdays) d where d is null or d not between 1 and 7) then
      raise exception 'Choose at least one weekday' using errcode = '22023';
    end if;
  elsif cardinality(weekdays) > 0 then
    raise exception 'Weekdays apply only to weekly training' using errcode = '22023';
  end if;

  offsets := array[0];
  case p_frequency
    when 'week' then
      period_start := p_date - (extract(isodow from p_date)::int - 1);
      period_step := make_interval(weeks => p_interval);
      offsets := array(select d - 1 from unnest(weekdays) d order by d);
    when 'month', 'year' then
      period_start := p_date - (extract(day from p_date)::int - 1);
      period_step := make_interval(months => p_interval * case when p_frequency = 'year' then 12 else 1 end);
      offsets := array[p_date - period_start];
    else
      period_step := make_interval(days => p_interval);
  end case;

  <<periods>>
  loop
    foreach day_offset in array offsets loop
      candidate := period_start + day_offset;
      exit periods when candidate > p_until;
      continue when candidate < p_date;
      continue when p_frequency in ('month','year') and extract(month from candidate) <> extract(month from period_start);
      if cardinality(dates) = 0 and ((candidate + p_time) at time zone 'Europe/London') <= now() then
        raise exception 'Choose a future training date and time' using errcode = '22023';
      end if;
      if cardinality(dates) = 500 then
        raise exception 'A series can contain at most 500 sessions' using errcode = '22023';
      end if;
      dates := array_append(dates,candidate);
      exit periods when cardinality(dates) = p_count;
    end loop;
    period_start := (period_start + period_step)::date;
  end loop;
  if cardinality(dates) = 0 then
    raise exception 'No training days fall within this date range' using errcode = '22023';
  end if;

  if p_frequency <> 'once' then series := gen_random_uuid(); end if;
  insert into public.training_sessions(id,club_id,start_date,start_time,venue,town,audience,focus,series_id,
                                       address,postcode,w3w,venue_lat,venue_lng)
  select case when n = 1 then first_id else gen_random_uuid() end, club, d, p_time, btrim(p_venue),
         btrim(coalesce(p_town,'')), p_audience, nullif(btrim(p_focus),''), series,
         nullif(btrim(p_address),''), nullif(upper(btrim(p_postcode)),''), nullif(btrim(p_w3w),''), p_venue_lat, p_venue_lng
  from unnest(dates) with ordinality as occurrences(d,n);

  insert into public.training_requests(actor_id,request_id,operation,payload,session_id,result_revision)
  values (actor,p_request_id,'create_series',payload,first_id,1);
  return first_id;
end;
$$;
revoke all on function public.create_training_series(uuid,date,time,text,text,text,text,text,integer,integer[],date,integer,text,text,text,numeric,numeric) from public,anon;
grant execute on function public.create_training_series(uuid,date,time,text,text,text,text,text,integer,integer[],date,integer,text,text,text,numeric,numeric) to authenticated,service_role;

-- Both edit entry points share the lock, receipt and fan-out. SQL NULL for
-- location means an older client omitted those fields. A populated object may
-- explicitly clear them. Pre-upgrade edit receipts keep their original shape.
create function public.training_change_occurrence(
  p_session_id uuid, p_revision integer, p_request_id uuid, p_date date, p_time time,
  p_venue text, p_town text, p_focus text, p_cancel boolean, p_location jsonb
) returns integer
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  actor uuid := auth.uid();
  club uuid := public.current_club_id();
  payload jsonb := jsonb_build_array(p_session_id,p_revision,p_date,p_time,p_venue,p_town,p_focus,p_cancel);
  receipt public.training_requests%rowtype;
  previous public.training_sessions%rowtype;
  updated public.training_sessions%rowtype;
  moved boolean;
  notice_id uuid;
  kind text;
  title text;
  body text;
  previous_details text;
  updated_details text;
begin
  if actor is null or not public.is_admin(actor) then
    raise exception 'Only a manager can change training' using errcode = '42501';
  end if;
  if p_request_id is null then raise exception 'A request id is required' using errcode = '22023'; end if;
  if p_location is not null then payload := payload || jsonb_build_array(p_location - 'lat' - 'lng'); end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text || p_request_id::text,0));
  select * into receipt from public.training_requests where actor_id = actor and request_id = p_request_id;
  if found then
    if receipt.operation <> 'change' or receipt.payload <> payload then
      raise exception 'Request id was used for a different change' using errcode = '22023';
    end if;
    return receipt.result_revision;
  end if;

  select * into previous from public.training_sessions where id = p_session_id for update;
  if not found or previous.club_id is distinct from club then
    raise exception 'You cannot change this training session' using errcode = '42501';
  end if;
  if previous.revision is distinct from p_revision then
    raise exception 'Training has changed. Refresh before saving' using errcode = '40001';
  end if;
  if previous.cancelled then raise exception 'This training session is already cancelled' using errcode = '22023'; end if;
  if p_cancel is null or p_date is null or p_time is null or p_venue is null
      or length(btrim(p_venue)) not between 1 and 160 or length(coalesce(p_town,'')) > 120 or length(p_focus) > 1000 then
    raise exception 'Check the training details' using errcode = '22023';
  end if;
  updated := previous;
  updated.cancelled := p_cancel;
  if not p_cancel then
    if not isfinite(p_date) or p_time >= time '24:00' or ((p_date+p_time) at time zone 'Europe/London') <= now() then
      raise exception 'Choose a future training date and time' using errcode = '22023';
    end if;
    updated.start_date := p_date;
    updated.start_time := p_time;
    updated.venue := btrim(p_venue);
    updated.town := btrim(coalesce(p_town,''));
    updated.focus := nullif(btrim(p_focus),'');
    if p_location is not null then
      updated.address := nullif(btrim(p_location->>'address'),'');
      updated.postcode := nullif(upper(btrim(p_location->>'postcode')),'');
      updated.w3w := nullif(btrim(p_location->>'w3w'),'');
      updated.venue_lat := (p_location->>'lat')::numeric;
      updated.venue_lng := (p_location->>'lng')::numeric;
    end if;
  end if;

  moved := row(previous.start_date,previous.start_time,previous.venue,previous.town,previous.address,previous.postcode,previous.w3w)
        is distinct from row(updated.start_date,updated.start_time,updated.venue,updated.town,updated.address,updated.postcode,updated.w3w);
  if updated is distinct from previous then
    update public.training_sessions set start_date=updated.start_date,start_time=updated.start_time,
           venue=updated.venue,town=updated.town,address=updated.address,postcode=updated.postcode,w3w=updated.w3w,
           venue_lat=updated.venue_lat,venue_lng=updated.venue_lng,focus=updated.focus,cancelled=updated.cancelled,revision=revision+1
     where id=p_session_id returning * into updated;
  end if;

  if moved or p_cancel then
    previous_details := concat_ws(', ',to_char(previous.start_date,'Dy DD Mon YYYY') || ' at ' || to_char(previous.start_time,'HH24:MI'),
                                  previous.venue,previous.address,nullif(previous.town,''),previous.postcode,previous.w3w);
    updated_details := concat_ws(', ',to_char(updated.start_date,'Dy DD Mon YYYY') || ' at ' || to_char(updated.start_time,'HH24:MI'),
                                 updated.venue,updated.address,nullif(updated.town,''),updated.postcode,updated.w3w);
    if p_cancel then
      kind := 'cancelled'; title := 'Training cancelled'; body := 'Training cancelled. ' || updated_details || '.';
    else
      kind := 'moved'; title := 'Training moved'; body := 'Training on ' || previous_details || ' has moved to ' || updated_details || '.';
    end if;
    insert into public.training_notices(session_id,club_id,kind,title,body)
      values(p_session_id,club,kind,title,body) returning id into notice_id;
    insert into public.training_push_outbox(notice_id,profile_id,push_token_id,device_token,title,body,tag,url,can_reply)
    select notice_id,p.id,t.id,public.training_subscription(t.token),title,
           body || case when not p_cancel and public.training_player_eligible(p_session_id,p.id) then ' Update your availability.' else '' end,
           'training-' || notice_id::text,'/training?session=' || p_session_id::text,
           not p_cancel and public.training_player_eligible(p_session_id,p.id)
      from public.profiles p join public.push_tokens t on t.profile_id=p.id
     where p.club_id=club and p.active and (p.approved or p.role='admin') and public.training_subscription(t.token) is not null;
  end if;
  insert into public.training_requests(actor_id,request_id,operation,payload,session_id,result_revision)
    values(actor,p_request_id,'change',payload,p_session_id,updated.revision);
  return updated.revision;
end;
$$;
revoke all on function public.training_change_occurrence(uuid,integer,uuid,date,time,text,text,text,boolean,jsonb)
  from public,anon,authenticated,service_role;

create or replace function public.change_training_session(
  p_session_id uuid,p_revision integer,p_request_id uuid,p_date date,p_time time,
  p_venue text,p_town text,p_focus text,p_cancel boolean default false
) returns integer language sql security definer set search_path = pg_catalog, public as $$
  select public.training_change_occurrence(p_session_id,p_revision,p_request_id,p_date,p_time,p_venue,p_town,p_focus,p_cancel,null);
$$;

create function public.change_training_session_venue(
  p_session_id uuid,p_revision integer,p_request_id uuid,p_date date,p_time time,
  p_venue text,p_town text,p_focus text,p_cancel boolean,p_address text,p_postcode text,p_w3w text,p_venue_lat numeric,p_venue_lng numeric
) returns integer language sql security definer set search_path = pg_catalog, public as $$
  select public.training_change_occurrence(p_session_id,p_revision,p_request_id,p_date,p_time,p_venue,p_town,p_focus,p_cancel,
    jsonb_build_object('address',p_address,'postcode',p_postcode,'w3w',p_w3w,'lat',p_venue_lat,'lng',p_venue_lng));
$$;
revoke all on function public.change_training_session_venue(uuid,integer,uuid,date,time,text,text,text,boolean,text,text,text,numeric,numeric) from public,anon;
grant execute on function public.change_training_session_venue(uuid,integer,uuid,date,time,text,text,text,boolean,text,text,text,numeric,numeric) to authenticated,service_role;

commit;
