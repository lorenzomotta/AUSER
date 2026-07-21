// Export PDF / Excel — Riepilogo Pagamenti (elenco filtrato a video)
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';

function escapeText(value) {
    if (value === undefined || value === null) return '';
    return String(value);
}

function dataIncasso(servizio) {
    return (servizio.data_bonifico || servizio.data_ricevuta || '').trim();
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

function normalizza(testo) {
    return String(testo || '').trim().toUpperCase();
}

function isAnnullato(servizio) {
    return normalizza(servizio.stato_incasso) === 'ANNULLATO'
        || normalizza(servizio.stato_servizio).includes('ANNULL');
}

function isGratis(servizio) {
    const stato = normalizza(servizio.stato_incasso);
    const tipo = normalizza(servizio.tipo_pagamento);
    return stato === 'GRATIS' || tipo === 'GRATIS';
}

function isIncassato(servizio) {
    return normalizza(servizio.stato_incasso) === 'INCASSATO';
}

function isDaIncassare(servizio) {
    const s = normalizza(servizio.stato_incasso);
    return s === 'DA INCASSARE' || s === '';
}

function calcolaTotali(lista) {
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
        } else if (isIncassato(s)) {
            nIncassati += 1;
            euroIncassati += importo;
        } else if (isDaIncassare(s)) {
            nDaIncassare += 1;
            euroDaIncassare += importo;
        }
    });

    return {
        euroEseguiti,
        euroIncassati,
        euroDaIncassare,
        nEseguiti,
        nIncassati,
        nGratis,
        nDaIncassare
    };
}

const HEAD = [
    'Stato',
    'Richiedente',
    'Data',
    'Nominativo',
    'Comune prelievo',
    'Luogo prelievo',
    'Comune destinazione',
    'Luogo destinazione',
    'Donazione',
    'Tipo pagam.',
    'Data incasso'
];

function buildRow(servizio) {
    return [
        escapeText(servizio.stato_incasso || 'DA INCASSARE'),
        escapeText(servizio.richiedente),
        escapeText(servizio.data_prelievo),
        escapeText(servizio.socio_trasportato),
        escapeText(servizio.comune_prelievo),
        escapeText(servizio.luogo_prelievo),
        escapeText(servizio.comune_destinazione),
        escapeText(servizio.luogo_destinazione),
        escapeText(servizio.pagamento),
        escapeText(servizio.tipo_pagamento),
        escapeText(dataIncasso(servizio))
    ];
}

function validateList(servizi) {
    const lista = Array.isArray(servizi) ? servizi : [];
    if (!lista.length) {
        throw new Error('Nessun servizio da esportare con i filtri attuali.');
    }
    return lista;
}

function nowStamp() {
    return new Date().toLocaleString('it-IT', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function fileDate() {
    return new Date().toISOString().slice(0, 10);
}

export function generaPdfRiepilogoPagamenti(servizi, options = {}) {
    const lista = validateList(servizi);
    const filtriDescrizione = options.filtriDescrizione || 'Nessun filtro';
    const totali = calcolaTotali(lista);

    const doc = new jsPDF({
        orientation: 'landscape',
        unit: 'mm',
        format: 'a4'
    });

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.setTextColor(55, 71, 79);
    doc.text('RIEPILOGO PAGAMENTI — AUSER Asti', 14, 12);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(60, 60, 60);
    doc.text(
        `Generato il ${nowStamp()} · ${lista.length} servizi · ${filtriDescrizione}`,
        14,
        18
    );

    autoTable(doc, {
        head: [HEAD],
        body: lista.map(buildRow),
        startY: 22,
        margin: { left: 8, right: 8, bottom: 28 },
        styles: {
            font: 'helvetica',
            fontSize: 6.5,
            cellPadding: 1.1,
            overflow: 'linebreak',
            valign: 'middle'
        },
        headStyles: {
            fillColor: [55, 71, 79],
            textColor: 255,
            fontStyle: 'bold',
            fontSize: 6.5
        },
        alternateRowStyles: {
            fillColor: [245, 247, 248]
        },
        didDrawPage: () => {
            const pageCount = doc.getNumberOfPages();
            const pageCurrent = doc.getCurrentPageInfo().pageNumber;
            doc.setFontSize(8);
            doc.setTextColor(120, 120, 120);
            doc.text(
                `Pagina ${pageCurrent} di ${pageCount}`,
                doc.internal.pageSize.getWidth() - 8,
                doc.internal.pageSize.getHeight() - 6,
                { align: 'right' }
            );
        }
    });

    const y = Math.min(
        (doc.lastAutoTable?.finalY || 22) + 8,
        doc.internal.pageSize.getHeight() - 22
    );
    doc.setFontSize(8);
    doc.setTextColor(40, 40, 40);
    doc.text(
        `Eseguiti: ${totali.nEseguiti} (${formatEuro(totali.euroEseguiti)})  ·  ` +
        `Incassati: ${totali.nIncassati} (${formatEuro(totali.euroIncassati)})  ·  ` +
        `Da incassare: ${totali.nDaIncassare} (${formatEuro(totali.euroDaIncassare)})  ·  ` +
        `Gratis: ${totali.nGratis}`,
        8,
        y
    );

    doc.save(`riepilogo-pagamenti-${fileDate()}.pdf`);
}

export function generaExcelRiepilogoPagamenti(servizi, options = {}) {
    const lista = validateList(servizi);
    const filtriDescrizione = options.filtriDescrizione || 'Nessun filtro';
    const totali = calcolaTotali(lista);

    const rows = lista.map(buildRow);
    const sheetData = [
        ['RIEPILOGO PAGAMENTI — AUSER Asti'],
        [`Generato il ${nowStamp()} · ${lista.length} servizi · ${filtriDescrizione}`],
        [],
        HEAD,
        ...rows,
        [],
        ['TOTALI'],
        ['Servizi eseguiti', totali.nEseguiti, formatEuro(totali.euroEseguiti)],
        ['Servizi incassati', totali.nIncassati, formatEuro(totali.euroIncassati)],
        ['Servizi da incassare', totali.nDaIncassare, formatEuro(totali.euroDaIncassare)],
        ['Servizi gratis', totali.nGratis]
    ];

    const ws = XLSX.utils.aoa_to_sheet(sheetData);
    ws['!cols'] = HEAD.map((title, colIndex) => {
        let maxLen = String(title).length;
        rows.forEach((row) => {
            const len = String(row[colIndex] ?? '').length;
            if (len > maxLen) maxLen = len;
        });
        return { wch: Math.min(Math.max(maxLen + 2, 10), 40) };
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
    XLSX.utils.book_append_sheet(wb, ws, 'Pagamenti');
    XLSX.writeFile(wb, `riepilogo-pagamenti-${fileDate()}.xlsx`);
}
