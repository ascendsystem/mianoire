# Stripe subscription setup

## Local-only test configuration

The current Supabase `SITE_URL` is set to `http://localhost:5500`. This is only suitable for tests in a browser on this same computer. Stripe Checkout redirects and Supabase invitation links will not work for customers on their own devices until the site is hosted on `mianoire.com`.

For both Stripe Payment Links, configure:

- After-payment success URL: `http://localhost:5500/payment-success.html`
- Cancel/back URL: `http://localhost:5500/pricing.html`

Before paying, verify in Stripe Dashboard whether these Payment Links are in **test mode**. The URLs currently in `pricing.html` do not visibly include `test_`; use test-mode Payment Links and test API/webhook keys for safe local testing. Do not use a real payment card to test.

The website has a minimal membership page with one Stripe Payment Link per plan. Stripe collects the checkout email. After payment, the Stripe webhook finds or invites the Supabase user by the checkout email, records the subscription against that user, and sends a first-time customer an invitation to set a password. The account page displays access as YES or NO, and Storage policies enforce the same access check.

## 1. Configure Stripe

In Stripe, create a product and its recurring prices:

- €9.99 every month
- €24.99 every 3 months

Create a separate Stripe Payment Link for each recurring price. The monthly link provided for the site is:

```text
https://buy.stripe.com/eVqdR9e3pgz68y59B48IU00
```

The 3-month Payment Link configured in `pricing.html` is:

```text
https://buy.stripe.com/5kQdR90cz2IgcOlfZs8IU01
```

Start in Stripe test mode when testing.

For both Payment Links, set the after-payment success redirect to:

```text
http://localhost:5500/payment-success.html
```

Set the cancellation redirect to:

```text
http://localhost:5500/pricing.html
```

## 2. Apply the database migration

Run `supabase-billing-migration.sql` in the Supabase SQL Editor. The migration creates a unique user-to-subscription mapping and updates Storage access so only admins or users with an active, unexpired subscription can read private files.

If the unique index reports duplicate `user_id` values, inspect `public.subscriptions` and remove/merge duplicate rows before running it again.

## 3. Configure Auth URLs and invitation email

In Supabase Authentication URL Configuration, add the local redirect URL:

```text
http://localhost:5500/**
```

For local testing, permit `http://localhost:5500/**`. Set the production site URL and redirect URLs to `https://mianoire.com/**` after the site is deployed.

In **Authentication → Email Templates → Invite user**, use the secure `{{ .ConfirmationURL }}` link and tell buyers that the checkout email becomes their login email. Example HTML:

```html
<h2>Your MIA account is ready</h2>
<p>We received your subscription payment.</p>
<p>Your login email is <strong>{{ .Email }}</strong>. Use this same email whenever you log in to MIA.</p>
<p>Set your password using this secure link:</p>
<p><a href="{{ .ConfirmationURL }}">Set my password</a></p>
<p>If you did not make this purchase, you can ignore this email.</p>
```

The webhook sends this invitation only if no Supabase account exists for the checkout email. Existing accounts keep their existing password and log in with that same email.

## 4. Install and link the Supabase CLI

From the MIA folder, install the Supabase CLI if needed, authenticate, and link the project:

```powershell
supabase login
supabase link --project-ref cmdqlxmrmytntrzfzvmd
```

## 5. Set server-only secrets

Use Stripe **test** secret and webhook keys while testing. Do not put these in HTML or browser JavaScript.

```powershell
supabase secrets set STRIPE_SECRET_KEY=sk_test_REPLACE_ME
supabase secrets set SITE_URL=http://localhost:5500
```

The webhook function also uses Supabase's built-in `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` server environment variables. Never expose the service-role key to the browser.

## 6. Deploy the webhook

```powershell
supabase functions deploy stripe-webhook --no-verify-jwt
```

The webhook verifies Stripe's signature. It matches an existing Supabase account by the email collected by Stripe, or creates an account and sends an invitation when the buyer does not already have one. Never use an untrusted URL parameter as the account ID for granting paid access.

## 7. Add the Stripe webhook endpoint

In Stripe Developers → Webhooks, add:

```text
https://cmdqlxmrmytntrzfzvmd.supabase.co/functions/v1/stripe-webhook
```

Subscribe to these events:

- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.paid`
- `invoice.payment_failed`

Copy the endpoint's signing secret (`whsec_...`) into `STRIPE_WEBHOOK_SECRET`, then redeploy or update the function secret.

```powershell
supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_REPLACE_ME
```

## Customer cancellation portal

In Stripe Dashboard, open **Settings → Billing → Customer portal** and enable subscription cancellation (prefer cancellation at the end of the billing period). Save the portal configuration.

Run `supabase-subscription-cancellation.sql` in Supabase SQL Editor, then deploy both functions (redeploy the webhook so it saves the cancellation state):

```powershell
supabase functions deploy create-portal
supabase functions deploy stripe-webhook --no-verify-jwt
```

After Stripe sends a subscription update with `cancel_at_period_end`, the content page shows the remaining time and scheduled end date. The customer can open the Stripe portal with **Cancel subscription**; the subscription remains active until its paid-through date.

## 8. Test the full flow

1. Open the site through the local web server at `http://localhost:5500`, not with `file:///`.
2. Click Subscribe, select a plan, and complete Stripe test checkout using a test card such as `4242 4242 4242 4242`, a future expiry, and any CVC.
3. The webhook should create/invite a Supabase account using the Stripe checkout email and save the active subscription. The invitation explains that this email is their MIA login; they follow its secure link to create a password.
4. Log in with that email and password. The account should show access YES and `content.html` should open.
5. Cancel the test subscription in Stripe and verify access changes after Stripe sends the subscription update.

Use a public HTTPS website URL for production and configure the Stripe Payment Link redirects to the production account URL. Switch to live Stripe mode only after testing.
