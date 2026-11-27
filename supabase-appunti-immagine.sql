-- Foto negli appunti dell'agenda
-- Supabase → SQL Editor → incolla questo testo → Run
-- Poi chiudi e riapri l'Agenda.

ALTER TABLE public.appunti_utente
    ADD COLUMN IF NOT EXISTS immagine text NOT NULL DEFAULT '';

NOTIFY pgrst, 'reload schema';
