// Verifica anomalie nei dati di tesseramento (solo admin / permesso sidebar)
import { richiediSessione } from './auth-session.js';
import { puoVedereSidebar } from './sidebar-permessi.js';
import { opzioniFinestraAnagrafica } from './anagrafica-finestra.js';

let invoke;
/** @type {Array<object>} */
let tuttiTesseramenti = [];
/** @type {Record<string, object[]>} */
let risultati = {
    duplicati: [],
    'senza-entrambi': [],
    'numero-senza-data': [],
    'data-senza-numero': []
};

const CHECK_IDS = ['duplicati', 'senza-entrambi', 'numero-senza-data', 'data-senza-numero'];

async function initTauri() {
    try {
        const tauriModule = await import('@tauri-apps/api/tauri');
        invoke = tauriModule.invoke;
        return true;
    } catch (error) {
        console.error('Errore API Tauri:', error);
        return false;
    }
}

function isTauri() {
    return typeof window !== 'undefined' &&
        (window.__TAURI_INTERNALS__ !== undefined ||
            window.__TAURI_IPC__ !== undefined);
}

function escapeHtml(str) {
    if (str === undefined || str === null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function vuoto(val) {
    return String(val ?? '').trim() === '';
}

/** Allinea IdSocio (trim + togli zeri inutili), come nel backend. */
function normalizeIdsocio(id) {
    const trimmed = String(id ?? '').trim();
    if (!trimmed) return '';
    if (/^\d+$/.test(trimmed)) {
        return String(parseInt(trimmed, 10));
    }
    return trimmed;
}

/** Etichetta finestra Tauri: solo caratteri ammessi. */
function labelAnagrafica(idsocio) {
    const safe = String(idsocio).replace(/[^a-zA-Z0-9_-]/g, '_');
    return `anagrafica-socio-${safe || 'x'}`;
}

function annoSelezionato() {
    const sel = document.getElementById('vt-anno');
    return String(sel?.value || new Date().getFullYear());
}

function popolaSelectAnno(lista) {
    const sel = document.getElementById('vt-anno');
    if (!sel) return;

    const corrente = new Date().getFullYear();
    const anni = new Set([corrente]);
    for (const t of lista) {
        const a = parseInt(String(t.anno || '').trim(), 10);
        if (Number.isFinite(a) && a >= 1990 && a <= corrente + 1) anni.add(a);
    }

    const sorted = [...anni].sort((a, b) => b - a);
    const prev = sel.value;
    sel.innerHTML = sorted.map((a) => `<option value="${a}">${a}</option>`).join('');
    if (prev && sorted.includes(parseInt(prev, 10))) sel.value = prev;
    else sel.value = String(corrente);
}

function calcolaAnomalie() {
    const anno = annoSelezionato();

    // 1) Stesso socio con più di un rinnovo per l'anno selezionato
    const perSocio = new Map();
    for (const t of tuttiTesseramenti) {
        if (String(t.anno || '').trim() !== anno) continue;
        const key = normalizeIdsocio(t.idsocio) || String(t.idsocio || '').trim();
        if (!key) continue;
        if (!perSocio.has(key)) perSocio.set(key, []);
        perSocio.get(key).push(t);
    }
    const duplicati = [];
    for (const rows of perSocio.values()) {
        if (rows.length > 1) duplicati.push(...rows);
    }
    duplicati.sort((a, b) =>
        String(a.nominativo || '').localeCompare(String(b.nominativo || ''), 'it', { sensitivity: 'base' })
    );

    // 2) Senza data E senza numero tessera
    const senzaEntrambi = tuttiTesseramenti.filter(
        (t) => vuoto(t.data) && vuoto(t.numero)
    );

    // 3) Con numero ma senza data
    const numeroSenzaData = tuttiTesseramenti.filter(
        (t) => !vuoto(t.numero) && vuoto(t.data)
    );

    // 4) Con data ma senza numero
    const dataSenzaNumero = tuttiTesseramenti.filter(
        (t) => !vuoto(t.data) && vuoto(t.numero)
    );

    risultati = {
        duplicati,
        'senza-entrambi': senzaEntrambi,
        'numero-senza-data': numeroSenzaData,
        'data-senza-numero': dataSenzaNumero
    };

    for (const id of CHECK_IDS) {
        const countEl = document.getElementById(`count-${id}`);
        const n = risultati[id]?.length || 0;
        if (countEl) {
            countEl.textContent = String(n);
            countEl.classList.toggle('has-anomalies', n > 0);
        }
        renderTabella(id);
        // Con anomalie: elenco già aperto; senza: resta chiuso
        setElencoAperto(id, n > 0);
    }
}

/** Apre o chiude l'elenco di un pannello e aggiorna la freccia. */
function setElencoAperto(checkId, aperto) {
    const body = document.getElementById(`body-${checkId}`);
    const btn = document.querySelector(`.vt-btn-freccia[data-show="${checkId}"]`);
    if (!body) return;
    body.hidden = !aperto;
    if (btn) {
        btn.classList.toggle('is-open', aperto);
        btn.textContent = aperto ? '▼' : '▶';
    }
}

function renderTabella(checkId) {
    const tbody = document.getElementById(`rows-${checkId}`);
    if (!tbody) return;

    const rows = risultati[checkId] || [];
    if (!rows.length) {
        tbody.innerHTML = '<tr class="vt-empty"><td colspan="6">Nessuna anomalia trovata</td></tr>';
        return;
    }

    tbody.innerHTML = rows.map((t) => {
        const id = normalizeIdsocio(t.idsocio) || String(t.idsocio || '').trim();
        const collegato = t.collegato === true || (!!t.nominativo && !!id);
        const nome = t.nominativo || (collegato ? '—' : '(senza anagrafica)');
        return `
        <tr class="${collegato ? '' : 'vt-orfano'}"
            data-idsocio="${escapeHtml(id)}"
            data-nominativo="${escapeHtml(t.nominativo || '')}"
            data-collegato="${collegato ? '1' : '0'}">
            <td>${escapeHtml(nome)}</td>
            <td>${escapeHtml(id || '—')}</td>
            <td>${escapeHtml(t.anno || '')}</td>
            <td>${escapeHtml(t.numero || '')}</td>
            <td>${escapeHtml(t.data || '')}</td>
            <td>${escapeHtml(t.tipologia || '')}</td>
        </tr>`;
    }).join('');
}

function setStato(testo) {
    const el = document.getElementById('vt-stato');
    if (el) el.textContent = testo || '';
}

async function caricaDati() {
    setStato('Caricamento…');
    if (!invoke) {
        setStato('Solo in app Tauri');
        alert('Questa videata funziona nell\'applicazione Tauri.');
        return;
    }

    try {
        try {
            await invoke('init_supabase_from_config');
        } catch (initErr) {
            console.warn('Init Supabase:', initErr);
        }

        const list = await invoke('get_all_tesseramenti');
        tuttiTesseramenti = Array.isArray(list) ? list : [];
        popolaSelectAnno(tuttiTesseramenti);
        calcolaAnomalie();
        const orfani = tuttiTesseramenti.filter((t) => t.collegato === false).length;
        setStato(
            orfani > 0
                ? `${tuttiTesseramenti.length} tesseramenti (${orfani} senza anagrafica)`
                : `${tuttiTesseramenti.length} tesseramenti`
        );
    } catch (error) {
        console.error('Errore caricamento tesseramenti:', error);
        setStato('Errore');
        alert(`Impossibile caricare i tesseramenti:\n${error?.message || error}`);
    }
}

function toggleElenco(checkId) {
    const body = document.getElementById(`body-${checkId}`);
    if (!body) return;
    setElencoAperto(checkId, body.hidden);
}

async function openAnagraficaSocio(idsocioRaw, nominativo, collegato) {
    const idsocio = normalizeIdsocio(idsocioRaw) || String(idsocioRaw || '').trim();

    if (!idsocio) {
        alert(
            'Questa riga non ha un IdSocio valido.\n' +
            'È un tesseramento “orfano”: correggilo da Supabase o crea/collega il socio in anagrafica.'
        );
        return;
    }

    if (collegato === false || collegato === '0') {
        const ok = confirm(
            `Il tesseramento con IdSocio ${idsocio} non risulta collegato all'anagrafica soci.\n\n` +
            'Vuoi provare comunque ad aprire l\'anagrafica?'
        );
        if (!ok) return;
    }

    const url = `ANAGRAFICASOCI.html?idsocio=${encodeURIComponent(idsocio)}`;
    const title = nominativo
        ? `Anagrafica — ${nominativo}`
        : `Anagrafica socio ${idsocio}`;

    if (!isTauri()) {
        window.open(url, '_blank');
        return;
    }

    try {
        const { WebviewWindow } = await import('@tauri-apps/api/window');
        const label = labelAnagrafica(idsocio);
        const existing = WebviewWindow.getByLabel(label);
        if (existing) {
            // Ricarica sempre l'URL corretto (evita finestra vecchia con errore "non trovato")
            try {
                await existing.close();
            } catch (_) { /* ignore */ }
        }
        const webview = new WebviewWindow(label, opzioniFinestraAnagrafica({ url, title }));
        webview.once?.('tauri://error', (e) => {
            console.error('Errore finestra anagrafica:', e);
        });
    } catch (error) {
        console.error('Errore apertura anagrafica:', error);
        alert(`Impossibile aprire l'anagrafica: ${error?.message || error}`);
    }
}

async function chiudiFinestra() {
    if (isTauri()) {
        try {
            const { getCurrent, WebviewWindow } = await import('@tauri-apps/api/window');
            const currentWindow = getCurrent();
            const label = currentWindow?.label || '';

            if (label === 'verifica-tesseramenti') {
                try {
                    const mainWin = WebviewWindow.getByLabel('main');
                    if (mainWin) {
                        await mainWin.show();
                        await mainWin.setFocus();
                    }
                } catch (_) { /* ignore */ }
                await currentWindow.close();
                return;
            }

            window.location.href = 'index.html';
            return;
        } catch (err) {
            console.warn('Chiusura:', err);
            window.location.href = 'index.html';
            return;
        }
    }
    if (window.opener) window.close();
    else window.location.href = 'index.html';
}

document.addEventListener('DOMContentLoaded', async () => {
    const sessione = await richiediSessione();
    if (!sessione) return;
    if (!puoVedereSidebar('verifica_tesseramenti', sessione)) {
        alert('Non hai il permesso per questa pagina.');
        window.location.href = 'index.html';
        return;
    }

    await initTauri();

    document.getElementById('btn-chiudi')?.addEventListener('click', chiudiFinestra);
    document.getElementById('btn-ricarica')?.addEventListener('click', caricaDati);
    document.getElementById('vt-anno')?.addEventListener('change', calcolaAnomalie);

    document.querySelectorAll('.vt-btn-freccia').forEach((btn) => {
        btn.addEventListener('click', () => toggleElenco(btn.dataset.show));
    });

    document.querySelectorAll('.vt-table tbody').forEach((tbody) => {
        tbody.addEventListener('click', (ev) => {
            const tr = ev.target.closest('tr[data-idsocio]');
            if (!tr || tr.classList.contains('vt-empty')) return;
            openAnagraficaSocio(
                tr.dataset.idsocio,
                tr.dataset.nominativo,
                tr.dataset.collegato
            );
        });
    });

    await caricaDati();
});
