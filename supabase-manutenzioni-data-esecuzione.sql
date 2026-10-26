-- Adegua Data = data di ESECUZIONE (non più obbligatoria alla programmazione).
-- Esegui in Supabase → SQL Editor se hai già creato Manutenzioni_supa.

ALTER TABLE public."Manutenzioni_supa"
    ALTER COLUMN "Data" DROP NOT NULL;

COMMENT ON COLUMN public."Manutenzioni_supa"."Data" IS
    'Data di esecuzione reale della manutenzione (valorizzata al completamento)';

COMMENT ON COLUMN public."Manutenzioni_supa"."DataPrevista" IS
    'Data soglia alert tipo Giorni (giorno programmazione + DeltaGiorni)';
