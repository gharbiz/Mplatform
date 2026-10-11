import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, ChevronRight, Download, ExternalLink, LockKeyhole, RefreshCw, Search, Share2, Sparkles, Users } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';

interface IcpDescription {
  overview: string;
  offer: string;
  howItWorks: string;
  capabilities: string[];
  benefits: string[];
  differentiation: string[];
}

interface IcpData {
  description: IcpDescription;
  needs: { title: string; fulfillment: string }[];
  problems: { title: string; context: string }[];
  demographics: string;
  psychographics: string;
  painPoints: string[];
  goals: string[];
}

interface StrategyData {
  icp?: IcpData;
  channels?: { primary?: string[]; secondary?: string[] };
  tactics?: (string | { tactic: string; anchor?: string })[];
  kpis?: (string | { metric: string; anchor?: string })[];
  timeline?: string;
}

// v1.4 (generate-content): icp_insights is now a normalized knowledge base instead of
// narrative paragraphs — PROSPECT, PAIN_POINTS, TRIGGERS, OBJECTIONS, each entity with
// stable IDs and an evidence anchor, built to be consumed by an AI agent or a sales rep
// directly, not re-parsed from prose.
interface IcpProspect {
  segment: string;
  location: string;
  decisionMakers: string[];
  buyingSignals: string[];
}
interface IcpPainPoint { id: string; painPoint: string; businessImpact: string; proof: string; anchor?: string }
interface IcpTrigger { id: string; text: string; anchor?: string }
interface IcpObjection { id: string; objection: string; response: string; anchor?: string }

interface IcpKnowledgeBase {
  prospect: IcpProspect;
  painPoints: IcpPainPoint[];
  triggers: IcpTrigger[];
  objections: IcpObjection[];
}

interface StrategyRecord {
  id: string;
  business_name: string;
  website: string;
  strategy_data: StrategyData;
  icp_insights: IcpKnowledgeBase | null;
}

function isEstimateAnchor(anchor?: string): boolean {
  return anchor?.trim().toLowerCase() === 'estimate';
}

// v1.4.1: a strategy saved BEFORE this change has icp_insights in the OLD shape
// ({ groups: [...] }), which has no `.prospect` / `.painPoints` at all. Rendering that
// directly as the new shape (e.g. kb.prospect.segment) throws and blanks the whole page —
// this is what actually broke /dashboard/icp. Never trust saved data without checking its
// shape first; fall back to "no knowledge base yet" instead of crashing.
function isValidKb(data: unknown): data is IcpKnowledgeBase {
  const d = data as any;
  return !!d && typeof d === 'object'
    && !!d.prospect && typeof d.prospect.segment === 'string'
    && Array.isArray(d.painPoints) && Array.isArray(d.triggers) && Array.isArray(d.objections);
}

export function IdealCustomerProfilesPage() {
  const navigate = useNavigate();
  const [strategies, setStrategies] = useState<StrategyRecord[]>([]);
  const [selectedStrategyId, setSelectedStrategyId] = useState('');
  const [kb, setKb] = useState<IcpKnowledgeBase | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState('');
  const [realLeads, setRealLeads] = useState<ClayLead[] | null>(null);
  const [isSearchingLeads, setIsSearchingLeads] = useState(false);
  const [leadsError, setLeadsError] = useState('');
  const [showRawLead, setShowRawLead] = useState<number | null>(null);

  const selectedStrategy = useMemo(
    () => strategies.find(strategy => strategy.id === selectedStrategyId) ?? strategies[0] ?? null,
    [selectedStrategyId, strategies],
  );
  const icp = selectedStrategy?.strategy_data.icp;

  useEffect(() => {
    const loadStrategies = async () => {
      const { data, error: queryError } = await supabase
        .from('marketing_strategies')
        .select('id, business_name, website, strategy_data, icp_insights')
        .order('created_at', { ascending: false });
      if (queryError) {
        setError('Unable to load your marketing strategies.');
      } else {
        const records = (data ?? []) as StrategyRecord[];
        setStrategies(records);
        if (records[0]) {
          setSelectedStrategyId(records[0].id);
          setKb(isValidKb(records[0].icp_insights) ? records[0].icp_insights : null);
        }
      }
      setIsLoading(false);
    };
    loadStrategies();
  }, []);

  useEffect(() => {
    if (!selectedStrategy) return;
    setKb(isValidKb(selectedStrategy.icp_insights) ? selectedStrategy.icp_insights : null);
    setRealLeads(null);
    setLeadsError('');
  }, [selectedStrategy]);

  const generateInsights = async () => {
    if (!selectedStrategy || !selectedStrategy.strategy_data.icp) return;
    setIsGenerating(true);
    setError('');
    try {
      // v2.3: this page only renders inside the authenticated dashboard, so a session is
      // always expected here.
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Session expirée, veuillez vous reconnecter.');

      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-content`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ mode: 'icp_insights', strategy: selectedStrategy.strategy_data }),
      });
      const result = await response.json();
      if (!response.ok || !result.prospect || !Array.isArray(result.painPoints)) {
        throw new Error('Invalid insights response');
      }
      const generatedKb: IcpKnowledgeBase = {
        prospect: result.prospect,
        painPoints: result.painPoints ?? [],
        triggers: result.triggers ?? [],
        objections: result.objections ?? [],
      };
      setKb(generatedKb);
      await supabase.from('marketing_strategies').update({ icp_insights: generatedKb }).eq('id', selectedStrategy.id);
      setStrategies(previous => previous.map(strategy => strategy.id === selectedStrategy.id
        ? { ...strategy, icp_insights: generatedKb }
        : strategy));
    } catch {
      setError('Elsa could not generate the customer insights. Please try again.');
    } finally {
      setIsGenerating(false);
    }
  };

  const findRealLeads = async () => {
    if (!icp) return;
    setIsSearchingLeads(true);
    setLeadsError('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Session expirée, veuillez vous reconnecter.');

      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/find-icp-leads`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        // limit: 2 — the function hard-caps at 20 regardless, this just states the actual need
        body: JSON.stringify({ segment: icp.demographics, persona: icp.psychographics, limit: 2 }),
      });
      const result = await response.json();
      if (!response.ok || !Array.isArray(result.results)) {
        throw new Error(typeof result.error === 'string' ? result.error : 'Lead search failed');
      }
      setRealLeads(result.results);
    } catch (e) {
      setLeadsError(e instanceof Error ? e.message : 'La recherche a échoué. Réessayez.');
    } finally {
      setIsSearchingLeads(false);
    }
  };

  const segment = icp?.demographics || 'Your ideal customer segment';
  const persona = icp?.psychographics || 'Your key decision-maker and buyer persona';
  const companyProfile = icp?.description?.overview || 'Key firmographic details of the ideal customer';
  const barriers = icp?.problems?.map(problem => problem.title).join(' · ') || 'Why customers might hesitate to buy';
  const goals = icp?.goals?.slice(0, 3).join(' · ') || 'What customers want to achieve';

  if (isLoading) {
    return <div className="flex justify-center py-32"><div className="w-8 h-8 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin" /></div>;
  }

  if (!selectedStrategy || !icp) {
    return (
      <div className="p-8 max-w-3xl mx-auto text-center">
        <div className="bg-white rounded-2xl border border-gray-200 p-12">
          <Sparkles size={40} className="text-blue-500 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Create your Ideal Customer Profile</h1>
          <p className="text-gray-500 mb-6">Generate a marketing strategy first so Elsa can build the customer insights.</p>
          <button onClick={() => navigate('/strategy')} className="px-5 py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold transition-colors">Create a strategy</button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-5 sm:p-8 max-w-5xl mx-auto">
      <button onClick={() => navigate('/dashboard/strategies')} className="flex items-center gap-2 text-gray-600 hover:text-blue-600 transition-colors font-medium mb-6">
        <ArrowLeft size={17} /> Back
      </button>

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Ideal customer profile</h1>
          <p className="text-sm text-gray-500 mt-1">Built from your saved marketing strategy</p>
        </div>
        <div className="flex items-center gap-2">
          {strategies.length > 1 && (
            <select value={selectedStrategy.id} onChange={event => setSelectedStrategyId(event.target.value)} className="px-3 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
              {strategies.map(strategy => <option key={strategy.id} value={strategy.id}>{strategy.business_name}</option>)}
            </select>
          )}
          <button className="p-2.5 rounded-xl bg-white border border-gray-200 hover:bg-gray-50" title="Share"><Share2 size={17} /></button>
          <button className="p-2.5 rounded-xl bg-white border border-gray-200 hover:bg-gray-50" title="Download"><Download size={17} /></button>
        </div>
      </div>

      <div className="bg-white border border-gray-100 rounded-2xl p-5 sm:p-7 grid md:grid-cols-3 gap-6 mb-6">
        <ProfileSummary label="Request" value="B2B" color="bg-blue-600" />
        <ProfileSummary label="Segment" value={segment} color="bg-green-500" />
        <ProfileSummary label="Persona" value={persona} color="bg-green-500" />
      </div>

      {/* Real, contactable ICP examples via Clay */}
      <div className="bg-white border border-gray-100 rounded-2xl p-5 sm:p-7 mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-2">
          <h2 className="text-base font-bold text-gray-900 flex items-center gap-2">
            <Users size={18} className="text-blue-600" /> Exemples réels contactables
          </h2>
          <button
            onClick={findRealLeads}
            disabled={isSearchingLeads}
            className="flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-colors whitespace-nowrap"
          >
            {isSearchingLeads ? <RefreshCw size={15} className="animate-spin" /> : <Search size={15} />}
            {isSearchingLeads ? 'Recherche en cours...' : realLeads ? 'Relancer la recherche' : 'Trouver 2 exemples réels'}
          </button>
        </div>
        <p className="text-sm text-gray-500 mb-4">Recherche 2 personnes réelles correspondant au Segment et au Persona ci-dessus, à partir de votre base Clay.</p>

        {leadsError && <div className="mb-3 p-3 bg-red-50 border border-red-100 text-red-600 rounded-lg text-sm">{leadsError}</div>}

        {realLeads && realLeads.length > 0 ? (
          <div className="grid sm:grid-cols-2 gap-4">
            {realLeads.map((lead, i) => <LeadCard key={i} lead={lead} index={i} showRaw={showRawLead === i} onToggleRaw={() => setShowRawLead(showRawLead === i ? null : i)} />)}
          </div>
        ) : realLeads && realLeads.length === 0 ? (
          <p className="text-sm text-gray-400">Aucun exemple trouvé pour ce profil. Essayez de régénérer la stratégie pour affiner le Segment/Persona.</p>
        ) : null}
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <p className="text-sm text-gray-600">This is your free ICP. Elsa uses your strategy to build an actionable knowledge base below.</p>
        <button onClick={generateInsights} disabled={isGenerating} className="flex items-center justify-center gap-2 px-5 py-3 bg-green-500 hover:bg-green-600 disabled:bg-green-300 text-white text-sm font-semibold rounded-xl transition-colors whitespace-nowrap">
          {isGenerating ? <RefreshCw size={16} className="animate-spin" /> : <Sparkles size={16} />}
          {isGenerating ? 'Elsa is thinking...' : kb ? 'Refresh knowledge base' : 'Generate knowledge base'}
        </button>
      </div>

      <div className="space-y-2 mb-8">
        <ProfileRow title="Segment description" description={segment} />
        <ProfileRow title="Company profile" description={companyProfile} />
        <ProfileRow title="Buyer persona" description={persona} />
        <ProfileRow title="Barriers" description={barriers} badge="Proof checked" />
        <ProfileRow title="Goals and objectives" description={goals} badge="Proof checked" />
      </div>

      {error && <div className="mb-6 p-4 bg-red-50 border border-red-100 text-red-600 rounded-xl text-sm">{error}</div>}

      {kb ? (
        <>
          <div className="mb-5">
            <h2 className="text-lg font-bold text-blue-700">Base de connaissances ICP</h2>
            <p className="text-sm text-blue-600 mt-1">Structurée pour être utilisée directement par vos agents IA ou votre équipe commerciale — pas de prose à ré-interpréter.</p>
          </div>

          {/* PROSPECT */}
          <section className="py-6 border-t border-gray-200">
            <h3 className="text-base font-bold text-gray-900 mb-4">Prospect (ICP)</h3>
            <div className="grid sm:grid-cols-2 gap-4 mb-4">
              <div className="p-4 bg-gray-50 rounded-xl">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Segment</p>
                <p className="text-sm text-gray-800">{kb.prospect?.segment ?? '—'}</p>
              </div>
              <div className="p-4 bg-gray-50 rounded-xl">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Localisation</p>
                <p className="text-sm text-gray-800">{kb.prospect?.location ?? '—'}</p>
              </div>
            </div>
            <div className="mb-4">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Décideur</p>
              <div className="flex flex-wrap gap-2">
                {kb.prospect.decisionMakers?.map((d, i) => (
                  <span key={i} className="px-3 py-1 bg-blue-50 text-blue-700 text-xs font-medium rounded-full">{d}</span>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Signal d'intérêt</p>
              <ul className="space-y-1">
                {kb.prospect.buyingSignals?.map((s, i) => <li key={i} className="text-sm text-gray-700">• {s}</li>)}
              </ul>
            </div>
          </section>

          {/* PAIN_POINTS */}
          <section className="py-6 border-t border-gray-200">
            <h3 className="text-base font-bold text-gray-900 mb-4">Pain points</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs font-semibold text-gray-400 uppercase tracking-wide border-b border-gray-100">
                    <th className="py-2 pr-4">ID</th>
                    <th className="py-2 pr-4">Pain point</th>
                    <th className="py-2 pr-4">Impact business</th>
                    <th className="py-2">Preuve associée</th>
                  </tr>
                </thead>
                <tbody>
                  {(kb.painPoints ?? []).map(pp => (
                    <tr key={pp.id} className="border-b border-gray-50 last:border-0 align-top">
                      <td className="py-2.5 pr-4 font-mono text-xs text-gray-500 whitespace-nowrap">{pp.id}</td>
                      <td className="py-2.5 pr-4 font-medium text-gray-900">{pp.painPoint}</td>
                      <td className="py-2.5 pr-4 text-gray-700">{pp.businessImpact}</td>
                      <td className="py-2.5 text-gray-600">
                        {pp.proof}
                        {isEstimateAnchor(pp.anchor) && <span className="ml-2 text-xs font-medium text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">estimation</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* TRIGGERS */}
          <section className="py-6 border-t border-gray-200">
            <h3 className="text-base font-bold text-gray-900 mb-4">Triggers (déclencheurs de décision)</h3>
            <div className="space-y-2">
              {(kb.triggers ?? []).map(t => (
                <div key={t.id} className="flex items-start gap-3 p-3 bg-gray-50 rounded-xl">
                  <span className="font-mono text-xs text-gray-400 mt-0.5 flex-shrink-0">{t.id}</span>
                  <p className="text-sm text-gray-800">
                    {t.text}
                    {isEstimateAnchor(t.anchor) && <span className="ml-2 text-xs font-medium text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">estimation</span>}
                  </p>
                </div>
              ))}
            </div>
          </section>

          {/* OBJECTIONS */}
          <section className="py-6 border-t border-gray-200">
            <h3 className="text-base font-bold text-gray-900 mb-4">Objections (et réponses associées)</h3>
            <div className="space-y-3">
              {(kb.objections ?? []).map(o => (
                <div key={o.id} className="p-4 bg-gray-50 rounded-xl">
                  <p className="text-sm font-semibold text-gray-900">
                    <span className="font-mono text-xs text-gray-400 mr-2">{o.id}</span>
                    « {o.objection} »
                  </p>
                  <p className="text-sm text-gray-700 mt-1.5 pl-1 border-l-2 border-blue-200">
                    → {o.response}
                    {isEstimateAnchor(o.anchor) && <span className="ml-2 text-xs font-medium text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">estimation</span>}
                  </p>
                </div>
              ))}
            </div>
          </section>
        </>
      ) : !isGenerating ? (
        <div className="py-12 text-center border-t border-gray-200">
          <Sparkles size={32} className="text-gray-300 mx-auto mb-3" />
          <p className="text-sm text-gray-500">Aucune base de connaissances générée pour le moment.</p>
        </div>
      ) : null}

      <div className="mt-6 flex items-center gap-2 text-xs text-gray-400"><LockKeyhole size={13} /> Generated from your saved strategy and remains private to your account.</div>
    </div>
  );
}

function ProfileSummary({ label, value, color }: { label: string; value: string; color: string }) {
  return <div className="flex gap-3 items-start"><span className={`w-7 h-7 rounded-full ${color} flex items-center justify-center flex-shrink-0`}><Check size={15} className="text-white" /></span><div><p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{label}</p><p className="text-sm text-gray-800 mt-1 leading-snug">{value}</p></div></div>;
}

interface ClayMatchedExperience {
  company: string | null;
  title: string | null;
  location: string | null;
  start_date: string | null;
  end_date: string | null;
}

interface ClayLead {
  clay_profile_id: number;
  name: string | null;
  first_name: string | null;
  last_name: string | null;
  linkedin_url: string | null;
  location: { name: string | null; city: string | null; state_or_province: string | null };
  matched_experiences: ClayMatchedExperience[];
}

// Field names confirmed against developers.clay.com's OpenAPI spec (PublicApiPersonSearchResult)
// — NOT a guess. A raw search result never carries an email; that needs the separate
// enrichment step noted in find-icp-leads.ts, not implemented yet (see that file's header).
function LeadCard({ lead, index, showRaw, onToggleRaw }: { lead: ClayLead; index: number; showRaw: boolean; onToggleRaw: () => void }) {
  const name = lead.name || [lead.first_name, lead.last_name].filter(Boolean).join(' ') || `Contact ${index + 1}`;
  const current = lead.matched_experiences?.[0]; // the role the search actually matched on
  const location = lead.location?.name || [lead.location?.city, lead.location?.state_or_province].filter(Boolean).join(', ') || '';

  return (
    <div className="p-4 bg-gradient-to-br from-blue-50 to-gray-50 rounded-xl border border-blue-100">
      <p className="font-semibold text-gray-900 text-sm">{name}</p>
      {current && (current.title || current.company) && (
        <p className="text-sm text-gray-600">{current.title}{current.title && current.company && ' · '}{current.company}</p>
      )}
      {location && <p className="text-xs text-gray-400 mt-0.5">{location}</p>}
      <div className="flex flex-wrap items-center gap-3 mt-2">
        {lead.linkedin_url && (
          <a href={lead.linkedin_url} target="_blank" rel="noopener noreferrer" className="text-xs font-medium text-blue-600 hover:underline flex items-center gap-1">
            LinkedIn <ExternalLink size={11} />
          </a>
        )}
        <span className="text-xs text-gray-400 italic">Email : nécessite un enrichissement (non branché)</span>
      </div>
      <button onClick={onToggleRaw} className="text-xs text-gray-400 hover:text-gray-600 mt-2 underline">
        {showRaw ? 'Masquer les données brutes' : 'Voir les données brutes'}
      </button>
      {showRaw && (
        <pre className="mt-2 p-2 bg-gray-900 text-gray-100 text-[10px] rounded-lg overflow-x-auto max-h-48">
          {JSON.stringify(lead, null, 2)}
        </pre>
      )}
    </div>
  );
}

function ProfileRow({ title, description, badge }: { title: string; description: string; badge?: string }) {
  return <div className="flex items-center gap-3 px-4 py-3 bg-white border border-gray-100 rounded-xl shadow-sm"><span className="w-6 h-6 rounded-full bg-green-500 flex items-center justify-center flex-shrink-0"><Check size={14} className="text-white" /></span><p className="font-semibold text-sm text-gray-900 whitespace-nowrap">{title}</p><p className="text-sm text-gray-400 truncate flex-1 hidden sm:block">{description}</p>{badge && <span className="hidden sm:inline-flex px-2 py-1 rounded-full bg-green-100 text-green-700 text-xs font-semibold">{badge}</span>}<ChevronRight size={16} className="text-gray-400 flex-shrink-0" /></div>;
}
