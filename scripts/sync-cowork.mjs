/**
 * Cowork ↔ Supabase sync watcher
 *
 * Watches job-tracker.md for changes (written by /dream-job-coach:job-tracker)
 * and automatically syncs new/updated entries into Supabase.
 *
 * Setup (one-time):
 *   1. Create .env.local in the project root:
 *        SYNC_EMAIL=your@email.com
 *        SYNC_PASSWORD=yourpassword
 *
 *   2. Run the watcher:
 *        node --env-file=.env --env-file=.env.local scripts/sync-cowork.mjs
 *
 *   Leave the terminal open — it will sync every time the skill updates the file.
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync, watch, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT       = resolve(__dirname, '..')
const TRACKER    = resolve(ROOT, 'job-tracker.md')

// ── Supabase ──────────────────────────────────────────────────────────────────

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY
)

async function getSession() {
  const email    = process.env.SYNC_EMAIL
  const password = process.env.SYNC_PASSWORD
  if (!email || !password) {
    console.error('❌  Missing SYNC_EMAIL / SYNC_PASSWORD in .env.local')
    process.exit(1)
  }
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) { console.error('❌  Supabase sign-in failed:', error.message); process.exit(1) }
  console.log(`✅  Signed in as ${data.user.email}`)
  return data.user
}

// ── Markdown parser ───────────────────────────────────────────────────────────

const STATUS_MAP = {
  'Networking':              'Researching',
  'Informational Interview': 'Researching',
  'Phone Screen':            'Applied',
  'Applied':                 'Applied',
  'Interview Round 1':       'Interview – R1',
  'Interview Round 2':       'Interview – R2+',
  'Interview Round Final':   'Interview – Final',
  'Offer':                   'Offer',
  'Rejected':                'Rejected',
  'Withdrawn':               'Archived',
}

function parseMD(text) {
  const entries = []
  const chunks = text.split(/\n(?=## )/)

  for (const chunk of chunks) {
    if (!chunk.startsWith('## ')) continue
    const lines = chunk.split('\n')
    const title = lines[0].replace(/^## /, '').trim()
    if (title.toLowerCase() === 'archived') continue

    const dashIdx = title.indexOf(' — ')
    const org  = dashIdx >= 0 ? title.slice(0, dashIdx).trim() : title.trim()
    const role = dashIdx >= 0 ? title.slice(dashIdx + 3).trim() : ''
    if (!org) continue

    const f = {}
    for (const line of lines.slice(1)) {
      const m = line.match(/^- \*\*([^*]+)\*\*:\s*(.+)$/)
      if (m) f[m[1].trim()] = m[2].trim()
    }

    const followUps = []
    if (f['Follow-Up Due']) {
      const date  = f['Follow-Up Due'].replace(/\s*\(.*\)/, '').trim()
      const label = f['Next Action'] || 'Follow up'
      followUps.push({ id: `fu_${Date.now()}_${Math.random().toString(36).slice(2)}`, date, label })
    }

    entries.push({
      org,
      role,
      type:              'Other',
      status:            STATUS_MAP[f['Status']] || 'Researching',
      applied_date:      f['Date Added'] || null,
      deadline:          f['Deadline']   || null,
      follow_ups:        followUps,
      interview_date:    null,
      interview_notes:   '',
      recurring_reminder:'none',
      link:              f['Posting Link']    || '',
      notes:             f['Notes']           || '',
      research_notes:    f['Research Notes']  || '',
      cover_letter_link: f['Cover Letter']    || '',
      resume_link:       f['Resume']          || '',
      calendar_event_ids: {},
    })
  }
  return entries
}

// ── Sync logic ────────────────────────────────────────────────────────────────

async function sync(userId) {
  if (!existsSync(TRACKER)) {
    console.log('⚠️   job-tracker.md not found — waiting for the skill to create it')
    return
  }

  const text    = readFileSync(TRACKER, 'utf8')
  const parsed  = parseMD(text)
  if (parsed.length === 0) { console.log('ℹ️   No entries found in job-tracker.md'); return }

  // Fetch existing to avoid duplicates
  const { data: existing } = await supabase
    .from('opportunities')
    .select('org, role')
    .eq('user_id', userId)

  const existingKeys = new Set((existing || []).map(o => `${o.org}||${o.role}`))
  const toAdd = parsed.filter(e => !existingKeys.has(`${e.org}||${e.role}`))

  if (toAdd.length === 0) {
    console.log(`✓  No new entries (${parsed.length} already in Supabase)`)
    return
  }

  const rows = toAdd.map(e => ({ ...e, user_id: userId }))
  const { error } = await supabase.from('opportunities').insert(rows)
  if (error) { console.error('❌  Insert failed:', error.message); return }

  const names = toAdd.map(e => `${e.org}${e.role ? ' – '+e.role : ''}`).join(', ')
  console.log(`🆕  Added ${toAdd.length} entr${toAdd.length === 1 ? 'y' : 'ies'}: ${names}`)
}

// ── Main ──────────────────────────────────────────────────────────────────────

const user = await getSession()

console.log(`👀  Watching ${TRACKER}`)
console.log('    Use /dream-job-coach:job-tracker in Cowork — changes sync automatically.\n')

// Initial sync on startup
await sync(user.id)

// Watch for changes
let debounce = null
watch(TRACKER, { persistent: true }, () => {
  // Debounce rapid saves (skill may write multiple times)
  clearTimeout(debounce)
  debounce = setTimeout(async () => {
    console.log(`\n📄  job-tracker.md changed — syncing…`)
    await sync(user.id)
  }, 800)
})
