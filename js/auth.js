/* Add your Supabase project values before using authentication. */
const SUPABASE_URL = 'https://cmdqlxmrmytntrzfzvmd.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_N7eomzreRC6FbAF-9eAbFg_s9k1Py47';
const supabaseReady = window.supabase && !SUPABASE_URL.includes('YOUR-PROJECT') && !SUPABASE_ANON_KEY.includes('YOUR_');
const supabaseClient = supabaseReady ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

if (supabaseClient) {
  const isPasswordRecoveryPage = window.location.pathname.endsWith('/account.html')
    && new URLSearchParams(window.location.search).get('reset') === '1';
  if (!isPasswordRecoveryPage && window.location.hash.includes('type=recovery')) {
    window.location.replace(`account.html?reset=1${window.location.hash}`);
  }

  supabaseClient.auth.onAuthStateChange((event) => {
    const isRecoveryPage = window.location.pathname.endsWith('/account.html')
      && new URLSearchParams(window.location.search).get('reset') === '1';
    if (event === 'PASSWORD_RECOVERY' && !isRecoveryPage) {
      window.location.assign('account.html?reset=1');
    }
  });
}

function enableSiteProtection() {
  document.addEventListener('contextmenu', (event) => event.preventDefault());
  document.addEventListener('dragstart', (event) => event.preventDefault());
  document.addEventListener('selectstart', (event) => event.preventDefault());
  const handleProtectionKey = (event) => {
    const key = event.key.toLowerCase();
    const blockedShortcut =
      event.key === 'F12' ||
      (event.ctrlKey && event.shiftKey && ['i', 'j', 'c'].includes(key)) ||
      (event.ctrlKey && ['s', 'u', 'p'].includes(key));
    if (blockedShortcut) {
      event.preventDefault();
      event.stopPropagation();
    }
  };
  document.addEventListener('keydown', handleProtectionKey, true);
  document.addEventListener('keyup', handleProtectionKey, true);
}

function showMessage(element, message, isError = false) {
  element.textContent = message;
  element.classList.toggle('error', isError);
}

async function signIn(email, password) {
  if (!supabaseClient) throw new Error('Supabase is not configured yet.');
  const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

async function signOut() {
  if (supabaseClient) await supabaseClient.auth.signOut();
}

function setupLogin() {
  const modal = document.getElementById('loginModal');
  const form = document.getElementById('loginForm');
  if (!modal || !form) return;
  const message = document.getElementById('loginMessage');

  const setOpen = (open) => {
    modal.classList.toggle('open', open);
    modal.setAttribute('aria-hidden', String(!open));
    if (open) document.getElementById('loginEmail').focus();
  };

  document.querySelectorAll('[data-open-login]').forEach((button) => button.addEventListener('click', () => setOpen(true)));
  document.querySelectorAll('[data-close-login]').forEach((button) => button.addEventListener('click', () => setOpen(false)));
  modal.addEventListener('click', (event) => { if (event.target === modal) setOpen(false); });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    showMessage(message, 'Signing in...');
    try {
      const email = document.getElementById('loginEmail').value;
      const password = document.getElementById('loginPassword').value;
      await signIn(email, password);
      window.location.href = 'content.html';
    } catch (error) {
      showMessage(message, error.message, true);
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  enableSiteProtection();
  setupLogin();
  if (new URLSearchParams(window.location.search).get('login') === '1') {
    document.querySelector('[data-open-login]')?.click();
  }
});
