-- Run this in Supabase SQL Editor. Stores one private JSON snapshot per user.
-- RLS is mandatory: a signed-in user can access only their own row.
create table if not exists public.spendly_user_data (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.spendly_user_data enable row level security;
drop policy if exists "Users can read own Spendly data" on public.spendly_user_data;
create policy "Users can read own Spendly data" on public.spendly_user_data
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists "Users can insert own Spendly data" on public.spendly_user_data;
create policy "Users can insert own Spendly data" on public.spendly_user_data
  for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "Users can update own Spendly data" on public.spendly_user_data;
create policy "Users can update own Spendly data" on public.spendly_user_data
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
