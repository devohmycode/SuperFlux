import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const LEMON_API = "https://api.lemonsqueezy.com/v1/licenses";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface LemonResponse {
  valid: boolean;
  error?: string;
  license_key?: { id: number; status: string; key: string };
}

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // 1. Authenticate the user via JWT
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return Response.json({ success: false, error: "Missing authorization" }, { status: 401, headers: corsHeaders });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Client-scoped Supabase (to identify user)
    const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await supabaseUser.auth.getUser();
    if (authError || !user) {
      return Response.json({ success: false, error: "Invalid token" }, { status: 401, headers: corsHeaders });
    }

    // Admin client (service_role — bypasses RLS)
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // 2. Parse body
    const { license_key, instance_id, action = "activate" } = await req.json();

    // --- DEACTIVATE ---
    if (action === "deactivate") {
      await supabaseAdmin
        .from("profiles")
        .update({ is_pro: false, license_key: null })
        .eq("id", user.id);

      return Response.json({ success: true }, { headers: corsHeaders });
    }

    // --- ACTIVATE ---
    if (!license_key || !instance_id) {
      return Response.json({ success: false, error: "license_key and instance_id are required" }, { status: 400, headers: corsHeaders });
    }

    // 3. Call LemonSqueezy activate endpoint server-side
    const lemonRes = await fetch(`${LEMON_API}/activate`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ license_key, instance_id }),
    });
    const lemonData: LemonResponse = await lemonRes.json();

    // If activate says already activated, try validate
    if (!lemonData.valid && lemonData.license_key?.status !== "active") {
      const validateRes = await fetch(`${LEMON_API}/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ license_key, instance_id }),
      });
      const validateData: LemonResponse = await validateRes.json();

      if (!validateData.valid) {
        return Response.json(
          { success: false, error: validateData.error || "Licence invalide" },
          { status: 400, headers: corsHeaders },
        );
      }
    }

    // 4. License is valid — update profiles via service_role
    const { error: updateError } = await supabaseAdmin
      .from("profiles")
      .update({ is_pro: true, license_key })
      .eq("id", user.id);

    if (updateError) {
      return Response.json(
        { success: false, error: "Erreur lors de la mise à jour du profil" },
        { status: 500, headers: corsHeaders },
      );
    }

    return Response.json({ success: true }, { headers: corsHeaders });
  } catch (err) {
    return Response.json(
      { success: false, error: err instanceof Error ? err.message : "Internal error" },
      { status: 500, headers: corsHeaders },
    );
  }
});
