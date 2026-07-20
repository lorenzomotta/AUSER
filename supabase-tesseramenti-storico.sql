-- Opzionale: se un giorno vuoi impedire due tesseramenti dello stesso anno
-- per lo stesso socio, puoi aggiungere questo vincolo in Supabase SQL Editor.
-- L'app OGGI non ne ha bisogno: modifica con PATCH sull'id, nuovo con INSERT.

-- ALTER TABLE public."Tesseramenti_supa"
--   ADD CONSTRAINT tesseramenti_idsocio_anno_unique UNIQUE ("IdSocio", "Anno");
