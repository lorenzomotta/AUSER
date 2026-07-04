// Report Settimanale — servizi per operatore e giorno (Supabase via Tauri)
let invoke;

const GIORNI = [
    { key: 1, label: 'LUNEDI' },
    { key: 2, label: 'MARTEDI' },
    { key: 3, label: 'MERCOLEDI' },
    { key: 4, label: 'GIOVEDI' },
    { key: 5, label: 'VENERDI' },
    { key: 6, label: 'SABATO' },
    { key: 0, label: 'DOMENICA' }
];

let lunediSettimana = null;
const serviziAnnoCache = {};
let rubricaTelefoniCache = null;

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

function formatDataItaliana(date) {
    return `${pad2(date.getDate())}/${pad2(date.getMonth() + 1)}/${date.getFullYear()}`;
}

function escapeHtml(str) {
    if (str === undefined || str === null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function normNome(nome) {
    return (nome || '').trim().toUpperCase().replace(/\s+/g, ' ');
}

function getLunediSettimana(date) {
    const d = new Date(date);
    const giorno = d.getDay();
    const diff = giorno === 0 ? -6 : 1 - giorno;
    d.setDate(d.getDate() + diff);
    d.setHours(0, 0, 0, 0);
    return d;
}

function aggiungiGiorni(date, n) {
    const d = new Date(date);
    d.setDate(d.getDate() + n);
    return d;
}

function getNumeroSettimanaISO(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const day = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

function getGiorniSettimana(lunedi) {
    const ordine = [1, 2, 3, 4, 5, 6, 0];
    return ordine.map((dayOfWeek, i) => {
        const data = aggiungiGiorni(lunedi, i);
        return {
            dayOfWeek,
            label: GIORNI.find(g => g.key === dayOfWeek)?.label || '',
            data,
            dataStr: formatDataItaliana(data)
        };
    });
}

function minutiDaOra(oraStr) {
    if (!oraStr || typeof oraStr !== 'string') return 0;
    const p = oraStr.trim().split(':');
    if (p.length < 2) return 0;
    const h = parseInt(p[0], 10);
    const m = parseInt(p[1], 10);
    if (Number.isNaN(h) || Number.isNaN(m)) return 0;
    return h * 60 + m;
}

async function fetchServiziAnno(anno) {
    if (serviziAnnoCache[anno]) return serviziAnnoCache[anno];
    if (!isTauri() || !invoke) {
        serviziAnnoCache[anno] = [];
        return [];
    }
    await invoke('init_supabase_from_config').catch(() => {});
    const servizi = await invoke('get_all_servizi_completi', { anno, tuttiAnni: false });
    serviziAnnoCache[anno] = Array.isArray(servizi) ? servizi : [];
    return serviziAnnoCache[anno];
}

function normNomeSemplice(nome) {
    return normNome(nome).replace(/[''`´]/g, '');
}

function trovaTelefonoOperatore(nomeOperatore, rubrica) {
    const norm = normNome(nomeOperatore);
    const semplice = normNomeSemplice(nomeOperatore);
    if (!norm || !rubrica.length) return '';

    let entry = rubrica.find(r => r.nomeNorm === norm);
    if (entry) return entry.telefono;

    entry = rubrica.find(r => r.nomeSemplice === semplice);
    if (entry) return entry.telefono;

    entry = rubrica.find(r => norm.includes(r.nomeNorm) || r.nomeNorm.includes(norm));
    if (entry) return entry.telefono;

    return '';
}

async function fetchRubricaTelefoni() {
    if (rubricaTelefoniCache) return rubricaTelefoniCache;
    if (!isTauri() || !invoke) {
        rubricaTelefoniCache = [];
        return [];
    }
    await invoke('init_supabase_from_config').catch(() => {});
    const tesserati = await invoke('get_all_tesserati');
    const lista = Array.isArray(tesserati) ? tesserati : [];
    rubricaTelefoniCache = lista
        .map(t => ({
            nomeNorm: normNome(t.nominativo),
            nomeSemplice: normNomeSemplice(t.nominativo),
            telefono: (t.telefono || '').trim()
        }))
        .filter(e => e.nomeNorm && e.telefono);
    return rubricaTelefoniCache;
}

async function caricaServiziSettimana(giorni) {
    const dateSet = new Set(giorni.map(g => g.dataStr));
    const anni = [...new Set(giorni.map(g => g.data.getFullYear()))];
    const risultati = await Promise.all(anni.map(a => fetchServiziAnno(a)));
    const tutti = risultati.flat();
    return tutti.filter(s => dateSet.has((s.data_prelievo || '').trim()));
}

function indiceGiornoDaData(dataStr, giorni) {
    const idx = giorni.findIndex(g => g.dataStr === dataStr);
    return idx >= 0 ? idx : -1;
}

function costruisciGriglia(servizi, giorni, rubrica) {
    const righeMap = new Map();

    servizi.forEach(servizio => {
        const nomeOp = (servizio.operatore || '').trim();
        if (!nomeOp) return;
        const nomeNorm = normNome(nomeOp);
        const idx = indiceGiornoDaData((servizio.data_prelievo || '').trim(), giorni);
        if (idx < 0) return;

        if (!righeMap.has(nomeNorm)) {
            righeMap.set(nomeNorm, {
                nome: nomeOp,
                telefono: trovaTelefonoOperatore(nomeOp, rubrica),
                celle: Array.from({ length: 7 }, () => [])
            });
        }

        const trasportato = (servizio.socio_trasportato || '').trim();
        if (!trasportato) return;

        righeMap.get(nomeNorm).celle[idx].push({
            trasportato,
            ora: servizio.ora_inizio || ''
        });
    });

    return [...righeMap.values()]
        .filter(r => r.celle.some(c => c.length > 0))
        .sort((a, b) => a.nome.localeCompare(b.nome, 'it', { sensitivity: 'base' }));
}

function renderIntestazione(giorni, numeroSettimana) {
    const thead = document.getElementById('report-thead');
    if (!thead) return;

    let html = '<tr>';
    html += `<th class="th-settimana">
        <span class="th-label">Settimana</span>
        <span class="th-value">${numeroSettimana}</span>
    </th>`;

    giorni.forEach(g => {
        html += `<th class="th-giorno">
            <span class="th-label">${g.label}</span>
            <span class="th-value">${g.dataStr}</span>
        </th>`;
    });
    html += '</tr>';
    thead.innerHTML = html;
}

function renderCorpo(righe) {
    const tbody = document.getElementById('report-tbody');
    if (!tbody) return;

    if (righe.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" style="padding:20px;text-align:center;">Nessun servizio in questa settimana.</td></tr>`;
        return;
    }

    tbody.innerHTML = righe.map(riga => {
        const celleHtml = riga.celle.map(items => {
            if (!items.length) {
                return '<td class="day-cell"></td>';
            }
            const sorted = [...items].sort((a, b) => minutiDaOra(a.ora) - minutiDaOra(b.ora));
            const contenuto = sorted
                .map(it => `<span class="servizio-item">${escapeHtml(it.trasportato)}</span>`)
                .join('');
            return `<td class="day-cell">${contenuto}</td>`;
        }).join('');

        return `<tr>
            <td class="op-cell">
                <div class="op-nome">${escapeHtml(riga.nome)}</div>
                <div class="op-tel">${riga.telefono ? escapeHtml(riga.telefono) : ''}</div>
            </td>
            ${celleHtml}
        </tr>`;
    }).join('');
}

function aggiornaRangeStampa(giorni) {
    const el = document.getElementById('report-range-label');
    if (!el || !giorni.length) return;
    el.textContent = `${giorni[0].dataStr} — ${giorni[6].dataStr}`;
}

function setLoading(visible) {
    const el = document.getElementById('report-loading');
    if (el) el.style.display = visible ? 'block' : 'none';
}

async function caricaReport() {
    if (!lunediSettimana) {
        lunediSettimana = getLunediSettimana(new Date());
    }

    const giorni = getGiorniSettimana(lunediSettimana);
    const numeroSettimana = getNumeroSettimanaISO(giorni[3].data);

    setLoading(true);
    aggiornaRangeStampa(giorni);

    try {
        const [servizi, rubrica] = await Promise.all([
            caricaServiziSettimana(giorni),
            fetchRubricaTelefoni()
        ]);
        const righe = costruisciGriglia(servizi, giorni, rubrica);
        renderIntestazione(giorni, numeroSettimana);
        renderCorpo(righe);
    } catch (error) {
        console.error(error);
        const tbody = document.getElementById('report-tbody');
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="8" style="padding:20px;color:red;">Errore: ${escapeHtml(error.message || error)}</td></tr>`;
        }
    } finally {
        setLoading(false);
    }
}

function vaiSettimanaCorrente() {
    lunediSettimana = getLunediSettimana(new Date());
    caricaReport();
}

function vaiSettimanaPrecedente() {
    if (!lunediSettimana) lunediSettimana = getLunediSettimana(new Date());
    lunediSettimana = aggiungiGiorni(lunediSettimana, -7);
    caricaReport();
}

function vaiSettimanaSuccessiva() {
    if (!lunediSettimana) lunediSettimana = getLunediSettimana(new Date());
    lunediSettimana = aggiungiGiorni(lunediSettimana, 7);
    caricaReport();
}

function setupEventListeners() {
    document.getElementById('btn-sett-prec')?.addEventListener('click', vaiSettimanaPrecedente);
    document.getElementById('btn-sett-corr')?.addEventListener('click', vaiSettimanaCorrente);
    document.getElementById('btn-sett-succ')?.addEventListener('click', vaiSettimanaSuccessiva);

    document.getElementById('btn-stampa')?.addEventListener('click', () => window.print());

    document.getElementById('btn-chiudi')?.addEventListener('click', async () => {
        if (isTauri()) {
            try {
                const { getCurrent } = await import('@tauri-apps/api/window');
                const win = getCurrent();
                if (win?.label === 'report-settimanale') {
                    await win.close();
                    return;
                }
            } catch (e) {
                console.warn(e);
            }
        }
        if (window.opener) {
            window.close();
        } else {
            window.location.href = 'index.html';
        }
    });
}

document.addEventListener('DOMContentLoaded', async () => {
    await initTauri();
    lunediSettimana = getLunediSettimana(new Date());
    setupEventListeners();
    await caricaReport();
});
