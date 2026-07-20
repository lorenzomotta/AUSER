// Riepilogo Chilometri Percorsi — popup da Elenco Operatori
let invoke;

const MESI_IT = [
    'GENNAIO', 'FEBBRAIO', 'MARZO', 'APRILE', 'MAGGIO', 'GIUGNO',
    'LUGLIO', 'AGOSTO', 'SETTEMBRE', 'OTTOBRE', 'NOVEMBRE', 'DICEMBRE'
];

const GRUPPI = [
    { key: 'TESSERATI', label: 'TESSERATI', rimborsabile: true },
    { key: 'AUSER RIMBORSO', label: 'AUSER RIMBORSO', rimborsabile: true },
    { key: 'AUSER GRATIS', label: 'AUSER GRATIS', rimborsabile: false }
];

let operatoreNome = '';
let operatoreIdsocio = '';
let dataRif = new Date();
let serviziAnnoCache = {};

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

function pad2(n) {
    return String(n).padStart(2, '0');
}

function escapeHtml(text) {
    if (text === null || text === undefined) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
}

function leggiParametriUrl() {
    const params = new URLSearchParams(window.location.search);
    operatoreNome = (params.get('operatore') || params.get('nominativo') || '').trim();
    operatoreIdsocio = (params.get('idsocio') || '').trim();
    const mese = parseInt(params.get('mese') || '', 10);
    const anno = parseInt(params.get('anno') || '', 10);
    dataRif = new Date();
    if (Number.isFinite(anno) && anno >= 2000) dataRif.setFullYear(anno);
    if (Number.isFinite(mese) && mese >= 1 && mese <= 12) {
        dataRif.setMonth(mese - 1);
    }
    dataRif.setDate(1);
    dataRif.setHours(12, 0, 0, 0);
}

function aggiornaPeriodoUI() {
    const meseEl = document.getElementById('rc-mese');
    const annoEl = document.getElementById('rc-anno');
    if (meseEl) meseEl.textContent = MESI_IT[dataRif.getMonth()];
    if (annoEl) annoEl.textContent = String(dataRif.getFullYear());
    const opEl = document.getElementById('rc-operatore');
    if (opEl) opEl.textContent = operatoreNome || '—';
    document.title = `Chilometri ${operatoreNome || ''} — AUSER Asti`;
}

function parseDataItaliana(value) {
    if (!value) return null;
    const s = String(value).trim();
    const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (m) {
        const d = new Date(parseInt(m[3], 10), parseInt(m[2], 10) - 1, parseInt(m[1], 10));
        return Number.isNaN(d.getTime()) ? null : d;
    }
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
        const [y, mo, d] = s.slice(0, 10).split('-').map(Number);
        const date = new Date(y, mo - 1, d);
        return Number.isNaN(date.getTime()) ? null : date;
    }
    return null;
}

function formatDataDisplay(value) {
    const d = parseDataItaliana(value);
    if (!d) return value || '';
    return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
}

function parseKm(value) {
    if (value === null || value === undefined || value === '') return 0;
    const n = parseFloat(String(value).replace(',', '.').replace(/[^\d.-]/g, ''));
    return Number.isNaN(n) ? 0 : n;
}

function formatKm(value) {
    const n = typeof value === 'number' ? value : parseKm(value);
    if (Number.isInteger(n)) return String(n);
    return n.toFixed(1).replace('.', ',');
}

/** Classifica il servizio nei 3 gruppi del report */
function categoriaDaRichiedente(richiedente) {
    const r = String(richiedente || '')
        .trim()
        .toUpperCase()
        .replace(/\s+/g, '_')
        .replace(/-/g, '_');

    if (r.includes('GRATIS')) return 'AUSER GRATIS';
    if (r.includes('RIMBORSO') || r.includes('RMBORSO')) return 'AUSER RIMBORSO';
    return 'TESSERATI';
}

function normalizzaNome(value) {
    return String(value || '')
        .trim()
        .toUpperCase()
        .replace(/\s+/g, ' ');
}

function servizioDellOperatore(servizio) {
    const op = normalizzaNome(servizio.operatore);
    const target = normalizzaNome(operatoreNome);
    if (target && op === target) return true;

    // fallback: a volte l'operatore è in operatore_2
    const op2 = normalizzaNome(servizio.operatore_2);
    if (target && op2 === target) return true;

    return false;
}

async function fetchServiziAnno(anno) {
    if (serviziAnnoCache[anno]) return serviziAnnoCache[anno];
    if (!invoke) {
        serviziAnnoCache[anno] = [];
        return [];
    }
    await invoke('init_supabase_from_config').catch(() => {});
    const list = await invoke('get_all_servizi_completi', {
        anno,
        tuttiAnni: false
    });
    serviziAnnoCache[anno] = Array.isArray(list) ? list : [];
    return serviziAnnoCache[anno];
}

function filtraServiziMese(servizi) {
    const mese = dataRif.getMonth();
    const anno = dataRif.getFullYear();
    return servizi
        .filter((s) => {
            if (!servizioDellOperatore(s)) return false;
            const d = parseDataItaliana(s.data_prelievo);
            if (!d) return false;
            return d.getMonth() === mese && d.getFullYear() === anno;
        })
        .sort((a, b) => {
            const da = parseDataItaliana(a.data_prelievo)?.getTime() || 0;
            const db = parseDataItaliana(b.data_prelievo)?.getTime() || 0;
            if (da !== db) return da - db;
            return String(a.id).localeCompare(String(b.id), undefined, { numeric: true });
        });
}

function renderGruppo(container, gruppo, servizi) {
    const wrap = document.createElement('section');
    wrap.className = 'rc-gruppo';

    const titolo = document.createElement('div');
    titolo.className = 'rc-gruppo-titolo';
    titolo.textContent = gruppo.label;
    wrap.appendChild(titolo);

    if (!servizi.length) {
        const vuoto = document.createElement('div');
        vuoto.className = 'rc-gruppo-vuoto';
        vuoto.textContent = 'Nessun servizio in questo gruppo';
        wrap.appendChild(vuoto);
    } else {
        servizi.forEach((s) => {
            const riga = document.createElement('div');
            riga.className = 'rc-riga';
            riga.innerHTML = `
                <div class="rc-cell">${escapeHtml(formatDataDisplay(s.data_prelievo))}</div>
                <div class="rc-cell">${escapeHtml(s.id)}</div>
                <div class="rc-cell rc-cell-left">${escapeHtml(s.socio_trasportato)}</div>
                <div class="rc-cell">${escapeHtml(s.comune_prelievo)}</div>
                <div class="rc-cell">${escapeHtml(s.comune_destinazione)}</div>
                <div class="rc-cell">${escapeHtml(formatKm(s.km))}</div>
            `;
            wrap.appendChild(riga);
        });
    }

    const totKm = servizi.reduce((acc, s) => acc + parseKm(s.km), 0);
    const sub = document.createElement('div');
    sub.className = 'rc-subtotale';
    sub.innerHTML = `
        <span>NUMERO SERVIZI PER</span>
        <span class="rc-subtotale-nome">${escapeHtml(gruppo.label)}</span>
        <span class="rc-box">${servizi.length}</span>
        <span>KM</span>
        <span class="rc-box">${escapeHtml(formatKm(totKm))}</span>
    `;
    wrap.appendChild(sub);

    container.appendChild(wrap);
    return { count: servizi.length, km: totKm, rimborsabile: gruppo.rimborsabile };
}

async function caricaERender() {
    const loading = document.getElementById('rc-loading');
    const errore = document.getElementById('rc-errore');
    const contenuto = document.getElementById('rc-contenuto');
    const gruppiEl = document.getElementById('rc-gruppi');

    aggiornaPeriodoUI();

    if (!operatoreNome && !operatoreIdsocio) {
        if (loading) loading.hidden = true;
        if (errore) {
            errore.hidden = false;
            errore.textContent = 'Operatore mancante: apri il report dal pulsante CHILOMETRAGGIO.';
        }
        return;
    }

    if (loading) {
        loading.hidden = false;
        loading.textContent = 'Caricamento servizi...';
    }
    if (errore) errore.hidden = true;
    if (contenuto) contenuto.hidden = true;

    try {
        if (!invoke) await initTauri();
        if (!invoke) throw new Error('Apri questo report dall\'app AUSER');

        const serviziAnno = await fetchServiziAnno(dataRif.getFullYear());
        const delMese = filtraServiziMese(serviziAnno);

        const perGruppo = {
            'TESSERATI': [],
            'AUSER RIMBORSO': [],
            'AUSER GRATIS': []
        };
        delMese.forEach((s) => {
            const cat = categoriaDaRichiedente(s.richiedente);
            perGruppo[cat].push(s);
        });

        if (gruppiEl) gruppiEl.innerHTML = '';
        let numRimb = 0;
        let kmRimb = 0;
        let numNon = 0;
        let kmNon = 0;

        GRUPPI.forEach((g) => {
            const stats = renderGruppo(gruppiEl, g, perGruppo[g.key] || []);
            if (stats.rimborsabile) {
                numRimb += stats.count;
                kmRimb += stats.km;
            } else {
                numNon += stats.count;
                kmNon += stats.km;
            }
        });

        document.getElementById('rc-num-rimborsabili').textContent = String(numRimb);
        document.getElementById('rc-km-rimborsabili').textContent = formatKm(kmRimb);
        document.getElementById('rc-num-non-rimborsabili').textContent = String(numNon);
        document.getElementById('rc-km-non-rimborsabili').textContent = formatKm(kmNon);
        document.getElementById('rc-num-complessivo').textContent = String(numRimb + numNon);
        document.getElementById('rc-km-complessivo').textContent = formatKm(kmRimb + kmNon);

        if (loading) loading.hidden = true;
        if (contenuto) contenuto.hidden = false;
    } catch (error) {
        console.error('Errore report chilometri:', error);
        if (loading) loading.hidden = true;
        if (errore) {
            errore.hidden = false;
            errore.textContent = `Errore: ${error}`;
        }
    }
}

function cambiaMese(delta) {
    dataRif.setMonth(dataRif.getMonth() + delta);
    caricaERender();
}

async function chiudiFinestra() {
    if (isTauri()) {
        try {
            const { getCurrent } = await import('@tauri-apps/api/window');
            await getCurrent().close();
            return;
        } catch (err) {
            console.warn('Chiusura finestra:', err);
        }
    }
    if (window.opener) window.close();
    else window.history.back();
}

document.addEventListener('DOMContentLoaded', async () => {
    leggiParametriUrl();
    await initTauri();

    document.getElementById('btn-chiudi')?.addEventListener('click', chiudiFinestra);
    document.getElementById('btn-stampa')?.addEventListener('click', () => window.print());
    document.getElementById('btn-mese-prev')?.addEventListener('click', () => cambiaMese(-1));
    document.getElementById('btn-mese-next')?.addEventListener('click', () => cambiaMese(1));

    await caricaERender();
});
