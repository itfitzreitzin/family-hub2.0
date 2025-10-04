import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://sfiohznvdhoqozszmmdh.supabase.co'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNmaW9oem52ZGhvcW96c3ptbWRoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTkyNjQyMTksImV4cCI6MjA3NDg0MDIxOX0.dbBGHhMmiVEaqFTMx5dKg6a8mB5cNxs5bV7w9geWQgk'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)