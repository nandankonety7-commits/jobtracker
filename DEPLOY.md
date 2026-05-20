# Opportunity Tracker — Deployment Guide

## Step 1 — Run the database schema in Supabase

1. Go to [supabase.com/dashboard](https://supabase.com/dashboard) → your project
2. Click **SQL Editor** in the left sidebar
3. Paste the contents of `schema.sql` and click **Run**
4. You should see "Success. No rows returned."

---

## Step 2 — Verify the database

In Supabase → **Table Editor**, confirm the `opportunities` table exists with columns:  
`id`, `user_id`, `org`, `role`, `type`, `status`, `deadline`, `applied_date`,  
`follow_ups`, `interview_date`, `interview_notes`, `recurring_reminder`,  
`link`, `notes`, `calendar_event_ids`, `created_at`, `updated_at`

Also verify RLS is enabled: **Authentication → Policies** → you should see 4 policies on `opportunities`.

---

## Step 3 — Test locally

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) and:
1. Sign up with your email → check Supabase **Authentication → Users** to see you appear
2. Add an opportunity → check **Table Editor → opportunities** to see it saved
3. Reload the page → confirm data loads back from Supabase

---

## Step 4 — Push to GitHub

```bash
git init
git add .
git commit -m "Initial commit — opportunity tracker with Supabase"
```

Then create a repo on github.com (call it `job-tracker`), and:

```bash
git remote add origin https://github.com/YOUR_USERNAME/job-tracker.git
git branch -M main
git push -u origin main
```

---

## Step 5 — Deploy to Vercel

### Option A — Vercel dashboard (easiest)
1. Go to [vercel.com](https://vercel.com) → **Add New Project**
2. Import your `job-tracker` GitHub repo
3. Framework preset: **Vite** (auto-detected)
4. Add environment variables (copy from your `.env`):
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `VITE_GOOGLE_CLIENT_ID`
5. Click **Deploy**

### Option B — Vercel CLI
```bash
npm i -g vercel
vercel
# Follow prompts, then:
vercel env add VITE_SUPABASE_URL
vercel env add VITE_SUPABASE_ANON_KEY
vercel env add VITE_GOOGLE_CLIENT_ID
vercel --prod
```

Vercel will give you a URL like `https://job-tracker-abc123.vercel.app`.

---

## Step 6 — Update Supabase auth redirect URL

1. Supabase Dashboard → **Authentication → URL Configuration**
2. Add your Vercel URL to **Redirect URLs**:
   ```
   https://your-app.vercel.app
   ```

---

## Step 7 — Update Google OAuth origins

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. **APIs & Services → Credentials → your OAuth client**
3. Under **Authorized JavaScript origins**, add:
   ```
   https://your-app.vercel.app
   ```
4. Click **Save**

> Changes can take up to 5 minutes to propagate.

---

## Migrating existing data

If you have opportunities saved in localStorage from before Supabase was set up:

1. In the running app, click **↓ Export** to download a JSON backup
2. After signing in to the Supabase-backed version, click **↑ Import** and select the file
3. All opportunities will be imported to Supabase

---

## Environment variables reference

| Variable | Where to find it |
|---|---|
| `VITE_SUPABASE_URL` | Supabase Dashboard → Settings → API → Project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase Dashboard → Settings → API → anon/public key |
| `VITE_GOOGLE_CLIENT_ID` | Google Cloud Console → APIs & Services → Credentials |
