// Utility condivise per export PDF / Excel elenco soci

export function flagSiNo(value) {
    if (typeof value === 'boolean') return value ? 'Sì' : 'No';
    const s = String(value ?? '').trim().toUpperCase();
    if (!s || s === 'FALSE' || s === 'NO' || s === '0') return 'No';
    if (s === 'TRUE' || s === 'SI' || s === 'SÌ' || s === '1' || s === 'YES') return 'Sì';
    return s;
}

export function isArchiviatoExport(tesserato) {
    const raw = tesserato?.archivia ?? tesserato?.archiviazione ?? '';
    return flagSiNo(raw) === 'Sì';
}

export function truncateText(text, max = 40) {
    const s = String(text ?? '').trim();
    if (s.length <= max) return s;
    return `${s.slice(0, max - 1)}…`;
}

export function formatIndirizzoResidenza(t) {
    return [t.residenza_indirizzo, t.residenza_civico].filter(Boolean).join(' ').trim();
}

export function normalizeAnagraficaFlags(flags = {}) {
    return {
        operatore: flags.operatore !== false,
        disponibilita: flags.disponibilita !== false,
        nota: flags.nota !== false,
        attivo: flags.attivo !== false,
        archiviato: flags.archiviato !== false
    };
}

export function buildExportHead(includeAnagrafica, includeTesseramento, anagraficaFlags = {}) {
    const flags = normalizeAnagraficaFlags(anagraficaFlags);
    const head = ['#', 'ID', 'Nominativo', 'Tipologia'];

    if (includeAnagrafica) {
        head.push(
            'Cod. fiscale',
            'Sesso',
            'Comune nascita',
            'Data nasc.',
            'Indirizzo',
            'CAP',
            'Comune',
            'Prov.',
            'Telefono'
        );
        if (flags.operatore) head.push('Operatore');
        if (flags.attivo) head.push('Attivo');
        if (flags.archiviato) head.push('Archiviato');
        if (flags.disponibilita) head.push('Disponibilità');
        if (flags.nota) head.push('Nota');
    }

    if (includeTesseramento) {
        head.push('N. tessera', 'Scadenza');
    }

    return head;
}

export function buildExportRow(index, tesserato, includeAnagrafica, includeTesseramento, options = {}) {
    const truncate = options.truncate !== false;
    const flags = normalizeAnagraficaFlags(options.anagraficaFlags);
    const row = [
        index,
        String(tesserato.idsocio ?? ''),
        String(tesserato.nominativo ?? ''),
        String(tesserato.tipologiasocio ?? '')
    ];

    if (includeAnagrafica) {
        const indirizzo = formatIndirizzoResidenza(tesserato);
        const nota = String(tesserato.notaaggiuntiva ?? '');
        row.push(
            String(tesserato.codicefiscale ?? ''),
            String(tesserato.sesso ?? ''),
            String(tesserato.nascita_comune ?? ''),
            String(tesserato.nascita_data ?? ''),
            truncate ? truncateText(indirizzo, 40) : indirizzo,
            String(tesserato.residenza_cap ?? ''),
            String(tesserato.residenza_comune ?? ''),
            String(tesserato.residenza_provincia ?? ''),
            String(tesserato.telefono ?? '')
        );
        if (flags.operatore) row.push(flagSiNo(tesserato.operatore));
        if (flags.attivo) row.push(flagSiNo(tesserato.attivo));
        if (flags.archiviato) row.push(isArchiviatoExport(tesserato) ? 'Sì' : 'No');
        if (flags.disponibilita) row.push(String(tesserato.disponibilita ?? ''));
        if (flags.nota) row.push(truncate ? truncateText(nota, 35) : nota);
    }

    if (includeTesseramento) {
        row.push(
            String(tesserato.numerotessera ?? ''),
            String(tesserato.scadenzatessera ?? '')
        );
    }

    return row;
}

export function validateExportList(soci) {
    const lista = Array.isArray(soci) ? soci : [];
    if (!lista.length) {
        throw new Error('Nessun socio da esportare con i filtri attuali.');
    }
    return lista;
}
