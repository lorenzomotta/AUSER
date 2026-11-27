// Rifornimenti — legge la tabella Supabase Rifornimenti.
import { etichettaMezzo, trovaAutomezzo } from './mezzo-etichetta.js';

let invoke = null;
let automezzi = [];
let filtroMezzo = '';
let etichettaFiltro = '';
/** Tutte le righe caricate, prima dei filtri di colonna. */
let righeBase = [];
/** key colonna → { testo, dal, al, esclusi: Set di valori nascosti } */
let filtriColonna = {};
let ordinamento = { key: 'Data', dir: 'desc' };
let menuColonna = '';

const VUOTO = '(vuoto)';
const MAX_VALORI_MENU = 300;

const COLONNE = [
    { key: 'Data', campo: 'Data_Rifornimento', label: 'DATA', tipo: 'data', classe: 'rif-data' },
    { key: 'Mezzo', campo: 'Mezzo', label: 'MEZZO', tipo: 'testo', classe: '' },
    { key: 'Operatore', campo: 'Operatore', label: 'OPERATORE', tipo: 'testo', classe: '' },
    { key: 'Distributore', campo: 'Distributore', label: 'DISTRIBUTORE', tipo: 'testo', classe: '' },
    { key: 'KM', campo: 'KM_Rifornimento', label: 'KM', tipo: 'numero', decimali: 0, classe: 'rif-num' },
    { key: 'Litri', campo: 'Litri', label: 'LITRI', tipo: 'numero', decimali: 2, classe: 'rif-num' },
    { key: 'Costo', campo: 'Costo_Rifornimento', label: 'COSTO', tipo: 'euro', classe: 'rif-num' },
    { key: 'Note', campo: 'Note_Rifornimento', label: 'NOTE', tipo: 'testo', classe: 'rif-note' }
];

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

function numero(raw) {
    if (raw === null || raw === undefined || String(raw).trim() === '') return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
}

function formatNumero(raw, decimali) {
    const n = numero(raw);
    if (n == null) return '';
    const rounded = Math.round(n * 10 ** decimali) / 10 ** decimali;
    if (decimali === 0 || Number.isInteger(rounded)) return String(rounded);
    return rounded.toLocaleString('it-IT', {
        minimumFractionDigits: decimali,
        maximumFractionDigits: decimali
    });
}

function formatEuro(raw) {
    const testo = formatNumero(raw, 2);
    return testo ? `${testo} €` : '';
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

function aggiornaIntestazione() {
    const sotto = document.getElementById('rif-sottotitolo');
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
    const el = document.getElementById('rif-messaggio');
    const wrap = document.getElementById('rif-tabella-wrap');
    const footer = document.getElementById('rif-footer');
    if (wrap) wrap.hidden = true;
    if (footer) footer.hidden = true;
    if (!el) return;
    el.hidden = false;
    el.textContent = testo;
    el.classList.toggle('rif-errore', Boolean(errore));
}

function messaggioErrore(err) {
    const testo = String(err?.message || err || '');
    if (/rifornimenti|schema cache|PGRST205|does not exist|42P01/i.test(testo)) {
        return 'La tabella Rifornimenti non è leggibile. Controlla che esista in Supabase e che l\'app possa leggerla.';
    }
    return `Non riesco a caricare i rifornimenti. ${testo}`;
}

function colonnaDaKey(key) {
    return COLONNE.find((col) => col.key === key) || null;
}

function valoreVisibile(row, col) {
    if (col.key === 'Mezzo') return testoMezzo(row);
    if (col.tipo === 'data') return formatData(campo(row, col.campo));
    if (col.tipo === 'euro') return formatEuro(campo(row, col.campo));
    if (col.tipo === 'numero') return formatNumero(campo(row, col.campo), col.decimali ?? 0);
    return String(campo(row, col.campo) ?? '').trim();
}

function valoreOrdinamento(row, col) {
    if (col.tipo === 'data') return chiaveData(campo(row, col.campo));
    if (col.tipo === 'numero' || col.tipo === 'euro') return numero(campo(row, col.campo));
    return valoreVisibile(row, col).toLocaleLowerCase('it');
}

function etichettaValore(visibile) {
    return visibile ? visibile : VUOTO;
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
    if (tipo === 'numero' || tipo === 'euro') return ['Dal più piccolo', 'Dal più grande'];
    return ['A → Z', 'Z → A'];
}

function creaIntestazioni() {
    const riga = document.getElementById('rif-intestazione');
    if (!riga || riga.dataset.pronta === '1') return;
    riga.dataset.pronta = '1';
    riga.innerHTML = COLONNE.map((col) => `
        <th>
            <div class="rif-th">
                <span>${escapeHtml(col.label)}</span>
                <button type="button" class="rif-filtro-btn" data-col="${escapeHtml(col.key)}" title="Ordina o filtra ${escapeHtml(col.label)}" aria-label="Ordina o filtra ${escapeHtml(col.label)}">▾</button>
            </div>
        </th>
    `).join('') + '<th class="rif-col-x"></th>';
    riga.addEventListener('click', (e) => {
        const btn = e.target.closest('.rif-filtro-btn');
        if (!btn) return;
        e.stopPropagation();
        apriMenu(btn.dataset.col, btn);
    });
}

function aggiornaBottoniIntestazione() {
    document.querySelectorAll('.rif-filtro-btn').forEach((btn) => {
        const key = btn.dataset.col;
        const col = colonnaDaKey(key);
        const ordinata = ordinamento.key === key;
        const filtrata = filtroAttivo(key);
        btn.classList.toggle('is-ordinato', ordinata);
        btn.classList.toggle('is-filtrato', filtrata);
        btn.classList.toggle('is-aperto', menuColonna === key);
        btn.textContent = ordinata ? (ordinamento.dir === 'asc' ? '▲' : '▼') : '▾';
        const azioni = [];
        if (ordinata) azioni.push(ordinamento.dir === 'asc' ? 'ordinata crescente' : 'ordinata decrescente');
        if (filtrata) azioni.push('filtro attivo');
        btn.title = azioni.length
            ? `${col?.label || key}: ${azioni.join(', ')}`
            : `Ordina o filtra ${col?.label || key}`;
    });
}

function dentroIntervalloData(row, col, filtro) {
    const iso = chiaveData(campo(row, col.campo));
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
        if (col.tipo === 'data') return dentroIntervalloData(row, col, filtro);
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
    if (col.tipo === 'numero' || col.tipo === 'euro') cmp = va - vb;
    else cmp = String(va).localeCompare(String(vb), 'it', { numeric: true, sensitivity: 'base' });
    if (cmp === 0) {
        cmp = (Number(campo(b, 'id')) || 0) - (Number(campo(a, 'id')) || 0);
        return cmp;
    }
    return ordinamento.dir === 'asc' ? cmp : -cmp;
}

function righeFiltrate() {
    return righeBase.filter(rigaVisibile).sort(confrontaRighe);
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
    const menu = document.getElementById('rif-menu');
    if (menu) menu.hidden = true;
    menuColonna = '';
    aggiornaBottoniIntestazione();
}

function posizionaMenu(bottone) {
    const menu = document.getElementById('rif-menu');
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
    const lista = document.getElementById('rif-menu-lista');
    const tutti = document.getElementById('rif-menu-tutti');
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
        vuoto.className = 'rif-menu-vuoto';
        vuoto.textContent = 'Nessun valore';
        lista.appendChild(vuoto);
    }
    mostrati.forEach((valore) => {
        const label = document.createElement('label');
        label.className = 'rif-menu-valore';
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
        extra.className = 'rif-menu-vuoto';
        extra.textContent = `Ci sono altri ${valori.length - MAX_VALORI_MENU} valori. Restringi con «Contiene».`;
        lista.appendChild(extra);
    }
    if (tutti) {
        tutti.checked = mostrati.length > 0 && mostrati.every((valore) => !filtro.esclusi || !filtro.esclusi.has(valore));
        tutti.indeterminate = !tutti.checked && mostrati.some((valore) => !filtro.esclusi || !filtro.esclusi.has(valore));
    }
}

function assicuraFiltro(key) {
    if (!filtriColonna[key]) {
        filtriColonna[key] = { testo: '', dal: '', al: '', esclusi: new Set() };
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
    const valori = document.getElementById('rif-menu-valori');
    const date = document.getElementById('rif-menu-date');
    if (valori) valori.hidden = Boolean(eData);
    if (date) date.hidden = !eData;
    if (!eData) return;
    const filtro = filtriColonna.Data;
    const dal = document.getElementById('rif-data-dal');
    const al = document.getElementById('rif-data-al');
    if (dal) dal.value = filtro?.dal || '';
    if (al) al.value = filtro?.al || '';
}

function aggiornaIntervalloDate() {
    if (menuColonna !== 'Data') return;
    const dalEl = document.getElementById('rif-data-dal');
    const alEl = document.getElementById('rif-data-al');
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
    const btnAsc = document.getElementById('rif-ordina-asc');
    const btnDesc = document.getElementById('rif-ordina-desc');
    if (btnAsc) {
        btnAsc.textContent = asc;
        btnAsc.classList.toggle('is-scelto', ordinamento.key === key && ordinamento.dir === 'asc');
    }
    if (btnDesc) {
        btnDesc.textContent = desc;
        btnDesc.classList.toggle('is-scelto', ordinamento.key === key && ordinamento.dir === 'desc');
    }
    const cerca = document.getElementById('rif-menu-cerca');
    const filtro = filtriColonna[key];
    if (cerca) cerca.value = filtro?.testo ? filtro.testo : '';
    mostraPannelloMenu();
    if (col.tipo !== 'data') disegnaListaValori();
    posizionaMenu(bottone);
    aggiornaBottoniIntestazione();
    if (col.tipo === 'data') document.getElementById('rif-data-dal')?.focus();
    else cerca?.focus();
}

function impostaOrdine(dir) {
    if (!menuColonna) return;
    ordinamento = { key: menuColonna, dir };
    const btnAsc = document.getElementById('rif-ordina-asc');
    const btnDesc = document.getElementById('rif-ordina-desc');
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
    const tutti = document.getElementById('rif-menu-tutti');
    const inputs = [...document.querySelectorAll('#rif-menu-lista input[type="checkbox"]')];
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
    document.querySelectorAll('#rif-menu-lista input[type="checkbox"]').forEach((input) => {
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
    const cerca = document.getElementById('rif-menu-cerca');
    if (cerca) cerca.value = '';
    const dal = document.getElementById('rif-data-dal');
    const al = document.getElementById('rif-data-al');
    if (dal) dal.value = '';
    if (al) al.value = '';
    if (colonnaDaKey(menuColonna)?.tipo !== 'data') disegnaListaValori();
    applicaVista();
}

function preparaMenu() {
    document.getElementById('rif-ordina-asc')?.addEventListener('click', () => impostaOrdine('asc'));
    document.getElementById('rif-ordina-desc')?.addEventListener('click', () => impostaOrdine('desc'));
    document.getElementById('rif-menu-azzera')?.addEventListener('click', azzeraFiltroColonna);
    document.getElementById('rif-menu-cerca')?.addEventListener('input', (e) => {
        if (menuColonna === 'Data') return;
        aggiornaTestoFiltro(e.target.value || '');
    });
    document.getElementById('rif-data-dal')?.addEventListener('change', aggiornaIntervalloDate);
    document.getElementById('rif-data-al')?.addEventListener('change', aggiornaIntervalloDate);
    document.getElementById('rif-menu-tutti')?.addEventListener('change', (e) => {
        selezionaVisibili(e.target.checked);
    });
    document.getElementById('rif-menu-lista')?.addEventListener('change', (e) => {
        const input = e.target.closest('input[type="checkbox"]');
        if (!input) return;
        cambiaValore(input.dataset.valore, input.checked);
    });
    document.addEventListener('click', (e) => {
        if (!menuColonna) return;
        if (e.target.closest('#rif-menu') || e.target.closest('.rif-filtro-btn')) return;
        chiudiMenu();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') chiudiMenu();
    });
    document.getElementById('rif-tabella-wrap')?.addEventListener('scroll', () => {
        if (menuColonna) chiudiMenu();
    });
}

function aggiornaFooter(righe) {
    const footer = document.getElementById('rif-footer');
    if (footer) footer.hidden = false;
    let litri = 0;
    let costo = 0;
    righe.forEach((row) => {
        const l = numero(campo(row, 'Litri'));
        const c = numero(campo(row, 'Costo_Rifornimento'));
        if (l != null) litri += l;
        if (c != null) costo += c;
    });
    const n = document.getElementById('rif-totale-n');
    const elLitri = document.getElementById('rif-totale-litri');
    const elCosto = document.getElementById('rif-totale-costo');
    if (n) n.textContent = String(righe.length);
    if (elLitri) elLitri.textContent = formatNumero(litri, 2) || '0';
    if (elCosto) elCosto.textContent = formatEuro(costo) || '0,00 €';
}

function disegnaRighe(righe) {
    const corpo = document.getElementById('rif-corpo');
    const wrap = document.getElementById('rif-tabella-wrap');
    const messaggio = document.getElementById('rif-messaggio');
    const stato = document.getElementById('rif-stato');
    if (!corpo) return;

    if (!righeBase.length) {
        mostraMessaggio(filtroMezzo
            ? 'Nessun rifornimento per questo mezzo.'
            : 'Nessun rifornimento.');
        if (stato) stato.textContent = '0 rifornimenti';
        return;
    }

    if (!righe.length) {
        corpo.innerHTML = '<tr><td class="rif-vuoto" colspan="9">Nessun rifornimento con questi filtri. Apri la colonna e premi «Azzera filtro».</td></tr>';
    } else {
        corpo.innerHTML = righe.map((row) => `
            <tr>
                ${COLONNE.map((col) => `<td class="${col.classe}">${escapeHtml(valoreVisibile(row, col))}</td>`).join('')}
                <td>${bottoneElimina(row)}</td>
            </tr>
        `).join('');
    }

    if (messaggio) messaggio.hidden = true;
    if (wrap) wrap.hidden = false;
    aggiornaFooter(righe);
    aggiornaBottoniIntestazione();
    if (stato) {
        if (righe.length === righeBase.length) {
            stato.textContent = righe.length === 1 ? '1 rifornimento' : `${righe.length} rifornimenti`;
        } else {
            stato.textContent = `${righe.length} di ${righeBase.length}`;
        }
    }
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

async function scaricaRighe() {
    await invoke('init_supabase_from_config').catch(() => {});
    if (filtroMezzo) {
        const filtrate = await invoke('get_rifornimenti', { mezzo: filtroMezzo });
        if (Array.isArray(filtrate) && filtrate.length) return filtrate;
        const tutti = await invoke('get_rifornimenti');
        return (Array.isArray(tutti) ? tutti : []).filter((row) => stessoMezzo(campo(row, 'Mezzo'), filtroMezzo));
    }
    const tutti = await invoke('get_rifornimenti');
    return Array.isArray(tutti) ? tutti : [];
}

async function carica() {
    chiudiMenu();
    aggiornaIntestazione();
    mostraMessaggio('Caricamento rifornimenti…');
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
        const stato = document.getElementById('rif-stato');
        if (stato) stato.textContent = '';
    }
}

function mostraTutti() {
    filtroMezzo = '';
    etichettaFiltro = '';
    filtriColonna = {};
    ordinamento = { key: 'Data', dir: 'desc' };
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
            console.warn('Chiusura finestra rifornimenti:', err);
        }
    }
    if (window.opener) {
        window.close();
        return;
    }
    window.location.href = 'ELENCOMEZZI.html';
}

let idDaEliminare = null;
let salvataggioInCorso = false;

function escapeAttr(testo) {
    return escapeHtml(testo).replace(/"/g, '&quot;');
}

function isTruthyFlag(valore) {
    const s = String(valore ?? '').trim().toLowerCase();
    return s === '1' || s === 'true' || s === 'si' || s === 'sì' || s === 'yes' || s === 'y';
}

function oggiIso() {
    const d = new Date();
    const mese = String(d.getMonth() + 1).padStart(2, '0');
    const giorno = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${mese}-${giorno}`;
}

function riempiSelect(select, opzioni, voceVuota) {
    if (!select) return;
    const pezzi = [`<option value="">${voceVuota}</option>`];
    opzioni.forEach((op) => {
        const value = String(op.value ?? '').trim();
        const label = String(op.label ?? value).trim();
        if (!value || !label) return;
        pezzi.push(`<option value="${escapeAttr(value)}">${escapeHtml(label)}</option>`);
    });
    select.innerHTML = pezzi.join('');
}

function bottoneElimina(row) {
    const id = String(campo(row, 'id') ?? '').trim();
    const descrizione = [
        formatData(campo(row, 'Data_Rifornimento')),
        testoMezzo(row),
        String(campo(row, 'Distributore') ?? '').trim()
    ].filter(Boolean).join(' — ');
    return `<button type="button" class="rif-x" data-id="${escapeAttr(id)}" data-desc="${escapeAttr(descrizione)}" title="Elimina" aria-label="Elimina rifornimento">X</button>`;
}

function mostraErroreNuovo(testo) {
    const el = document.getElementById('rif-errore');
    if (!el) return;
    el.textContent = testo || '';
    el.hidden = !testo;
}

function aggiornaNuovoDistributore() {
    const scelta = document.getElementById('rif-distributore-scelta');
    const wrap = document.getElementById('rif-nuovo-wrap');
    wrap.hidden = scelta?.value !== '__nuovo__';
}

function opzioniMezzi() {
    return automezzi
        .map((mezzo) => {
            const value = chiave(mezzo.id);
            if (!value) return null;
            return { value, label: etichettaMezzo(mezzo) || `Mezzo ${value}` };
        })
        .filter(Boolean)
        .sort((a, b) => a.label.localeCompare(b.label, 'it'));
}

async function opzioniOperatori() {
    const lista = await invoke('get_all_tesserati');
    return (Array.isArray(lista) ? lista : [])
        .filter((persona) => isTruthyFlag(persona?.operatore))
        .map((persona) => {
            const label = String(persona?.nominativo || '').trim();
            if (!label) return null;
            return { value: label, label };
        })
        .filter(Boolean)
        .sort((a, b) => a.label.localeCompare(b.label, 'it'));
}

async function opzioniDistributori() {
    const tutti = await invoke('get_rifornimenti');
    const visti = new Set();
    const nomi = [];
    (Array.isArray(tutti) ? tutti : []).forEach((row) => {
        const nome = String(campo(row, 'Distributore') ?? '').trim();
        const chiaveNome = nome.toLocaleLowerCase('it');
        if (!nome || visti.has(chiaveNome)) return;
        visti.add(chiaveNome);
        nomi.push(nome);
    });
    nomi.sort((a, b) => a.localeCompare(b, 'it'));
    return nomi.map((nome) => ({ value: nome, label: nome }));
}

async function apriNuovo() {
    const overlay = document.getElementById('rif-nuovo-overlay');
    if (!overlay || !invoke) return;
    mostraErroreNuovo('');
    const data = document.getElementById('rif-data');
    if (data) data.value = oggiIso();
    ['rif-km', 'rif-litri', 'rif-costo', 'rif-note', 'rif-distributore-nuovo'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    riempiSelect(document.getElementById('rif-mezzo'), opzioniMezzi(), 'Scegli il mezzo…');
    if (filtroMezzo) {
        const mezzo = document.getElementById('rif-mezzo');
        if (mezzo) mezzo.value = filtroMezzo;
    }
    try {
        riempiSelect(document.getElementById('rif-operatore'), await opzioniOperatori(), 'Scegli l’operatore…');
        const distributori = await opzioniDistributori();
        distributori.push({ value: '__nuovo__', label: 'Aggiungi nuovo…' });
        const select = document.getElementById('rif-distributore-scelta');
        riempiSelect(select, distributori, 'Scegli…');
        if (distributori.length === 1) select.value = '__nuovo__';
        aggiornaNuovoDistributore();
    } catch (err) {
        console.error(err);
        mostraErroreNuovo('Non riesco a caricare mezzi o operatori.');
    }
    overlay.hidden = false;
}

function chiudiNuovo() {
    const overlay = document.getElementById('rif-nuovo-overlay');
    if (overlay) overlay.hidden = true;
    mostraErroreNuovo('');
}

function numeroOppureVuoto(raw) {
    const testo = String(raw ?? '').trim().replace(',', '.');
    if (!testo) return { ok: true, valore: null };
    const n = Number(testo);
    if (!Number.isFinite(n) || n < 0) return { ok: false, valore: null };
    return { ok: true, valore: n };
}

function distributoreScelto() {
    const scelta = String(document.getElementById('rif-distributore-scelta')?.value || '').trim();
    if (scelta === '__nuovo__') {
        return String(document.getElementById('rif-distributore-nuovo')?.value || '').trim();
    }
    return scelta;
}

async function salvaNuovo() {
    if (salvataggioInCorso || !invoke) return;
    mostraErroreNuovo('');
    const data = String(document.getElementById('rif-data')?.value || '').trim();
    const mezzo = String(document.getElementById('rif-mezzo')?.value || '').trim();
    const operatore = String(document.getElementById('rif-operatore')?.value || '').trim();
    const distributore = distributoreScelto();
    const km = numeroOppureVuoto(document.getElementById('rif-km')?.value);
    const litri = numeroOppureVuoto(document.getElementById('rif-litri')?.value);
    const costo = numeroOppureVuoto(document.getElementById('rif-costo')?.value);
    const note = String(document.getElementById('rif-note')?.value || '').trim();

    if (!data) return mostraErroreNuovo('Indica la data.');
    if (!mezzo) return mostraErroreNuovo('Scegli il mezzo.');
    if (!operatore) return mostraErroreNuovo('Scegli l’operatore.');
    if (!distributore) return mostraErroreNuovo('Scegli un distributore, oppure scrivine uno nuovo.');
    if (!km.ok || !litri.ok || !costo.ok) {
        return mostraErroreNuovo('Km, litri e costo devono essere numeri, oppure lascia la casella vuota.');
    }

    const btn = document.getElementById('rif-btn-salva');
    salvataggioInCorso = true;
    if (btn) btn.disabled = true;
    try {
        await invoke('create_rifornimento', {
            payload: {
                data,
                mezzo,
                operatore,
                distributore,
                km: km.valore,
                litri: litri.valore,
                costo: costo.valore,
                note: note || null
            }
        });
        chiudiNuovo();
        await carica();
        const stato = document.getElementById('rif-stato');
        if (stato) stato.textContent = 'Rifornimento salvato';
    } catch (err) {
        console.error(err);
        mostraErroreNuovo(String(err?.message || err || 'Non riesco a salvare.'));
    } finally {
        salvataggioInCorso = false;
        if (btn) btn.disabled = false;
    }
}

function chiediEliminazione(id, descrizione) {
    idDaEliminare = id;
    const testo = document.getElementById('rif-conferma-testo');
    if (testo) testo.textContent = descrizione || 'Questa riga verrà tolta dall’elenco.';
    const overlay = document.getElementById('rif-conferma-overlay');
    if (overlay) overlay.hidden = false;
}

function chiudiConferma() {
    idDaEliminare = null;
    const overlay = document.getElementById('rif-conferma-overlay');
    if (overlay) overlay.hidden = true;
}

async function confermaEliminazione() {
    if (!invoke || idDaEliminare == null) return;
    const id = Number(idDaEliminare);
    const btn = document.getElementById('rif-conferma-ok');
    if (btn) btn.disabled = true;
    try {
        await invoke('delete_rifornimento', { id });
        chiudiConferma();
        await carica();
        const stato = document.getElementById('rif-stato');
        if (stato) stato.textContent = 'Rifornimento eliminato';
    } catch (err) {
        console.error(err);
        chiudiConferma();
        const stato = document.getElementById('rif-stato');
        if (stato) stato.textContent = 'Non riesco a eliminare il rifornimento.';
    } finally {
        if (btn) btn.disabled = false;
    }
}

document.getElementById('btn-nuovo-rifornimento')?.addEventListener('click', () => {
    apriNuovo();
});
document.getElementById('rif-nuovo-chiudi')?.addEventListener('click', chiudiNuovo);
document.getElementById('rif-btn-annulla')?.addEventListener('click', chiudiNuovo);
document.getElementById('rif-btn-salva')?.addEventListener('click', salvaNuovo);
document.getElementById('rif-distributore-scelta')?.addEventListener('change', aggiornaNuovoDistributore);
document.getElementById('rif-nuovo-overlay')?.addEventListener('click', (event) => {
    if (event.target?.id === 'rif-nuovo-overlay') chiudiNuovo();
});
document.getElementById('rif-conferma-annulla')?.addEventListener('click', chiudiConferma);
document.getElementById('rif-conferma-ok')?.addEventListener('click', confermaEliminazione);
document.getElementById('rif-conferma-overlay')?.addEventListener('click', (event) => {
    if (event.target?.id === 'rif-conferma-overlay') chiudiConferma();
});
document.getElementById('rif-corpo')?.addEventListener('click', (event) => {
    const btn = event.target.closest('.rif-x');
    if (!btn) return;
    const id = String(btn.dataset.id || '').trim();
    if (!id) return;
    chiediEliminazione(id, btn.dataset.desc || '');
});

document.getElementById('btn-mostra-tutti')?.addEventListener('click', mostraTutti);
document.getElementById('btn-torna')?.addEventListener('click', () => {
    tornaElencoMezzi();
});

creaIntestazioni();
preparaMenu();
leggiFiltroDaUrl();
initTauri().then(() => carica());
