export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { opps, userEmail } = req.body
  const RESEND_API_KEY = process.env.RESEND_API_KEY

  if (!RESEND_API_KEY) {
    return res.status(500).json({ error: 'Email service not configured' })
  }

  const today = new Date()
  const inDays = (d) => Math.ceil((new Date(d) - today) / 86400000)

  const urgent = opps.filter(o => {
    if (['Rejected', 'Archived', 'Offer'].includes(o.status)) return false
    const nextFu = (o.followUps || []).filter(f => f.date).sort((a, b) => new Date(a.date) - new Date(b.date))[0]
    const fu = nextFu ? inDays(nextFu.date) : null
    const dl = o.deadline ? inDays(o.deadline) : null
    const iv = o.interviewDate ? inDays(o.interviewDate) : null
    return (fu !== null && fu <= 7) || (dl !== null && dl <= 7) || (iv !== null && iv <= 7 && iv >= 0)
  })

  const rows = urgent.map(o => {
    const nextFu = (o.followUps || []).filter(f => f.date).sort((a, b) => new Date(a.date) - new Date(b.date))[0]
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
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${o.role || '—'}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${o.status}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:#d97706;font-weight:600;">${tag}</td>
    </tr>`
  }).join('')

  const html = `
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
          Sent by your Opportunity Tracker ·
          <a href="https://jobtracker-iota-two.vercel.app" style="color:#7C9EFF;">Open tracker</a>
        </p>
      </div>
    </div>`

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Opportunity Tracker <onboarding@resend.dev>',
        to: [userEmail],
        subject: `📋 Job Search Digest – ${urgent.length} items need attention`,
        html,
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(error)
    }

    res.status(200).json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}
