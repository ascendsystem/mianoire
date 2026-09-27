-- Run once in Supabase SQL Editor before deploying the Stripe webhook.
-- Each Supabase account has one current subscription row, updated by Stripe events.

create unique index if not exists subscriptions_user_id_key
  on public.subscriptions (user_id);

alter table public.subscriptions
  add column if not exists cancel_at_period_end boolean not null default false;

drop policy if exists "Authenticated users can read private content"
  on storage.objects;

create policy "Authenticated users can read private content"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'private-content'
    and (
      exists (
        select 1
        from public.subscriptions
        where user_id = auth.uid()
          and status = 'active'
          and current_period_end > now()
      )
      or exists (
        select 1
        from public.admins
        where user_id = auth.uid()
      )
    )
  );
