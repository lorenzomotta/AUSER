-- Esegui TUTTO questo blocco nel SQL Editor di Supabase (una sola volta).
-- Serve al calendario WEB / telefono per poter SALVARE le modifiche ai servizi.
-- L'app PC (Tauri) spesso funziona lo stesso perché usa una chiave speciale;
-- il telefono invece ha bisogno di questi permessi.

-- 1) Permesso di aggiornare la tabella
GRANT SELECT, UPDATE ON TABLE public."Servizi_supa" TO authenticated;

-- 2) Funzione di controllo (ignora i blocchi RLS su user_permissions)
CREATE OR REPLACE FUNCTION public.operatore_puo_aggiornare_servizi()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_permissions AS up
    WHERE up.user_id = auth.uid()
      AND (
        up.is_admin IS TRUE
        OR up."Calendario" IS TRUE
      )
  );
$$;

REVOKE ALL ON FUNCTION public.operatore_puo_aggiornare_servizi() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.operatore_puo_aggiornare_servizi() TO authenticated;

-- 3) Policy UPDATE (cancella quelle vecchie e ricrea)
DROP POLICY IF EXISTS "operatori_aggiornano_servizi" ON public."Servizi_supa";

CREATE POLICY "operatori_aggiornano_servizi"
ON public."Servizi_supa"
FOR UPDATE
TO authenticated
USING (public.operatore_puo_aggiornare_servizi())
WITH CHECK (public.operatore_puo_aggiornare_servizi());
