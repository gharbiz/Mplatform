/*
# Clear ideal customer profiles when their business is deleted

## Summary
When a business is removed from "Mes entreprises", the ideal customer profile (ICP)
knowledge base generated from its marketing strategies is erased automatically.

## Modified Behaviour
- New trigger `clear_icp_on_business_delete` on `public.businesses` (BEFORE DELETE).
- It sets `icp_insights` to NULL on every `marketing_strategies` row linked to the
  deleted business. The strategy itself is kept (it still appears in the strategies list).

## Security
- No new tables, no policy or grant changes.
- The trigger runs with the caller's rights; the existing UPDATE policy on
  `marketing_strategies` already restricts it to the caller's own rows.

## Important Notes
1. Runs BEFORE the row is deleted, so the link (business_id) is still present when cleared.
2. Existing orphaned strategies are not modified by this migration; the ICP page
   filters them out instead.
*/

CREATE OR REPLACE FUNCTION public.clear_icp_on_business_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  UPDATE public.marketing_strategies
  SET icp_insights = NULL
  WHERE business_id = OLD.id;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS clear_icp_on_business_delete ON public.businesses;
CREATE TRIGGER clear_icp_on_business_delete
  BEFORE DELETE ON public.businesses
  FOR EACH ROW
  EXECUTE FUNCTION public.clear_icp_on_business_delete();
