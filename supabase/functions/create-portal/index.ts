import Stripe from "npm:stripe@17.7.0";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405);

  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return jsonResponse({ error: "Authentication required." }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
  const siteUrl = Deno.env.get("SITE_URL")?.replace(/\/+$/, "");
  if (!supabaseUrl || !anonKey || !stripeSecretKey || !siteUrl) {
    console.error("Missing Stripe portal function configuration.");
    return jsonResponse({ error: "Subscription management is not configured yet." }, 500);
  }

  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) return jsonResponse({ error: "Invalid or expired login session." }, 401);

  const { data: subscription, error: subscriptionError } = await supabase
    .from("subscriptions")
    .select("stripe_customer_id,status,current_period_end")
    .eq("user_id", user.id)
    .maybeSingle();
  if (subscriptionError) {
    console.error("Could not load Stripe customer for portal:", subscriptionError.message);
    return jsonResponse({ error: "Could not load your subscription." }, 500);
  }
  if (!subscription?.stripe_customer_id) {
    return jsonResponse({ error: "No Stripe subscription was found for this account." }, 404);
  }
  if (!["active", "trialing", "past_due"].includes(subscription.status)) {
    return jsonResponse({ error: "There is no manageable active subscription." }, 409);
  }

  try {
    const stripe = new Stripe(stripeSecretKey, { apiVersion: "2024-11-20.acacia" });
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: subscription.stripe_customer_id,
      return_url: `${siteUrl}/content.html`,
    });
    return jsonResponse({ url: portalSession.url });
  } catch (error) {
    console.error("Stripe billing portal session creation failed:", error);
    return jsonResponse({ error: "Could not open Stripe subscription management." }, 502);
  }
});
