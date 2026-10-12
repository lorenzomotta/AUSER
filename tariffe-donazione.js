/**
 * Importi dei due pulsanti donazione (Nuovo servizio e Modifica servizio).
 * I valori stanno in Impostazioni_supa, righe "TARIFFA 1" e "TARIFFA 2".
 */

const DEFAULT_TARIFFA_1 = 10;
const DEFAULT_TARIFFA_2 = 15;

let cache = null;

function parseImportoIt(valore) {
    let s = String(valore ?? '').replace(/€/g, '').replace(/\s/g, '');
    if (!s) return null;
    if (s.includes(',')) {
        s = s.replace(/\./g, '').replace(',', '.');
    }
    const n = parseFloat(s);
    return Number.isFinite(n) && n >= 0 ? n : null;
}

function chiaveImpostazione(nome) {
    return String(nome || '').trim().toLowerCase().replace(/[\s_]+/g, '');
}

export function testoPulsanteTariffa(importo) {
    const n = Number(importo);
    const sicuro = Number.isFinite(n) ? n : 0;
    const parti = sicuro.toFixed(2).split('.');
    parti[0] = parti[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return `${parti[0]},${parti[1]} €.`;
}

export function leggiTariffeDaRighe(rows) {
    const out = { tariffa1: DEFAULT_TARIFFA_1, tariffa2: DEFAULT_TARIFFA_2 };
    if (!Array.isArray(rows)) return out;

    for (const row of rows) {
        const chiave = chiaveImpostazione(row?.impostazione);
        const importo = parseImportoIt(row?.valore);
        if (importo == null) continue;
        if (chiave === 'tariffa1') out.tariffa1 = importo;
        if (chiave === 'tariffa2') out.tariffa2 = importo;
    }
    return out;
}

export function getTariffeDonazione() {
    return cache || { tariffa1: DEFAULT_TARIFFA_1, tariffa2: DEFAULT_TARIFFA_2 };
}

export async function ensureTariffeDonazione(invoke) {
    if (cache) return cache;
    if (!invoke) return getTariffeDonazione();

    try {
        await invoke('init_supabase_from_config').catch(() => {});
        const rows = await invoke('get_all_impostazioni');
        cache = leggiTariffeDaRighe(rows);
        return cache;
    } catch (err) {
        console.warn('Tariffe donazione non disponibili, uso 10 e 15:', err);
        return getTariffeDonazione();
    }
}
