// Web Push delivery bookkeeping (plain ESM, vitest-tested). The actual
// `webpush.sendNotification` and the `push_tokens` delete are injected, so the
// prune / retry decisions can be tested without Deno or a push service.
//
// Rules:
//   • 404 / 410 from the push service → the subscription is gone → PRUNE.
//   • a token that is not valid JSON, has no keys, or whose endpoint is not https on a
//     known push service host can never (or must never) be sent to
//     → PRUNE, rather than throwing on JSON.parse every hour forever.
//   • other 4xx (401/403 = VAPID misconfig, 413, 429) and 5xx → keep the
//     token, count the failure by class so the summary line shows it.

// Only real browser push services are ever contacted. A subscription row is
// client-written, so its endpoint is attacker-controlled: without this check
// web-push would POST to any URL the row names (SSRF from the function).
const PUSH_HOSTS = new Set(['fcm.googleapis.com', 'android.googleapis.com', 'updates.push.services.mozilla.com'])
const PUSH_HOST_SUFFIXES = ['.push.apple.com', '.notify.windows.com']

export function isAllowedPushEndpoint(endpoint) {
  if (typeof endpoint !== 'string' || !endpoint) return false
  let u
  try { u = new URL(endpoint) } catch { return false }
  if (u.protocol !== 'https:') return false
  if (u.username || u.password) return false
  if (u.port) return false
  // An explicit default port ("…:443") is normalised away by URL, so look at the source too.
  if (/^https:\/\/[^/?#]*:\d*(?:[/?#]|$)/i.test(endpoint)) return false
  const host = u.hostname.toLowerCase()
  if (PUSH_HOSTS.has(host)) return true
  return PUSH_HOST_SUFFIXES.some((s) => host.length > s.length && host.endsWith(s))
}

export function parseSubscription(token) {
  try {
    const sub = JSON.parse(token)
    if (!sub || typeof sub !== 'object' || typeof sub.endpoint !== 'string' || !sub.endpoint) return { corrupt: true }
    if (!isAllowedPushEndpoint(sub.endpoint)) return { corrupt: true }
    const k = sub.keys
    if (!k || typeof k !== 'object' || typeof k.p256dh !== 'string' || !k.p256dh || typeof k.auth !== 'string' || !k.auth) return { corrupt: true }
    return { sub }
  } catch {
    return { corrupt: true }
  }
}

export function classifyPushError(e) {
  const status = Number(e?.statusCode ?? e?.status)
  if (status === 404 || status === 410) return { prune: true, klass: 'gone' }
  if (status >= 400 && status < 500) return { prune: false, klass: '4xx' }
  if (status >= 500) return { prune: false, klass: '5xx' }
  return { prune: false, klass: 'other' }
}

// The Edge Function may serve several app origins. Root-relative app paths
// work on each of them and keep historical workers on the intended origin.
function appPath(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return undefined
  for (const char of value) {
    const code = char.charCodeAt(0)
    if (code === 92 || code < 32 || code === 127) return undefined
  }
  try {
    const url = new URL(value, 'https://app.invalid')
    if (url.origin === 'https://app.invalid' && !url.pathname.startsWith('//')) return url.pathname + url.search + url.hash
  } catch { /* Invalid optional paths fall back to the legacy destination. */ }
}

function imagePath(value) {
  const path = appPath(value)
  if (path && /\.(?:avif|gif|ico|jpe?g|png|svg|webp)$/i.test(path.split(/[?#]/)[0])) return path
}

// Accept display metadata only, after the caller, fixture and recipients have
// passed their existing checks. The top-level URL is also sent to older workers.
export function adminPushPayload(request, fixtureId) {
  const data = request ?? {}
  const nestedUrl = appPath(data.data?.url)
  const actions = []
  for (const item of Array.isArray(data.actions) ? data.actions : []) {
    if (typeof item?.action !== 'string' || !item.action.trim() || typeof item.title !== 'string' || !item.title.trim()) continue
    actions.push({ action: item.action, title: item.title, icon: imagePath(item.icon) })
  }
  return {
    title: typeof data.title === 'string' ? data.title : 'Nottinghamshire MvF',
    body: typeof data.body === 'string' ? data.body : '',
    fixtureId, withAvailability: data.withAvailability === true || data.withAvailability === 'true',
    url: appPath(data.url) || nestedUrl || '/fixtures',
    teamKey: ['community', 'xl'].includes(data.teamKey) ? data.teamKey : undefined,
    kind: fixtureId && data.kind === 'lineup' ? 'lineup' : undefined,
    tag: typeof data.tag === 'string' && /^[\w.:-]{1,128}$/.test(data.tag) ? data.tag : undefined,
    data: nestedUrl ? { url: nestedUrl } : undefined,
    icon: imagePath(data.icon), badge: imagePath(data.badge),
    actions: actions.length ? actions : undefined,
  }
}

export function emptySendResult(extra = {}) {
  return { attempted: 0, sent: 0, pruned: 0, failed: { '4xx': 0, '5xx': 0, other: 0 }, ...extra }
}

// tokens: [{ id, token }] rows from push_tokens. payload: the JSON string body.
// deps.send(subscription, payload) → resolves on delivery, rejects with a
// web-push error ({ statusCode }) otherwise. deps.prune(id) removes the row.
export async function pushToTokens(tokens, payload, { send, prune }) {
  const out = emptySendResult({ attempted: (tokens ?? []).length })
  const dropToken = async (id) => {
    out.pruned++
    try { await prune(id) } catch { /* a failed prune is retried next run */ }
  }
  await Promise.all((tokens ?? []).map(async (t) => {
    const parsed = parseSubscription(t.token)
    if (parsed.corrupt) { await dropToken(t.id); return }
    try {
      await send(parsed.sub, payload)
      out.sent++
    } catch (e) {
      const c = classifyPushError(e)
      if (c.prune) await dropToken(t.id)
      else out.failed[c.klass === '4xx' || c.klass === '5xx' ? c.klass : 'other']++
    }
  }))
  return out
}
