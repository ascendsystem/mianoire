async function uploadContent(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const status = document.getElementById('adminStatus');
  const file = document.getElementById('contentFile').files[0];
  if (!file || !window.supabaseClient) {
    status.textContent = 'Configure Supabase and choose a file first.';
    status.classList.add('error');
    return;
  }

  const { data: { user } } = await window.supabaseClient.auth.getUser();
  if (!user) {
    status.textContent = 'You must log in as an administrator first.';
    status.classList.add('error');
    return;
  }
  const { data: admin, error: adminError } = await window.supabaseClient
    .from('admins')
    .select('user_id')
    .eq('user_id', user.id)
    .maybeSingle();
  if (adminError || !admin) {
    status.textContent = 'You do not have administrator access.';
    status.classList.add('error');
    return;
  }

  status.classList.remove('error');
  status.textContent = 'Uploading...';
  const path = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '-')}`;
  const { error } = await window.supabaseClient.storage.from('private-content').upload(path, file, { upsert: false });
  if (error) { status.textContent = error.message; status.classList.add('error'); return; }
  status.textContent = 'Content uploaded successfully.';
  form.reset();
}

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('adminForm');
  if (form) form.addEventListener('submit', uploadContent);
});
