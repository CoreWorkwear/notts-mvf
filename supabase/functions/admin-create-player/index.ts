// Supabase Edge Function: admin creates a player's login (service_role).
// The proper replacement for the browser throwaway-signUp stopgap.
// Deploy: supabase functions deploy admin-create-player
// (SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY injected.)
//
// Body: { email, password, first_name, last_name, phone, dob?, positions?, preferred?, teams? }
// handle_new_user builds the profile + memberships from user_metadata and forces
// role=player / xl_eligible=false; the admin promotes later via the Players screen.
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
    const { data: me } = await admin.from('profiles').select('role').eq('id', user.id).single()
    if (me?.role !== 'admin') return json({ error: 'forbidden' }, 403)

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
    }
    return json({ id: data.user?.id })
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500)
  }
})
