import { useState, useEffect, useRef, useCallback } from 'react'
import {
  initGoogleAuth, signIn as googleSignIn, signOut as googleSignOut,
  isSignedIn as googleIsSignedIn, getMyEmail,
  syncOppToCalendar, getPersistedEmail,
} from './google.js'
import {
  supabase, signUpWithEmail, signInWithEmail, signOutUser,
  fetchOpps, createOpp, updateOpp, deleteOppDB, upsertOpps, onAuthChange,
} from './supabase.js'

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || ''

const STATUSES = ['Researching','Applied','Interview – R1','Interview – R2+','Interview – Final','Following Up','Offer','Rejected','Archived']
const STATUS_CONFIG = {
  'Researching':       { color:'#7C9EFF', bg:'rgba(124,158,255,0.12)', dot:'#7C9EFF' },
  'Applied':           { color:'#A78BFA', bg:'rgba(167,139,250,0.12)', dot:'#A78BFA' },
  'Interview – R1':    { color:'#34D399', bg:'rgba(52,211,153,0.12)',  dot:'#34D399' },
  'Interview – R2+':   { color:'#2DD4BF', bg:'rgba(45,212,191,0.12)',  dot:'#2DD4BF' },
  'Interview – Final': { color:'#F59E0B', bg:'rgba(245,158,11,0.12)',  dot:'#F59E0B' },
  'Following Up':      { color:'#FBBF24', bg:'rgba(251,191,36,0.12)',  dot:'#FBBF24' },
  'Offer':             { color:'#10B981', bg:'rgba(16,185,129,0.12)',  dot:'#10B981' },
  'Rejected':          { color:'#F87171', bg:'rgba(248,113,113,0.12)', dot:'#F87171' },
  'Archived':          { color:'#6B7280', bg:'rgba(107,114,128,0.12)', dot:'#6B7280' },
  'Interviewing':      { color:'#34D399', bg:'rgba(52,211,153,0.12)',  dot:'#34D399' },
}
const TYPES = ['Think Tank','Pre-Doc','Fellowship','Government','Other']
const REMINDER_OPTIONS = [
  { value:'none',    label:'No recurring reminder' },
  { value:'weekly',  label:'Weekly' },
  { value:'2weeks',  label:'Every 2 weeks' },
  { value:'monthly', label:'Monthly' },
]
const EMPTY_FORM = {
  org:'', role:'', type:'Think Tank', status:'Researching',
  deadline:'', appliedDate:'', followUps:[], interviewDate:'',
  interviewNotes:'', recurringReminder:'none', link:'', notes:'',
  researchNotes:'', coverLetterLink:'', resumeLink:''
}
const TODAY = new Date().toISOString().split('T')[0]

function daysDiff(dateStr) {
  if (!dateStr) return null
  return Math.ceil((new Date(dateStr) - new Date(TODAY)) / 86400000)
}
function urgencyLabel(d) {
  if (d === null) return null
  if (d < 0)   return { label:`${Math.abs(d)}d overdue`, color:'#F87171' }
  if (d === 0) return { label:'Due today', color:'#FBBF24' }
  if (d <= 3)  return { label:`${d}d left`, color:'#FBBF24' }
  if (d <= 7)  return { label:`${d}d left`, color:'#A78BFA' }
  return { label:`${d}d`, color:'#6B7280' }
}
function nextRecurringDate(opp) {
  if (!opp.recurringReminder || opp.recurringReminder === 'none') return null
  const fus = (opp.followUps||[]).filter(f=>f.date).sort((a,b)=>new Date(b.date)-new Date(a.date))
  const anchor = fus[0]?.date || opp.appliedDate || TODAY
  const days = opp.recurringReminder==='weekly'?7:opp.recurringReminder==='2weeks'?14:30
  let next = new Date(anchor)
  const today = new Date(TODAY)
  while (next <= today) next = new Date(next.getTime()+days*86400000)
  return next.toISOString().split('T')[0]
}

// ─── Auth Screen ──────────────────────────────────────────────────────────────
function AuthScreen({ onAuth }) {
  const [mode, setMode] = useState('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const handle = async () => {
    setError(''); setLoading(true)
    try {
      if (mode === 'signin') {
        await signInWithEmail(email, password)
      } else {
        await signUpWithEmail(email, password)
        setMessage('Check your email to confirm your account, then sign in.')
        setMode('signin'); setLoading(false); return
      }
    } catch(e) {
      setError(e.message)
    }
    setLoading(false)
  }

  return (
    <div style={{fontFamily:"'DM Mono','Courier New',monospace",background:'#0D0F14',minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',color:'#E2E8F0'}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Syne:wght@700;800&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        input{background:#151821;border:1px solid #2d3044;color:#E2E8F0;border-radius:6px;padding:10px 14px;font-family:inherit;font-size:13px;outline:none;width:100%;transition:border-color 0.2s}
        input:focus{border-color:#7C9EFF}
      `}</style>
      <div style={{width:360,background:'#13161f',border:'1px solid #2d3044',borderRadius:12,padding:32}}>
        <div style={{fontFamily:"'Syne',sans-serif",fontSize:22,fontWeight:800,letterSpacing:'-0.02em',marginBottom:6}}>
          OPPORTUNITY TRACKER
        </div>
        <div style={{fontSize:11,color:'#4d5470',marginBottom:28,letterSpacing:'0.04em'}}>
          {mode==='signin'?'Sign in to your account':'Create a new account'}
        </div>
        {message && <div style={{fontSize:12,color:'#34D399',marginBottom:16,padding:'10px 14px',background:'rgba(52,211,153,0.08)',borderRadius:6,border:'1px solid rgba(52,211,153,0.2)'}}>{message}</div>}
        {error && <div style={{fontSize:12,color:'#F87171',marginBottom:16,padding:'10px 14px',background:'rgba(248,113,113,0.08)',borderRadius:6,border:'1px solid rgba(248,113,113,0.2)'}}>{error}</div>}
        <div style={{display:'flex',flexDirection:'column',gap:12,marginBottom:20}}>
          <input placeholder="Email" type="email" value={email} onChange={e=>setEmail(e.target.value)} onKeyDown={e=>e.key==='Enter'&&handle()}/>
          <input placeholder="Password" type="password" value={password} onChange={e=>setPassword(e.target.value)} onKeyDown={e=>e.key==='Enter'&&handle()}/>
        </div>
        <button onClick={handle} disabled={loading} style={{width:'100%',background:'#7C9EFF',color:'#0D0F14',border:'none',padding:'11px',borderRadius:6,fontSize:13,fontWeight:600,cursor:'pointer',opacity:loading?0.6:1}}>
          {loading?'...':(mode==='signin'?'Sign In':'Create Account')}
        </button>
        <div style={{textAlign:'center',marginTop:16,fontSize:12,color:'#6B7280'}}>
          {mode==='signin'?<>No account? <button onClick={()=>{setMode('signup');setError('');setMessage('')}} style={{background:'none',border:'none',color:'#7C9EFF',cursor:'pointer',fontSize:12}}>Sign up</button></>
          :<>Have an account? <button onClick={()=>{setMode('signin');setError('');setMessage('')}} style={{background:'none',border:'none',color:'#7C9EFF',cursor:'pointer',fontSize:12}}>Sign in</button></>}
        </div>
      </div>
    </div>
  )
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [session, setSession]     = useState(undefined) // undefined = loading
  const [opps, setOpps]           = useState([])
  const [dbLoading, setDbLoading] = useState(false)

  const [googleReady, setGoogleReady] = useState(false)
  const [gSignedIn, setGSignedIn]     = useState(false)
  const [userEmail, setUserEmail]     = useState('')
  const [toast, setToast]             = useState(null)
  const [syncing, setSyncing]         = useState(new Set())

  const [filter, setFilter]           = useState('All')
  const [typeFilter, setTypeFilter]   = useState('All')
  const [sortBy, setSortBy]           = useState('followUpDate')
  const [search, setSearch]           = useState('')
  const [expandedId, setExpandedId]   = useState(null)
  const [showForm, setShowForm]       = useState(false)
  const [editing, setEditing]         = useState(null)
  const [form, setForm]               = useState(EMPTY_FORM)
  const [showPaste, setShowPaste]     = useState(false)
  const [pasteText, setPasteText]     = useState('')
  const importRef                     = useRef(null)

  const showToast = (msg, type='info') => {
    setToast({msg,type})
    setTimeout(()=>setToast(null), 4000)
  }

  // ── Auth state ──
  useEffect(() => {
    supabase.auth.getSession().then(({data:{session}})=>setSession(session))
    const {data:{subscription}} = onAuthChange(s=>setSession(s))
    return ()=>subscription.unsubscribe()
  }, [])

  // ── Load opps from Supabase when session changes ──
  useEffect(() => {
    if (!session) { setOpps([]); return }
    setDbLoading(true)
    fetchOpps(session.user.id)
      .then(data=>setOpps(data))
      .catch(e=>showToast('Failed to load data: '+e.message,'error'))
      .finally(()=>setDbLoading(false))
  }, [session?.user?.id])

  // ── Google auth init ──
  useEffect(() => {
    if (!CLIENT_ID) return
    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'
    script.onload = async () => {
      const result = await initGoogleAuth(CLIENT_ID)
      setGoogleReady(true)
      if (result?.silentSuccess) {
        setGSignedIn(true)
        setUserEmail(result.email)
      } else if (getPersistedEmail() && !result?.silentFailed) {
        setTimeout(()=>{
          if (googleIsSignedIn()) { setGSignedIn(true); setUserEmail(getPersistedEmail()) }
        }, 2000)
      }
    }
    document.head.appendChild(script)
  }, [])

  const handleGoogleSignIn = async () => {
    try {
      await googleSignIn()
      setGSignedIn(true)
      const email = await getMyEmail()
      setUserEmail(email)
      showToast(`Google connected — Calendar, Gmail & Tasks ready`, 'success')
    } catch(e) { showToast('Sign-in failed: '+e.message, 'error') }
  }

  const handleGoogleSignOut = () => {
    googleSignOut(); setGSignedIn(false); setUserEmail('')
    showToast('Disconnected from Google', 'info')
  }

  // ── Sign out of app ──
  const handleSignOut = async () => {
    await signOutUser()
    setOpps([])
  }

  // ── Sync to Calendar ──
  const handleSyncCalendar = useCallback(async (opp) => {
    if (!googleIsSignedIn()) { showToast('Connect Google first','error'); return }
    setSyncing(s=>new Set(s).add(opp.id))
    try {
      const ids = await syncOppToCalendar(opp, opp.calendarEventIds||{})
      const updated = await updateOpp(opp.id, {...opp, calendarEventIds:ids})
      setOpps(prev=>prev.map(o=>o.id===opp.id?updated:o))
      showToast(`Synced ${opp.org} to Calendar`, 'success')
    } catch(e) { showToast('Sync failed: '+e.message,'error') }
    finally { setSyncing(s=>{const n=new Set(s);n.delete(opp.id);return n}) }
  }, [])

  const handleSyncAll = async () => {
    if (!googleIsSignedIn()) { showToast('Connect Google first','error'); return }
    const toSync = opps.filter(o=>!['Rejected','Archived'].includes(o.status))
    showToast(`Syncing ${toSync.length} opportunities…`,'info')
    for (const opp of toSync) await handleSyncCalendar(opp)
    showToast('All synced!','success')
  }

  const handleDigest = async () => {
    if (!session) return
    const to = userEmail || session.user.email
    try {
      const res = await fetch('/api/send-digest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ opps, userEmail: to }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      showToast(`Digest sent to ${to}`, 'success')
    } catch(e) { showToast('Email failed: '+e.message, 'error') }
  }

  // ── CRUD ──
  function openAdd()  { setForm(EMPTY_FORM); setEditing(null); setShowForm(true) }
  function openEdit(o){ setForm({...o}); setEditing(o.id); setShowForm(true) }
  function closeForm(){ setShowForm(false); setEditing(null) }

  const saveForm = async () => {
    if (!form.org.trim() || !session) return
    try {
      if (editing) {
        const updated = await updateOpp(editing, form)
        setOpps(prev=>prev.map(o=>o.id===editing?updated:o))
      } else {
        const created = await createOpp(session.user.id, form)
        setOpps(prev=>[...prev, created])
      }
      closeForm()
    } catch(e) { showToast('Save failed: '+e.message,'error') }
  }

  const deleteOpp = async (id) => {
    try {
      await deleteOppDB(id)
      setOpps(prev=>prev.filter(o=>o.id!==id))
      if (expandedId===id) setExpandedId(null)
    } catch(e) { showToast('Delete failed: '+e.message,'error') }
  }

  const quickStatus = async (id, status) => {
    const opp = opps.find(o=>o.id===id)
    if (!opp) return
    const updated = await updateOpp(id, {...opp, status})
    setOpps(prev=>prev.map(o=>o.id===id?updated:o))
  }

  // ── Import / Export ──
  const handleExport = () => {
    const blob = new Blob([JSON.stringify(opps,null,2)],{type:'application/json'})
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href=url; a.download=`job-tracker-backup-${TODAY}.json`; a.click()
    URL.revokeObjectURL(url)
    showToast('Backup downloaded!','success')
  }

  const handleExportMarkdown = () => {
    const statusMap = {
      'Researching':'Networking', 'Applied':'Applied', 'Following Up':'Applied',
      'Interview – R1':'Interview Round 1', 'Interview – R2+':'Interview Round 2',
      'Interview – Final':'Interview Round Final',
      'Offer':'Offer', 'Rejected':'Rejected', 'Archived':'Withdrawn',
    }
    const active = opps.filter(o=>o.status!=='Archived')
    const archived = opps.filter(o=>o.status==='Archived')
    const renderOpp = (o) => {
      const nextFu = (o.followUps||[]).filter(f=>f.date).sort((a,b)=>new Date(a.date)-new Date(b.date))[0]
      const lines = [
        `## ${o.org}${o.role?' — '+o.role:''}`,
        `- **Date Added**: ${o.appliedDate||TODAY}`,
        `- **Status**: ${statusMap[o.status]||o.status}`,
        o.deadline ? `- **Deadline**: ${o.deadline}` : null,
        nextFu ? `- **Follow-Up Due**: ${nextFu.date}${nextFu.label?' ('+nextFu.label+')':''}` : null,
        nextFu ? `- **Next Action**: Follow up by ${nextFu.date}` : `- **Next Action**: Review and apply`,
        o.link ? `- **Posting Link**: ${o.link}` : null,
        o.coverLetterLink ? `- **Cover Letter**: ${o.coverLetterLink}` : null,
        o.resumeLink ? `- **Resume**: ${o.resumeLink}` : null,
        o.researchNotes ? `- **Research Notes**: ${o.researchNotes.replace(/\n/g,' ')}` : null,
        o.notes ? `- **Notes**: ${o.notes.replace(/\n/g,' ')}` : null,
        o.interviewNotes ? `- **Interview Notes**: ${o.interviewNotes.replace(/\n/g,' ')}` : null,
      ].filter(Boolean)
      return lines.join('\n')
    }
    const md = [
      '# Job Application Tracker',
      `\n**Last Updated**: ${TODAY}\n`,
      active.length===0 ? '\n> No active applications.' : active.map(renderOpp).join('\n\n'),
      archived.length>0 ? '\n---\n\n## Archived\n\n'+archived.map(renderOpp).join('\n\n') : ''
    ].join('\n')
    const blob = new Blob([md],{type:'text/markdown'})
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href=url; a.download='job-tracker.md'; a.click()
    URL.revokeObjectURL(url)
    showToast('job-tracker.md downloaded — save it to your Cowork workspace folder','success')
  }

  const handleImport = (e) => {
    const file = e.target.files[0]; if (!file) return
    const reader = new FileReader()
    reader.onload = async (ev) => {
      try {
        const data = JSON.parse(ev.target.result)
        const entries = Array.isArray(data) ? data : data.add
        if (!Array.isArray(entries)) throw new Error('Invalid format')
        const existing = new Set(opps.map(o=>`${o.org}||${o.role}`))
        const toAdd = entries.filter(o=>!existing.has(`${o.org}||${o.role}`))
        if (toAdd.length===0) { showToast('No new entries','info'); return }
        const created = await Promise.all(toAdd.map(o=>createOpp(session.user.id, o)))
        setOpps(prev=>[...prev,...created])
        showToast(`Added ${created.length} opportunit${created.length===1?'y':'ies'}!`,'success')
      } catch(err) { showToast('Invalid file: '+err.message,'error') }
    }
    reader.readAsText(file)
    e.target.value=''
  }

  const handlePaste = async () => {
    try {
      const data = JSON.parse(pasteText.trim())
      const entries = Array.isArray(data) ? data : data.add
      if (!Array.isArray(entries)) throw new Error('Invalid format')
      const existing = new Set(opps.map(o=>`${o.org}||${o.role}`))
      const toAdd = entries.filter(o=>!existing.has(`${o.org}||${o.role}`))
      if (toAdd.length===0) { showToast('No new entries — all already exist','info'); setShowPaste(false); return }
      const created = await Promise.all(toAdd.map(o=>createOpp(session.user.id,o)))
      setOpps(prev=>[...prev,...created])
      showToast(`Added ${created.length} opportunit${created.length===1?'y':'ies'}!`,'success')
      setShowPaste(false); setPasteText('')
    } catch { showToast('Invalid JSON — copy the full block from Cowork','error') }
  }

  // ── Derived ──
  const counts = {}
  STATUSES.forEach(s=>counts[s]=opps.filter(o=>o.status===s).length)

  const needsAttention = opps.filter(o=>{
    if (['Rejected','Archived','Offer'].includes(o.status)) return false
    const fus=(o.followUps||[])
    const nextFu=fus.filter(f=>daysDiff(f.date)!==null).sort((a,b)=>new Date(a.date)-new Date(b.date))[0]
    const fu=nextFu?daysDiff(nextFu.date):null
    const dl=daysDiff(o.deadline)
    const iv=daysDiff(o.interviewDate)
    return (fu!==null&&fu<=3)||(dl!==null&&dl<=5)||(iv!==null&&iv<=3&&iv>=0)
  })

  const filtered = opps
    .filter(o=>filter==='All'||o.status===filter)
    .filter(o=>typeFilter==='All'||o.type===typeFilter)
    .filter(o=>!search||`${o.org} ${o.role} ${o.notes}`.toLowerCase().includes(search.toLowerCase()))
    .sort((a,b)=>{
      if (sortBy==='followUpDate'){
        const af=(a.followUps||[]).filter(f=>f.date).sort((x,y)=>new Date(x.date)-new Date(y.date))[0]?.date||'9999'
        const bf=(b.followUps||[]).filter(f=>f.date).sort((x,y)=>new Date(x.date)-new Date(y.date))[0]?.date||'9999'
        return af.localeCompare(bf)
      }
      if (sortBy==='deadline') return (a.deadline||'9999').localeCompare(b.deadline||'9999')
      return a.org.localeCompare(b.org)
    })

  // ── Loading / Auth gate ──
  if (session === undefined) return (
    <div style={{background:'#0D0F14',minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',color:'#4d5470',fontFamily:'monospace'}}>
      Loading…
    </div>
  )
  if (!session) return <AuthScreen />

  // ── Main UI ──
  return (
    <div style={{fontFamily:"'DM Mono','Courier New',monospace",background:'#0D0F14',minHeight:'100vh',color:'#E2E8F0'}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Syne:wght@600;700;800&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        ::-webkit-scrollbar{width:4px}
        ::-webkit-scrollbar-track{background:#1a1d26}
        ::-webkit-scrollbar-thumb{background:#2d3044;border-radius:2px}
        input,select,textarea{background:#151821;border:1px solid #2d3044;color:#E2E8F0;border-radius:6px;padding:8px 12px;font-family:inherit;font-size:13px;outline:none;width:100%;transition:border-color 0.2s}
        input:focus,select:focus,textarea:focus{border-color:#7C9EFF}
        textarea{resize:vertical;min-height:70px}
        select option{background:#151821}
        button{cursor:pointer;font-family:inherit}
        .row-hover:hover{background:rgba(124,158,255,0.04)!important}
        .pill{display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:500;letter-spacing:0.03em}
        .chip{display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;letter-spacing:0.04em;border:1px solid rgba(255,255,255,0.08)}
        .attn-card{background:rgba(251,191,36,0.06);border:1px solid rgba(251,191,36,0.2);border-radius:8px;padding:10px 14px;display:flex;align-items:center;gap:10px}
        .modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:100;display:flex;align-items:center;justify-content:center;padding:20px}
        .modal{background:#13161f;border:1px solid #2d3044;border-radius:12px;width:100%;max-width:520px;max-height:90vh;overflow-y:auto;padding:28px}
        .form-row{display:grid;grid-template-columns:1fr 1fr;gap:12px}
        .form-label{font-size:11px;color:#6B7280;letter-spacing:0.06em;text-transform:uppercase;margin-bottom:4px}
        .btn-primary{background:#7C9EFF;color:#0D0F14;border:none;padding:9px 20px;border-radius:6px;font-size:13px;font-weight:500;letter-spacing:0.03em;transition:background 0.15s}
        .btn-primary:hover{background:#9db4ff}
        .btn-ghost{background:transparent;color:#6B7280;border:1px solid #2d3044;padding:9px 18px;border-radius:6px;font-size:13px;transition:all 0.15s}
        .btn-ghost:hover{color:#E2E8F0;border-color:#4d5470}
        .btn-google{background:#1e2130;color:#E2E8F0;border:1px solid #2d3044;padding:7px 14px;border-radius:6px;font-size:12px;display:flex;align-items:center;gap:7px;transition:all 0.15s}
        .btn-google:hover{border-color:#7C9EFF;color:#7C9EFF}
        .btn-action{background:transparent;border:1px solid #2d3044;color:#9ba3bf;font-size:11px;padding:5px 12px;border-radius:5px;transition:all 0.15s}
        .btn-action:hover{border-color:#7C9EFF;color:#7C9EFF}
        .btn-action:disabled{opacity:0.4;cursor:not-allowed}
        .icon-btn{background:transparent;border:none;color:#4d5470;padding:4px 6px;border-radius:4px;font-size:14px;transition:color 0.15s}
        .icon-btn:hover{color:#E2E8F0}
        .tab{background:transparent;border:none;color:#6B7280;font-size:12px;padding:5px 11px;border-radius:5px;letter-spacing:0.03em;transition:all 0.15s}
        .tab.active{background:#1e2130;color:#E2E8F0}
        .tab:hover:not(.active){color:#9ba3bf}
      `}</style>

      {/* Toast */}
      {toast && (
        <div style={{position:'fixed',bottom:24,right:24,zIndex:200,background:toast.type==='success'?'#064e3b':toast.type==='error'?'#450a0a':'#1e2130',border:`1px solid ${toast.type==='success'?'#10B981':toast.type==='error'?'#F87171':'#2d3044'}`,color:toast.type==='success'?'#34D399':toast.type==='error'?'#F87171':'#E2E8F0',padding:'12px 18px',borderRadius:8,fontSize:13,maxWidth:360,boxShadow:'0 8px 32px rgba(0,0,0,0.4)'}}>
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div style={{borderBottom:'1px solid #1e2130',padding:'18px 28px',display:'flex',alignItems:'center',gap:12,flexWrap:'wrap'}}>
        <div style={{flex:1}}>
          <div style={{fontFamily:"'Syne',sans-serif",fontSize:20,fontWeight:800,letterSpacing:'-0.02em'}}>OPPORTUNITY TRACKER</div>
          <div style={{fontSize:11,color:'#4d5470',marginTop:2,letterSpacing:'0.06em'}}>
            {session.user.email} · {opps.length} opportunities · {counts['Applied']||0} applied
          </div>
        </div>

        {/* Google controls */}
        <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
          {!CLIENT_ID ? null : !googleReady ? (
            <span style={{fontSize:11,color:'#4d5470'}}>Loading Google…</span>
          ) : !gSignedIn ? (
            <button className="btn-google" onClick={handleGoogleSignIn}>
              <svg width="14" height="14" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
              Connect Google
            </button>
          ) : (
            <>
              <span style={{fontSize:11,color:'#34D399'}}>● {userEmail||'Google connected'}</span>
              <button className="btn-action" onClick={handleSyncAll}>↻ Sync all</button>
              <button className="btn-action" onClick={handleDigest}>✉ Digest</button>
              <button className="btn-ghost" style={{padding:'6px 12px',fontSize:11}} onClick={handleGoogleSignOut}>Disconnect</button>
            </>
          )}
        </div>

        {/* Export/Import/Paste */}
        <input ref={importRef} type="file" accept=".json" onChange={handleImport} style={{display:'none'}}/>
        <button className="btn-ghost" style={{padding:'7px 13px',fontSize:12}} onClick={handleExport}>↓ Export</button>
        <button className="btn-ghost" style={{padding:'7px 13px',fontSize:12,borderColor:'#34D399',color:'#34D399'}} onClick={handleExportMarkdown} title="Export job-tracker.md for Cowork skill">↓ Cowork</button>
        <button className="btn-ghost" style={{padding:'7px 13px',fontSize:12}} onClick={()=>importRef.current.click()}>↑ Import</button>
        <button className="btn-ghost" style={{padding:'7px 13px',fontSize:12,borderColor:'#A78BFA',color:'#A78BFA'}} onClick={()=>setShowPaste(true)}>⚡ Paste</button>
        <button className="btn-primary" onClick={openAdd}>+ Add</button>
        <button className="btn-ghost" style={{padding:'7px 13px',fontSize:11}} onClick={handleSignOut}>Sign out</button>
      </div>

      <div style={{padding:'20px 28px'}}>
        {dbLoading && <div style={{textAlign:'center',color:'#4d5470',padding:40,fontSize:13}}>Loading your opportunities…</div>}

        {/* Needs Attention */}
        {!dbLoading && needsAttention.length>0 && (
          <div style={{marginBottom:20}}>
            <div style={{fontSize:11,color:'#FBBF24',letterSpacing:'0.08em',marginBottom:8,textTransform:'uppercase'}}>⚡ Needs Attention</div>
            <div style={{display:'flex',flexWrap:'wrap',gap:8}}>
              {needsAttention.map(o=>{
                const nfu=(o.followUps||[]).filter(f=>daysDiff(f.date)!==null).sort((a,b)=>new Date(a.date)-new Date(b.date))[0]
                const ul=nfu?urgencyLabel(daysDiff(nfu.date)):null
                const iv=o.interviewDate&&daysDiff(o.interviewDate)<=3&&daysDiff(o.interviewDate)>=0
                return (
                  <div key={o.id} className="attn-card" style={{cursor:'pointer'}} onClick={()=>openEdit(o)}>
                    <div>
                      <div style={{fontSize:13,fontWeight:500}}>{o.org}</div>
                      <div style={{fontSize:11,color:'#6B7280'}}>{o.role}</div>
                    </div>
                    {ul&&<div style={{fontSize:11,color:ul.color,marginLeft:'auto',whiteSpace:'nowrap'}}>{ul.label}{nfu.label?` · ${nfu.label}`:''}</div>}
                    {iv&&<div style={{fontSize:11,color:'#34D399',whiteSpace:'nowrap'}}>🎤 Interview {daysDiff(o.interviewDate)===0?'today':`in ${daysDiff(o.interviewDate)}d`}</div>}
                    {gSignedIn&&<button className="btn-action" disabled={syncing.has(o.id)} onClick={e=>{e.stopPropagation();handleSyncCalendar(o)}} style={{fontSize:10,padding:'3px 8px'}}>{syncing.has(o.id)?'…':'↻'}</button>}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Status tabs */}
        {!dbLoading && (
          <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:16}}>
            {['All',...STATUSES.filter(s=>s!=='Archived')].map(s=>(
              <button key={s} className={`tab ${filter===s?'active':''}`} onClick={()=>setFilter(s)}>
                {s} {s!=='All'&&counts[s]?<span style={{color:'#4d5470',marginLeft:2}}>{counts[s]}</span>:s==='All'?<span style={{color:'#4d5470',marginLeft:2}}>{opps.length}</span>:''}
              </button>
            ))}
            <button className={`tab ${filter==='Archived'?'active':''}`} onClick={()=>setFilter('Archived')} style={{marginLeft:'auto'}}>Archive {counts['Archived']||''}</button>
          </div>
        )}

        {/* Controls */}
        {!dbLoading && (
          <div style={{display:'flex',gap:10,marginBottom:16,alignItems:'center',flexWrap:'wrap'}}>
            <input placeholder="Search…" value={search} onChange={e=>setSearch(e.target.value)} style={{width:200,padding:'6px 12px',fontSize:12}}/>
            <select value={typeFilter} onChange={e=>setTypeFilter(e.target.value)} style={{width:140,padding:'6px 10px',fontSize:12}}>
              <option value="All">All types</option>
              {TYPES.map(t=><option key={t}>{t}</option>)}
            </select>
            <select value={sortBy} onChange={e=>setSortBy(e.target.value)} style={{width:180,padding:'6px 10px',fontSize:12}}>
              <option value="followUpDate">Sort: Follow-up date</option>
              <option value="deadline">Sort: Deadline</option>
              <option value="org">Sort: Organization</option>
            </select>
            <div style={{marginLeft:'auto',fontSize:11,color:'#4d5470'}}>{filtered.length} shown</div>
          </div>
        )}

        {/* Table */}
        {!dbLoading && (
          <div style={{border:'1px solid #1e2130',borderRadius:10,overflow:'hidden'}}>
            <div style={{display:'grid',gridTemplateColumns:'2fr 1.4fr 100px 110px 105px 105px 90px',background:'#111318',borderBottom:'1px solid #1e2130',padding:'8px 16px',fontSize:10,color:'#4d5470',letterSpacing:'0.08em',textTransform:'uppercase'}}>
              <div>Organization / Role</div><div>Status</div><div>Type</div><div>Deadline</div><div>Applied</div><div>Follow-up</div><div></div>
            </div>

            {filtered.length===0&&<div style={{padding:'40px 16px',textAlign:'center',color:'#4d5470',fontSize:13}}>No opportunities found.</div>}

            {filtered.map((o,i)=>{
              const sc=STATUS_CONFIG[o.status]||STATUS_CONFIG['Interview – R1']
              const nextFu=(o.followUps||[]).filter(f=>daysDiff(f.date)!==null).sort((a,b)=>new Date(a.date)-new Date(b.date))[0]
              const fuLabel=nextFu?urgencyLabel(daysDiff(nextFu.date)):null
              const dlLabel=urgencyLabel(daysDiff(o.deadline))
              const isExpanded=expandedId===o.id
              const hasCal=!!(o.calendarEventIds?.deadline||o.calendarEventIds?.followUpTaskIds?.length)

              return (
                <div key={o.id}>
                  <div className="row-hover" style={{display:'grid',gridTemplateColumns:'2fr 1.4fr 100px 110px 105px 105px 90px',padding:'11px 16px',borderBottom:i<filtered.length-1||isExpanded?'1px solid #1a1d26':'none',alignItems:'center',cursor:'pointer',background:isExpanded?'rgba(124,158,255,0.04)':'transparent',transition:'background 0.15s'}} onClick={()=>setExpandedId(isExpanded?null:o.id)}>
                    <div>
                      <div style={{fontSize:13,fontWeight:500,color:'#E2E8F0',display:'flex',alignItems:'center',gap:6}}>
                        {o.org}
                        {hasCal&&<span title="Synced to Google Calendar" style={{fontSize:10,color:'#34D399'}}>●</span>}
                      </div>
                      <div style={{fontSize:11,color:'#6B7280',marginTop:1}}>{o.role}</div>
                    </div>
                    <div><span className="pill" style={{background:sc.bg,color:sc.color}}><span style={{width:5,height:5,borderRadius:'50%',background:sc.dot,display:'inline-block',flexShrink:0}}/>{o.status}</span></div>
                    <div><span className="chip" style={{color:'#9ba3bf',fontSize:10}}>{o.type}</span></div>
                    <div style={{fontSize:12,color:dlLabel?dlLabel.color:'#6B7280'}}>{o.deadline?(dlLabel?dlLabel.label:o.deadline.slice(5).replace('-','/')):(<span style={{color:'#2d3044'}}>—</span>)}</div>
                    <div style={{fontSize:12,color:'#6B7280'}}>{o.appliedDate?o.appliedDate.slice(5).replace('-','/'):(<span style={{color:'#2d3044'}}>—</span>)}</div>
                    <div style={{fontSize:12,color:fuLabel?fuLabel.color:'#6B7280'}}>
                      {nextFu?(fuLabel?fuLabel.label:nextFu.date.slice(5).replace('-','/')):(<span style={{color:'#2d3044'}}>—</span>)}
                      {(o.followUps||[]).length>1&&<span style={{fontSize:10,color:'#4d5470',marginLeft:4}}>+{o.followUps.length-1}</span>}
                    </div>
                    <div style={{display:'flex',gap:2,justifyContent:'flex-end'}} onClick={e=>e.stopPropagation()}>
                      {gSignedIn&&<button className="icon-btn" title="Sync" disabled={syncing.has(o.id)} onClick={()=>handleSyncCalendar(o)} style={{fontSize:12}}>{syncing.has(o.id)?'…':'↻'}</button>}
                      <button className="icon-btn" title="Edit" onClick={()=>openEdit(o)}>✎</button>
                      <button className="icon-btn" title="Delete" onClick={()=>deleteOpp(o.id)} style={{color:'#4d3030'}}>✕</button>
                    </div>
                  </div>

                  {isExpanded&&(
                    <div style={{background:'#0f1118',borderBottom:'1px solid #1a1d26',padding:'14px 16px 16px'}}>
                      {o.status.startsWith('Interview')&&(
                        <div style={{display:'flex',gap:8,marginBottom:12,alignItems:'center',flexWrap:'wrap'}}>
                          <span style={{fontSize:11,color:'#4d5470',marginRight:4}}>Round →</span>
                          {['Interview – R1','Interview – R2+','Interview – Final'].map(s=>{
                            const sc2=STATUS_CONFIG[s]; const active=o.status===s
                            return <button key={s} onClick={()=>quickStatus(o.id,s)} style={{background:active?sc2.bg:'transparent',border:`1px solid ${active?sc2.dot:'#2d3044'}`,color:active?sc2.color:'#6B7280',fontSize:11,padding:'3px 10px',borderRadius:20,cursor:'pointer',fontWeight:active?600:400,transition:'all 0.15s'}}>{s.replace('Interview – ','')}</button>
                          })}
                          {o.interviewDate&&<span style={{fontSize:11,color:'#F59E0B',marginLeft:8}}>📅 {o.interviewDate.slice(5).replace('-','/')}{(()=>{const d=daysDiff(o.interviewDate);return d!==null&&d>=0?` (${d===0?'today':d+'d away'})`:d<0?' (past)':''})()}</span>}
                        </div>
                      )}
                      {o.interviewNotes&&o.status.startsWith('Interview')&&(
                        <div style={{fontSize:12,color:'#34D399',lineHeight:1.6,maxWidth:600,marginBottom:10,background:'rgba(52,211,153,0.06)',border:'1px solid rgba(52,211,153,0.15)',borderRadius:6,padding:'8px 12px'}}>
                          <span style={{fontSize:10,color:'#34D399',letterSpacing:'0.06em',textTransform:'uppercase',display:'block',marginBottom:4}}>Interview Notes</span>
                          {o.interviewNotes}
                        </div>
                      )}
                      <div style={{display:'flex',gap:16,flexWrap:'wrap',marginBottom:(o.followUps||[]).length>0||o.notes||o.researchNotes?10:0,alignItems:'center'}}>
                        {o.link&&<a href={o.link} target="_blank" rel="noreferrer" style={{fontSize:12,color:'#7C9EFF',textDecoration:'none'}}>↗ Posting</a>}
                        {o.coverLetterLink&&<a href={o.coverLetterLink} target="_blank" rel="noreferrer" style={{fontSize:12,color:'#A78BFA',textDecoration:'none'}}>📄 Cover letter</a>}
                        {o.resumeLink&&<a href={o.resumeLink} target="_blank" rel="noreferrer" style={{fontSize:12,color:'#34D399',textDecoration:'none'}}>📋 Resume</a>}
                        <div style={{fontSize:11,color:'#4d5470'}}>Quick move →</div>
                        {STATUSES.filter(s=>s!==o.status&&!s.startsWith('Interview')).map(s=>(
                          <button key={s} onClick={()=>quickStatus(o.id,s)} style={{background:'transparent',border:'1px solid #2d3044',color:'#9ba3bf',fontSize:11,padding:'2px 9px',borderRadius:4,cursor:'pointer'}}>
                            {s}
                          </button>
                        ))}
                        {!o.status.startsWith('Interview')&&(
                          <button onClick={()=>quickStatus(o.id,'Interview – R1')} style={{background:'rgba(52,211,153,0.08)',border:'1px solid rgba(52,211,153,0.3)',color:'#34D399',fontSize:11,padding:'2px 9px',borderRadius:4,cursor:'pointer'}}>→ Interviewing</button>
                        )}
                        {hasCal&&<span style={{fontSize:11,color:'#34D399',marginLeft:'auto'}}>✓ Synced</span>}
                      </div>
                      {o.researchNotes&&(
                        <div style={{marginBottom:(o.followUps||[]).length>0||o.notes?10:0}}>
                          <div style={{fontSize:10,color:'#7C9EFF',letterSpacing:'0.06em',textTransform:'uppercase',marginBottom:4}}>Research Notes</div>
                          <div style={{fontSize:12,color:'#9ba3bf',lineHeight:1.7,maxWidth:680,background:'rgba(124,158,255,0.06)',border:'1px solid rgba(124,158,255,0.15)',borderRadius:6,padding:'8px 12px',whiteSpace:'pre-wrap'}}>{o.researchNotes}</div>
                        </div>
                      )}
                      {(o.followUps||[]).length>0&&(
                        <div style={{marginTop:0,marginBottom:o.notes?10:0}}>
                          <div style={{fontSize:10,color:'#4d5470',letterSpacing:'0.06em',textTransform:'uppercase',marginBottom:6}}>Follow-ups</div>
                          <div style={{display:'flex',flexDirection:'column',gap:5}}>
                            {[...(o.followUps||[])].sort((a,b)=>new Date(a.date)-new Date(b.date)).map(fu=>{
                              const d=daysDiff(fu.date); const ul=urgencyLabel(d); const isPast=d!==null&&d<0
                              return (
                                <div key={fu.id} style={{display:'flex',alignItems:'center',gap:10,opacity:isPast?0.45:1}}>
                                  <span style={{fontSize:11,color:ul?ul.color:'#6B7280',minWidth:70}}>{fu.date.slice(5).replace('-','/')}</span>
                                  {ul&&<span style={{fontSize:10,color:ul.color}}>({ul.label})</span>}
                                  <span style={{fontSize:12,color:'#9ba3bf',flex:1}}>{fu.label||'Follow up'}</span>
                                  {isPast&&<span style={{fontSize:10,color:'#4d5470'}}>done?</span>}
                                  <button onClick={async()=>{
                                    const updated={...o,followUps:(o.followUps||[]).filter(f=>f.id!==fu.id)}
                                    const saved=await updateOpp(o.id,updated)
                                    setOpps(prev=>prev.map(op=>op.id===o.id?saved:op))
                                  }} style={{background:'transparent',border:'none',color:'#4d3030',fontSize:12,cursor:'pointer',padding:'0 4px'}}>✕</button>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )}
                      {o.recurringReminder&&o.recurringReminder!=='none'&&(
                        <div style={{display:'flex',alignItems:'center',gap:10,marginTop:8,marginBottom:o.notes?8:0}}>
                          <span style={{fontSize:11,color:'#A78BFA'}}>🔁 {REMINDER_OPTIONS.find(r=>r.value===o.recurringReminder)?.label} reminder</span>
                          <button onClick={async()=>{
                            const date=nextRecurringDate(o)
                            if(!date) return
                            const label=o.recurringReminder==='weekly'?'Weekly check-in':o.recurringReminder==='2weeks'?'Bi-weekly check-in':'Monthly check-in'
                            const updated={...o,followUps:[...(o.followUps||[]),{id:'fu_'+Date.now(),date,label}]}
                            const saved=await updateOpp(o.id,updated)
                            setOpps(prev=>prev.map(op=>op.id===o.id?saved:op))
                          }} style={{background:'rgba(167,139,250,0.1)',border:'1px solid rgba(167,139,250,0.3)',color:'#A78BFA',fontSize:11,padding:'2px 10px',borderRadius:4,cursor:'pointer'}}>
                            + Add next ({nextRecurringDate(o)?.slice(5).replace('-','/')})
                          </button>
                        </div>
                      )}
                      {o.notes&&<div style={{fontSize:12,color:'#9ba3bf',lineHeight:1.7,maxWidth:600,fontStyle:'italic'}}>{o.notes}</div>}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Add/Edit Modal */}
      {showForm&&(
        <div className="modal-overlay" onClick={e=>{if(e.target===e.currentTarget)closeForm()}}>
          <div className="modal">
            <div style={{fontFamily:"'Syne',sans-serif",fontSize:16,fontWeight:700,marginBottom:20,letterSpacing:'-0.01em'}}>{editing?'Edit Opportunity':'New Opportunity'}</div>
            <div style={{display:'flex',flexDirection:'column',gap:14}}>
              <div><div className="form-label">Organization *</div><input value={form.org} onChange={e=>setForm(f=>({...f,org:e.target.value}))} placeholder="e.g. Brookings Institution"/></div>
              <div><div className="form-label">Role / Position</div><input value={form.role} onChange={e=>setForm(f=>({...f,role:e.target.value}))} placeholder="e.g. Research Associate"/></div>
              <div className="form-row">
                <div><div className="form-label">Type</div><select value={form.type} onChange={e=>setForm(f=>({...f,type:e.target.value}))}>{TYPES.map(t=><option key={t}>{t}</option>)}</select></div>
                <div><div className="form-label">Status</div><select value={form.status} onChange={e=>setForm(f=>({...f,status:e.target.value}))}>{STATUSES.map(s=><option key={s}>{s}</option>)}</select></div>
              </div>
              <div className="form-row">
                <div><div className="form-label">Deadline</div><input type="date" value={form.deadline} onChange={e=>setForm(f=>({...f,deadline:e.target.value}))}/></div>
                <div><div className="form-label">Date Applied</div><input type="date" value={form.appliedDate} onChange={e=>setForm(f=>({...f,appliedDate:e.target.value}))}/></div>
              </div>
              <div>
                <div className="form-label">Follow-ups</div>
                <div style={{display:'flex',flexDirection:'column',gap:6,marginBottom:6}}>
                  {[...(form.followUps||[])].sort((a,b)=>new Date(a.date)-new Date(b.date)).map(fu=>(
                    <div key={fu.id} style={{display:'flex',gap:6,alignItems:'center'}}>
                      <input type="date" value={fu.date} onChange={e=>setForm(f=>({...f,followUps:f.followUps.map(x=>x.id===fu.id?{...x,date:e.target.value}:x)}))} style={{width:140,flexShrink:0}}/>
                      <input value={fu.label} onChange={e=>setForm(f=>({...f,followUps:f.followUps.map(x=>x.id===fu.id?{...x,label:e.target.value}:x)}))} placeholder="e.g. LinkedIn outreach, follow-up email…" style={{flex:1}}/>
                      <button type="button" onClick={()=>setForm(f=>({...f,followUps:f.followUps.filter(x=>x.id!==fu.id)}))} style={{background:'transparent',border:'none',color:'#4d3030',fontSize:14,cursor:'pointer',padding:'0 4px',flexShrink:0}}>✕</button>
                    </div>
                  ))}
                </div>
                <button type="button" onClick={()=>setForm(f=>({...f,followUps:[...(f.followUps||[]),{id:'fu'+Date.now(),date:'',label:''}]}))} style={{background:'transparent',border:'1px dashed #2d3044',color:'#6B7280',fontSize:11,padding:'5px 12px',borderRadius:5,cursor:'pointer',width:'100%'}}>+ Add follow-up date</button>
              </div>
              {form.status.startsWith('Interview')&&(
                <>
                  <div style={{borderTop:'1px solid #1e2130',paddingTop:14,marginTop:2}}>
                    <div style={{fontSize:11,color:'#34D399',letterSpacing:'0.06em',textTransform:'uppercase',marginBottom:12}}>Interview Details</div>
                    <div className="form-row">
                      <div><div className="form-label">Interview Date</div><input type="date" value={form.interviewDate||''} onChange={e=>setForm(f=>({...f,interviewDate:e.target.value}))}/></div>
                      <div><div className="form-label">Round</div><select value={form.status} onChange={e=>setForm(f=>({...f,status:e.target.value}))}><option value="Interview – R1">Round 1</option><option value="Interview – R2+">Round 2+</option><option value="Interview – Final">Final Round</option></select></div>
                    </div>
                  </div>
                  <div><div className="form-label">Interview Notes</div><textarea value={form.interviewNotes||''} onChange={e=>setForm(f=>({...f,interviewNotes:e.target.value}))} placeholder="Format, interviewer names, topics to prep…"/></div>
                </>
              )}
              <div className="form-row">
                <div><div className="form-label">Recurring Reminder</div><select value={form.recurringReminder||'none'} onChange={e=>setForm(f=>({...f,recurringReminder:e.target.value}))}>{REMINDER_OPTIONS.map(r=><option key={r.value} value={r.value}>{r.label}</option>)}</select></div>
                <div><div className="form-label">Posting Link</div><input value={form.link} onChange={e=>setForm(f=>({...f,link:e.target.value}))} placeholder="https://…"/></div>
              </div>
              <div><div className="form-label">Notes</div><textarea value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} placeholder="Contacts, next steps, relevant details…"/></div>
              <div style={{borderTop:'1px solid #1e2130',paddingTop:14,marginTop:2}}>
                <div style={{fontSize:11,color:'#7C9EFF',letterSpacing:'0.06em',textTransform:'uppercase',marginBottom:12}}>Research & Documents</div>
                <div style={{display:'flex',flexDirection:'column',gap:14}}>
                  <div><div className="form-label">Research Notes</div><textarea value={form.researchNotes||''} onChange={e=>setForm(f=>({...f,researchNotes:e.target.value}))} placeholder="Org background, key people, why you're a fit, talking points…" style={{minHeight:90}}/></div>
                  <div className="form-row">
                    <div><div className="form-label">Cover Letter Link</div><input value={form.coverLetterLink||''} onChange={e=>setForm(f=>({...f,coverLetterLink:e.target.value}))} placeholder="Google Doc, Dropbox, Drive…"/></div>
                    <div><div className="form-label">Resume / CV Link</div><input value={form.resumeLink||''} onChange={e=>setForm(f=>({...f,resumeLink:e.target.value}))} placeholder="Google Doc, Dropbox, Drive…"/></div>
                  </div>
                </div>
              </div>
            </div>
            <div style={{display:'flex',gap:10,marginTop:22,justifyContent:'flex-end'}}>
              <button className="btn-ghost" onClick={closeForm}>Cancel</button>
              <button className="btn-primary" onClick={saveForm}>{editing?'Save Changes':'Add Opportunity'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Paste from Cowork modal */}
      {showPaste&&(
        <div className="modal-overlay" onClick={e=>{if(e.target===e.currentTarget){setShowPaste(false);setPasteText('')}}}>
          <div className="modal" style={{maxWidth:580}}>
            <div style={{fontFamily:"'Syne',sans-serif",fontSize:16,fontWeight:700,marginBottom:6}}>⚡ Paste from Cowork</div>
            <div style={{fontSize:12,color:'#6B7280',marginBottom:16,lineHeight:1.6}}>Copy the JSON block from your Cowork networking plan and paste it below.</div>
            <textarea autoFocus value={pasteText} onChange={e=>setPasteText(e.target.value)} placeholder={'Paste the JSON block here…'} style={{minHeight:220,fontSize:12,lineHeight:1.6,fontFamily:"'DM Mono',monospace"}}/>
            <div style={{display:'flex',gap:10,marginTop:16,justifyContent:'flex-end'}}>
              <button className="btn-ghost" onClick={()=>{setShowPaste(false);setPasteText('')}}>Cancel</button>
              <button className="btn-primary" style={{background:'#A78BFA'}} onClick={handlePaste} disabled={!pasteText.trim()}>Add to Tracker</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
