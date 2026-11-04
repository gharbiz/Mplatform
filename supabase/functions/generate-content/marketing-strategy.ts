const MARKETING_STRATEGY_MODULES = [
  "diagnosis",
  "icpPrioritization",
  "positioning",
  "acquisition",
  "conversion",
  "campaigns",
  "content",
  "budget",
  "kpis",
  "roadmap",
] as const;

export type MarketingStrategyLanguage = "fr" | "en";

const CONFIDENCE_LEVELS = ["verified", "estimate", "assumption"];

export function buildMarketingStrategyPrompt(
  strategyJson: string,
  icpInsightsJson: string,
  language: MarketingStrategyLanguage,
): string {
  const languageName = language === "fr" ? "French" : "English";
  return `You are Elsa, a senior B2B growth strategist and go-to-market architect. Transform the existing marketing intelligence below into an operational, prioritized and measurable marketing strategy for a company targeting the FRENCH market.

LANGUAGE: Write every human-readable value in ${languageName}. JSON keys stay exactly as specified.

INPUTS
- The company strategy (website analysis, ICP, channels, tactics, timeline, optional businessContext with teamSize / monthlyBudget / companyAge).
- The existing ICP knowledge base (prospect, pain points, triggers, objections). Build on it. Do NOT rewrite or contradict it. Keep its IDs and source anchors when you reference them.

=== COMPANY STRATEGY ===
${strategyJson}

=== EXISTING ICP KNOWLEDGE BASE ===
${icpInsightsJson}

OUTPUT
Return ONLY one JSON object (no markdown, no code fences) with exactly these ten keys, in this order:
"diagnosis", "icpPrioritization", "positioning", "acquisition", "conversion", "campaigns", "content", "budget", "kpis", "roadmap".

Each key holds an object with this exact shape:
{
  "summary": "string, 2-4 sentences: the module's conclusion",
  "items": [
    {
      "label": "short title",
      "detail": "specific recommendation or finding, max 2 sentences",
      "confidence": "verified" | "estimate" | "assumption",
      "evidence": "the source supporting it (website fact, ICP anchor, business input) or 'none'",
      "nextAction": "one concrete action the team should take",
      "score": number from 0 to 10 (optional, only where ranking or prioritization applies)
    }
  ],
  "missingInformation": ["information that is missing and would change the recommendation"]
}

MODULE RULES
- diagnosis: positioning, main advantage, weaknesses, market opportunities, acquisition bottlenecks, conversion barriers, critical assumptions to validate. Summary = concise diagnosis of what blocks the commercial objectives.
- icpPrioritization: score every segment on commercial attractiveness, problem urgency, buying intent, estimated contract value, accessibility, sales cycle complexity, operational fit. One item per segment, label starts with its rank role: "Primary ICP", "Secondary ICP" or "Low-priority ICP". Explain every ranking in detail.
- positioning: core positioning, unique value proposition, main commercial promise, differentiation against alternatives, desired market perception, three messaging angles, and for each priority segment a main message, pain-point argument, proof point, objection to overcome and commercial CTA. Specific to the real products; no generic marketing language.
- acquisition: score SEO, AEO/GEO, LinkedIn organic, LinkedIn Ads, Google Ads, cold email, partnerships, events/webinars, referral, retargeting on ICP accessibility, purchase intent, expected acquisition cost, speed to results, scalability, internal resources. Label each channel with its role: "Primary channel", "Secondary channel", "Supporting channel" or "Postpone". Explain why.
- conversion: TOFU (awareness), MOFU (consideration: lead magnets, nurturing, case studies, demos, retargeting), BOFU (decision: commercial arguments, proof, objection handling, demo or quote process, conversion CTA). Describe the transition between stages.
- campaigns: 3 executable campaigns for the primary ICP. Each item detail must name the target segment, business objective, pain point, message, channel, format, CTA, required assets, execution steps and success metric. Avoid vague goals like "increase awareness".
- content: six pillars: educational, problem-awareness, comparison, authority, proof/case-study, conversion-oriented. Each item detail states target persona, search or buying intent, objective, format, distribution channel and CTA.
- budget: three scenarios labelled "Lean", "Balanced" and "Growth" (translate the labels into the output language). Each: recommended channels, resources, operational workload, budget allocation percentages when justified, main risks, conditions for scaling. Do NOT invent a precise budget when none is declared; if businessContext gives one, use it. All financial projections must be labelled as estimates.
- kpis: funnel KPIs: qualified traffic, cost per lead, lead generation by channel, MQL conversion, MQL to SQL, SQL to opportunity, opportunity to customer, CAC, pipeline generated, average contract value, revenue, customer lifetime value, retention. Each item detail: definition, formula, strategic relevance, monitoring frequency, data source. Confidence must reflect whether the baseline is measured ("verified"), an industry benchmark or planning assumption ("estimate" or "assumption"). Never present a benchmark as actual company performance.
- roadmap: 90-day plan in three phases: Days 1-30 (foundation, positioning, acquisition and conversion setup), Days 31-60 (campaign execution, lead generation, first optimization), Days 61-90 (performance analysis, conversion improvements, scaling decisions). Each item label starts with its phase. Detail gives the objective, responsible function, dependencies, expected deliverable, KPI and completion criteria.

COHERENCE RULES
1. Every recommendation links to an identified problem or opportunity from the inputs.
2. Every campaign targets a defined ICP; every channel has an acquisition or conversion purpose.
3. Every KPI measures a real objective; every projection states its assumptions.
4. Recommendations must fit the declared team and budget.
5. Separate website facts ("verified") from AI assumptions ("assumption") and estimates ("estimate").
6. Flag contradictions between the original analysis and new recommendations in diagnosis.
7. If essential information is missing, say so in missingInformation instead of inventing it.
Before answering, check that positioning, ICP, channels, campaigns, budget, KPIs and roadmap are mutually consistent.`;
}

export function validateMarketingStrategy(data: unknown): string[] {
  const problems: string[] = [];
  if (!data || typeof data !== "object" || Array.isArray(data)) return ["root must be an object"];
  const root = data as Record<string, unknown>;

  for (const key of MARKETING_STRATEGY_MODULES) {
    const module = root[key] as Record<string, unknown> | undefined;
    if (!module || typeof module !== "object" || Array.isArray(module)) {
      problems.push(`${key} is missing`);
      continue;
    }
    if (typeof module.summary !== "string" || !module.summary.trim()) problems.push(`${key}.summary is empty`);
    if (!Array.isArray(module.items) || module.items.length === 0) {
      problems.push(`${key}.items is empty`);
      continue;
    }
    module.items.forEach((item, index) => {
      const i = item as Record<string, unknown>;
      const path = `${key}.items[${index}]`;
      if (!i || typeof i !== "object") { problems.push(`${path} is not an object`); return; }
      if (typeof i.label !== "string" || !i.label.trim()) problems.push(`${path}.label is empty`);
      if (typeof i.detail !== "string") problems.push(`${path}.detail is missing`);
      if (!CONFIDENCE_LEVELS.includes(i.confidence as string)) problems.push(`${path}.confidence is invalid`);
      if (typeof i.nextAction !== "string") problems.push(`${path}.nextAction is missing`);
      if (i.score !== undefined && (typeof i.score !== "number" || i.score < 0 || i.score > 10)) problems.push(`${path}.score is out of range`);
    });
    if (!Array.isArray(module.missingInformation)) problems.push(`${key}.missingInformation is missing`);
  }
  return problems;
}
