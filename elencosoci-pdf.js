// Esportazione PDF elenco soci (A4 orizzontale)
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
    buildExportHead,
    buildExportRow,
    validateExportList
} from './elencosoci-export-utils.js';

export function generaPdfElencoSoci(soci, options = {}) {
    const includeAnagrafica = options.includeAnagrafica === true;
    const includeTesseramento = options.includeTesseramento === true;
    const filtriDescrizione = options.filtriDescrizione || 'Elenco completo';
    const lista = validateExportList(soci);

    const doc = new jsPDF({
        orientation: 'landscape',
        unit: 'mm',
        format: 'a4'
    });

    const now = new Date();
    const dataStampa = now.toLocaleString('it-IT', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.setTextColor(45, 122, 50);
    doc.text('ELENCO SOCI — AUSER Asti', 14, 12);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(60, 60, 60);
    doc.text(`Generato il ${dataStampa} · ${lista.length} soci · ${filtriDescrizione}`, 14, 18);

    const head = [buildExportHead(includeAnagrafica, includeTesseramento, options.anagraficaFlags)];
    const body = lista.map((t, i) =>
        buildExportRow(i + 1, t, includeAnagrafica, includeTesseramento, {
            truncate: true,
            anagraficaFlags: options.anagraficaFlags
        })
    );

    const columnStyles = {
        0: { cellWidth: 8, halign: 'center' },
        1: { cellWidth: 12, halign: 'center' },
        2: { cellWidth: includeAnagrafica ? 38 : 55 }
    };

    autoTable(doc, {
        head,
        body,
        startY: 22,
        margin: { left: 10, right: 10, bottom: 12 },
        styles: {
            font: 'helvetica',
            fontSize: 7,
            cellPadding: 1.2,
            overflow: 'linebreak',
            valign: 'middle'
        },
        headStyles: {
            fillColor: [45, 122, 50],
            textColor: 255,
            fontStyle: 'bold',
            fontSize: 7
        },
        alternateRowStyles: {
            fillColor: [245, 248, 245]
        },
        columnStyles,
        didDrawPage: () => {
            const pageCount = doc.getNumberOfPages();
            const pageCurrent = doc.getCurrentPageInfo().pageNumber;
            doc.setFontSize(8);
            doc.setTextColor(120, 120, 120);
            doc.text(
                `Pagina ${pageCurrent} di ${pageCount}`,
                doc.internal.pageSize.getWidth() - 10,
                doc.internal.pageSize.getHeight() - 6,
                { align: 'right' }
            );
        }
    });

    const fileName = `elenco-soci-${now.toISOString().slice(0, 10)}.pdf`;
    doc.save(fileName);
}
