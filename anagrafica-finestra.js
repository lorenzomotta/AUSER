/**
 * Impostazione della finestra Anagrafica socio.
 *
 * PROVA a tutto schermo: lascia true.
 * Per tornare alla finestra piccola di prima (1100×680): metti false.
 * La ricerca soci resta sempre nella finestra compatta.
 */
export const ANAGRAFICA_SCHERMO_INTERO = true;

/** Misure della finestra com'era prima della prova a tutto schermo. */
export const ANAGRAFICA_FINESTRA_COMPATTA = {
    width: 1100,
    height: 680,
    resizable: true,
    maximized: false,
    decorations: true,
    center: true
};

/**
 * Opzioni della finestra scheda socio (esistente o nuovo).
 * A tutto schermo le misure 1100×680 restano quelle del pulsante «ripristina».
 */
export function opzioniFinestraAnagrafica({ url, title }) {
    return {
        url,
        title,
        width: ANAGRAFICA_FINESTRA_COMPATTA.width,
        height: ANAGRAFICA_FINESTRA_COMPATTA.height,
        resizable: true,
        maximized: ANAGRAFICA_SCHERMO_INTERO,
        decorations: true,
        center: true
    };
}

/** Se la scheda era già aperta, la riporta a tutto schermo quando la prova è attiva. */
export async function preparaFinestraAnagraficaEsistente(existing) {
    await existing.unminimize().catch(() => {});
    if (ANAGRAFICA_SCHERMO_INTERO) {
        await existing.maximize().catch(() => {});
    }
    await existing.show();
    await existing.setFocus();
}
