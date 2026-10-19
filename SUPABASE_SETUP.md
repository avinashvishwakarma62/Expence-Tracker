# Spendly 2.0 — Supabase + Vercel setup

Spendly keeps a local IndexedDB copy and can optionally sync a private account snapshot to Supabase. Cloud sync is **not active** until you configure your own project. Do not put a Supabase `service_role` secret in browser code.

## 1. Create a Supabase project

1. Create a project at https://supabase.com/dashboard.
2. Wait for the database to finish provisioning.
3. Open **SQL Editor → New query**.
4. Copy all of `supabase-schema.sql` from this folder into the editor and run it.
5. In **Project Settings → API**, copy the Project URL and the public publishable/anon key. Never use the `service_role` key.

The SQL creates `public.spendly_user_data` and Row Level Security policies that restrict each signed-in user to the row whose `user_id` equals their auth user ID. Keep RLS enabled.

## 2. Configure the browser client

Edit `config.js`:

```js
window.SPENDLY_CONFIG = {
  SUPABASE_URL: "https://YOUR-PROJECT-REF.supabase.co",
  SUPABASE_ANON_KEY: "YOUR_PUBLIC_PUBLISHABLE_OR_ANON_KEY"
};
```

Replace the placeholders with the values from your project. These two values are intended to be public browser configuration; the database's RLS policies are what protect user records. **Never paste a service-role key, database password, or other secret into `config.js`.**

## 3. Configure authentication URLs

In Supabase Dashboard → **Authentication → URL Configuration**:

- Set **Site URL** to your Vercel production URL after deployment.
- Add redirect URLs for your Vercel URL and local development, for example `http://localhost:8000/**`.
- If email confirmation is enabled, complete the email confirmation before signing in. Adjust the email templates/SMTP settings only if you know how you want to deliver account email.

Spendly currently uses email + password sign-up/sign-in. Password reset UI and social login are not included in this build.

## 4. Test locally first

From this folder run:

```bash
python -m http.server 8000
```

Open `http://localhost:8000`, go to **Settings → Cloud sync & account**, create an account or sign in, then select **Sync now**. Add a test transaction and wait for the sync status. Sign in with the same account in another browser/device to test the initial merge and sync.

The first sync merges local and cloud rows by record ID. Make a JSON backup before the first cloud sign-in. Existing browser data is not automatically moved between `file://`, `localhost`, and the Vercel origin; each origin has its own local IndexedDB store.

## 5. Deploy to Vercel

1. Commit the whole project folder to your GitHub repository, including `index.html`, `styles.css`, `app.js`, `config.js`, `supabase-schema.sql`, and this guide.
2. In https://vercel.com/, choose **Add New → Project** and import that GitHub repository.
3. For this static HTML project, leave the framework preset as **Other** (or static), set the root directory to the folder containing `index.html`, and leave the build command blank. The output directory should be the project root (`.`).
4. Deploy, then add the resulting production URL to Supabase Authentication URL Configuration.
5. Test sign-in, transaction save, refresh, sign-out, and sign-in on a second device.

Because this is a static frontend, `config.js` is delivered to the browser. The URL and public anon key are not secrets. RLS is mandatory. If you ever add a privileged backend, keep all service credentials server-side.

## Current sync design and limitations

- Local IndexedDB is the working copy; it remains available if the network/cloud is unavailable.
- Cloud sync is triggered after local writes and can also be started with **Sync now**.
- The current first version stores one JSON snapshot per user and merges records by ID / updated timestamp during sync. It is suitable for a personal MVP, but simultaneous edits to the same record from multiple devices are not a fully transactional real-time sync system. For high-reliability multi-device collaboration, move transactions, budgets, goals, categories, and recurring bills into normalized tables with per-record upserts and conflict handling.
- Recurring reminders appear in the app when it is open; they are not push notifications or background alarms. `Mark paid` creates an expense transaction and advances the next due date.
- PDF reports use the browser's Print → Save as PDF flow.
- Receipt OCR downloads Tesseract.js from a CDN and processes the selected image in the browser. OCR may misread values; review them before saving. The receipt image is not uploaded by this feature.
- Database hosting limits, backup retention, email delivery, and any paid Supabase/Vercel usage are governed by your account plans.
