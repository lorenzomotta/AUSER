// Fogli di viaggio — legge la vista Supabase FogliDiViaggio.
// Ogni colonna si può ordinare e filtrare. I totali in basso contano le righe visibili.
import { etichettaMezzo, trovaAutomezzo } from './mezzo-etichetta.js';
import { initModificaServizio, setupModaleModifica, apriModalModifica } from './modifica-servizio.js';

const COLONNE = [
    { key: 'Data', label: 'DATA', tipo: 'data', classe: 'fdv-data' },
    { key: 'Mezzo', label: 'MEZZO', tipo: 'testo', classe: '' },
    { key: 'Operatore', label: 'OPERATORE', tipo: 'testo', classe: '' },
    { key: 'Trasportato', label: 'TRASPORTATO', tipo: 'testo', classe: '' },
    { key: 'Partenza', label: 'PARTENZA', tipo: 'testo', classe: '' },
    { key: 'Destinazione', label: 'DESTINAZIONE', tipo: 'testo', classe: '' },
    { key: 'Motivazione', label: 'MOTIVAZIONE', tipo: 'testo', classe: '' },
    { key: 'Km_Arrivo', label: 'KM_ARRIVO', tipo: 'numero', classe: 'fdv-num' },
    { key: 'Km_Partenza', label: 'KM_PARTENZA', tipo: 'numero', classe: 'fdv-num' },
    { key: 'Km', label: 'KM', tipo: 'numero', classe: 'fdv-num' },
    { key: 'Note_Finali', label: 'NOTE FINALI', tipo: 'testo', classe: 'fdv-note' }
];

const VUOTO = '(vuoto)';
const MAX_VALORI_MENU = 300;

let invoke = null;
let automezzi = [];
let filtroMezzo = '';
let etichettaFiltro = '';
/** Righe già caricate, prima dei filtri di colonna. */
let righeBase = [];
/** key colonna → { testo, esclusi: Set di valori nascosti } */
let filtriColonna = {};
let ordinamento = { key: 'Data', dir: 'desc' };
let menuColonna = '';

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

function leggiFiltroDaUrl() {
    const params = new URLSearchParams(window.location.search);
    filtroMezzo = String(params.get('mezzo') || '').trim();
    etichettaFiltro = String(params.get('etichetta') || '').trim();
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text == null ? '' : String(text);
    return div.innerHTML;
}

function chiave(val) {
    const s = String(val ?? '').trim();
    if (!s) return '';
    return s.endsWith('.0') ? s.slice(0, -2) : s;
}

function idServizioRiga(row) {
    const n = Number(campo(row, 'id'));
    return Number.isFinite(n) && n > 0 ? n : 0;
}

function campo(row, nome) {
    if (!row || typeof row !== 'object') return '';
    if (Object.prototype.hasOwnProperty.call(row, nome) && row[nome] != null) {
        return row[nome];
    }
    const key = Object.keys(row).find((k) => k.toLowerCase() === nome.toLowerCase());
    if (!key || row[key] == null) return '';
    return row[key];
}

function formatData(raw) {
    const s = String(raw ?? '').trim();
    if (!s) return '';
    const iso = s.slice(0, 10);
    const matchIso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (matchIso) return `${matchIso[3]}/${matchIso[2]}/${matchIso[1]}`;
    return s;
}

function chiaveData(raw) {
    const s = String(raw ?? '').trim();
    const iso = s.slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
    const it = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(s);
    if (it) return `${it[3]}-${it[2]}-${it[1]}`;
    return '';
}

function dataOggiIso() {
    const oggi = new Date();
    const mese = String(oggi.getMonth() + 1).padStart(2, '0');
    const giorno = String(oggi.getDate()).padStart(2, '0');
    return `${oggi.getFullYear()}-${mese}-${giorno}`;
}

function viaggioFinoAOggi(row) {
    const data = chiaveData(campo(row, 'Data'));
    if (!data) return false;
    return data <= dataOggiIso();
}

function formatKm(raw) {
    if (raw === null || raw === undefined || String(raw).trim() === '') return '';
    const n = Number(raw);
    if (!Number.isFinite(n)) return String(raw).trim();
    const rounded = Math.round(n * 10) / 10;
    if (Number.isInteger(rounded)) return String(rounded);
    return rounded.toLocaleString('it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

function numeroSort(raw) {
    if (raw === null || raw === undefined || String(raw).trim() === '') return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
}

function stessoMezzo(valoreRiga, idMezzo) {
    const salvato = chiave(valoreRiga);
    const cercato = chiave(idMezzo);
    if (!salvato || !cercato) return false;
    if (salvato === cercato) return true;
    const auto = trovaAutomezzo(automezzi, cercato);
    if (!auto) return false;
    return salvato === chiave(auto.nr_automezzo) || salvato === chiave(auto.id);
}

function testoMezzo(row) {
    const salvato = campo(row, 'Mezzo');
    const auto = trovaAutomezzo(automezzi, salvato);
    if (auto) return etichettaMezzo(auto);
    return String(salvato ?? '').trim();
}

function valoreVisibile(row, col) {
    if (col.key === 'Data') return formatData(campo(row, 'Data'));
    if (col.key === 'Mezzo') return testoMezzo(row);
    if (col.tipo === 'numero') return formatKm(campo(row, col.key));
    return String(campo(row, col.key) ?? '').trim();
}

function valoreOrdinamento(row, col) {
    if (col.tipo === 'data') return chiaveData(campo(row, 'Data'));
    if (col.tipo === 'numero') return numeroSort(campo(row, col.key));
    return valoreVisibile(row, col).toLocaleLowerCase('it');
}

function etichettaValore(visibile) {
    return visibile ? visibile : VUOTO;
}

function colonnaDaKey(key) {
    return COLONNE.find((col) => col.key === key) || null;
}

function filtroAttivo(key) {
    const filtro = filtriColonna[key];
    if (!filtro) return false;
    return Boolean(filtro.dal || filtro.al || filtro.testo || (filtro.esclusi && filtro.esclusi.size > 0));
}

function qualcheFiltroAttivo() {
    return COLONNE.some((col) => filtroAttivo(col.key));
}

function etichetteOrdine(tipo) {
    if (tipo === 'data') return ['Dal più vecchio', 'Dal più recente'];
    if (tipo === 'numero') return ['Dal più piccolo', 'Dal più grande'];
    return ['A → Z', 'Z → A'];
}

function creaIntestazioni() {
    const riga = document.getElementById('fdv-intestazione');
    if (!riga || riga.dataset.pronta === '1') return;
    riga.dataset.pronta = '1';
    riga.innerHTML = COLONNE.map((col) => `
        <th>
            <div class="fdv-th">
                <span>${escapeHtml(col.label)}</span>
                <button type="button" class="fdv-filtro-btn" data-col="${escapeHtml(col.key)}" title="Ordina o filtra ${escapeHtml(col.label)}" aria-label="Ordina o filtra ${escapeHtml(col.label)}">▾</button>
            </div>
        </th>
    `).join('');
    riga.addEventListener('click', (e) => {
        const btn = e.target.closest('.fdv-filtro-btn');
        if (!btn) return;
        e.stopPropagation();
        apriMenu(btn.dataset.col, btn);
    });
}

function aggiornaBottoniIntestazione() {
    document.querySelectorAll('.fdv-filtro-btn').forEach((btn) => {
        const key = btn.dataset.col;
        const col = colonnaDaKey(key);
        const ordinata = ordinamento.key === key;
        const filtrata = filtroAttivo(key);
        btn.classList.toggle('is-ordinato', ordinata);
        btn.classList.toggle('is-filtrato', filtrata);
        btn.classList.toggle('is-aperto', menuColonna === key);
        if (ordinata) btn.textContent = ordinamento.dir === 'asc' ? '▲' : '▼';
        else btn.textContent = '▾';
        const azioni = [];
        if (ordinata) azioni.push(ordinamento.dir === 'asc' ? 'ordinata crescente' : 'ordinata decrescente');
        if (filtrata) azioni.push('filtro attivo');
        btn.title = azioni.length
            ? `${col?.label || key}: ${azioni.join(', ')}`
            : `Ordina o filtra ${col?.label || key}`;
    });
}

function aggiornaIntestazione() {
    const sotto = document.getElementById('fdv-sottotitolo');
    const btnTutti = document.getElementById('btn-mostra-tutti');
    if (filtroMezzo) {
        const nome = etichettaFiltro || testoMezzo({ Mezzo: filtroMezzo }) || `Mezzo ${filtroMezzo}`;
        if (sotto) sotto.textContent = `Mezzo: ${nome}`;
        if (btnTutti) btnTutti.disabled = false;
    } else {
        if (sotto) sotto.textContent = 'Tutti i mezzi';
        if (btnTutti) btnTutti.disabled = true;
    }
}

function mostraMessaggio(testo, errore) {
    const el = document.getElementById('fdv-messaggio');
    const wrap = document.getElementById('fdv-tabella-wrap');
    const footer = document.getElementById('fdv-footer');
    if (wrap) wrap.hidden = true;
    if (footer) footer.hidden = true;
    if (!el) return;
    el.hidden = false;
    el.textContent = testo;
    el.classList.toggle('fdv-errore', Boolean(errore));
}

function messaggioErrore(err) {
    const testo = String(err?.message || err || '');
    if (/foglidiviaggio|schema cache|PGRST205|does not exist|42P01/i.test(testo)) {
        return 'La vista FogliDiViaggio non è pronta in Supabase. Esegui lo script supabase-fogli-di-viaggio.sql nel SQL Editor, poi riapri questa pagina.';
    }
    return `Non riesco a caricare i fogli di viaggio. ${testo}`;
}

function dentroIntervalloData(row, filtro) {
    const iso = chiaveData(campo(row, 'Data'));
    if (!iso) return false;
    let dal = filtro.dal || '';
    let al = filtro.al || '';
    if (dal && al && dal > al) {
        const scambio = dal;
        dal = al;
        al = scambio;
    }
    if (dal && iso < dal) return false;
    if (al && iso > al) return false;
    return true;
}

function rigaVisibile(row) {
    return COLONNE.every((col) => {
        const filtro = filtriColonna[col.key];
        if (!filtro) return true;
        if (col.tipo === 'data') return dentroIntervalloData(row, filtro);
        const etichetta = etichettaValore(valoreVisibile(row, col));
        if (filtro.testo && !etichetta.toLocaleLowerCase('it').includes(filtro.testo)) return false;
        if (filtro.esclusi && filtro.esclusi.has(etichetta)) return false;
        return true;
    });
}

function confrontaRighe(a, b) {
    const col = colonnaDaKey(ordinamento.key) || COLONNE[0];
    const va = valoreOrdinamento(a, col);
    const vb = valoreOrdinamento(b, col);
    const vuotoA = va === '' || va == null;
    const vuotoB = vb === '' || vb == null;
    if (vuotoA && vuotoB) return 0;
    if (vuotoA) return 1;
    if (vuotoB) return -1;
    let cmp = 0;
    if (col.tipo === 'numero') cmp = va - vb;
    else cmp = String(va).localeCompare(String(vb), 'it', { numeric: true, sensitivity: 'base' });
    if (cmp === 0) {
        const ia = Number(campo(a, 'id')) || 0;
        const ib = Number(campo(b, 'id')) || 0;
        cmp = ib - ia;
    }
    return ordinamento.dir === 'asc' ? cmp : -cmp;
}

function righeFiltrate() {
    return righeBase.filter(rigaVisibile).sort(confrontaRighe);
}

function aggiornaFooter(righe) {
    const footer = document.getElementById('fdv-footer');
    const elViaggi = document.getElementById('fdv-totale-viaggi');
    const elKm = document.getElementById('fdv-totale-km');
    const nota = document.getElementById('fdv-footer-nota');
    if (footer) footer.hidden = false;
    if (elViaggi) elViaggi.textContent = String(righe.length);
    let somma = 0;
    righe.forEach((row) => {
        const n = numeroSort(campo(row, 'Km'));
        if (n != null) somma += n;
    });
    if (elKm) elKm.textContent = formatKm(somma) || '0';
    if (nota) nota.hidden = !qualcheFiltroAttivo();
}

function disegnaRighe(righe) {
    const corpo = document.getElementById('fdv-corpo');
    const wrap = document.getElementById('fdv-tabella-wrap');
    const messaggio = document.getElementById('fdv-messaggio');
    const stato = document.getElementById('fdv-stato');
    if (!corpo) return;

    if (!righeBase.length) {
        mostraMessaggio(filtroMezzo
            ? 'Nessun foglio di viaggio per questo mezzo.'
            : 'Nessun foglio di viaggio.');
        if (stato) stato.textContent = '0 viaggi';
        return;
    }

    if (!righe.length) {
        corpo.innerHTML = `<tr><td class="fdv-vuoto" colspan="${COLONNE.length}">Nessun viaggio con questi filtri. Apri la colonna e premi «Azzera filtro».</td></tr>`;
    } else {
        corpo.innerHTML = righe.map((row) => {
            const km = numeroSort(campo(row, 'Km'));
            const classeRiga = km == null ? 'fdv-km-vuoto' : 'fdv-km-ok';
            const id = idServizioRiga(row);
            return `
            <tr class="${classeRiga}" data-servizio-id="${id}" title="Doppio clic per aprire la scheda">
                ${COLONNE.map((col) => `<td class="${col.classe}">${escapeHtml(valoreVisibile(row, col))}</td>`).join('')}
            </tr>`;
        }).join('');
    }

    if (messaggio) messaggio.hidden = true;
    if (wrap) wrap.hidden = false;
    aggiornaFooter(righe);
    aggiornaBottoniIntestazione();
    if (stato) {
        if (righe.length === righeBase.length) {
            stato.textContent = righe.length === 1 ? '1 viaggio' : `${righe.length} viaggi`;
        } else {
            stato.textContent = `${righe.length} di ${righeBase.length}`;
        }
    }
}

function applicaVista() {
    disegnaRighe(righeFiltrate());
}

function valoriColonna(col) {
    const visti = new Set();
    const lista = [];
    righeBase.forEach((row) => {
        const etichetta = etichettaValore(valoreVisibile(row, col));
        if (visti.has(etichetta)) return;
        visti.add(etichetta);
        lista.push(etichetta);
    });
    lista.sort((a, b) => a.localeCompare(b, 'it', { numeric: true, sensitivity: 'base' }));
    return lista;
}

function chiudiMenu() {
    const menu = document.getElementById('fdv-menu');
    if (menu) menu.hidden = true;
    menuColonna = '';
    aggiornaBottoniIntestazione();
}

function posizionaMenu(bottone) {
    const menu = document.getElementById('fdv-menu');
    if (!menu || !bottone) return;
    menu.hidden = false;
    const r = bottone.getBoundingClientRect();
    const larghezza = menu.offsetWidth || 260;
    const altezza = menu.offsetHeight || 320;
    let left = r.left;
    if (left + larghezza > window.innerWidth - 8) left = window.innerWidth - larghezza - 8;
    if (left < 8) left = 8;
    let top = r.bottom + 4;
    if (top + altezza > window.innerHeight - 8) top = Math.max(8, r.top - altezza - 4);
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
}

function disegnaListaValori() {
    const col = colonnaDaKey(menuColonna);
    const lista = document.getElementById('fdv-menu-lista');
    const tutti = document.getElementById('fdv-menu-tutti');
    if (!col || !lista) return;
    const filtro = filtriColonna[col.key] || { testo: '', esclusi: new Set() };
    const cerca = filtro.testo || '';
    const valori = valoriColonna(col).filter((valore) => {
        if (!cerca) return true;
        return valore.toLocaleLowerCase('it').includes(cerca);
    });
    lista.innerHTML = '';
    const mostrati = valori.slice(0, MAX_VALORI_MENU);
    if (!mostrati.length) {
        const vuoto = document.createElement('div');
        vuoto.className = 'fdv-menu-vuoto';
        vuoto.textContent = 'Nessun valore';
        lista.appendChild(vuoto);
    }
    mostrati.forEach((valore) => {
        const label = document.createElement('label');
        label.className = 'fdv-menu-valore';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = !filtro.esclusi || !filtro.esclusi.has(valore);
        input.dataset.valore = valore;
        const testo = document.createElement('span');
        testo.textContent = valore;
        label.appendChild(input);
        label.appendChild(testo);
        lista.appendChild(label);
    });
    if (valori.length > MAX_VALORI_MENU) {
        const extra = document.createElement('div');
        extra.className = 'fdv-menu-vuoto';
        extra.textContent = `Ci sono altri ${valori.length - MAX_VALORI_MENU} valori. Restringi con «Contiene».`;
        lista.appendChild(extra);
    }
    if (tutti) {
        const visibili = mostrati;
        tutti.checked = visibili.length > 0 && visibili.every((valore) => !filtro.esclusi || !filtro.esclusi.has(valore));
        tutti.indeterminate = !tutti.checked && visibili.some((valore) => !filtro.esclusi || !filtro.esclusi.has(valore));
    }
}

function assicuraFiltro(key) {
    if (!filtriColonna[key]) {
        filtriColonna[key] = { testo: '', esclusi: new Set() };
    }
    return filtriColonna[key];
}

function pulisciFiltroVuoto(key) {
    const filtro = filtriColonna[key];
    if (!filtro) return;
    const senzaDate = !filtro.dal && !filtro.al;
    const senzaTesto = !filtro.testo && (!filtro.esclusi || filtro.esclusi.size === 0);
    if (senzaDate && senzaTesto) delete filtriColonna[key];
}

function mostraPannelloMenu() {
    const col = colonnaDaKey(menuColonna);
    const eData = col?.tipo === 'data';
    const valori = document.getElementById('fdv-menu-valori');
    const date = document.getElementById('fdv-menu-date');
    if (valori) valori.hidden = Boolean(eData);
    if (date) date.hidden = !eData;
    if (!eData) return;
    const filtro = filtriColonna.Data;
    const dal = document.getElementById('fdv-data-dal');
    const al = document.getElementById('fdv-data-al');
    if (dal) dal.value = filtro?.dal || '';
    if (al) al.value = filtro?.al || '';
}

function aggiornaIntervalloDate() {
    if (menuColonna !== 'Data') return;
    const dalEl = document.getElementById('fdv-data-dal');
    const alEl = document.getElementById('fdv-data-al');
    let dal = dalEl?.value || '';
    let al = alEl?.value || '';
    if (dal && al && dal > al) {
        const scambio = dal;
        dal = al;
        al = scambio;
        if (dalEl) dalEl.value = dal;
        if (alEl) alEl.value = al;
    }
    if (!dal && !al) {
        delete filtriColonna.Data;
    } else {
        const filtro = assicuraFiltro('Data');
        filtro.dal = dal;
        filtro.al = al;
        filtro.testo = '';
        filtro.esclusi = new Set();
    }
    applicaVista();
}

function apriMenu(key, bottone) {
    if (menuColonna === key) {
        chiudiMenu();
        return;
    }
    const col = colonnaDaKey(key);
    if (!col) return;
    menuColonna = key;
    const [asc, desc] = etichetteOrdine(col.tipo);
    const btnAsc = document.getElementById('fdv-ordina-asc');
    const btnDesc = document.getElementById('fdv-ordina-desc');
    if (btnAsc) {
        btnAsc.textContent = asc;
        btnAsc.classList.toggle('is-scelto', ordinamento.key === key && ordinamento.dir === 'asc');
    }
    if (btnDesc) {
        btnDesc.textContent = desc;
        btnDesc.classList.toggle('is-scelto', ordinamento.key === key && ordinamento.dir === 'desc');
    }
    const cerca = document.getElementById('fdv-menu-cerca');
    const filtro = filtriColonna[key];
    if (cerca) cerca.value = filtro?.testo ? filtro.testo : '';
    mostraPannelloMenu();
    if (col.tipo !== 'data') disegnaListaValori();
    posizionaMenu(bottone);
    aggiornaBottoniIntestazione();
    if (col.tipo === 'data') document.getElementById('fdv-data-dal')?.focus();
    else cerca?.focus();
}

function impostaOrdine(dir) {
    if (!menuColonna) return;
    ordinamento = { key: menuColonna, dir };
    const btnAsc = document.getElementById('fdv-ordina-asc');
    const btnDesc = document.getElementById('fdv-ordina-desc');
    if (btnAsc) btnAsc.classList.toggle('is-scelto', dir === 'asc');
    if (btnDesc) btnDesc.classList.toggle('is-scelto', dir === 'desc');
    applicaVista();
}

function aggiornaTestoFiltro(testo) {
    if (!menuColonna) return;
    const filtro = assicuraFiltro(menuColonna);
    filtro.testo = testo.trim().toLocaleLowerCase('it');
    pulisciFiltroVuoto(menuColonna);
    disegnaListaValori();
    applicaVista();
}

function aggiornaCasellaTutti() {
    const tutti = document.getElementById('fdv-menu-tutti');
    const inputs = [...document.querySelectorAll('#fdv-menu-lista input[type="checkbox"]')];
    if (!tutti) return;
    const segnati = inputs.filter((input) => input.checked).length;
    tutti.checked = inputs.length > 0 && segnati === inputs.length;
    tutti.indeterminate = segnati > 0 && segnati < inputs.length;
}

function cambiaValore(valore, incluso) {
    if (!menuColonna || !valore) return;
    const filtro = assicuraFiltro(menuColonna);
    if (incluso) filtro.esclusi.delete(valore);
    else filtro.esclusi.add(valore);
    pulisciFiltroVuoto(menuColonna);
    aggiornaCasellaTutti();
    applicaVista();
}

function selezionaVisibili(includi) {
    if (!menuColonna) return;
    const filtro = assicuraFiltro(menuColonna);
    document.querySelectorAll('#fdv-menu-lista input[type="checkbox"]').forEach((input) => {
        const valore = input.dataset.valore;
        if (!valore) return;
        input.checked = includi;
        if (includi) filtro.esclusi.delete(valore);
        else filtro.esclusi.add(valore);
    });
    pulisciFiltroVuoto(menuColonna);
    aggiornaCasellaTutti();
    applicaVista();
}

function azzeraFiltroColonna() {
    if (!menuColonna) return;
    delete filtriColonna[menuColonna];
    const cerca = document.getElementById('fdv-menu-cerca');
    if (cerca) cerca.value = '';
    const dal = document.getElementById('fdv-data-dal');
    const al = document.getElementById('fdv-data-al');
    if (dal) dal.value = '';
    if (al) al.value = '';
    if (colonnaDaKey(menuColonna)?.tipo !== 'data') disegnaListaValori();
    applicaVista();
}

function preparaMenu() {
    document.getElementById('fdv-ordina-asc')?.addEventListener('click', () => impostaOrdine('asc'));
    document.getElementById('fdv-ordina-desc')?.addEventListener('click', () => impostaOrdine('desc'));
    document.getElementById('fdv-menu-azzera')?.addEventListener('click', azzeraFiltroColonna);
    document.getElementById('fdv-menu-cerca')?.addEventListener('input', (e) => {
        if (menuColonna === 'Data') return;
        aggiornaTestoFiltro(e.target.value || '');
    });
    document.getElementById('fdv-data-dal')?.addEventListener('change', aggiornaIntervalloDate);
    document.getElementById('fdv-data-al')?.addEventListener('change', aggiornaIntervalloDate);
    document.getElementById('fdv-menu-tutti')?.addEventListener('change', (e) => {
        selezionaVisibili(e.target.checked);
    });
    document.getElementById('fdv-menu-lista')?.addEventListener('change', (e) => {
        const input = e.target.closest('input[type="checkbox"]');
        if (!input) return;
        cambiaValore(input.dataset.valore, input.checked);
    });
    document.addEventListener('click', (e) => {
        if (!menuColonna) return;
        if (e.target.closest('#fdv-menu') || e.target.closest('.fdv-filtro-btn')) return;
        chiudiMenu();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') chiudiMenu();
    });
    document.getElementById('fdv-tabella-wrap')?.addEventListener('scroll', () => {
        if (menuColonna) chiudiMenu();
    });
}

async function caricaAutomezzi() {
    automezzi = [];
    if (!invoke) return;
    try {
        const list = await invoke('get_all_automezzi');
        automezzi = Array.isArray(list) ? list : [];
    } catch (err) {
        console.warn('Elenco mezzi non disponibile per le etichette:', err);
    }
}

function soloFinoAOggi(righe) {
    return (Array.isArray(righe) ? righe : []).filter(viaggioFinoAOggi);
}

async function scaricaRighe() {
    await invoke('init_supabase_from_config').catch(() => {});
    if (filtroMezzo) {
        const filtrate = await invoke('get_fogli_di_viaggio', { mezzo: filtroMezzo });
        if (Array.isArray(filtrate) && filtrate.length) return soloFinoAOggi(filtrate);
        const tutti = await invoke('get_fogli_di_viaggio');
        return soloFinoAOggi(tutti).filter((row) => stessoMezzo(campo(row, 'Mezzo'), filtroMezzo));
    }
    const tutti = await invoke('get_fogli_di_viaggio');
    return soloFinoAOggi(tutti);
}

async function carica() {
    chiudiMenu();
    filtriColonna = {};
    ordinamento = { key: 'Data', dir: 'desc' };
    righeBase = [];
    aggiornaIntestazione();
    mostraMessaggio('Caricamento fogli di viaggio…');
    if (!isTauri() || !invoke) {
        mostraMessaggio('Apri questa pagina dall\'elenco mezzi, dentro l\'app.');
        return;
    }
    try {
        await caricaAutomezzi();
        aggiornaIntestazione();
        righeBase = await scaricaRighe();
        applicaVista();
    } catch (err) {
        console.error(err);
        mostraMessaggio(messaggioErrore(err), true);
        const stato = document.getElementById('fdv-stato');
        if (stato) stato.textContent = '';
    }
}

function mostraTutti() {
    filtroMezzo = '';
    etichettaFiltro = '';
    const url = new URL(window.location.href);
    url.searchParams.delete('mezzo');
    url.searchParams.delete('etichetta');
    window.history.replaceState({}, '', `${url.pathname}${url.search}`);
    carica();
}

async function tornaElencoMezzi() {
    if (isTauri()) {
        try {
            const { WebviewWindow, getCurrent } = await import('@tauri-apps/api/window');
            const elenco = WebviewWindow.getByLabel('elenco-mezzi');
            if (elenco) {
                await elenco.show();
                await elenco.setFocus();
            }
            await getCurrent().close();
            return;
        } catch (err) {
            console.warn('Chiusura finestra fogli di viaggio:', err);
        }
    }
    if (window.opener) {
        window.close();
        return;
    }
    window.location.href = 'ELENCOMEZZI.html';
}

async function apriSchedaLettura(id) {
    const idNum = parseInt(id, 10);
    if (!Number.isFinite(idNum) || idNum <= 0) return;
    if (!invoke) {
        alert('Apri questa pagina dall\'elenco mezzi, dentro l\'app.');
        return;
    }
    try {
        await apriModalModifica(idNum, { solaLettura: true, modificaKm: true });
    } catch (err) {
        console.error(err);
        alert('Non riesco ad aprire la scheda del servizio.');
    }
}

creaIntestazioni();
preparaMenu();
document.getElementById('fdv-corpo')?.addEventListener('dblclick', (e) => {
    const riga = e.target.closest('tr[data-servizio-id]');
    if (!riga || !document.getElementById('fdv-corpo')?.contains(riga)) return;
    apriSchedaLettura(riga.dataset.servizioId);
});
initModificaServizio({
    getInvoke: () => invoke,
    isTauriEnv: isTauri,
    trovaServizioLocal: () => null,
    onSaveSuccess: async () => {
        await carica();
    }
});
setupModaleModifica();
document.getElementById('btn-mostra-tutti')?.addEventListener('click', mostraTutti);
document.getElementById('btn-torna')?.addEventListener('click', () => {
    tornaElencoMezzi();
});

leggiFiltroDaUrl();
initTauri().then(() => carica());
