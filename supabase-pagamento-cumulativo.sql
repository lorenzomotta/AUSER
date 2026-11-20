-- Esegui TUTTO questo blocco nel SQL Editor di Supabase (una sola volta).
-- Aggiunge i campi per il pagamento cumulativo sulla tabella servizi.
-- Se hai già eseguito una versione precedente, puoi rilanciare: le colonne
-- già presenti vengono ignorate (IF NOT EXISTS).

ALTER TABLE public."Servizi_supa"
  ADD COLUMN IF NOT EXISTS "PagamentoCumulativo" boolean DEFAULT false;

ALTER TABLE public."Servizi_supa"
  ADD COLUMN IF NOT EXISTS "PagamentoCumulativo_Rif" text;

ALTER TABLE public."Servizi_supa"
  ADD COLUMN IF NOT EXISTS "PagamentoCumulativo_Gruppo" text;

ALTER TABLE public."Servizi_supa"
  ADD COLUMN IF NOT EXISTS "PagamentoCumulativo_Numero" bigint;

COMMENT ON COLUMN public."Servizi_supa"."PagamentoCumulativo" IS
  'true = servizio pagato con bonifico cumulativo';

COMMENT ON COLUMN public."Servizi_supa"."PagamentoCumulativo_Rif" IS
  'CRO / causale del bonifico cumulativo';

COMMENT ON COLUMN public."Servizi_supa"."PagamentoCumulativo_Gruppo" IS
  'Codice interno del gruppo (di solito uguale al Numero)';

COMMENT ON COLUMN public."Servizi_supa"."PagamentoCumulativo_Numero" IS
  'Numero progressivo del gruppo di pagamento cumulativo (es. 1, 2, 3…)';
