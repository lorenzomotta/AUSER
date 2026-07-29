/**
 * Export Excel del Calendario web (vista corrente: mese / settimana / giorno).
 * Richiede SheetJS globale: window.XLSX (script CDN in CALENDARIO_WEB.html).
 */

const HEAD = [
    'ID SERVIZIO',
    'DATA PRELIEVO',
    'ORA',
    'TRASPORTATO',
    'IDSOCIO',
    'OPERATORE',
    'COMUNE PRELIEVO',
    'LUOGO PRELIEVO',
    'COMUNE DESTINAZIONE',
    'LUOGO DESTINAZIONE',
    'RICHIEDENTE',
    'TIPO SERVIZIO',
    'CARROZZINA',
    'MOTIVAZIONE',
    'MEZZO',
    'KM',
    'TEMPO',
    'STATO SERVIZIO',
    'STATO INCASSO',
    'PAGAMENTO',
    'TIPO PAGAMENTO',
    'NOTE PRELIEVO',
    'NOTE ARRIVO',
    'NOTE FINE SERVIZIO'
];

function pad2(n) {
    return String(n).padStart(2, '0');
}

function nowStamp() {
    const d = new Date();
    return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function fileDate() {
    const d = new Date();
    return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`;
}

function cell(value) {
    if (value === null || value === undefined) return '';
    return String(value).trim();
}

function parseDataSortKey(value) {
    const s = String(value || '').trim();
    const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (m) return `${m[3]}${m[2]}${m[1]}`;
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10).replace(/-/g, '');
    return s;
}

function parseOraSortKey(value) {
    const s = String(value || '').trim();
    const m = s.match(/^(\d{1,2}):(\d{2})/);
    if (!m) return 0;
    return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

function buildRow(servizio, getMezzo) {
    const mezzo = typeof getMezzo === 'function'
        ? getMezzo(servizio)
        : (servizio.mezzo_usato || servizio.mezzo || '');
    return [
        cell(servizio.id),
        cell(servizio.data_prelievo),
        cell(servizio.ora_inizio),
        cell(servizio.socio_trasportato),
        cell(servizio.idsocio),
        cell(servizio.operatore),
        cell(servizio.comune_prelievo),
        cell(servizio.luogo_prelievo),
        cell(servizio.comune_destinazione),
        cell(servizio.luogo_destinazione),
        cell(servizio.richiedente),
        cell(servizio.tipo_servizio),
        cell(servizio.carrozzina),
        cell(servizio.motivazione),
        cell(mezzo),
        cell(servizio.km),
        cell(servizio.tempo),
        cell(servizio.stato_servizio),
        cell(servizio.stato_incasso),
        cell(servizio.pagamento),
        cell(servizio.tipo_pagamento),
        cell(servizio.note_prelievo),
        cell(servizio.note_arrivo),
        cell(servizio.note_fine_servizio)
    ];
}

function etichettaVista(vista) {
    const v = String(vista || '');
    if (v.includes('Month') || v === 'dayGridMonth') return 'MESE';
    if (v.includes('Week') || v === 'dayGridWeek' || v === 'listWeek') return 'SETTIMANA';
    if (v.includes('Day') || v === 'dayGridDay') return 'GIORNO';
    return 'VISTA';
}

/**
 * @param {object[]} servizi
 * @param {{
 *   vista?: string,
 *   periodoLabel?: string,
 *   getMezzo?: (s: object) => string
 * }} options
 */
export function generaExcelCalendarioWeb(servizi, options = {}) {
    const XLSX = typeof window !== 'undefined' ? window.XLSX : null;
    if (!XLSX) {
        throw new Error('Libreria Excel non disponibile. Ricarica la pagina e riprova.');
    }

    const lista = Array.isArray(servizi) ? [...servizi] : [];
    if (!lista.length) {
        throw new Error('Nessun servizio da esportare nella vista corrente.');
    }

    lista.sort((a, b) => {
        const da = parseDataSortKey(a.data_prelievo);
        const db = parseDataSortKey(b.data_prelievo);
        if (da !== db) return da.localeCompare(db);
        return parseOraSortKey(a.ora_inizio) - parseOraSortKey(b.ora_inizio);
    });

    const vistaLabel = etichettaVista(options.vista);
    const periodo = String(options.periodoLabel || '').trim() || 'periodo corrente';
    const getMezzo = options.getMezzo;
    const rows = lista.map((s) => buildRow(s, getMezzo));

    const sheetData = [
        ['CALENDARIO SERVIZI — AUSER Asti'],
        [`Vista ${vistaLabel} · ${periodo} · ${lista.length} servizi · Generato il ${nowStamp()}`],
        [],
        HEAD,
        ...rows
    ];

    const ws = XLSX.utils.aoa_to_sheet(sheetData);
    ws['!cols'] = HEAD.map((title, colIndex) => {
        let maxLen = String(title).length;
        rows.forEach((row) => {
            const len = String(row[colIndex] ?? '').length;
            if (len > maxLen) maxLen = len;
        });
        return { wch: Math.min(Math.max(maxLen + 2, 10), 42) };
    });

    if (ws['!ref']) {
        ws['!autofilter'] = {
            ref: XLSX.utils.encode_range({
                s: { r: 3, c: 0 },
                e: { r: 3 + rows.length, c: HEAD.length - 1 }
            })
        };
    }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Servizi');
    const safeVista = vistaLabel.toLowerCase();
    XLSX.writeFile(wb, `calendario-${safeVista}-${fileDate()}.xlsx`);
}
