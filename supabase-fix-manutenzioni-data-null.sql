-- FIX: permette Data vuota sulle manutenzioni ancora aperte.
-- Esegui in Supabase → SQL Editor → Run (una sola volta).

ALTER TABLE public."Manutenzioni_supa"
    ALTER COLUMN "Data" DROP NOT NULL;

COMMENT ON COLUMN public."Manutenzioni_supa"."Data" IS
    'Data di esecuzione reale della manutenzione (valorizzata al completamento; NULL se ancora aperta)';
