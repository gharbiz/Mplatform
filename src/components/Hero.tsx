import { ArrowRight, Sparkles } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useLanguage } from '../lib/i18n';

export function Hero() {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const checkAuth = async () => {
      const { data } = await supabase.auth.getSession();
      setIsAuthenticated(!!data.session);
      setIsLoading(false);
    };
    checkAuth();
  }, []);

  const handleStartFree = () => {
    if (isAuthenticated) {
      navigate('/strategy');
    } else {
      navigate('/signup');
    }
  };

  return (
    <section className="relative pt-32 pb-20 px-4 sm:px-6 lg:px-8 overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-blue-50 via-white to-gray-50 -z-10"></div>

      <div className="max-w-7xl mx-auto">
        <div className="text-center max-w-4xl mx-auto">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-blue-100 text-blue-700 rounded-full mb-8 text-sm font-medium">
            <Sparkles size={16} />
            <span>{t('hero.badge')}</span>
          </div>

          <h1 className="text-5xl sm:text-6xl lg:text-7xl font-bold text-gray-900 mb-6 leading-tight">
            {t('hero.title')}{' '}
            <span className="text-blue-600">{t('hero.titleHighlight')}</span>
          </h1>

          <p className="text-xl text-gray-600 mb-10 leading-relaxed max-w-2xl mx-auto">
            {t('hero.subtitle')}
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center mb-12">
            <button
              onClick={handleStartFree}
              disabled={isLoading}
              className="group px-8 py-4 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-all font-semibold text-lg flex items-center gap-2 shadow-lg hover:shadow-xl disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? t('hero.loading') : t('hero.ctaStart')}
              <ArrowRight size={20} className="group-hover:translate-x-1 transition-transform" />
            </button>
            <button className="px-8 py-4 bg-white text-gray-700 rounded-xl hover:bg-gray-50 transition-colors font-semibold text-lg border-2 border-gray-200">
              {t('hero.ctaDemo')}
            </button>
          </div>

          <div className="flex flex-col sm:flex-row sm:flex-wrap justify-center items-center gap-3 sm:gap-8 text-sm text-gray-500">
            <div className="flex items-center gap-2">
              <svg className="w-5 h-5 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              <span>{t('hero.guarantee')}</span>
            </div>
            <div className="flex items-center gap-2">
              <svg className="w-5 h-5 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              <span>{t('hero.cancelAnytime')}</span>
            </div>
            <div className="flex items-center gap-2">
              <svg className="w-5 h-5 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              <span>{t('hero.credits')}</span>
            </div>
          </div>
        </div>

        <div className="mt-20 relative">
          <div className="absolute inset-0 bg-gradient-to-t from-white via-transparent to-transparent h-32 bottom-0 z-10"></div>

          <div className="relative rounded-2xl overflow-hidden shadow-2xl border border-gray-200 bg-white">
            <div className="py-16 px-8 sm:px-12 lg:px-16">
              <div className="text-center mb-12">
                <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-3">
                  {t('hero.workspaceTitle')}
                </h2>
                <p className="text-xl text-blue-600 font-semibold mb-4">
                  {t('hero.workspaceSubtitle')}
                </p>
                <p className="text-gray-600 max-w-2xl mx-auto">
                  {t('hero.workspaceDesc')}
                </p>
              </div>

              <div className="grid lg:grid-cols-2 gap-8 items-center max-w-5xl mx-auto">
                <div className="space-y-6">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center">
                      <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                      </svg>
                    </div>
                    <div>
                      <h3 className="text-xl font-bold text-gray-900">{t('hero.icpTitle')}</h3>
                      <p className="text-sm text-blue-600 font-medium">{t('hero.icpSubtitle')}</p>
                    </div>
                  </div>

                  <p className="text-gray-600 leading-relaxed">
                    {t('hero.icpDesc')}
                  </p>

                  <button className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium">
                    {t('hero.tryIcp')}
                    <ArrowRight size={18} />
                  </button>
                </div>

                <div className="relative">
                  <img
                    src="https://cdn.prod.website-files.com/663c940089a1bd32d4e76e38/680913ecf991fce3576e2c1e_ICP%20v2%20(1)-p-800.webp"
                    alt="ICP Generator Dashboard"
                    className="rounded-xl shadow-lg w-full"
                  />
                  <div className="absolute -bottom-4 -right-4 w-24 h-24 bg-blue-100 rounded-full -z-10"></div>
                  <div className="absolute -top-4 -left-4 w-16 h-16 bg-gray-100 rounded-full -z-10"></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
