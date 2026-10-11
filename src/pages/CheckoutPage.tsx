import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Lock, Shield, CreditCard, CheckCircle2, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useLanguage } from '../lib/i18n';

const PACKS: Record<string, { credits: number; price: number; basePrice: number; pricePerCredit: number; discount: number; name: string }> = {
  '200': { credits: 200, price: 80, basePrice: 80, pricePerCredit: 0.40, discount: 0, name: 'Starter' },
  '500': { credits: 500, price: 175, basePrice: 200, pricePerCredit: 0.35, discount: 12.5, name: 'Pro' },
  '1000': { credits: 1000, price: 300, basePrice: 400, pricePerCredit: 0.30, discount: 25, name: 'Enterprise' },
};

export function CheckoutPage() {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const [searchParams] = useSearchParams();
  const packId = searchParams.get('pack') || '200';
  const status = searchParams.get('status');
  const sessionId = searchParams.get('session_id');

  const pack = PACKS[packId] || PACKS['200'];
  const [paymentMethod, setPaymentMethod] = useState<'stripe' | 'paypal' | 'card'>('stripe');
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cardForm, setCardForm] = useState({ number: '', expiry: '', cvv: '', name: '' });

  useEffect(() => {
    if (status === 'success' && sessionId) {
      // Payment was successful — redirect to balance after a brief delay
      const timer = setTimeout(() => navigate('/balance'), 2000);
      return () => clearTimeout(timer);
    }
  }, [status, sessionId, navigate]);

  // Auto-focus first field on mobile for card form
  useEffect(() => {
    if (paymentMethod === 'card') {
      const el = document.getElementById('card-number');
      el?.focus();
    }
  }, [paymentMethod]);

  const formatCardNumber = (value: string): string => {
    const digits = value.replace(/\D/g, '').slice(0, 16);
    return digits.replace(/(\d{4})(?=\d)/g, '$1 ');
  };

  const formatExpiry = (value: string): string => {
    const digits = value.replace(/\D/g, '').slice(0, 4);
    if (digits.length >= 3) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
    return digits;
  };

  const detectCardType = (number: string): string => {
    const cleaned = number.replace(/\s/g, '');
    if (/^4/.test(cleaned)) return 'visa';
    if (/^5[1-5]/.test(cleaned)) return 'mastercard';
    if (/^3[47]/.test(cleaned)) return 'amex';
    return '';
  };

  const handlePay = async () => {
    setError(null);
    setProcessing(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { navigate('/signin'); return; }

      const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/stripe-checkout`;
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ pack: packId, method: paymentMethod }),
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => null);
        throw new Error(errBody?.error || `Payment failed (${res.status})`);
      }

      const data = await res.json();
      if (data.redirect_url) {
        window.location.href = data.redirect_url;
      } else {
        throw new Error('No redirect URL returned');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Payment failed');
      setProcessing(false);
    }
  };

  if (status === 'success') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="max-w-md w-full text-center">
          <div className="inline-flex items-center justify-center w-20 h-20 bg-green-100 rounded-full mb-6 animate-in fade-in zoom-in-95 duration-300">
            <CheckCircle2 size={40} className="text-green-600" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">{t('checkout.successTitle')}</h1>
          <p className="text-gray-500 mb-6">{t('checkout.successDesc')}</p>
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-100">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <button
            onClick={() => navigate('/balance')}
            className="flex items-center gap-2 text-gray-500 hover:text-gray-800 transition-colors text-sm font-medium"
          >
            <ArrowLeft size={18} />
            {t('checkout.backToBalance')}
          </button>
          <div className="flex items-center gap-2 text-sm text-gray-400">
            <Lock size={16} />
            <span>{t('checkout.securePayment')}</span>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
        <div className="grid md:grid-cols-2 gap-6 lg:gap-8">
          {/* Left — Order summary */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 sm:p-8">
            <h2 className="text-xl font-bold text-gray-900 mb-6">{t('checkout.summary')}</h2>

            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">{t('checkout.selectedPack')}</span>
                <span className="text-gray-900 font-medium">{pack.credits} {t('balance.credits')}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">{t('checkout.pricePerCredit')}</span>
                <span className="text-gray-900 font-medium">${pack.pricePerCredit.toFixed(2)}/{t('balance.credit')}</span>
              </div>
              {pack.discount > 0 && (
                <div className="flex justify-between">
                  <span className="text-gray-500">{t('checkout.discountApplied')}</span>
                  <span className="text-green-600 font-semibold">{pack.discount}%</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-gray-500">{t('checkout.subtotal')}</span>
                {pack.basePrice > pack.price ? (
                  <span className="text-gray-400 line-through">${pack.basePrice}</span>
                ) : (
                  <span className="text-gray-900 font-medium">${pack.basePrice}</span>
                )}
              </div>

              <div className="border-t border-gray-100 pt-4 mt-4">
                <div className="flex justify-between items-baseline">
                  <span className="text-gray-900 font-semibold">{t('checkout.totalToPay')}</span>
                  <span className="text-3xl font-extrabold text-blue-600">${pack.price}</span>
                </div>
              </div>
            </div>

            <div className="mt-6 space-y-2">
              <div className="flex items-start gap-2 text-xs text-gray-400">
                <CheckCircle2 size={14} className="text-green-500 mt-0.5 flex-shrink-0" />
                <span>{t('checkout.instantCredits')}</span>
              </div>
              <div className="flex items-start gap-2 text-xs text-gray-400">
                <CheckCircle2 size={14} className="text-green-500 mt-0.5 flex-shrink-0" />
                <span>{t('checkout.monthlyRenew')}</span>
              </div>
            </div>
          </div>

          {/* Right — Payment methods */}
          <div className="space-y-4">
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 sm:p-8">
              <h2 className="text-xl font-bold text-gray-900 mb-6">{t('checkout.chooseMethod')}</h2>

              <div className="space-y-3">
                {/* Stripe */}
                <button
                  onClick={() => setPaymentMethod('stripe')}
                  className={`w-full flex items-center gap-3 px-5 py-[18px] rounded-xl font-semibold transition-all duration-200 active:scale-[0.98] ${
                    paymentMethod === 'stripe'
                      ? 'ring-2 ring-offset-2 ring-[#635BFF]'
                      : 'ring-1 ring-gray-200 hover:ring-gray-300'
                  }`}
                  style={{ backgroundColor: '#635BFF', color: '#fff', borderRadius: '12px' }}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-lg font-bold italic">stripe</span>
                  </div>
                  <span className="ml-auto">{t('checkout.payWithStripe')}</span>
                </button>

                {/* PayPal */}
                <button
                  onClick={() => setPaymentMethod('paypal')}
                  className={`w-full flex items-center gap-3 px-5 py-[18px] rounded-xl font-semibold transition-all duration-200 active:scale-[0.98] ${
                    paymentMethod === 'paypal'
                      ? 'ring-2 ring-offset-2 ring-[#FFC439]'
                      : 'ring-1 ring-gray-200 hover:ring-gray-300'
                  }`}
                  style={{ backgroundColor: '#FFC439', color: '#003087', borderRadius: '12px' }}
                >
                  <span className="text-lg font-bold italic" style={{ color: '#003087' }}>PayPal</span>
                  <span className="ml-auto">{t('checkout.payWithPaypal')}</span>
                </button>

                {/* Card */}
                <button
                  onClick={() => setPaymentMethod('card')}
                  className={`w-full flex items-center gap-3 px-5 py-[18px] rounded-xl font-semibold transition-all duration-200 active:scale-[0.98] ${
                    paymentMethod === 'card'
                      ? 'ring-2 ring-offset-2 ring-blue-600 bg-blue-50 text-blue-900'
                      : 'ring-1 ring-gray-200 bg-white text-gray-800 hover:ring-blue-300'
                  }`}
                  style={{ borderRadius: '12px' }}
                >
                  <CreditCard size={20} />
                  <span>{t('checkout.payWithCard')}</span>
                  <div className="ml-auto flex items-center gap-1.5 text-xs font-normal opacity-60">
                    <span>VISA</span>
                    <span>MC</span>
                    <span>CB</span>
                  </div>
                </button>
              </div>

              {/* Inline card form */}
              {paymentMethod === 'card' && (
                <div className="mt-5 space-y-4 animate-in fade-in slide-in-from-top-2 duration-200">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1.5" htmlFor="card-number">
                      {t('checkout.cardNumber')}
                    </label>
                    <input
                      id="card-number"
                      type="text"
                      inputMode="numeric"
                      value={cardForm.number}
                      onChange={(e) => setCardForm({ ...cardForm, number: formatCardNumber(e.target.value) })}
                      placeholder="1234 5678 9012 3456"
                      className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                    {cardForm.number && (
                      <span className="text-xs text-gray-400 mt-1 capitalize">{detectCardType(cardForm.number)}</span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1.5" htmlFor="card-expiry">
                        {t('checkout.expiry')}
                      </label>
                      <input
                        id="card-expiry"
                        type="text"
                        inputMode="numeric"
                        value={cardForm.expiry}
                        onChange={(e) => setCardForm({ ...cardForm, expiry: formatExpiry(e.target.value) })}
                        placeholder="MM/YY"
                        className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1.5" htmlFor="card-cvv">
                        CVV
                      </label>
                      <input
                        id="card-cvv"
                        type="text"
                        inputMode="numeric"
                        value={cardForm.cvv}
                        onChange={(e) => setCardForm({ ...cardForm, cvv: e.target.value.replace(/\D/g, '').slice(0, 4) })}
                        placeholder="123"
                        className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1.5" htmlFor="card-name">
                      {t('checkout.cardHolder')}
                    </label>
                    <input
                      id="card-name"
                      type="text"
                      value={cardForm.name}
                      onChange={(e) => setCardForm({ ...cardForm, name: e.target.value })}
                      placeholder={t('checkout.cardHolderPlaceholder')}
                      className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                </div>
              )}

              {/* Pay button */}
              <button
                onClick={handlePay}
                disabled={processing}
                className="w-full py-4 mt-6 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-semibold rounded-xl transition-all duration-200 hover:shadow-lg active:scale-[0.98] flex items-center justify-center gap-2"
                style={{ borderRadius: '12px' }}
              >
                {processing ? (
                  <>
                    <Loader2 size={20} className="animate-spin" />
                    {t('checkout.processing')}
                  </>
                ) : (
                  <>
                    <Lock size={18} />
                    {t('checkout.pay')} ${pack.price}
                  </>
                )}
              </button>

              {error && (
                <p className="mt-3 text-sm text-red-600 text-center">{error}</p>
              )}
            </div>

            {/* Security badges */}
            <div className="bg-white rounded-2xl border border-gray-100 p-5">
              <div className="flex items-center gap-4 text-xs text-gray-500">
                <div className="flex items-center gap-1.5">
                  <Shield size={16} className="text-green-600" />
                  <span>SSL 256-bit</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Lock size={16} className="text-green-600" />
                  <span>PCI-DSS</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <CheckCircle2 size={16} className="text-green-600" />
                  <span>{t('checkout.dataProtected')}</span>
                </div>
              </div>
            </div>

            <p className="text-xs text-gray-400 text-center px-4">
              {t('checkout.legalNotice')}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
