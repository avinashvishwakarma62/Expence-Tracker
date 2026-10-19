# Spendly 2.0 — Expense Tracker

A responsive, local-first personal finance app with optional Supabase cloud sync. Built with vanilla HTML, CSS, and JavaScript; no frontend build step is required.

## Features

- Dashboard with balance, income, expenses, cash flow and spending by category
- Add, edit, delete, search and filter transactions
- Income and expense categories, payment methods and dates
- Monthly overall and category budgets with 50%, 80% and 100% usage alerts
- Analytics, monthly comparisons, spending insights and top categories
- Savings goals with progress and manual contributions
- Planner page with monthly spending calendar and day-by-day transaction detail
- Recurring bills with weekly/monthly/yearly cadence, due dates and “Mark paid” flow
- Monthly summary, selected-month CSV and print-to-PDF report
- Optional browser-side receipt OCR (requires internet to load Tesseract.js)
- Light, dark and system themes
- CSV transaction export and full JSON backup/restore (including recurring bills)
- Optional Supabase email/password authentication and cloud snapshot sync
- Local IndexedDB storage works without a Supabase project
- Responsive desktop, tablet and mobile layouts

## Run locally

```bash
python -m http.server 8000
```

Open `http://localhost:8000`. Use the same origin each time; opening `index.html` directly (`file://`) can cause browser storage behavior to differ. Each origin has its own local database.

## Enable cloud sync

Follow [SUPABASE_SETUP.md](SUPABASE_SETUP.md). In brief: create a Supabase project, run `supabase-schema.sql`, edit `config.js` with the Project URL and **public anon/publishable key**, then create an account or sign in in **Settings → Cloud sync & account**. Never put a `service_role` key in frontend code. Row Level Security must remain enabled.

For Vercel, import the repository as a static project with root directory containing `index.html`, no build command, and output directory `.`. Add the deployed URL to Supabase Authentication → URL Configuration.

## Data and privacy

- Transaction data is stored locally in IndexedDB first. The theme preference uses localStorage.
- If configured and signed in, Spendly syncs a per-user JSON snapshot to Supabase. RLS policies isolate each account.
- A JSON backup is still recommended. Clearing browser/site data can permanently erase the local copy.
- Do not commit any secret keys. The Supabase public anon/publishable key may be in `config.js` only when the SQL RLS policies are correctly applied.
- Cloud sync is best-effort snapshot merging, not real-time multi-device collaboration; see `SUPABASE_SETUP.md` for limitations.
- Recurring reminders are shown when the app is open. They do not currently send background push notifications.
- PDF uses browser printing; receipt OCR runs in-browser after downloading Tesseract.js from a CDN.

## Project files

- `index.html` — app layout and dialogs
- `styles.css` — responsive design and themes
- `app.js` — IndexedDB, UI, planner, OCR, reporting and optional cloud sync
- `config.js` — public Supabase browser configuration placeholders
- `supabase-schema.sql` — table and Row Level Security policies
- `SUPABASE_SETUP.md` — Supabase and Vercel setup steps

## Important notes

- Amounts are stored as integer paise to reduce floating-point rounding errors.
- The opening balance is a starting point, not income.
- Savings-goal contributions update the goal tracker only; record actual transactions separately if you want them reflected in the available balance.
- This app is for personal tracking and is not a bank connection or financial advice service.
