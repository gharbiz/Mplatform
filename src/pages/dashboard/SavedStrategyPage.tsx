import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Download, Share2, Trash2, Globe, Calendar } from 'lucide-react';
import jsPDF from 'jspdf';
import { supabase } from '../../lib/supabase';
import { useLanguage } from '../../lib/i18n';

interface IcpDescription {
  overview: string;
  offer: string;
  howItWorks: string;
  capabilities: string[];
  benefits: string[];
  differentiation: string[];
}

interface IcpNeed {
  title: string;
  fulfillment: string;
}

interface IcpProblem {
  title: string;
  context: string;
}

interface Strategy {
  icp: {
    description: IcpDescription;
    needs: IcpNeed[];
    problems: IcpProblem[];
    demographics: string;
    psychographics: string;
    painPoints: string[];
    goals: string[];
  };
  channels: {
    primary: string[];
    secondary: string[];
  };
  tactics: (string | { tactic: string; anchor?: string })[];
  // v2.4: kpis replaced by prospectingKit. Kept optional so strategies saved before this
  // change still render (falls back to a simple KPI list further down).
  kpis?: (string | { metric: string; anchor?: string })[];
  prospectingKit?: {
    prospectJobTitle: string;
    prospectJobTitleRationale: string;
    callValueProposition: string;
    callValuePropositionAnchor?: string;
    emailIcebreakerSubject: string;
    emailIcebreakerOpening: string;
    emailIcebreakerAnchor?: string;
  };
  timeline: string;
}

function itemText(item: string | { tactic?: string; metric?: string; anchor?: string }): string {
  return typeof item === 'string' ? item : (item.tactic ?? item.metric ?? '');
}

function isKitEstimate(anchor?: string): boolean {
  return anchor?.trim().toLowerCase() === 'estimate';
}

function isEstimate(item: string | { anchor?: string }): boolean {
  return typeof item !== 'string' && item.anchor?.trim().toLowerCase() === 'estimate';
}

interface SavedStrategyRow {
  id: string;
  business_name: string;
  website: string;
  strategy_data: Strategy;
  created_at: string;
  business_id: string | null;
}

export function SavedStrategyPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useLanguage();
  const [row, setRow] = useState<SavedStrategyRow | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const copyToClipboard = (field: string, text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    });
  };

  useEffect(() => {
    if (!id) return;
    supabase
      .from('marketing_strategies')
      .select('*')
      .eq('id', id)
      .maybeSingle()
      .then(({ data, error: err }) => {
        if (err || !data) {
          setError('Strategy not found.');
          setIsLoading(false);
          return;
        }
        setRow(data as SavedStrategyRow);
        setIsLoading(false);
      });
  }, [id]);

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

  const handleDelete = async () => {
    if (!row) return;
    if (!confirm('Delete this strategy?')) return;
    await supabase.from('marketing_strategies').delete().eq('id', row.id);
    navigate('/dashboard/strategies');
  };

  const generatePDF = () => {
    if (!row) return;
    const strategy = row.strategy_data;
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 20;
    const contentWidth = pageWidth - margin * 2;
    let y = 20;

    const addText = (text: string, x: number, fontSize: number, style: string, color: [number, number, number]) => {
      doc.setFontSize(fontSize);
      doc.setFont('helvetica', style as 'normal' | 'bold' | 'italic');
      doc.setTextColor(...color);
      const lines = doc.splitTextToSize(text, contentWidth - (x - margin));
      if (y + lines.length * fontSize * 0.5 > 270) { doc.addPage(); y = 20; }
      doc.text(lines, x, y);
      y += lines.length * fontSize * 0.45 + 2;
    };

    const addSectionTitle = (title: string) => {
      if (y > 240) { doc.addPage(); y = 20; }
      y += 4;
      doc.setFillColor(37, 99, 235);
      doc.rect(margin, y - 5, contentWidth, 0.8, 'F');
      y += 4;
      addText(title, margin, 14, 'bold', [17, 24, 39]);
      y += 2;
    };

    doc.setFillColor(37, 99, 235);
    doc.rect(0, 0, pageWidth, 40, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(22);
    doc.setFont('helvetica', 'bold');
    doc.text('Marketing Strategy', margin, 18);
    doc.setFontSize(11);
    doc.setFont('helvetica', 'normal');
    doc.text(`for ${row.business_name}`, margin, 26);
    y = 52;

    if (strategy.icp?.description) {
      const desc = strategy.icp.description;
      addSectionTitle('Description');
      if (desc.overview) { addText('Description of my business', margin, 11, 'bold', [55, 65, 81]); addText(desc.overview, margin + 4, 10, 'normal', [75, 85, 99]); }
      if (desc.offer) { addText('What exactly does my business offer?', margin, 11, 'bold', [55, 65, 81]); addText(desc.offer, margin + 4, 10, 'normal', [75, 85, 99]); }
      if (desc.howItWorks) { addText('How it works?', margin, 11, 'bold', [55, 65, 81]); addText(desc.howItWorks, margin + 4, 10, 'normal', [75, 85, 99]); }
      if (desc.capabilities?.length) { addText('Key capabilities', margin, 11, 'bold', [55, 65, 81]); desc.capabilities.forEach(c => addText(`  •  ${c}`, margin + 2, 10, 'normal', [75, 85, 99])); }
      if (desc.benefits?.length) { addText('Key benefits', margin, 11, 'bold', [55, 65, 81]); desc.benefits.forEach(b => addText(`  +  ${b}`, margin + 2, 10, 'normal', [22, 163, 74])); }
      if (desc.differentiation?.length) { addText('How we stand out', margin, 11, 'bold', [55, 65, 81]); desc.differentiation.forEach(d => addText(`  ★  ${d}`, margin + 2, 10, 'normal', [109, 40, 217])); }
    }

    if (strategy.icp?.needs?.length) {
      addSectionTitle('Needs your product potentially satisfies');
      strategy.icp.needs.forEach((need, idx) => {
        addText(`${idx + 1}) ${need.title}`, margin, 11, 'bold', [22, 163, 74]);
        addText(`How we fulfil this need: ${need.fulfillment}`, margin + 4, 10, 'normal', [75, 85, 99]);
      });
    }

    if (strategy.icp?.problems?.length) {
      addSectionTitle('Problems your product potentially solves');
      strategy.icp.problems.forEach((problem, idx) => {
        addText(`${idx + 1}) ${problem.title}`, margin, 11, 'bold', [234, 88, 12]);
        addText(`Context: ${problem.context}`, margin + 4, 10, 'normal', [75, 85, 99]);
      });
    }

    addSectionTitle('Ideal Customer Profile');
    addText('Demographics', margin, 11, 'bold', [55, 65, 81]);
    addText(strategy.icp?.demographics ?? '', margin + 4, 10, 'normal', [75, 85, 99]);
    addText('Psychographics', margin, 11, 'bold', [55, 65, 81]);
    addText(strategy.icp?.psychographics ?? '', margin + 4, 10, 'normal', [75, 85, 99]);
    if (strategy.icp?.painPoints?.length) {
      addText('Pain Points', margin, 11, 'bold', [55, 65, 81]);
      strategy.icp.painPoints.forEach(p => addText(`  -  ${p}`, margin + 2, 10, 'normal', [75, 85, 99]));
    }
    if (strategy.icp?.goals?.length) {
      addText('Goals & Objectives', margin, 11, 'bold', [55, 65, 81]);
      strategy.icp.goals.forEach(g => addText(`  +  ${g}`, margin + 2, 10, 'normal', [75, 85, 99]));
    }

    addSectionTitle('Marketing Channels');
    addText('Primary Channels', margin, 11, 'bold', [55, 65, 81]);
    addText(strategy.channels?.primary?.join('  |  ') ?? '', margin + 4, 10, 'normal', [37, 99, 235]);
    addText('Secondary Channels', margin, 11, 'bold', [55, 65, 81]);
    addText(strategy.channels?.secondary?.join('  |  ') ?? '', margin + 4, 10, 'normal', [75, 85, 99]);

    addSectionTitle('Marketing Tactics');
    strategy.tactics?.forEach((t, idx) => addText(`${idx + 1}. ${itemText(t)}`, margin + 2, 10, 'normal', [55, 65, 81]));

    if (strategy.prospectingKit) {
      addSectionTitle('Kit de prospection');
      addText('Interlocuteur à cibler', margin, 11, 'bold', [55, 65, 81]);
      addText(strategy.prospectingKit.prospectJobTitle, margin + 2, 10, 'normal', [75, 85, 99]);
      addText(strategy.prospectingKit.prospectJobTitleRationale, margin + 2, 9, 'normal', [107, 114, 128]);
      addText('Script téléphonique — proposition de valeur', margin, 11, 'bold', [55, 65, 81]);
      addText(strategy.prospectingKit.callValueProposition, margin + 2, 10, 'normal', [75, 85, 99]);
      addText('E-mail ice breaker', margin, 11, 'bold', [55, 65, 81]);
      addText(`Objet : ${strategy.prospectingKit.emailIcebreakerSubject}`, margin + 2, 10, 'bold', [75, 85, 99]);
      addText(strategy.prospectingKit.emailIcebreakerOpening, margin + 2, 10, 'normal', [75, 85, 99]);
    } else if (strategy.kpis && strategy.kpis.length > 0) {
      addSectionTitle('Key Performance Indicators');
      strategy.kpis.forEach(kpi => addText(`  -  ${itemText(kpi)}${isEstimate(kpi) ? '  (estimate)' : ''}`, margin + 2, 10, 'normal', [75, 85, 99]));
    }

    addSectionTitle('Timeline');
    addText(strategy.timeline ?? '', margin + 4, 10, 'normal', [37, 99, 235]);

    doc.save(`${row.business_name.replace(/\s+/g, '_')}_Marketing_Strategy.pdf`);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[500px]">
        <div className="w-12 h-12 border-3 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !row) {
    return (
      <div className="p-8">
        <button onClick={() => navigate('/dashboard/strategies')} className="flex items-center gap-2 text-gray-600 hover:text-blue-600 transition-colors font-medium mb-8">
          <ArrowLeft size={20} /> Back to strategies
        </button>
        <div className="flex flex-col items-center justify-center py-32 text-center">
          <p className="text-2xl font-bold text-gray-800 mb-2">{error ?? 'Strategy not found.'}</p>
          <p className="text-gray-400">The strategy may have been deleted.</p>
        </div>
      </div>
    );
  }

  const strategy = row.strategy_data;

  return (
    <div className="p-6 sm:p-8 max-w-screen-xl mx-auto">
      {/* Back + actions */}
      <div className="flex items-center justify-between mb-6">
        <button onClick={() => navigate('/dashboard/strategies')} className="flex items-center gap-2 text-gray-600 hover:text-blue-600 transition-colors font-medium">
          <ArrowLeft size={20} /> Back to strategies
        </button>
        <div className="flex gap-2">
          <button onClick={() => navigate(`/dashboard/strategies/${id}/advanced`)} className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl transition-colors">
            {t('adv.open')} <ArrowRight size={16} />
          </button>
          <button onClick={handleDelete} className="p-2.5 bg-white border border-gray-200 hover:bg-red-50 rounded-xl transition-colors" title="Delete strategy">
            <Trash2 size={18} className="text-red-500" />
          </button>
          <button className="p-2.5 bg-white border border-gray-200 hover:bg-gray-50 rounded-xl transition-colors" title="Share strategy">
            <Share2 size={18} className="text-gray-600" />
          </button>
          <button
            onClick={generatePDF}
            disabled={isGeneratingPdf}
            className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-xl transition-colors font-medium text-sm"
          >
            {isGeneratingPdf ? (
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <Download size={18} />
            )}
            <span className="hidden sm:inline">{isGeneratingPdf ? 'Generating...' : 'Download PDF'}</span>
          </button>
        </div>
      </div>

      {/* Title */}
      <div className="bg-white rounded-2xl shadow-sm p-6 sm:p-8 mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Marketing Strategy for {row.business_name}</h1>
        <p className="text-gray-600 mt-2">AI-Generated Ideal Customer Profile &amp; Go-to-Market Plan</p>
        <div className="flex items-center gap-4 mt-3">
          {row.website && (
            <span className="flex items-center gap-1 text-sm text-gray-500">
              <Globe size={14} /> {row.website}
            </span>
          )}
          <span className="flex items-center gap-1 text-sm text-gray-500">
            <Calendar size={14} /> {formatDate(row.created_at)}
          </span>
        </div>
      </div>

      {/* Description */}
      {strategy.icp?.description && (
        <div className="bg-white rounded-2xl shadow-sm p-6 sm:p-8 mb-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center flex-shrink-0">
              <span className="text-blue-600 font-bold text-xs">DESC</span>
            </div>
            <h2 className="text-2xl font-bold text-gray-900">Description</h2>
          </div>
          <div className="space-y-6">
            {strategy.icp.description.overview && (
              <div>
                <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-1">Description of my business</h3>
                <p className="text-gray-700 leading-relaxed">{strategy.icp.description.overview}</p>
              </div>
            )}
            {strategy.icp.description.offer && (
              <div>
                <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-1">What exactly does my business offer?</h3>
                <p className="text-gray-700 leading-relaxed">{strategy.icp.description.offer}</p>
              </div>
            )}
            {strategy.icp.description.howItWorks && (
              <div>
                <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-1">How it works?</h3>
                <p className="text-gray-700 leading-relaxed">{strategy.icp.description.howItWorks}</p>
              </div>
            )}
            <div className="grid md:grid-cols-3 gap-6 pt-2">
              {strategy.icp.description.capabilities?.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Key capabilities</h3>
                  <ul className="space-y-2">
                    {strategy.icp.description.capabilities.map((item, i) => (
                      <li key={i} className="flex gap-2 text-sm text-gray-700">
                        <span className="text-blue-500 font-bold mt-0.5 flex-shrink-0">•</span>
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {strategy.icp.description.benefits?.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Key benefits</h3>
                  <ul className="space-y-2">
                    {strategy.icp.description.benefits.map((item, i) => (
                      <li key={i} className="flex gap-2 text-sm text-gray-700">
                        <span className="text-green-500 font-bold mt-0.5 flex-shrink-0">+</span>
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {strategy.icp.description.differentiation?.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">How we stand out</h3>
                  <ul className="space-y-2">
                    {strategy.icp.description.differentiation.map((item, i) => (
                      <li key={i} className="flex gap-2 text-sm text-gray-700">
                        <span className="text-blue-500 font-bold mt-0.5 flex-shrink-0">★</span>
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Needs */}
      {strategy.icp?.needs?.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm p-6 sm:p-8 mb-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl bg-green-100 flex items-center justify-center flex-shrink-0">
              <span className="text-green-600 font-bold text-xs">NEED</span>
            </div>
            <h2 className="text-2xl font-bold text-gray-900">Needs your product potentially satisfies</h2>
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            {strategy.icp.needs.map((need, idx) => (
              <div key={idx} className="p-4 bg-green-50 rounded-xl border border-green-100">
                <div className="flex items-start gap-3 mb-2">
                  <span className="w-6 h-6 rounded-full bg-green-500 text-white text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
                    {idx + 1}
                  </span>
                  <h3 className="font-semibold text-gray-900 text-sm">{need.title}</h3>
                </div>
                <p className="text-gray-600 text-sm leading-relaxed pl-9">
                  <span className="font-medium text-gray-700">How we fulfil this need: </span>
                  {need.fulfillment}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Problems */}
      {strategy.icp?.problems?.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm p-6 sm:p-8 mb-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl bg-orange-100 flex items-center justify-center flex-shrink-0">
              <span className="text-orange-600 font-bold text-xs">PROB</span>
            </div>
            <h2 className="text-2xl font-bold text-gray-900">Problems your product potentially solves</h2>
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            {strategy.icp.problems.map((problem, idx) => (
              <div key={idx} className="p-4 bg-orange-50 rounded-xl border border-orange-100">
                <div className="flex items-start gap-3 mb-2">
                  <span className="w-6 h-6 rounded-full bg-orange-500 text-white text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
                    {idx + 1}
                  </span>
                  <h3 className="font-semibold text-gray-900 text-sm">{problem.title}</h3>
                </div>
                <p className="text-gray-600 text-sm leading-relaxed pl-9">
                  <span className="font-medium text-gray-700">Context: </span>
                  {problem.context}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ICP + Channels */}
      <div className="grid lg:grid-cols-2 gap-6 mb-6">
        <div className="bg-white rounded-2xl shadow-sm p-6 sm:p-8">
          <h2 className="text-2xl font-bold text-gray-900 mb-6">Ideal Customer Profile</h2>
          <div className="space-y-6">
            <div>
              <h3 className="font-semibold text-gray-900 mb-2">Demographics</h3>
              <p className="text-gray-600 leading-relaxed">{strategy.icp?.demographics ?? '—'}</p>
            </div>
            <div>
              <h3 className="font-semibold text-gray-900 mb-2">Psychographics</h3>
              <p className="text-gray-600 leading-relaxed">{strategy.icp?.psychographics ?? '—'}</p>
            </div>
            {strategy.icp?.painPoints?.length > 0 && (
              <div>
                <h3 className="font-semibold text-gray-900 mb-3">Pain Points</h3>
                <ul className="space-y-2">
                  {strategy.icp.painPoints.map((point, idx) => (
                    <li key={idx} className="flex gap-3">
                      <span className="text-red-500 font-bold mt-1">-</span>
                      <span className="text-gray-600">{point}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {strategy.icp?.goals?.length > 0 && (
              <div>
                <h3 className="font-semibold text-gray-900 mb-3">Goals &amp; Objectives</h3>
                <ul className="space-y-2">
                  {strategy.icp.goals.map((goal, idx) => (
                    <li key={idx} className="flex gap-3">
                      <span className="text-green-500 font-bold mt-1">+</span>
                      <span className="text-gray-600">{goal}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-white rounded-2xl shadow-sm p-6 sm:p-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-6">Marketing Channels</h2>
            <div className="space-y-6">
              <div>
                <h3 className="font-semibold text-gray-900 mb-3">Primary Channels</h3>
                <div className="flex flex-wrap gap-2">
                  {strategy.channels?.primary?.map((channel, idx) => (
                    <span key={idx} className="px-4 py-2 bg-blue-100 text-blue-700 rounded-full text-sm font-medium">
                      {channel}
                    </span>
                  ))}
                </div>
              </div>
              <div>
                <h3 className="font-semibold text-gray-900 mb-3">Secondary Channels</h3>
                <div className="flex flex-wrap gap-2">
                  {strategy.channels?.secondary?.map((channel, idx) => (
                    <span key={idx} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-full text-sm font-medium">
                      {channel}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {strategy.timeline && (
            <div className="bg-white rounded-2xl shadow-sm p-6 sm:p-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">Timeline</h2>
              <p className="text-gray-600 leading-relaxed bg-blue-50 p-4 rounded-lg border-l-4 border-blue-600">
                {strategy.timeline}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Tactics */}
      {strategy.tactics?.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm p-6 sm:p-8 mb-6">
          <h2 className="text-2xl font-bold text-gray-900 mb-6">Marketing Tactics</h2>
          <div className="grid md:grid-cols-2 gap-4">
            {strategy.tactics.map((tactic, idx) => (
              <div key={idx} className="p-4 bg-gradient-to-br from-blue-50 to-gray-50 rounded-lg border border-blue-100">
                <div className="flex gap-3">
                  <span className="text-blue-600 font-bold text-lg flex-shrink-0">{idx + 1}</span>
                  <p className="text-gray-700">
                    {itemText(tactic)}
                    {isEstimate(tactic) && (
                      <span className="ml-2 text-xs font-medium text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full align-middle">estimation</span>
                    )}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Kit de prospection (v2.4, remplace les KPIs) */}
      {strategy.prospectingKit ? (
        <div className="bg-white rounded-2xl shadow-sm p-6 sm:p-8 mb-6">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Kit de prospection</h2>
          <p className="text-sm text-gray-500 mb-6">Prêt à utiliser pour un premier appel ou un premier e-mail à froid.</p>

          <div className="mb-6">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Interlocuteur à cibler en premier</p>
            <p className="text-lg font-bold text-gray-900">{strategy.prospectingKit.prospectJobTitle}</p>
            <p className="text-sm text-gray-600 mt-1">{strategy.prospectingKit.prospectJobTitleRationale}</p>
          </div>

          <div className="mb-6 p-5 bg-gradient-to-br from-blue-50 to-gray-50 rounded-lg border border-blue-100">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide">Proposition de valeur — script téléphonique</p>
              <button
                onClick={() => copyToClipboard('call', strategy.prospectingKit!.callValueProposition)}
                className="text-xs font-medium text-blue-600 hover:text-blue-800"
              >
                {copiedField === 'call' ? 'Copié ✓' : 'Copier'}
              </button>
            </div>
            <p className="text-gray-800 leading-relaxed">
              {strategy.prospectingKit.callValueProposition}
              {isKitEstimate(strategy.prospectingKit.callValuePropositionAnchor) && (
                <span className="ml-2 text-xs font-medium text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full align-middle">estimation</span>
              )}
            </p>
          </div>

          <div className="p-5 bg-gradient-to-br from-green-50 to-gray-50 rounded-lg border border-green-100">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-green-700 uppercase tracking-wide">E-mail ice breaker</p>
              <button
                onClick={() => copyToClipboard('email', `${strategy.prospectingKit!.emailIcebreakerSubject}\n\n${strategy.prospectingKit!.emailIcebreakerOpening}`)}
                className="text-xs font-medium text-green-700 hover:text-green-900"
              >
                {copiedField === 'email' ? 'Copié ✓' : 'Copier'}
              </button>
            </div>
            <p className="text-sm font-semibold text-gray-900 mb-1">Objet : {strategy.prospectingKit.emailIcebreakerSubject}</p>
            <p className="text-gray-800 leading-relaxed">
              {strategy.prospectingKit.emailIcebreakerOpening}
              {isKitEstimate(strategy.prospectingKit.emailIcebreakerAnchor) && (
                <span className="ml-2 text-xs font-medium text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full align-middle">estimation</span>
              )}
            </p>
          </div>
        </div>
      ) : strategy.kpis && strategy.kpis.length > 0 ? (
        <div className="bg-white rounded-2xl shadow-sm p-6 sm:p-8 mb-6">
          <h2 className="text-2xl font-bold text-gray-900 mb-6">Key Performance Indicators</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {strategy.kpis.map((kpi, idx) => (
              <div key={idx} className="p-4 bg-gradient-to-br from-green-50 to-gray-50 rounded-lg border border-green-100">
                <p className="text-gray-700 text-sm">
                  {itemText(kpi)}
                  {isEstimate(kpi) && (
                    <span className="ml-2 text-xs font-medium text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full align-middle">estimation</span>
                  )}
                </p>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
