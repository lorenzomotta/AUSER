-- Preavviso manutenzioni: quanti giorni/km PRIMA della soglia iniziare ad avvisare (giallo).
-- Esegui in Supabase → SQL Editor (una sola volta).
-- Tipologia Giorni → valore in giorni (es. 10)
-- Tipologia Km     → valore in km (es. 40)

ALTER TABLE public."Manutenzioni_supa"
    ADD COLUMN IF NOT EXISTS "Preavviso" numeric;

COMMENT ON COLUMN public."Manutenzioni_supa"."Preavviso" IS
    'Quanto prima avvisare: giorni (tipologia Giorni) o km (tipologia Km). NULL = solo alert a scadenza (rosso)';
