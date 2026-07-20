/**
 * Controllo aggiornamenti con messaggi in italiano.
 * Richiede updater.dialog = false in tauri.conf.json
 */

function isTauri() {
    return typeof window !== 'undefined' &&
        (window.__TAURI_INTERNALS__ !== undefined ||
            window.__TAURI_IPC__ !== undefined);
}

/**
 * Controlla se c'è una nuova versione e chiede all'utente (in italiano).
 * Se conferma: scarica, installa e riavvia l'app.
 */
export async function controllaAggiornamenti() {
    if (!isTauri()) return;

    try {
        const { checkUpdate, installUpdate } = await import('@tauri-apps/api/updater');
        const { ask, message } = await import('@tauri-apps/api/dialog');
        const { relaunch } = await import('@tauri-apps/api/process');
        const { getVersion } = await import('@tauri-apps/api/app');

        const { shouldUpdate, manifest } = await checkUpdate();
        if (!shouldUpdate || !manifest) return;

        const versioneAttuale = await getVersion();
        const versioneNuova = manifest.version || '?';
        const note = String(manifest.body || '').trim();

        let testo =
            `È disponibile la versione ${versioneNuova}.\n` +
            `Ora hai installata la ${versioneAttuale}.\n\n` +
            `Vuoi installare l'aggiornamento ora?`;

        if (note) {
            // Limita le note per non riempire tutto lo schermo
            const noteBrevi = note.length > 400 ? `${note.slice(0, 400)}…` : note;
            testo += `\n\nNovità:\n${noteBrevi}`;
        }

        const conferma = await ask(testo, {
            title: 'Aggiornamento disponibile',
            type: 'info',
            okLabel: 'Sì, aggiorna',
            cancelLabel: 'Non ora'
        });

        if (!conferma) return;

        await installUpdate();
        await relaunch();
    } catch (error) {
        console.warn('Controllo aggiornamenti:', error);
        try {
            const { message } = await import('@tauri-apps/api/dialog');
            await message(
                `Non è stato possibile completare l'aggiornamento.\n\n${error?.message || error}`,
                { title: 'Errore aggiornamento', type: 'error' }
            );
        } catch (_) {
            /* ignore */
        }
    }
}
