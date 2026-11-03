import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const MAX_SAFE_LIMIT = 20;
const DEFAULT_RESULT_LIMIT = 10;
const DAILY_QUOTA = 10;

function envFirst(names: string[]): string | undefined {
  for (const n of names) {
    const v = Deno.env.get(n);
    if (v && v.trim()) return v.trim();
  }
  return undefined;
}

interface FindLeadsRequest {
  segment: string;
  persona: string;
  limit?: number;
}

interface ClayMatchedExperience {
  company: string | null;
  title: string | null;
  location: string | null;
  start_date: string | null;
  end_date: string | null;
}
interface ClayPersonResult {
  clay_profile_id: number;
  name: string | null;
  first_name: string | null;
  last_name: string | null;
  linkedin_url: string | null;
  location: { name: string | null; city: string | null; state_or_province: string | null };
  matched_experiences: ClayMatchedExperience[];
}

async function callDeepSeek(messages: { role: string; content: string }[], temperature: number, maxTokens: number): Promise<string> {
  const res = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("DEEPSEEK_API_KEY")}` },
    body: JSON.stringify({ model: "deepseek-chat", messages, max_tokens: maxTokens, temperature }),
  });
  if (!res.ok) throw new Error(`DeepSeek API error: ${res.status}`);
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("DeepSeek returned an empty response");
  return content;
}

function extractJsonValue(content: string): unknown | null {
  const text = content.replace(/```(?:json)?/gi, "").trim();
  const start = text.search(/[\[{]/);
  if (start === -1) return null;
  const openChar = text[start];
  const closeChar = openChar === "{" ? "}" : "]";
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === openChar) depth++;
    else if (c === closeChar) {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(text.slice(start, i + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

async function buildClayQuery(segment: string, persona: string, clayKey: string): Promise<{ query: string } | { error: string }> {
  let referenceText = "";
  try {
    const refRes = await fetch("https://api.clay.com/public/v0/search/query-mode/reference", {
      headers: { "clay-api-key": clayKey },
      signal: AbortSignal.timeout(15000),
    });
    if (!refRes.ok) {
      const errBody = await refRes.json().catch(() => null);
      return { error: `Clay reference fetch failed: ${refRes.status} ${errBody?.message ?? ""}`.trim() };
    }
    const refJson = await refRes.json();
    referenceText = typeof refJson?.reference === "string" ? refJson.reference : "";
  } catch (e) {
    return { error: "Clay reference fetch failed: " + (e instanceof Error ? e.message : String(e)) };
  }
  if (!referenceText.trim()) return { error: "Clay reference response was empty" };

  const prompt = `You write queries in Clay's "query-mode" search DSL (a SQL-like language for finding people/companies). Below is Clay's OWN live reference documentation for this DSL — use ONLY fields and operators that appear in it, never invent one.

=== CLAY QUERY-MODE REFERENCE (live, authoritative) ===
${referenceText.slice(0, 12000)}

=== TASK ===
Build ONE query that searches for real PEOPLE matching this Ideal Customer Profile. These are the BUYERS/decision-makers to find and contact — not the vendor's own team.

SEGMENT (who the target companies/buyers are):
${segment}

PERSONA (psychographics / buying behavior of the target buyer):
${persona}

Infer reasonable filters (job titles, geography) from the SEGMENT and PERSONA text above, strictly using fields documented in the reference above. Job titles are NOT top-level people fields: they must sit inside an experiences block, exactly like this:
select from people where experiences.any(is_current = true and job_title is_similar_to ("VP Sales"))

CRITICAL RULES:
- Copy enum values EXACTLY as they appear in the reference, including capitalization and hyphenation. For example, if the reference says "C-suite", write "C-suite" — NOT "C-Suite", "C suite", or "CSuite".
- Do not paraphrase, reformat, or "fix" any field name or enum value from the reference.
- If you are unsure whether a value is valid, omit the filter rather than guessing.
- Use ONLY the experiences.any(...) block for job titles, and never invent top-level fields such as job_title. Do NOT use company.* attributes (industry, size, technographics, name) or any cross-entity filter: they require a paid Clay plan and the search is rejected with 403.

Return ONLY this JSON, no markdown: {"query": "the complete query string"}`;

  try {
    const raw = await callDeepSeek([{ role: "user", content: prompt }], 0.2, 600);
    const parsed = extractJsonValue(raw) as any;
    if (typeof parsed?.query === "string" && parsed.query.trim()) return { query: parsed.query.trim() };
    return { error: "Could not derive a valid query from the ICP text" };
  } catch (e) {
    return { error: "Query generation failed: " + (e instanceof Error ? e.message : String(e)) };
  }
}

// Retry with the Clay API error message so DeepSeek can fix the exact issue.
async function fixClayQuery(segment: string, persona: string, clayKey: string, previousQuery: string, clayError: string): Promise<{ query: string } | { error: string }> {
  let referenceText = "";
  try {
    const refRes = await fetch("https://api.clay.com/public/v0/search/query-mode/reference", {
      headers: { "clay-api-key": clayKey },
      signal: AbortSignal.timeout(15000),
    });
    if (refRes.ok) {
      const refJson = await refRes.json();
      referenceText = typeof refJson?.reference === "string" ? refJson.reference : "";
    }
  } catch { /* ignore — we still have the error message to work with */ }

  const prompt = `You write queries in Clay's "query-mode" search DSL. Your previous query was REJECTED by Clay with this error:

ERROR: ${clayError}

REJECTED QUERY:
${previousQuery}

=== CLAY QUERY-MODE REFERENCE (live, authoritative) ===
${referenceText.slice(0, 12000)}

Fix the query so it passes Clay's validation. The error tells you exactly what is wrong — typically a wrong enum value or an invalid field name. Copy the correct value EXACTLY from the reference above, preserving capitalization and hyphenation. Job titles must sit inside experiences.any(...) (e.g. select from people where experiences.any(is_current = true and job_title is_similar_to ("VP Sales"))). Never use a top-level job_title field, and no company.* or cross-entity filters, which require a paid Clay plan.

SEGMENT:
${segment}

PERSONA:
${persona}

Return ONLY this JSON, no markdown: {"query": "the corrected query string"}`;

  try {
    const raw = await callDeepSeek([{ role: "user", content: prompt }], 0.2, 600);
    const parsed = extractJsonValue(raw) as any;
    if (typeof parsed?.query === "string" && parsed.query.trim()) return { query: parsed.query.trim() };
    return { error: `Clay rejected the query and the correction failed: ${clayError}` };
  } catch (e) {
    return { error: `Clay rejected the query (${clayError}) and correction failed: ` + (e instanceof Error ? e.message : String(e)) };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const authHeader = req.headers.get("Authorization") || "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const supabaseAdmin = supabaseUrl && serviceRoleKey ? createClient(supabaseUrl, serviceRoleKey) : null;

  if (supabaseAdmin) {
    if (!jwt) {
      return new Response(JSON.stringify({ error: "Missing Authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(jwt);
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Invalid or expired session" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const userId = userData.user.id;
    try {
      const today = new Date().toISOString().slice(0, 10);
      const { data: quotaRow, error: quotaErr } = await supabaseAdmin
        .from("icp_lead_search_quota")
        .select("count")
        .eq("user_id", userId)
        .eq("day", today)
        .maybeSingle();
      if (!quotaErr) {
        const current = quotaRow?.count ?? 0;
        if (current >= DAILY_QUOTA) {
          return new Response(JSON.stringify({ error: "Daily search quota exceeded" }),
            { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        await supabaseAdmin
          .from("icp_lead_search_quota")
          .upsert({ user_id: userId, day: today, count: current + 1 }, { onConflict: "user_id,day" });
      }
    } catch (quotaEx) {
      console.warn("icp_lead_search_quota check skipped:", quotaEx);
    }
  } else {
    console.warn("SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not set — auth/quota guard disabled.");
  }

  try {
    const body = await req.json() as FindLeadsRequest;
    if (!body.segment || !body.persona) {
      return new Response(JSON.stringify({ error: "segment and persona are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const clayKey = envFirst(["CLAY_API_Key", "CLAY_API_KEY", "CLAY_PUBLIC_API_KEY", "CLAY-API-KEY"]);
    if (!clayKey) {
      return new Response(JSON.stringify({ error: "CLAY_API_KEY is not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const requestedLimit = Number(body.limit) || DEFAULT_RESULT_LIMIT;
    const limit = Math.max(1, Math.min(requestedLimit, MAX_SAFE_LIMIT));

    const queryResult = await buildClayQuery(body.segment, body.persona, clayKey);
    if ("error" in queryResult) {
      return new Response(JSON.stringify({ error: queryResult.error }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    let query = queryResult.query;

    let createRes = await fetch("https://api.clay.com/public/v0/search/query-mode", {
      method: "POST",
      headers: { "Content-Type": "application/json", "clay-api-key": clayKey },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(20000),
    });

    // If Clay rejects the query with a 400, send the error back to DeepSeek for a one-shot fix.
    if (!createRes.ok && createRes.status === 400) {
      const errBody = await createRes.json().catch(() => null);
      const clayError = errBody?.message ?? `400 Bad Request`;
      const fixResult = await fixClayQuery(body.segment, body.persona, clayKey, query, clayError);
      if ("query" in fixResult) {
        query = fixResult.query;
        createRes = await fetch("https://api.clay.com/public/v0/search/query-mode", {
          method: "POST",
          headers: { "Content-Type": "application/json", "clay-api-key": clayKey },
          body: JSON.stringify({ query }),
          signal: AbortSignal.timeout(20000),
        });
      } else {
        return new Response(JSON.stringify({ error: fixResult.error, query }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    if (!createRes.ok) {
      const errBody = await createRes.json().catch(() => null);
      return new Response(JSON.stringify({ error: `Clay search creation failed: ${createRes.status} ${errBody?.message ?? ""}`.trim(), query }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const created = await createRes.json();
    const searchId = created?.search_id;
    if (!searchId) {
      return new Response(JSON.stringify({ error: "Clay did not return a search_id", query, response: created }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const runRes = await fetch(`https://api.clay.com/public/v0/search/query-mode/${searchId}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "clay-api-key": clayKey },
      body: JSON.stringify({ limit }),
      signal: AbortSignal.timeout(30000),
    });
    if (!runRes.ok) {
      const errBody = await runRes.json().catch(() => null);
      return new Response(JSON.stringify({ error: `Clay search run failed: ${runRes.status} ${errBody?.message ?? ""}`.trim(), query, searchId }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const runResult = await runRes.json() as { data?: ClayPersonResult[]; has_more?: boolean; source_type?: string; period_quota?: { limit: number; used: number; remaining: number; resets_at: string } };
    const results = Array.isArray(runResult?.data) ? runResult.data : [];

    return new Response(
      JSON.stringify({
        query,
        searchId,
        limitUsed: limit,
        count: results.length,
        results,
        hasMore: runResult.has_more ?? false,
        periodQuota: runResult.period_quota ?? null,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Lead search failed" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
