// Riepilogo servizi incassati — data incasso = data selezionata (Supabase via Tauri)
let invoke;

let dataSelezionata = new Date();
const serviziAnnoCache = {};

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

function formatDataItaliana(date) {
    return `${pad2(date.getDate())}/${pad2(date.getMonth() + 1)}/${date.getFullYear()}`;
}

function aggiungiGiorni(date, n) {
    const d = new Date(date);
    d.setDate(d.getDate() + n);
    return d;
}

function leggiDataDaUrl() {
    const params = new URLSearchParams(window.location.search);
    const dataIso = params.get('data');
    if (!dataIso) return null;

    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dataIso);
    if (!match) return null;

    const anno = parseInt(match[1], 10);
    const mese = parseInt(match[2], 10);
    const giorno = parseInt(match[3], 10);
    if (!anno || mese < 1 || mese > 12 || giorno < 1 || giorno > 31) return null;

    const date = new Date(anno, mese - 1, giorno);
    if (date.getFullYear() !== anno || date.getMonth() !== mese - 1 || date.getDate() !== giorno) {
        return null;
    }
    date.setHours(0, 0, 0, 0);
    return date;
}

function escapeHtml(str) {
    if (str === undefined || str === null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function parseEuroImporto(valore) {
    if (valore === undefined || valore === null || valore === '') return 0;
    const pulito = String(valore)
        .replace(/€/g, '')
        .replace(/\s/g, '')
        .replace(/\./g, '')
        .replace(',', '.');
    const n = parseFloat(pulito);
    return Number.isNaN(n) ? 0 : n;
}

function formatEuroImporto(importo) {
    const n = Number(importo) || 0;
    const parti = n.toFixed(2).split('.');
    parti[0] = parti[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return `${parti[0]},${parti[1]} €`;
}

async function fetchServiziAnno(anno) {
    if (serviziAnnoCache[anno]) return serviziAnnoCache[anno];
    if (!isTauri() || !invoke) {
        serviziAnnoCache[anno] = [];
        return [];
    }
    await invoke('init_supabase_from_config').catch(() => {});
    const servizi = await invoke('get_all_servizi_completi', { anno, tuttiAnni: false });
    serviziAnnoCache[anno] = Array.isArray(servizi) ? servizi : [];
    return serviziAnnoCache[anno];
}

function filtraPerDataIncasso(servizi, dataItaliana) {
    return servizi
        .filter(s => (s.data_ricevuta || '').trim() === dataItaliana)
        .sort((a, b) => {
            const idA = parseInt(a.id, 10) || 0;
            const idB = parseInt(b.id, 10) || 0;
            return idA - idB;
        });
}

function creaCampo(label, valore, classi = '') {
    const tokens = classi.split(/\s+/).filter(Boolean);
    const valueClass = tokens.filter(c => !c.startsWith('col-span-')).join(' ');
    return `<div class="report-field ${classi}">
        <label>${escapeHtml(label)}</label>
        <div class="field-value ${valueClass}">${escapeHtml(valore)}</div>
    </div>`;
}

function creaCampoVuoto() {
    return `<div class="report-field field-vuoto" aria-hidden="true">
        <label>&nbsp;</label>
        <div class="field-value field-vuoto-value"></div>
    </div>`;
}

function creaBloccoServizio(servizio) {
    return `<article class="servizio-riepilogo">
        <div class="report-grid">
            ${creaCampo('IDSRV', servizio.id)}
            ${creaCampo('DATA PRELIEVO', servizio.data_prelievo)}
            ${creaCampo('RICHIEDENTE', servizio.richiedente)}
            ${creaCampo('COMUNE PRELIEVO', servizio.comune_prelievo)}
            ${creaCampo('INDIRIZZO PRELIEVO', servizio.luogo_prelievo)}
            ${creaCampo('STATO SERVIZIO', servizio.stato_servizio)}
            ${creaCampo('TIPO PAGAMENTO', servizio.tipo_pagamento)}
            ${creaCampo('DONAZIONE INCASSATA', servizio.pagamento, 'importo')}
        </div>
        <div class="report-grid row-seconda">
            ${creaCampo('TRASPORTATO', servizio.socio_trasportato, 'trasportato col-span-3')}
            ${creaCampo('COMUNE DESTINAZIONE', servizio.comune_destinazione)}
            ${creaCampo('INDIRIZZO DESTINAZIONE', servizio.luogo_destinazione)}
            ${creaCampo('STATO INCASSO', servizio.stato_incasso)}
            ${creaCampo('DATA INCASSO', servizio.data_ricevuta)}
            ${creaCampoVuoto()}
        </div>
    </article>`;
}

function calcolaTotale(servizi) {
    return servizi.reduce((sum, s) => sum + parseEuroImporto(s.pagamento), 0);
}

function aggiornaLabelData() {
    const testo = formatDataItaliana(dataSelezionata);
    const label = document.getElementById('report-data-label');
    const labelPrint = document.getElementById('report-data-label-print');
    if (label) label.textContent = testo;
    if (labelPrint) labelPrint.textContent = testo;
}

function setLoading(visible) {
    const el = document.getElementById('report-loading');
    if (el) el.style.display = visible ? 'block' : 'none';
}

async function caricaReport() {
    const container = document.getElementById('report-servizi');
    const empty = document.getElementById('report-empty');
    const totaleEl = document.getElementById('totale-incasso');
    if (!container) return;

    aggiornaLabelData();
    setLoading(true);
    container.innerHTML = '';
    if (empty) empty.style.display = 'none';

    const dataItaliana = formatDataItaliana(dataSelezionata);
    const anno = dataSelezionata.getFullYear();

    try {
        const tuttiAnno = await fetchServiziAnno(anno);
        const servizi = filtraPerDataIncasso(tuttiAnno, dataItaliana);
        const totale = calcolaTotale(servizi);

        if (totaleEl) {
            totaleEl.textContent = formatEuroImporto(totale);
        }

        if (servizi.length === 0) {
            if (empty) empty.style.display = 'block';
        } else {
            container.innerHTML = servizi.map(creaBloccoServizio).join('');
        }
    } catch (error) {
        container.innerHTML = `<div class="report-empty">Errore: ${escapeHtml(error.message || error)}</div>`;
        if (totaleEl) totaleEl.textContent = '0,00 €';
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

    document.getElementById('btn-stampa')?.addEventListener('click', () => window.print());

    document.getElementById('btn-chiudi')?.addEventListener('click', async () => {
        if (isTauri()) {
            try {
                const { getCurrent } = await import('@tauri-apps/api/window');
                const win = getCurrent();
                if (win?.label === 'riepilogo-incassi') {
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
    dataSelezionata = leggiDataDaUrl() || new Date();
    dataSelezionata.setHours(0, 0, 0, 0);
    setupEventListeners();
    await caricaReport();
});
