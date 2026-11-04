/*
# Create marketing_strategy_versions

## Summary
Stores the second-generation Marketing Strategy Engine output. Each generation is a new
immutable version linked to the original marketing strategy and its business, so
regenerating never overwrites a previous version.

## New Tables
### `marketing_strategy_versions`
- `id` (uuid, primary key)
- `user_id` (uuid, owner, defaults to auth.uid())
- `strategy_id` (uuid, references marketing_strategies, cascade delete)
- `business_id` (uuid, references businesses, cascade delete: versions are removed with the business)
- `version_number` (int, sequential per strategy)
- `language` (text, 'fr' or 'en', language the content was generated in)
- `content` (jsonb, the ten strategic modules)
- `created_at` (timestamptz)

## Security
- RLS enabled. Four per-verb policies, scoped TO authenticated, owner-only (auth.uid() = user_id).
- Grants limited to authenticated, with the verbs the app uses.

## Important Notes
1. Versions are append-only from the app: each generation inserts a new row with the next version number.
2. The unique (strategy_id, version_number) constraint prevents two versions sharing a number.
*/

CREATE TABLE IF NOT EXISTS public.marketing_strategy_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  strategy_id uuid NOT NULL REFERENCES public.marketing_strategies(id) ON DELETE CASCADE,
  business_id uuid REFERENCES public.businesses(id) ON DELETE CASCADE,
  version_number integer NOT NULL,
  language text NOT NULL DEFAULT 'fr',
  content jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT marketing_strategy_versions_unique_version UNIQUE (strategy_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_marketing_strategy_versions_user_id ON public.marketing_strategy_versions(user_id);
CREATE INDEX IF NOT EXISTS idx_marketing_strategy_versions_strategy_id ON public.marketing_strategy_versions(strategy_id);
CREATE INDEX IF NOT EXISTS idx_marketing_strategy_versions_business_id ON public.marketing_strategy_versions(business_id);

ALTER TABLE public.marketing_strategy_versions ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.marketing_strategy_versions TO authenticated;

DROP POLICY IF EXISTS "select_own_strategy_versions" ON public.marketing_strategy_versions;
CREATE POLICY "select_own_strategy_versions" ON public.marketing_strategy_versions FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_strategy_versions" ON public.marketing_strategy_versions;
CREATE POLICY "insert_own_strategy_versions" ON public.marketing_strategy_versions FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_strategy_versions" ON public.marketing_strategy_versions;
CREATE POLICY "update_own_strategy_versions" ON public.marketing_strategy_versions FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_strategy_versions" ON public.marketing_strategy_versions;
CREATE POLICY "delete_own_strategy_versions" ON public.marketing_strategy_versions FOR DELETE
  TO authenticated USING (auth.uid() = user_id);
