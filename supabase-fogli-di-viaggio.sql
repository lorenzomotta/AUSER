-- Fogli di viaggio: vista sempre allineata a Servizi_supa.
-- Esegui in Supabase → SQL Editor.
-- Puoi rieseguirlo: se FogliDiViaggio è ancora una tabella, la sostituisce con la vista.
-- I dati restano solo in Servizi_supa. La vista li rilegge ogni volta che la apri.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'FogliDiViaggio'
      AND c.relkind = 'r'
  ) THEN
    EXECUTE 'DROP TABLE public."FogliDiViaggio"';
  END IF;
END $$;

CREATE OR REPLACE VIEW public."FogliDiViaggio"
WITH (security_invoker = true) AS
SELECT
  s.idservizio AS id,
  s.created_at,
  s."Mezzo",
  s."Km_Uscita" AS "Km_Partenza",
  s."Km_Rientro" AS "Km_Arrivo",
  s."Oper" AS "Operatore",
  s."Trasportato",
  trim(both ', ' FROM concat_ws(', ', s."Prelievo_Comune", s."Prelievo_Indirizzo")) AS "Partenza",
  trim(both ', ' FROM concat_ws(', ', s."Destinazione_Comune", s."Destinazione_Indirizzo")) AS "Destinazione",
  s."Motivazione",
  s."NoteFineServizio" AS "Note_Finali",
  s."Prelievo_Data"::date AS "Data",
  (s."Km_Rientro" - s."Km_Uscita") AS "Km"
FROM public."Servizi_supa" s;

COMMENT ON VIEW public."FogliDiViaggio" IS
  'Finestra sui servizi: si aggiorna da sola. Km = Km_Rientro - Km_Uscita.';

GRANT SELECT ON public."FogliDiViaggio" TO authenticated, service_role;
