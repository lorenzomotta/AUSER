-- Esegui questo blocco nel SQL Editor di Supabase (una volta).
-- Fa di nuovo vedere i servizi nel calendario web/telefono.

GRANT SELECT ON TABLE public."Servizi_supa" TO authenticated;
GRANT SELECT ON TABLE public."Automezzi_Supa" TO authenticated;
GRANT SELECT ON TABLE public.tesserati_supa TO authenticated;
GRANT SELECT ON TABLE public."Telefoni_supa" TO authenticated;
GRANT SELECT ON TABLE public.user_permissions TO authenticated;

DROP POLICY IF EXISTS "operatori_leggono_servizi" ON public."Servizi_supa";
CREATE POLICY "operatori_leggono_servizi"
ON public."Servizi_supa"
FOR SELECT
TO authenticated
USING (true);

DROP POLICY IF EXISTS "operatori_leggono_automezzi" ON public."Automezzi_Supa";
CREATE POLICY "operatori_leggono_automezzi"
ON public."Automezzi_Supa"
FOR SELECT
TO authenticated
USING (true);
