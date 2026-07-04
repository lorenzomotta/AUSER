// Report Giornaliero Servizi — dati da Supabase via Tauri
let invoke;

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

let dataSelezionata = new Date();
const serviziAnnoCache = {};

function pad2(n) {
    return String(n).padStart(2, '0');
}

function formatDataItaliana(date) {
    return `${pad2(date.getDate())}/${pad2(date.getMonth() + 1)}/${date.getFullYear()}`;
}

function minutiDaOra(oraStr) {
    if (!oraStr || typeof oraStr !== 'string') return 0;
    const p = oraStr.trim().split(':');
    if (p.length < 2) return 0;
    const h = parseInt(p[0], 10);
    const m = parseInt(p[1], 10);
    if (Number.isNaN(h) || Number.isNaN(m)) return 0;
    return h * 60 + m;
}

function escapeHtml(str) {
    if (str === undefined || str === null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function aggiungiGiorni(date, giorni) {
    const d = new Date(date);
    d.setDate(d.getDate() + giorni);
    return d;
}

function aggiornaLabelData() {
    const testo = formatDataItaliana(dataSelezionata);
    const label = document.getElementById('report-data-label');
    const labelPrint = document.getElementById('report-data-label-print');
    if (label) label.textContent = testo;
    if (labelPrint) labelPrint.textContent = testo;
}

async function fetchServiziAnno(anno) {
    if (serviziAnnoCache[anno]) {
        return serviziAnnoCache[anno];
    }
    if (!isTauri() || !invoke) {
        serviziAnnoCache[anno] = [];
        return [];
    }
    try {
        await invoke('init_supabase_from_config').catch(() => {});
        const servizi = await invoke('get_all_servizi_completi', {
            anno,
            tuttiAnni: false
        });
        serviziAnnoCache[anno] = Array.isArray(servizi) ? servizi : [];
        return serviziAnnoCache[anno];
    } catch (error) {
        console.error('Errore caricamento servizi:', error);
        throw error;
    }
}

function filtraServiziPerData(servizi, dataItaliana) {
    return servizi
        .filter(s => (s.data_prelievo || '').trim() === dataItaliana)
        .sort((a, b) => minutiDaOra(a.ora_inizio) - minutiDaOra(b.ora_inizio));
}

function splitDataOraDestinazione(servizio) {
    const raw = (servizio.ora_arrivo || '').trim();
    if (!raw) return { data: '', ora: '' };
    if (raw.includes('/')) {
        const spazio = raw.split(/\s+/);
        if (spazio.length >= 2 && spazio[1].includes(':')) {
            return { data: spazio[0], ora: spazio[1] };
        }
        return { data: raw, ora: '' };
    }
    if (raw.includes(':')) {
        return { data: servizio.data_prelievo || '', ora: raw };
    }
    return { data: raw, ora: '' };
}

function creaCampo(label, valore, classi = '') {
    const tokens = classi.split(/\s+/).filter(Boolean);
    const valueClass = tokens.filter(c => c !== 'col-span-2').join(' ');
    return `<div class="report-field ${classi}">
        <label>${escapeHtml(label)}</label>
        <div class="field-value ${valueClass}">${escapeHtml(valore)}</div>
    </div>`;
}

function creaCampoDuo(label, val1, val2, extraClass = '') {
    return `<div class="report-field col-data-ora ${extraClass}">
        <label>${escapeHtml(label)}</label>
        <div class="report-field-duo">
            <div class="field-value">${escapeHtml(val1)}</div>
            <div class="field-value">${escapeHtml(val2)}</div>
        </div>
    </div>`;
}

function creaBloccoServizio(servizio) {
    const dest = splitDataOraDestinazione(servizio);
    return `<article class="servizio-report">
        <div class="report-grid">
            ${creaCampo('IDSERV.', servizio.id)}
            ${creaCampo('OPERATORE', servizio.operatore, 'operatore')}
            ${creaCampoDuo('DATA E ORA SOTTO CASA', servizio.data_prelievo || '', servizio.ora_inizio || '')}
            ${creaCampo('COMUNE PRELIEVO', servizio.comune_prelievo)}
            ${creaCampo('LOCALITA PRELIEVO', servizio.luogo_prelievo)}
            ${creaCampo('TRASPORTATO', servizio.socio_trasportato, 'trasportato col-span-2')}
            ${creaCampoDuo('DATA E ORA A DESTINAZIONE', dest.data, dest.ora)}
            ${creaCampo('COMUNE A DESTINAZIONE', servizio.comune_destinazione)}
            ${creaCampo('Località arrivo', servizio.luogo_destinazione)}
        </div>
    </article>`;
}

function setLoading(visible) {
    const el = document.getElementById('report-loading');
    if (el) el.style.display = visible ? 'block' : 'none';
}

async function caricaReport() {
    const container = document.getElementById('report-servizi');
    const empty = document.getElementById('report-empty');
    if (!container) return;

    aggiornaLabelData();
    setLoading(true);
    container.innerHTML = '';
    if (empty) empty.style.display = 'none';

    const dataItaliana = formatDataItaliana(dataSelezionata);
    const anno = dataSelezionata.getFullYear();

    try {
        const tuttiAnno = await fetchServiziAnno(anno);
        const servizi = filtraServiziPerData(tuttiAnno, dataItaliana);

        if (servizi.length === 0) {
            if (empty) empty.style.display = 'block';
        } else {
            container.innerHTML = servizi.map(creaBloccoServizio).join('');
        }
    } catch (error) {
        container.innerHTML = `<div class="report-empty">Errore: ${escapeHtml(error.message || error)}</div>`;
    } finally {
        setLoading(false);
    }
}

function cambiaGiorno(delta) {
    dataSelezionata = aggiungiGiorni(dataSelezionata, delta);
    caricaReport();
}

function setupEventListeners() {
    document.getElementById('btn-giorno-prev')?.addEventListener('click', () => cambiaGiorno(-1));
    document.getElementById('btn-giorno-next')?.addEventListener('click', () => cambiaGiorno(1));

    document.getElementById('btn-stampa')?.addEventListener('click', () => {
        window.print();
    });

    document.getElementById('btn-chiudi')?.addEventListener('click', async () => {
        if (isTauri()) {
            try {
                const { getCurrent } = await import('@tauri-apps/api/window');
                const win = getCurrent();
                if (win?.label === 'report-giornaliero') {
                    await win.close();
                    return;
                }
            } catch (e) {
                console.warn(e);
            }
        }
        if (window.opener) {
            window.close();
        } else {
            window.location.href = 'index.html';
        }
    });
}

document.addEventListener('DOMContentLoaded', async () => {
    await initTauri();
    dataSelezionata = new Date();
    dataSelezionata.setHours(0, 0, 0, 0);
    setupEventListeners();
    await caricaReport();
});
