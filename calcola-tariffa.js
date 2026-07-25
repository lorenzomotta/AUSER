/**
 * Modale Calcola tariffa — condiviso tra Nuovo servizio e Modifica servizio.
 * Totale = (costo_km × chilometri) + pedaggio + extra
 * Campi vuoti contano come 0.
 */

const DEFAULT_COSTO_KM = 0.7;
const MARKUP_ID = 'ct-dialog-calcola-tariffa';

const MARKUP = `
<div id="${MARKUP_ID}" class="ns-dialog-overlay ct-dialog-overlay" hidden aria-hidden="true">
    <div class="ns-dialog ct-dialog" role="dialog" aria-modal="true" aria-labelledby="ct-dialog-titolo">
        <h2 id="ct-dialog-titolo" class="ct-dialog-titolo">CALCOLA TARIFFA</h2>
        <div class="ct-dialog-campi">
            <div class="ct-field">
                <label for="ct-costo-km">COSTO AL KM</label>
                <input type="text" id="ct-costo-km" class="ns-input" inputmode="decimal" autocomplete="off" placeholder="es. 0,70">
            </div>
            <div class="ct-field">
                <label for="ct-pedaggio">PEDAGGIO AUTOSTRADALE</label>
                <input type="text" id="ct-pedaggio" class="ns-input" inputmode="decimal" autocomplete="off" placeholder="es. 5,00">
            </div>
            <div class="ct-field">
                <label for="ct-extra">EXTRA</label>
                <input type="text" id="ct-extra" class="ns-input" inputmode="decimal" autocomplete="off" placeholder="es. 0,00">
            </div>
            <div class="ct-field">
                <label for="ct-chilometri">CHILOMETRI</label>
                <input type="text" id="ct-chilometri" class="ns-input" inputmode="decimal" autocomplete="off" placeholder="es. 40">
            </div>
            <div class="ct-field ct-field-totale">
                <label for="ct-totale">TOTALE</label>
                <output id="ct-totale" class="ct-totale-valore" for="ct-costo-km ct-pedaggio ct-extra ct-chilometri">0,00 €</output>
            </div>
        </div>
        <div class="ns-dialog-actions ct-dialog-actions">
            <button type="button" id="ct-btn-conferma" class="ns-dialog-btn ns-dialog-btn-si">CONFERMA</button>
            <button type="button" id="ct-btn-annulla" class="ns-dialog-btn ns-dialog-btn-no">ANNULLA</button>
        </div>
    </div>
</div>`;

let listenersAttivi = false;
let onConfermaCorrente = null;

function parseNumeroIt(valore) {
    if (valore === undefined || valore === null) return 0;
    const pulito = String(valore)
        .trim()
        .replace(/€/g, '')
        .replace(/\s/g, '')
        .replace(/\./g, '')
        .replace(',', '.');
    if (!pulito) return 0;
    const n = parseFloat(pulito);
    return Number.isNaN(n) ? 0 : n;
}

function formatEuroIt(valore) {
    const n = Number(valore);
    const sicuro = Number.isNaN(n) ? 0 : n;
    const parti = sicuro.toFixed(2).split('.');
    parti[0] = parti[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return `${parti[0]},${parti[1]} €`;
}

function formatNumeroIt(valore, decimals = 2) {
    const n = Number(valore);
    const sicuro = Number.isNaN(n) ? 0 : n;
    return sicuro.toFixed(decimals).replace('.', ',');
}

function escapeHtmlCt(str) {
    if (str === undefined || str === null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function leggiDettaglioCorrente() {
    const costoKm = parseNumeroIt(document.getElementById('ct-costo-km')?.value);
    const pedaggio = parseNumeroIt(document.getElementById('ct-pedaggio')?.value);
    const extra = parseNumeroIt(document.getElementById('ct-extra')?.value);
    const km = parseNumeroIt(document.getElementById('ct-chilometri')?.value);
    const costo = costoKm * km;
    const totale = costo + pedaggio + extra;
    return {
        costo_km: formatNumeroIt(costoKm, 2),
        pedaggio: formatNumeroIt(pedaggio, 2),
        extra: formatNumeroIt(extra, 2),
        chilometri: formatNumeroIt(km, km % 1 === 0 ? 0 : 1),
        costo: formatNumeroIt(costo, 2),
        totale: formatEuroIt(totale),
        totale_numero: totale
    };
}

function calcolaTotaleCorrente() {
    return leggiDettaglioCorrente().totale_numero;
}

function aggiornaTotaleLive() {
    const out = document.getElementById('ct-totale');
    if (out) out.textContent = formatEuroIt(calcolaTotaleCorrente());
}

function chiudiModale() {
    const overlay = document.getElementById(MARKUP_ID);
    if (!overlay) return;
    overlay.hidden = true;
    overlay.setAttribute('aria-hidden', 'true');
    onConfermaCorrente = null;
}

function setupListenersUnaVolta() {
    if (listenersAttivi) return;
    const overlay = document.getElementById(MARKUP_ID);
    if (!overlay) return;
    listenersAttivi = true;

    ['ct-costo-km', 'ct-pedaggio', 'ct-extra', 'ct-chilometri'].forEach((id) => {
        document.getElementById(id)?.addEventListener('input', aggiornaTotaleLive);
        document.getElementById(id)?.addEventListener('change', aggiornaTotaleLive);
    });

    document.getElementById('ct-btn-conferma')?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const dettaglio = leggiDettaglioCorrente();
        const cb = onConfermaCorrente;
        chiudiModale();
        if (typeof cb === 'function') {
            cb(dettaglio.totale_numero, dettaglio);
        }
    });

    document.getElementById('ct-btn-annulla')?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        chiudiModale();
    });

    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) chiudiModale();
    });

    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        const el = document.getElementById(MARKUP_ID);
        if (el && !el.hidden) chiudiModale();
    });
}

export function ensureCalcolaTariffaMarkup() {
    if (!document.getElementById(MARKUP_ID)) {
        document.body.insertAdjacentHTML('beforeend', MARKUP);
    }
    setupListenersUnaVolta();
}

export function normalizzaPayloadTariffa(payload) {
    if (!payload || typeof payload !== 'object') return null;
    return {
        costo_km: payload.costo_km ?? '',
        pedaggio: payload.pedaggio ?? '',
        extra: payload.extra ?? '',
        chilometri: payload.chilometri ?? payload.km ?? '',
        costo: payload.costo ?? '',
        totale: payload.totale ?? ''
    };
}

export function htmlContenutoRiepilogoTariffa(payload) {
    const t = normalizzaPayloadTariffa(payload);
    if (!t) return '';
    const campi = [
        { label: '€/KM', value: t.costo_km },
        { label: 'KM', value: t.chilometri },
        { label: 'COSTO', value: t.costo },
        { label: 'PEDAGGIO', value: t.pedaggio },
        { label: 'EXTRA', value: t.extra },
        { label: 'TOTALE', value: t.totale }
    ];
    return `
        <div class="ns-tratta-selezionata-titolo">Tariffa calcolata</div>
        <div class="ns-tratta-selezionata-dati">
            <div class="ns-tratta-selezionata-grid">
                ${campi.map((c) => `
                    <div class="ns-tratta-campo">
                        <span class="ns-tratta-campo-label">${escapeHtmlCt(c.label)}</span>
                        <span class="ns-tratta-campo-val">${escapeHtmlCt(c.value ?? '')}</span>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
}

/** Blocco HTML (hidden + box) da inserire nel form */
export function htmlBloccoRiepilogoTariffa(payload = null, { hiddenId = 'ns-tariffa-calcolata' } = {}) {
    const t = normalizzaPayloadTariffa(payload);
    const has = !!t && String(t.totale || '').trim() !== '';
    const jsonAttr = has ? escapeHtmlCt(JSON.stringify(t)) : '';
    return `
        <input type="hidden" id="${escapeHtmlCt(hiddenId)}" value="${jsonAttr}">
        <div class="ns-tratta-selezionata ns-tariffa-calcolata" id="${escapeHtmlCt(hiddenId)}-box" ${has ? '' : 'hidden'}>
            ${has ? htmlContenutoRiepilogoTariffa(t) : ''}
        </div>
    `;
}

export function applicaRiepilogoTariffaNelDom(payload, {
    hiddenId = 'ns-tariffa-calcolata',
    boxId = null
} = {}) {
    const t = normalizzaPayloadTariffa(payload);
    const hidden = document.getElementById(hiddenId);
    const box = document.getElementById(boxId || `${hiddenId}-box`);
    if (hidden) {
        hidden.value = t && String(t.totale || '').trim() !== '' ? JSON.stringify(t) : '';
    }
    if (!box) return;
    if (!t || String(t.totale || '').trim() === '') {
        box.hidden = true;
        box.innerHTML = '';
        return;
    }
    box.innerHTML = htmlContenutoRiepilogoTariffa(t);
    box.hidden = false;
}

export function rimuoviRiepilogoTariffaDalForm(hiddenId = 'ns-tariffa-calcolata') {
    const aveva = Boolean(document.getElementById(hiddenId)?.value?.trim());
    applicaRiepilogoTariffaNelDom(null, { hiddenId });
    return aveva ? true : null;
}

export const CT_START = '[[CT]]';
export const CT_END = '[[/CT]]';

/** Estrae JSON tariffa dalle note e restituisce note senza marker */
export function parseTariffaDaNote(noteFine) {
    const raw = String(noteFine || '');
    const re = /\[\[CT\]\]([\s\S]*?)\[\[\/CT\]\]/;
    const m = raw.match(re);
    if (!m) {
        return { tariffa: null, notePulite: raw };
    }
    let tariffa = null;
    try {
        tariffa = normalizzaPayloadTariffa(JSON.parse(m[1].trim()));
    } catch (_) {
        tariffa = null;
    }
    const notePulite = raw.replace(re, '').replace(/^\s*\n/, '').trim();
    return { tariffa, notePulite };
}

/** Inserisce (o rimuove) il marker tariffa nelle note fine servizio */
export function mergeTariffaInNote(noteFine, tariffaObj) {
    const { notePulite } = parseTariffaDaNote(noteFine);
    const t = normalizzaPayloadTariffa(tariffaObj);
    if (!t || String(t.totale || '').trim() === '') {
        return notePulite;
    }
    const json = JSON.stringify(t);
    if (!json || json === '{}' || json === 'null') {
        return notePulite;
    }
    const blocco = `${CT_START}${json}${CT_END}`;
    return notePulite ? `${blocco}\n${notePulite}` : blocco;
}

export function leggiTariffaDalDom(hiddenId = 'ns-tariffa-calcolata') {
    const el = document.getElementById(hiddenId);
    if (!el?.value?.trim()) return null;
    try {
        return normalizzaPayloadTariffa(JSON.parse(el.value));
    } catch (_) {
        return null;
    }
}

async function caricaValoriDaImpostazioni(getInvoke, isTauri) {
    const defaults = { costoKm: DEFAULT_COSTO_KM, extra: 0 };
    try {
        if (!isTauri?.() || !getInvoke) return defaults;
        const inv = typeof getInvoke === 'function' ? getInvoke() : null;
        if (!inv) return defaults;
        await inv('init_supabase_from_config').catch(() => {});
        const rows = await inv('get_all_impostazioni');
        if (!Array.isArray(rows)) return defaults;

        const trova = (...nomi) => {
            const set = new Set(nomi.map((n) => String(n).trim().toLowerCase()));
            const row = rows.find((r) => set.has(String(r?.impostazione || '').trim().toLowerCase()));
            if (!row) return null;
            return parseNumeroIt(row.valore);
        };

        const costoKmRaw = trova('CostoAlKm', 'Costo al km', 'CostoKm');
        const extraRaw = trova('Extra', 'ExtraTariffa', 'CostoExtra', 'TariffaExtra');

        return {
            costoKm: costoKmRaw != null && costoKmRaw > 0 ? costoKmRaw : DEFAULT_COSTO_KM,
            extra: extraRaw != null ? extraRaw : 0
        };
    } catch (err) {
        console.warn('Calcola tariffa: impostazioni non disponibili', err);
        return defaults;
    }
}

/**
 * Apre il modale Calcola tariffa.
 * @param {object} options
 * @param {(totale: number, dettaglio: object) => void} options.onConferma
 */
export async function apriCalcolaTariffa(options = {}) {
    ensureCalcolaTariffaMarkup();
    const overlay = document.getElementById(MARKUP_ID);
    if (!overlay) return;

    onConfermaCorrente = typeof options.onConferma === 'function' ? options.onConferma : null;

    const daImpostazioni = await caricaValoriDaImpostazioni(options.getInvoke, options.isTauri);

    let costoKm = options.costoKmIniziale;
    if (costoKm === undefined || costoKm === null || String(costoKm).trim() === '') {
        costoKm = daImpostazioni.costoKm;
    } else {
        costoKm = parseNumeroIt(costoKm);
    }

    let extra = options.extraIniziale;
    if (extra === undefined || extra === null || String(extra).trim() === '') {
        extra = daImpostazioni.extra;
    } else {
        extra = parseNumeroIt(extra);
    }

    const setVal = (id, v) => {
        const el = document.getElementById(id);
        if (el) el.value = v;
    };

    setVal('ct-costo-km', formatNumeroIt(costoKm, 2));
    setVal('ct-pedaggio', '');
    setVal('ct-extra', formatNumeroIt(extra, 2));
    const kmInit = options.chilometriIniziali;
    setVal(
        'ct-chilometri',
        kmInit !== undefined && kmInit !== null && String(kmInit).trim() !== ''
            ? String(kmInit).trim().replace('.', ',')
            : ''
    );
    aggiornaTotaleLive();

    overlay.hidden = false;
    overlay.setAttribute('aria-hidden', 'false');
    document.getElementById('ct-chilometri')?.focus();
}

export { formatEuroIt as formatEuroCalcolaTariffa, parseNumeroIt as parseNumeroCalcolaTariffa };
