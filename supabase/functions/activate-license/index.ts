import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const LEMON_API = "https://api.lemonsqueezy.com/v1/licenses";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface LemonActivateResponse {
  activated: boolean;
  error?: string;
  license_key?: { id: number; status: string; key: string };
  instance?: { id: string; name: string };
  meta?: { store_id: number; product_id: number };
}

interface LemonValidateResponse {
  valid: boolean;
  error?: string;
  license_key?: { id: number; status: string; key: string };
}

async function lemonFetch<T>(url: string, params: Record<string, string>): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept": "application/json",
    },
    body: new URLSearchParams(params),
  });

  const text = await res.text();
  console.log(`[lemon] ${url} → ${res.status}`, text.substring(0, 500));

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`LemonSqueezy returned non-JSON (HTTP ${res.status}): ${text.substring(0, 200)}`);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return Response.json({ success: false, error: "Missing authorization" }, { headers: corsHeaders });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await supabaseUser.auth.getUser();
    if (authError || !user) {
      return Response.json({ success: false, error: "Invalid token" }, { headers: corsHeaders });
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    const { license_key, instance_name, action = "activate" } = await req.json();

    // --- DEACTIVATE ---
    if (action === "deactivate") {
      // Read the stored instance_id to deactivate on LemonSqueezy
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("license_key, lemon_instance_id")
        .eq("id", user.id)
        .single();

      if (profile?.license_key && profile?.lemon_instance_id) {
        try {
          await lemonFetch<Record<string, unknown>>(`${LEMON_API}/deactivate`, {
            license_key: profile.license_key,
            instance_id: profile.lemon_instance_id,
          });
        } catch (e) {
          console.error("[lemon] deactivate error (non-blocking):", e);
        }
      }

      await supabaseAdmin
        .from("profiles")
        .update({ is_pro: false, license_key: null, lemon_instance_id: null })
        .eq("id", user.id);

      return Response.json({ success: true }, { headers: corsHeaders });
    }

    // --- ACTIVATE ---
    if (!license_key || !instance_name) {
      return Response.json({ success: false, error: "license_key and instance_name are required" }, { headers: corsHeaders });
    }

    // 1. Try /activate with instance_name
    let activated = false;
    let instanceId: string | null = null;

    try {
      const data = await lemonFetch<LemonActivateResponse>(`${LEMON_API}/activate`, {
        license_key,
        instance_name,
      });
      activated = data.activated || data.license_key?.status === "active";
      instanceId = data.instance?.id ?? null;
    } catch (e) {
      console.error("[lemon] activate error:", e);
    }

    // 2. If activate failed, try /validate (key might already be active)
    if (!activated) {
      try {
        const data = await lemonFetch<LemonValidateResponse>(`${LEMON_API}/validate`, {
          license_key,
        });
        if (data.valid) {
          activated = true;
        } else {
          return Response.json(
            { success: false, error: data.error || "Licence invalide" },
            { headers: corsHeaders },
          );
        }
      } catch (e) {
        return Response.json(
          { success: false, error: `Erreur LemonSqueezy: ${e instanceof Error ? e.message : "unknown"}` },
          { headers: corsHeaders },
        );
      }
    }

    // 3. License valid — update profiles via service_role
    const updateData: Record<string, unknown> = { is_pro: true, license_key };
    if (instanceId) updateData.lemon_instance_id = instanceId;

    const { error: updateError } = await supabaseAdmin
      .from("profiles")
      .update(updateData)
      .eq("id", user.id);

    if (updateError) {
      console.error("[db] update error:", updateError);
      return Response.json(
        { success: false, error: "Erreur lors de la mise à jour du profil" },
        { headers: corsHeaders },
      );
    }

    return Response.json({ success: true }, { headers: corsHeaders });
  } catch (err) {
    console.error("[function] unhandled error:", err);
    return Response.json(
      { success: false, error: err instanceof Error ? err.message : "Internal error" },
      { headers: corsHeaders },
    );
  }
});
