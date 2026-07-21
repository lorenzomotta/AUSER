// Riepilogo Pagamenti — elenco servizi + ricerca avanzata + totali
import {
    initModificaServizio,
    setupModaleModifica,
    caricaDatiModificaServizio,
    apriModalModifica
} from './modifica-servizio.js';
import { richiediSessione, isAdmin } from './auth-session.js';
import {
    generaPdfRiepilogoPagamenti,
    generaExcelRiepilogoPagamenti
} from './riepilogopagamenti-export.js';

let invoke;

let tuttiServizi = [];
let serviziFiltrati = [];
let filtriAttivi = false;

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

function parseEuro(valore) {
    if (valore === undefined || valore === null || valore === '') return 0;
    const pulito = String(valore)
        .replace(/€/g, '')
        .replace(/\s/g, '')
        .replace(/\./g, '')
        .replace(',', '.');
    const n = parseFloat(pulito);
    return Number.isNaN(n) ? 0 : n;
}

function formatEuro(importo) {
    const n = Number(importo) || 0;
    const parti = n.toFixed(2).split('.');
    parti[0] = parti[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return `${parti[0]},${parti[1]} €`;
}

function formatNumero(n) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function normalizza(testo) {
    return String(testo || '').trim().toUpperCase();
}

function contiene(haystack, needle) {
    const n = String(needle || '').trim().toLowerCase();
    if (!n) return true;
    return String(haystack || '').toLowerCase().includes(n);
}

function statoNorm(servizio) {
    return normalizza(servizio.stato_incasso);
}

function isAnnullato(servizio) {
    return statoNorm(servizio) === 'ANNULLATO'
        || normalizza(servizio.stato_servizio).includes('ANNULL');
}

function isGratis(servizio) {
    const stato = statoNorm(servizio);
    const tipo = normalizza(servizio.tipo_pagamento);
    return stato === 'GRATIS' || tipo === 'GRATIS';
}

function isIncassato(servizio) {
    return statoNorm(servizio) === 'INCASSATO';
}

function isDaIncassare(servizio) {
    const s = statoNorm(servizio);
    return s === 'DA INCASSARE' || s === '';
}

function dataIncasso(servizio) {
    return (servizio.data_bonifico || servizio.data_ricevuta || '').trim();
}

function annoDaDataItaliana(value) {
    const m = String(value || '').trim().match(/(\d{4})$/);
    if (m) return parseInt(m[1], 10);
    const iso = String(value || '').match(/^(\d{4})-/);
    return iso ? parseInt(iso[1], 10) : 0;
}

function parseDataServizio(value) {
    if (!value) return null;
    const s = String(value).trim();
    const it = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (it) {
        const d = new Date(parseInt(it[3], 10), parseInt(it[2], 10) - 1, parseInt(it[1], 10));
        return Number.isNaN(d.getTime()) ? null : d;
    }
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
        const [y, m, day] = s.slice(0, 10).split('-').map(Number);
        const d = new Date(y, m - 1, day);
        return Number.isNaN(d.getTime()) ? null : d;
    }
    return null;
}

function dataIsoADate(iso) {
    if (!iso) return null;
    const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    const d = new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
    return Number.isNaN(d.getTime()) ? null : d;
}

function popolaSelectAnni() {
    const select = document.getElementById('rp-anno');
    if (!select) return;
    const anni = new Set();
    const corrente = new Date().getFullYear();
    anni.add(corrente);
    anni.add(corrente - 1);
    tuttiServizi.forEach((s) => {
        const a = annoDaDataItaliana(s.data_prelievo);
        if (a >= 2000 && a <= 2100) anni.add(a);
    });
    const lista = [...anni].sort((a, b) => b - a);
    const prev = select.value;
    select.innerHTML = '<option value="tutti">TUTTI</option>'
        + lista.map((a) => `<option value="${a}">${a}</option>`).join('');
    if (prev && [...select.options].some((o) => o.value === prev)) {
        select.value = prev;
    } else {
        select.value = String(corrente);
    }
}

async function caricaLookupFiltri() {
    if (!invoke) return;

    try {
        const richiedenti = await invoke('get_all_richiedenti');
        const selR = document.getElementById('f-richiedente');
        if (selR) {
            const opts = Array.isArray(richiedenti) ? richiedenti : [];
            selR.innerHTML = '<option value="">— Tutti —</option>'
                + opts.map((r) => `<option value="${escapeHtml(r)}">${escapeHtml(r)}</option>`).join('');
        }
    } catch (err) {
        console.warn('Caricamento richiedenti:', err);
    }

    try {
        const tipi = await invoke('get_all_tipi_pagamento');
        const selT = document.getElementById('f-tipo-pagam');
        if (selT) {
            const opts = Array.isArray(tipi) ? tipi : [];
            selT.innerHTML = '<option value="">— Tutti —</option>'
                + opts.map((t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('');
        }
    } catch (err) {
        console.warn('Caricamento tipi pagamento:', err);
    }
}

function leggiFiltri() {
    return {
        stato: document.getElementById('f-stato')?.value || '',
        richiedente: document.getElementById('f-richiedente')?.value || '',
        tipoPagam: document.getElementById('f-tipo-pagam')?.value || '',
        dataDa: document.getElementById('f-data-da')?.value || '',
        dataA: document.getElementById('f-data-a')?.value || ''
    };
}

function haFiltriAttivi(f) {
    return Object.values(f).some((v) => String(v || '').trim() !== '');
}

function filtraServizi() {
    const annoSel = document.getElementById('rp-anno')?.value || 'tutti';
    const f = leggiFiltri();
    filtriAttivi = haFiltriAttivi(f);

    const btnReset = document.getElementById('btn-reset-filtri');
    if (btnReset) btnReset.hidden = !filtriAttivi;

    const da = dataIsoADate(f.dataDa);
    const a = dataIsoADate(f.dataA);
    if (da) da.setHours(0, 0, 0, 0);
    if (a) a.setHours(23, 59, 59, 999);

    serviziFiltrati = tuttiServizi.filter((s) => {
        if (annoSel !== 'tutti') {
            const anno = annoDaDataItaliana(s.data_prelievo);
            if (String(anno) !== String(annoSel)) return false;
        }
        if (f.stato && statoNorm(s) !== normalizza(f.stato)) return false;
        if (f.richiedente && normalizza(s.richiedente) !== normalizza(f.richiedente)) return false;
        if (f.tipoPagam && normalizza(s.tipo_pagamento) !== normalizza(f.tipoPagam)) return false;

        if (da || a) {
            const dataSrv = parseDataServizio(s.data_prelievo);
            if (!dataSrv) return false;
            if (da && dataSrv < da) return false;
            if (a && dataSrv > a) return false;
        }
        return true;
    });

    serviziFiltrati.sort((x, y) => {
        const dx = String(x.data_prelievo || '');
        const dy = String(y.data_prelievo || '');
        if (dx !== dy) return dy.localeCompare(dx);
        return String(y.id).localeCompare(String(x.id), undefined, { numeric: true });
    });
}

function classeRiga(servizio) {
    if (isAnnullato(servizio)) return 'rp-row-annullato';
    if (isGratis(servizio)) return 'rp-row-gratis';
    if (isIncassato(servizio)) return 'rp-row-incassato';
    return 'rp-row-da-incassare';
}

function htmlStato(servizio) {
    const stato = servizio.stato_incasso || 'DA INCASSARE';
    let cls = '';
    if (isIncassato(servizio)) cls = 'is-incassato';
    else if (isGratis(servizio)) cls = 'is-gratis';
    return `<span class="rp-stato-pill ${cls}">${escapeHtml(stato)}</span>`;
}

function renderTabella() {
    const tbody = document.getElementById('rp-tbody');
    const wrap = document.getElementById('rp-table-wrap');
    const vuoto = document.getElementById('rp-vuoto');
    const footer = document.getElementById('rp-footer');
    const conteggio = document.getElementById('rp-conteggio-visibili');

    if (!tbody) return;

    if (conteggio) {
        conteggio.textContent = `${formatNumero(serviziFiltrati.length)} servizi`;
    }

    if (!serviziFiltrati.length) {
        tbody.innerHTML = '';
        if (wrap) wrap.hidden = true;
        if (vuoto) vuoto.hidden = false;
        if (footer) footer.hidden = false;
        aggiornaTotali([]);
        return;
    }

    if (vuoto) vuoto.hidden = true;
    if (wrap) wrap.hidden = false;
    if (footer) footer.hidden = false;

    // Limite rendering DOM per fluidità (prime 2500 righe)
    const MAX = 2500;
    const slice = serviziFiltrati.slice(0, MAX);
    tbody.innerHTML = slice.map((s) => `
        <tr class="${classeRiga(s)}" data-id="${escapeHtml(s.id)}">
            <td>${htmlStato(s)}</td>
            <td>${escapeHtml(s.richiedente)}</td>
            <td>${escapeHtml(s.data_prelievo)}</td>
            <td class="rp-td-left rp-td-strong">${escapeHtml(s.socio_trasportato)}</td>
            <td>${escapeHtml(s.comune_prelievo)}</td>
            <td class="rp-td-left">${escapeHtml(s.luogo_prelievo)}</td>
            <td>${escapeHtml(s.comune_destinazione)}</td>
            <td class="rp-td-left">${escapeHtml(s.luogo_destinazione)}</td>
            <td class="rp-td-strong">${escapeHtml(s.pagamento)}</td>
            <td>${escapeHtml(s.tipo_pagamento)}</td>
            <td>${escapeHtml(dataIncasso(s))}</td>
            <td>
                <button type="button" class="rp-btn-apri" data-apri-id="${escapeHtml(s.id)}" title="Apri servizio in lettura">›››</button>
            </td>
        </tr>
    `).join('');

    if (serviziFiltrati.length > MAX && conteggio) {
        conteggio.textContent = `${formatNumero(serviziFiltrati.length)} servizi (mostrati ${formatNumero(MAX)})`;
    }

    aggiornaTotali(serviziFiltrati);
}

function aggiornaTotali(lista) {
    let euroEseguiti = 0;
    let euroIncassati = 0;
    let euroDaIncassare = 0;
    let nEseguiti = 0;
    let nIncassati = 0;
    let nGratis = 0;
    let nDaIncassare = 0;

    lista.forEach((s) => {
        if (isAnnullato(s)) return;

        const importo = parseEuro(s.pagamento);
        nEseguiti += 1;
        euroEseguiti += importo;

        if (isGratis(s)) {
            nGratis += 1;
            return;
        }
        if (isIncassato(s)) {
            nIncassati += 1;
            euroIncassati += importo;
            return;
        }
        if (isDaIncassare(s)) {
            nDaIncassare += 1;
            euroDaIncassare += importo;
        }
    });

    const set = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
    };

    set('tot-eseguiti-euro', formatEuro(euroEseguiti));
    set('tot-incassati-euro', formatEuro(euroIncassati));
    set('tot-da-incassare-euro', formatEuro(euroDaIncassare));
    set('tot-eseguiti-n', formatNumero(nEseguiti));
    set('tot-incassati-n', formatNumero(nIncassati));
    set('tot-gratis-n', formatNumero(nGratis));
    set('tot-da-incassare-n', formatNumero(nDaIncassare));
}

function applicaFiltriERender() {
    filtraServizi();
    renderTabella();
}

function resetFiltri() {
    ['f-stato', 'f-richiedente', 'f-tipo-pagam', 'f-data-da', 'f-data-a'].forEach((id) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.value = '';
    });
    applicaFiltriERender();
}

async function caricaDati() {
    const loading = document.getElementById('rp-loading');
    const errore = document.getElementById('rp-errore');

    if (loading) {
        loading.hidden = false;
        loading.textContent = 'Caricamento servizi...';
    }
    if (errore) errore.hidden = true;

    try {
        if (!invoke) await initTauri();
        if (!invoke) throw new Error('Apri questa pagina dall\'app AUSER');

        await invoke('init_supabase_from_config').catch(() => {});
        await caricaLookupFiltri();
        const list = await invoke('get_all_servizi_completi', {
            anno: null,
            tuttiAnni: true
        });
        // Riepilogo pagamenti: solo servizi già eseguiti
        tuttiServizi = (Array.isArray(list) ? list : []).filter((s) =>
            normalizza(s.stato_servizio) === 'ESEGUITO'
        );
        popolaSelectAnni();
        if (loading) loading.hidden = true;
        applicaFiltriERender();
    } catch (error) {
        console.error('Errore caricamento riepilogo pagamenti:', error);
        if (loading) loading.hidden = true;
        if (errore) {
            errore.hidden = false;
            errore.textContent = `Errore: ${error}`;
        }
    }
}

function trovaServizioLocale(id) {
    const idStr = String(id);
    return tuttiServizi.find(s => String(s.id) === idStr) || null;
}

async function apriServizioInLettura(id) {
    const idNum = parseInt(id, 10);
    if (!Number.isFinite(idNum) || idNum <= 0) return;
    await apriModalModifica(idNum, { solaLettura: true });
}

function descrizioneFiltriAttivi() {
    const parts = [];
    const annoSel = document.getElementById('rp-anno')?.value || 'tutti';
    parts.push(annoSel === 'tutti' ? 'Tutti gli anni' : `Anno ${annoSel}`);

    const f = {
        stato: document.getElementById('f-stato')?.value || '',
        richiedente: document.getElementById('f-richiedente')?.value || '',
        tipoPagam: document.getElementById('f-tipo-pagam')?.value || '',
        dataDa: document.getElementById('f-data-da')?.value || '',
        dataA: document.getElementById('f-data-a')?.value || ''
    };

    if (f.stato) parts.push(`Stato: ${f.stato}`);
    if (f.richiedente) parts.push(`Richiedente: ${f.richiedente}`);
    if (f.tipoPagam) parts.push(`Tipo pagam.: ${f.tipoPagam}`);
    if (f.dataDa || f.dataA) {
        parts.push(`Periodo: ${f.dataDa || '…'} → ${f.dataA || '…'}`);
    }

    return parts.join(' · ');
}

function esportaPdf() {
    try {
        generaPdfRiepilogoPagamenti(serviziFiltrati, {
            filtriDescrizione: descrizioneFiltriAttivi()
        });
    } catch (err) {
        console.error('Export PDF riepilogo pagamenti:', err);
        alert(String(err?.message || err || 'Errore durante la generazione del PDF'));
    }
}

function esportaExcel() {
    try {
        generaExcelRiepilogoPagamenti(serviziFiltrati, {
            filtriDescrizione: descrizioneFiltriAttivi()
        });
    } catch (err) {
        console.error('Export Excel riepilogo pagamenti:', err);
        alert(String(err?.message || err || 'Errore durante la generazione del file Excel'));
    }
}

async function chiudiFinestra() {
    if (isTauri()) {
        try {
            const { getCurrent, WebviewWindow } = await import('@tauri-apps/api/window');
            const currentWindow = getCurrent();
            const label = currentWindow?.label || '';

            // Chiudi solo la popup del riepilogo, mai la finestra principale (home)
            if (label === 'riepilogo-pagamenti') {
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

            // Se siamo finiti sulla home/main, torna a index senza chiudere l'app
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
    const sessione = richiediSessione();
    if (!sessione) return;
    if (!isAdmin(sessione)) {
        alert('Accesso riservato agli amministratori.');
        window.location.href = 'index.html';
        return;
    }

    document.getElementById('btn-chiudi')?.addEventListener('click', chiudiFinestra);
    document.getElementById('btn-export-pdf')?.addEventListener('click', esportaPdf);
    document.getElementById('btn-export-excel')?.addEventListener('click', esportaExcel);

    document.getElementById('btn-toggle-ricerca')?.addEventListener('click', () => {
        const panel = document.getElementById('rp-ricerca');
        if (!panel) return;
        panel.hidden = !panel.hidden;
    });

    document.getElementById('btn-applica-filtri')?.addEventListener('click', applicaFiltriERender);
    document.getElementById('btn-reset-filtri')?.addEventListener('click', resetFiltri);
    document.getElementById('rp-anno')?.addEventListener('change', applicaFiltriERender);

    // Invio negli input = applica
    document.getElementById('rp-ricerca')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            applicaFiltriERender();
        }
    });

    document.getElementById('rp-tbody')?.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-apri-id]');
        if (!btn) return;
        apriServizioInLettura(btn.getAttribute('data-apri-id'));
    });

    await initTauri();
    initModificaServizio({
        getInvoke: () => invoke,
        isTauriEnv: isTauri,
        trovaServizioLocal: trovaServizioLocale,
        onSaveSuccess: async (servizioAggiornato) => {
            if (!servizioAggiornato?.id) return;
            const idStr = String(servizioAggiornato.id);
            const idx = tuttiServizi.findIndex(s => String(s.id) === idStr);
            if (idx >= 0) {
                tuttiServizi[idx] = { ...tuttiServizi[idx], ...servizioAggiornato };
            }
            applicaFiltriERender();
        }
    });
    setupModaleModifica();
    await caricaDatiModificaServizio();

    await caricaDati();
});
