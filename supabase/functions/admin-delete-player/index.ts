// Supabase Edge Function: admin PERMANENTLY deletes a user (service_role).
// Distinct from the active/inactive soft-delete — this removes the login + the
// profile entirely. Match history is preserved under the player's NAME: goal and
// MOTM records keep scorer_name/assist_name/motm_name, we just null the profile
// link (those FKs are restrict, so they'd otherwise block the delete).
//
// Deploy: supabase functions deploy admin-delete-player   (config.toml verify_jwt=false)
// Body: { id }  — the profile id to delete.
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

    const { id } = await req.json()
    if (!id) return json({ error: 'missing id' }, 400)
    if (id === user.id) return json({ error: "You can't delete your own account." }, 400)

    // 1) Detach restrict-FK history, keeping the name snapshots intact.
    await admin.from('goals').update({ scorer_profile_id: null }).eq('scorer_profile_id', id)
    await admin.from('goals').update({ assist_profile_id: null }).eq('assist_profile_id', id)
    await admin.from('results').update({ motm_profile_id: null }).eq('motm_profile_id', id)
    await admin.from('media_assets').update({ uploaded_by: null }).eq('uploaded_by', id)
    await admin.from('announcements').update({ created_by: null }).eq('created_by', id)
    // Subs/payment records are operational, not history — remove them.
    await admin.from('payments').delete().eq('profile_id', id)

    // 2) Delete the profile (cascades team_memberships, availability, push_tokens).
    const { error: pErr } = await admin.from('profiles').delete().eq('id', id)
    if (pErr) return json({ error: pErr.message }, 400)

    // 3) Delete the auth login.
    const { error: aErr } = await admin.auth.admin.deleteUser(id)
    if (aErr) return json({ error: aErr.message }, 400)

    return json({ ok: true })
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500)
  }
})
