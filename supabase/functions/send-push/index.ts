// Supabase Edge Function: send Web Push to players (admin-only).
// Deploy:  supabase functions deploy send-push
// Secrets: supabase secrets set VAPID_PUBLIC_KEY=… VAPID_PRIVATE_KEY=… VAPID_SUBJECT=mailto:you@club
// (SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY are injected automatically.)
//
// Body: { title, body, fixtureId?, withAvailability?, profileIds? }
//  - profileIds given → those players; else fixtureId → that fixture's eligible
//    roster; else every active player in the club.
import webpush from 'npm:web-push@3.6.7'
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
    webpush.setVapidDetails(
      Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@nottsmvf.app',
      Deno.env.get('VAPID_PUBLIC_KEY')!,
      Deno.env.get('VAPID_PRIVATE_KEY')!,
    )

    // Caller must be an admin.
    const userClient = createClient(URL_, ANON, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } })
    const { data: { user } } = await userClient.auth.getUser()
    if (!user) return json({ error: 'unauthorized' }, 401)
    const admin = createClient(URL_, SERVICE)
    const { data: me } = await admin.from('profiles').select('role').eq('id', user.id).single()
    if (me?.role !== 'admin') return json({ error: 'forbidden' }, 403)

    const { title = 'Nottinghamshire MvF', body = '', fixtureId = null, withAvailability = false, profileIds = null } = await req.json()

    let targets: string[] | null = profileIds
    if (!targets && fixtureId) {
      const { data: fx } = await admin.from('fixtures').select('team_id, team:teams(key)').eq('id', fixtureId).single()
      const isXL = (fx as any)?.team?.key === 'xl'
      const { data: members } = await admin
        .from('team_memberships')
        .select('profile_id, profiles!inner(active, xl_eligible)')
        .eq('team_id', (fx as any)?.team_id)
      targets = (members ?? [])
        .filter((m: any) => m.profiles?.active && (!isXL || m.profiles?.xl_eligible))
        .map((m: any) => m.profile_id)
    }

    let q = admin.from('push_tokens').select('id, token')
    if (targets) q = q.in('profile_id', targets)
    const { data: tokens } = await q

    const payload = JSON.stringify({ title, body, fixtureId, withAvailability, url: '/fixtures' })
    let sent = 0
    await Promise.all((tokens ?? []).map(async (t: any) => {
      try { await webpush.sendNotification(JSON.parse(t.token), payload); sent++ }
      catch (e: any) { if (e?.statusCode === 404 || e?.statusCode === 410) await admin.from('push_tokens').delete().eq('id', t.id) }
    }))
    return json({ sent, targeted: (tokens ?? []).length })
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500)
  }
})
