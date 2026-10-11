import { createClient } from "npm:@supabase/supabase-js@2.84.0";
import Stripe from "npm:stripe@16.12.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const PACKS: Record<string, { credits: number; priceCents: number; name: string }> = {
  "200": { credits: 200, priceCents: 8000, name: "Starter" },
  "500": { credits: 500, priceCents: 17500, name: "Pro" },
  "1000": { credits: 1000, priceCents: 30000, name: "Enterprise" },
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) {
      return new Response(JSON.stringify({ error: "Stripe is not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const stripe = new Stripe(stripeKey, { apiVersion: "2024-12-18.acacia" as any });

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!jwt) {
      return new Response(JSON.stringify({ error: "Missing Authorization header" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: userData, error: userErr } = await supabase.auth.getUser(jwt);
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Invalid or expired session" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = userData.user.id;
    const userEmail = userData.user.email ?? "";

    const body = await req.json();
    const { pack, method } = body as { pack: string; method: string };

    if (!PACKS[pack]) {
      return new Response(JSON.stringify({ error: "Invalid pack selected" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const selected = PACKS[pack];

    const origin = req.headers.get("origin") || "https://bolt.new";
    const successUrl = `${origin}/checkout?status=success&session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${origin}/balance?status=cancelled`;

    const session = await stripe.checkout.sessions.create({
      payment_method_types: method === "card" ? ["card"] : method === "paypal" ? ["paypal"] : ["card"],
      mode: "payment",
      customer_email: userEmail,
      line_items: [{
        price_data: {
          currency: "usd",
          product_data: { name: `${selected.name} — ${selected.credits} credits` },
          unit_amount: selected.priceCents,
        },
        quantity: 1,
      }],
      metadata: {
        user_id: userId,
        pack,
        credits: String(selected.credits),
      },
      success_url: successUrl,
      cancel_url: cancelUrl,
    });

    // Record a pending transaction
    await supabase.from("credit_transactions").insert({
      user_id: userId,
      type: "purchase",
      credits: selected.credits,
      amount_cents: selected.priceCents,
      currency: "usd",
      stripe_session_id: session.id,
      pack,
      description: `${selected.name} pack — ${selected.credits} credits`,
      status: "pending",
    });

    return new Response(JSON.stringify({
      session_id: session.id,
      redirect_url: session.url,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Checkout failed" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
