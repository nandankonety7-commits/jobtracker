# Opportunity Tracker — Setup Guide

## Prerequisites
- Node.js installed ([nodejs.org](https://nodejs.org) — download the LTS version)

---

## Step 1 — Install dependencies

Open Terminal, navigate to this folder, and run:

```bash
cd job-tracker
npm install
```

---

## Step 2 — Set up Google Cloud (one-time, ~5 minutes)

You need a Google OAuth Client ID to connect Calendar and Gmail.

### 2a. Create a project
1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Click the project dropdown (top left) → **New Project**
3. Name it `job-tracker` → **Create**

### 2b. Enable the APIs
1. In the left menu go to **APIs & Services → Library**
2. Search for **Google Calendar API** → Enable it
3. Search for **Gmail API** → Enable it

### 2c. Configure the OAuth consent screen
1. Go to **APIs & Services → OAuth consent screen**
2. Choose **External** → **Create**
3. Fill in:
   - App name: `Job Tracker`
   - User support email: your Gmail
   - Developer contact: your Gmail
4. Click **Save and Continue** through the rest (no need to add scopes manually)
5. On the final screen, click **Back to Dashboard**
6. Click **Publish App** → Confirm  
   *(This lets you use it without Google's review — fine for personal use)*

### 2d. Create OAuth credentials
1. Go to **APIs & Services → Credentials**
2. Click **+ Create Credentials → OAuth client ID**
3. Application type: **Web application**
4. Name: `Job Tracker Local`
5. Under **Authorized JavaScript origins**, click **Add URI** and add:
   ```
   http://localhost:5173
   ```
6. Click **Create**
7. Copy the **Client ID** (looks like `123456789-abc....apps.googleusercontent.com`)

---

## Step 3 — Add your Client ID

Create a file called `.env` in the `job-tracker` folder:

```
VITE_GOOGLE_CLIENT_ID=paste-your-client-id-here.apps.googleusercontent.com
```

---

## Step 4 — Run the app

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

---

## Using the Google integrations

Once running:

1. Click **Connect Google** in the top right
2. Sign in with your Google account and grant permissions
3. You'll see your email address when connected

### Sync to Calendar
- Click **↻** next to any row to sync that opportunity's deadline and follow-up date as Google Calendar events (with email + popup reminders)
- Click **↻ Sync all to Calendar** to sync everything at once
- A green dot (●) next to an org name means it's been synced

### Weekly digest email
- Click **✉ Send digest** to email yourself a summary of everything due in the next 7 days
- Send it manually whenever you want, or set a recurring reminder to do it every Monday morning

---

## Notes

- Data is saved in your browser's localStorage — it persists between sessions
- You can run `npm run dev` any time to reopen the tracker
- The `.env` file is gitignored if you ever push this to GitHub (don't commit your Client ID)
