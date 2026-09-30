-- Esegui TUTTO questo blocco nel SQL Editor di Supabase (una sola volta).
-- Aggiunge la colonna per Autista / Centralista / Nonno Vigile / Scuolabus
-- nella scheda anagrafica socio.

ALTER TABLE public.tesserati_supa
  ADD COLUMN IF NOT EXISTS "Disponibilita" text;

COMMENT ON COLUMN public.tesserati_supa."Disponibilita" IS
  'Ruoli operatore separati da virgola: AUTISTA, CENTRALISTA, NONNO_VIGILE, SCUOLABUS';
