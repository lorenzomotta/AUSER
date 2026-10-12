-- AGGIORNAMENTO appunti (esegui questo se hai già creato appunti_utente)
-- Supabase → SQL Editor → Run
-- Poi riprova AGGIUNGI in app.

ALTER TABLE public.appunti_utente
    ADD COLUMN IF NOT EXISTS visibilita text NOT NULL DEFAULT 'privato';

ALTER TABLE public.appunti_utente
    ADD COLUMN IF NOT EXISTS autore_username text NOT NULL DEFAULT '';

ALTER TABLE public.appunti_utente
    DROP CONSTRAINT IF EXISTS appunti_utente_visibilita_check;

ALTER TABLE public.appunti_utente
    ADD CONSTRAINT appunti_utente_visibilita_check
    CHECK (visibilita IN ('privato', 'selezionati', 'tutti'));

CREATE INDEX IF NOT EXISTS appunti_utente_data_vis_idx
    ON public.appunti_utente (data, visibilita);

CREATE TABLE IF NOT EXISTS public.appunti_destinatari (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    appunto_id uuid NOT NULL REFERENCES public.appunti_utente (id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (appunto_id, user_id)
);

CREATE INDEX IF NOT EXISTS appunti_destinatari_user_idx
    ON public.appunti_destinatari (user_id);

CREATE INDEX IF NOT EXISTS appunti_destinatari_appunto_idx
    ON public.appunti_destinatari (appunto_id);

ALTER TABLE public.appunti_destinatari ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "appunti_dest_select" ON public.appunti_destinatari;
CREATE POLICY "appunti_dest_select"
    ON public.appunti_destinatari
    FOR SELECT
    TO authenticated
    USING (
        auth.uid() = user_id
        OR EXISTS (
            SELECT 1 FROM public.appunti_utente a
            WHERE a.id = appunti_destinatari.appunto_id
              AND a.user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "appunti_dest_insert" ON public.appunti_destinatari;
CREATE POLICY "appunti_dest_insert"
    ON public.appunti_destinatari
    FOR INSERT
    TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.appunti_utente a
            WHERE a.id = appunto_id
              AND a.user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "appunti_dest_delete" ON public.appunti_destinatari;
CREATE POLICY "appunti_dest_delete"
    ON public.appunti_destinatari
    FOR DELETE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.appunti_utente a
            WHERE a.id = appunto_id
              AND a.user_id = auth.uid()
        )
    );

GRANT SELECT, INSERT, DELETE ON public.appunti_destinatari TO authenticated;
GRANT ALL ON public.appunti_destinatari TO service_role;

-- Aggiorna la cache di PostgREST (altrimenti resta l'errore PGRST204)
NOTIFY pgrst, 'reload schema';
