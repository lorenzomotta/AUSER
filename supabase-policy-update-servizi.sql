-- Esegui SOLO questo blocco nel SQL Editor di Supabase (cancella tutto il resto prima).
-- Permette agli operatori con permesso Calendario di aggiornare Servizi_supa.

DROP POLICY IF EXISTS "operatori_aggiornano_servizi" ON public."Servizi_supa";

CREATE POLICY "operatori_aggiornano_servizi"
ON public."Servizi_supa"
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.user_permissions AS up
    WHERE up.user_id = auth.uid()
      AND (up.is_admin IS TRUE OR up."Calendario" IS TRUE)
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.user_permissions AS up
    WHERE up.user_id = auth.uid()
      AND (up.is_admin IS TRUE OR up."Calendario" IS TRUE)
  )
);
