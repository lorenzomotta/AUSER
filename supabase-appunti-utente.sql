-- Appunti personali / condivisi (agenda giornaliera)
-- Esegui in Supabase → SQL Editor.
-- Se hai già creato la tabella base, lo script aggiunge le colonne e la tabella destinatari.

CREATE TABLE IF NOT EXISTS public.appunti_utente (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
    data date NOT NULL,
    testo text NOT NULL DEFAULT '',
    fatto boolean NOT NULL DEFAULT false,
    ordine integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- Visibilità: privato | selezionati | tutti
ALTER TABLE public.appunti_utente
    ADD COLUMN IF NOT EXISTS visibilita text NOT NULL DEFAULT 'privato';

ALTER TABLE public.appunti_utente
    ADD COLUMN IF NOT EXISTS autore_username text NOT NULL DEFAULT '';

ALTER TABLE public.appunti_utente
    DROP CONSTRAINT IF EXISTS appunti_utente_visibilita_check;

ALTER TABLE public.appunti_utente
    ADD CONSTRAINT appunti_utente_visibilita_check
    CHECK (visibilita IN ('privato', 'selezionati', 'tutti'));

CREATE INDEX IF NOT EXISTS appunti_utente_user_data_idx
    ON public.appunti_utente (user_id, data);

CREATE INDEX IF NOT EXISTS appunti_utente_data_vis_idx
    ON public.appunti_utente (data, visibilita);

COMMENT ON TABLE public.appunti_utente IS
    'Appunti agenda: privati, verso utenti scelti, o visibili a tutti';

-- Destinatari (solo se visibilita = selezionati)
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

COMMENT ON TABLE public.appunti_destinatari IS
    'Utenti che possono vedere un appunto con visibilita=selezionati';

-- RLS appunti
ALTER TABLE public.appunti_utente ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "appunti_select_own" ON public.appunti_utente;
DROP POLICY IF EXISTS "appunti_select_visible" ON public.appunti_utente;
CREATE POLICY "appunti_select_visible"
    ON public.appunti_utente
    FOR SELECT
    TO authenticated
    USING (
        auth.uid() = user_id
        OR visibilita = 'tutti'
        OR EXISTS (
            SELECT 1 FROM public.appunti_destinatari d
            WHERE d.appunto_id = appunti_utente.id
              AND d.user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "appunti_insert_own" ON public.appunti_utente;
CREATE POLICY "appunti_insert_own"
    ON public.appunti_utente
    FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "appunti_update_own" ON public.appunti_utente;
CREATE POLICY "appunti_update_own"
    ON public.appunti_utente
    FOR UPDATE
    TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "appunti_delete_own" ON public.appunti_utente;
CREATE POLICY "appunti_delete_own"
    ON public.appunti_utente
    FOR DELETE
    TO authenticated
    USING (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.appunti_utente TO authenticated;
GRANT ALL ON public.appunti_utente TO service_role;

-- RLS destinatari
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

-- Aggiorna la cache di PostgREST (evita errore PGRST204 sulle colonne nuove)
NOTIFY pgrst, 'reload schema';

