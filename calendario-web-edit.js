/**
 * Modifica servizio dal calendario web (solo amministratore).
 * Campi a scelta → <select>; altri → input/textarea editabili.
 */

function escapeAttr(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;');
}

function escapeText(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/** dd/mm/yyyy o ISO → yyyy-mm-dd per input type=date */
export function dataToInputDate(val) {
    const s = String(val || '').trim();
    if (!s) return '';
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    const parts = s.split('/');
    if (parts.length === 3) {
        const [d, m, y] = parts;
        return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    }
    return '';
}

/** yyyy-mm-dd → dd/mm/yyyy */
export function inputDateToItalian(iso) {
    const s = String(iso || '').trim();
    if (!s) return '';
    const parts = s.split('-');
    if (parts.length !== 3) return s;
    return `${parts[2].padStart(2, '0')}/${parts[1].padStart(2, '0')}/${parts[0]}`;
}

export function isUtenteAdmin(perm) {
    return perm?.is_admin === true;
}

function optionsHtml(opzioni, selected, emptyLabel = '—') {
    const sel = String(selected ?? '').trim();
    const seen = new Set();
    const parts = [];
    if (emptyLabel != null) {
        parts.push(`<option value="">${escapeText(emptyLabel)}</option>`);
    }
    const list = Array.isArray(opzioni) ? opzioni : [];
    for (const item of list) {
        const value = typeof item === 'object' ? String(item.value ?? '') : String(item ?? '');
        const label = typeof item === 'object' ? String(item.label ?? item.value ?? '') : String(item ?? '');
        if (!value || seen.has(value)) continue;
        seen.add(value);
        const isSel = value === sel || label === sel;
        parts.push(
            `<option value="${escapeAttr(value)}"${isSel ? ' selected' : ''}>${escapeText(label)}</option>`
        );
    }
    if (sel && !seen.has(sel)) {
        parts.push(`<option value="${escapeAttr(sel)}" selected>${escapeText(sel)}</option>`);
    }
    return parts.join('');
}

/**
 * @param {{ label: string, name: string, value?: string, classe?: string, type?: string, options?: array, readonly?: boolean, emptyLabel?: string }} cfg
 */
export function creaCampoModale(cfg) {
    const {
        label,
        name,
        value = '',
        classe = '',
        type = 'text',
        options = null,
        readonly = false,
        emptyLabel = '—'
    } = cfg;

    const ro = readonly ? 'readonly' : '';
    const dis = readonly && options ? 'disabled' : '';

    let controllo;
    if (Array.isArray(options)) {
        controllo = `<select class="dettaglio-edit-control" name="${escapeAttr(name)}" data-field="${escapeAttr(name)}" ${dis}>
            ${optionsHtml(options, value, emptyLabel)}
        </select>`;
    } else if (type === 'textarea') {
        controllo = `<textarea class="dettaglio-edit-control" name="${escapeAttr(name)}" data-field="${escapeAttr(name)}" ${ro}>${escapeText(value)}</textarea>`;
    } else {
        const v = type === 'date' ? dataToInputDate(value) : value;
        controllo = `<input class="dettaglio-edit-control" type="${escapeAttr(type)}" name="${escapeAttr(name)}" data-field="${escapeAttr(name)}" value="${escapeAttr(v)}" ${ro}>`;
    }

    return `<div class="dettaglio-field ${classe}">
        <label>${escapeText(label)}</label>
        ${controllo}
    </div>`;
}

export function creaNotaModale(label, name, value, readonly = false) {
    return creaCampoModale({
        label,
        name,
        value,
        classe: 'field-note',
        type: 'textarea',
        readonly
    });
}

/**
 * HTML corpo modale in modalità modifica admin.
 * @param {object} servizio
 * @param {object} opzioni { operatori, mezzi, richiedenti, tipiPagamento, statiServizio, statiIncasso, tipiServizio, carrozzine }
 */
export function htmlDettaglioServizioEditabile(servizio, opzioni = {}) {
    const s = servizio || {};
    const mezzoVal = String(s.mezzo || '').trim();
    const opId = String(s.operatore_id || '').trim();

    return `
        <p class="dettaglio-edit-hint">Modalità amministratore: puoi modificare i campi e poi cliccare SALVA MODIFICHE.</p>
        <div class="dettaglio-section dettaglio-editabile">
            <div class="dettaglio-row">
                ${creaCampoModale({ label: 'IDSERVIZIO', name: 'id', value: s.id, classe: 'field-small', readonly: true })}
                ${creaCampoModale({ label: 'IDSOCIO', name: 'idsocio', value: s.idsocio, classe: 'field-small' })}
                ${creaCampoModale({ label: 'DATA PRELIEVO', name: 'data_prelievo', value: s.data_prelievo, classe: 'field-medium', type: 'date' })}
                ${creaCampoModale({ label: 'ORA SOTTOCASA', name: 'ora_inizio', value: s.ora_inizio, classe: 'field-small', type: 'time' })}
                ${creaCampoModale({ label: 'COMUNE PRELIEVO', name: 'comune_prelievo', value: s.comune_prelievo })}
                ${creaCampoModale({ label: 'LUOGO PRELIEVO', name: 'luogo_prelievo', value: s.luogo_prelievo, classe: 'field-large' })}
            </div>
            <div class="dettaglio-row">
                ${creaNotaModale('NOTE PRELIEVO', 'note_prelievo', s.note_prelievo)}
            </div>
            <div class="dettaglio-row">
                ${creaCampoModale({ label: 'TRASPORTATO', name: 'socio_trasportato', value: s.socio_trasportato, classe: 'field-trasportato' })}
                ${creaCampoModale({ label: 'RICHIEDENTE', name: 'richiedente', value: s.richiedente, options: opzioni.richiedenti || [] })}
                ${creaCampoModale({ label: 'TIPO SERVIZIO', name: 'tipo_servizio', value: s.tipo_servizio, classe: 'field-tipo-servizio', options: opzioni.tipiServizio || [], emptyLabel: '—' })}
                ${creaCampoModale({ label: 'CARROZZINA', name: 'carrozzina', value: s.carrozzina, classe: 'field-carrozzina', options: opzioni.carrozzine || [], emptyLabel: '— Nessuna —' })}
                ${creaCampoModale({ label: 'MOTIVAZIONE', name: 'motivazione', value: s.motivazione, classe: 'field-large' })}
            </div>
            <div class="dettaglio-row">
                ${creaCampoModale({ label: 'DATA DESTINAZIONE', name: 'ora_arrivo', value: s.ora_arrivo, classe: 'field-small', type: 'date' })}
                ${creaCampoModale({ label: 'COMUNE DESTINAZIONE', name: 'comune_destinazione', value: s.comune_destinazione })}
                ${creaCampoModale({ label: 'LUOGO DESTINAZIONE', name: 'luogo_destinazione', value: s.luogo_destinazione, classe: 'field-large' })}
                ${creaCampoModale({ label: 'STATO INCASSO', name: 'stato_incasso', value: s.stato_incasso, options: opzioni.statiIncasso || [], emptyLabel: null })}
                ${creaCampoModale({ label: 'TIPO PAGAMENTO', name: 'tipo_pagamento', value: s.tipo_pagamento, options: opzioni.tipiPagamento || [] })}
            </div>
            <div class="dettaglio-row">
                ${creaNotaModale('NOTE ARRIVO', 'note_arrivo', s.note_arrivo)}
            </div>
            <div class="dettaglio-row">
                ${creaCampoModale({ label: 'OPERATORE', name: 'operatore_id', value: opId, classe: 'field-large', options: opzioni.operatori || [], emptyLabel: '— Nessuno —' })}
                ${creaCampoModale({ label: 'MEZZO', name: 'mezzo', value: mezzoVal, classe: 'field-large', options: opzioni.mezzi || [], emptyLabel: '— Nessuno —' })}
                ${creaCampoModale({ label: 'TEMPO', name: 'tempo', value: s.tempo, classe: 'field-small', type: 'text' })}
                ${creaCampoModale({ label: 'KM', name: 'km', value: s.km, classe: 'field-small' })}
            </div>
            <div class="dettaglio-row">
                ${creaCampoModale({ label: 'PAGAMENTO', name: 'pagamento', value: s.pagamento })}
                ${creaCampoModale({ label: 'DATA BONIFICO', name: 'data_bonifico', value: s.data_bonifico, type: 'date' })}
                ${creaCampoModale({ label: 'DATA RICEVUTA', name: 'data_ricevuta', value: s.data_ricevuta, type: 'date' })}
                ${creaCampoModale({ label: 'NUMERO RICEVUTA', name: 'numero_ricevuta', value: s.numero_ricevuta })}
                ${creaCampoModale({ label: 'STATO SERVIZIO', name: 'stato_servizio', value: s.stato_servizio, options: opzioni.statiServizio || [], emptyLabel: null })}
            </div>
            <div class="dettaglio-row">
                ${creaNotaModale('NOTE FINE SERVIZIO', 'note_fine_servizio_visibili', '')}
            </div>
        </div>
    `;
}

/** Dopo aver creato l'HTML, valorizza le note fine (senza blocco tratta) */
export function valorizzaNoteFineEditabili(root, noteVisibili) {
    const el = root?.querySelector?.('[data-field="note_fine_servizio_visibili"]');
    if (el) el.value = noteVisibili || '';
}

export function raccogliDatiModaleAdmin(root) {
    if (!root) return {};
    const dati = {};
    root.querySelectorAll('[data-field]').forEach((el) => {
        const key = el.getAttribute('data-field');
        if (!key) return;
        dati[key] = String(el.value ?? '').trim();
    });
    return dati;
}

function parseEuroToNumber(raw) {
    const s = String(raw || '').trim().replace('€', '').replace(/\s/g, '').replace(',', '.');
    if (!s) return null;
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : null;
}

function normalizzaTempo(tempoRaw) {
    const t = String(tempoRaw || '').trim();
    if (!t) return '';
    if (/^\d{1,2}:\d{2}$/.test(t)) return `${t}:00`;
    if (/^\d{1,2}:\d{2}:\d{2}$/.test(t)) return t;
    return t;
}

/**
 * Costruisce il payload PATCH Supabase dai dati del form admin.
 */
export function buildPayloadUpdateServizio(servizio, dati, mergeNoteFineFn) {
    const payload = {};
    const s = servizio || {};

    // Supabase date column vuole ISO
    if (dati.data_prelievo) {
        payload.Prelievo_Data = dataToInputDate(dati.data_prelievo) || null;
    }

    if (dati.idsocio !== undefined) {
        const idNum = parseInt(dati.idsocio, 10);
        payload.IdSocio = Number.isNaN(idNum) ? (dati.idsocio || null) : idNum;
    }

    payload.Trasportato = dati.socio_trasportato ?? '';
    payload.Prelievo_Ora = dati.ora_inizio ? (dati.ora_inizio.length === 5 ? `${dati.ora_inizio}:00` : dati.ora_inizio) : null;
    payload.Prelievo_Comune = dati.comune_prelievo ?? '';
    payload.Prelievo_Indirizzo = dati.luogo_prelievo ?? '';
    payload.Prelievo_Note = dati.note_prelievo ?? '';
    payload.Richiedente = dati.richiedente ?? '';
    payload.Motivazione = dati.motivazione ?? '';
    payload.Carrozzina = dati.carrozzina ?? '';

    const tipo = String(dati.tipo_servizio || '').trim().toUpperCase();
    if (tipo === 'SOLLEVATORE' || tipo === 'STANDARD' || tipo === '') {
        // In Servizi_supa i flag sono tipicamente boolean o SI/NO: inviamo boolean
        payload.Sollevatore = tipo === 'SOLLEVATORE';
        payload.Standard = tipo === 'STANDARD';
    }

    if (dati.ora_arrivo) {
        payload.Destinazione_Data = dataToInputDate(dati.ora_arrivo) || null;
    } else {
        payload.Destinazione_Data = null;
    }
    payload.Destinazione_Comune = dati.comune_destinazione ?? '';
    payload.Destinazione_Indirizzo = dati.luogo_destinazione ?? '';
    payload.Destinazione_Note = dati.note_arrivo ?? '';
    payload.Incassato = dati.stato_incasso || 'DA INCASSARE';
    payload.TipoPagamento = dati.tipo_pagamento ?? '';

    if (dati.operatore_id !== undefined) {
        const op = String(dati.operatore_id || '').trim();
        if (!op) {
            payload.IdOperatore = null;
        } else {
            const n = parseInt(op, 10);
            payload.IdOperatore = Number.isNaN(n) ? op : n;
        }
    }

    if (dati.mezzo !== undefined) {
        const m = String(dati.mezzo || '').trim();
        if (!m) payload.Mezzo = null;
        else {
            const n = parseInt(m, 10);
            payload.Mezzo = Number.isNaN(n) ? m : n;
        }
    }

    const colTempo = s._colTempo || 'Tempo';
    const colKm = s._colKm || 'Km';
    const colNote = s._colNote || 'NoteFineServizio';

    const tempoNorm = normalizzaTempo(dati.tempo);
    payload[colTempo] = tempoNorm || null;

    if (dati.km !== undefined) {
        const kmNum = parseFloat(String(dati.km).replace(',', '.'));
        payload[colKm] = Number.isFinite(kmNum) ? kmNum : (dati.km || null);
    }

    const euro = parseEuroToNumber(dati.pagamento);
    if (euro !== null) payload.Donazioni = euro;
    else if (dati.pagamento === '') payload.Donazioni = null;

    if (dati.data_bonifico) payload.Bonifico_Data = dataToInputDate(dati.data_bonifico) || null;
    else payload.Bonifico_Data = null;

    if (dati.data_ricevuta) payload.Ricevuta_Data = dataToInputDate(dati.data_ricevuta) || null;
    else payload.Ricevuta_Data = null;

    payload.Ricevuta_numero = dati.numero_ricevuta ?? '';
    payload.StatoServizio = dati.stato_servizio ?? '';

    const noteVisibili = dati.note_fine_servizio_visibili ?? '';
    const noteMerged = typeof mergeNoteFineFn === 'function'
        ? mergeNoteFineFn(noteVisibili, s.note_fine_servizio || '')
        : noteVisibili;
    payload[colNote] = noteMerged;

    // Rimuovi chiavi inutili se date prelievo vuota non deve essere null forzato
    if (!dati.data_prelievo) delete payload.Prelievo_Data;

    return payload;
}

export const OPZIONI_DEFAULT = {
    tipiServizio: [
        { value: 'STANDARD', label: 'STANDARD' },
        { value: 'SOLLEVATORE', label: 'SOLLEVATORE' }
    ],
    carrozzine: [
        { value: 'AUSER', label: 'AUSER' },
        { value: 'SOCIO', label: 'SOCIO' }
    ],
    statiIncasso: [
        { value: 'DA INCASSARE', label: 'DA INCASSARE' },
        { value: 'INCASSATO', label: 'INCASSATO' },
        { value: 'GRATIS', label: 'GRATIS' },
        { value: 'ANNULLATO', label: 'ANNULLATO' }
    ],
    statiServizio: [
        { value: 'DA ESEGUIRE', label: 'DA ESEGUIRE' },
        { value: 'ESEGUITO', label: 'ESEGUITO' },
        { value: 'ANNULLATO', label: 'ANNULLATO' }
    ],
    tipiPagamento: [
        { value: 'CONTANTI', label: 'CONTANTI' },
        { value: 'BONIFICO', label: 'BONIFICO' },
        { value: 'ASSEGNO', label: 'ASSEGNO' }
    ],
    richiedenti: [
        { value: 'SOCIO', label: 'SOCIO' },
        { value: 'COMUNE', label: 'COMUNE' },
        { value: 'ALTRI', label: 'ALTRI' }
    ]
};
