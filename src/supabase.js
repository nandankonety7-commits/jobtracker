import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

// ─── Auth ─────────────────────────────────────────────────────────────────────

export async function signUpWithEmail(email, password) {
  const { data, error } = await supabase.auth.signUp({ email, password })
  if (error) throw error
  return data
}

export async function signInWithEmail(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error
  return data
}

export async function signOutUser() {
  const { error } = await supabase.auth.signOut()
  if (error) throw error
}

export async function getSession() {
  const { data: { session } } = await supabase.auth.getSession()
  return session
}

export function onAuthChange(callback) {
  return supabase.auth.onAuthStateChange((_event, session) => {
    callback(session)
  })
}

// ─── Opportunities CRUD ───────────────────────────────────────────────────────

export async function fetchOpps(userId) {
  const { data, error } = await supabase
    .from('opportunities')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return data.map(dbToApp)
}

export async function createOpp(userId, opp) {
  const { data, error } = await supabase
    .from('opportunities')
    .insert([appToDB(userId, opp)])
    .select()
    .single()
  if (error) throw error
  return dbToApp(data)
}

export async function updateOpp(id, opp) {
  const { data, error } = await supabase
    .from('opportunities')
    .update(appToDB(null, opp))
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return dbToApp(data)
}

export async function deleteOppDB(id) {
  const { error } = await supabase
    .from('opportunities')
    .delete()
    .eq('id', id)
  if (error) throw error
}

export async function upsertOpps(userId, opps) {
  const rows = opps.map(o => appToDB(userId, o))
  const { data, error } = await supabase
    .from('opportunities')
    .upsert(rows, { onConflict: 'id' })
    .select()
  if (error) throw error
  return data.map(dbToApp)
}

// ─── Shape converters ─────────────────────────────────────────────────────────
// App uses camelCase with nested objects; DB uses snake_case with JSONB columns

function appToDB(userId, opp) {
  const row = {
    org: opp.org,
    role: opp.role,
    type: opp.type,
    status: opp.status,
    deadline: opp.deadline || null,
    applied_date: opp.appliedDate || null,
    follow_ups: opp.followUps || [],
    interview_date: opp.interviewDate || null,
    interview_notes: opp.interviewNotes || '',
    recurring_reminder: opp.recurringReminder || 'none',
    link: opp.link || '',
    notes: opp.notes || '',
    research_notes: opp.researchNotes || '',
    cover_letter_link: opp.coverLetterLink || '',
    resume_link: opp.resumeLink || '',
    calendar_event_ids: opp.calendarEventIds || {},
  }
  if (userId) row.user_id = userId
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (opp.id && typeof opp.id === 'string' && UUID.test(opp.id)) row.id = opp.id
  return row
}

function dbToApp(row) {
  return {
    id: row.id,
    org: row.org,
    role: row.role,
    type: row.type,
    status: row.status,
    deadline: row.deadline || '',
    appliedDate: row.applied_date || '',
    followUps: row.follow_ups || [],
    interviewDate: row.interview_date || '',
    interviewNotes: row.interview_notes || '',
    recurringReminder: row.recurring_reminder || 'none',
    link: row.link || '',
    notes: row.notes || '',
    researchNotes: row.research_notes || '',
    coverLetterLink: row.cover_letter_link || '',
    resumeLink: row.resume_link || '',
    calendarEventIds: row.calendar_event_ids || {},
  }
}
