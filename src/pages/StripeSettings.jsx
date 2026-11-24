import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { usePaymentsRelease } from '../hooks/usePaymentsRelease'
import { supabase } from '../lib/supabase'
import PageHead from '../components/PageHead'

function setupUrl(value) {
  const url = new URL(value)
  if (!['https://accounts.stripe.com', 'https://connect.stripe.com'].includes(url.origin) ||
    url.username || url.password) {
    throw new Error('Unexpected Stripe onboarding URL')
  }
  return url.href
}

function requirementLabel(key) {
  if (key.startsWith('external_account')) return 'Receiving bank account'
  if (key.startsWith('tos_acceptance')) return 'Stripe agreement'
  if (/^(representative|person|individual|owners|directors|executives)/.test(key)) return 'Account-holder verification'
  if (/^(business|company)/.test(key)) return 'Club information'
  return 'Additional information in Stripe'
}

export default function StripeSettings() {
  const { user, profile, isAdmin } = useAuth()
  const release = usePaymentsRelease(user?.id, profile?.club_id)
  const [params] = useSearchParams()
  const [result, setResult] = useState(null)
  const [attempt, setAttempt] = useState(0)
  const [busy, setBusy] = useState(false)
  const [setupFailed, setSetupFailed] = useState(false)
  const canRead = Boolean(isAdmin && user?.id && profile?.club_id)

  useEffect(() => {
    if (!canRead) return
    let active = true
    setResult(null)
    supabase.functions.invoke('stripe-connect-onboard', { body: { action: 'status' } })
      .then(({ data, error }) => {
        if (active) setResult(error || typeof data?.connected !== 'boolean' ? { error: true } : data)
      })
      .catch(() => { if (active) setResult({ error: true }) })
    return () => { active = false }
  }, [canRead, attempt, user?.id, profile?.club_id])

  async function openStripe() {
    if (!canRead || busy) return
    setBusy(true)
    setSetupFailed(false)
    try {
      const { data, error } = await supabase.functions.invoke('stripe-connect-onboard', { body: { action: 'onboard' } })
      if (error) throw error
      if (data?.ready && !data.onboarding_url) {
        setResult(data)
        return
      }
      window.location.assign(setupUrl(data?.onboarding_url))
    } catch {
      setSetupFailed(true)
    } finally {
      setBusy(false)
    }
  }

  const retryStatus = () => setAttempt(value => value + 1)
  const requirements = [...new Set([
    ...(result?.requirements?.currently_due ?? []),
    ...(result?.requirements?.past_due ?? []),
  ].map(requirementLabel))]
  const returned = ['refresh', 'return'].includes(params.get('stripe'))

  return <div className="page">
    <Link className="btn btn-ghost" to="/manage">Back to Club admin</Link>
    <PageHead kicker="CLUB SETTINGS" title="Stripe" />
    {!canRead ? <p className="mt-4" role="status">Stripe setup is unavailable.</p>
        : !result ? <p className="mt-4" role="status">Checking Stripe status…</p>
          : result.error ? <div className="card pad mt-4" role="alert">
            <p>Couldn't check Stripe status.</p>
            <button type="button" className="btn btn-ghost mt-2" onClick={retryStatus}>Try again</button>
          </div> : <section className="card pad mt-4" aria-labelledby="stripe-connection-heading">
            <h2 id="stripe-connection-heading">{result.ready ? 'Stripe setup complete' : result.connected ? 'Stripe setup incomplete' : 'Connect the club to Stripe'}</h2>
            {result.mode === 'test' && <p className="dim mt-2">Sandbox</p>}
            {result.mode === 'live' && <p className="dim mt-2">Live Stripe account</p>}
            {!release.loading && !release.error && !release.enabled && <p className="mt-2">Player payments are off.</p>}
            {result.connected && <dl className="mt-3">
              <dt>Charges</dt><dd>{result.charges_enabled ? 'Enabled' : 'Pending'}</dd>
              <dt>Payouts</dt><dd>{result.payouts_enabled ? 'Enabled' : 'Pending'}</dd>
            </dl>}
            {!result.ready && requirements.length > 0 && <>
              <h3 className="mt-3">Still needed in Stripe</h3>
              <ul className="mt-2">{requirements.map(item => <li key={item}>{item}</li>)}</ul>
            </>}
            {!result.ready && result.requirements?.pending_verification?.length > 0 && <p className="mt-2">Stripe is checking submitted details.</p>}
            {returned && !result.ready && <p className="mt-2">Complete or resume the club’s setup in Stripe.</p>}
            {setupFailed && <p className="mt-2" role="alert">Couldn't open Stripe setup. Try again.</p>}
            <div className="row gap-2 mt-3" style={{ flexWrap: 'wrap' }}>
              {!result.ready && <button type="button" className="btn btn-primary" disabled={busy} onClick={openStripe}>
                {busy ? 'Opening Stripe…' : result.connected ? 'Continue Stripe setup' : 'Set up Stripe'}
              </button>}
              <button type="button" className="btn btn-ghost" disabled={busy} onClick={retryStatus}>Check Stripe status</button>
            </div>
          </section>}
  </div>
}
