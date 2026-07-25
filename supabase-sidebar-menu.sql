-- Permessi sidebar per utente (Gestione utenti → Programma)
-- Esegui questo script una volta in Supabase → SQL Editor.

ALTER TABLE user_permissions
ADD COLUMN IF NOT EXISTS "SidebarMenu" text;

COMMENT ON COLUMN user_permissions."SidebarMenu" IS
  'JSON delle voci sidebar consentite (es. {"calendario_servizi":true,...})';
