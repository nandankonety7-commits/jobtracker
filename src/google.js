// ─── Google API Integration ───────────────────────────────────────────────────

const SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/tasks',
].join(' ')

const STORAGE_KEY = 'jobtracker_google_email'

let _tokenClient = null
let _accessToken = null
let _tokenExpiry = null
let _silentRefreshTimer = null

export function getAccessToken() { return _accessToken }

export function isSignedIn() {
  return !!_accessToken && Date.now() < (_tokenExpiry || 0)
}

/** Save email so we can restore "connected" state across sessions */
function persistEmail(email) {
  try { localStorage.setItem(STORAGE_KEY, email) } catch {}
}
export function getPersistedEmail() {
  try { return localStorage.getItem(STORAGE_KEY) || '' } catch { return '' }
}
export function clearPersistedEmail() {
  try { localStorage.removeItem(STORAGE_KEY) } catch {}
}

/** Schedule a silent token refresh before expiry */
function scheduleRefresh(expiresIn) {
  if (_silentRefreshTimer) clearTimeout(_silentRefreshTimer)
  // Refresh 5 minutes before expiry
  const delay = Math.max((expiresIn - 360) * 1000, 10000)
  _silentRefreshTimer = setTimeout(() => silentRefresh(), delay)
}

/** Silent token refresh — no popup, uses existing consent */
function silentRefresh() {
  if (!_tokenClient) return
  _tokenClient.callback = (resp) => {
    if (resp.error) {
      // Silent refresh failed (e.g. session expired) — don't show popup, just clear state
      // User will see "Connect Google" button and can sign in manually once
      console.warn('Silent refresh failed:', resp.error)
      _accessToken = null
      _tokenExpiry = null
      clearPersistedEmail()
      return
    }
    _accessToken = resp.access_token
    _tokenExpiry = Date.now() + (resp.expires_in - 60) * 1000
    scheduleRefresh(resp.expires_in)
  }
  // hint: '' means try silently, no popup ever shown
  try {
    _tokenClient.requestAccessToken({ prompt: '', hint: getPersistedEmail() })
  } catch(e) {
    console.warn('Silent refresh threw:', e)
  }
}

/**
 * Initialise the GIS token client and attempt a silent token refresh
 * if the user previously connected (email is in localStorage).
 */
export function initGoogleAuth(clientId) {
  return new Promise((resolve) => {
    _tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPES,
      callback: () => {}, // overridden per-call
    })

    // If user was previously connected, try a silent refresh
    const savedEmail = getPersistedEmail()
    if (savedEmail) {
      let initSettled = false
      _tokenClient.callback = (resp) => {
        if (initSettled) return
        initSettled = true
        if (resp.error) {
          console.warn('Auto-reconnect failed:', resp.error)
          clearPersistedEmail()
          resolve({ silentFailed: true })
          return
        }
        _accessToken = resp.access_token
        _tokenExpiry = Date.now() + (resp.expires_in - 60) * 1000
        scheduleRefresh(resp.expires_in)
        resolve({ silentSuccess: true, email: savedEmail })
      }
      _tokenClient.requestAccessToken({ prompt: '', hint: savedEmail })
    } else {
      resolve(null)
    }
  })
}

/** Trigger the OAuth consent popup (only needed on first connect or after revoke). */
export function signIn() {
  return new Promise((resolve, reject) => {
    if (!_tokenClient) { reject(new Error('Auth not initialised')); return }
    let settled = false  // guard against double-callback
    _tokenClient.callback = (resp) => {
      if (settled) return
      settled = true
      if (resp.error) { reject(new Error(resp.error)); return }
      _accessToken = resp.access_token
      _tokenExpiry = Date.now() + (resp.expires_in - 60) * 1000
      scheduleRefresh(resp.expires_in)
      resolve(resp)
    }
    _tokenClient.requestAccessToken({ prompt: 'consent' })
  })
}

export function signOut() {
  if (_accessToken) window.google.accounts.oauth2.revoke(_accessToken)
  _accessToken = null
  _tokenExpiry = null
  if (_silentRefreshTimer) clearTimeout(_silentRefreshTimer)
  clearPersistedEmail()
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function gFetch(url, options = {}) {
  console.log('[JobTracker] gFetch', url, 'signed in:', isSignedIn(), 'token:', !!_accessToken)
  if (!isSignedIn()) throw new Error('Not signed in')
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${_accessToken}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  })
  if (!res.ok) {
    const body = await res.text()
    console.error('[JobTracker] API error', res.status, body)
    throw new Error(`Google API error ${res.status}: ${body}`)
  }
  const json = await res.json()
  console.log('[JobTracker] API response:', JSON.stringify(json).slice(0, 200))
  return json
}

// ── Calendar ──────────────────────────────────────────────────────────────────

export async function createCalendarEvent({ summary, description, date, colorId = '5' }) {
  const event = {
    summary, description, colorId,
    start: { date },
    end: { date },
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'email', minutes: 24 * 60 },
        { method: 'popup', minutes: 9 * 60 },
      ],
    },
  }
  return gFetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
    method: 'POST',
    body: JSON.stringify(event),
  })
}

export async function deleteCalendarEvent(eventId) {
  if (!isSignedIn() || !eventId) return
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${_accessToken}` } }
  )
  // 204 = deleted, 404 = already gone — both are fine
  if (!res.ok && res.status !== 404) {
    const body = await res.text()
    throw new Error(`Calendar delete ${res.status}: ${body}`)
  }
}

// ── Tasks ────────────────────────────────────────────────────────────────────

let _defaultTaskListId = null

async function getDefaultTaskListId() {
  if (_defaultTaskListId) return _defaultTaskListId
  const data = await gFetch('https://tasks.googleapis.com/tasks/v1/users/@me/lists?maxResults=1')
  _defaultTaskListId = data.items?.[0]?.id || '@default'
  return _defaultTaskListId
}

export async function createTask({ title, notes, due }) {
  const listId = await getDefaultTaskListId()
  // Tasks API requires due date in RFC 3339 format with time
  const dueRFC = due ? new Date(due + 'T00:00:00').toISOString() : undefined
  const task = { title, notes, ...(dueRFC ? { due: dueRFC } : {}) }
  return gFetch(`https://tasks.googleapis.com/tasks/v1/lists/${listId}/tasks`, {
    method: 'POST',
    body: JSON.stringify(task),
  })
}

export async function deleteTask(taskId) {
  if (!isSignedIn() || !taskId) return
  const listId = await getDefaultTaskListId()
  const res = await fetch(
    `https://tasks.googleapis.com/tasks/v1/lists/${listId}/tasks/${taskId}`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${_accessToken}` } }
  )
  if (!res.ok && res.status !== 404) {
    const body = await res.text()
    throw new Error(`Task delete ${res.status}: ${body}`)
  }
}

// ── Gmail ─────────────────────────────────────────────────────────────────────

function encodeEmail({ to, subject, body }) {
  const raw = [
    `To: ${to}`,
    'Content-Type: text/html; charset=utf-8',
    `Subject: ${subject}`,
    '',
    body,
  ].join('\r\n')
  return btoa(unescape(encodeURIComponent(raw)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export async function sendReminderEmail({ to, subject, htmlBody }) {
  const raw = encodeEmail({ to, subject, body: htmlBody })
  return gFetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    body: JSON.stringify({ raw }),
  })
}

export async function getMyEmail() {
  console.log('[JobTracker] Fetching email via calendar settings...')
  try {
    const res = await fetch('https://www.googleapis.com/calendar/v3/users/me/settings/timezone', {
      headers: { Authorization: `Bearer ${_accessToken}` }
    })
    // We can't get email from calendar, so use oauth2/userinfo which needs the token differently
    const res2 = await fetch('https://www.googleapis.com/oauth2/v1/userinfo?alt=json', {
      headers: { Authorization: `Bearer ${_accessToken}` }
    })
    const data2 = await res2.json()
    console.log('[JobTracker] userinfo:', JSON.stringify(data2))
    const email = data2.email || 'connected'
    persistEmail(email)
    return email
  } catch(e) {
    console.warn('[JobTracker] Could not fetch email:', e.message)
    persistEmail('connected')
    return 'connected'
  }
}

// ── Sync helpers ──────────────────────────────────────────────────────────────

export async function syncOppToCalendar(opp, existingEventIds = {}) {
  const ids = { ...existingEventIds }

  // ── Deadline → Calendar EVENT (red, all-day) ──
  if (existingEventIds.deadline) {
    await deleteCalendarEvent(existingEventIds.deadline)
    ids.deadline = null
  }
  if (opp.deadline) {
    const ev = await createCalendarEvent({
      summary: `🗓 Deadline: ${opp.org} – ${opp.role || 'Application'}`,
      description: `Application deadline.\nOrg: ${opp.org}\nRole: ${opp.role}\nStatus: ${opp.status}`,
      date: opp.deadline,
      colorId: '11',
    })
    ids.deadline = ev.id
  }

  // ── Follow-ups → Google TASKS (show in Tasks sidebar in Calendar) ──
  const oldTaskIds = existingEventIds.followUpTaskIds || (existingEventIds.followUpIds || [])
  for (const oldId of oldTaskIds) {
    await deleteTask(oldId)
  }
  // Also clean up any old calendar events for follow-ups
  const oldCalIds = existingEventIds.followUpIds || []
  for (const oldId of oldCalIds) {
    await deleteCalendarEvent(oldId)
  }
  ids.followUpTaskIds = []
  ids.followUpIds = []
  ids.followUp = null

  const allFollowUps = (opp.followUps || []).filter(f => f.date).sort((a, b) => new Date(a.date) - new Date(b.date))
  for (const fu of allFollowUps) {
    const task = await createTask({
      title: `📬 ${opp.org}${fu.label ? ': ' + fu.label : ' – Follow up'}`,
      notes: `Org: ${opp.org}\nRole: ${opp.role || ''}\nStatus: ${opp.status}\nStrategy: ${fu.label || ''}`,
      due: fu.date,
    })
    ids.followUpTaskIds.push(task.id)
  }

  // ── Interview → Calendar EVENT (teal, all-day) ──
  if (existingEventIds.interview) {
    await deleteCalendarEvent(existingEventIds.interview)
    ids.interview = null
  }
  if (opp.interviewDate) {
    const ev = await createCalendarEvent({
      summary: `🎤 Interview: ${opp.org} – ${opp.role || 'Application'} (${opp.status})`,
      description: `Interview.\nOrg: ${opp.org}\nRole: ${opp.role}\nNotes: ${opp.interviewNotes || ''}`,
      date: opp.interviewDate,
      colorId: '2',
    })
    ids.interview = ev.id
  }

  return ids
}

export async function sendWeeklyDigest(opps, userEmail) {
  const today = new Date()
  const inDays = (d) => Math.ceil((new Date(d) - today) / 86400000)

  const urgent = opps.filter(o => {
    if (['Rejected','Archived','Offer'].includes(o.status)) return false
    const nextFu = (o.followUps||[]).filter(f=>f.date).sort((a,b)=>new Date(a.date)-new Date(b.date))[0]
    const fu = nextFu ? inDays(nextFu.date) : null
    const dl = o.deadline ? inDays(o.deadline) : null
    const iv = o.interviewDate ? inDays(o.interviewDate) : null
    return (fu !== null && fu <= 7) || (dl !== null && dl <= 7) || (iv !== null && iv <= 7 && iv >= 0)
  })

  const rows = urgent.map(o => {
    const nextFu = (o.followUps||[]).filter(f=>f.date).sort((a,b)=>new Date(a.date)-new Date(b.date))[0]
    const fu = nextFu ? inDays(nextFu.date) : null
    const dl = o.deadline ? inDays(o.deadline) : null
    const iv = o.interviewDate ? inDays(o.interviewDate) : null
    const tag = iv !== null && iv <= 7 && iv >= 0
      ? `🎤 Interview in ${iv}d`
      : fu !== null && fu <= 7
        ? `📬 Follow-up in ${fu}d${nextFu?.label ? ` · ${nextFu.label}` : ''}`
        : `🗓 Deadline in ${dl}d`
    return `<tr>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${o.org}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${o.role||'—'}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${o.status}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:#d97706;font-weight:600;">${tag}</td>
    </tr>`
  }).join('')

  const htmlBody = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;color:#111827;">
      <h2 style="background:#0D0F14;color:#7C9EFF;padding:20px 24px;margin:0;border-radius:8px 8px 0 0;">
        📋 Weekly Job Search Digest
      </h2>
      <div style="padding:20px 24px;background:#f9fafb;border-radius:0 0 8px 8px;">
        <p style="margin:0 0 16px;color:#6b7280;">${today.toDateString()} · ${opps.length} total opportunities tracked</p>
        ${urgent.length === 0
          ? '<p style="color:#059669;font-weight:600;">✅ Nothing urgent this week.</p>'
          : `<h3 style="margin:0 0 12px;">⚡ Needs attention (${urgent.length})</h3>
             <table style="width:100%;border-collapse:collapse;font-size:14px;">
               <thead><tr style="background:#e5e7eb;text-align:left;">
                 <th style="padding:8px 12px;">Org</th><th style="padding:8px 12px;">Role</th>
                 <th style="padding:8px 12px;">Status</th><th style="padding:8px 12px;">Action</th>
               </tr></thead>
               <tbody>${rows}</tbody>
             </table>`
        }
        <hr style="margin:24px 0;border:none;border-top:1px solid #e5e7eb;">
        <p style="font-size:12px;color:#9ca3af;margin:0;">
          Sent by your Opportunity Tracker · <a href="http://localhost:5173" style="color:#7C9EFF;">Open tracker</a>
        </p>
      </div>
    </div>`

  await sendReminderEmail({ to: userEmail, subject: `📋 Job Search Digest – ${urgent.length} items need attention`, htmlBody })
}
