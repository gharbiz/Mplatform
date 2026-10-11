/*
# Create user_credits and credit_transactions tables

1. New Tables
- `user_credits`: stores each user's current credit balance, monthly plan, renewal date, and used-this-month counter.
  - id (uuid, PK)
  - user_id (uuid, FK -> auth.users, unique, NOT NULL, defaults to auth.uid())
  - credits (integer, NOT NULL, default 200)
  - plan (text, NOT NULL, default 'starter')
  - renewal_date (date, NOT NULL, default = first day of next month)
  - used_this_month (integer, NOT NULL, default 0)
  - last_refill_date (date, nullable)
  - created_at (timestamptz, default now())
  - updated_at (timestamptz, default now())

- `credit_transactions`: stores the history of all credit purchases and consumptions.
  - id (uuid, PK, default gen_random_uuid())
  - user_id (uuid, FK -> auth.users, NOT NULL, default auth.uid())
  - type (text): 'purchase' | 'consumption' | 'refill' | 'refund'
  - credits (integer): positive for additions, negative for consumptions
  - amount_cents (integer, nullable)
  - currency (text, default 'usd')
  - stripe_session_id (text, nullable)
  - pack (text, nullable)
  - description (text, nullable)
  - status (text): 'pending' | 'completed' | 'failed'
  - created_at (timestamptz, default now())

2. Security
- RLS enabled on both tables with owner-scoped CRUD.
- SECURITY DEFINER function auto-creates user_credits on signup.
- Index on credit_transactions(user_id, created_at DESC).

3. Notes
- Backfills existing users with 200 starter credits.
*/

CREATE TABLE IF NOT EXISTS user_credits (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL DEFAULT auth.uid() UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  credits integer NOT NULL DEFAULT 200,
  plan text NOT NULL DEFAULT 'starter',
  renewal_date date NOT NULL DEFAULT (date_trunc('month', now()) + interval '1 month')::date,
  used_this_month integer NOT NULL DEFAULT 0,
  last_refill_date date,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE user_credits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_credits" ON user_credits;
CREATE POLICY "select_own_credits" ON user_credits FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_credits" ON user_credits;
CREATE POLICY "insert_own_credits" ON user_credits FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_credits" ON user_credits;
CREATE POLICY "update_own_credits" ON user_credits FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_credits" ON user_credits;
CREATE POLICY "delete_own_credits" ON user_credits FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS credit_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('purchase', 'consumption', 'refill', 'refund')),
  credits integer NOT NULL,
  amount_cents integer,
  currency text DEFAULT 'usd',
  stripe_session_id text,
  pack text,
  description text,
  status text NOT NULL DEFAULT 'completed' CHECK (status IN ('pending', 'completed', 'failed')),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE credit_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_transactions" ON credit_transactions;
CREATE POLICY "select_own_transactions" ON credit_transactions FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_transactions" ON credit_transactions;
CREATE POLICY "insert_own_transactions" ON credit_transactions FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_transactions" ON credit_transactions;
CREATE POLICY "update_own_transactions" ON credit_transactions FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_transactions" ON credit_transactions;
CREATE POLICY "delete_own_transactions" ON credit_transactions FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_credit_transactions_user_created
  ON credit_transactions(user_id, created_at DESC);

-- SECURITY DEFINER function to auto-create credits row on signup
CREATE OR REPLACE FUNCTION create_user_credits_for_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO user_credits (id, user_id, credits, plan, renewal_date, used_this_month)
  VALUES (NEW.id, NEW.id, 200, 'starter', (date_trunc('month', now()) + interval '1 month')::date, 0)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_credits ON auth.users;
CREATE TRIGGER on_auth_user_created_credits
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION create_user_credits_for_new_user();

-- Backfill existing users
INSERT INTO user_credits (id, user_id, credits, plan, renewal_date, used_this_month)
  SELECT au.id, au.id, 200, 'starter', (date_trunc('month', now()) + interval '1 month')::date, 0
  FROM auth.users au
  WHERE NOT EXISTS (SELECT 1 FROM user_credits uc WHERE uc.user_id = au.id);
