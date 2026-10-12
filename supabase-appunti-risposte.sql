-- Risposte / chat sotto gli appunti condivisi
-- Supabase → SQL Editor → Run

CREATE TABLE IF NOT EXISTS public.appunti_risposte (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    appunto_id uuid NOT NULL REFERENCES public.appunti_utente (id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
    username text NOT NULL DEFAULT '',
    testo text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS appunti_risposte_appunto_idx
    ON public.appunti_risposte (appunto_id, created_at);

CREATE INDEX IF NOT EXISTS appunti_risposte_user_idx
    ON public.appunti_risposte (user_id);

COMMENT ON TABLE public.appunti_risposte IS
    'Risposte alla chat pubblica di un appunto condiviso';

ALTER TABLE public.appunti_risposte ENABLE ROW LEVEL SECURITY;

-- Chi può leggere: autore appunto, destinatario, o appunto "tutti"
DROP POLICY IF EXISTS "appunti_risposte_select" ON public.appunti_risposte;
CREATE POLICY "appunti_risposte_select"
    ON public.appunti_risposte
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.appunti_utente a
            WHERE a.id = appunti_risposte.appunto_id
              AND (
                  a.user_id = auth.uid()
                  OR a.visibilita = 'tutti'
                  OR EXISTS (
                      SELECT 1 FROM public.appunti_destinatari d
                      WHERE d.appunto_id = a.id AND d.user_id = auth.uid()
                  )
              )
        )
    );

DROP POLICY IF EXISTS "appunti_risposte_insert" ON public.appunti_risposte;
CREATE POLICY "appunti_risposte_insert"
    ON public.appunti_risposte
    FOR INSERT
    TO authenticated
    WITH CHECK (
        auth.uid() = user_id
        AND EXISTS (
            SELECT 1 FROM public.appunti_utente a
            WHERE a.id = appunto_id
              AND a.visibilita IN ('selezionati', 'tutti')
              AND (
                  a.user_id = auth.uid()
                  OR a.visibilita = 'tutti'
                  OR EXISTS (
                      SELECT 1 FROM public.appunti_destinatari d
                      WHERE d.appunto_id = a.id AND d.user_id = auth.uid()
                  )
              )
        )
    );

DROP POLICY IF EXISTS "appunti_risposte_delete" ON public.appunti_risposte;
CREATE POLICY "appunti_risposte_delete"
    ON public.appunti_risposte
    FOR DELETE
    TO authenticated
    USING (
        auth.uid() = user_id
        OR EXISTS (
            SELECT 1 FROM public.appunti_utente a
            WHERE a.id = appunti_risposte.appunto_id
              AND a.user_id = auth.uid()
        )
    );

GRANT SELECT, INSERT, DELETE ON public.appunti_risposte TO authenticated;
GRANT ALL ON public.appunti_risposte TO service_role;

NOTIFY pgrst, 'reload schema';
