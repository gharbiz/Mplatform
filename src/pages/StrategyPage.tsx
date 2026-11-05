import { useState } from 'react';
import { ArrowLeft, FileCheck, Sparkles, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../lib/i18n';
import {
  LEADLOSS_MAX_FILE_BYTES,
  isLeadLossFile,
  parseLeadLossDiagnostic,
  type LeadLossDiagnostic,
} from '../lib/leadlossDiagnostic';

const countries = [
  'United States', 'Canada', 'United Kingdom', 'France', 'Germany', 'Spain', 'Italy', 'Netherlands',
  'Belgium', 'Switzerland', 'Sweden', 'Norway', 'Denmark', 'Poland', 'Portugal', 'Mexico', 'Brazil',
  'Argentina', 'Chile', 'Colombia', 'Australia', 'New Zealand', 'Japan', 'China', 'India', 'Singapore',
  'Malaysia', 'Thailand', 'Indonesia', 'Philippines', 'South Korea', 'Vietnam', 'UAE', 'Saudi Arabia',
  'South Africa', 'Egypt', 'Turkey',
];

interface UploadedDiagnostic {
  fileName: string;
  diagnostic: LeadLossDiagnostic;
}

export function StrategyPage() {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const [formData, setFormData] = useState({
    website: '',
    businessName: '',
    businessModel: '',
    companyAge: '',
    teamSize: '',
    geographicMarket: '',
  });
  const [isLoading, setIsLoading] = useState(false);
  const [uploaded, setUploaded] = useState<UploadedDiagnostic | null>(null);
  const [uploadError, setUploadError] = useState('');

  const isValidUrl = (url: string) => {
    try {
      new URL(url.startsWith('http') ? url : `https://${url}`);
      return true;
    } catch {
      return false;
    }
  };

  const isFormValid = () => {
    return (
      isValidUrl(formData.website) &&
      formData.businessName.trim() &&
      formData.businessModel &&
      formData.companyAge &&
      formData.teamSize &&
      formData.geographicMarket
    );
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleLeadLossUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!isLeadLossFile(file)) {
      setUploadError(t('strategy.leadLoss.invalidType'));
      return;
    }
    if (file.size > LEADLOSS_MAX_FILE_BYTES) {
      setUploadError(t('strategy.leadLoss.tooLarge'));
      return;
    }
    try {
      const diagnostic = parseLeadLossDiagnostic(await file.text());
      setUploaded({ fileName: file.name, diagnostic });
      setUploadError('');
    } catch {
      setUploaded(null);
      setUploadError(t('strategy.leadLoss.parseError'));
    }
  };

  const removeLeadLoss = () => {
    setUploaded(null);
    setUploadError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isFormValid()) return;
    setIsLoading(true);
    await new Promise(resolve => setTimeout(resolve, 2000));
    const payload = { ...formData, leadLossDiagnostic: uploaded?.diagnostic ?? null };
    const encodedData = encodeURIComponent(JSON.stringify(payload));
    navigate(`/strategy/${encodedData}`);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-gray-50">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <button
          onClick={() => navigate('/')}
          className="flex items-center gap-2 text-gray-600 hover:text-blue-600 transition-colors font-medium mb-12"
        >
          <ArrowLeft size={20} />
          {t('strategy.backHome')}
        </button>

        <div className="bg-white rounded-3xl shadow-xl p-8 sm:p-12">
          <div className="text-center mb-8">
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-blue-100 text-blue-700 rounded-full mb-6 text-sm font-medium">
              <Sparkles size={16} />
              <span>{t('strategy.badge')}</span>
            </div>
            <h1 className="text-4xl sm:text-5xl font-bold text-gray-900 mb-4">
              {t('strategy.title')}
            </h1>
            <p className="text-xl text-gray-600">
              {t('strategy.subtitle')}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid md:grid-cols-2 gap-6">
              <div>
                <label htmlFor="website" className="block text-sm font-semibold text-gray-900 mb-2">
                  {t('strategy.website')} <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  id="website"
                  name="website"
                  value={formData.website}
                  onChange={handleChange}
                  placeholder={t('strategy.placeholderWebsite')}
                  className={`w-full px-4 py-3 rounded-xl border-2 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                    formData.website && !isValidUrl(formData.website) ? 'border-red-300 bg-red-50' : 'border-gray-200 bg-white'
                  }`}
                />
                {formData.website && !isValidUrl(formData.website) && (
                  <p className="text-red-600 text-sm mt-2">{t('strategy.invalidUrl')}</p>
                )}
              </div>

              <div>
                <label htmlFor="businessName" className="block text-sm font-semibold text-gray-900 mb-2">
                  {t('strategy.businessName')} <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  id="businessName"
                  name="businessName"
                  value={formData.businessName}
                  onChange={handleChange}
                  placeholder={t('strategy.placeholderBusiness')}
                  className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 bg-white transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                />
              </div>

              <div>
                <label htmlFor="businessModel" className="block text-sm font-semibold text-gray-900 mb-2">
                  {t('strategy.businessModel')} <span className="text-red-500">*</span>
                </label>
                <select
                  id="businessModel"
                  name="businessModel"
                  value={formData.businessModel}
                  onChange={handleChange}
                  className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 bg-white transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                >
                  <option value="">{t('strategy.selectOption')}</option>
                  <option value="B2B">{t('strategy.b2b')}</option>
                  <option value="B2C">{t('strategy.b2c')}</option>
                </select>
              </div>

              <div>
                <label htmlFor="companyAge" className="block text-sm font-semibold text-gray-900 mb-2">
                  {t('strategy.companyAge')} <span className="text-red-500">*</span>
                </label>
                <select
                  id="companyAge"
                  name="companyAge"
                  value={formData.companyAge}
                  onChange={handleChange}
                  className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 bg-white transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                >
                  <option value="">{t('strategy.selectOption')}</option>
                  <option value="0-2">{t('strategy.ageLess3')}</option>
                  <option value="3-5">{t('strategy.age3to5')}</option>
                  <option value="6-10">{t('strategy.age6to10')}</option>
                  <option value="10+">{t('strategy.age10plus')}</option>
                </select>
              </div>

              <div>
                <label htmlFor="teamSize" className="block text-sm font-semibold text-gray-900 mb-2">
                  {t('strategy.teamSize')} <span className="text-red-500">*</span>
                </label>
                <select
                  id="teamSize"
                  name="teamSize"
                  value={formData.teamSize}
                  onChange={handleChange}
                  className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 bg-white transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                >
                  <option value="">{t('strategy.selectOption')}</option>
                  <option value="1-10">{t('strategy.team1to10')}</option>
                  <option value="11-50">{t('strategy.team11to50')}</option>
                  <option value="51-100">{t('strategy.team51to100')}</option>
                  <option value="100+">{t('strategy.team100plus')}</option>
                </select>
              </div>

              <div>
                <label htmlFor="geographicMarket" className="block text-sm font-semibold text-gray-900 mb-2">
                  {t('strategy.geographicMarket')} <span className="text-red-500">*</span>
                </label>
                <select
                  id="geographicMarket"
                  name="geographicMarket"
                  value={formData.geographicMarket}
                  onChange={handleChange}
                  className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 bg-white transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                >
                  <option value="">{t('strategy.selectCountry')}</option>
                  {countries.map(country => (
                    <option key={country} value={country}>{country}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label htmlFor="leadloss-diagnostic" className="block text-sm font-semibold text-gray-900 mb-1">
                {t('strategy.leadLoss.label')}
              </label>
              <p className="text-sm text-gray-500 mb-3">{t('strategy.leadLoss.hint')}</p>
              <input
                type="file"
                id="leadloss-diagnostic"
                accept=".md,text/markdown"
                onChange={handleLeadLossUpload}
                className="block w-full text-sm text-gray-600 file:mr-4 file:py-2.5 file:px-4 file:rounded-xl file:border-0 file:bg-blue-50 file:text-blue-700 file:font-semibold hover:file:bg-blue-100 file:cursor-pointer cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded-xl"
              />
              {uploadError && <p className="text-red-600 text-sm mt-2">{uploadError}</p>}

              {uploaded && (
                <div className="mt-4 rounded-2xl border border-green-200 bg-green-50 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <FileCheck size={18} className="text-green-600 flex-shrink-0" />
                      <span className="text-sm font-semibold text-gray-900 truncate">{uploaded.fileName}</span>
                    </div>
                    <button
                      type="button"
                      onClick={removeLeadLoss}
                      className="flex items-center gap-1 text-sm font-medium text-gray-700 hover:text-red-600 transition-colors"
                    >
                      <X size={16} />
                      {t('strategy.leadLoss.remove')}
                    </button>
                  </div>
                  <p className="text-sm font-semibold text-green-800 mt-3">{t('strategy.leadLoss.detected')}</p>
                  <ul className="text-sm text-gray-700 mt-2 space-y-1">
                    <li>{t('strategy.leadLoss.frictions', { n: uploaded.diagnostic.frictions.length })}</li>
                    {uploaded.diagnostic.conversionRate !== null && (
                      <li>{t('strategy.leadLoss.conversion', { n: uploaded.diagnostic.conversionRate })}</li>
                    )}
                    {uploaded.diagnostic.estimatedRecovery !== null && (
                      <li>{t('strategy.leadLoss.recovery', { n: uploaded.diagnostic.estimatedRecovery.toLocaleString() })}</li>
                    )}
                  </ul>
                  <p className="text-xs text-gray-500 mt-3">{t('strategy.leadLoss.usage')}</p>
                </div>
              )}
            </div>

            <button
              type="submit"
              disabled={!isFormValid() || isLoading}
              className="w-full px-6 py-4 bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all font-semibold text-lg flex items-center justify-center gap-2 shadow-lg hover:shadow-xl"
            >
              {isLoading ? (
                <>
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  <span>{t('strategy.analyzing')}</span>
                </>
              ) : (
                <>
                  <Sparkles size={20} />
                  <span>{t('strategy.generate')}</span>
                </>
              )}
            </button>
          </form>

          <div className="mt-12 pt-8 border-t border-gray-200">
            <h3 className="font-semibold text-gray-900 mb-4">{t('strategy.whatNext')}</h3>
            <div className="space-y-4">
              {[
                { title: t('strategy.step1Title'), desc: t('strategy.step1Desc') },
                { title: t('strategy.step2Title'), desc: t('strategy.step2Desc') },
                { title: t('strategy.step3Title'), desc: t('strategy.step3Desc') },
              ].map((step, i) => (
                <div key={i} className="flex gap-4">
                  <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
                    <span className="text-blue-600 font-bold text-sm">{i + 1}</span>
                  </div>
                  <div>
                    <h4 className="font-semibold text-gray-900 mb-1">{step.title}</h4>
                    <p className="text-gray-600 text-sm">{step.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
