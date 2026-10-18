import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ArrowLeft, Building2, CheckCircle2, CircleHelp, Database, ExternalLink, RefreshCw, Search, Target, Users } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';

type JsonRecord = Record<string, unknown>;
interface StrategyRecord {
  id: string;
  business_id: string | null;
  business_name: string;
  website: string;
  strategy_data: JsonRecord;
  icp_insights: JsonRecord | null;
}
interface ClayExperience {
  company?: string | null;
  title?: string | null;
  location?: string | null;
  start_date?: string | null;
  end_date?: string | null;
}
interface ClayLead {
  clay_profile_id: string | number;
  name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  linkedin_url?: string | null;
  location?: { name?: string | null; city?: string | null; state_or_province?: string | null } | null;
  matched_experiences?: ClayExperience[];
}
interface AccountContextRecord {
  id: string;
  strategy_id: string;
  clay_profile_id: string;
  clay_data: ClayLead;
  clay_search_id: string | null;
  last_synced_at: string;
  created_at: string;
}
const asRecord = (value: unknown): JsonRecord => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
const asStrings = (value: unknown): string[] => Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && !!v.trim()) : [];
const asText = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const unique = (items: string[]) => [...new Set(items.map(item => item.trim()).filter(Boolean))];

function deriveContext(strategy: StrategyRecord, lead: ClayLead) {
  const data = asRecord(strategy.strategy_data);
  const icp = asRecord(data.icp);
  const description = asRecord(icp.description);
  const problems = Array.isArray(icp.problems) ? icp.problems.map(item => asRecord(item)).map(item => ({
    title: asText(item.title), context: asText(item.context),
  })).filter(item => item.title) : [];
  const needs = Array.isArray(icp.needs) ? icp.needs.map(item => asRecord(item)).map(item => ({
    title: asText(item.title), fulfillment: asText(item.fulfillment),
  })).filter(item => item.title) : [];
  const insights = asRecord(strategy.icp_insights);
  const insightProspect = asRecord(insights.prospect);
  const insightPainPoints = Array.isArray(insights.painPoints) ? insights.painPoints.map(item => asRecord(item)) : [];
  const segment = asText(insightProspect.segment) || asText(icp.demographics) || 'Segment non précisé dans la stratégie';
  const criteria = unique([
    asText(icp.demographics),
    asText(icp.psychographics),
    ...asStrings(insightProspect.decisionMakers),
    ...asStrings(insightProspect.buyingSignals),
  ]);
  const painPoints = unique([
    ...problems.map(item => item.title + (item.context ? ': ' + item.context : '')),
    ...asStrings(icp.painPoints),
    ...insightPainPoints.map(item => [asText(item.painPoint), asText(item.businessImpact)].filter(Boolean).join(' — ')),
  ]);
  const offers = unique([
    asText(description.offer),
    ...asStrings(description.benefits),
    ...needs.map(item => item.title + (item.fulfillment ? ': ' + item.fulfillment : '')),
  ]);
  const proofs = unique([
    ...asStrings(asRecord(data).proofs),
    ...asStrings(asRecord(data).evidence),
    ...insightPainPoints.map(item => asText(item.proof)).filter(value => value && value.toLowerCase() !== 'estimate'),
  ]);
  const experience = (lead.matched_experiences ?? []).filter(item => item.company || item.title);
  const location = [lead.location?.city, lead.location?.state_or_province, lead.location?.name].filter(Boolean).join(', ');
  const missing = [
    !lead.name && !lead.first_name && !lead.last_name ? 'Nom du contact' : '',
    !lead.linkedin_url ? 'Profil LinkedIn' : '',
    !experience.some(item => item.company) ? 'Entreprise actuelle vérifiée' : '',
    !experience.some(item => item.title) ? 'Fonction / niveau de décision' : '',
    !location ? 'Localisation du contact' : '',
    !asText(description.offer) ? 'Offre explicite dans la stratégie' : '',
    proofs.length === 0 ? 'Preuves commerciales documentées' : '',
    problems.length === 0 && asStrings(icp.painPoints).length === 0 && insightPainPoints.length === 0 ? 'Problèmes client documentés' : '',
  ].filter(Boolean);
  return { segment, criteria, painPoints, offers, proofs, experience, location, missing };
}

export function AccountContextBuilderPage() {
  const navigate = useNavigate();
  const [strategies, setStrategies] = useState<StrategyRecord[]>([]);
  const [selectedStrategyId, setSelectedStrategyId] = useState('');
  const [accounts, setAccounts] = useState<AccountContextRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const selectedStrategy = useMemo(
    () => strategies.find(item => item.id === selectedStrategyId) ?? null,
    [strategies, selectedStrategyId],
  );
  const icp = asRecord(asRecord(selectedStrategy?.strategy_data).icp);
  const hasIcp = !!selectedStrategy && (!!asText(icp.demographics) || !!asText(icp.psychographics));

  useEffect(() => {
    let active = true;
    const load = async () => {
      setIsLoading(true);
      const { data, error: queryError } = await supabase
        .from('marketing_strategies')
        .select('id, business_id, business_name, website, strategy_data, icp_insights')
        .order('created_at', { ascending: false });
      if (!active) return;
      if (queryError) setError('Impossible de charger les stratégies enregistrées.');
      else {
        const rows = (data ?? []) as StrategyRecord[];
        setStrategies(rows);
        if (rows[0]) setSelectedStrategyId(current => current || rows[0].id);
      }
      setIsLoading(false);
    };
    void load();
    return () => { active = false; };
  }, []);

  const loadAccounts = useCallback(async (strategyId: string) => {
    if (!strategyId) { setAccounts([]); return; }
    const { data, error: queryError } = await supabase
      .from('account_contexts')
      .select('id, strategy_id, clay_profile_id, clay_data, clay_search_id, last_synced_at, created_at')
      .eq('strategy_id', strategyId)
      .order('last_synced_at', { ascending: false });
    if (queryError) {
      setError(queryError.message.includes('account_contexts') || queryError.code === '42P01'
        ? 'La table account_contexts n’existe pas encore dans Supabase. Appliquez la migration du module avant de synchroniser.'
        : 'Impossible de charger les comptes synchronisés.');
      setAccounts([]);
      return;
    }
    setAccounts((data ?? []) as AccountContextRecord[]);
  }, []);

  useEffect(() => { void loadAccounts(selectedStrategyId); }, [selectedStrategyId, loadAccounts]);

  const syncClay = async () => {
    if (!selectedStrategy || !hasIcp) return;
    setIsSyncing(true);
    setError('');
    setNotice('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Session expirée. Reconnectez-vous.');
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/find-icp-leads`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ segment: asText(icp.demographics), persona: asText(icp.psychographics), limit: 20 }),
      });
      const result = await response.json();
      if (!response.ok || !Array.isArray(result.results)) {
        throw new Error(typeof result.error === 'string' ? result.error : 'La recherche Clay a échoué.');
      }
      const leads = result.results as ClayLead[];
      if (!leads.length) {
        setNotice('Clay n’a retourné aucun contact pour ce profil. Ajustez les critères ICP existants puis relancez la recherche.');
        return;
      }
      const records = leads.filter(lead => lead.clay_profile_id !== undefined && lead.clay_profile_id !== null).map(lead => ({
        user_id: session.user.id,
        strategy_id: selectedStrategy.id,
        clay_profile_id: String(lead.clay_profile_id),
        clay_data: lead,
        clay_search_id: typeof result.searchId === 'string' ? result.searchId : null,
        last_synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }));
      if (!records.length) throw new Error('Clay a retourné des contacts sans identifiant stable. Aucun compte n’a été enregistré.');
      const { error: saveError } = await supabase.from('account_contexts').upsert(records, { onConflict: 'user_id,strategy_id,clay_profile_id' });
      if (saveError) {
        if (saveError.code === '42P01' || saveError.message.includes('account_contexts')) {
          throw new Error('La table account_contexts n’existe pas encore dans Supabase. Appliquez la migration du module avant de synchroniser.');
        }
        throw new Error(saveError.message);
      }
      await loadAccounts(selectedStrategy.id);
      setNotice(`${records.length} compte(s) Clay synchronisé(s). Le contexte stratégique est calculé à partir de la stratégie existante ; aucun nouvel ICP n’a été créé.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'La synchronisation Clay a échoué.');
    } finally {
      setIsSyncing(false);
    }
  };

  const visibleAccounts = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return accounts.filter(account => {
      const lead = account.clay_data ?? {};
      const experience = (lead.matched_experiences ?? []).map(item => `${item.company ?? ''} ${item.title ?? ''}`).join(' ');
      const haystack = [lead.name, lead.first_name, lead.last_name, lead.linkedin_url, experience, lead.location?.city, lead.location?.name].join(' ').toLowerCase();
      return !needle || haystack.includes(needle);
    });
  }, [accounts, search]);

  if (isLoading) return <div className="flex justify-center py-32"><div className="w-8 h-8 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin" /></div>;

  return (
    <div className="p-5 sm:p-8 max-w-7xl mx-auto">
      <button onClick={() => navigate('/dashboard')} className="flex items-center gap-2 text-gray-600 hover:text-blue-600 font-medium mb-6">
        <ArrowLeft size={17} /> Dashboard
      </button>
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4 mb-7">
        <div>
          <div className="flex items-center gap-2 text-blue-700 text-sm font-semibold mb-2"><Database size={16} /> MODULE A</div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Account Context Builder</h1>
          <p className="text-sm text-gray-500 mt-2 max-w-2xl">Reliez les contacts trouvés par Clay à votre stratégie existante. MPlatform assemble les critères ICP, problèmes, offres et preuves disponibles, puis signale les informations manquantes sans régénérer l’ICP.</p>
        </div>
        <button onClick={syncClay} disabled={!hasIcp || isSyncing} className="inline-flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl font-semibold text-sm">
          {isSyncing ? <RefreshCw size={17} className="animate-spin" /> : <Search size={17} />}
          {isSyncing ? 'Synchronisation Clay…' : 'Récupérer les comptes Clay'}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
        <Metric icon={<Target size={18} />} label="Stratégies disponibles" value={String(strategies.length)} />
        <Metric icon={<Users size={18} />} label="Comptes associés" value={String(accounts.length)} />
        <Metric icon={<CircleHelp size={18} />} label="À compléter" value={String(accounts.filter(account => selectedStrategy && deriveContext(selectedStrategy, account.clay_data).missing.length > 0).length)} />
      </div>

      <section className="bg-white border border-gray-200 rounded-2xl p-4 sm:p-5 mb-6">
        <label className="block text-sm font-semibold text-gray-800 mb-2" htmlFor="strategy-select">Stratégie commerciale de référence</label>
        <select id="strategy-select" value={selectedStrategyId} onChange={event => { setSelectedStrategyId(event.target.value); setError(''); setNotice(''); }} className="w-full max-w-2xl px-3 py-3 border border-gray-200 rounded-xl bg-white text-sm">
          {strategies.map(strategy => <option key={strategy.id} value={strategy.id}>{strategy.business_name || strategy.website || 'Stratégie sans nom'} — {strategy.website}</option>)}
        </select>
        {selectedStrategy && (
          <div className="mt-4 flex flex-col sm:flex-row sm:items-center gap-3 text-sm">
            <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center"><Building2 size={19} /></div>
            <div><p className="font-semibold text-gray-900">{selectedStrategy.business_name}</p><p className="text-gray-500">{selectedStrategy.website || 'Site non renseigné'}</p></div>
            <span className={hasIcp ? 'sm:ml-auto px-2.5 py-1 rounded-full text-xs bg-green-50 text-green-700' : 'sm:ml-auto px-2.5 py-1 rounded-full text-xs bg-amber-50 text-amber-700'}>{hasIcp ? 'ICP existant détecté' : 'ICP incomplet'}</span>
          </div>
        )}
      </section>

      {error && <div role="alert" className="mb-4 p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">{error}</div>}
      {notice && <div role="status" className="mb-4 p-4 bg-green-50 border border-green-200 rounded-xl text-sm text-green-800">{notice}</div>}

      {!selectedStrategy ? (
        <EmptyState title="Aucune stratégie enregistrée" message="Créez d’abord une stratégie marketing : ce module ne génère pas un nouvel ICP." action={() => navigate('/strategy')} />
      ) : !hasIcp ? (
        <EmptyState title="L’ICP existant est incomplet" message="La stratégie sélectionnée ne contient pas encore les critères de segment et de persona nécessaires à la recherche Clay." action={() => navigate('/dashboard/icp')} />
      ) : (
        <>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
            <div><h2 className="text-lg font-bold text-gray-900">Comptes et contacts</h2><p className="text-sm text-gray-500">Les champs stratégiques sont lus depuis la stratégie sélectionnée, pas recopiés dans chaque compte.</p></div>
            <div className="relative"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Rechercher un contact, poste, entreprise…" className="w-full sm:w-72 pl-9 pr-3 py-2.5 bg-white border border-gray-200 rounded-xl text-sm" /></div>
          </div>
          {visibleAccounts.length === 0 ? (
            <div className="bg-white border border-dashed border-gray-300 rounded-2xl py-16 px-5 text-center"><Users size={34} className="mx-auto text-gray-300 mb-3" /><h3 className="font-semibold text-gray-800">Aucun compte synchronisé pour cette stratégie</h3><p className="text-sm text-gray-500 mt-2">Lancez une recherche Clay. Les comptes seront enregistrés avec un identifiant stable et pourront être actualisés sans créer de doublons.</p></div>
          ) : (
            <div className="space-y-3">
              {visibleAccounts.map(account => {
                const lead = account.clay_data;
                const context = deriveContext(selectedStrategy, lead);
                const expanded = expandedId === account.id;
                const name = lead.name || [lead.first_name, lead.last_name].filter(Boolean).join(' ') || 'Contact sans nom';
                const currentExperience = context.experience.find(item => !item.end_date) ?? context.experience[0];
                const company = currentExperience?.company || 'Entreprise à vérifier';
                const title = currentExperience?.title || 'Fonction à vérifier';
                return (
                  <article key={account.id} className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
                    <div className="w-full px-4 sm:px-5 py-4 flex items-center gap-3 hover:bg-gray-50">
                      <button onClick={() => setExpandedId(expanded ? null : account.id)} className="flex items-center gap-3 flex-1 min-w-0 text-left">
                        <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center text-gray-600"><Users size={18} /></div>
                        <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold text-gray-900">{name}</h3><span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">{company}</span></div><p className="text-sm text-gray-500 truncate">{title} · {context.location || 'Localisation non renseignée'}</p><p className="text-xs text-gray-400 mt-1">Synchronisé le {new Date(account.last_synced_at).toLocaleString('fr-FR')}</p></div>
                      </button>
                      {lead.linkedin_url && <a href={lead.linkedin_url} target="_blank" rel="noreferrer" className="p-2 text-gray-400 hover:text-blue-600" aria-label="Ouvrir le profil LinkedIn"><ExternalLink size={16} /></a>}
                      <span className="text-xs text-amber-700 bg-amber-50 rounded-full px-2.5 py-1 whitespace-nowrap">{context.missing.length} donnée(s) manquante(s)</span>
                    </div>
                    {expanded && <div className="border-t border-gray-100 p-4 sm:p-5 grid grid-cols-1 lg:grid-cols-2 gap-4">
                      <ContextSection title="Segment et critères ICP" items={[context.segment, ...context.criteria]} />
                      <ContextSection title="Problèmes potentiels" items={context.painPoints} empty="Aucun problème documenté dans l’ICP existant." />
                      <ContextSection title="Offres correspondantes" items={context.offers} empty="Aucune offre explicite trouvée dans la stratégie." />
                      <ContextSection title="Preuves disponibles" items={context.proofs} empty="Aucune preuve documentée : ne pas la présenter comme acquise." />
                      <div className="lg:col-span-2 rounded-xl bg-amber-50 border border-amber-100 p-4"><h4 className="text-sm font-semibold text-amber-900 mb-2">Informations à vérifier / compléter</h4>{context.missing.length ? <ul className="list-disc pl-5 space-y-1 text-sm text-amber-900">{context.missing.map(item => <li key={item}>{item}</li>)}</ul> : <p className="text-sm text-amber-900">Les champs essentiels identifiés sont présents. Vérifiez tout de même la fraîcheur des données avant contact.</p>}</div>
                    </div>}
                  </article>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Metric({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return <div className="bg-white border border-gray-200 rounded-2xl p-4 flex items-center gap-3"><div className="p-2.5 rounded-xl bg-blue-50 text-blue-600">{icon}</div><div><p className="text-xs text-gray-500">{label}</p><p className="text-xl font-bold text-gray-900">{value}</p></div></div>;
}
function ContextSection({ title, items, empty = 'Information non disponible dans la stratégie.' }: { title: string; items: string[]; empty?: string }) {
  return <section className="border border-gray-200 rounded-xl p-4"><h4 className="text-sm font-semibold text-gray-800 mb-2">{title}</h4>{items.length ? <ul className="space-y-1.5">{items.map((item, index) => <li key={index} className="text-sm text-gray-600 flex gap-2"><CheckCircle2 size={15} className="text-green-600 flex-shrink-0 mt-0.5" /><span>{item}</span></li>)}</ul> : <p className="text-sm text-gray-400">{empty}</p>}</section>;
}
function EmptyState({ title, message, action }: { title: string; message: string; action: () => void }) {
  return <div className="bg-white border border-gray-200 rounded-2xl p-10 text-center"><h2 className="text-lg font-semibold text-gray-900">{title}</h2><p className="text-sm text-gray-500 mt-2 mb-5">{message}</p><button onClick={action} className="px-4 py-2.5 rounded-xl bg-blue-600 text-white font-semibold text-sm">Ouvrir les stratégies</button></div>;
}
