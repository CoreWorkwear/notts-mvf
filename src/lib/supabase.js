import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  // Fail loud in dev rather than silently making unauthenticated calls.
  throw new Error(
    'Missing Supabase env vars. Copy .env.example to .env and fill in ' +
      'VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.'
  )
}

// The anon key is safe in the client — RLS enforces every rule at the DB.
export const supabase = createClient(url, anonKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
})

// A throwaway, session-less client. Lets an admin create another player's login
// via signUp WITHOUT clobbering their own session (signUp would otherwise log
// the browser in as the new user). In-memory only; never persisted.
// NOTE: proper admin user-creation belongs in a service_role Edge Function;
// this is the MVP path while email confirmation is off.
export function makeSignupClient() {
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}
