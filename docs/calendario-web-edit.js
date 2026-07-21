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
    if (!perm) return false;
    const v = perm.is_admin ?? perm.Is_Admin ?? perm.isAdmin ?? perm.IS_ADMIN;
    if (v === true || v === 1) return true;
    const s = String(v ?? '').trim().toLowerCase();
    return s === 'true' || s === '1' || s === 'si' || s === 'sì' || s === 'yes' || s === 't';
}

/** Trova il nome colonna reale nella riga Supabase (case-insensitive). */
export function resolveColonna(row, candidates, fallback) {
    if (row && typeof row === 'object') {
        const keys = Object.keys(row);
        for (const name of candidates) {
            if (Object.prototype.hasOwnProperty.call(row, name)) return name;
        }
        for (const name of candidates) {
            const found = keys.find((k) => k.toLowerCase() === String(name).toLowerCase());
            if (found) return found;
        }
        // euristica: note + prelievo
        const joined = candidates.join(' ').toLowerCase();
        if (joined.includes('prelievo') && joined.includes('note')) {
            const hit = keys.find((k) => /prelievo.*note|note.*prelievo/i.test(k));
            if (hit) return hit;
        }
        if (joined.includes('destinazione') && joined.includes('note')) {
            const hit = keys.find((k) => /destinazione.*note|note.*destinazione|note.*arrivo/i.test(k));
            if (hit) return hit;
        }
        if (joined.includes('ricevuta') && joined.includes('numero')) {
            const hit = keys.find((k) => /ricevuta.*numero|numero.*ricevuta/i.test(k));
            if (hit) return hit;
        }
        // Con riga nota e nessun match: non usare fallback inventato
        if (fallback === null || fallback === undefined) return null;
        // Se la riga c'è ma la colonna no, meglio non inventare nomi
        if (keys.length > 0 && fallback != null) {
            const fbHit = keys.find((k) => k.toLowerCase() === String(fallback).toLowerCase());
            return fbHit || null;
        }
    }
    return fallback ?? null;
}

function valoreBoolPerColonna(row, colName, value) {
    const raw = row?.[colName];
    if (typeof raw === 'boolean') return Boolean(value);
    if (typeof raw === 'number') return value ? 1 : 0;
    if (typeof raw === 'string') {
        const u = raw.trim().toUpperCase();
        if (u === 'SI' || u === 'NO' || u === 'SÌ') return value ? 'SI' : 'NO';
        if (u === 'TRUE' || u === 'FALSE') return value ? 'TRUE' : 'FALSE';
        if (u === '1' || u === '0') return value ? '1' : '0';
    }
    return Boolean(value);
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

export function valorizzaNoteFineEditabili(root, noteVisibili) {
    const el = root?.querySelector?.('[data-field="note_fine_servizio_visibili"]');
    if (el) el.value = noteVisibili || '';
}

export function raccogliDatiModaleAdmin(root) {
    if (!root) return {};
    const dati = {};
    root.querySelectorAll('[data-field]').forEach((el) => {
        if (el.disabled) return;
        const key = el.getAttribute('data-field');
        if (!key) return;
        dati[key] = String(el.value ?? '').trim();
    });
    // Lettura esplicita note (più affidabile)
    const noteP = root.querySelector('[data-field="note_prelievo"]');
    const noteA = root.querySelector('[data-field="note_arrivo"]');
    const noteF = root.querySelector('[data-field="note_fine_servizio_visibili"]');
    if (noteP) dati.note_prelievo = String(noteP.value ?? '');
    if (noteA) dati.note_arrivo = String(noteA.value ?? '');
    if (noteF) dati.note_fine_servizio_visibili = String(noteF.value ?? '');
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

function setCampo(payload, row, candidates, fallback, value) {
    const hasRow = row && typeof row === 'object' && Object.keys(row).length > 0;
    if (hasRow) {
        const key = resolveColonna(row, candidates, null);
        if (!key) {
            // Colonna assente nello schema reale della riga: non inviare (evita PGRST204)
            return null;
        }
        // Conferma case-sensitive sul nome reale
        const realKey = Object.keys(row).find((k) => k.toLowerCase() === String(key).toLowerCase()) || key;
        payload[realKey] = value;
        return realKey;
    }
    const key = resolveColonna(row, candidates, fallback);
    payload[key] = value;
    return key;
}

/**
 * Costruisce il payload PATCH Supabase dai dati del form admin.
 * Usa i nomi colonna reali della riga (_raw) quando disponibili.
 */
export function buildPayloadUpdateServizio(servizio, dati, mergeNoteFineFn) {
    const payload = {};
    const s = servizio || {};
    const row = s._raw || {};

    if (dati.data_prelievo) {
        const iso = dataToInputDate(dati.data_prelievo);
        if (iso) setCampo(payload, row, ['Prelievo_Data', 'DATA_PRELIEVO', 'Data_Prelievo'], 'Prelievo_Data', iso);
    }

    if (dati.idsocio !== undefined && dati.idsocio !== '') {
        const idNum = parseInt(dati.idsocio, 10);
        setCampo(
            payload,
            row,
            ['IdSocio', 'IDSOCIO'],
            'IdSocio',
            Number.isNaN(idNum) ? dati.idsocio : idNum
        );
    }

    setCampo(payload, row, ['Trasportato', 'TRASP', 'Trasp'], 'Trasportato', dati.socio_trasportato ?? '');

    if (dati.ora_inizio) {
        const ora = dati.ora_inizio.length === 5 ? `${dati.ora_inizio}:00` : dati.ora_inizio;
        setCampo(payload, row, ['Prelievo_Ora', 'ORA_PRELIEVO', 'OraPrelievo', 'Ora_Prelievo'], 'Prelievo_Ora', ora);
    }

    setCampo(payload, row, ['Prelievo_Comune', 'PRELIEVO_COMUNE'], 'Prelievo_Comune', dati.comune_prelievo ?? '');
    setCampo(payload, row, ['Prelievo_Indirizzo', 'PRELIEVO_INDIRIZZO'], 'Prelievo_Indirizzo', dati.luogo_prelievo ?? '');

    const colNotePrelievo = setCampo(
        payload,
        row,
        ['Prelievo_Note', 'PRELIEVO_NOTE', 'Note_Prelievo', 'NotePrelievo'],
        'Prelievo_Note',
        dati.note_prelievo ?? ''
    );

    setCampo(payload, row, ['Richiedente', 'RICHIEDENTE'], 'Richiedente', dati.richiedente ?? '');
    setCampo(payload, row, ['Motivazione', 'MOTIVAZIONE'], 'Motivazione', dati.motivazione ?? '');
    setCampo(payload, row, ['Carrozzina', 'CARROZZINA'], 'Carrozzina', dati.carrozzina ?? '');

    const tipo = String(dati.tipo_servizio || '').trim().toUpperCase();
    if (tipo === 'SOLLEVATORE' || tipo === 'STANDARD' || tipo === '') {
        const colSol = resolveColonna(row, ['Sollevatore', 'SOLLEVATORE'], 'Sollevatore');
        const colStd = resolveColonna(row, ['Standard', 'STANDARD'], 'Standard');
        const hasSol = !row || !Object.keys(row).length
            || Object.keys(row).some((k) => k.toLowerCase() === colSol.toLowerCase());
        const hasStd = !row || !Object.keys(row).length
            || Object.keys(row).some((k) => k.toLowerCase() === colStd.toLowerCase());
        if (hasSol) payload[colSol] = valoreBoolPerColonna(row, colSol, tipo === 'SOLLEVATORE');
        if (hasStd) payload[colStd] = valoreBoolPerColonna(row, colStd, tipo === 'STANDARD');
    }

    if (dati.ora_arrivo) {
        const iso = dataToInputDate(dati.ora_arrivo);
        if (iso) {
            setCampo(payload, row, ['Destinazione_Data', 'DATA_DESTINAZIONE', 'Data_Destinazione'], 'Destinazione_Data', iso);
        }
    }

    setCampo(payload, row, ['Destinazione_Comune', 'DESTINAZIONE_COMUNE'], 'Destinazione_Comune', dati.comune_destinazione ?? '');
    setCampo(payload, row, ['Destinazione_Indirizzo', 'DESTINAZIONE_INDIRIZZO'], 'Destinazione_Indirizzo', dati.luogo_destinazione ?? '');
    setCampo(
        payload,
        row,
        ['Destinazione_Note', 'DESTINAZIONE_NOTE', 'Note_Destinazione'],
        'Destinazione_Note',
        dati.note_arrivo ?? ''
    );
    setCampo(payload, row, ['Incassato', 'INCASSATO'], 'Incassato', dati.stato_incasso || 'DA INCASSARE');
    setCampo(payload, row, ['TipoPagamento', 'TIPOPAGAMENTO'], 'TipoPagamento', dati.tipo_pagamento ?? '');

    if (dati.operatore_id !== undefined) {
        const op = String(dati.operatore_id || '').trim();
        const opVal = !op ? null : (Number.isNaN(parseInt(op, 10)) ? op : parseInt(op, 10));
        setCampo(payload, row, ['IdOperatore', 'IDOPERATORE', 'Id_Operatore'], 'IdOperatore', opVal);
    }

    if (dati.mezzo !== undefined) {
        const m = String(dati.mezzo || '').trim();
        const mVal = !m ? null : (Number.isNaN(parseInt(m, 10)) ? m : parseInt(m, 10));
        setCampo(payload, row, ['Mezzo', 'MEZZO'], 'Mezzo', mVal);
    }

    const colTempo = s._colTempo || resolveColonna(row, ['Tempo', 'TEMPO', 'TEMPO_ORE'], null);
    const colKm = s._colKm || resolveColonna(row, ['Km', 'KM'], null);
    const colNote = s._colNote || resolveColonna(
        row,
        ['NoteFineServizio', 'NOTAFINESERVIZIO', 'NOTE_FINE_SERVIZIO', 'NotaFineServizio'],
        null
    );

    const tempoNorm = normalizzaTempo(dati.tempo);
    if (colTempo) payload[colTempo] = tempoNorm || null;

    if (colKm && dati.km !== undefined && dati.km !== '') {
        const kmNum = parseFloat(String(dati.km).replace(',', '.'));
        payload[colKm] = Number.isFinite(kmNum) ? kmNum : dati.km;
    }

    const euro = parseEuroToNumber(dati.pagamento);
    if (euro !== null) {
        setCampo(payload, row, ['Donazioni', 'DONAZIONI'], 'Donazioni', euro);
    }

    if (dati.data_bonifico) {
        const iso = dataToInputDate(dati.data_bonifico);
        if (iso) setCampo(payload, row, ['Bonifico_Data', 'DATABONIFICO'], 'Bonifico_Data', iso);
    }
    if (dati.data_ricevuta) {
        const iso = dataToInputDate(dati.data_ricevuta);
        if (iso) setCampo(payload, row, ['Ricevuta_Data', 'DATARICEVUTA'], 'Ricevuta_Data', iso);
    }

    setCampo(
        payload,
        row,
        ['Ricevuta_numero', 'Ricevuta_Numero', 'RICEVUTA_NUMERO', 'NumeroRicevuta', 'Numero_Ricevuta'],
        'Ricevuta_numero',
        dati.numero_ricevuta ?? ''
    );
    setCampo(payload, row, ['StatoServizio', 'STATOSERVIZIO'], 'StatoServizio', dati.stato_servizio ?? '');

    const noteVisibili = dati.note_fine_servizio_visibili ?? '';
    const noteMerged = typeof mergeNoteFineFn === 'function'
        ? mergeNoteFineFn(noteVisibili, s.note_fine_servizio || '')
        : noteVisibili;
    if (colNote) payload[colNote] = noteMerged;

    // Metadati utili per verifica post-salvataggio
    payload.__meta = {
        colNotePrelievo,
        notePrelievoInviate: dati.note_prelievo ?? ''
    };

    return payload;
}

/** Rimuove chiavi tecniche prima dell'invio a Supabase */
export function payloadSenzaMeta(payload) {
    const out = { ...payload };
    delete out.__meta;
    return out;
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
