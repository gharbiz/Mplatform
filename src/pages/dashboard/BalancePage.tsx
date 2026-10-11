import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Wallet, TrendingUp, Clock, CheckCircle2, ArrowRight, Sparkles } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useLanguage } from '../../lib/i18n';

interface CreditData {
  credits: number;
  plan: string;
  renewal_date: string;
  used_this_month: number;
}

interface Transaction {
  id: string;
  type: string;
  credits: number;
  amount_cents: number | null;
  pack: string | null;
  description: string | null;
  status: string;
  created_at: string;
}

const PACKS = [
  { id: '200', credits: 200, price: 80, basePrice: 80, pricePerCredit: 0.40, discount: 0, name: 'Starter', badge: 'balance.popular' },
  { id: '500', credits: 500, price: 175, basePrice: 200, pricePerCredit: 0.35, discount: 12.5, name: 'Pro', badge: 'balance.bestValue' },
  { id: '1000', credits: 1000, price: 300, basePrice: 400, pricePerCredit: 0.30, discount: 25, name: 'Enterprise', badge: 'balance.maxSave' },
];

export function BalancePage() {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const [creditData, setCreditData] = useState<CreditData | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPack, setSelectedPack] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { navigate('/signin'); return; }

    const [creditsRes, txRes] = await Promise.all([
      supabase.from('user_credits').select('credits, plan, renewal_date, used_this_month').eq('user_id', session.user.id).maybeSingle(),
      supabase.from('credit_transactions').select('id, type, credits, amount_cents, pack, description, status, created_at').eq('user_id', session.user.id).order('created_at', { ascending: false }).limit(20),
    ]);

    if (creditsRes.data) {
      setCreditData(creditsRes.data as CreditData);
    } else {
      setCreditData({ credits: 200, plan: 'starter', renewal_date: '', used_this_month: 0 });
    }
    setTransactions((txRes.data as Transaction[]) || []);
    setLoading(false);
  }, [navigate]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const selectedPackData = PACKS.find(p => p.id === selectedPack);
  const planCredits = creditData ? creditData.credits + creditData.used_this_month : 200;
  const usedPercent = creditData && planCredits > 0 ? Math.min(100, (creditData.used_this_month / planCredits) * 100) : 0;
  const renewalDate = creditData?.renewal_date
    ? new Date(creditData.renewal_date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
    : '';

  const handleSelectPack = (packId: string) => {
    setSelectedPack(packId);
  };

  const handleContinue = () => {
    if (!selectedPack) return;
    const pack = PACKS.find(p => p.id === selectedPack);
    if (pack && pack.price >= 200) {
      setShowConfirm(true);
    } else {
      navigate(`/checkout?pack=${selectedPack}`);
    }
  };

  const confirmPurchase = () => {
    setShowConfirm(false);
    navigate(`/checkout?pack=${selectedPack}`);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
      </div>
    );
  }

  return (
    <div className="max-w-[900px] mx-auto px-4 sm:px-6 py-8 sm:py-12">
      {/* Section A — Solde actuel */}
      <div
        className="rounded-2xl p-8 sm:p-10 mb-10 relative overflow-hidden"
        style={{ background: 'linear-gradient(135deg, #2563EB 0%, #1D4ED8 100%)' }}
      >
        <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full -mr-32 -mt-32" />
        <div className="absolute bottom-0 left-0 w-48 h-48 bg-white/5 rounded-full -ml-24 -mb-24" />

        <div className="relative z-10">
          <div className="flex items-center gap-2 mb-2">
            <Wallet size={20} className="text-white/70" />
            <span className="text-white/70 text-sm font-medium">{t('balance.currentBalance')}</span>
          </div>

          <div className="flex items-baseline gap-3 mb-1">
            <span className="text-white font-extrabold leading-none" style={{ fontSize: '72px' }}>
              {creditData?.credits ?? 0}
            </span>
            <span className="text-white/70 text-lg">{t('balance.creditsRemaining')}</span>
          </div>

          {renewalDate && (
            <div className="inline-flex items-center gap-1.5 mt-3 px-3 py-1 bg-white/15 rounded-full text-white/90 text-xs font-medium">
              <Clock size={14} />
              {t('balance.renewalOn')} {renewalDate}
            </div>
          )}

          {/* Progress bar */}
          <div className="mt-6">
            <div className="flex justify-between text-white/70 text-xs mb-2">
              <span>{t('balance.usedThisMonth')}: {creditData?.used_this_month ?? 0}</span>
              <span>{planCredits} {t('balance.total')}</span>
            </div>
            <div className="h-2.5 bg-white/20 rounded-full overflow-hidden">
              <div
                className="h-full bg-white rounded-full transition-all duration-500"
                style={{ width: `${usedPercent}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Section B — Achat de crédits */}
      <div className="mb-10">
        <h2 className="text-2xl font-bold text-gray-900 mb-1">{t('balance.rechargeCredits')}</h2>
        <p className="text-gray-500 text-sm mb-6">{t('balance.rechargeSubtitle')}</p>

        <div className="grid md:grid-cols-3 gap-4 sm:gap-6">
          {PACKS.map((pack) => {
            const isSelected = selectedPack === pack.id;
            return (
              <button
                key={pack.id}
                onClick={() => handleSelectPack(pack.id)}
                className={`relative text-left rounded-2xl p-6 transition-all duration-200 ${
                  isSelected
                    ? 'border-2 border-blue-600 bg-blue-50 shadow-lg scale-[1.02]'
                    : 'border border-gray-200 bg-white hover:shadow-md hover:border-gray-300'
                }`}
              >
                {pack.badge && (
                  <span className={`absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${
                    pack.id === '500' ? 'bg-blue-600 text-white' : pack.id === '1000' ? 'bg-green-600 text-white' : 'bg-gray-200 text-gray-700'
                  }`}>
                    {t(pack.badge as any)}
                  </span>
                )}

                <div className="text-center">
                  <p className="text-3xl font-bold text-gray-900 mb-1">{pack.credits}</p>
                  <p className="text-gray-500 text-sm mb-4">{t('balance.credits')}</p>

                  <div className="mb-3">
                    <span className="text-2xl font-bold text-gray-900">${pack.price}</span>
                    {pack.basePrice > pack.price && (
                      <span className="text-gray-400 line-through text-sm ml-2">${pack.basePrice}</span>
                    )}
                  </div>

                  <div className="space-y-1 text-xs text-gray-500 mb-4">
                    <p>${pack.pricePerCredit.toFixed(2)}/{t('balance.credit')}</p>
                    {pack.discount > 0 && (
                      <p className="text-green-600 font-semibold">{t('balance.discount')}: {pack.discount}%</p>
                    )}
                  </div>

                  <div className={`w-full py-2.5 rounded-xl text-sm font-semibold transition-colors ${
                    isSelected
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-700 border border-gray-200'
                  }`}>
                    {isSelected ? t('balance.selected') : t('balance.select')}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {selectedPack && selectedPackData && (
          <div className="mt-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <button
              onClick={handleContinue}
              className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition-all duration-200 hover:shadow-lg active:scale-[0.98] flex items-center justify-center gap-2"
              style={{ borderRadius: '12px' }}
            >
              {t('balance.continueToPayment')}
              <ArrowRight size={20} />
            </button>
          </div>
        )}
      </div>

      {/* Section C — Historique des transactions */}
      <div>
        <h2 className="text-2xl font-bold text-gray-900 mb-6">{t('balance.history')}</h2>

        {transactions.length === 0 ? (
          <div className="text-center py-16 bg-gray-50 rounded-2xl border border-gray-100">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-gray-100 rounded-full mb-4">
              <TrendingUp size={28} className="text-gray-400" />
            </div>
            <p className="text-gray-500 text-sm">{t('balance.noTransactions')}</p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
            <div className="divide-y divide-gray-50">
              {transactions.map((tx) => (
                <div key={tx.id} className="flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${
                      tx.type === 'purchase' ? 'bg-green-100' : tx.type === 'consumption' ? 'bg-orange-100' : 'bg-blue-100'
                    }`}>
                      {tx.type === 'purchase' ? <CheckCircle2 size={18} className="text-green-600" /> :
                       tx.type === 'consumption' ? <TrendingUp size={18} className="text-orange-600" /> :
                       <Sparkles size={18} className="text-blue-600" />}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-900">
                        {tx.type === 'purchase' ? t('balance.purchase') :
                         tx.type === 'consumption' ? t('balance.consumption') :
                         tx.type === 'refill' ? t('balance.refill') : t('balance.refund')}
                        {tx.pack && ` — ${tx.pack} ${t('balance.credits')}`}
                      </p>
                      <p className="text-xs text-gray-400">
                        {new Date(tx.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className={`text-sm font-semibold ${tx.credits > 0 ? 'text-green-600' : 'text-gray-700'}`}>
                      {tx.credits > 0 ? '+' : ''}{tx.credits} {t('balance.credits')}
                    </p>
                    {tx.amount_cents && (
                      <p className="text-xs text-gray-400">${(tx.amount_cents / 100).toFixed(2)}</p>
                    )}
                    {tx.status === 'pending' && (
                      <span className="inline-block mt-0.5 text-xs text-orange-600 font-medium">{t('balance.pending')}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Confirmation modal for purchases >= $200 */}
      {showConfirm && selectedPackData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl p-8 max-w-md w-full shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <h3 className="text-xl font-bold text-gray-900 mb-2">{t('balance.confirmTitle')}</h3>
            <p className="text-gray-600 mb-6">
              {t('balance.confirmDesc', { credits: selectedPackData.credits, price: selectedPackData.price })}
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowConfirm(false)}
                className="flex-1 py-3 bg-gray-100 text-gray-700 font-semibold rounded-xl hover:bg-gray-200 transition-colors"
              >
                {t('balance.cancel')}
              </button>
              <button
                onClick={confirmPurchase}
                className="flex-1 py-3 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 transition-colors"
              >
                {t('balance.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
