// Scheda del Servizio — popup stampa A4 (servizio selezionato dalla home)
import { testoNoteFineVisibile } from './tratta-riepilogo.js';

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

function getIdServizioFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const raw = (params.get('id') || params.get('idservizio') || '').trim();
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
}

function escapeHtml(text) {
    if (text === null || text === undefined) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
}

function setText(id, value) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = value == null || value === '' ? '' : String(value);
}

function setHtml(id, html) {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = html || '';
}

function normalizzaNumero(value) {
    if (value === null || value === undefined) return '';
    let trimmed = String(value).trim();
    if (trimmed.endsWith('.0')) trimmed = trimmed.slice(0, -2);
    if (trimmed.includes('.')) {
        const num = parseFloat(trimmed);
        if (!Number.isNaN(num) && num % 1 === 0) return String(num);
    }
    return trimmed;
}

function formatDataDisplay(value) {
    if (!value) return '';
    const s = String(value).trim();
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return s;
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
        const [y, m, d] = s.slice(0, 10).split('-');
        return `${d}/${m}/${y}`;
    }
    return s;
}

function formatOraDisplay(value) {
    if (!value) return '';
    const s = String(value).trim();
    const m = s.match(/^(\d{1,2}):(\d{2})/);
    if (m) return `${m[1].padStart(2, '0')}:${m[2]}`;
    return s;
}

function isTruthishGratis(servizio) {
    const stato = String(servizio.stato_incasso || '').trim().toUpperCase();
    const tipo = String(servizio.tipo_pagamento || '').trim().toUpperCase();
    const pag = String(servizio.pagamento || '').replace(/€/g, '').replace(/\s/g, '');
    if (stato === 'GRATIS' || tipo === 'GRATIS') return true;
    const n = parseFloat(pag.replace(/\./g, '').replace(',', '.'));
    return !Number.isNaN(n) && n === 0 && (stato === 'GRATIS' || tipo === 'GRATIS' || pag === '0,00' || pag === '0.00');
}

function haCarrozzina(servizio) {
    const c = String(servizio.carrozzina || '').trim().toUpperCase();
    if (!c) return false;
    return c !== 'NO' && c !== 'FALSE' && c !== '0';
}

function formatAutomezzo(servizio, automezzi) {
    const nr = normalizzaNumero(servizio.mezzo || '');
    if (!nr) return servizio.mezzo_usato || '';
    const auto = (automezzi || []).find(a => normalizzaNumero(a.nr_automezzo) === nr);
    if (!auto) return nr;
    const marca = (auto.marca || '').trim();
    const modello = (auto.modello || '').trim();
    const desc = [marca, modello].filter(Boolean).join(' ');
    return desc ? `${nr} ( ${desc} )` : nr;
}

function targaDaMezzo(servizio, automezzi) {
    const nr = normalizzaNumero(servizio.mezzo || '');
    if (!nr) return '';
    const auto = (automezzi || []).find(a => normalizzaNumero(a.nr_automezzo) === nr);
    return (auto?.targa || '').trim();
}

async function caricaTelefonoTrasportato(idsocio) {
    if (!idsocio || !invoke) return '';
    try {
        const completa = await invoke('get_socio_anagrafica', { idsocio: String(idsocio) });
        return completa?.anagrafica?.telefono || '';
    } catch (_) {
        return '';
    }
}

async function caricaTelefonoOperatore(nomeOperatore, tesserati) {
    const nome = String(nomeOperatore || '').trim().toUpperCase();
    if (!nome) return '';
    const lista = Array.isArray(tesserati) ? tesserati : [];
    const found = lista.find(t => String(t.nominativo || '').trim().toUpperCase() === nome);
    return found?.telefono || '';
}

function popolaScheda(servizio, extra) {
    setText('ss-idservizio', servizio.id || '');
    setText('ss-data-sottocasa', formatDataDisplay(servizio.data_prelievo));
    setText('ss-data-destinazione', formatDataDisplay(servizio.ora_arrivo));
    setText('ss-ora-sottocasa', formatOraDisplay(servizio.ora_inizio));
    setText('ss-ora-arrivo', formatOraDisplay(extra.oraArrivo || ''));

    setText('ss-trasportato', servizio.socio_trasportato || '');
    setText('ss-telefono', extra.telefonoTrasportato || '');

    setText('ss-operatore-nome', servizio.operatore || '');
    setText('ss-operatore-tel', extra.telefonoOperatore || '');
    setText('ss-automezzo', extra.automezzoTesto || '');
    setText('ss-targa', extra.targa || '');

    const conCarrozzina = haCarrozzina(servizio);
    const checkStd = document.getElementById('ss-check-standard');
    const checkCarr = document.getElementById('ss-check-carrozzina');
    if (checkStd) checkStd.checked = !conCarrozzina;
    if (checkCarr) checkCarr.checked = conCarrozzina;
    setText('ss-carrozzina', conCarrozzina ? (servizio.carrozzina || '') : '');

    setText('ss-motivazione', servizio.motivazione || '');

    setText('ss-prelievo-comune', servizio.comune_prelievo || '');
    setText('ss-prelievo-indirizzo', servizio.luogo_prelievo || '');
    setHtml('ss-prelievo-note', escapeHtml(servizio.note_prelievo || '').replace(/\n/g, '<br>'));

    setText('ss-destinazione-comune', servizio.comune_destinazione || '');
    setText('ss-destinazione-indirizzo', servizio.luogo_destinazione || '');
    setHtml('ss-destinazione-note', escapeHtml(servizio.note_arrivo || '').replace(/\n/g, '<br>'));

    const gratis = isTruthishGratis(servizio) ||
        String(servizio.stato_incasso || '').toUpperCase() === 'GRATIS' ||
        String(servizio.tipo_pagamento || '').toUpperCase() === 'GRATIS';
    const checkGratis = document.getElementById('ss-check-gratis');
    if (checkGratis) checkGratis.checked = gratis;

    setText('ss-donazione', servizio.pagamento || '');
    setText('ss-dona-con', servizio.tipo_pagamento || '');
    setText('ss-numero-ricevuta', servizio.numero_ricevuta || '');
    setText('ss-data-ricevuta', formatDataDisplay(servizio.data_ricevuta));

    setText('ss-km-uscita', servizio.km_uscita || '');
    setText('ss-km-rientro', servizio.km_rientro || '');
    setText('ss-km', servizio.km || '');
    setText('ss-tempo', formatOraDisplay(servizio.tempo) || servizio.tempo || '');
    setHtml('ss-note-fine', escapeHtml(testoNoteFineVisibile(servizio.note_fine_servizio)).replace(/\n/g, '<br>'));
}

async function caricaScheda() {
    const loading = document.getElementById('ss-loading');
    const errore = document.getElementById('ss-errore');
    const page = document.getElementById('ss-page');
    const status = document.getElementById('ss-status');

    const id = getIdServizioFromUrl();
    if (!id) {
        if (loading) loading.hidden = true;
        if (errore) {
            errore.hidden = false;
            errore.textContent = 'ID servizio mancante nell\'indirizzo.';
        }
        return;
    }

    await initTauri();

    if (!invoke) {
        if (loading) loading.hidden = true;
        if (errore) {
            errore.hidden = false;
            errore.textContent = 'Apri questa scheda dall\'app AUSER (non dal browser).';
        }
        return;
    }

    try {
        await invoke('init_supabase_from_config').catch(() => {});
        const servizio = await invoke('get_servizio_completo', { servizioId: id });

        let automezzi = [];
        let tesserati = [];
        try {
            automezzi = await invoke('get_all_automezzi');
        } catch (_) { /* ignore */ }
        try {
            tesserati = await invoke('get_all_tesserati');
        } catch (_) { /* ignore */ }

        const telefonoTrasportato = await caricaTelefonoTrasportato(servizio.idsocio);
        const telefonoOperatore = await caricaTelefonoOperatore(servizio.operatore, tesserati);

        popolaScheda(servizio, {
            telefonoTrasportato,
            telefonoOperatore,
            automezzoTesto: formatAutomezzo(servizio, automezzi),
            targa: targaDaMezzo(servizio, automezzi),
            oraArrivo: ''
        });

        if (loading) loading.hidden = true;
        if (errore) errore.hidden = true;
        if (page) page.hidden = false;
        if (status) status.textContent = `Servizio ${servizio.id}`;
        document.title = `Scheda servizio ${servizio.id} - AUSER Asti`;
    } catch (error) {
        console.error('Errore caricamento scheda:', error);
        if (loading) loading.hidden = true;
        if (errore) {
            errore.hidden = false;
            errore.textContent = `Errore: ${error}`;
        }
    }
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
    document.getElementById('btn-stampa')?.addEventListener('click', () => window.print());
    document.getElementById('btn-chiudi')?.addEventListener('click', chiudiFinestra);
    await caricaScheda();
});
