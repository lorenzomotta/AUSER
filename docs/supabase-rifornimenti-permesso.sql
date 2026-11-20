-- Permesso per gli operatori del calendario: leggere e inserire i rifornimenti.
-- Eseguilo una volta nel SQL Editor di Supabase.
-- La app desktop continua a usare la chiave riservata e non dipende da queste regole.

ALTER TABLE public."Rifornimenti" ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT ON TABLE public."Rifornimenti" TO authenticated;

DO $$
DECLARE
    seq text;
BEGIN
    SELECT pg_get_serial_sequence('public."Rifornimenti"', 'id') INTO seq;
    IF seq IS NOT NULL THEN
        EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %s TO authenticated', seq);
    END IF;
END $$;

CREATE OR REPLACE FUNCTION public.operatore_puo_aggiornare_servizi()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_permissions up
    WHERE up.user_id = auth.uid()
      AND (up.is_admin IS TRUE OR up."Calendario" IS TRUE)
  );
$$;

REVOKE ALL ON FUNCTION public.operatore_puo_aggiornare_servizi() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.operatore_puo_aggiornare_servizi() TO authenticated;

DROP POLICY IF EXISTS "operatori_leggono_rifornimenti" ON public."Rifornimenti";
CREATE POLICY "operatori_leggono_rifornimenti"
ON public."Rifornimenti"
FOR SELECT
TO authenticated
USING (public.operatore_puo_aggiornare_servizi());

DROP POLICY IF EXISTS "operatori_inseriscono_rifornimenti" ON public."Rifornimenti";
CREATE POLICY "operatori_inseriscono_rifornimenti"
ON public."Rifornimenti"
FOR INSERT
TO authenticated
WITH CHECK (public.operatore_puo_aggiornare_servizi());
