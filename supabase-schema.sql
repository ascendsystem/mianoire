-- Run this in the Supabase SQL editor.
-- Stripe webhooks should update subscriptions.status to active, past_due, or canceled.

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  status text not null default 'inactive',
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.subscriptions enable row level security;

create policy "Users can view their own subscription"
  on public.subscriptions for select
  using (auth.uid() = user_id);

create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);

alter table public.admins enable row level security;

create policy "Admins can view their own admin record"
  on public.admins for select
  using (auth.uid() = user_id);

-- Keep the private-content bucket private. Files are served through signed URLs.
insert into storage.buckets (id, name, public)
values ('private-content', 'private-content', false)
on conflict (id) do update set public = false;

create policy "Authenticated users can read private content"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'private-content'
    and (
      exists (
        select 1 from public.subscriptions
        where user_id = auth.uid() and status = 'active'
      )
      or exists (
        select 1 from public.admins where user_id = auth.uid()
      )
    )
  );

create policy "Admins can upload private content"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'private-content'
    and exists (
      select 1 from public.admins where user_id = auth.uid()
    )
  );
