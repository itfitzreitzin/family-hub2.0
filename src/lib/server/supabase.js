import { createClient } from '@supabase/supabase-js'
import { env } from '$env/dynamic/private'

const supabaseUrl = env.VITE_SUPABASE_URL
const supabaseServiceKey = env.SUPABASE_SERVICE_ROLE_KEY

/**
 * Create a server-side Supabase client that uses the service role key
 * for operations that need to bypass RLS (like syncing calendar events).
 * Falls back to the anon key if service role key isn't set.
 */
export function createServerClient() {
  const key = supabaseServiceKey || env.VITE_SUPABASE_ANON_KEY
  if (!supabaseUrl || !key) {
    throw new Error('Missing Supabase environment variables on server.')
  }
  return createClient(supabaseUrl, key)
}
