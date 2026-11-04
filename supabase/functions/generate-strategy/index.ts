import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * generate-strategy — v2.5 (+ businessContext passthrough for SOM capacity cross-check)
 * ---------------------------------------------------------------------------------------
 * v2.5 change: the response now includes "businessContext": { teamSize, monthlyBudget,
 * companyAge } — a deterministic passthrough of the form's own fields, not LLM-generated.
 * generate-content.ts v1.3's smm_strategy mode reads this to cap the SOM by the team's
 * actual capacity instead of only summing a lead funnel. No prompt change needed for this.
 *
 * v2.4 change: the "kpis" field is REMOVED and replaced by "prospectingKit" — a
 * ready-to-use prospecting kit instead of abstract targets:
 *   - prospectJobTitle / prospectJobTitleRationale: ONE precise job title to call first
 *     (e.g. "DAF", "COO"), grounded in the ICP, not a generic list of titles.
 *   - callValueProposition: a SINGLE fluid spoken paragraph (no bullets) sayable out loud
 *     in ~20-30s — the value proposition for a cold call.
 *   - emailIcebreakerSubject / emailIcebreakerOpening: a cold-email subject and opening
 *     line referencing something concrete about the target company, not a generic line.
 *   - callValuePropositionAnchor / emailIcebreakerAnchor: same anchor convention as
 *     tactics — a source-tagged quote, or the literal string "estimate".
 *
 * Cross-file consequence (handled): generate-content.ts's smm_strategy mode used to read
 * BOTH kpis[] and tactics[] to build its "sourced facts vs estimates" grounding block for
 * market sizing. Since kpis[] no longer exists, generate-content.ts v1.2 now reads only
 * tactics[] for that purpose — see its own header for the matching change. Market-sizing
 * grounding is slightly thinner as a result (one fewer source of anchored figures); tactics
 * alone still carries real signal since each one is anchored the same way KPIs were.
 *
 * v2.3 revised v2.2 after checking the actual app: /strategy (StrategyPage.tsx →
 * StrategyResultPage.tsx) is an intentionally public, no-login entry point (the free-trial
 * hook), and generate-strategy is only ever called once per business — there is no
 * "regenerate" UI for it anywhere in the app. Two v2.2 items were changed accordingly:
 *
 *  3'. SECURITY (revised): the endpoint stays PUBLIC — it no longer hard-rejects requests
 *     without a session. If a valid user JWT is present (Authorization: Bearer <token>), the
 *     caller is identified as "user:<uuid>" and gets DAILY_GENERATION_QUOTA/day. Otherwise
 *     it's identified by IP as "ip:<address>" and gets the much lower ANONYMOUS_DAILY_QUOTA/
 *     day. Either way, a quota is enforced BEFORE any paid crawl/SerpApi/Apify/DeepSeek call.
 *
 *  5'. CACHING REMOVED: v2.2's strategy_cache table was dead code for this app — nothing
 *     calls generate-strategy more than once per business today. Removed to cut surface
 *     area; reintroduce it if a "regenerate" flow is built later.
 *
 * Unchanged from v2.2:
 *  1. GROUNDING (root-cause fix): tactics[] are objects { tactic, anchor }. "anchor" is a
 *     source-tagged verbatim quote or the literal string "estimate". Stops fabricated
 *     numbers (e.g. "120 leads/quarter") from silently feeding downstream market-sizing
 *     (TAM/SAM/SOM) as if they were facts.
 *  2. VALIDATION: validateStrategy() enforces the anchor field structurally; scanEstimatedClaims()
 *     lists every "estimate"-tagged tactic/prospectingKit figure in _meta.estimatedClaims.
 *  4. RELIABILITY: LinkedIn/Apify enrichment has a hard budget (LINKEDIN_TIMEOUT_MS) on the
 *     request's critical path, so a slow Apify run can never cause a timeout during a live demo.
 *  6. TUNING: strategy-generation temperature lowered from 0.6 to 0.3.
 *
 * New table required (run once, e.g. via the Supabase SQL editor or a migration):
 *
 *   CREATE TABLE IF NOT EXISTS generation_quota (
 *     subject text NOT NULL,   -- 'user:<uuid>' for logged-in calls, 'ip:<address>' otherwise
 *     day date NOT NULL,
 *     count integer NOT NULL DEFAULT 0,
 *     PRIMARY KEY (subject, day)
 *   );
 *
 * New env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (both auto-injected in Supabase Edge
 * Functions).
 *
 * Front-end change needed (optional but recommended): in StrategyResultPage.tsx, send the
 * real session token when one exists (`session?.access_token`) instead of always sending the
 * anon key, so logged-in callers get DAILY_GENERATION_QUOTA instead of the anonymous IP quota.
 * Anonymous visitors keep working exactly as today — no change required for them.
 *
 * supabase/config.toml stays as-is: `verify_jwt = false` on this function is CORRECT (it must
 * stay callable without a Supabase-signed session at the platform gate) — the quota above is
 * the actual protection now.
 *
 * Requires: supabase config.toml -> [functions.generate-strategy] timeout = "300s"
 *           (Apify run can take up to ~100 s server-side; the request itself now never waits
 *           more than LINKEDIN_TIMEOUT_MS for it).
 *
 * Output JSON schema = v2.1 schema, with tactics as anchored object arrays, kpis replaced by
 * prospectingKit (see above), and an extended _meta (estimatedClaims).
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface StrategyRequest {
  website: string;
  businessName: string;
  businessModel: string;
  companyAge: string;
  teamSize: string;
  geographicMarket: string;
  language?: string;
  // optional enrichment fields (form v2)
  description?: string;
  mainOffers?: string;
  targetAudience?: string;
  competitors?: string;
  objectives?: string;
  currentChannels?: string;
  monthlyBudget?: string;
  manualSiteContent?: string;
  linkedinUrl?: string;
  scanConsent?: boolean;
  enableSerp?: boolean;
  enableLinkedIn?: boolean;
  // pipeline control
  siteAnalysisOverride?: unknown;
  onlyAnalysis?: boolean;
}

interface PageExtract {
  url: string;
  title: string;
  metaDescription: string;
  headings: string[];
  text: string;
}

interface SerpResult {
  query: string;
  results: { title: string; link: string; snippet: string }[];
}

const MONTHS_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 (compatible; StrategyBot/2.1)";
const MAX_EXTRA_PAGES = 4;
const HOME_BUDGET = 4500;
const PAGE_BUDGET = 2500;
const TOTAL_BUDGET = 14000;
const APIFY_ACTOR_DEFAULT = "vobocye84LF1wBJBI";
const APIFY_WAIT_SECONDS = 90;
const LINKEDIN_TIMEOUT_MS = 20000; // hard budget on the critical path, never blocks a demo
const DAILY_GENERATION_QUOTA = 20; // v2.3: per logged-in user
const ANONYMOUS_DAILY_QUOTA = 5; // v2.3: per IP, for the public /strategy trial flow — tighter since this path pays for crawl+SERP+Apify+2 LLM calls

function envFirst(names: string[]): string | undefined {
  for (const n of names) {
    const v = Deno.env.get(n);
    if (v && v.trim()) return v.trim();
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// CRAWL (direct website scan) — unchanged from v2.1
// ---------------------------------------------------------------------------

function normalizeUrl(u: string): string {
  try {
    const x = new URL(u);
    x.hash = "";
    return x.href.replace(/\/+$/, "");
  } catch {
    return u;
  }
}

function toggleWww(u: string): string {
  try {
    const x = new URL(u);
    x.hostname = x.hostname.startsWith("www.") ? x.hostname.slice(4) : "www." + x.hostname;
    return x.href;
  } catch {
    return u;
  }
}

async function fetchPage(url: string, timeoutMs = 8000): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": BROWSER_UA, Accept: "text/html,application/xhtml+xml,text/plain;q=0.8" },
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const ct = (res.headers.get("content-type") || "").toLowerCase();
    if (ct && !ct.includes("html") && !ct.includes("text/plain") && !ct.includes("xml")) return null;
    return await res.text();
  } catch {
    return null;
  }
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&eacute;/g, "é").replace(/&egrave;/g, "è").replace(/&ecirc;/g, "ê").replace(/&agrave;/g, "à")
    .replace(/&acirc;/g, "â").replace(/&ccedil;/g, "ç").replace(/&ocirc;/g, "ô").replace(/&ugrave;/g, "ù")
    .replace(/&uuml;/g, "ü").replace(/&iuml;/g, "ï").replace(/&Eacute;/g, "É").replace(/&Agrave;/g, "À")
    .replace(/&#8217;|&#39;|&rsquo;/g, "'").replace(/&#8220;|&#8221;|&ldquo;|&rdquo;/g, '"')
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"');
}

function extractPage(html: string, url: string): PageExtract {
  const titleM = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const metaM =
    html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([\s\S]*?)["']/i) ||
    html.match(/<meta[^>]+content=["']([\s\S]*?)["'][^>]+name=["']description["']/i) ||
    html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([\s\S]*?)["']/i);

  let body = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<form[\s\S]*?<\/form>/gi, " ");

  const headings: string[] = [];
  body = body.replace(/<h([1-3])[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, lvl, inner) => {
    const t = decodeEntities(inner.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
    if (t) headings.push("#".repeat(Number(lvl)) + " " + t);
    return "\n[H" + lvl + "] " + t + "\n";
  });
  body = body.replace(/<li[^>]*>/gi, "\n- ");
  body = body.replace(/<(p|div|br|tr|section|article)[^>]*>/gi, "\n");

  const text = decodeEntities(body.replace(/<[^>]+>/g, " "))
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();

  return {
    url,
    title: titleM ? decodeEntities(titleM[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim()) : "",
    metaDescription: metaM ? decodeEntities(metaM[1].replace(/\s+/g, " ").trim()) : "",
    headings,
    text,
  };
}

function extractInternalLinks(html: string, base: URL, limit = 60): string[] {
  const out = new Set<string>();
  const re = /<a[^>]+href=["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && out.size < limit) {
    const href = m[1].trim();
    if (!href || href.startsWith("#") || /^(mailto:|tel:|javascript:|data:)/i.test(href)) continue;
    let abs: URL;
    try {
      abs = new URL(href, base);
    } catch {
      continue;
    }
    if (abs.hostname.replace(/^www\./, "") !== base.hostname.replace(/^www\./, "")) continue;
    if (/\.(pdf|png|jpe?g|gif|svg|zip|docx?|xlsx?|pptx?|mp4|webp|ico|css|js)(\?|$)/i.test(abs.pathname)) continue;
    out.add(normalizeUrl(abs.href));
  }
  return [...out];
}

function extractSitemapUrls(xml: string, limit = 200): string[] {
  const out: string[] = [];
  const re = /<loc>\s*([^<\s]+)\s*<\/loc>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) && out.length < limit) out.push(m[1]);
  return out;
}

function linkScore(url: string): number {
  let s = 0;
  if (/\/(services?|offres?|solutions?|produits?|formations?|catalogue|prestations|expertises?|metiers)(\/|$|\?)/i.test(url)) s += 5;
  if (/\/(a-propos|about|qui-sommes|entreprise|societe|nous|equipe)(\/|$|\?)/i.test(url)) s += 4;
  if (/\/(clients|references|cas-clients|etudes-de-cas|temoignages|realisations)(\/|$|\?)/i.test(url)) s += 3;
  if (/\/(tarifs|pricing|prix)(\/|$|\?)/i.test(url)) s += 3;
  if (/\/(blog|actualites|news|articles|ressources)(\/|$|\?)/i.test(url)) s += 1;
  if (/\/(contact|mentions-legales|cgv|confidentialite|cookies|faq|recrutement|jobs|career)(\/|$|\?)/i.test(url)) s -= 5;
  try {
    s -= new URL(url).pathname.split("/").filter(Boolean).length * 0.5;
  } catch { /* ignore */ }
  return s;
}

async function crawlSite(website: string): Promise<{ pages: PageExtract[]; homeUrl: string | null }> {
  let homeUrl = website.trim();
  if (!/^https?:\/\//i.test(homeUrl)) homeUrl = "https://" + homeUrl;
  let base: URL;
  try {
    base = new URL(homeUrl);
  } catch {
    return { pages: [], homeUrl: null };
  }

  const homeHtml = (await fetchPage(base.href)) ?? (await fetchPage(toggleWww(base.href)));
  if (!homeHtml) return { pages: [], homeUrl: null };

  const home = extractPage(homeHtml, normalizeUrl(base.href));
  const linkCandidates = extractInternalLinks(homeHtml, base);

  const sitemapXml = await fetchPage(base.origin + "/sitemap.xml", 5000);
  if (sitemapXml) {
    for (const loc of extractSitemapUrls(sitemapXml)) {
      try {
        const u = new URL(loc);
        if (u.hostname.replace(/^www\./, "") === base.hostname.replace(/^www\./, "")) {
          linkCandidates.push(normalizeUrl(u.href));
        }
      } catch { /* ignore */ }
    }
  }

  const homeNorm = normalizeUrl(base.href);
  const candidates = [...new Set(linkCandidates)]
    .filter((c) => c !== homeNorm && c !== normalizeUrl(toggleWww(base.href)))
    .sort((a, b) => linkScore(b) - linkScore(a))
    .slice(0, MAX_EXTRA_PAGES);

  const results = await Promise.allSettled(
    candidates.map(async (url) => {
      const html = await fetchPage(url);
      return html ? extractPage(html, url) : null;
    }),
  );

  const pages: PageExtract[] = [home];
  let budget = TOTAL_BUDGET - Math.min(home.text.length, HOME_BUDGET);
  for (const r of results) {
    if (r.status !== "fulfilled" || !r.value) continue;
    const p = r.value;
    if (!p.text || p.text.length < 120) continue;
    let slice = p.text.slice(0, PAGE_BUDGET);
    if (slice.length > budget) slice = slice.slice(0, Math.max(budget, 0));
    if (!slice) break;
    budget -= slice.length;
    pages.push({ ...p, text: slice });
    if (budget <= 0) break;
  }
  pages[0] = { ...pages[0], text: pages[0].text.slice(0, HOME_BUDGET) };

  return { pages, homeUrl: homeNorm };
}

function buildSiteDossier(pages: PageExtract[], manualSiteContent?: string): string {
  const blocks = pages.map((p, i) =>
    [
      "--- PAGE " + (i + 1) + ": " + p.url,
      "TITLE: " + (p.title || "(none)"),
      "META DESCRIPTION: " + (p.metaDescription || "(none)"),
      "HEADINGS:",
      p.headings.length ? p.headings.join("\n") : "(none)",
      "BODY EXCERPT:",
      p.text,
    ].join("\n"),
  );
  if (manualSiteContent && manualSiteContent.trim()) {
    blocks.push("--- MANUAL PASTE PROVIDED BY THE COMPANY (treat as website content):\n" + manualSiteContent.trim().slice(0, 6000));
  }
  return blocks.join("\n\n");
}

// ---------------------------------------------------------------------------
// SERP research (SerpApi / Google) — unchanged from v2.1
// ---------------------------------------------------------------------------

async function serpSearch(query: string, apiKey: string, hl: string): Promise<SerpResult | null> {
  const url = new URL("https://serpapi.com/search.json");
  url.searchParams.set("engine", "google");
  url.searchParams.set("q", query);
  url.searchParams.set("hl", hl);
  url.searchParams.set("num", "10");
  url.searchParams.set("api_key", apiKey);
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return null;
    const data: any = await res.json();
    const organic: any[] = Array.isArray(data.organic_results) ? data.organic_results : [];
    const results = organic.slice(0, 8).map((r) => ({
      title: String(r.title || "").replace(/\s+/g, " ").trim(),
      link: String(r.link || ""),
      snippet: String(r.snippet || "").replace(/\s+/g, " ").trim(),
    })).filter((r) => r.title || r.snippet);
    return results.length ? { query, results } : null;
  } catch {
    return null;
  }
}

function buildSerpQueries(businessName: string, domain: string, fr: boolean): string[] {
  const svc = fr
    ? "services OR offres OR solutions OR produits OR formations OR prestations"
    : "services OR offerings OR solutions OR products OR programs";
  return [
    '"' + businessName + '"',
    '"' + businessName + '" ' + svc,
    "site:" + domain,
    '"' + businessName + '" linkedin company',
  ];
}

function buildSerpDossier(serp: SerpResult[]): string {
  if (!serp.length) return "(no SERP data available)";
  return serp
    .map(
      (s) =>
        "QUERY: " + s.query + "\n" +
        s.results.map((r) => "- " + r.title + (r.link ? " | " + r.link : "") + (r.snippet ? "\n  " + r.snippet : "")).join("\n"),
    )
    .join("\n\n");
}

function discoverLinkedInUrl(sources: string[], formUrl?: string): string | null {
  if (formUrl && formUrl.trim()) {
    const m = formUrl.match(/linkedin\.com\/(?:company|showcase)\/[A-Za-z0-9._-]+/i);
    if (m) return "https://www." + m[0];
  }
  for (const src of sources) {
    const m = src.match(/linkedin\.com\/(?:company|showcase)\/([A-Za-z0-9._-]+)/i);
    if (m) return "https://www.linkedin.com/company/" + m[1];
  }
  return null;
}

// ---------------------------------------------------------------------------
// LinkedIn company page via Apify — unchanged from v2.1 (call site now races
// against LINKEDIN_TIMEOUT_MS, see handler below)
// ---------------------------------------------------------------------------

function flattenLinkedInItem(item: any): string {
  const lines: string[] = [];
  const walk = (obj: any, prefix: string, depth: number) => {
    if (!obj || typeof obj !== "object" || depth > 4) return;
    for (const [k, v] of Object.entries(obj)) {
      if (v == null) continue;
      if (typeof v === "string" && v.trim()) lines.push(prefix + k + ": " + v.trim().replace(/\s+/g, " "));
      else if (typeof v === "number" || typeof v === "boolean") lines.push(prefix + k + ": " + v);
      else if (Array.isArray(v)) {
        const strs = v.filter((x) => typeof x === "string" && x.trim());
        if (strs.length) lines.push(prefix + k + ": " + strs.join(" | "));
        else v.slice(0, 6).forEach((x, i) => walk(x, prefix + k + "[" + i + "].", depth + 1));
      } else if (typeof v === "object") walk(v, prefix + k + ".", depth + 1);
    }
  };
  walk(item, "", 0);
  return lines.join("\n").slice(0, 8000);
}

async function apifyLinkedInCompany(companyUrl: string, token: string): Promise<{ text: string; runId: string } | null> {
  const actorId = envFirst(["APIFY_ACTOR_ID"]) || APIFY_ACTOR_DEFAULT;
  const input = {
    startUrls: [{ url: companyUrl }],
    urls: [companyUrl],
    url: companyUrl,
    linkedinUrl: companyUrl,
    profileUrl: companyUrl,
    proxy: { useApifyProxy: true },
  };
  const startRun = async (kind: "acts" | "actor-tasks") => {
    try {
      return await fetch("https://api.apify.com/v2/" + kind + "/" + actorId + "/runs?token=" + encodeURIComponent(token) + "&waitForFinish=" + APIFY_WAIT_SECONDS, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout((APIFY_WAIT_SECONDS + 15) * 1000),
      });
    } catch {
      return null;
    }
  };

  let res = await startRun("acts");
  if (!res || !res.ok) res = await startRun("actor-tasks");
  if (!res || !res.ok) return null;

  let run: any = await res.json();
  let runId: string | undefined = run?.data?.id;
  let status: string | undefined = run?.data?.status;
  if (!runId) return null;

  // If still running after waitForFinish, give it one more window.
  if (status && !["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"].includes(status)) {
    try {
      const poll = await fetch("https://api.apify.com/v2/actor-runs/" + runId + "?token=" + encodeURIComponent(token) + "&waitForFinish=60", {
        signal: AbortSignal.timeout(75000),
      });
      if (poll.ok) {
        run = await poll.json();
        status = run?.data?.status;
      }
    } catch { /* ignore */ }
  }
  if (status !== "SUCCEEDED") return null;

  try {
    const itemsRes = await fetch("https://api.apify.com/v2/actor-runs/" + runId + "/dataset/items?token=" + encodeURIComponent(token), {
      signal: AbortSignal.timeout(20000),
    });
    if (!itemsRes.ok) return null;
    const items: any[] = await itemsRes.json();
    if (!Array.isArray(items) || !items.length) return null;
    const text = items.map(flattenLinkedInItem).filter(Boolean).join("\n---\n");
    return text ? { text, runId } : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// DeepSeek helper + JSON robustness — unchanged from v2.1
// ---------------------------------------------------------------------------

async function callDeepSeek(messages: { role: string; content: string }[], opts: { temperature: number; maxTokens: number }): Promise<string> {
  const res = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + Deno.env.get("DEEPSEEK_API_KEY"),
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages,
      max_tokens: opts.maxTokens,
      temperature: opts.temperature,
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error("Deepseek API error: " + res.status + " - " + errText);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
}

function extractJsonObject(content: string): unknown | null {
  const text = content.replace(/```(?:json)?/gi, "").trim();
  const start = text.indexOf("{");
  if (start === -1) return null;
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
    else if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

// enforces { textField, anchor } shape on tactics instead of plain strings
function reqAnchoredArray(path: string, arr: any, min: number, textField: string, problems: string[]) {
  if (!Array.isArray(arr) || arr.length < min) {
    problems.push(path + " (array >= " + min + ")");
    return;
  }
  arr.forEach((item: any, i: number) => {
    if (!item || typeof item !== "object") {
      problems.push(path + "[" + i + "] is not an object (expected { " + textField + ", anchor })");
      return;
    }
    if (typeof item[textField] !== "string" || item[textField].trim().length < 3) {
      problems.push(path + "[" + i + "]." + textField);
    }
    if (typeof item.anchor !== "string" || !item.anchor.trim()) {
      problems.push(path + "[" + i + "].anchor");
    }
  });
}

function validateStrategy(s: any): string[] {
  const problems: string[] = [];
  const reqStr = (path: string, v: any) => { if (typeof v !== "string" || v.trim().length < 3) problems.push(path); };
  const reqArr = (path: string, v: any, min: number) => { if (!Array.isArray(v) || v.length < min) problems.push(path + " (array >= " + min + ")"); };
  if (!s || typeof s !== "object") return ["root is not an object"];
  reqStr("siteAnalysis.positioning", s.siteAnalysis?.positioning);
  reqArr("siteAnalysis.usps", s.siteAnalysis?.usps, 3);
  reqArr("siteAnalysis.offers", s.siteAnalysis?.offers, 1);
  reqStr("icp.description.overview", s.icp?.description?.overview);
  reqStr("icp.description.offer", s.icp?.description?.offer);
  reqStr("icp.description.howItWorks", s.icp?.description?.howItWorks);
  reqArr("icp.description.capabilities", s.icp?.description?.capabilities, 4);
  reqArr("icp.description.benefits", s.icp?.description?.benefits, 4);
  reqArr("icp.description.differentiation", s.icp?.description?.differentiation, 4);
  reqArr("icp.needs", s.icp?.needs, 5);
  reqArr("icp.problems", s.icp?.problems, 5);
  reqStr("icp.demographics", s.icp?.demographics);
  reqStr("icp.psychographics", s.icp?.psychographics);
  reqArr("icp.painPoints", s.icp?.painPoints, 4);
  reqArr("icp.goals", s.icp?.goals, 4);
  reqArr("channels.primary", s.channels?.primary, 4);
  reqArr("channels.secondary", s.channels?.secondary, 4);
  reqAnchoredArray("tactics", s.tactics, 6, "tactic", problems); // was reqArr("tactics", s.tactics, 6)
  // v2.4: kpis[] removed, replaced by prospectingKit (see header).
  reqStr("prospectingKit.prospectJobTitle", s.prospectingKit?.prospectJobTitle);
  reqStr("prospectingKit.prospectJobTitleRationale", s.prospectingKit?.prospectJobTitleRationale);
  if (typeof s.prospectingKit?.callValueProposition !== "string" || s.prospectingKit.callValueProposition.trim().length < 40) {
    problems.push("prospectingKit.callValueProposition");
  }
  if (/[\n•\-]\s/.test(s.prospectingKit?.callValueProposition ?? "")) {
    problems.push("prospectingKit.callValueProposition (must be one fluid paragraph, no bullets/line breaks)");
  }
  reqStr("prospectingKit.emailIcebreakerSubject", s.prospectingKit?.emailIcebreakerSubject);
  reqStr("prospectingKit.emailIcebreakerOpening", s.prospectingKit?.emailIcebreakerOpening);
  reqStr("timeline", s.timeline);
  return problems;
}

// v2.4: surfaces every tactic/prospectingKit figure explicitly tagged "estimate" so the UI
// can flag it as unverified instead of presenting it as a fact (tactics feed downstream
// TAM/SAM/SOM in generate-content.ts; the prospecting kit is shown directly to the user).
function scanEstimatedClaims(s: any): string[] {
  const flags: string[] = [];
  (s?.tactics ?? []).forEach((item: any, i: number) => {
    const anchor = typeof item === "object" ? item.anchor : undefined;
    if (typeof anchor === "string" && anchor.trim().toLowerCase() === "estimate") {
      flags.push("tactics[" + i + "]: " + (typeof item === "object" ? item.tactic : String(item)));
    }
  });
  const pk = s?.prospectingKit;
  if (pk) {
    if (typeof pk.callValuePropositionAnchor === "string" && pk.callValuePropositionAnchor.trim().toLowerCase() === "estimate") {
      flags.push("prospectingKit.callValueProposition: " + pk.callValueProposition);
    }
    if (typeof pk.emailIcebreakerAnchor === "string" && pk.emailIcebreakerAnchor.trim().toLowerCase() === "estimate") {
      flags.push("prospectingKit.emailIcebreakerOpening: " + pk.emailIcebreakerOpening);
    }
  }
  return flags;
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

function buildAnalysisPrompt(opts: { formBlock: string; crawlDossier: string; serpDossier: string; linkedinDossier: string; linkedinUrl: string; langInstruction: string }): string {
  return `You are a market-research analyst. You receive (A) declarations made by a company in a contact form and (B) THREE independent research sources about that company: (B1) a text extraction of pages crawled from its public website, (B2) Google search results (SERP) about the company and its offerings, (B3) its LinkedIn company page.

Produce a factual "site intelligence dossier" as a single JSON object. This dossier will be the ONLY source of company-specific facts for a downstream marketing strategy whose goal is to generate qualified leads and sales for this company. Precision and honesty matter more than completeness.

=== (A) FORM DECLARATIONS ===
${opts.formBlock}

=== (B1) CRAWLED WEBSITE EXTRACTION ===
${opts.crawlDossier}

=== (B2) GOOGLE SERP RESULTS ===
${opts.serpDossier}

=== (B3) LINKEDIN COMPANY PAGE (${opts.linkedinUrl || "url unknown"}) ===
${opts.linkedinDossier}

=== RULES ===
1. Use ONLY information present in (A), (B1), (B2) or (B3). Never infer from industry stereotypes.
2. Every "evidence" value must be a SHORT VERBATIM quote prefixed by its source tag: "crawl: ...", "serp: ...", "linkedin: ...", or the exact string "form" when the fact comes from (A).
3. If a field has no support in the inputs, return an empty array/string. NEVER invent company names, client names, numbers, percentages, certifications, labels, cities, prices, partnerships or dates.
4. Keep commercial names of offers/services EXACTLY as written in the sources (do not translate or normalize them).
5. When the website could not be crawled (B1 empty), you MUST mine (B2) snippets and (B3) about/specialties sections to reconstruct what the company sells: each reconstructed offer keeps its source-tagged evidence and goes into "offers" with "audience"/"deliverable" inferred ONLY from the same quote.
6. SOURCE PRECEDENCE when sources conflict: crawl > linkedin > serp > form. Record conflicts in "contradictionsWithForm" or "missingInformation" as appropriate.
7. "usps" = claims that distinguish the company from a generic competitor (3 to 5). A claim like "we care about quality" is NOT a USP.
8. "offers" = the distinct products/services/programs the sources actually name (3 to 8). One entry per named offer, with its commercial name.
9. "proofPoints" = tangible credibility signals present in the inputs: certifications, labels, named clients, years of existence, team size, follower counts, numbers, awards.
10. "brandVocabulary" = 6-12 exact recurring words/expressions from the sources that downstream copy must reuse.
11. "confidence" = "high" if (B1) usable; "medium" if (B1) empty but (B2)/(B3) describe the offers; "low" only if none of the sources describes what the company sells.
12. ${opts.langInstruction} (Verbatim quotes and commercial names stay in the source language.)

=== OUTPUT (JSON only, no markdown, no code fences) ===
{
  "confidence": "high | medium | low",
  "dataSourcesUsed": ["crawl", "serp", "linkedin", "form" - only the ones actually used],
  "companyIdentity": "1-2 sentences: who they are, sector, business model as observed",
  "businessModelObserved": "B2B | B2C | B2B2C | marketplace | SaaS | service provider | other: specify",
  "usps": [{ "claim": "...", "evidence": "source-tagged verbatim quote or 'form'" }],
  "offers": [{ "name": "exact commercial name", "audience": "who it serves", "deliverable": "what the client gets", "evidence": "source-tagged verbatim quote or 'form'" }],
  "proofPoints": ["..."],
  "audienceSignals": ["who the sources show the company actually speaks to"],
  "brandVocabulary": ["exact terms to reuse"],
  "contradictionsWithForm": ["anything in B1/B2/B3 that contradicts A"],
  "missingInformation": ["what no source says and must not be invented downstream"]
}
Return ONLY the JSON object.`;
}

function buildStrategyPrompt(opts: {
  formBlock: string;
  analysisJson: string;
  rawExcerpts: string;
  crawledUrls: string;
  langInstruction: string;
  dateLine: string;
  quarterLine: string;
  q: { q1: string; q2: string; q3: string; q4: string };
  teamSize: string;
  companyAge: string;
}): string {
  return `You are a senior marketing strategist and B2B/B2C growth advisor hired by the company described below. ULTIMATE BUSINESS GOAL of this strategy: generate qualified leads and increase sales for this company - every channel and tactic must map to lead acquisition, lead conversion or revenue expansion, and the prospecting kit must be immediately usable on a real cold call or cold email, with a clear offer-led call-to-action. The strategy will also be reused downstream, unchanged, to build the Ideal Customer Profile, the content calendar and the social-media (SMM) strategy, INCLUDING market sizing (TAM/SAM/SOM) computed from the numbers you output here. Internal coherence and company-specificity are therefore critical: a reader must be able to identify THIS company and ITS SOLUTION from the strategy alone, without seeing its name, and every number you output must be honest about whether it is proven or assumed.

=== INPUT 1 - FORM DECLARATIONS (provided by the company itself) ===
${opts.formBlock}

=== INPUT 2 - SITE INTELLIGENCE DOSSIER (evidence-based, built from CRAWL + GOOGLE SERP + LINKEDIN) ===
Crawled pages: ${opts.crawledUrls}
${opts.analysisJson}

=== INPUT 3 - RAW RESEARCH EXCERPTS (website crawl + SERP snippets + LinkedIn page; use for vocabulary, offer details and mechanisms only) ===
${opts.rawExcerpts}

=== METHOD (execute in this order, silently) ===
STEP 1 - Inventory: list the company's REAL offers, USPs and proof points from INPUT 2, and check each against INPUT 3. If the dossier confidence is "low", fall back to INPUT 1 and keep every claim at business-model level; never invent details.
STEP 2 - Solution statement: formulate in one sentence the concrete solution/mechanism the company delivers (what happens for the client, step by step, as described by the sources). This sentence drives icp.description.overview/offer/howItWorks.
STEP 3 - ICP: derive the target from the intersection of (a) who the sources show the company actually speaks to (audienceSignals), (b) the form's geographic market, business model and team size, (c) the problems the REAL offers solve.
STEP 4 - Needs & problems: each need = a job-to-be-done the buyer hires this company for, fulfilled by a NAMED offer; each problem = a cost/pain of the status quo that a NAMED offer removes. No title may appear in both lists. Every entry carries an "anchor": the exact name of the offer/USP/proof point it relies on.
STEP 5 - Channels & tactics: choose what fits the observed business model and sales cycle (long B2B cycle vs B2C impulse vs SaaS self-serve), the geographic market (local platforms, language, regulation - e.g. in France: OPCO/CPF/Qualiopi logic for vocational training, RGPD for data), and the company's real capacity. Prioritize lead-generation mechanisms: offer-led lead magnets, proof-based outreach, retargeting on high-intent pages.
STEP 6 - Feasibility check: every tactic must be executable by a team of "${opts.teamSize}" at the "${opts.companyAge}" stage within the timeline, with the declared budget if any. Delete anything a team that size cannot run.
STEP 7 - Grounding pass: for every numeric claim you are about to write into a kpi or a tactic (%, €, count, duration), check whether INPUT 2/3 actually supports that number. If yes, write the supporting quote as its anchor. If no, you may still include a realistic planning assumption, but its anchor MUST be the literal string "estimate" - never leave a number unlabelled.
STEP 8 - Write the final JSON.

=== HARD GROUNDING RULES (violations make the output useless) ===
R1. SUBSTITUTION TEST: any sentence that would remain true if the company name were replaced by a competitor's name is BANNED ("high-quality solutions", "customer-centric approach", "innovative products", "experienced team"...). Rewrite it with a specific offer name, mechanism, number or proof point from INPUT 2/3.
R2. NO INVENTED FACTS: client names, revenue, percentages, certifications, labels, cities, prices, partnerships and dates must come from INPUT 1/2/3 or not appear at all.
R3. ANCHORING: each icp.needs[].fulfillment, each icp.problems[].context and each tactic must name or cite at least one element of the dossier (offer commercial name, USP, proof point, mechanism). Fill the "anchor" fields accordingly.
R4. LISTS MUST NOT OVERLAP: capabilities = what the offer does (features/mechanisms); benefits = what the client gains (outcomes); differentiation = why not a competitor (vs-arguments). No bullet may appear in two lists, and no sentence may be repeated anywhere in the output.
R5. COMMERCIAL NAMES: offers, programs, certifications and labels keep their exact source wording (do not translate them), even when the rest of the output is in another language.
R6. CHANNEL FORMAT: each channel string = "Platform (precise use + target segment)", e.g. "LinkedIn (organic + paid, targeting HR directors of 50-500 employee industrial firms)".
R7. TACTIC FORMAT: each tactic.tactic = verb + named offer/asset + target + channel + trigger or timing, and must state the lead-capture mechanism (form, audit, demo, quote, sample, webinar registration...).
R8. PROSPECT JOB TITLE FORMAT: prospectingKit.prospectJobTitle is exactly ONE job title (e.g. "DAF", "COO", "Directeur des opérations", "CEO") — never a list, never a vague term like "decision-maker". Pick the title most likely to pick up a cold call or open a cold email FIRST at a company matching icp.demographics, not necessarily the final budget-holder.
R8b. GROUNDING OF NUMBERS: every numeric claim inside a tactic (%, €, count, duration), and every claim behind callValueProposition/emailIcebreakerOpening, MUST carry an "anchor": a source-tagged verbatim quote from INPUT 2/3 that supports it, or the exact string "estimate" when it is a reasonable planning assumption with NO supporting evidence in the inputs. Never omit this field. Downstream systems (including market sizing) will treat "estimate"-tagged figures as non-authoritative and must not chain further arithmetic on them without flagging the result as an estimate too.
R8c. CALL VALUE PROPOSITION FORMAT: callValueProposition is ONE single fluid paragraph, 45-60 words, written to be SAID OUT LOUD in 20-30 seconds on a cold call — NOT a slide, NOT a list. No bullet points, no line breaks, no marketing adjectives stacked together ("innovative", "leading", "best-in-class"). It states what the company does, for whom, and the one concrete result that changes, in plain spoken language a human would actually say.
R8d. EMAIL ICEBREAKER FORMAT: emailIcebreakerOpening (1-2 sentences) references something CONCRETE AND SPECIFIC about the target company or its situation (an offer name, a proof point, a problem named in icp.problems) — never a generic compliment ("I love what you're building") and never a generic value statement that could open an email to any company.
R9. SOURCE PRECEDENCE when inputs conflict: crawl > linkedin > serp > form.
R10. ${opts.langInstruction}

=== CURRENT DATE & TIMELINE ===
${opts.dateLine}
${opts.quarterLine}

=== OUTPUT ===
Return ONLY one valid JSON object, no markdown, no code fences, with this EXACT structure (same keys as the current production schema, plus siteAnalysis, anchors, anchored tactics, and prospectingKit):
{
  "siteAnalysis": {
    "positioning": "1-sentence positioning: For [target] who [need], unlike [alternative], [company] [unique mechanism/proof]",
    "usps": ["3-5 USPs, each traceable to the dossier"],
    "offers": ["exact commercial names of the offers found in the sources"],
    "proofPoints": ["only proof points present in the inputs"]
  },
  "icp": {
    "description": {
      "overview": "1-2 sentences: what the business is, its sector and its concrete solution (name the mechanism)",
      "offer": "1-2 sentences: what exactly it offers, naming the real offers from the sources",
      "howItWorks": "1-2 sentences: the step-by-step mechanism/process that delivers the offer, as described by the sources",
      "capabilities": ["4-6 capability bullets (what the offer does)"],
      "benefits": ["4-6 benefit bullets (what the client gains)"],
      "differentiation": ["4-6 differentiator bullets (why not a competitor)"]
    },
    "needs": [
      { "title": "short need title", "fulfillment": "2-3 sentences: how THIS company's named offer fulfills this need", "anchor": "exact offer/USP name used" },
      { "title": "", "fulfillment": "", "anchor": "" },
      { "title": "", "fulfillment": "", "anchor": "" },
      { "title": "", "fulfillment": "", "anchor": "" },
      { "title": "", "fulfillment": "", "anchor": "" }
    ],
    "problems": [
      { "title": "short problem title", "context": "2-3 sentences: business context and cost of the status quo", "anchor": "exact offer/USP name that solves it" },
      { "title": "", "context": "", "anchor": "" },
      { "title": "", "context": "", "anchor": "" },
      { "title": "", "context": "", "anchor": "" },
      { "title": "", "context": "", "anchor": "" }
    ],
    "demographics": "target customer demographics, consistent with audienceSignals and the form market",
    "psychographics": "values, attitudes, buying behavior of that target",
    "painPoints": ["4 specific pain points"],
    "goals": ["4 specific goals"]
  },
  "channels": {
    "primary": ["4 primary channels, format R6"],
    "secondary": ["4 secondary channels, format R6"]
  },
  "tactics": [
    { "tactic": "6 tactics total, format R7, each anchored to a real offer/USP", "anchor": "source-tagged quote or 'estimate', per R8b" }
  ],
  "prospectingKit": {
    "prospectJobTitle": "ONE precise job title to call first, format R8 (e.g. 'DAF', 'COO', 'Directeur des opérations') — never a list, never a vague term like 'decision-maker'",
    "prospectJobTitleRationale": "1 sentence explaining why this title is the right first contact, grounded in icp.demographics/psychographics or siteAnalysis",
    "callValueProposition": "ONE single fluid spoken paragraph, format R8c — no bullets, no line breaks",
    "callValuePropositionAnchor": "source-tagged quote or 'estimate', per R8b",
    "emailIcebreakerSubject": "email subject line, under 8 words, specific to this company",
    "emailIcebreakerOpening": "1-2 sentences opening a cold email, format R8d",
    "emailIcebreakerAnchor": "source-tagged quote or 'estimate', per R8b"
  },
  "timeline": "phased timeline using ${opts.q.q1}, ${opts.q.q2}, ${opts.q.q3}, ${opts.q.q4} as quarter labels. Example: '${opts.q.q1} (Months 1-3): [action]. ${opts.q.q2} (Months 4-6): [action]. ${opts.q.q3} (Months 7-9): [action]. Full optimization by ${opts.q.q4}.'"
}
Return ONLY the JSON object.`;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  // -------------------------------------------------------------------------
  // v2.3: quota guard, BEFORE any paid work (crawl / SerpApi / Apify / DeepSeek).
  // This endpoint stays PUBLIC (the /strategy free-trial flow has no login) — it never
  // hard-rejects on a missing token. A real user session, when present, is identified and
  // gets the higher DAILY_GENERATION_QUOTA; anonymous callers are rate-limited by IP at the
  // much lower ANONYMOUS_DAILY_QUOTA instead. Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
  // (auto-injected) — if either is missing, this guard is skipped entirely (dev/local
  // convenience only; both are present by default on Supabase, so this should never happen
  // in production).
  // -------------------------------------------------------------------------
  const authHeader = req.headers.get("Authorization") || "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const supabaseAdmin = supabaseUrl && serviceRoleKey ? createClient(supabaseUrl, serviceRoleKey) : null;

  if (supabaseAdmin) {
    let subject: string | null = null;
    if (jwt) {
      const { data: userData } = await supabaseAdmin.auth.getUser(jwt);
      if (userData?.user) subject = "user:" + userData.user.id;
    }
    if (!subject) {
      const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
      subject = "ip:" + ip;
    }
    const dailyLimit = subject.startsWith("user:") ? DAILY_GENERATION_QUOTA : ANONYMOUS_DAILY_QUOTA;

    // Fails OPEN (allows the request) if the table isn't set up yet or the query errors, so
    // a missing migration never turns into a hard outage on the public trial flow.
    try {
      const today = new Date().toISOString().slice(0, 10);
      const { data: quotaRow, error: quotaErr } = await supabaseAdmin
        .from("generation_quota")
        .select("count")
        .eq("subject", subject)
        .eq("day", today)
        .maybeSingle();
      if (!quotaErr) {
        const current = quotaRow?.count ?? 0;
        if (current >= dailyLimit) {
          return new Response(JSON.stringify({ error: "Daily generation quota exceeded" }),
            { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        await supabaseAdmin
          .from("generation_quota")
          .upsert({ subject, day: today, count: current + 1 }, { onConflict: "subject,day" });
      }
    } catch (quotaEx) {
      console.warn("generation_quota check skipped:", quotaEx);
    }
  } else {
    console.warn("SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not set — quota guard disabled.");
  }
  // --- end v2.3 quota guard ---

  try {
    const body: StrategyRequest = await req.json();
    const { website, businessName, businessModel, companyAge, teamSize, geographicMarket } = body;
    const language = body.language === "en" ? "en" : "fr";
    const langInstruction = language === "fr"
      ? "IMPORTANT: Generate ALL human-readable content in French. All text fields, descriptions, tactics, the prospecting kit and timeline must be written in French."
      : "IMPORTANT: Generate ALL human-readable content in English.";

    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;
    const dateLine = "Today is " + MONTHS_EN[now.getMonth()] + " " + now.getDate() + ", " + currentYear + ".";

    let q1Label: string, q2Label: string, q3Label: string, q4Label: string;
    if (currentMonth <= 3) {
      q1Label = "Q1 " + currentYear; q2Label = "Q2 " + currentYear; q3Label = "Q3 " + currentYear; q4Label = "Q4 " + currentYear;
    } else if (currentMonth <= 6) {
      q1Label = "Q2 " + currentYear; q2Label = "Q3 " + currentYear; q3Label = "Q4 " + currentYear; q4Label = "Q1 " + (currentYear + 1);
    } else if (currentMonth <= 9) {
      q1Label = "Q3 " + currentYear; q2Label = "Q4 " + currentYear; q3Label = "Q1 " + (currentYear + 1); q4Label = "Q2 " + (currentYear + 1);
    } else {
      q1Label = "Q4 " + currentYear; q2Label = "Q1 " + (currentYear + 1); q3Label = "Q2 " + (currentYear + 1); q4Label = "Q3 " + (currentYear + 1);
    }
    const quarterLine = "All timeline references MUST use these rolling quarter labels: " + q1Label + ", " + q2Label + ", " + q3Label + ", " + q4Label + ". Do NOT use any year before " + currentYear + ".";

    const extraFields: [string, string | undefined][] = [
      ["Description of the activity (written by the company)", body.description],
      ["Main offers/services (written by the company)", body.mainOffers],
      ["Current ideal customer (written by the company)", body.targetAudience],
      ["Perceived competitors/alternatives", body.competitors],
      ["Priority objectives (next 6 months)", body.objectives],
      ["Channels already in use", body.currentChannels],
      ["Approximate monthly marketing budget", body.monthlyBudget],
      ["LinkedIn company page", body.linkedinUrl],
    ];
    const extraBlock = extraFields
      .filter(([, v]) => v && String(v).trim())
      .map(([k, v]) => k + ": " + String(v).trim())
      .join("\n");
    const formBlock = [
      "Business name: " + businessName,
      "Website: " + website,
      "Business model: " + businessModel,
      "Company age: " + companyAge,
      "Team size: " + teamSize,
      "Geographic market: " + geographicMarket,
      extraBlock || "(no additional fields provided)",
    ].join("\n");

    // ---------------------------------------------------------------------
    // PHASE A - parallel research: CRAWL + SERP
    // ---------------------------------------------------------------------
    const serpKey = envFirst(["SERPAPI_API_KEY", "SERPAPI-API-KEY", "SERPAPIAPIKEY"]);
    const apifyKey = envFirst(["APIFY_API_KEY", "APIFY-API-KEY", "APIFYAPIKEY"]);

    let domain = "";
    try {
      domain = new URL(website.startsWith("http") ? website : "https://" + website).hostname.replace(/^www\./, "");
    } catch { domain = website.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0]; }

    const crawlPromise: Promise<{ pages: PageExtract[]; homeUrl: string | null }> =
      body.scanConsent === false ? Promise.resolve({ pages: [], homeUrl: null }) : crawlSite(website);

    const serpPromise: Promise<SerpResult[]> =
      serpKey && body.enableSerp !== false
        ? Promise.allSettled(buildSerpQueries(businessName, domain, language === "fr").map((q) => serpSearch(q, serpKey, language === "fr" ? "fr" : "en")))
            .then((settled) => settled.filter((s): s is PromiseFulfilledResult<SerpResult | null> => s.status === "fulfilled").map((s) => s.value).filter((v): v is SerpResult => !!v))
        : Promise.resolve([]);

    const [crawl, serpResults] = await Promise.all([crawlPromise, serpPromise]);

    const crawlDossier = buildSiteDossier(crawl.pages, body.manualSiteContent);
    const serpDossier = buildSerpDossier(serpResults);

    // ---------------------------------------------------------------------
    // PHASE B - LinkedIn company page via Apify
    // ---------------------------------------------------------------------
    const discoverySources: string[] = [
      ...crawl.pages.map((p) => p.text + " " + p.url),
      ...serpResults.flatMap((s) => s.results.map((r) => r.link + " " + r.title)),
    ];
    const linkedinUrl = body.enableLinkedIn === false ? null : discoverLinkedInUrl(discoverySources, body.linkedinUrl);

    let linkedin: { text: string; runId: string } | null = null;
    if (apifyKey && linkedinUrl) {
      // Hard budget so a slow Apify run can never blow the request's own latency/timeout
      // (this matters most during a live demo). If it times out, the Apify run keeps going
      // server-side but its result is discarded here — there's no cache to persist it to
      // (v2.2's strategy_cache was removed, see header). If you want that enrichment reused
      // later, wire it into wherever `businesses`/`marketing_strategies` already store data
      // for this domain, via EdgeRuntime.waitUntil.
      const linkedinPromise = apifyLinkedInCompany(linkedinUrl, apifyKey).catch(() => null);
      const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), LINKEDIN_TIMEOUT_MS));
      linkedin = await Promise.race([linkedinPromise, timeoutPromise]);
    }
    const linkedinDossier = linkedin ? linkedin.text : "(LinkedIn company page unavailable)";

    const hasSiteData = crawl.pages.length > 0 || !!(body.manualSiteContent && body.manualSiteContent.trim()) || serpResults.length > 0 || !!linkedin;

    // ---------------------------------------------------------------------
    // STEP 1 - site intelligence dossier (LLM call 1)
    // ---------------------------------------------------------------------
    let analysis: any;
    if (body.siteAnalysisOverride && typeof body.siteAnalysisOverride === "object") {
      analysis = body.siteAnalysisOverride;
    } else if (hasSiteData) {
      const rawAnalysis = await callDeepSeek(
        [{ role: "user", content: buildAnalysisPrompt({ formBlock, crawlDossier: crawlDossier || "(website not crawlable)", serpDossier, linkedinDossier, linkedinUrl: linkedinUrl || "", langInstruction }) }],
        { temperature: 0.2, maxTokens: 2500 },
      );
      analysis = extractJsonObject(rawAnalysis) ?? { confidence: "low", note: "Analysis model returned unusable output.", dataSourcesUsed: [] };
    } else {
      analysis = {
        confidence: "low",
        dataSourcesUsed: ["form"],
        note: "No source could be researched (crawl blocked, no SERP key/results, no LinkedIn). Rely on the form declarations only; keep claims at business-model level and do not invent details.",
        usps: [], offers: [], proofPoints: [], audienceSignals: [], brandVocabulary: [], missingInformation: ["website content", "serp data", "linkedin data"],
      };
    }

    if (body.onlyAnalysis) {
      return new Response(
        JSON.stringify({
          analysis,
          crawledPages: crawl.pages.map((p) => p.url),
          serpQueries: serpResults.map((s) => s.query),
          linkedinUrl,
          confidence: analysis.confidence ?? (hasSiteData ? "medium" : "low"),
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ---------------------------------------------------------------------
    // STEP 2 - grounded strategy (LLM call 2)
    // ---------------------------------------------------------------------
    const rawExcerpts = [
      "### WEBSITE CRAWL ###",
      crawlDossier || "(website not crawlable)",
      "",
      "### GOOGLE SERP ###",
      serpDossier,
      "",
      "### LINKEDIN COMPANY PAGE ###",
      linkedinDossier,
    ].join("\n").slice(0, 14000);

    const strategyPrompt = buildStrategyPrompt({
      formBlock,
      analysisJson: JSON.stringify(analysis, null, 1),
      rawExcerpts,
      crawledUrls: crawl.pages.length ? crawl.pages.map((p) => p.url).join(", ") : "(none - website could not be crawled; SERP and LinkedIn sources were used instead)",
      langInstruction,
      dateLine,
      quarterLine,
      q: { q1: q1Label, q2: q2Label, q3: q3Label, q4: q4Label },
      teamSize,
      companyAge,
    });

    let strategy: any = null;
    let validation: string[] = [];
    // v2.2: temperature lowered from 0.6 to 0.3 — this call must stay evidence-bound.
    let raw = await callDeepSeek([{ role: "user", content: strategyPrompt }], { temperature: 0.3, maxTokens: 8000 });
    strategy = extractJsonObject(raw);
    if (strategy) validation = validateStrategy(strategy);

    if (!strategy || validation.length) {
      const fix = await callDeepSeek(
        [
          { role: "user", content: strategyPrompt },
          { role: "assistant", content: raw || "(empty)" },
          {
            role: "user",
            content: strategy
              ? "The JSON you returned is invalid or incomplete. Missing/invalid paths: " + validation.join("; ") + ". Return the COMPLETE corrected JSON object only, with shorter strings if it was truncated. No markdown."
              : "Your previous answer was not valid JSON. Return ONLY the complete JSON object requested, no markdown, no code fences.",
          },
        ],
        { temperature: 0.3, maxTokens: 8000 }, // v2.2: was 0.4
      );
      const fixed = extractJsonObject(fix);
      if (fixed) {
        const fixedProblems = validateStrategy(fixed);
        if (fixedProblems.length <= validation.length) {
          strategy = fixed;
          validation = fixedProblems;
        }
      }
    }
    if (!strategy) throw new Error("Failed to parse AI response as JSON");

    const estimatedClaims = scanEstimatedClaims(strategy); // v2.2

    const responsePayload = {
      ...strategy,
      // v2.5: deterministic passthrough of the form's own declarations (NOT LLM-generated,
      // so zero hallucination risk) — lets downstream consumers (generate-content's SOM
      // capacity cross-check) know the team's actual size/budget without a second lookup.
      businessContext: { teamSize, monthlyBudget: body.monthlyBudget ?? null, companyAge },
      _meta: {
        crawledPages: crawl.pages.map((p) => p.url),
        serpQueries: serpResults.map((s) => s.query),
        linkedinUrl,
        apifyRunId: linkedin?.runId ?? null,
        siteDataConfidence: analysis.confidence ?? (hasSiteData ? "medium" : "low"),
        dataSourcesUsed: analysis.dataSourcesUsed ?? [],
        validationWarnings: validation,
        estimatedClaims, // tactics/prospectingKit figures that are planning assumptions, not sourced facts
        generatedAt: new Date().toISOString(),
      },
    };

    return new Response(JSON.stringify(responsePayload), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
