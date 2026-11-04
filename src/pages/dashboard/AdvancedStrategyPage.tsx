import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, ChevronDown, RefreshCw, Sparkles } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useLanguage } from '../../lib/i18n';

const MODULE_KEYS = [
  'diagnosis',
  'icpPrioritization',
  'positioning',
  'acquisition',
  'conversion',
  'campaigns',
  'content',
  'budget',
  'kpis',
  'roadmap',
] as const;

type ModuleKey = typeof MODULE_KEYS[number];
type Confidence = 'verified' | 'estimate' | 'assumption';

interface StrategyItem {
  label: string;
  detail: string;
  confidence: Confidence;
  evidence: string;
  nextAction: string;
  score?: number;
}

interface StrategyModule {
  summary: string;
  items: StrategyItem[];
  missingInformation: string[];
}

type StrategyContent = Record<ModuleKey, StrategyModule>;

interface StrategyRow {
  id: string;
  business_id: string | null;
  business_name: string;
  website: string;
  strategy_data: Record<string, unknown>;
  icp_insights: Record<string, unknown> | null;
}

interface StrategyVersion {
  id: string;
  version_number: number;
  language: string;
  content: StrategyContent;
  created_at: string;
}

const CONFIDENCE_STYLES: Record<Confidence, string> = {
  verified: 'bg-green-100 text-green-700',
  estimate: 'bg-amber-50 text-amber-700',
  assumption: 'bg-gray-100 text-gray-700',
};

function isStrategyContent(data: unknown): data is StrategyContent {
  if (!data || typeof data !== 'object') return false;
  const record = data as Record<string, unknown>;
  return MODULE_KEYS.every(key => {
    const module = record[key] as Partial<StrategyModule> | undefined;
    return !!module && typeof module.summary === 'string' && Array.isArray(module.items) && Array.isArray(module.missingInformation);
  });
}

export function AdvancedStrategyPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t, lang } = useLanguage();
  const [strategy, setStrategy] = useState<StrategyRow | null>(null);
  const [versions, setVersions] = useState<StrategyVersion[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [openModule, setOpenModule] = useState<ModuleKey | null>('diagnosis');
  const [isLoading, setIsLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!id) return;
    const load = async () => {
      setIsLoading(true);
      setError('');
      const [strategyResult, versionsResult] = await Promise.all([
        supabase
          .from('marketing_strategies')
          .select('id, business_id, business_name, website, strategy_data, icp_insights')
          .eq('id', id)
          .maybeSingle(),
        supabase
          .from('marketing_strategy_versions')
          .select('id, version_number, language, content, created_at')
          .eq('strategy_id', id)
          .order('version_number', { ascending: false }),
      ]);
      if (strategyResult.error || versionsResult.error) {
        setError('adv.loadError');
      } else {
        setStrategy(strategyResult.data as StrategyRow | null);
        const rows = ((versionsResult.data ?? []) as StrategyVersion[]).filter(row => isStrategyContent(row.content));
        setVersions(rows);
        setSelectedVersionId(rows[0]?.id ?? null);
      }
      setIsLoading(false);
    };
    load();
  }, [id]);

  const selectedVersion = versions.find(version => version.id === selectedVersionId) ?? versions[0] ?? null;

  const generateVersion = async () => {
    if (!strategy) return;
    setIsGenerating(true);
    setError('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('session');

      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-content`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          mode: 'marketing_strategy',
          strategy: strategy.strategy_data,
          icpInsights: strategy.icp_insights,
          language: lang,
        }),
      });
      const result = await response.json();
      if (!response.ok || !isStrategyContent(result)) throw new Error('invalid');

      const content = Object.fromEntries(MODULE_KEYS.map(key => [key, result[key]])) as StrategyContent;
      const { data: saved, error: saveError } = await supabase
        .from('marketing_strategy_versions')
        .insert({
          strategy_id: strategy.id,
          business_id: strategy.business_id,
          version_number: (versions[0]?.version_number ?? 0) + 1,
          language: lang,
          content,
        })
        .select('id, version_number, language, content, created_at')
        .maybeSingle();
      if (saveError || !saved) {
        setError('adv.saveError');
        return;
      }

      const newVersion = saved as StrategyVersion;
      setVersions(previous => [newVersion, ...previous]);
      setSelectedVersionId(newVersion.id);
      setOpenModule('diagnosis');
    } catch {
      setError('adv.error');
    } finally {
      setIsGenerating(false);
    }
  };

  if (isLoading) {
    return <div className="flex justify-center py-32"><div className="w-8 h-8 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin" /></div>;
  }

  if (!strategy) {
    return (
      <div className="p-6 sm:p-8 max-w-3xl mx-auto">
        <p className="text-red-600 text-sm">{t('adv.loadError')}</p>
      </div>
    );
  }

  return (
    <div className="p-6 sm:p-8 max-w-screen-xl mx-auto">
      <button onClick={() => navigate(`/dashboard/strategies/${strategy.id}`)} className="flex items-center gap-2 text-gray-600 hover:text-blue-600 transition-colors font-medium mb-6">
        <ArrowLeft size={20} /> {t('adv.back')}
      </button>

      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">{t('adv.title')}</h1>
          <p className="text-sm text-gray-500 mt-1">{strategy.business_name} · {t('adv.subtitle')}</p>
        </div>
        <button
          onClick={generateVersion}
          disabled={isGenerating}
          className="flex items-center justify-center gap-2 px-5 py-3 bg-green-500 hover:bg-green-600 disabled:bg-green-300 text-white text-sm font-semibold rounded-xl transition-colors whitespace-nowrap"
        >
          {isGenerating ? <RefreshCw size={16} className="animate-spin" /> : <Sparkles size={16} />}
          {isGenerating ? t('adv.generating') : t('adv.generate')}
        </button>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-100 text-red-600 rounded-xl text-sm">{t(error)}</div>
      )}

      {!selectedVersion ? (
        <div className="py-16 text-center bg-white rounded-2xl border border-gray-200">
          <Sparkles size={32} className="text-gray-300 mx-auto mb-3" />
          <p className="text-sm text-gray-500">{t('adv.empty')}</p>
        </div>
      ) : (
        <div className="grid lg:grid-cols-[220px_1fr] gap-6">
          <div className="space-y-2">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">{t('adv.versions')}</p>
            {versions.map(version => (
              <button
                key={version.id}
                onClick={() => setSelectedVersionId(version.id)}
                className={`w-full text-left px-4 py-3 rounded-xl border transition-colors ${version.id === selectedVersion.id ? 'bg-blue-50 border-blue-200' : 'bg-white border-gray-200 hover:bg-gray-50'}`}
              >
                <p className="text-sm font-semibold text-gray-900">{t('adv.version', { n: version.version_number })}</p>
                <p className="text-xs text-gray-400 mt-0.5">{new Date(version.created_at).toLocaleDateString(lang === 'fr' ? 'fr-FR' : 'en-GB')}</p>
              </button>
            ))}
          </div>

          <div className="space-y-3">
            {MODULE_KEYS.map(key => (
              <ModuleCard
                key={key}
                title={t(`adv.modules.${key}`)}
                module={selectedVersion.content[key]}
                isOpen={openModule === key}
                onToggle={() => setOpenModule(openModule === key ? null : key)}
                labels={{
                  missing: t('adv.missing'),
                  nextAction: t('adv.nextAction'),
                  evidence: t('adv.evidence'),
                  score: t('adv.score'),
                  confidence: {
                    verified: t('adv.confidence.verified'),
                    estimate: t('adv.confidence.estimate'),
                    assumption: t('adv.confidence.assumption'),
                  },
                }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

interface ModuleLabels {
  missing: string;
  nextAction: string;
  evidence: string;
  score: string;
  confidence: Record<Confidence, string>;
}

function ModuleCard({ title, module, isOpen, onToggle, labels }: {
  title: string;
  module: StrategyModule;
  isOpen: boolean;
  onToggle: () => void;
  labels: ModuleLabels;
}) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
      <button onClick={onToggle} className="w-full flex items-start gap-4 p-5 text-left hover:bg-gray-50 transition-colors">
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-gray-900">{title}</p>
          {!isOpen && <p className="text-sm text-gray-500 mt-1 line-clamp-2">{module.summary}</p>}
        </div>
        <ChevronDown size={18} className={`text-gray-400 mt-1 flex-shrink-0 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="px-5 pb-6 space-y-4 border-t border-gray-100 pt-5">
          <p className="text-sm text-gray-700 leading-relaxed">{module.summary}</p>

          <div className="space-y-3">
            {module.items.map((item, index) => (
              <div key={index} className="p-4 bg-gray-50 rounded-xl">
                <div className="flex flex-wrap items-center gap-2 mb-1.5">
                  <p className="font-semibold text-sm text-gray-900">{item.label}</p>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${CONFIDENCE_STYLES[item.confidence] ?? CONFIDENCE_STYLES.assumption}`}>
                    {labels.confidence[item.confidence] ?? item.confidence}
                  </span>
                </div>
                {typeof item.score === 'number' && (
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs text-gray-500">{labels.score}</span>
                    <div className="flex-1 max-w-[160px] h-1.5 bg-gray-200 rounded-full overflow-hidden">
                      <div className="h-full bg-blue-600 rounded-full" style={{ width: `${Math.min(Math.max(item.score, 0), 10) * 10}%` }} />
                    </div>
                    <span className="text-xs font-semibold text-gray-700">{item.score}/10</span>
                  </div>
                )}
                <p className="text-sm text-gray-700 leading-relaxed">{item.detail}</p>
                {item.evidence && item.evidence !== 'none' && (
                  <p className="text-xs text-gray-500 mt-2"><span className="font-semibold">{labels.evidence}:</span> {item.evidence}</p>
                )}
                {item.nextAction && (
                  <p className="text-xs text-blue-700 mt-1.5"><span className="font-semibold">{labels.nextAction}:</span> {item.nextAction}</p>
                )}
              </div>
            ))}
          </div>

          {module.missingInformation.length > 0 && (
            <div className="p-4 bg-amber-50 border border-amber-100 rounded-xl">
              <p className="flex items-center gap-2 text-sm font-semibold text-amber-800 mb-2">
                <AlertTriangle size={15} /> {labels.missing}
              </p>
              <ul className="space-y-1">
                {module.missingInformation.map((info, index) => (
                  <li key={index} className="text-sm text-amber-900">• {info}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
