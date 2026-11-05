import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Pencil, Trash2, Globe, X, Building2, Lightbulb } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useLanguage } from '../../lib/i18n';

interface Business {
  id: string;
  name: string;
  website: string;
  business_model: string;
  geographic_market: string;
  created_at: string;
}

const MODELS = ['B2B', 'B2C', 'B2B2C'];
const MARKETS = [
  'France', 'United States', 'United Kingdom', 'Germany', 'Spain', 'Italy',
  'Canada', 'Australia', 'Belgium', 'Switzerland', 'Netherlands', 'Other',
];

export function MyBusinessesPage() {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editTarget, setEditTarget] = useState<Business | null>(null);
  const [form, setForm] = useState({ name: '', website: '', business_model: '', geographic_market: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const fetchBusinesses = async () => {
    const { data } = await supabase.from('businesses').select('*').order('created_at', { ascending: false });
    setBusinesses(data ?? []);
    setIsLoading(false);
  };

  useEffect(() => { fetchBusinesses(); }, []);

  const openEdit = (b: Business) => {
    setEditTarget(b);
    setForm({ name: b.name, website: b.website, business_model: b.business_model, geographic_market: b.geographic_market });
    setError('');
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!editTarget) return;
    if (!form.name.trim() || !form.website.trim()) { setError(t('biz.nameWebsiteRequired')); return; }
    setSaving(true);
    setError('');
    await supabase.from('businesses').update(form).eq('id', editTarget.id);
    setSaving(false);
    setShowModal(false);
    fetchBusinesses();
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t('biz.deleteConfirm'))) return;
    await supabase.from('businesses').delete().eq('id', id);
    fetchBusinesses();
  };

  const openStrategy = async (b: Business) => {
    const { data } = await supabase
      .from('marketing_strategies')
      .select('id')
      .eq('business_id', b.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) {
      navigate(`/dashboard/strategies/${data.id}`);
    } else {
      navigate('/strategy');
    }
  };

  const favicon = (website: string) => {
    const domain = website.replace(/^https?:\/\//, '').split('/')[0];
    return `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
  };

  return (
    <div className="p-5 sm:p-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6 sm:mb-8">
        <h1 className="text-2xl font-bold text-gray-900">{t('biz.title')}</h1>
        <button onClick={() => navigate('/strategy')} className="flex items-center gap-2 px-4 py-2.5 bg-green-500 hover:bg-green-600 text-white text-sm font-semibold rounded-xl transition-colors">
          <Plus size={18} />
          {t('biz.addNew')}
        </button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-20">
          <div className="w-8 h-8 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
        </div>
      ) : businesses.length === 0 ? (
        <div className="text-center py-24 text-gray-400">
          <Building2 size={48} className="mx-auto mb-4 opacity-30" />
          <p className="font-medium">{t('biz.none')}</p>
          <p className="text-sm mt-1">{t('biz.noneHint')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
          {businesses.map(b => (
            <div key={b.id} className="bg-white rounded-2xl border border-gray-200 overflow-hidden hover:shadow-md transition-shadow group relative">
              <div className="h-32 bg-gradient-to-br from-slate-50 to-blue-50 flex items-center justify-center">
                <img src={favicon(b.website)} alt="" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} className="w-10 h-10 rounded-lg" />
              </div>
              <div className="p-3">
                <p className="font-semibold text-gray-900 text-sm truncate">{b.name}</p>
                <div className="flex items-center gap-1 mt-0.5">
                  <Globe size={12} className="text-gray-400 flex-shrink-0" />
                  <p className="text-xs text-gray-400 truncate">{b.website.replace(/^https?:\/\//, '')}</p>
                </div>
                {b.business_model && (
                  <span className="inline-block mt-1.5 px-2 py-0.5 bg-blue-50 text-blue-600 text-xs rounded-full font-medium">{b.business_model}</span>
                )}
              </div>
              <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button onClick={() => openStrategy(b)} className="p-1.5 bg-white rounded-lg shadow border border-gray-100 hover:bg-blue-50 transition-colors" title={t('common.share')}>
                  <Lightbulb size={14} className="text-blue-500" />
                </button>
                <button onClick={() => openEdit(b)} className="p-1.5 bg-white rounded-lg shadow border border-gray-100 hover:bg-gray-50 transition-colors">
                  <Pencil size={14} className="text-gray-600" />
                </button>
                <button onClick={() => handleDelete(b.id)} className="p-1.5 bg-white rounded-lg shadow border border-gray-100 hover:bg-red-50 transition-colors">
                  <Trash2 size={14} className="text-red-500" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-bold text-gray-900">{t('biz.edit')}</h2>
              <button onClick={() => setShowModal(false)} className="p-1 hover:bg-gray-100 rounded-lg transition-colors">
                <X size={20} className="text-gray-500" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('biz.name')}</label>
                <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="Algos AI" className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('biz.website')}</label>
                <input value={form.website} onChange={e => setForm(p => ({ ...p, website: e.target.value }))} placeholder="algos-ai.com" className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('biz.model')}</label>
                  <select value={form.business_model} onChange={e => setForm(p => ({ ...p, business_model: e.target.value }))} className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <option value="">{t('biz.select')}</option>
                    {MODELS.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('biz.market')}</label>
                  <select value={form.geographic_market} onChange={e => setForm(p => ({ ...p, geographic_market: e.target.value }))} className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <option value="">{t('biz.select')}</option>
                    {MARKETS.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
              </div>
              {error && <p className="text-red-500 text-sm">{error}</p>}
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowModal(false)} className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">{t('biz.cancel')}</button>
              <button onClick={handleSave} disabled={saving} className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-xl text-sm font-semibold transition-colors">
                {saving ? t('biz.saving') : t('biz.saveChanges')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
