// Stampa PDF dell'elenco servizi: scelta campi nel modale, poi tabella A4 orizzontale.
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { testoNoteFineVisibile } from './tratta-riepilogo.js';

const STORAGE_KEY = 'elenco-servizi-pdf-campi';
const STORAGE_ORDINE = 'elenco-servizi-pdf-ordine';

const TIPO_CAMPO = {
    id: 'numero',
    idsocio: 'numero',
    data_prelievo: 'data',
    data_bonifico: 'data',
    ora_inizio: 'ora',
    ora_arrivo: 'ora',
    km: 'numero',
    tempo: 'numero',
    pagamento: 'numero'
};

/** Campi stampabili. `label` è nel popup, `intestazione` è la colonna del PDF. */
export const CAMPI_PDF_SERVIZI = [
    { key: 'id', label: 'ID servizio', intestazione: 'ID', gruppo: 'Dati principali', predefinito: true },
    { key: 'data_prelievo', label: 'Data prelievo', intestazione: 'Data', gruppo: 'Dati principali', predefinito: true },
    { key: 'ora_inizio', label: 'O.S.C. (ora partenza)', intestazione: 'Ora', gruppo: 'Dati principali', predefinito: true },
    { key: 'socio_trasportato', label: 'Trasportato', intestazione: 'Trasportato', gruppo: 'Dati principali', predefinito: true },
    { key: 'operatore', label: 'Operatore', intestazione: 'Operatore', gruppo: 'Dati principali', predefinito: true },
    { key: 'stato_servizio', label: 'Stato del servizio', intestazione: 'Stato', gruppo: 'Dati principali', predefinito: true },
    { key: 'idsocio', label: 'ID socio', intestazione: 'Socio', gruppo: 'Percorso', predefinito: false },
    { key: 'comune_prelievo', label: 'Comune di prelievo', intestazione: 'Comune prel.', gruppo: 'Percorso', predefinito: true },
    { key: 'luogo_prelievo', label: 'Luogo di prelievo', intestazione: 'Luogo prel.', gruppo: 'Percorso', predefinito: false },
    { key: 'ora_arrivo', label: 'O.A.D. (ora arrivo)', intestazione: 'Arrivo', gruppo: 'Percorso', predefinito: false },
    { key: 'comune_destinazione', label: 'Comune di destinazione', intestazione: 'Comune dest.', gruppo: 'Percorso', predefinito: false },
    { key: 'luogo_destinazione', label: 'Luogo di destinazione', intestazione: 'Destinazione', gruppo: 'Percorso', predefinito: true },
    { key: 'motivazione', label: 'Motivazione del servizio', intestazione: 'Motivazione', gruppo: 'Percorso', predefinito: false },
    { key: 'richiedente', label: 'Richiedente', intestazione: 'Richiedente', gruppo: 'Servizio e mezzo', predefinito: false },
    { key: 'tipo_servizio', label: 'Tipo servizio', intestazione: 'Tipo', gruppo: 'Servizio e mezzo', predefinito: false },
    { key: 'carrozzina', label: 'Carrozzina', intestazione: 'Carrozzina', gruppo: 'Servizio e mezzo', predefinito: false },
    { key: 'mezzo', label: 'Mezzo usato', intestazione: 'Mezzo', gruppo: 'Servizio e mezzo', predefinito: false, speciale: 'mezzo' },
    { key: 'tempo', label: 'Tempo', intestazione: 'Tempo', gruppo: 'Servizio e mezzo', predefinito: false },
    { key: 'km', label: 'Km', intestazione: 'Km', gruppo: 'Servizio e mezzo', predefinito: false },
    { key: 'tipo_pagamento', label: 'Tipo di pagamento', intestazione: 'Tipo pag.', gruppo: 'Pagamento', predefinito: false },
    { key: 'stato_incasso', label: 'Stato incasso', intestazione: 'Incasso', gruppo: 'Pagamento', predefinito: true },
    { key: 'pagamento', label: 'Pagamento', intestazione: 'Importo', gruppo: 'Pagamento', predefinito: true },
    { key: 'data_bonifico', label: 'Data bonifico', intestazione: 'Bonifico', gruppo: 'Pagamento', predefinito: false },
    { key: 'note_prelievo', label: 'Note prelievo', intestazione: 'Note prel.', gruppo: 'Note', predefinito: false },
    { key: 'note_arrivo', label: 'Note arrivo', intestazione: 'Note arrivo', gruppo: 'Note', predefinito: false },
    { key: 'note_fine_servizio', label: 'Note fine servizio', intestazione: 'Note fine', gruppo: 'Note', predefinito: false, speciale: 'note_fine' }
];

CAMPI_PDF_SERVIZI.forEach((campo) => {
    campo.tipo = TIPO_CAMPO[campo.key] || 'testo';
});

function testoCampo(valore) {
    if (valore === undefined || valore === null) return '';
    return String(valore)
        .replace(/\u20ac/g, 'EUR')
        .trim();
}

function valoreCampo(servizio, campo, formatMezzo) {
    if (campo.speciale === 'mezzo') {
        return testoCampo(typeof formatMezzo === 'function' ? formatMezzo(servizio) : servizio.mezzo_usato);
    }
    if (campo.speciale === 'note_fine') {
        return testoCampo(testoNoteFineVisibile(servizio.note_fine_servizio));
    }
    return testoCampo(servizio[campo.key]);
}

function dataInNumero(testo) {
    const s = String(testo || '').trim();
    let match = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (match) {
        return (Number(match[3]) * 10000) + (Number(match[2]) * 100) + Number(match[1]);
    }
    match = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
        return (Number(match[1]) * 10000) + (Number(match[2]) * 100) + Number(match[3]);
    }
    return null;
}

function oraInMinuti(testo) {
    const match = String(testo || '').trim().match(/^(\d{1,2})[:.](\d{2})/);
    if (!match) return null;
    return (Number(match[1]) * 60) + Number(match[2]);
}

function numeroItaliano(testo) {
    let s = String(testo || '')
        .replace(/eur/ig, '')
        .replace(/\u20ac/g, '')
        .replace(/\s/g, '');
    if (!s) return null;
    if (s.includes(',') && s.includes('.')) {
        s = s.replace(/\./g, '').replace(',', '.');
    } else if (s.includes(',')) {
        s = s.replace(',', '.');
    }
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : null;
}

function confrontaValori(a, b, campo, formatMezzo) {
    const va = valoreCampo(a, campo, formatMezzo);
    const vb = valoreCampo(b, campo, formatMezzo);
    if (!va && !vb) return 0;
    if (!va) return 1;
    if (!vb) return -1;

    if (campo.tipo === 'data') {
        const na = dataInNumero(va);
        const nb = dataInNumero(vb);
        if (na != null && nb != null && na !== nb) return na - nb;
    } else if (campo.tipo === 'ora') {
        const na = oraInMinuti(va);
        const nb = oraInMinuti(vb);
        if (na != null && nb != null && na !== nb) return na - nb;
    } else if (campo.tipo === 'numero') {
        const na = numeroItaliano(va);
        const nb = numeroItaliano(vb);
        if (na != null && nb != null && na !== nb) return na - nb;
    }

    return va.localeCompare(vb, 'it', { sensitivity: 'base', numeric: true });
}

export function ordinaServiziPerCampi(servizi, livelli, formatMezzo) {
    const lista = Array.isArray(servizi) ? servizi.slice() : [];
    const regole = Array.isArray(livelli) ? livelli.filter((livello) => livello && livello.campo) : [];
    if (!regole.length) return lista;

    lista.sort((a, b) => {
        for (const livello of regole) {
            const va = valoreCampo(a, livello.campo, formatMezzo);
            const vb = valoreCampo(b, livello.campo, formatMezzo);
            if (!va && !vb) continue;
            if (!va) return 1;
            if (!vb) return -1;
            const cmp = confrontaValori(a, b, livello.campo, formatMezzo);
            if (cmp !== 0) return livello.dir === 'desc' ? -cmp : cmp;
        }
        return 0;
    });
    return lista;
}

function etichettaVersoBreve(tipo, dir) {
    const inverso = dir === 'desc';
    if (tipo === 'data') return inverso ? 'più recenti prima' : 'più vecchie prima';
    if (tipo === 'ora') return inverso ? 'ore più tardi prima' : 'ore più presto prima';
    if (tipo === 'numero') return inverso ? 'più grandi prima' : 'più piccoli prima';
    return inverso ? 'dalla Z alla A' : 'dalla A alla Z';
}

function testoOrdinamento(livelli) {
    if (!livelli.length) return '';
    return livelli.map((livello, index) => {
        const verso = etichettaVersoBreve(livello.campo.tipo, livello.dir);
        const inizio = index === 0 ? 'Ordinato per' : 'poi';
        return `${inizio} ${livello.campo.label} (${verso})`;
    }).join(', ');
}

function opzioniVerso(tipo) {
    if (tipo === 'data') {
        return [
            ['asc', 'prima le date più vecchie'],
            ['desc', 'prima le date più recenti']
        ];
    }
    if (tipo === 'ora') {
        return [
            ['asc', 'prima le ore più presto'],
            ['desc', 'prima le ore più tardi']
        ];
    }
    if (tipo === 'numero') {
        return [
            ['asc', 'prima i numeri più piccoli'],
            ['desc', 'prima i numeri più grandi']
        ];
    }
    return [
        ['asc', 'dalla A alla Z'],
        ['desc', 'dalla Z alla A']
    ];
}

function dimensioneTesto(numeroColonne) {
    if (numeroColonne <= 6) return 9;
    if (numeroColonne <= 10) return 8;
    if (numeroColonne <= 14) return 7;
    return 6;
}

export function generaPdfElencoServizi(servizi, campi, options = {}) {
    const lista = Array.isArray(servizi) ? servizi : [];
    const scelti = Array.isArray(campi) ? campi : [];
    if (!scelti.length) {
        throw new Error('Scegli almeno un campo da stampare.');
    }
    if (!lista.length) {
        throw new Error('Non ci sono servizi da stampare con i filtri attuali.');
    }

    const titolo = options.titolo || 'ELENCO SERVIZI';
    const formatMezzo = options.formatMezzo;
    const livelli = Array.isArray(options.ordinamento) ? options.ordinamento : [];
    const listaOrdinata = ordinaServiziPerCampi(lista, livelli, formatMezzo);
    const rigaOrdine = testoOrdinamento(livelli);
    const now = new Date();
    const dataStampa = now.toLocaleString('it-IT', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });

    const doc = new jsPDF({
        orientation: 'landscape',
        unit: 'mm',
        format: 'a4'
    });

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(139, 69, 19);
    doc.text(titolo, 10, 12);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(60, 60, 60);
    doc.text(`Stampato il ${dataStampa}  ·  ${listaOrdinata.length} servizi`, 10, 18);
    if (rigaOrdine) {
        doc.text(rigaOrdine, 10, 23);
    }

    const fontSize = dimensioneTesto(scelti.length);
    autoTable(doc, {
        head: [scelti.map((campo) => campo.intestazione)],
        body: listaOrdinata.map((servizio) => scelti.map((campo) => valoreCampo(servizio, campo, formatMezzo))),
        startY: rigaOrdine ? 27 : 22,
        margin: { top: 10, left: 8, right: 8, bottom: 12 },
        styles: {
            font: 'helvetica',
            fontSize,
            cellPadding: 1.1,
            overflow: 'linebreak',
            valign: 'middle'
        },
        headStyles: {
            fillColor: [45, 122, 50],
            textColor: 255,
            fontStyle: 'bold',
            fontSize
        },
        alternateRowStyles: {
            fillColor: [245, 248, 245]
        }
    });

    const pageCount = doc.getNumberOfPages();
    for (let i = 1; i <= pageCount; i += 1) {
        doc.setPage(i);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(120, 120, 120);
        doc.text(
            `Pagina ${i} di ${pageCount}`,
            doc.internal.pageSize.getWidth() - 8,
            doc.internal.pageSize.getHeight() - 6,
            { align: 'right' }
        );
    }

    const fileName = `elenco-servizi-${now.toISOString().slice(0, 10)}.pdf`;
    doc.save(fileName);
}

function leggiSelezioneSalvata() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        const keys = JSON.parse(raw);
        if (!Array.isArray(keys)) return null;
        const validi = new Set(CAMPI_PDF_SERVIZI.map((campo) => campo.key));
        return keys.filter((key) => validi.has(key));
    } catch {
        return null;
    }
}

function salvaSelezione(keys) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(keys));
    } catch {
        /* se il browser blocca il salvataggio, la stampa funziona lo stesso */
    }
}

function leggiOrdineSalvato() {
    try {
        const raw = localStorage.getItem(STORAGE_ORDINE);
        if (!raw) return null;
        const data = JSON.parse(raw);
        if (!data || typeof data !== 'object') return null;
        return {
            attivo: data.attivo === true,
            primo: typeof data.primo === 'string' ? data.primo : '',
            primoDir: data.primoDir === 'desc' ? 'desc' : 'asc',
            secondo: typeof data.secondo === 'string' ? data.secondo : '',
            secondoDir: data.secondoDir === 'desc' ? 'desc' : 'asc'
        };
    } catch {
        return null;
    }
}

function salvaOrdine(ordine) {
    try {
        localStorage.setItem(STORAGE_ORDINE, JSON.stringify(ordine));
    } catch {
        /* la stampa funziona anche senza ricordare l'ordine */
    }
}

export function initStampaPdfElencoServizi({ getServiziFiltrati, getServiziPagina, getTitolo, formatMezzo }) {
    const modal = document.getElementById('modal-stampa-pdf-servizi');
    const btnApri = document.getElementById('btn-stampa-pdf-elenco');
    const btnChiudi = document.getElementById('btn-stampa-pdf-servizi-chiudi');
    const btnAnnulla = document.getElementById('btn-stampa-pdf-servizi-annulla');
    const btnGenera = document.getElementById('btn-stampa-pdf-servizi-genera');
    const btnTutti = document.getElementById('btn-pdf-campi-tutti');
    const btnPrincipali = document.getElementById('btn-pdf-campi-principali');
    const btnNessuno = document.getElementById('btn-pdf-campi-nessuno');
    const campiBox = document.getElementById('es-pdf-campi');
    const countEl = document.getElementById('pdf-servizi-count');
    const erroreEl = document.getElementById('pdf-servizi-errore');
    const chkOrdina = document.getElementById('pdf-servizi-ordina');
    const dettagliOrdine = document.getElementById('pdf-servizi-ordine-dettagli');
    const campoOrdine1 = document.getElementById('pdf-ordina-campo-1');
    const campoOrdine2 = document.getElementById('pdf-ordina-campo-2');
    const versoOrdine1 = document.getElementById('pdf-ordina-verso-1');
    const versoOrdine2 = document.getElementById('pdf-ordina-verso-2');

    if (!modal || !btnGenera || !campiBox) return;

    const gruppi = [];
    const perGruppo = new Map();
    CAMPI_PDF_SERVIZI.forEach((campo) => {
        if (!perGruppo.has(campo.gruppo)) {
            const gruppo = { nome: campo.gruppo, campi: [] };
            perGruppo.set(campo.gruppo, gruppo);
            gruppi.push(gruppo);
        }
        perGruppo.get(campo.gruppo).campi.push(campo);
    });

    campiBox.innerHTML = gruppi.map((gruppo) => `
        <fieldset class="es-pdf-gruppo">
            <legend>${gruppo.nome}</legend>
            <div class="es-pdf-gruppo-campi">
                ${gruppo.campi.map((campo) => `
                    <label class="es-pdf-campo">
                        <input type="checkbox" data-campo="${campo.key}">
                        <span>${campo.label}</span>
                    </label>
                `).join('')}
            </div>
        </fieldset>
    `).join('');

    const inputs = () => Array.from(campiBox.querySelectorAll('input[data-campo]'));

    function mostraErrore(msg) {
        if (!erroreEl) return;
        if (msg) {
            erroreEl.textContent = msg;
            erroreEl.hidden = false;
        } else {
            erroreEl.textContent = '';
            erroreEl.hidden = true;
        }
    }

    function impostaSelezione(keys) {
        const scelti = new Set(keys);
        inputs().forEach((input) => {
            input.checked = scelti.has(input.dataset.campo);
        });
    }

    function chiaviSelezionate() {
        return inputs()
            .filter((input) => input.checked)
            .map((input) => input.dataset.campo);
    }

    function campiOggettiSelezionati() {
        const keys = new Set(chiaviSelezionate());
        return CAMPI_PDF_SERVIZI.filter((campo) => keys.has(campo.key));
    }

    function riempiSelectOrdine(select, includiNessuno, valorePreferito) {
        if (!select) return;
        const campi = campiOggettiSelezionati();
        const precedente = valorePreferito != null ? valorePreferito : select.value;
        const pezzi = [];
        if (includiNessuno) {
            pezzi.push('<option value="">Nessun altro campo</option>');
        }
        campi.forEach((campo) => {
            pezzi.push(`<option value="${campo.key}">${campo.label}</option>`);
        });
        select.innerHTML = pezzi.join('');
        const valori = new Set(Array.from(select.options).map((option) => option.value));
        if (precedente && valori.has(precedente)) {
            select.value = precedente;
        } else if (!includiNessuno) {
            const naturale = campi.find((campo) => campo.key === 'data_prelievo') || campi[0];
            select.value = naturale ? naturale.key : '';
        } else {
            select.value = '';
        }
    }

    function aggiornaVerso(selectCampo, selectVerso, direzionePreferita) {
        if (!selectCampo || !selectVerso) return;
        const campo = CAMPI_PDF_SERVIZI.find((item) => item.key === selectCampo.value);
        const direzione = direzionePreferita || (selectVerso.value === 'desc' ? 'desc' : 'asc');
        const opzioni = opzioniVerso(campo?.tipo || 'testo');
        selectVerso.innerHTML = opzioni
            .map(([valore, etichetta]) => `<option value="${valore}">${etichetta}</option>`)
            .join('');
        selectVerso.value = direzione === 'desc' ? 'desc' : 'asc';
        selectVerso.disabled = !selectCampo.value;
    }

    function aggiornaPannelloOrdine(preferenze) {
        const attivo = chkOrdina?.checked === true;
        if (dettagliOrdine) dettagliOrdine.hidden = !attivo;
        if (!attivo) return;

        riempiSelectOrdine(campoOrdine1, false, preferenze?.primo);
        riempiSelectOrdine(campoOrdine2, true, preferenze?.secondo);
        if (campoOrdine2 && campoOrdine1 && campoOrdine2.value && campoOrdine2.value === campoOrdine1.value) {
            campoOrdine2.value = '';
        }
        aggiornaVerso(campoOrdine1, versoOrdine1, preferenze?.primoDir);
        aggiornaVerso(campoOrdine2, versoOrdine2, preferenze?.secondoDir);
    }

    function leggiOrdinamentoScelto() {
        if (chkOrdina?.checked !== true) return [];
        const livelli = [];
        const primo = CAMPI_PDF_SERVIZI.find((campo) => campo.key === campoOrdine1?.value);
        if (primo) {
            livelli.push({
                campo: primo,
                dir: versoOrdine1?.value === 'desc' ? 'desc' : 'asc'
            });
        }
        const secondo = CAMPI_PDF_SERVIZI.find((campo) => campo.key === campoOrdine2?.value);
        if (secondo && secondo.key !== primo?.key) {
            livelli.push({
                campo: secondo,
                dir: versoOrdine2?.value === 'desc' ? 'desc' : 'asc'
            });
        }
        return livelli;
    }

    function elencoDaStampare() {
        const soloPagina = document.getElementById('pdf-servizi-solo-pagina')?.checked === true;
        if (soloPagina && typeof getServiziPagina === 'function') {
            return getServiziPagina() || [];
        }
        return typeof getServiziFiltrati === 'function' ? (getServiziFiltrati() || []) : [];
    }

    function aggiornaConteggio() {
        const n = elencoDaStampare().length;
        if (countEl) countEl.textContent = String(n);
    }

    function apriModal() {
        mostraErrore('');
        const salvati = leggiSelezioneSalvata();
        if (salvati && salvati.length) {
            impostaSelezione(salvati);
        } else {
            impostaSelezione(CAMPI_PDF_SERVIZI.filter((campo) => campo.predefinito).map((campo) => campo.key));
        }
        aggiornaConteggio();
        const ordineSalvato = leggiOrdineSalvato();
        if (chkOrdina) chkOrdina.checked = ordineSalvato?.attivo === true;
        aggiornaPannelloOrdine(ordineSalvato || undefined);
        modal.hidden = false;
    }

    function chiudiModal() {
        modal.hidden = true;
        mostraErrore('');
    }

    btnApri?.addEventListener('click', apriModal);
    btnChiudi?.addEventListener('click', chiudiModal);
    btnAnnulla?.addEventListener('click', chiudiModal);

    modal.addEventListener('click', (e) => {
        if (e.target === modal) chiudiModal();
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !modal.hidden) chiudiModal();
    });

    modal.querySelectorAll('input[name="pdf-servizi-ambito"]').forEach((radio) => {
        radio.addEventListener('change', () => {
            mostraErrore('');
            aggiornaConteggio();
        });
    });

    btnNessuno?.addEventListener('click', () => {
        impostaSelezione([]);
        aggiornaPannelloOrdine();
    });

    campiBox.addEventListener('change', () => {
        aggiornaPannelloOrdine();
    });

    chkOrdina?.addEventListener('change', () => {
        aggiornaPannelloOrdine();
    });

    campoOrdine1?.addEventListener('change', () => {
        if (campoOrdine2 && campoOrdine2.value === campoOrdine1.value) {
            campoOrdine2.value = '';
        }
        aggiornaVerso(campoOrdine1, versoOrdine1);
        aggiornaVerso(campoOrdine2, versoOrdine2);
    });

    campoOrdine2?.addEventListener('change', () => {
        aggiornaVerso(campoOrdine2, versoOrdine2);
    });

    btnTutti?.addEventListener('click', () => {
        impostaSelezione(CAMPI_PDF_SERVIZI.map((campo) => campo.key));
        aggiornaPannelloOrdine();
    });
    btnPrincipali?.addEventListener('click', () => {
        impostaSelezione(CAMPI_PDF_SERVIZI.filter((campo) => campo.predefinito).map((campo) => campo.key));
        aggiornaPannelloOrdine();
    });

    btnGenera.addEventListener('click', () => {
        mostraErrore('');
        const keys = chiaviSelezionate();
        const campi = CAMPI_PDF_SERVIZI.filter((campo) => keys.includes(campo.key));
        const servizi = elencoDaStampare();
        const titolo = typeof getTitolo === 'function' ? getTitolo() : 'ELENCO SERVIZI';
        const ordinamento = leggiOrdinamentoScelto();

        try {
            generaPdfElencoServizi(servizi, campi, { titolo, formatMezzo, ordinamento });
            salvaSelezione(keys);
            salvaOrdine({
                attivo: chkOrdina?.checked === true,
                primo: campoOrdine1?.value || '',
                primoDir: versoOrdine1?.value === 'desc' ? 'desc' : 'asc',
                secondo: campoOrdine2?.value || '',
                secondoDir: versoOrdine2?.value === 'desc' ? 'desc' : 'asc'
            });
            chiudiModal();
        } catch (err) {
            console.error('PDF elenco servizi:', err);
            mostraErrore(String(err?.message || err || 'Errore durante la generazione del PDF'));
        }
    });
}
