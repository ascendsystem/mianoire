import Stripe from "npm:stripe@17.7.0";
import { createClient } from "npm:@supabase/supabase-js@2";

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405);

  const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const siteUrl = Deno.env.get("SITE_URL")?.replace(/\/+$/, "");
  if (!stripeSecretKey || !webhookSecret || !supabaseUrl || !serviceRoleKey || !siteUrl) {
    console.error("Missing webhook function configuration.");
    return jsonResponse({ error: "Webhook is not configured." }, 500);
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) return jsonResponse({ error: "Missing Stripe signature." }, 400);

  const stripe = new Stripe(stripeSecretKey, { apiVersion: "2024-11-20.acacia" });
  const payload = await request.text();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      payload,
      signature,
      webhookSecret,
      undefined,
      Stripe.createSubtleCryptoProvider(),
    );
  } catch (error) {
    console.error("Stripe webhook signature verification failed:", error);
    return jsonResponse({ error: "Invalid webhook signature." }, 400);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  async function findUserByEmail(email: string) {
    const normalizedEmail = email.trim().toLowerCase();
    for (let page = 1; ; page += 1) {
      const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
      if (error) throw error;
      const match = data.users.find((user) => user.email?.toLowerCase() === normalizedEmail);
      if (match) return match;
      if (data.users.length < 1000) return null;
    }
  }

  async function getOrInviteUser(email: string) {
    const existingUser = await findUserByEmail(email);
    if (existingUser) return existingUser;

    const { data, error } = await supabase.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${siteUrl}/account.html?welcome=1`,
    });
    if (!error && data.user) return data.user;

    const userCreatedByConcurrentEvent = await findUserByEmail(email);
    if (userCreatedByConcurrentEvent) return userCreatedByConcurrentEvent;
    throw error || new Error("Supabase did not return the invited user.");
  }

  async function syncSubscription(subscription: Stripe.Subscription, checkoutUserId?: string | null) {
    const stripeSubscriptionId = subscription.id;
    const customerId = typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer.id;
    let userId = checkoutUserId || subscription.metadata.supabase_user_id;

    if (!userId) {
      const { data, error } = await supabase
        .from("subscriptions")
        .select("user_id")
        .eq("stripe_subscription_id", stripeSubscriptionId)
        .maybeSingle();
      if (error) throw error;
      userId = data?.user_id;
    }
    if (!userId) {
      console.error("Subscription has no mapped Supabase user:", stripeSubscriptionId);
      return;
    }

    const { error } = await supabase.from("subscriptions").upsert({
      user_id: userId,
      stripe_customer_id: customerId,
      stripe_subscription_id: stripeSubscriptionId,
      status: subscription.status,
      current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
      cancel_at_period_end: subscription.cancel_at_period_end,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });
    if (error) throw error;
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode === "subscription" && typeof session.subscription === "string") {
          const email = session.customer_details?.email || session.customer_email;
          if (!email) throw new Error("Completed subscription checkout has no customer email.");
          const user = await getOrInviteUser(email);
          const subscription = await stripe.subscriptions.retrieve(session.subscription);
          await syncSubscription(subscription, user.id);
        }
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const eventSubscription = event.data.object as Stripe.Subscription;
        const latestSubscription = await stripe.subscriptions.retrieve(eventSubscription.id);
        await syncSubscription(latestSubscription);
        break;
      }
      case "invoice.paid":
      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const subscriptionId = typeof invoice.subscription === "string"
          ? invoice.subscription
          : invoice.subscription?.id;
        if (subscriptionId) {
          const subscription = await stripe.subscriptions.retrieve(subscriptionId);
          await syncSubscription(subscription);
        }
        break;
      }
      default:
        break;
    }
  } catch (error) {
    console.error(`Could not process Stripe event ${event.id}:`, error);
    return jsonResponse({ error: "Could not apply subscription update." }, 500);
  }

  return jsonResponse({ received: true });
});
