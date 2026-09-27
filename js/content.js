const CONTENT_BUCKET = 'private-content';
let galleryImages = [];
let currentImageIndex = 0;

function setupLightbox() {
  const lightbox = document.getElementById('lightbox');
  const lightboxImage = document.getElementById('lightboxImage');
  const closeButton = document.getElementById('lightboxClose');
  const previousButton = document.getElementById('lightboxPrev');
  const nextButton = document.getElementById('lightboxNext');
  if (!lightbox || !lightboxImage) return;

  const renderImage = () => {
    lightboxImage.src = galleryImages[currentImageIndex];
  };

  const setOpen = (open) => {
    lightbox.classList.toggle('open', open);
    lightbox.setAttribute('aria-hidden', String(!open));
    document.body.style.overflow = open ? 'hidden' : '';
    if (open) renderImage();
  };

  document.getElementById('contentGrid').addEventListener('click', (event) => {
    const image = event.target.closest('.content-card img');
    if (!image) return;
    currentImageIndex = galleryImages.indexOf(image.src);
    setOpen(true);
  });
  closeButton.addEventListener('click', () => setOpen(false));
  lightbox.addEventListener('click', (event) => {
    if (event.target === lightbox) setOpen(false);
  });
  previousButton.addEventListener('click', () => {
    currentImageIndex = (currentImageIndex - 1 + galleryImages.length) % galleryImages.length;
    renderImage();
  });
  nextButton.addEventListener('click', () => {
    currentImageIndex = (currentImageIndex + 1) % galleryImages.length;
    renderImage();
  });
  document.addEventListener('keydown', (event) => {
    if (!lightbox.classList.contains('open')) return;
    if (event.key === 'Escape') setOpen(false);
    if (event.key === 'ArrowLeft') previousButton.click();
    if (event.key === 'ArrowRight') nextButton.click();
  });
}

async function loadPrivateContent() {
  const grid = document.getElementById('contentGrid');
  const status = document.getElementById('contentStatus');
  if (!grid || !window.supabaseClient) return;

  const { data: { user } } = await window.supabaseClient.auth.getUser();
  if (!user) { window.location.href = 'index.html'; return; }

  const { data: admin, error: adminError } = await window.supabaseClient
    .from('admins')
    .select('user_id')
    .eq('user_id', user.id)
    .maybeSingle();
  if (adminError) {
    status.textContent = adminError.message;
    status.classList.add('error');
    return;
  }

  const { data: subscription, error: subscriptionError } = await window.supabaseClient
    .from('subscriptions')
    .select('status,current_period_end,stripe_customer_id')
    .eq('user_id', user.id)
    .maybeSingle();
  if (subscriptionError) {
    status.textContent = subscriptionError.message;
    status.classList.add('error');
    return;
  }
  const isAdmin = Boolean(admin);
  const hasActiveSubscription = subscription?.status === 'active'
    && subscription.current_period_end
    && Date.parse(subscription.current_period_end) > Date.now();
  if (!isAdmin && !hasActiveSubscription) {
    status.textContent = 'An active subscription is required to view this content.';
    return;
  }

  const { data: files, error } = await window.supabaseClient.storage.from(CONTENT_BUCKET).list('', { sortBy: { column: 'created_at', order: 'desc' } });
  if (error) { status.textContent = error.message; status.classList.add('error'); return; }
  if (!files.length) { status.textContent = 'New content is coming soon.'; return; }

  status.textContent = '';
  for (const file of files) {
    const { data, error: signedUrlError } = await window.supabaseClient.storage.from(CONTENT_BUCKET).createSignedUrl(file.name, 120);
    if (signedUrlError) {
      status.textContent = `Could not load ${file.name}: ${signedUrlError.message}`;
      status.classList.add('error');
      continue;
    }
    const figure = document.createElement('figure');
    const image = document.createElement('img');
    figure.className = 'content-card';
    image.src = data.signedUrl;
    image.alt = 'Private content';
    image.addEventListener('error', () => {
      status.textContent = 'A content image could not be displayed. Refresh the page to request a new secure image link.';
      status.classList.add('error');
    }, { once: true });
    galleryImages.push(data.signedUrl);
    figure.append(image);
    grid.appendChild(figure);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  setupLightbox();
  loadPrivateContent();
});
