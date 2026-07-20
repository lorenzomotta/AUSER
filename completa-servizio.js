// Modale Completa Servizio — stesso schema di Modifica, sezione chiusura per prima

import {
    caricaDatiModificaServizio,
    ensureDatiFormServizioCaricati,
    costruisciFormServizio,
    setupFormServizioListeners,
    raccogliPayloadServizio
} from './modifica-servizio.js';

let getInvokeFn = () => null;
let isTauriEnv = () => false;
let onSaveSuccess = async () => {};
let trovaServizioLocal = () => null;

let servizioInCompletamento = null;

const MODALE_COMPLETA_MARKUP = `
<div id="modal-completa" class="modal-modifica-overlay modal-completa-overlay" style="display: none;" aria-hidden="true">
    <div class="modal-modifica-content" role="dialog" aria-labelledby="modal-completa-title">
        <header class="ns-header modal-modifica-header modal-completa-header">
            <h1 class="ns-title" id="modal-completa-title">COMPLETA SERVIZIO</h1>
            <div class="ns-header-right">
                <button type="button" class="btn btn-annulla" id="btn-annulla-completa">ANNULLA</button>
                <button type="button" class="btn btn-salva" id="btn-salva-completa">SALVA</button>
            </div>
        </header>
        <div class="modal-modifica-body" id="modal-completa-body"></div>
    </div>
</div>`;

function injectModaleCompletaMarkup() {
    if (document.getElementById('modal-completa')) return;
    document.body.insertAdjacentHTML('beforeend', MODALE_COMPLETA_MARKUP);
}

export function initCompletaServizio(options = {}) {
    getInvokeFn = options.getInvoke || (() => null);
    isTauriEnv = options.isTauriEnv || (() => false);
    onSaveSuccess = options.onSaveSuccess || (async () => {});
    trovaServizioLocal = options.trovaServizioLocal || (() => null);
}

function mostraErroreCompleta(messaggio) {
    const body = document.getElementById('modal-completa-body');
    const modal = document.getElementById('modal-completa');
    const testo = String(messaggio || 'Errore sconosciuto')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

    if (body && modal) {
        body.innerHTML = `<p class="modifica-errore">${testo}</p>`;
        modal.style.display = 'flex';
        modal.setAttribute('aria-hidden', 'false');
    }
    console.error('Completa servizio:', messaggio);
}

export function chiudiModalCompleta() {
    const modal = document.getElementById('modal-completa');
    if (!modal) return;
    modal.style.display = 'none';
    modal.setAttribute('aria-hidden', 'true');
    servizioInCompletamento = null;
}

export async function apriModalCompleta(servizioId) {
    const modal = document.getElementById('modal-completa');
    const body = document.getElementById('modal-completa-body');
    const title = document.getElementById('modal-completa-title');

    if (!modal || !body) {
        mostraErroreCompleta('Modale completa servizio non trovato nella pagina.');
        return;
    }

    const idNumerico = parseInt(servizioId, 10);
    if (!idNumerico || Number.isNaN(idNumerico)) {
        mostraErroreCompleta('ID servizio non valido.');
        return;
    }

    const invoke = getInvokeFn();
    let servizio = trovaServizioLocal(servizioId);

    if (isTauriEnv() && invoke) {
        try {
            await invoke('init_supabase_from_config').catch(() => {});
            await ensureDatiFormServizioCaricati();
            servizio = await invoke('get_servizio_completo', { servizioId: idNumerico });
        } catch (error) {
            console.warn('Caricamento servizio da server:', error);
            if (!servizio) {
                mostraErroreCompleta('Impossibile caricare il servizio: ' + (error.message || error));
                return;
            }
        }
    }

    if (!servizio) {
        mostraErroreCompleta('Servizio non trovato.');
        return;
    }

    servizioInCompletamento = servizio;
    if (title) title.textContent = `COMPLETA SERVIZIO ${servizio.id || ''}`;
    body.innerHTML = costruisciFormServizio(servizio, {
        idPrefix: 'comp',
        chiusuraPrima: true,
        mostraArchivia: false,
        pagamentoSecondo: true
    });
    setupFormServizioListeners('comp');
    modal.style.display = 'flex';
    modal.setAttribute('aria-hidden', 'false');
}

async function salvaCompletaServizio() {
    const payload = raccogliPayloadServizio('comp');
    if (!payload.id || Number.isNaN(payload.id)) {
        mostraErroreCompleta('ID servizio non valido.');
        return;
    }

    // ARCHIVIA non è nel form Completa: mantieni il valore già presente sul servizio
    const archiviaOrig = servizioInCompletamento?.archivia;
    payload.archivia = ['true', 'si', 'sì', '1', 'yes'].includes(String(archiviaOrig || '').trim().toLowerCase())
        ? 'SI'
        : 'NO';

    const btnSalva = document.getElementById('btn-salva-completa');
    if (btnSalva) btnSalva.disabled = true;

    try {
        const invoke = getInvokeFn();
        if (isTauriEnv() && invoke) {
            await invoke('init_supabase_from_config').catch(() => {});
            await invoke('update_servizio_completo', { payload });
            const aggiornato = await invoke('get_servizio_completo', { servizioId: payload.id });
            await onSaveSuccess(aggiornato, payload);
            chiudiModalCompleta();
        } else {
            await onSaveSuccess({ ...servizioInCompletamento, ...payload, id: String(payload.id) }, payload);
            chiudiModalCompleta();
        }
    } catch (error) {
        console.error('Errore salvataggio completa servizio:', error);
        mostraErroreCompleta('Errore nel salvataggio: ' + (error.message || error));
    } finally {
        if (btnSalva) btnSalva.disabled = false;
    }
}

export function setupModaleCompleta() {
    injectModaleCompletaMarkup();

    document.getElementById('btn-annulla-completa')?.addEventListener('click', chiudiModalCompleta);
    document.getElementById('btn-salva-completa')?.addEventListener('click', salvaCompletaServizio);

    const modal = document.getElementById('modal-completa');
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) chiudiModalCompleta();
        });
    }

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal?.style.display === 'flex') {
            chiudiModalCompleta();
        }
    });
}

export { caricaDatiModificaServizio as caricaDatiCompletaServizio };
