-- Run this once after the original schema, so admins can read private content
-- without an active subscription.

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
        where user_id = auth.uid() and status = 'active'
      )
      or exists (
        select 1
        from public.admins
        where user_id = auth.uid()
      )
    )
  );
