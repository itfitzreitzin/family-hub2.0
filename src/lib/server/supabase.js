import { createClient } from '@supabase/supabase-js'
import { env } from '$env/dynamic/private'

const supabaseUrl = env.VITE_SUPABASE_URL
const supabaseServiceKey = env.SUPABASE_SERVICE_ROLE_KEY

/**
 * Create a server-side Supabase client that uses the service role key
 * for operations that need to bypass RLS (like syncing calendar events).
 * Falls back to the anon key if service role key isn't set.
 *
 * If a userToken is provided, it's sent as the Authorization header so
 * that RLS policies see the correct auth.uid(). This is important when
 * the service role key isn't configured (e.g. local dev).
 */
export function createServerClient(userToken) {
  const key = supabaseServiceKey || env.VITE_SUPABASE_ANON_KEY
  if (!supabaseUrl || !key) {
    throw new Error('Missing Supabase environment variables on server.')
  }

  const options = {}
  if (!supabaseServiceKey && userToken) {
    options.global = {
      headers: { Authorization: `Bearer ${userToken}` }
    }
  }

  return createClient(supabaseUrl, key, options)
}
