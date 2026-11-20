-- Permesso backup Proton Drive per utente
-- Esegui in Supabase → SQL Editor (una sola volta).

ALTER TABLE public.user_permissions
    ADD COLUMN IF NOT EXISTS "ProtonDrive" boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.user_permissions."ProtonDrive" IS
    'Se true, alla chiusura dell''app chiede se fare backup su Proton Drive';
