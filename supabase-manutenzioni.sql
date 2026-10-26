-- Manutenzioni mezzi (programmate per Km o Giorni)
-- Esegui in Supabase → SQL Editor (una sola volta).
-- L'app desktop Tauri usa la secret key: legge/scrive anche senza policy utente.

CREATE TABLE IF NOT EXISTS public."Manutenzioni_supa" (
    "IdManutenzione" bigserial PRIMARY KEY,
    "IdMezzo" integer NOT NULL,
    -- Data = giorno in cui la manutenzione È STATA FATTA (vuota finché aperta)
    "Data" date,
    "Tipologia" text NOT NULL,
    "Motivazione" text NOT NULL DEFAULT '',
    "EseguitaPresso" text NOT NULL DEFAULT '',
    "Pagato" numeric,
    "NoteManutenzione" text NOT NULL DEFAULT '',
    "Operatore" text NOT NULL DEFAULT '',
    "DeltaGiorni" integer,
    "DeltaChilometri" numeric,
    -- Aggiunte: riferimento e soglia per l'alert
    "KmRiferimento" numeric,
    "KmPrevisto" numeric,
    "DataPrevista" date,
    "Stato" text NOT NULL DEFAULT 'aperta',
    created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public."Manutenzioni_supa"
    DROP CONSTRAINT IF EXISTS manutenzioni_tipologia_check;
ALTER TABLE public."Manutenzioni_supa"
    ADD CONSTRAINT manutenzioni_tipologia_check
    CHECK ("Tipologia" IN ('Km', 'Giorni'));

ALTER TABLE public."Manutenzioni_supa"
    DROP CONSTRAINT IF EXISTS manutenzioni_stato_check;
ALTER TABLE public."Manutenzioni_supa"
    ADD CONSTRAINT manutenzioni_stato_check
    CHECK ("Stato" IN ('aperta', 'eseguita', 'annullata'));

CREATE INDEX IF NOT EXISTS manutenzioni_idmezzo_idx
    ON public."Manutenzioni_supa" ("IdMezzo");

CREATE INDEX IF NOT EXISTS manutenzioni_stato_idx
    ON public."Manutenzioni_supa" ("Stato");

COMMENT ON TABLE public."Manutenzioni_supa" IS
    'Manutenzioni programmate per mezzo: alert per Km o per Giorni';
COMMENT ON COLUMN public."Manutenzioni_supa"."Data" IS
    'Data di esecuzione reale della manutenzione (valorizzata al completamento)';
COMMENT ON COLUMN public."Manutenzioni_supa"."KmRiferimento" IS
    'Chilometraggio al momento della programmazione';
COMMENT ON COLUMN public."Manutenzioni_supa"."KmPrevisto" IS
    'Soglia km (KmRiferimento + DeltaChilometri)';
COMMENT ON COLUMN public."Manutenzioni_supa"."DataPrevista" IS
    'Data soglia alert tipo Giorni (giorno programmazione + DeltaGiorni)';
COMMENT ON COLUMN public."Manutenzioni_supa"."Stato" IS
    'aperta | eseguita | annullata — solo le aperte generano alert';

-- Se la tabella esisteva già con Data NOT NULL, allenta il vincolo:
ALTER TABLE public."Manutenzioni_supa"
    ALTER COLUMN "Data" DROP NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."Manutenzioni_supa" TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public."Manutenzioni_supa_IdManutenzione_seq" TO authenticated;

ALTER TABLE public."Manutenzioni_supa" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "manutenzioni_select_authenticated" ON public."Manutenzioni_supa";
CREATE POLICY "manutenzioni_select_authenticated"
    ON public."Manutenzioni_supa"
    FOR SELECT
    TO authenticated
    USING (true);

DROP POLICY IF EXISTS "manutenzioni_insert_authenticated" ON public."Manutenzioni_supa";
CREATE POLICY "manutenzioni_insert_authenticated"
    ON public."Manutenzioni_supa"
    FOR INSERT
    TO authenticated
    WITH CHECK (true);

DROP POLICY IF EXISTS "manutenzioni_update_authenticated" ON public."Manutenzioni_supa";
CREATE POLICY "manutenzioni_update_authenticated"
    ON public."Manutenzioni_supa"
    FOR UPDATE
    TO authenticated
    USING (true)
    WITH CHECK (true);

DROP POLICY IF EXISTS "manutenzioni_delete_authenticated" ON public."Manutenzioni_supa";
CREATE POLICY "manutenzioni_delete_authenticated"
    ON public."Manutenzioni_supa"
    FOR DELETE
    TO authenticated
    USING (true);
