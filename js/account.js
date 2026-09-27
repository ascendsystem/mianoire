async function loadAccount() {
  const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
  if (userError) throw userError;
  if (!user) { window.location.href = 'index.html'; return; }

  if (new URLSearchParams(window.location.search).get('welcome') === '1') {
    document.getElementById('passwordSetupForm').hidden = false;
    document.querySelector('.account-section-title').hidden = true;
    document.getElementById('subscriptionPanel').hidden = true;
    document.getElementById('subscriptionStatus').hidden = true;
    document.getElementById('accountEmail').textContent = `Your MIA login email: ${user.email || ''}`;
    return;
  }
  document.getElementById('accountEmail').textContent = user.email || '';
  const panel = document.getElementById('subscriptionPanel');
  const remaining = document.getElementById('subscriptionRemaining');
  const note = document.getElementById('subscriptionNote');
  const manageButton = document.getElementById('manageSubscriptionButton');
  const statusBadge = document.getElementById('subscriptionStatus');
  const message = document.getElementById('accountMessage');

  const [adminResult, subscriptionResult] = await Promise.all([
    supabaseClient.from('admins').select('user_id').eq('user_id', user.id).maybeSingle(),
    supabaseClient.from('subscriptions').select('status,current_period_end,stripe_customer_id').eq('user_id', user.id).maybeSingle(),
  ]);
  if (adminResult.error) throw adminResult.error;
  if (subscriptionResult.error) throw subscriptionResult.error;

  const isAdmin = Boolean(adminResult.data);
  const renderAccess = (subscription) => {
    const periodEnd = subscription?.current_period_end ? new Date(subscription.current_period_end) : null;
    const isActive = subscription?.status === 'active' && periodEnd && periodEnd.getTime() > Date.now();
    const hasAccess = isAdmin || Boolean(isActive);
    panel.hidden = isAdmin;
    statusBadge.textContent = hasAccess ? 'Active' : 'Inactive';
    statusBadge.classList.toggle('is-active', hasAccess);
    statusBadge.classList.toggle('is-inactive', !hasAccess);
    if (isAdmin) {
      remaining.textContent = 'Administrator access';
      note.textContent = '';
      manageButton.hidden = true;
    } else if (isActive) {
      const remainingMs = Math.max(0, periodEnd.getTime() - Date.now());
      const totalMinutes = Math.floor(remainingMs / 60000);
      const days = Math.floor(totalMinutes / 1440);
      const hours = Math.floor((totalMinutes % 1440) / 60);
      const minutes = totalMinutes % 60;
      remaining.textContent = `${days}d ${hours}h ${minutes}m remaining`;
      manageButton.hidden = !subscription.stripe_customer_id;
      return hasAccess;
    } else if (!subscription) {
      remaining.textContent = 'No active subscription';
      note.textContent = 'Subscribe to keep access to the private content.';
      manageButton.hidden = true;
    } else {
      remaining.textContent = 'Subscription inactive';
      note.textContent = 'Access is not currently active.';
      manageButton.hidden = true;
    }
    return hasAccess;
  };
  let hasAccess = renderAccess(subscriptionResult.data);

  const updateSubscriptionNote = async () => {
    const { data: subscription, error } = await supabaseClient
      .from('subscriptions')
      .select('current_period_end,cancel_at_period_end')
      .eq('user_id', user.id)
      .maybeSingle();
    if (error) {
      note.textContent = `Renews on ${new Date(remaining.dataset.periodEnd).toLocaleDateString()}. Run supabase-subscription-cancellation.sql to show scheduled cancellations.`;
      return;
    }
    if (!subscription?.current_period_end) return;
    const periodEnd = new Date(subscription.current_period_end);
    const cancellationScheduled = Boolean(subscription.cancel_at_period_end);
    note.textContent = cancellationScheduled
      ? `Access ends on ${periodEnd.toLocaleDateString()}. Cancellation is scheduled.`
      : `Renews on ${periodEnd.toLocaleDateString()}.`;
    manageButton.textContent = cancellationScheduled ? 'Manage subscription' : 'Cancel subscription';
  };

  manageButton.addEventListener('click', async () => {
    manageButton.disabled = true;
    note.textContent = 'Opening secure Stripe billing portal...';
    try {
      const { data, error } = await supabaseClient.functions.invoke('create-portal');
      if (error) throw error;
      if (!data?.url) throw new Error('Stripe did not return a billing portal URL.');
      window.location.assign(data.url);
    } catch (error) {
      note.textContent = error.message;
      manageButton.disabled = false;
    }
  });
  if (!isAdmin && subscriptionResult.data?.status === 'active') {
    remaining.dataset.periodEnd = subscriptionResult.data.current_period_end;
    await updateSubscriptionNote();
    window.setInterval(async () => {
      const { data, error } = await supabaseClient
        .from('subscriptions')
        .select('status,current_period_end,stripe_customer_id')
        .eq('user_id', user.id)
        .maybeSingle();
      if (error) {
        note.textContent = error.message;
        return;
      }
      renderAccess(data);
      if (data?.status === 'active' && data.current_period_end) {
        remaining.dataset.periodEnd = data.current_period_end;
        await updateSubscriptionNote();
      }
    }, 60000);
  }

  const checkoutResult = new URLSearchParams(window.location.search).get('checkout');
  if (checkoutResult === 'success') {
    message.textContent = 'Payment received. Confirming your subscription...';
    for (let attempt = 0; attempt < 5 && !hasAccess; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 2000));
      const { data, error } = await supabaseClient
        .from('subscriptions')
        .select('status,current_period_end,stripe_customer_id')
        .eq('user_id', user.id)
        .maybeSingle();
      if (error) throw error;
      hasAccess = renderAccess(data);
      if (hasAccess && !isAdmin) await updateSubscriptionNote();
    }
    message.textContent = hasAccess
      ? 'Your subscription is active. Welcome!'
      : 'Payment received. Access will appear as soon as Stripe confirms the subscription. Refresh this page in a moment.';
  } else if (checkoutResult === 'cancelled') {
    message.textContent = 'Checkout was cancelled. No payment was made.';
  }
}

document.getElementById('passwordSetupForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const message = document.getElementById('accountMessage');
  const { error } = await supabaseClient.auth.updateUser({
    password: document.getElementById('newPassword').value,
  });
  if (error) {
    message.textContent = error.message;
    message.classList.add('error');
    return;
  }
  message.classList.remove('error');
  message.textContent = 'Password saved. Your account is ready.';
  window.history.replaceState({}, '', 'account.html');
  window.setTimeout(() => window.location.reload(), 800);
});

document.getElementById('logoutButton').addEventListener('click', async () => {
  await signOut();
  window.location.href = 'index.html';
});

document.addEventListener('DOMContentLoaded', () => {
  loadAccount().catch((error) => {
    const message = document.getElementById('accountMessage');
    message.textContent = error.message;
    message.classList.add('error');
  });
});
