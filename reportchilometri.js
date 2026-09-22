// Riepilogo Chilometri Percorsi — popup da Elenco Operatori
let invoke;

const MESI_IT = [
    'GENNAIO', 'FEBBRAIO', 'MARZO', 'APRILE', 'MAGGIO', 'GIUGNO',
    'LUGLIO', 'AGOSTO', 'SETTEMBRE', 'OTTOBRE', 'NOVEMBRE', 'DICEMBRE'
];

const GRUPPI = [
    { key: 'TESSERATI', label: 'TESSERATI', rimborsabile: true },
    { key: 'AUSER RIMBORSO', label: 'AUSER RIMBORSO', rimborsabile: true },
    { key: 'AUSER GRATIS', label: 'AUSER GRATIS', rimborsabile: false }
];

let operatoreNome = '';
let operatoreIdsocio = '';
/** Se true: mostra tutti gli operatori in ordine alfabetico */
let modalitaTutti = false;
let annoRif = new Date().getFullYear();
/** Mese inizio periodo (0–11) */
let meseDa = new Date().getMonth();
/** Mese fine periodo (0–11) */
let meseA = new Date().getMonth();
let serviziAnnoCache = {};

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

function pad2(n) {
    return String(n).padStart(2, '0');
}

function escapeHtml(text) {
    if (text === null || text === undefined) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
}

function popolaSelectMesi() {
    const selDa = document.getElementById('rc-mese-da');
    const selA = document.getElementById('rc-mese-a');
    if (!selDa || !selA) return;

    const options = MESI_IT.map((nome, i) =>
        `<option value="${i}">${nome}</option>`
    ).join('');
    selDa.innerHTML = options;
    selA.innerHTML = options;
}

function normalizzaPeriodo() {
    if (meseDa > meseA) {
        const tmp = meseDa;
        meseDa = meseA;
        meseA = tmp;
    }
}

function testoPeriodo() {
    if (meseDa === meseA) {
        return `${MESI_IT[meseDa]} ${annoRif}`;
    }
    return `${MESI_IT[meseDa]} – ${MESI_IT[meseA]} ${annoRif}`;
}

function leggiParametriUrl() {
    const params = new URLSearchParams(window.location.search);
    modalitaTutti = params.get('tutti') === '1' || params.get('mode') === 'tutti';
    operatoreNome = (params.get('operatore') || params.get('nominativo') || '').trim();
    operatoreIdsocio = (params.get('idsocio') || '').trim();

    const oggi = new Date();
    annoRif = oggi.getFullYear();
    // Chilometri totali = da gennaio a oggi; singolo operatore = mese corrente
    if (modalitaTutti) {
        meseDa = 0;
        meseA = oggi.getMonth();
    } else {
        meseDa = oggi.getMonth();
        meseA = oggi.getMonth();
    }

    const anno = parseInt(params.get('anno') || '', 10);
    const mese = parseInt(params.get('mese') || '', 10);
    const meseDaUrl = parseInt(params.get('mese_da') || params.get('meseDa') || '', 10);
    const meseAUrl = parseInt(params.get('mese_a') || params.get('meseA') || '', 10);

    if (Number.isFinite(anno) && anno >= 2000) annoRif = anno;

    if (Number.isFinite(meseDaUrl) && meseDaUrl >= 1 && meseDaUrl <= 12) {
        meseDa = meseDaUrl - 1;
    } else if (Number.isFinite(mese) && mese >= 1 && mese <= 12) {
        meseDa = mese - 1;
    }

    if (Number.isFinite(meseAUrl) && meseAUrl >= 1 && meseAUrl <= 12) {
        meseA = meseAUrl - 1;
    } else if (Number.isFinite(mese) && mese >= 1 && mese <= 12) {
        meseA = mese - 1;
    }

    normalizzaPeriodo();
}

function aggiornaPeriodoUI() {
    const annoEl = document.getElementById('rc-anno');
    if (annoEl) annoEl.textContent = String(annoRif);

    const selDa = document.getElementById('rc-mese-da');
    const selA = document.getElementById('rc-mese-a');
    if (selDa) selDa.value = String(meseDa);
    if (selA) selA.value = String(meseA);

    const printEl = document.getElementById('rc-periodo-label-print');
    if (printEl) printEl.textContent = testoPeriodo();

    const titolo = modalitaTutti
        ? 'RIEPILOGO CHILOMETRI TOTALI'
        : 'RIEPILOGO CHILOMETRI PERCORSI';
    const titleBox = document.getElementById('rc-title-box');
    if (titleBox) titleBox.textContent = titolo;
    const printTitle = document.getElementById('rc-print-title');
    if (printTitle) printTitle.textContent = titolo;

    const opEl = document.getElementById('rc-operatore');
    if (opEl) {
        opEl.textContent = modalitaTutti
            ? 'TUTTI GLI OPERATORI (ordine alfabetico)'
            : (operatoreNome || '—');
    }
    document.title = modalitaTutti
        ? 'Chilometri Totali — AUSER Asti'
        : `Chilometri ${operatoreNome || ''} — AUSER Asti`;
}

function parseDataItaliana(value) {
    if (!value) return null;
    const s = String(value).trim();
    const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (m) {
        const d = new Date(parseInt(m[3], 10), parseInt(m[2], 10) - 1, parseInt(m[1], 10));
        return Number.isNaN(d.getTime()) ? null : d;
    }
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
        const [y, mo, d] = s.slice(0, 10).split('-').map(Number);
        const date = new Date(y, mo - 1, d);
        return Number.isNaN(date.getTime()) ? null : date;
    }
    return null;
}

function formatDataDisplay(value) {
    const d = parseDataItaliana(value);
    if (!d) return value || '';
    return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
}

function parseKm(value) {
    if (value === null || value === undefined || value === '') return 0;
    const n = parseFloat(String(value).replace(',', '.').replace(/[^\d.-]/g, ''));
    return Number.isNaN(n) ? 0 : n;
}

function formatKm(value) {
    const n = typeof value === 'number' ? value : parseKm(value);
    if (Number.isInteger(n)) return String(n);
    return n.toFixed(1).replace('.', ',');
}

/** Classifica il servizio nei 3 gruppi del report */
function categoriaDaRichiedente(richiedente) {
    const r = String(richiedente || '')
        .trim()
        .toUpperCase()
        .replace(/\s+/g, '_')
        .replace(/-/g, '_');

    if (r.includes('GRATIS')) return 'AUSER GRATIS';
    if (r.includes('RIMBORSO') || r.includes('RMBORSO')) return 'AUSER RIMBORSO';
    return 'TESSERATI';
}

function normalizzaNome(value) {
    return String(value || '')
        .trim()
        .toUpperCase()
        .replace(/\s+/g, ' ');
}

function chiaveNome(value) {
    return normalizzaNome(value)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^A-Z0-9 ]/g, ' ')
        .split(/\s+/)
        .filter(Boolean)
        .sort()
        .join(' ');
}

function nomiCorrispondono(a, b) {
    const na = normalizzaNome(a);
    const nb = normalizzaNome(b);
    if (!na || !nb) return false;
    if (na === nb) return true;
    const ca = chiaveNome(a);
    const cb = chiaveNome(b);
    return !!ca && ca === cb;
}

function normalizzaId(value) {
    const s = String(value ?? '').trim();
    if (!s) return '';
    const noDec = s.endsWith('.0') ? s.slice(0, -2) : s;
    if (/^\d+$/.test(noDec)) return String(parseInt(noDec, 10));
    return noDec;
}

function targetOperatore(nomeOTarget, idsocio) {
    if (nomeOTarget && typeof nomeOTarget === 'object') {
        const ids = [
            ...(Array.isArray(nomeOTarget.ids) ? nomeOTarget.ids : []),
            nomeOTarget.idsocio,
            nomeOTarget.id
        ].map(normalizzaId).filter(Boolean);
        return {
            nome: normalizzaNome(nomeOTarget.nome || nomeOTarget.nominativo || ''),
            ids: [...new Set(ids)]
        };
    }
    const ids = [idsocio, operatoreIdsocio].map(normalizzaId).filter(Boolean);
    return {
        nome: normalizzaNome(nomeOTarget || operatoreNome),
        ids: [...new Set(ids)]
    };
}

function servizioDellOperatore(servizio, nomeOTarget = operatoreNome, idsocio = operatoreIdsocio) {
    const target = targetOperatore(nomeOTarget, idsocio);
    const idsServizio = [servizio.id_operatore, servizio.id_operatore_2]
        .concat(
            [servizio.operatore, servizio.operatore_2, servizio.operatore_testo].filter((x) =>
                /^\d+$/.test(normalizzaId(x))
            )
        )
        .map(normalizzaId)
        .filter(Boolean);

    if (target.ids.some((id) => idsServizio.includes(id))) return true;

    if (target.nome) {
        if (nomiCorrispondono(servizio.operatore, target.nome)) return true;
        if (nomiCorrispondono(servizio.operatore_2, target.nome)) return true;
        if (nomiCorrispondono(servizio.operatore_testo, target.nome)) return true;
    }

    return false;
}

async function fetchServiziAnno(anno) {
    if (serviziAnnoCache[anno]) return serviziAnnoCache[anno];
    if (!invoke) {
        serviziAnnoCache[anno] = [];
        return [];
    }
    await invoke('init_supabase_from_config').catch(() => {});
    const list = await invoke('get_all_servizi_completi', {
        anno,
        tuttiAnni: false
    });
    serviziAnnoCache[anno] = Array.isArray(list) ? list : [];
    return serviziAnnoCache[anno];
}

function servizioEseguito(servizio) {
    const stato = String(servizio?.stato_servizio || '')
        .trim()
        .toUpperCase();
    if (stato.includes('ANNULL')) return false;
    if (stato.includes('DA ESEGUIRE')) return false;
    if (stato.includes('ESEGUIT') || stato.includes('COMPLETAT')) return true;
    // Import senza stato, o codice numerico della tabella lookup
    if (!stato || /^\d+$/.test(stato)) return parseKm(servizio.km) > 0;
    return false;
}

function isOperatoreFlag(tesserato) {
    if (!tesserato) return false;
    if (typeof tesserato.operatore === 'boolean') return tesserato.operatore;
    if (typeof tesserato.operatore === 'number') return tesserato.operatore !== 0;
    const s = String(tesserato.operatore || '').trim().toUpperCase();
    if (!s || s === 'FALSE' || s === 'NO' || s === '0') return false;
    return s === 'TRUE' || s === 'SI' || s === 'SÌ' || s === 'S' || s === '1' ||
        s === 'YES' || s === 'Y';
}

async function fetchOperatoriAnagrafica() {
    if (!invoke) return [];
    try {
        const tesserati = await invoke('get_all_tesserati');
        if (!Array.isArray(tesserati)) return [];
        const idsPerNome = new Map();
        tesserati.forEach((t) => {
            const nk = chiaveNome(t.nominativo);
            if (!nk) return;
            if (!idsPerNome.has(nk)) idsPerNome.set(nk, new Set());
            const set = idsPerNome.get(nk);
            [t.idsocio, t.id].forEach((x) => {
                const n = normalizzaId(x);
                if (n) set.add(n);
            });
        });
        const map = new Map();
        tesserati.filter(isOperatoreFlag).forEach((t) => {
            const nominativo = String(t.nominativo || '').trim();
            const idsocio = String(t.idsocio || '').trim();
            if (!nominativo && !idsocio) return;
            const key = normalizzaId(idsocio) || normalizzaNome(nominativo);
            if (!map.has(key)) {
                const nk = chiaveNome(nominativo);
                const ids = new Set(idsPerNome.get(nk) || []);
                [idsocio, t.id].forEach((x) => {
                    const n = normalizzaId(x);
                    if (n) ids.add(n);
                });
                map.set(key, {
                    nominativo,
                    idsocio,
                    id: t.id != null ? String(t.id) : '',
                    ids: [...ids]
                });
            }
        });
        return [...map.values()].sort((a, b) =>
            a.nominativo.localeCompare(b.nominativo, 'it', { sensitivity: 'base' })
        );
    } catch (err) {
        console.warn('Anagrafica operatori non disponibile per il report km:', err);
        return [];
    }
}

function aggiornaConteggio(testo) {
    const el = document.getElementById('rc-conteggio');
    if (!el) return;
    if (!testo) {
        el.hidden = true;
        el.textContent = '';
        return;
    }
    el.hidden = false;
    el.textContent = testo;
}

function nelPeriodo(servizio) {
    const da = Math.min(meseDa, meseA);
    const a = Math.max(meseDa, meseA);
    const d = parseDataItaliana(servizio.data_prelievo);
    if (!d) return false;
    if (d.getFullYear() !== annoRif) return false;
    const m = d.getMonth();
    return m >= da && m <= a;
}

function ordinaServizi(servizi) {
    return [...servizi].sort((a, b) => {
        const daDate = parseDataItaliana(a.data_prelievo)?.getTime() || 0;
        const dbDate = parseDataItaliana(b.data_prelievo)?.getTime() || 0;
        if (daDate !== dbDate) return daDate - dbDate;
        return String(a.id).localeCompare(String(b.id), undefined, { numeric: true });
    });
}

function filtraServiziPeriodo(servizi, nomeOTarget = operatoreNome, idsocio = operatoreIdsocio) {
    return ordinaServizi(
        servizi.filter((s) => {
            if (!servizioDellOperatore(s, nomeOTarget, idsocio)) return false;
            if (!servizioEseguito(s)) return false;
            return nelPeriodo(s);
        })
    );
}

function renderGruppo(container, gruppo, servizi) {
    const wrap = document.createElement('section');
    wrap.className = 'rc-gruppo';

    const titolo = document.createElement('div');
    titolo.className = 'rc-gruppo-titolo';
    titolo.textContent = gruppo.label;
    wrap.appendChild(titolo);

    if (!servizi.length) {
        const vuoto = document.createElement('div');
        vuoto.className = 'rc-gruppo-vuoto';
        vuoto.textContent = 'Nessun servizio in questo gruppo';
        wrap.appendChild(vuoto);
    } else {
        servizi.forEach((s) => {
            const riga = document.createElement('div');
            riga.className = 'rc-riga';
            riga.innerHTML = `
                <div class="rc-cell">${escapeHtml(formatDataDisplay(s.data_prelievo))}</div>
                <div class="rc-cell">${escapeHtml(s.id)}</div>
                <div class="rc-cell rc-cell-left">${escapeHtml(s.socio_trasportato)}</div>
                <div class="rc-cell">${escapeHtml(s.comune_prelievo)}</div>
                <div class="rc-cell">${escapeHtml(s.comune_destinazione)}</div>
                <div class="rc-cell">${escapeHtml(formatKm(s.km))}</div>
            `;
            wrap.appendChild(riga);
        });
    }

    const totKm = servizi.reduce((acc, s) => acc + parseKm(s.km), 0);
    const sub = document.createElement('div');
    sub.className = 'rc-subtotale';
    sub.innerHTML = `
        <span>NUMERO SERVIZI PER</span>
        <span class="rc-subtotale-nome">${escapeHtml(gruppo.label)}</span>
        <span class="rc-box">${servizi.length}</span>
        <span>KM</span>
        <span class="rc-box">${escapeHtml(formatKm(totKm))}</span>
    `;
    wrap.appendChild(sub);

    container.appendChild(wrap);
    return { count: servizi.length, km: totKm, rimborsabile: gruppo.rimborsabile };
}

function renderTableHead(container) {
    const head = document.createElement('div');
    head.className = 'rc-table-head';
    head.innerHTML = `
        <span>DATA</span>
        <span>SERVIZ</span>
        <span>TRASPORTATO</span>
        <span>PRELIEVO</span>
        <span>DESTINAZIONE</span>
        <span>KM</span>
    `;
    container.appendChild(head);
}

function renderTotaliBox(container, numRimb, kmRimb, numNon, kmNon) {
    const section = document.createElement('section');
    section.className = 'rc-totali';
    section.innerHTML = `
        <div class="rc-totale-riga">
            <span class="rc-totale-label">NUMERO SERVIZI RIMBORSABILI</span>
            <div class="rc-box">${numRimb}</div>
            <span class="rc-totale-label">TOTALE KM RIMBORSABILI</span>
            <div class="rc-box">${escapeHtml(formatKm(kmRimb))}</div>
        </div>
        <div class="rc-totale-riga">
            <span class="rc-totale-label">NUMERO SERVIZI NON RIMBORSABILI</span>
            <div class="rc-box">${numNon}</div>
            <span class="rc-totale-label">TOTALE KM NON RIMBORSABILI</span>
            <div class="rc-box">${escapeHtml(formatKm(kmNon))}</div>
        </div>
        <div class="rc-totale-riga">
            <span class="rc-totale-label">NUMERO SERVIZI COMPLESSIVO</span>
            <div class="rc-box">${numRimb + numNon}</div>
            <span class="rc-totale-label">TOTALE KM DEL PERIODO</span>
            <div class="rc-box">${escapeHtml(formatKm(kmRimb + kmNon))}</div>
        </div>
    `;
    container.appendChild(section);
}

function aggiornaTotaliPagina(numRimb, kmRimb, numNon, kmNon) {
    document.getElementById('rc-num-rimborsabili').textContent = String(numRimb);
    document.getElementById('rc-km-rimborsabili').textContent = formatKm(kmRimb);
    document.getElementById('rc-num-non-rimborsabili').textContent = String(numNon);
    document.getElementById('rc-km-non-rimborsabili').textContent = formatKm(kmNon);
    document.getElementById('rc-num-complessivo').textContent = String(numRimb + numNon);
    document.getElementById('rc-km-complessivo').textContent = formatKm(kmRimb + kmNon);
}

function calcolaERenderGruppi(container, servizi) {
    const perGruppo = {
        'TESSERATI': [],
        'AUSER RIMBORSO': [],
        'AUSER GRATIS': []
    };
    servizi.forEach((s) => {
        const cat = categoriaDaRichiedente(s.richiedente);
        perGruppo[cat].push(s);
    });

    let numRimb = 0;
    let kmRimb = 0;
    let numNon = 0;
    let kmNon = 0;

    GRUPPI.forEach((g) => {
        const stats = renderGruppo(container, g, perGruppo[g.key] || []);
        if (stats.rimborsabile) {
            numRimb += stats.count;
            kmRimb += stats.km;
        } else {
            numNon += stats.count;
            kmNon += stats.km;
        }
    });

    return { numRimb, kmRimb, numNon, kmNon };
}

function renderBloccoOperatoreVuoto(container, nomeOp) {
    const blocco = document.createElement('div');
    blocco.className = 'rc-operatore-blocco rc-operatore-vuoto';
    blocco.innerHTML = `
        <section class="rc-operatore-riga rc-operatore-riga-interna">
            <span class="rc-label">OPERATORE</span>
            <div class="rc-operatore-nome">${escapeHtml(nomeOp)}</div>
            <span class="rc-vuoto-km">0 servizi · 0 km</span>
        </section>
    `;
    container.appendChild(blocco);
}

function renderBloccoOperatore(container, nomeOp, servizi) {
    const blocco = document.createElement('div');
    blocco.className = 'rc-operatore-blocco';

    const nomeRiga = document.createElement('section');
    nomeRiga.className = 'rc-operatore-riga rc-operatore-riga-interna';
    nomeRiga.innerHTML = `
        <span class="rc-label">OPERATORE</span>
        <div class="rc-operatore-nome">${escapeHtml(nomeOp)}</div>
    `;
    blocco.appendChild(nomeRiga);
    renderTableHead(blocco);

    const stats = calcolaERenderGruppi(blocco, servizi);
    renderTotaliBox(blocco, stats.numRimb, stats.kmRimb, stats.numNon, stats.kmNon);
    container.appendChild(blocco);
    return stats;
}

function assicuraTitoloTotaliGenerali(mostra) {
    const totSection = document.querySelector('#rc-contenuto > .rc-totali');
    if (!totSection) return;
    let titolo = totSection.querySelector('.rc-totali-titolo');
    if (mostra) {
        totSection.classList.add('rc-totali-generali');
        if (!titolo) {
            titolo = document.createElement('div');
            titolo.className = 'rc-totali-titolo';
            totSection.insertBefore(titolo, totSection.firstChild);
        }
        titolo.textContent = 'TOTALE GENERALE — TUTTI GLI OPERATORI';
    } else {
        totSection.classList.remove('rc-totali-generali');
        titolo?.remove();
    }
}

async function caricaERender() {
    const loading = document.getElementById('rc-loading');
    const errore = document.getElementById('rc-errore');
    const contenuto = document.getElementById('rc-contenuto');
    const gruppiEl = document.getElementById('rc-gruppi');
    const tableHeadFisso = document.querySelector('#rc-contenuto > .rc-table-head');

    normalizzaPeriodo();
    aggiornaPeriodoUI();

    if (!modalitaTutti && !operatoreNome && !operatoreIdsocio) {
        if (loading) loading.hidden = true;
        if (errore) {
            errore.hidden = false;
            errore.textContent = 'Operatore mancante: apri il report dal pulsante CHILOMETRAGGIO.';
        }
        return;
    }

    if (loading) {
        loading.hidden = false;
        loading.textContent = 'Caricamento servizi...';
    }
    if (errore) errore.hidden = true;
    if (contenuto) contenuto.hidden = true;
    aggiornaConteggio('');

    try {
        if (!invoke) await initTauri();
        if (!invoke) throw new Error('Apri questo report dall\'app AUSER');

        const serviziAnno = await fetchServiziAnno(annoRif);
        if (gruppiEl) gruppiEl.innerHTML = '';

        if (modalitaTutti) {
            if (tableHeadFisso) tableHeadFisso.hidden = true;
            assicuraTitoloTotaliGenerali(true);

            const operatori = await fetchOperatoriAnagrafica();
            const eseguitiPeriodo = serviziAnno.filter(
                (s) => servizioEseguito(s) && nelPeriodo(s)
            );
            let conKm = 0;
            const usati = new Set();

            if (!operatori.length) {
                const vuoto = document.createElement('div');
                vuoto.className = 'rc-gruppo-vuoto';
                vuoto.textContent = 'Nessun operatore trovato.';
                gruppiEl.appendChild(vuoto);
            } else {
                operatori.forEach((op) => {
                    const delPeriodo = filtraServiziPeriodo(serviziAnno, op);
                    delPeriodo.forEach((s) => usati.add(s.id));
                    if (!delPeriodo.length) {
                        renderBloccoOperatoreVuoto(gruppiEl, op.nominativo || op.idsocio);
                        return;
                    }
                    conKm += 1;
                    renderBloccoOperatore(gruppiEl, op.nominativo || op.idsocio, delPeriodo);
                });
            }

            const altri = eseguitiPeriodo.filter((s) => !usati.has(s.id));
            const nomiAltri = [...new Set(
                altri.flatMap((s) => [s.operatore, s.operatore_2, s.operatore_testo].filter(Boolean))
            )].sort((a, b) => a.localeCompare(b, 'it', { sensitivity: 'base' }));

            aggiornaConteggio(
                `${operatori.length} operatori in elenco · ${conKm} con km · ` +
                `${serviziAnno.length} servizi caricati per il ${annoRif}` +
                (nomiAltri.length
                    ? ` · ${altri.length} servizi di altri nominativi`
                    : '')
            );

            if (nomiAltri.length) {
                const nota = document.createElement('div');
                nota.className = 'rc-nota-altri';
                nota.textContent =
                    'Questi nomi sono sui servizi ma non risultano ancora tra gli operatori in anagrafica (tesserati da aggiornare):';
                gruppiEl.appendChild(nota);
                nomiAltri.forEach((nome) => {
                    const delPeriodo = filtraServiziPeriodo(altri, { nominativo: nome });
                    if (!delPeriodo.length) return;
                    renderBloccoOperatore(gruppiEl, `${nome} (non in elenco operatori)`, delPeriodo);
                });
            }

            // Totale generale: tutti i servizi eseguiti del periodo, una volta ciascuno
            const tuttiPeriodo = ordinaServizi(eseguitiPeriodo);
            const statsGenerali = {
                numRimb: 0,
                kmRimb: 0,
                numNon: 0,
                kmNon: 0
            };
            tuttiPeriodo.forEach((s) => {
                const cat = categoriaDaRichiedente(s.richiedente);
                const km = parseKm(s.km);
                const gruppo = GRUPPI.find((g) => g.key === cat);
                if (gruppo?.rimborsabile) {
                    statsGenerali.numRimb += 1;
                    statsGenerali.kmRimb += km;
                } else {
                    statsGenerali.numNon += 1;
                    statsGenerali.kmNon += km;
                }
            });
            aggiornaTotaliPagina(
                statsGenerali.numRimb,
                statsGenerali.kmRimb,
                statsGenerali.numNon,
                statsGenerali.kmNon
            );
        } else {
            aggiornaConteggio('');
            if (tableHeadFisso) tableHeadFisso.hidden = false;
            assicuraTitoloTotaliGenerali(false);

            const delPeriodo = filtraServiziPeriodo(serviziAnno);
            const stats = calcolaERenderGruppi(gruppiEl, delPeriodo);
            aggiornaTotaliPagina(stats.numRimb, stats.kmRimb, stats.numNon, stats.kmNon);
        }

        if (loading) loading.hidden = true;
        if (contenuto) contenuto.hidden = false;
    } catch (error) {
        console.error('Errore report chilometri:', error);
        if (loading) loading.hidden = true;
        if (errore) {
            errore.hidden = false;
            errore.textContent = `Errore: ${error}`;
        }
    }
}

function cambiaAnno(delta) {
    annoRif += delta;
    caricaERender();
}

function onCambioMeseDa() {
    const sel = document.getElementById('rc-mese-da');
    if (!sel) return;
    meseDa = parseInt(sel.value, 10);
    if (meseDa > meseA) meseA = meseDa;
    caricaERender();
}

function onCambioMeseA() {
    const sel = document.getElementById('rc-mese-a');
    if (!sel) return;
    meseA = parseInt(sel.value, 10);
    if (meseA < meseDa) meseDa = meseA;
    caricaERender();
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
    leggiParametriUrl();
    popolaSelectMesi();
    await initTauri();

    document.getElementById('btn-chiudi')?.addEventListener('click', chiudiFinestra);
    document.getElementById('btn-stampa')?.addEventListener('click', () => window.print());
    document.getElementById('btn-anno-prev')?.addEventListener('click', () => cambiaAnno(-1));
    document.getElementById('btn-anno-next')?.addEventListener('click', () => cambiaAnno(1));
    document.getElementById('rc-mese-da')?.addEventListener('change', onCambioMeseDa);
    document.getElementById('rc-mese-a')?.addEventListener('change', onCambioMeseA);

    await caricaERender();
});
