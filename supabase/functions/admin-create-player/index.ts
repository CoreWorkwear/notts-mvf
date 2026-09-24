// Supabase Edge Function: admin creates a player's login (service_role).
// The proper replacement for the browser throwaway-signUp stopgap.
// Deploy: supabase functions deploy admin-create-player
// (SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY injected.)
//
// Body: { email, password, first_name, last_name, phone, dob?, positions?, preferred?, teams? }
// handle_new_user builds the profile from user_metadata and forces role=player /
// approved=false; the admin promotes later via the Players screen.
//
// Squads are NOT built by the trigger any more (migration 0034): membership now
// decides who may set availability, so it can't come from client-controlled
// signup metadata. The trigger drops everyone into the reserves and THIS
// function then RECONCILES the squads to what the manager ticked — adding the
// ones they chose and removing the ones they didn't, including that reserves
// seed — with the service role, authorised by the admin check below, which a
// self-signup never passes.
import { createClient } from 'jsr:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...cors, 'content-type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const URL_ = Deno.env.get('SUPABASE_URL')!
    const ANON = Deno.env.get('SUPABASE_ANON_KEY')!
    const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    const userClient = createClient(URL_, ANON, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } })
    const { data: { user } } = await userClient.auth.getUser()
    if (!user) return json({ error: 'unauthorized' }, 401)
    const admin = createClient(URL_, SERVICE)
    // Mirror the DB's is_admin(): role AND active. A soft-removed manager
    // (Inactive, the documented removal path) must lose these powers too.
    const { data: me } = await admin.from('profiles').select('role, active').eq('id', user.id).single()
    if (me?.role !== 'admin' || me?.active !== true) return json({ error: 'forbidden' }, 403)

    const b = await req.json()
    if (!b.email || !b.password || !b.first_name || !b.last_name || !b.phone) {
      return json({ error: 'first name, surname, email, phone and password are required' }, 400)
    }
    if (String(b.password).length < 6) return json({ error: 'password must be at least 6 characters' }, 400)

    const isPlayer = b.is_player !== false
    const { data, error } = await admin.auth.admin.createUser({
      email: b.email,
      password: b.password,
      email_confirm: true,
      user_metadata: {
        first_name: b.first_name, last_name: b.last_name, phone: b.phone,
        dob: b.dob ?? null, positions: b.positions ?? [], preferred: b.preferred ?? null,
        teams: b.teams ?? [], is_player: isPlayer,
      },
    })
    if (error) return json({ error: error.message }, 400)
    // Manager-added → sign them off immediately (the trigger lands them pending).
    if (data.user?.id) {
      await admin.from('profiles').update({ approved: true, is_player: isPlayer }).eq('id', data.user.id)

      // Set the squads to EXACTLY what the manager ticked. Add AND remove: the
      // trigger seeds the reserves for every new account and cannot tell an
      // admin create from a self-signup (it fires on auth.users either way), so
      // a plain upsert would leave a First-Team-only signing in Community too —
      // and since 0034 membership is what lets you answer a fixture, that would
      // be the reported bug in the other direction.
      // Ticking nothing is not a statement, so the seeded reserves row stands.
      const wanted: string[] = Array.isArray(b.teams) ? b.teams : []
      if (isPlayer && wanted.length) {
        const { data: prof } = await admin.from('profiles').select('club_id').eq('id', data.user.id).single()
        const { data: teams } = await admin
          .from('teams').select('id, key').eq('club_id', prof?.club_id ?? '').in('key', wanted)
        const wantedIds = (teams ?? []).map((t: { id: string }) => t.id)
        if (wantedIds.length) {
          const { error: addErr } = await admin.from('team_memberships')
            .upsert(wantedIds.map((team_id: string) => ({ profile_id: data.user!.id, team_id })),
                    { onConflict: 'profile_id,team_id' })
          const { error: cutErr } = await admin.from('team_memberships')
            .delete().eq('profile_id', data.user.id)
            .not('team_id', 'in', `(${wantedIds.join(',')})`)
          // The login exists either way — say so rather than reporting a clean
          // save on a player whose squads didn't stick.
          if (addErr || cutErr) {
            return json({
              id: data.user.id,
              warning: "Player created, but their team(s) didn't save — set them in Players.",
            })
          }
        }
      }
    }
    return json({ id: data.user?.id })
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500)
  }
})
