-- Account Context Builder: persist Clay prospect records once and reference the existing strategy.
CREATE TABLE IF NOT EXISTS public.account_contexts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  strategy_id uuid NOT NULL REFERENCES public.marketing_strategies(id) ON DELETE CASCADE,
  clay_profile_id text NOT NULL,
  clay_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  clay_search_id text,
  last_synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT account_contexts_user_clay_profile_unique UNIQUE (user_id, clay_profile_id)
);

CREATE INDEX IF NOT EXISTS idx_account_contexts_user_id ON public.account_contexts(user_id);
CREATE INDEX IF NOT EXISTS idx_account_contexts_strategy_id ON public.account_contexts(strategy_id);

ALTER TABLE public.account_contexts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_account_contexts" ON public.account_contexts;
CREATE POLICY "select_own_account_contexts" ON public.account_contexts
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_account_contexts" ON public.account_contexts;
CREATE POLICY "insert_own_account_contexts" ON public.account_contexts
  FOR INSERT TO authenticated WITH CHECK (
    auth.uid() = user_id AND EXISTS (
      SELECT 1 FROM public.marketing_strategies s
      WHERE s.id = strategy_id AND s.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "update_own_account_contexts" ON public.account_contexts;
CREATE POLICY "update_own_account_contexts" ON public.account_contexts
  FOR UPDATE TO authenticated USING (auth.uid() = user_id)
  WITH CHECK (
    auth.uid() = user_id AND EXISTS (
      SELECT 1 FROM public.marketing_strategies s
      WHERE s.id = strategy_id AND s.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "delete_own_account_contexts" ON public.account_contexts;
CREATE POLICY "delete_own_account_contexts" ON public.account_contexts
  FOR DELETE TO authenticated USING (auth.uid() = user_id);
