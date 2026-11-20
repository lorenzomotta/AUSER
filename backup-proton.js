/**
 * Backup dati Supabase su cartella Proton Drive (alla chiusura app).
 * Memorizza il percorso sul PC e tiene solo gli ultimi 7 backup.
 */

/**
 * @param {object} options
 * @param {() => any} options.getInvoke
 * @param {() => boolean} options.isTauriEnv
 */
export function initBackupProton(options = {}) {
    const getInvoke = options.getInvoke || (() => null);
    const isTauriEnv = options.isTauriEnv || (() => false);

    const overlay = document.getElementById('home-dialog-backup');
    const pathEl = document.getElementById('backup-path');
    const statusEl = document.getElementById('backup-dialog-status');
    const btnSi = document.getElementById('home-dialog-backup-si');
    const btnNo = document.getElementById('home-dialog-backup-no');
    const btnAnnulla = document.getElementById('home-dialog-backup-annulla');
    const btnSfoglia = document.getElementById('backup-btn-sfoglia');

    function setStatus(msg, tipo = '') {
        if (!statusEl) return;
        statusEl.textContent = msg || '';
        statusEl.classList.toggle('error', tipo === 'error');
        statusEl.classList.toggle('ok', tipo === 'ok');
    }

    function setBusy(busy) {
        if (btnSi) btnSi.disabled = !!busy;
        if (btnNo) btnNo.disabled = !!busy;
        if (btnAnnulla) btnAnnulla.disabled = !!busy;
        if (btnSfoglia) btnSfoglia.disabled = !!busy;
        if (pathEl) pathEl.disabled = !!busy;
    }

    async function caricaPercorsoSalvato() {
        const invoke = getInvoke();
        if (!isTauriEnv() || !invoke || !pathEl) return;
        try {
            const settings = await invoke('get_backup_settings');
            const cartella = String(settings?.cartella || '').trim();
            if (cartella) pathEl.value = cartella;
        } catch (err) {
            console.warn('Impostazioni backup non disponibili:', err);
        }
    }

    async function sfogliaCartella() {
        const invoke = getInvoke();
        if (!isTauriEnv() || !invoke) {
            setStatus('Selezione cartella disponibile solo nell\'app desktop', 'error');
            return;
        }
        try {
            const scelta = await invoke('scegli_cartella_backup');
            if (scelta && pathEl) {
                pathEl.value = String(scelta);
                setStatus('');
            }
        } catch (err) {
            console.error('Errore scelta cartella backup:', err);
            setStatus(`Errore: ${err?.message || err}`, 'error');
        }
    }

    /**
     * Mostra il dialogo. Risolve con:
     * - { backup: true, cartella }
     * - { backup: false }  → esci senza backup
     * - { annulla: true }   → resta nell'app
     */
    function chiediBackupAllaChiusura() {
        return new Promise(async (resolve) => {
            if (!overlay || !btnSi || !btnNo) {
                resolve({ backup: false });
                return;
            }

            setBusy(false);
            setStatus('');
            await caricaPercorsoSalvato();

            overlay.hidden = false;
            overlay.setAttribute('aria-hidden', 'false');
            pathEl?.focus();

            const chiudi = (risposta) => {
                overlay.hidden = true;
                overlay.setAttribute('aria-hidden', 'true');
                btnSi.removeEventListener('click', onSi);
                btnNo.removeEventListener('click', onNo);
                btnAnnulla?.removeEventListener('click', onAnnulla);
                btnSfoglia?.removeEventListener('click', onSfoglia);
                resolve(risposta);
            };

            const onSfoglia = (event) => {
                event.preventDefault();
                event.stopPropagation();
                sfogliaCartella();
            };

            const onAnnulla = (event) => {
                event.preventDefault();
                event.stopPropagation();
                chiudi({ annulla: true });
            };

            const onNo = (event) => {
                event.preventDefault();
                event.stopPropagation();
                chiudi({ backup: false });
            };

            const onSi = async (event) => {
                event.preventDefault();
                event.stopPropagation();
                const cartella = String(pathEl?.value || '').trim();
                if (!cartella) {
                    setStatus('Seleziona o digita la cartella Proton Drive', 'error');
                    pathEl?.focus();
                    return;
                }
                const invoke = getInvoke();
                if (!isTauriEnv() || !invoke) {
                    setStatus('Backup disponibile solo nell\'app desktop', 'error');
                    return;
                }

                setBusy(true);
                setStatus('Backup in corso… attendi');
                try {
                    await invoke('init_supabase_from_config').catch(() => {});
                    const result = await invoke('esegui_backup_dati', { cartella });
                    const n = result?.tabelle || 0;
                    const path = result?.cartella_backup || cartella;
                    setStatus(`Backup completato (${n} tabelle) in ${path}`, 'ok');
                    // Piccola pausa così si legge il messaggio, poi chiudi
                    await new Promise((r) => setTimeout(r, 700));
                    chiudi({ backup: true, cartella, result });
                } catch (err) {
                    console.error('Errore backup:', err);
                    setBusy(false);
                    const msg = String(err?.message || err || 'errore sconosciuto');
                    setStatus(`Errore backup: ${msg}`, 'error');
                    // Messaggio lungo: meglio anche un alert leggibile
                    if (msg.toLowerCase().includes('accesso negato') || msg.includes('os error 5')) {
                        window.alert(msg);
                    }
                    // Lascia il dialogo aperto: l'utente può riprovare, uscire o annullare
                }
            };

            btnSi.addEventListener('click', onSi);
            btnNo.addEventListener('click', onNo);
            btnAnnulla?.addEventListener('click', onAnnulla);
            btnSfoglia?.addEventListener('click', onSfoglia);
        });
    }

    return { chiediBackupAllaChiusura, caricaPercorsoSalvato };
}
