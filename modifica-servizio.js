// Modale Modifica Servizio — condiviso tra home (index) e elenco servizi

import {
    parseTrattaDaNote,
    mergeTrattaInNote,
    htmlBloccoRiepilogoTratta,
    applicaRiepilogoTrattaNelDom,
    leggiTrattaDalDom,
    normalizzaPayloadTratta,
    apriFinestraSelezioneTratta,
    onTrattaFuoriAstiSelezionata,
    chiediPartenzaOArrivo,
    compilaCampiLocalitaDaTratta,
    rimuoviTrattaDalForm,
    messaggioAvvisoDopoRimozioneTratta
} from './tratta-riepilogo.js';

let getInvokeFn = () => null;
let isTauriEnv = () => false;
let onSaveSuccess = async () => {};
let onDeleteSuccess = async () => {};
let getTipiPagamentoExtra = () => [];
let trovaServizioLocal = () => null;

let allOperatori = [];
let allAutomezzi = [];
let allStatiServizio = [];
let servizioInModifica = null;
let solaLetturaAttiva = false;
let pagamentoModificabile = false;
/** Prefisso form che riceve la prossima selezione tratta (mod / comp) */
let trattaTargetPrefix = null;
let listenerTrattaFormAttivo = false;
/** Evita di cancellare la tratta mentre la stiamo applicando al campo donazione */
let ignoraCambioPagamentoPerTrattaMod = false;

function avvisaSeTrattaRimossaModifica(trattaRimossa) {
    if (!trattaRimossa) return;
    mostraAvvisoModifica(messaggioAvvisoDopoRimozioneTratta(trattaRimossa)).catch(() => {});
}

const MODALE_MODIFICA_MARKUP = `
<div id="modal-modifica" class="modal-modifica-overlay" style="display: none;" aria-hidden="true">
    <div class="modal-modifica-content" role="dialog" aria-labelledby="modal-modifica-title">
        <header class="ns-header modal-modifica-header">
            <div class="ns-header-left">
                <button type="button" class="btn btn-elimina-modifica" id="btn-elimina-modifica">ELIMINA</button>
                <button type="button" class="btn btn-duplica-modifica" id="btn-duplica-modifica">DUPLICA</button>
                <button type="button" class="btn btn-modifica-pagamento" id="btn-modifica-pagamento" hidden>MODIFICA PAGAMENTO</button>
            </div>
            <h1 class="ns-title" id="modal-modifica-title">MODIFICA SERVIZIO</h1>
            <div class="ns-header-right">
                <button type="button" class="btn btn-annulla" id="btn-annulla-modifica">ANNULLA</button>
                <button type="button" class="btn btn-salva" id="btn-salva-modifica">SALVA</button>
            </div>
        </header>
        <div class="modal-modifica-body" id="modal-modifica-body"></div>
    </div>
</div>
<div id="mod-dialog-elimina" class="mod-dialog-overlay ns-dialog-overlay" hidden aria-hidden="true">
    <div class="ns-dialog" role="dialog" aria-modal="true" aria-labelledby="mod-dialog-elimina-messaggio">
        <p id="mod-dialog-elimina-messaggio" class="ns-dialog-messaggio">Vuoi veramente eliminare questo servizio?</p>
        <div class="ns-dialog-actions">
            <button type="button" id="mod-dialog-elimina-si" class="ns-dialog-btn ns-dialog-btn-si">Si Elimina</button>
            <button type="button" id="mod-dialog-elimina-no" class="ns-dialog-btn ns-dialog-btn-no">No Annulla</button>
        </div>
    </div>
</div>
<div id="mod-dialog-avviso" class="mod-dialog-overlay ns-dialog-overlay" hidden aria-hidden="true">
    <div class="ns-dialog" role="dialog" aria-modal="true" aria-labelledby="mod-dialog-avviso-messaggio">
        <p id="mod-dialog-avviso-messaggio" class="ns-dialog-messaggio"></p>
        <div class="ns-dialog-actions">
            <button type="button" id="mod-dialog-avviso-ok" class="ns-dialog-btn ns-dialog-btn-si">OK</button>
        </div>
    </div>
</div>
<div id="mod-dialog-duplica" class="mod-dialog-overlay ns-dialog-overlay" hidden aria-hidden="true">
    <div class="ns-dialog mod-dialog-duplica" role="dialog" aria-modal="true" aria-labelledby="mod-dialog-duplica-titolo">
        <p id="mod-dialog-duplica-titolo" class="ns-dialog-messaggio mod-dialog-duplica-titolo">Quali dati vuoi mantenere nel servizio duplicato?</p>
        <div class="mod-duplica-opzioni" id="mod-duplica-opzioni"></div>
        <div class="ns-dialog-actions">
            <button type="button" id="mod-dialog-duplica-procedi" class="ns-dialog-btn ns-dialog-btn-si">Duplica</button>
            <button type="button" id="mod-dialog-duplica-annulla" class="ns-dialog-btn ns-dialog-btn-no">Annulla</button>
        </div>
    </div>
</div>
<div id="mod-dialog-mezzo-occupato" class="mod-dialog-overlay ns-dialog-overlay" hidden aria-hidden="true">
    <div class="ns-dialog ns-dialog-mezzo-occupato" role="dialog" aria-modal="true" aria-labelledby="mod-dialog-mezzo-occupato-titolo">
        <h2 id="mod-dialog-mezzo-occupato-titolo" class="ns-dialog-titolo">Mezzo già in uso</h2>
        <p id="mod-dialog-mezzo-occupato-sottotitolo" class="ns-dialog-sottotitolo"></p>
        <div class="ns-mezzo-occupato-tabella-wrap">
            <table class="ns-mezzo-occupato-tabella">
                <thead>
                    <tr>
                        <th>Ora</th>
                        <th>Operatore</th>
                        <th>Trasportato</th>
                        <th>Comune destinazione</th>
                        <th>Località destinazione</th>
                    </tr>
                </thead>
                <tbody id="mod-dialog-mezzo-occupato-body"></tbody>
            </table>
        </div>
        <div class="ns-dialog-actions">
            <button type="button" id="mod-dialog-mezzo-occupato-chiudi" class="ns-dialog-btn ns-dialog-btn-si">CHIUDI</button>
        </div>
    </div>
</div>`;

function injectModaleModificaMarkup() {
    if (!document.getElementById('modal-modifica')) {
        document.body.insertAdjacentHTML('beforeend', MODALE_MODIFICA_MARKUP);
        return;
    }
    // Se la modale c'era già (vecchia sessione), aggiungi solo il dialog mezzo se manca
    if (!document.getElementById('mod-dialog-mezzo-occupato')) {
        const pezzo = `
<div id="mod-dialog-mezzo-occupato" class="mod-dialog-overlay ns-dialog-overlay" hidden aria-hidden="true">
    <div class="ns-dialog ns-dialog-mezzo-occupato" role="dialog" aria-modal="true" aria-labelledby="mod-dialog-mezzo-occupato-titolo">
        <h2 id="mod-dialog-mezzo-occupato-titolo" class="ns-dialog-titolo">Mezzo già in uso</h2>
        <p id="mod-dialog-mezzo-occupato-sottotitolo" class="ns-dialog-sottotitolo"></p>
        <div class="ns-mezzo-occupato-tabella-wrap">
            <table class="ns-mezzo-occupato-tabella">
                <thead>
                    <tr>
                        <th>Ora</th>
                        <th>Operatore</th>
                        <th>Trasportato</th>
                        <th>Comune destinazione</th>
                        <th>Località destinazione</th>
                    </tr>
                </thead>
                <tbody id="mod-dialog-mezzo-occupato-body"></tbody>
            </table>
        </div>
        <div class="ns-dialog-actions">
            <button type="button" id="mod-dialog-mezzo-occupato-chiudi" class="ns-dialog-btn ns-dialog-btn-si">CHIUDI</button>
        </div>
    </div>
</div>`;
        document.body.insertAdjacentHTML('beforeend', pezzo);
    }
}

export function initModificaServizio(options = {}) {
    getInvokeFn = options.getInvoke || (() => null);
    isTauriEnv = options.isTauriEnv || (() => false);
    onSaveSuccess = options.onSaveSuccess || (async () => {});
    onDeleteSuccess = options.onDeleteSuccess || options.onSaveSuccess || (async () => {});
    getTipiPagamentoExtra = options.getTipiPagamentoExtra || (() => []);
    trovaServizioLocal = options.trovaServizioLocal || (() => null);
}

function normalizzaNumero(numStrOrNum) {
    if (numStrOrNum === null || numStrOrNum === undefined) return '';
    if (typeof numStrOrNum === 'number') numStrOrNum = numStrOrNum.toString();
    if (typeof numStrOrNum !== 'string') return '';
    const trimmed = numStrOrNum.trim();
    if (!trimmed) return '';
    if (trimmed.endsWith('.0')) return trimmed.slice(0, -2);
    if (trimmed.includes('.')) {
        const num = parseFloat(trimmed);
        if (!Number.isNaN(num) && num % 1 === 0) return num.toString();
    }
    return trimmed;
}

function costruisciStringaMezzo(servizio) {
    const nrAutomezzo = servizio.mezzo || '';
    if (!nrAutomezzo || (typeof nrAutomezzo === 'string' && nrAutomezzo.trim() === '')) {
        return servizio.mezzo_usato || '';
    }
    const nrNormalizzato = normalizzaNumero(nrAutomezzo);
    if (!allAutomezzi.length) return servizio.mezzo_usato || '';
    const automezzo = allAutomezzi.find(a => {
        if (!a?.nr_automezzo) return false;
        return normalizzaNumero(a.nr_automezzo) === nrNormalizzato;
    });
    if (!automezzo) return servizio.mezzo_usato || '';
    const marca = (automezzo.marca || '').trim();
    const modello = (automezzo.modello || '').trim();
    const nr = normalizzaNumero(automezzo.nr_automezzo) || '';
    const parti = [marca, modello, nr ? `(${nr})` : ''].filter(Boolean);
    return parti.join(' - ');
}

function getStatiServizioOptions() {
    return allStatiServizio.length ? [...allStatiServizio] : [];
}

/** Stato selezionato solo se presente nella lookup Supabase */
function resolveStatoServizioSelezionato(valoreCorrente) {
    const opzioni = getStatiServizioOptions();
    const corrente = String(valoreCorrente || '').trim();
    if (!corrente || !opzioni.length) return opzioni[0] || '';
    const match = opzioni.find(s => s.toUpperCase() === corrente.toUpperCase());
    return match || opzioni[0] || '';
}

function trovaAutomezzoModifica(nrMezzo) {
    const nr = normalizzaNumero(nrMezzo || '');
    if (!nr || !allAutomezzi.length) return null;
    return allAutomezzi.find(a => normalizzaNumero(a.nr_automezzo) === nr) || null;
}

function risolviDotazioneDaMezzo(nrMezzo) {
    return (trovaAutomezzoModifica(nrMezzo)?.dotazione || '').trim();
}

function parseDataScadenzaMezzo(dateStr) {
    if (!dateStr || !String(dateStr).trim()) return null;
    const s = String(dateStr).trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
        const [year, month, day] = s.slice(0, 10).split('-').map(v => parseInt(v, 10));
        const date = new Date(year, month - 1, day);
        if (date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day) {
            return date;
        }
        return null;
    }
    const parts = s.split('/');
    if (parts.length !== 3) return null;
    const day = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10);
    const year = parseInt(parts[2], 10);
    const date = new Date(year, month - 1, day);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
        return null;
    }
    return date;
}

function classeStatoScadenza(dateStr) {
    const scadenza = parseDataScadenzaMezzo(dateStr);
    if (!scadenza) return '';
    const oggi = new Date();
    oggi.setHours(0, 0, 0, 0);
    scadenza.setHours(0, 0, 0, 0);
    if (scadenza < oggi) return 'mod-scadenza-scaduta';
    const diffGiorni = (scadenza - oggi) / (1000 * 60 * 60 * 24);
    if (diffGiorni < 60) return 'mod-scadenza-prossima';
    return '';
}

function valoreScadenzaDisplay(valueIso) {
    if (!valueIso) return '';
    return dataIsoToItaliana(valorePerInputData(valueIso));
}

function creaInputScadenzaModifica(id, label, valueIso, fieldClass = '') {
    const display = valoreScadenzaDisplay(valueIso);
    const statoClasse = classeStatoScadenza(valueIso || display);
    return `<div class="ns-field mod-field-scadenza ${fieldClass}${statoClasse ? ` ${statoClasse}` : ''}">
        <label for="${id}">${escapeHtmlModifica(label)}</label>
        <input type="text" id="${id}" class="ns-input mod-input-scadenza" value="${escapeHtmlModifica(display)}" readonly tabindex="-1">
    </div>`;
}

function applicaStileScadenzaCampo(id, valueIso) {
    const input = document.getElementById(id);
    if (!input) return;
    const field = input.closest('.mod-field-scadenza');
    if (!field) return;
    field.classList.remove('mod-scadenza-prossima', 'mod-scadenza-scaduta');
    input.value = valoreScadenzaDisplay(valueIso);
    const classe = classeStatoScadenza(valueIso || input.value);
    if (classe) field.classList.add(classe);
}

function aggiornaDettagliMezzoModifica() {
    const mezzoEl = document.getElementById('mod-mezzo');
    const automezzo = trovaAutomezzoModifica(mezzoEl?.value || '');

    const dotazioneEl = document.getElementById('mod-dotazione');
    if (dotazioneEl) dotazioneEl.value = (automezzo?.dotazione || '').trim();

    applicaStileScadenzaCampo('mod-scadenza-ztl', automezzo?.scadenza_ztl || '');
    applicaStileScadenzaCampo('mod-scadenza-assicurazione', automezzo?.scadenza_assicurazione || '');

    const noteEl = document.getElementById('mod-note-mezzo');
    if (noteEl) noteEl.value = automezzo?.note_mezzo || '';
}

function escapeHtmlMezzoOccupato(text) {
    return String(text ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function chiudiModaleMezzoOccupatoModifica() {
    const overlay = document.getElementById('mod-dialog-mezzo-occupato');
    if (!overlay) return;
    overlay.hidden = true;
    overlay.setAttribute('aria-hidden', 'true');
}

function mostraModaleMezzoOccupatoModifica(lista, mezzo, dataIso) {
    const overlay = document.getElementById('mod-dialog-mezzo-occupato');
    const sottotitolo = document.getElementById('mod-dialog-mezzo-occupato-sottotitolo');
    const tbody = document.getElementById('mod-dialog-mezzo-occupato-body');
    const btnChiudi = document.getElementById('mod-dialog-mezzo-occupato-chiudi');
    if (!overlay || !tbody) return;

    const dataIt = dataIsoToItaliana(dataIso) || dataIso;
    if (sottotitolo) {
        sottotitolo.textContent =
            `Il mezzo ${mezzo || ''} è già usato in questi servizi del ${dataIt}:`;
    }

    tbody.innerHTML = lista.map((s) => {
        const ora = escapeHtmlMezzoOccupato(s.ora || '—');
        const operatore = escapeHtmlMezzoOccupato(s.operatore || '—');
        const trasportato = escapeHtmlMezzoOccupato(s.trasportato || '—');
        const comuneDest = escapeHtmlMezzoOccupato(s.comune_destinazione || '—');
        const luogoDest = escapeHtmlMezzoOccupato(s.luogo_destinazione || '—');
        return `<tr>
            <td>${ora}</td>
            <td>${operatore}</td>
            <td>${trasportato}</td>
            <td>${comuneDest}</td>
            <td>${luogoDest}</td>
        </tr>`;
    }).join('');

    overlay.hidden = false;
    overlay.setAttribute('aria-hidden', 'false');
    btnChiudi?.focus();
}

function idServizioDaEscludere(idPrefix) {
    const raw =
        document.getElementById(`${idPrefix}-id`)?.value ||
        servizioInModifica?.id ||
        '';
    const n = parseInt(String(raw).trim(), 10);
    return Number.isFinite(n) && n > 0 ? n : null;
}

async function controllaMezzoGiaUsatoNellaDataModifica(idPrefix = 'mod') {
    if (solaLetturaAttiva) return;

    const mezzo = getValoreModifica(`${idPrefix}-mezzo`);
    const dataPrelievo = getValoreModifica(`${idPrefix}-data-prelievo`);
    if (!mezzo || !dataPrelievo) return;
    if (!isTauriEnv()) return;

    const invoke = getInvokeFn();
    if (typeof invoke !== 'function') return;

    try {
        const lista = await invoke('get_servizi_mezzo_nella_data', {
            mezzo,
            dataPrelievo,
            escludiIdServizio: idServizioDaEscludere(idPrefix)
        });
        if (Array.isArray(lista) && lista.length > 0) {
            mostraModaleMezzoOccupatoModifica(lista, mezzo, dataPrelievo);
        }
    } catch (err) {
        console.warn('Controllo mezzo già usato (modifica):', err);
    }
}

function mostraAvvisoModifica(messaggio) {
    return new Promise((resolve) => {
        const overlay = document.getElementById('mod-dialog-avviso');
        const msgEl = document.getElementById('mod-dialog-avviso-messaggio');
        const btnOk = document.getElementById('mod-dialog-avviso-ok');

        if (!overlay || !msgEl || !btnOk) {
            console.warn('Modifica servizio:', messaggio);
            resolve();
            return;
        }

        msgEl.textContent = messaggio;
        overlay.hidden = false;
        overlay.setAttribute('aria-hidden', 'false');

        const chiudi = () => {
            overlay.hidden = true;
            overlay.setAttribute('aria-hidden', 'true');
            btnOk.removeEventListener('click', onOk);
            resolve();
        };

        const onOk = (event) => {
            event.preventDefault();
            event.stopPropagation();
            chiudi();
        };

        btnOk.addEventListener('click', onOk);
    });
}

function valoreDisplayDuplica(val, maxLen = 50) {
    const s = String(val ?? '').trim();
    if (!s) return '—';
    if (s.length <= maxLen) return s;
    return `${s.slice(0, maxLen - 1)}…`;
}

function getOpzioniDuplicazioneConfig() {
    const s = servizioInModifica || {};
    return [
        { key: 'mantieniOraPartenza', label: 'Ora di partenza', valore: valoreDisplayDuplica(s.ora_inizio) },
        { key: 'mantieniOperatore', label: 'Operatore', valore: valoreDisplayDuplica(s.operatore) },
        {
            key: 'mantieniMezzo',
            label: 'Mezzo',
            valore: valoreDisplayDuplica(costruisciStringaMezzo(s) || s.mezzo || s.mezzo_usato)
        },
        { key: 'mantieniMotivazione', label: 'Motivazione', valore: valoreDisplayDuplica(s.motivazione, 60) },
        { key: 'mantieniNotePartenza', label: 'Note partenza', valore: valoreDisplayDuplica(s.note_prelievo, 60) },
        { key: 'mantieniNoteArrivo', label: 'Note arrivo', valore: valoreDisplayDuplica(s.note_arrivo, 60) },
        { key: 'mantieniStatoIncasso', label: 'Stato incasso', valore: valoreDisplayDuplica(s.stato_incasso) },
        { key: 'mantieniTipoPagamento', label: 'Tipo pagamento', valore: valoreDisplayDuplica(s.tipo_pagamento) },
        { key: 'mantieniDonazione', label: 'Donazione', valore: valoreDisplayDuplica(s.pagamento) }
    ];
}

function chiediOpzioniDuplicazione() {
    return new Promise((resolve) => {
        const overlay = document.getElementById('mod-dialog-duplica');
        const btnProcedi = document.getElementById('mod-dialog-duplica-procedi');
        const btnAnnulla = document.getElementById('mod-dialog-duplica-annulla');
        const container = document.getElementById('mod-duplica-opzioni');
        const opzioniConfig = getOpzioniDuplicazioneConfig();

        if (!overlay || !btnProcedi || !btnAnnulla || !container) {
            const fallback = {};
            opzioniConfig.forEach((o) => { fallback[o.key] = false; });
            resolve(fallback);
            return;
        }

        container.innerHTML = opzioniConfig.map((o, i) => `
            <label class="mod-duplica-check">
                <input type="checkbox" id="dup-opt-${i}" data-dup-key="${o.key}">
                <span>${escapeHtmlModifica(o.label)} <span class="mod-duplica-valore">(${escapeHtmlModifica(o.valore)})</span></span>
            </label>
        `).join('');

        overlay.hidden = false;
        overlay.setAttribute('aria-hidden', 'false');

        const chiudi = (opzioni) => {
            overlay.hidden = true;
            overlay.setAttribute('aria-hidden', 'true');
            btnProcedi.removeEventListener('click', onProcedi);
            btnAnnulla.removeEventListener('click', onAnnulla);
            resolve(opzioni);
        };

        const onProcedi = (event) => {
            event.preventDefault();
            event.stopPropagation();
            const opzioni = {};
            opzioniConfig.forEach((o, i) => {
                const el = document.getElementById(`dup-opt-${i}`);
                opzioni[o.key] = Boolean(el?.checked);
            });
            chiudi(opzioni);
        };

        const onAnnulla = (event) => {
            event.preventDefault();
            event.stopPropagation();
            chiudi(null);
        };

        btnProcedi.addEventListener('click', onProcedi);
        btnAnnulla.addEventListener('click', onAnnulla);
    });
}

function chiediConfermaEliminaModifica() {
    return new Promise((resolve) => {
        const overlay = document.getElementById('mod-dialog-elimina');
        const btnSi = document.getElementById('mod-dialog-elimina-si');
        const btnNo = document.getElementById('mod-dialog-elimina-no');

        if (!overlay || !btnSi || !btnNo) {
            resolve(window.confirm('Vuoi veramente eliminare questo servizio?'));
            return;
        }

        overlay.hidden = false;
        overlay.setAttribute('aria-hidden', 'false');

        const chiudi = (risposta) => {
            overlay.hidden = true;
            overlay.setAttribute('aria-hidden', 'true');
            btnSi.removeEventListener('click', onSi);
            btnNo.removeEventListener('click', onNo);
            resolve(risposta);
        };

        const onSi = (event) => {
            event.preventDefault();
            event.stopPropagation();
            chiudi(true);
        };

        const onNo = (event) => {
            event.preventDefault();
            event.stopPropagation();
            chiudi(false);
        };

        btnSi.addEventListener('click', onSi);
        btnNo.addEventListener('click', onNo);
    });
}

function escapeHtmlModifica(str) {
    if (str === undefined || str === null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function mostraErroreModifica(messaggio, chiudi = false) {
    const body = document.getElementById('modal-modifica-body');
    const modal = document.getElementById('modal-modifica');
    const testo = escapeHtmlModifica(String(messaggio || 'Errore sconosciuto'));

    if (body && modal) {
        body.innerHTML = `<p class="modifica-errore">${testo}</p>`;
        modal.style.display = 'flex';
        modal.setAttribute('aria-hidden', 'false');
    }

    console.error('Modifica servizio:', messaggio);

    if (chiudi) {
        setTimeout(() => chiudiModalModifica(), 4000);
    }
}

function pad2(n) {
    return String(n).padStart(2, '0');
}

function dataItalianaToIso(dateStr) {
    if (!dateStr || typeof dateStr !== 'string') return '';
    const parts = dateStr.trim().split('/');
    if (parts.length !== 3) return '';
    const [day, month, year] = parts;
    if (!day || !month || !year) return '';
    return `${year}-${pad2(parseInt(month, 10))}-${pad2(parseInt(day, 10))}`;
}

function dataIsoToItaliana(isoStr) {
    if (!isoStr || typeof isoStr !== 'string') return '';
    const trimmed = isoStr.trim();
    if (trimmed.includes('/')) return trimmed;
    const parts = trimmed.split('-');
    if (parts.length !== 3) return trimmed;
    const [year, month, day] = parts;
    return `${pad2(parseInt(day, 10))}/${pad2(parseInt(month, 10))}/${year}`;
}

function valorePerInputData(val) {
    if (!val) return '';
    const s = String(val).trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    return dataItalianaToIso(s);
}

function valorePerInputOra(val) {
    if (!val) return '';
    const s = String(val).trim();
    const parts = s.split(':');
    if (parts.length >= 2) return `${pad2(parseInt(parts[0], 10))}:${pad2(parseInt(parts[1], 10))}`;
    return s;
}

function valoreDaInputData(val) {
    if (!val) return '';
    return dataIsoToItaliana(val);
}

function creaSelectNs(id, label, value, options, fieldClass = '') {
    const opts = options.map(opt => {
        const val = typeof opt === 'object' ? opt.value : opt;
        const text = typeof opt === 'object' ? opt.label : opt;
        const selected = String(val) === String(value || '') ? ' selected' : '';
        return `<option value="${escapeHtmlModifica(val)}"${selected}>${escapeHtmlModifica(text)}</option>`;
    }).join('');
    return `<div class="ns-field ${fieldClass}">
        <label for="${id}">${escapeHtmlModifica(label)}</label>
        <select id="${id}" class="ns-input">${opts}</select>
    </div>`;
}

function creaInputNs(id, label, value, fieldClass = '', { type = 'text', readonly = false, inputMode = '' } = {}) {
    const inputModeAttr = inputMode ? ` inputmode="${inputMode}"` : '';
    return `<div class="ns-field ${fieldClass}">
        <label for="${id}">${escapeHtmlModifica(label)}</label>
        <input type="${type}" id="${id}" class="ns-input${type === 'date' ? ' ns-input-data' : ''}" value="${escapeHtmlModifica(value)}"${readonly ? ' readonly tabindex="-1"' : ''}${inputModeAttr}>
    </div>`;
}

function creaTextareaNs(id, label, value, fieldClass = '', rows = 2, { readonly = false, textareaClass = '' } = {}) {
    const readonlyAttr = readonly ? ' readonly tabindex="-1"' : '';
    const extraClass = textareaClass ? ` ${textareaClass}` : '';
    return `<div class="ns-field ${fieldClass}">
        <label for="${id}">${escapeHtmlModifica(label)}</label>
        <textarea id="${id}" class="ns-input ns-textarea${extraClass}" rows="${rows}"${readonlyAttr}>${escapeHtmlModifica(value)}</textarea>
    </div>`;
}

export async function ensureDatiFormServizioCaricati() {
    if (!allOperatori.length || !allAutomezzi.length) {
        await caricaDatiModificaServizio();
    }
}

function costruisciFormModifica(servizio) {
    return costruisciFormServizio(servizio, { idPrefix: 'mod', chiusuraPrima: false });
}

export function costruisciFormServizio(
    servizio,
    { idPrefix = 'mod', chiusuraPrima = false, tipiPagamentoExtra = null, mostraArchivia = true, pagamentoSecondo = false } = {}
) {
    const p = idPrefix;
    const tipiPagamento = [...(tipiPagamentoExtra ?? getTipiPagamentoExtra())];
    if (servizio.tipo_pagamento && !tipiPagamento.includes(servizio.tipo_pagamento.trim())) {
        tipiPagamento.push(servizio.tipo_pagamento.trim());
    }

    const operatoriOpts = [{ value: '', label: '— Seleziona operatore —' }].concat(
        allOperatori.map(op => ({
            value: op.nominativo || '',
            label: op.nominativo || ''
        }))
    );
    if (servizio.operatore && !operatoriOpts.some(o => o.value === servizio.operatore)) {
        operatoriOpts.push({ value: servizio.operatore, label: servizio.operatore });
    }

    const mezziOpts = [{ value: '', label: '— Nessuno —' }].concat(
        allAutomezzi.map(m => {
            const nr = normalizzaNumero(m.nr_automezzo);
            const label = [m.marca, m.modello].filter(Boolean).join(' - ') + (nr ? ` (${nr})` : '');
            return { value: nr, label: label || nr };
        })
    );
    const mezzoCorrente = normalizzaNumero(servizio.mezzo || '');
    if (mezzoCorrente && !mezziOpts.some(o => o.value === mezzoCorrente)) {
        mezziOpts.push({ value: mezzoCorrente, label: costruisciStringaMezzo(servizio) || mezzoCorrente });
    }

    const archiviaVal = String(servizio.archivia || '').toLowerCase();
    const archiviaSi = ['true', 'si', 'sì', '1', 'yes'].includes(archiviaVal);
    const automezzoCorrente = trovaAutomezzoModifica(mezzoCorrente);

    const { tratta: trattaDaNote, notePulite } = parseTrattaDaNote(servizio.note_fine_servizio);
    const trattaSalvata = normalizzaPayloadTratta(servizio.tratta_fuori_asti)
        || trattaDaNote;
    const noteFineDisplay = notePulite;

    const sezioneChiusura = (num) => {
        const notaClass = mostraArchivia ? 'mod-chiusura-nota' : 'mod-chiusura-nota mod-chiusura-nota-full';
        const noteRows = mostraArchivia ? 3 : 5;
        const archiviaField = mostraArchivia
            ? creaSelectNs(`${p}-archivia`, 'ARCHIVIA', archiviaSi ? 'SI' : 'NO', ['NO', 'SI'], 'mod-chiusura-archivia')
            : '';
        return `
            <section class="ns-section${chiusuraPrima ? ' ns-section-chiusura-prima' : ''}">
                <h2 class="ns-section-title">${num}. Dati di chiusura del servizio</h2>
                <div class="ns-grid mod-chiusura-grid">
                    ${creaInputNs(`${p}-km-uscita`, 'KM USCITA', servizio.km_uscita || '', 'mod-field-km-uscita', { inputMode: 'decimal' })}
                    ${creaInputNs(`${p}-km-rientro`, 'KM RIENTRO', servizio.km_rientro || '', 'mod-field-km-rientro', { inputMode: 'decimal' })}
                    ${creaInputNs(`${p}-km`, 'KM', servizio.km || '', 'mod-field-km', { inputMode: 'decimal' })}
                    ${creaInputNs(`${p}-tempo`, 'TEMPO', valorePerInputOra(servizio.tempo), 'mod-field-tempo', { type: 'time' })}
                    ${creaTextareaNs(`${p}-note-fine-servizio`, 'NOTE FINE SERVIZIO', noteFineDisplay, notaClass, noteRows)}
                    ${archiviaField}
                </div>
            </section>`;
    };

    const sezioneTrasportato = (num) => `
            <section class="ns-section ns-section-trasportato">
                <h2 class="ns-section-title">${num}. Trasportato</h2>
                <div class="ns-row-selezione">
                    ${creaInputNs(`${p}-idsocio`, 'IDSOCIO', servizio.idsocio, 'ns-field-idsocio', { readonly: true })}
                    ${creaInputNs(`${p}-socio-trasportato`, 'TRASPORTATO', servizio.socio_trasportato, 'ns-field-trasportato')}
                </div>
            </section>`;

    const sezionePrelievo = (num) => `
            <section class="ns-section">
                <h2 class="ns-section-title">${num}. Dati prelievo</h2>
                <div class="ns-grid ns-grid-prelievo">
                    ${creaInputNs(`${p}-data-prelievo`, 'DATA PRELIEVO', valorePerInputData(servizio.data_prelievo), 'ns-field-data-prelievo', { type: 'date' })}
                    ${creaInputNs(`${p}-ora-inizio`, 'ORA SOTTO CASA', valorePerInputOra(servizio.ora_inizio), 'ns-field-ora-prelievo', { type: 'time' })}
                    ${creaInputNs(`${p}-comune-prelievo`, 'COMUNE DI PRELIEVO', servizio.comune_prelievo, 'ns-field-comune-prelievo')}
                    ${creaInputNs(`${p}-luogo-prelievo`, 'LUOGO DI PRELIEVO', servizio.luogo_prelievo, 'ns-field-luogo-prelievo')}
                    ${creaTextareaNs(`${p}-note-prelievo`, 'NOTE PRELIEVO', servizio.note_prelievo, 'ns-field-note-prelievo', 2)}
                </div>
            </section>`;

    const sezioneDestinazione = (num) => `
            <section class="ns-section">
                <h2 class="ns-section-title">${num}. Dati destinazione</h2>
                <div class="ns-grid ns-grid-destinazione">
                    ${creaInputNs(`${p}-ora-arrivo`, 'DATA DESTINAZIONE', valorePerInputData(servizio.ora_arrivo), 'ns-field-data-destinazione', { type: 'date' })}
                    ${creaInputNs(`${p}-comune-destinazione`, 'COMUNE DI DESTINAZIONE', servizio.comune_destinazione, 'ns-field-comune-destinazione')}
                    ${creaInputNs(`${p}-luogo-destinazione`, 'LUOGO DI DESTINAZIONE', servizio.luogo_destinazione, 'ns-field-luogo-destinazione')}
                    ${creaTextareaNs(`${p}-note-arrivo`, 'NOTE ARRIVO', servizio.note_arrivo, 'ns-field-note-arrivo', 2)}
                </div>
            </section>`;

    const sezioneServizio = (num) => `
            <section class="ns-section">
                <h2 class="ns-section-title">${num}. Dati servizio</h2>
                <div class="ns-grid">
                    ${creaSelectNs(`${p}-richiedente`, 'RICHIEDENTE', servizio.richiedente, ['', 'SOCIO', 'COMUNE', 'ALTRI'])}
                    ${creaSelectNs(`${p}-tipo-servizio`, 'TIPO SERVIZIO', servizio.tipo_servizio, ['', 'STANDARD', 'SOLLEVATORE'])}
                    ${creaSelectNs(`${p}-carrozzina`, 'CARROZZINA', servizio.carrozzina, ['', 'AUSER', 'SOCIO'])}
                    ${creaSelectNs(`${p}-stato-servizio`, 'STATO DEL SERVIZIO', resolveStatoServizioSelezionato(servizio.stato_servizio), getStatiServizioOptions())}
                    ${creaInputNs(`${p}-motivazione`, 'MOTIVAZIONE DEL SERVIZIO', servizio.motivazione, 'span-4')}
                </div>
            </section>`;

    const sezioneOperatore = (num) => `
            <section class="ns-section">
                <h2 class="ns-section-title">${num}. Operatore e mezzo</h2>
                <div class="ns-grid ns-grid-operatore">
                    ${creaSelectNs(`${p}-operatore`, 'OPERATORE', servizio.operatore, operatoriOpts, 'ns-field-operatore')}
                    ${creaSelectNs(`${p}-mezzo`, 'MEZZO USATO', mezzoCorrente, mezziOpts, 'ns-field-mezzo')}
                    ${creaInputNs(`${p}-dotazione`, 'DOTAZIONE', risolviDotazioneDaMezzo(mezzoCorrente), 'ns-field-dotazioni', { readonly: true })}
                </div>
                <div class="ns-grid ns-grid-mezzo-dettagli mod-mezzo-dettagli-row">
                    ${creaInputScadenzaModifica(`${p}-scadenza-ztl`, 'SCADENZA ZTL', automezzoCorrente?.scadenza_ztl || '', 'mod-field-scadenza-ztl')}
                    ${creaInputScadenzaModifica(`${p}-scadenza-assicurazione`, 'SCADENZA ASSICURAZIONE', automezzoCorrente?.scadenza_assicurazione || '', 'mod-field-scadenza-assic')}
                    ${creaTextareaNs(`${p}-note-mezzo`, 'NOTE MEZZO', automezzoCorrente?.note_mezzo || '', 'mod-field-note-mezzo ns-field-note-mezzo-compact', 1, { readonly: true, textareaClass: 'ns-textarea-note-mezzo-riga' })}
                </div>
            </section>`;

    const sezionePagamento = (num) => `
            <section class="ns-section ns-section-pagamento">
                <div class="ns-pagamento-layout">
                    <h2 class="ns-section-title ns-pagamento-title">${num}. Pagamento e incasso</h2>
                    <div class="ns-pagamento-quick-btns" aria-label="Importi rapidi donazione">
                        <button type="button" class="ns-btn-importo" data-serv-importo="${p}" data-importo="GRATIS">GRATIS</button>
                        <button type="button" class="ns-btn-importo" data-serv-importo="${p}" data-importo="10">10 €.</button>
                        <button type="button" class="ns-btn-importo" data-serv-importo="${p}" data-importo="15">15 €.</button>
                        <button type="button" class="ns-btn-importo" data-serv-importo="${p}" data-importo="LIBERO">LIBERO</button>
                    </div>
                    <div class="ns-pagamento-azioni-destra">
                        <button type="button" class="ns-btn-tratta-fuori-asti" id="${p}-btn-tratta-fuori-asti">TRATTA FUORI ASTI</button>
                    </div>
                    <div class="ns-grid ns-grid-pagamento">
                        ${creaSelectNs(`${p}-stato-incasso`, 'STATO INCASSO', servizio.stato_incasso, ['DA INCASSARE', 'INCASSATO', 'GRATIS', 'ANNULLATO'], 'ns-field-stato-incasso')}
                        ${creaSelectNs(`${p}-tipo-pagamento`, 'TIPO DI PAGAMENTO', servizio.tipo_pagamento, ['', ...tipiPagamento], 'ns-field-tipo-pagamento')}
                        ${creaInputNs(`${p}-pagamento`, 'DONAZIONE / PAGAMENTO', servizio.pagamento, 'ns-field-donazione')}
                        ${creaInputNs(`${p}-numero-ricevuta`, 'NUMERO RICEVUTA', servizio.numero_ricevuta || '', 'ns-field-numero-ricevuta')}
                        ${creaInputNs(`${p}-data-ricevuta`, 'DATA RICEVUTA', valorePerInputData(servizio.data_ricevuta), 'ns-field-data-ricevuta', { type: 'date' })}
                        ${creaInputNs(`${p}-data-bonifico`, 'DATA INCASSO', valorePerInputData(servizio.data_bonifico), 'ns-field-data-bonifico', { type: 'date' })}
                    </div>
                    ${htmlBloccoRiepilogoTratta(trattaSalvata, { hiddenId: `${p}-tratta-fuori-asti` })}
                </div>
            </section>`;

    const ordineSezioni = chiusuraPrima && pagamentoSecondo
        ? [sezioneChiusura, sezionePagamento, sezioneTrasportato, sezionePrelievo, sezioneDestinazione, sezioneServizio, sezioneOperatore]
        : chiusuraPrima
        ? [sezioneChiusura, sezioneTrasportato, sezionePrelievo, sezioneDestinazione, sezioneServizio, sezioneOperatore, sezionePagamento]
        : [sezioneTrasportato, sezionePrelievo, sezioneDestinazione, sezioneServizio, sezioneOperatore, sezionePagamento, sezioneChiusura];

    const sezioniHtml = ordineSezioni.map((build, index) => build(index + 1)).join('');

    return `
        <form class="ns-form modifica-servizio-form" id="form-${p}-servizio" novalidate>
            <input type="hidden" id="${p}-id" value="${escapeHtmlModifica(servizio.id)}">
            ${sezioniHtml}
        </form>
    `;
}

function formatEuroItalianoModifica(valore) {
    const pulito = String(valore || '')
        .replace(/€/g, '')
        .replace(/\s/g, '')
        .replace(/\./g, '')
        .replace(',', '.');
    const numero = parseFloat(pulito);
    const sicuro = Number.isNaN(numero) ? 0 : numero;
    const parti = sicuro.toFixed(2).split('.');
    parti[0] = parti[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return `${parti[0]},${parti[1]} €`;
}

function parseNumeroKmModifica(val) {
    const s = String(val || '').trim().replace(',', '.');
    if (!s) return null;
    const n = parseFloat(s);
    return Number.isNaN(n) ? null : n;
}

function formattaKmCalcolatoModifica(n) {
    if (!Number.isFinite(n)) return '';
    return String(Number.isInteger(n) ? n : Math.round(n * 100) / 100);
}

function aggiornaKmCalcolatoServizio(idPrefix) {
    const uscitaEl = document.getElementById(`${idPrefix}-km-uscita`);
    const rientroEl = document.getElementById(`${idPrefix}-km-rientro`);
    const kmEl = document.getElementById(`${idPrefix}-km`);
    if (!uscitaEl || !rientroEl || !kmEl) return;

    const uscita = parseNumeroKmModifica(uscitaEl.value);
    const rientro = parseNumeroKmModifica(rientroEl.value);
    if (uscita === null || rientro === null) return;

    kmEl.value = formattaKmCalcolatoModifica(rientro - uscita);
}

function aggiornaDettagliMezzoServizio(idPrefix) {
    const mezzoEl = document.getElementById(`${idPrefix}-mezzo`);
    const automezzo = trovaAutomezzoModifica(mezzoEl?.value || '');

    const dotazioneEl = document.getElementById(`${idPrefix}-dotazione`);
    if (dotazioneEl) dotazioneEl.value = (automezzo?.dotazione || '').trim();

    applicaStileScadenzaCampo(`${idPrefix}-scadenza-ztl`, automezzo?.scadenza_ztl || '');
    applicaStileScadenzaCampo(`${idPrefix}-scadenza-assicurazione`, automezzo?.scadenza_assicurazione || '');

    const noteEl = document.getElementById(`${idPrefix}-note-mezzo`);
    if (noteEl) noteEl.value = automezzo?.note_mezzo || '';
}

export function setupFormServizioListeners(idPrefix = 'mod') {
    trattaTargetPrefix = idPrefix;
    const hiddenTrattaId = `${idPrefix}-tratta-fuori-asti`;

    document.querySelectorAll(`[data-serv-importo="${idPrefix}"]`).forEach(btn => {
        btn.addEventListener('click', () => {
            const tipo = btn.getAttribute('data-importo');
            const campo = document.getElementById(`${idPrefix}-pagamento`);
            const statoIncasso = document.getElementById(`${idPrefix}-stato-incasso`);
            if (!campo) return;

            // Qualsiasi bottone importo cambia la donazione → togli tratta
            avvisaSeTrattaRimossaModifica(rimuoviTrattaDalForm(hiddenTrattaId));

            document.querySelectorAll(`[data-serv-importo="${idPrefix}"]`).forEach(b => b.classList.remove('ns-btn-importo-attivo'));
            btn.classList.add('ns-btn-importo-attivo');

            if (tipo === 'GRATIS') {
                campo.value = '0,00 €';
                if (statoIncasso) statoIncasso.value = 'GRATIS';
                campo.readOnly = true;
            } else if (tipo === '10') {
                campo.value = '10,00 €';
                if (statoIncasso) statoIncasso.value = 'DA INCASSARE';
                campo.readOnly = true;
            } else if (tipo === '15') {
                campo.value = '15,00 €';
                if (statoIncasso) statoIncasso.value = 'DA INCASSARE';
                campo.readOnly = true;
            } else if (tipo === 'LIBERO') {
                campo.readOnly = false;
                campo.focus();
            }
        });
    });

    const campoPagamento = document.getElementById(`${idPrefix}-pagamento`);
    if (campoPagamento) {
        campoPagamento.addEventListener('blur', () => {
            if (campoPagamento.readOnly) return;
            const testo = campoPagamento.value.trim();
            if (testo) campoPagamento.value = formatEuroItalianoModifica(testo);
        });
        campoPagamento.addEventListener('focus', () => {
            if (campoPagamento.readOnly) return;
            campoPagamento.value = campoPagamento.value.replace(/€/g, '').trim();
        });
        const onCambioDonazione = () => {
            if (campoPagamento.readOnly) return;
            if (ignoraCambioPagamentoPerTrattaMod) return;
            avvisaSeTrattaRimossaModifica(rimuoviTrattaDalForm(hiddenTrattaId));
        };
        campoPagamento.addEventListener('input', onCambioDonazione);
        campoPagamento.addEventListener('change', onCambioDonazione);
    }

    document.getElementById(`${idPrefix}-km-uscita`)?.addEventListener('input', () => aggiornaKmCalcolatoServizio(idPrefix));
    document.getElementById(`${idPrefix}-km-rientro`)?.addEventListener('input', () => aggiornaKmCalcolatoServizio(idPrefix));
    document.getElementById(`${idPrefix}-mezzo`)?.addEventListener('change', async () => {
        aggiornaDettagliMezzoServizio(idPrefix);
        await controllaMezzoGiaUsatoNellaDataModifica(idPrefix);
    });
    document.getElementById(`${idPrefix}-data-prelievo`)?.addEventListener('change', async () => {
        await controllaMezzoGiaUsatoNellaDataModifica(idPrefix);
    });

    document.getElementById(`${idPrefix}-btn-tratta-fuori-asti`)?.addEventListener('click', () => {
        trattaTargetPrefix = idPrefix;
        apriFinestraSelezioneTratta();
    });

    setupListenerTrattaPerFormServizio();
}

async function applicaTrattaSelezionataAlForm(idPrefix, tratta) {
    if (!idPrefix || !tratta) return;
    if (!document.getElementById(`${idPrefix}-tratta-fuori-asti`)) return;

    let conRuolo = { ...tratta };
    ignoraCambioPagamentoPerTrattaMod = true;
    try {
        const dove = await chiediPartenzaOArrivo();
        conRuolo = { ...tratta, ruolo: dove };
        compilaCampiLocalitaDaTratta(conRuolo, dove, idPrefix);
    } catch (err) {
        console.warn('Scelta partenza/arrivo tratta (modifica):', err);
    }

    applicaRiepilogoTrattaNelDom(conRuolo, { hiddenId: `${idPrefix}-tratta-fuori-asti` });

    const campo = document.getElementById(`${idPrefix}-pagamento`);
    if (campo && conRuolo.totale != null && String(conRuolo.totale).trim() !== '') {
        campo.value = formatEuroItalianoModifica(conRuolo.totale);
        campo.readOnly = false;
    }

    window.setTimeout(() => {
        ignoraCambioPagamentoPerTrattaMod = false;
    }, 300);
}

async function setupListenerTrattaPerFormServizio() {
    if (listenerTrattaFormAttivo) return;
    listenerTrattaFormAttivo = true;
    await onTrattaFuoriAstiSelezionata((tratta) => {
        const modVisibile = document.getElementById('modal-modifica')?.style.display === 'flex';
        const compVisibile = document.getElementById('modal-completa')?.style.display === 'flex';
        if (!modVisibile && !compVisibile) return;

        let prefix = trattaTargetPrefix;
        if (prefix === 'mod' && !modVisibile) prefix = null;
        if (prefix === 'comp' && !compVisibile) prefix = null;
        if (!prefix) {
            if (compVisibile && document.getElementById('comp-tratta-fuori-asti')) prefix = 'comp';
            else if (modVisibile && document.getElementById('mod-tratta-fuori-asti')) prefix = 'mod';
        }
        if (!prefix) return;
        applicaTrattaSelezionataAlForm(prefix, tratta);
    });
}

function setupFormModificaListeners() {
    setupFormServizioListeners('mod');
}

function getValoreModifica(id) {
    const el = document.getElementById(id);
    return el ? el.value.trim() : '';
}

export function raccogliPayloadServizio(idPrefix = 'mod') {
    const get = (suffix) => getValoreModifica(`${idPrefix}-${suffix}`);
    const noteUtente = document.getElementById(`${idPrefix}-note-fine-servizio`)?.value || '';
    const tratta = leggiTrattaDalDom(`${idPrefix}-tratta-fuori-asti`);
    return {
        id: parseInt(get('id'), 10),
        data_prelievo: valoreDaInputData(get('data-prelievo')),
        idsocio: get('idsocio'),
        socio_trasportato: get('socio-trasportato'),
        ora_inizio: get('ora-inizio'),
        comune_prelievo: get('comune-prelievo'),
        luogo_prelievo: get('luogo-prelievo'),
        tipo_servizio: get('tipo-servizio'),
        carrozzina: get('carrozzina'),
        richiedente: get('richiedente'),
        motivazione: get('motivazione'),
        ora_arrivo: valoreDaInputData(get('ora-arrivo')),
        comune_destinazione: get('comune-destinazione'),
        luogo_destinazione: get('luogo-destinazione'),
        pagamento: get('pagamento'),
        stato_incasso: get('stato-incasso'),
        operatore: get('operatore'),
        mezzo: get('mezzo'),
        tempo: get('tempo'),
        km: get('km'),
        km_uscita: get('km-uscita'),
        km_rientro: get('km-rientro'),
        tipo_pagamento: get('tipo-pagamento'),
        data_bonifico: valoreDaInputData(get('data-bonifico')),
        data_ricevuta: valoreDaInputData(get('data-ricevuta')),
        numero_ricevuta: get('numero-ricevuta'),
        stato_servizio: get('stato-servizio'),
        note_prelievo: document.getElementById(`${idPrefix}-note-prelievo`)?.value || '',
        note_arrivo: document.getElementById(`${idPrefix}-note-arrivo`)?.value || '',
        note_fine_servizio: mergeTrattaInNote(noteUtente, tratta),
        archivia: get('archivia') === 'SI' ? 'SI' : 'NO'
    };
}

function raccogliPayloadModifica() {
    return raccogliPayloadServizio('mod');
}

export async function caricaDatiModificaServizio() {
    const invoke = getInvokeFn();
    if (!isTauriEnv() || !invoke) return;

    try {
        await invoke('init_supabase_from_config').catch(() => {});

        const [tesserati, automezzi, statiServizio] = await Promise.all([
            invoke('get_all_tesserati'),
            invoke('get_all_automezzi'),
            invoke('get_all_stati_servizio').catch(err => {
                console.warn('Errore caricamento stati servizio:', err);
                return [];
            })
        ]);

        allOperatori = (tesserati || []).filter(t => {
            const op = String(t.operatore || '').trim().toUpperCase();
            return op === 'SI' || op === 'TRUE' || op === '1';
        });
        allAutomezzi = Array.isArray(automezzi) ? automezzi : [];
        allStatiServizio = Array.isArray(statiServizio)
            ? statiServizio.filter(s => String(s || '').trim())
            : [];

        console.log(`Modifica servizio: ${allOperatori.length} operatori, ${allAutomezzi.length} mezzi, ${allStatiServizio.length} stati`);
    } catch (error) {
        console.error('Errore caricamento dati modifica servizio:', error);
    }
}

function applicaModalitaSolaLettura(attiva) {
    solaLetturaAttiva = !!attiva;
    pagamentoModificabile = false;
    const modal = document.getElementById('modal-modifica');
    const btnElimina = document.getElementById('btn-elimina-modifica');
    const btnDuplica = document.getElementById('btn-duplica-modifica');
    const btnSalva = document.getElementById('btn-salva-modifica');
    const btnAnnulla = document.getElementById('btn-annulla-modifica');
    const btnModPag = document.getElementById('btn-modifica-pagamento');
    const body = document.getElementById('modal-modifica-body');

    if (modal) {
        modal.classList.toggle('modal-modifica-sola-lettura', solaLetturaAttiva);
        modal.classList.remove('modal-modifica-pagamento-edit');
    }
    if (btnElimina) btnElimina.hidden = solaLetturaAttiva;
    if (btnDuplica) btnDuplica.hidden = solaLetturaAttiva;
    if (btnSalva) btnSalva.hidden = solaLetturaAttiva;
    if (btnModPag) btnModPag.hidden = !solaLetturaAttiva;
    if (btnAnnulla) btnAnnulla.textContent = solaLetturaAttiva ? 'CHIUDI' : 'ANNULLA';

    if (!solaLetturaAttiva || !body) return;

    body.querySelectorAll('.ns-section-pagamento').forEach(el => {
        el.classList.remove('mod-pagamento-editabile');
    });
    body.querySelectorAll('.ns-pagamento-quick-btns').forEach(el => {
        el.hidden = true;
    });
    body.querySelectorAll('.ns-pagamento-azioni-destra').forEach(el => {
        el.hidden = true;
    });
    body.querySelectorAll('input, select, textarea, button').forEach(el => {
        if (el.tagName === 'BUTTON') {
            el.disabled = true;
            return;
        }
        el.disabled = true;
        if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
            el.readOnly = true;
        }
    });
}

function abilitaModificaPagamento() {
    if (!solaLetturaAttiva || pagamentoModificabile) return;

    const body = document.getElementById('modal-modifica-body');
    const modal = document.getElementById('modal-modifica');
    const sezione = body?.querySelector('.ns-section-pagamento');
    if (!sezione) return;

    pagamentoModificabile = true;
    if (modal) modal.classList.add('modal-modifica-pagamento-edit');
    sezione.classList.add('mod-pagamento-editabile');

    sezione.querySelectorAll('.ns-pagamento-quick-btns').forEach(el => {
        el.hidden = false;
    });
    sezione.querySelectorAll('.ns-pagamento-azioni-destra').forEach(el => {
        el.hidden = false;
    });
    sezione.querySelectorAll('input, select, textarea, button').forEach(el => {
        el.disabled = false;
        if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
            // LIBERO gestisce readOnly sul campo importo; gli altri restano editabili
            if (!el.classList.contains('mod-input-scadenza')) {
                el.readOnly = false;
            }
        }
    });

    trattaTargetPrefix = 'mod';

    const btnModPag = document.getElementById('btn-modifica-pagamento');
    const btnSalva = document.getElementById('btn-salva-modifica');
    const title = document.getElementById('modal-modifica-title');
    if (btnModPag) btnModPag.hidden = true;
    if (btnSalva) btnSalva.hidden = false;
    if (title && servizioInModifica) {
        title.textContent = `SERVIZIO ${servizioInModifica.id || ''} — PAGAMENTO`;
    }

    sezione.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

export async function apriModalModifica(servizioId, options = {}) {
    const avvisoIniziale = options.avvisoIniziale || '';
    const solaLettura = !!options.solaLettura;
    const modal = document.getElementById('modal-modifica');
    const body = document.getElementById('modal-modifica-body');
    const title = document.getElementById('modal-modifica-title');
    if (!modal || !body) {
        console.error('Modale modifica servizio non trovato nel DOM');
        mostraErroreModifica('Errore: modale modifica non trovato nella pagina.');
        return;
    }

    const idNumerico = parseInt(servizioId, 10);
    if (!idNumerico || Number.isNaN(idNumerico)) {
        mostraErroreModifica('ID servizio non valido.');
        return;
    }

    const invoke = getInvokeFn();
    let servizio = trovaServizioLocal(servizioId);

    if (isTauriEnv() && invoke) {
        try {
            await invoke('init_supabase_from_config').catch(() => {});
            if (!allOperatori.length || !allAutomezzi.length) {
                await caricaDatiModificaServizio();
            }
            servizio = await invoke('get_servizio_completo', { servizioId: idNumerico });
        } catch (error) {
            console.warn('Caricamento servizio da server:', error);
            if (!servizio) {
                mostraErroreModifica('Impossibile caricare il servizio: ' + (error.message || error));
                return;
            }
        }
    }

    if (!servizio) {
        mostraErroreModifica('Servizio non trovato.');
        return;
    }

    servizioInModifica = servizio;
    if (title) {
        title.textContent = solaLettura
            ? `SERVIZIO ${servizio.id || ''}`
            : `MODIFICA SERVIZIO ${servizio.id || ''}`;
    }
    body.innerHTML = costruisciFormModifica(servizio);
    setupFormModificaListeners();
    applicaModalitaSolaLettura(solaLettura);
    modal.style.display = 'flex';
    modal.setAttribute('aria-hidden', 'false');

    if (avvisoIniziale) {
        await mostraAvvisoModifica(avvisoIniziale);
    }
}

export function chiudiModalModifica() {
    const modal = document.getElementById('modal-modifica');
    if (!modal) return;
    modal.style.display = 'none';
    modal.setAttribute('aria-hidden', 'true');
    servizioInModifica = null;
    pagamentoModificabile = false;
    if (solaLetturaAttiva) {
        applicaModalitaSolaLettura(false);
    } else {
        const btnModPag = document.getElementById('btn-modifica-pagamento');
        if (btnModPag) btnModPag.hidden = true;
        modal.classList.remove('modal-modifica-pagamento-edit');
    }
}

async function eliminaServizioModifica() {
    const id = parseInt(servizioInModifica?.id, 10);
    if (!id || Number.isNaN(id)) {
        mostraErroreModifica('ID servizio non valido.');
        return;
    }

    const conferma = await chiediConfermaEliminaModifica();
    if (!conferma) return;

    const btnElimina = document.getElementById('btn-elimina-modifica');
    if (btnElimina) btnElimina.disabled = true;

    try {
        const invoke = getInvokeFn();
        if (isTauriEnv() && invoke) {
            await invoke('init_supabase_from_config').catch(() => {});
            await invoke('delete_servizio', { servizioId: id });
            await onDeleteSuccess(id);
            chiudiModalModifica();
        } else {
            await onDeleteSuccess(id);
            chiudiModalModifica();
        }
    } catch (error) {
        console.error('Errore eliminazione servizio:', error);
        mostraErroreModifica('Errore nell\'eliminazione: ' + (error.message || error));
    } finally {
        if (btnElimina) btnElimina.disabled = false;
    }
}

async function duplicaServizioModifica() {
    const id = parseInt(servizioInModifica?.id, 10);
    if (!id || Number.isNaN(id)) {
        mostraErroreModifica('ID servizio non valido.');
        return;
    }

    const opzioni = await chiediOpzioniDuplicazione();
    if (!opzioni) return;

    const btnDuplica = document.getElementById('btn-duplica-modifica');
    if (btnDuplica) btnDuplica.disabled = true;

    try {
        const invoke = getInvokeFn();
        if (isTauriEnv() && invoke) {
            await invoke('init_supabase_from_config').catch(() => {});
            const nuovoId = await invoke('duplicate_servizio', { servizioId: id, opzioni });
            const nuovoServizio = await invoke('get_servizio_completo', { servizioId: nuovoId });
            await onSaveSuccess(nuovoServizio);
            chiudiModalModifica();
            await apriModalModifica(nuovoId, {
                avvisoIniziale:
                    'Servizio duplicato. Imposta la nuova data di prelievo e controlla i dati prima di salvare.'
            });
        } else {
            mostraErroreModifica('Duplicazione disponibile solo con connessione al database.');
        }
    } catch (error) {
        console.error('Errore duplicazione servizio:', error);
        mostraErroreModifica('Errore nella duplicazione: ' + (error.message || error));
    } finally {
        if (btnDuplica) btnDuplica.disabled = false;
    }
}

async function salvaModificaServizio() {
    const payload = raccogliPayloadModifica();
    if (!payload.id || Number.isNaN(payload.id)) {
        mostraErroreModifica('ID servizio non valido.');
        return;
    }

    const btnSalva = document.getElementById('btn-salva-modifica');
    if (btnSalva) btnSalva.disabled = true;

    try {
        const invoke = getInvokeFn();
        if (isTauriEnv() && invoke) {
            await invoke('init_supabase_from_config').catch(() => {});
            await invoke('update_servizio_completo', { payload });
            const aggiornato = await invoke('get_servizio_completo', { servizioId: payload.id });
            await onSaveSuccess(aggiornato, payload);
            chiudiModalModifica();
        } else {
            const demo = { ...servizioInModifica, ...payload, id: String(payload.id) };
            await onSaveSuccess(demo, payload);
            chiudiModalModifica();
        }
    } catch (error) {
        console.error('Errore salvataggio servizio:', error);
        mostraErroreModifica('Errore nel salvataggio: ' + (error.message || error));
    } finally {
        if (btnSalva) btnSalva.disabled = false;
    }
}

export function setupModaleModifica() {
    injectModaleModificaMarkup();

    document.getElementById('btn-annulla-modifica')?.addEventListener('click', chiudiModalModifica);
    document.getElementById('btn-salva-modifica')?.addEventListener('click', salvaModificaServizio);
    document.getElementById('btn-elimina-modifica')?.addEventListener('click', eliminaServizioModifica);
    document.getElementById('btn-duplica-modifica')?.addEventListener('click', duplicaServizioModifica);
    document.getElementById('btn-modifica-pagamento')?.addEventListener('click', abilitaModificaPagamento);
    document.getElementById('mod-dialog-mezzo-occupato-chiudi')
        ?.addEventListener('click', chiudiModaleMezzoOccupatoModifica);

    const modal = document.getElementById('modal-modifica');
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) chiudiModalModifica();
        });
    }

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal?.style.display === 'flex') {
            chiudiModalModifica();
        }
    });
}
