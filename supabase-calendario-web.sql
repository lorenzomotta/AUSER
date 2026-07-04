-- Calendario web operatori — esegui nel SQL Editor di Supabase
-- Adattato alla tabella user_permissions con user_id collegato a auth.users

-- 1) Abilita RLS
ALTER TABLE public."Servizi_supa" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Automezzi_Supa" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tesserati_supa ENABLE ROW LEVEL SECURITY;

-- 2) Servizi: solo utenti autenticati
DROP POLICY IF EXISTS "operatori_leggono_servizi" ON public."Servizi_supa";
CREATE POLICY "operatori_leggono_servizi"
ON public."Servizi_supa"
FOR SELECT
TO authenticated
USING (true);

-- 2b) Servizi: operatori con permesso Calendario possono aggiornare
DROP POLICY IF EXISTS "operatori_aggiornano_servizi" ON public."Servizi_supa";
CREATE POLICY "operatori_aggiornano_servizi"
ON public."Servizi_supa"
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_permissions up
    WHERE up.user_id = auth.uid()
    AND (up.is_admin = true OR up."Calendario" = true)
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.user_permissions up
    WHERE up.user_id = auth.uid()
    AND (up.is_admin = true OR up."Calendario" = true)
  )
);

-- 3) Automezzi: solo utenti autenticati
DROP POLICY IF EXISTS "operatori_leggono_automezzi" ON public."Automezzi_Supa";
CREATE POLICY "operatori_leggono_automezzi"
ON public."Automezzi_Supa"
FOR SELECT
TO authenticated
USING (true);

-- 4) Permessi: ogni utente legge solo la propria riga
DROP POLICY IF EXISTS "utente_legge_propri_permessi" ON public.user_permissions;
CREATE POLICY "utente_legge_propri_permessi"
ON public.user_permissions
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

-- 5) Tesserati: nominativi (solo lettura, autenticati)
DROP POLICY IF EXISTS "operatori_leggono_tesserati" ON public.tesserati_supa;
CREATE POLICY "operatori_leggono_tesserati"
ON public.tesserati_supa
FOR SELECT
TO authenticated
USING (true);

-- 6) Esempio: collega un utente Auth ai permessi calendario
-- Sostituisci UUID e username con i tuoi valori reali.
--
-- INSERT INTO public.user_permissions (user_id, username, "Calendario", "Programma")
-- VALUES (
--   'UUID-DEL-UTENTE-AUTH',
--   'mario.rossi',
--   true,
--   true
-- );
