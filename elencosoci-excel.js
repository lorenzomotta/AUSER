// Esportazione Excel elenco soci
import * as XLSX from 'xlsx';
import {
    buildExportHead,
    buildExportRow,
    validateExportList
} from './elencosoci-export-utils.js';

export function generaExcelElencoSoci(soci, options = {}) {
    const includeAnagrafica = options.includeAnagrafica === true;
    const includeTesseramento = options.includeTesseramento === true;
    const filtriDescrizione = options.filtriDescrizione || 'Elenco completo';
    const lista = validateExportList(soci);

    const now = new Date();
    const dataStampa = now.toLocaleString('it-IT', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });

    const head = buildExportHead(includeAnagrafica, includeTesseramento, options.anagraficaFlags);
    const rows = lista.map((t, i) =>
        buildExportRow(i + 1, t, includeAnagrafica, includeTesseramento, {
            truncate: false,
            anagraficaFlags: options.anagraficaFlags
        })
    );

    const sheetData = [
        ['ELENCO SOCI — AUSER Asti'],
        [`Generato il ${dataStampa} · ${lista.length} soci · ${filtriDescrizione}`],
        [],
        head,
        ...rows
    ];

    const ws = XLSX.utils.aoa_to_sheet(sheetData);

    const colWidths = head.map((title, colIndex) => {
        let maxLen = String(title).length;
        rows.forEach((row) => {
            const len = String(row[colIndex] ?? '').length;
            if (len > maxLen) maxLen = len;
        });
        return { wch: Math.min(Math.max(maxLen + 2, 8), 48) };
    });
    ws['!cols'] = colWidths;

    if (ws['!ref']) {
        ws['!autofilter'] = {
            ref: XLSX.utils.encode_range({
                s: { r: 3, c: 0 },
                e: { r: 3 + rows.length, c: head.length - 1 }
            })
        };
    }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Elenco soci');

    const fileName = `elenco-soci-${now.toISOString().slice(0, 10)}.xlsx`;
    XLSX.writeFile(wb, fileName);
}
