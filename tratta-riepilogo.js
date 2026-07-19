// Riepilogo tratta fuori Asti — condiviso tra Nuovo / Modifica / Completa / Lettura

export const TFA_START = '[[TFA]]';
export const TFA_END = '[[/TFA]]';

function escapeHtml(str) {
    if (str === undefined || str === null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/** Note da mostrare all'utente (senza blocco tecnico della tratta) */
export function testoNoteFineVisibile(noteFine) {
    return parseTrattaDaNote(noteFine).notePulite;
}

/** Estrae JSON tratta dalle note e restituisce note senza marker */
export function parseTrattaDaNote(noteFine) {
    const raw = String(noteFine || '');
    const re = /\[\[TFA\]\]([\s\S]*?)\[\[\/TFA\]\]/;
    const m = raw.match(re);
    if (!m) {
        return { tratta: null, notePulite: raw };
    }
    let tratta = null;
    try {
        tratta = JSON.parse(m[1].trim());
    } catch (_) {
        tratta = null;
    }
    const notePulite = raw.replace(re, '').replace(/^\s*\n/, '').trim();
    return { tratta, notePulite };
}

/** Inserisce (o rimuove) il marker tratta nelle note fine servizio */
export function mergeTrattaInNote(noteFine, trattaObj) {
    const { notePulite } = parseTrattaDaNote(noteFine);
    if (!trattaObj || typeof trattaObj !== 'object') {
        return notePulite;
    }
    const json = JSON.stringify(trattaObj);
    if (!json || json === '{}' || json === 'null') {
        return notePulite;
    }
    const blocco = `${TFA_START}${json}${TFA_END}`;
    return notePulite ? `${blocco}\n${notePulite}` : blocco;
}

export function normalizzaPayloadTratta(payload) {
    if (!payload || typeof payload !== 'object') return null;
    const ruoloRaw = String(payload.ruolo || '').trim().toLowerCase();
    const ruolo = ruoloRaw === 'partenza' || ruoloRaw === 'arrivo' ? ruoloRaw : '';
    return {
        id: payload.id ?? '',
        comune: payload.comune || '',
        provincia: payload.provincia || '',
        localita: payload.localita || '',
        km: payload.km || '',
        costo_km: payload.costo_km || '',
        costo: payload.costo || '',
        pedaggio: payload.pedaggio || '',
        totale: payload.totale || '',
        note_aggiuntive: payload.note_aggiuntive || '',
        ruolo
    };
}

export function titoloRiepilogoTratta(payload) {
    const t = normalizzaPayloadTratta(payload);
    if (!t) return "E' stato selezionato";
    if (t.ruolo === 'partenza') return "E' stato selezionato come PARTENZA";
    if (t.ruolo === 'arrivo') return "E' stato selezionato come ARRIVO";
    return "E' stato selezionato";
}

/** HTML del box riepilogo (senza wrapper esterno hidden) */
export function htmlContenutoRiepilogoTratta(payload) {
    const t = normalizzaPayloadTratta(payload);
    if (!t) return '';

    const campi = [
        { label: 'ID', value: t.id },
        { label: 'COMUNE', value: t.comune },
        { label: 'PROV', value: t.provincia },
        { label: 'LOCALITÀ', value: t.localita },
        { label: 'KM', value: t.km },
        { label: '€/KM', value: t.costo_km },
        { label: 'COSTO', value: t.costo },
        { label: 'PEDAGGIO', value: t.pedaggio },
        { label: 'TOTALE', value: t.totale }
    ];
    const note = String(t.note_aggiuntive || '').trim();

    return `
        <div class="ns-tratta-selezionata-titolo">${escapeHtml(titoloRiepilogoTratta(t))}</div>
        <div class="ns-tratta-selezionata-dati">
            <div class="ns-tratta-selezionata-grid">
                ${campi.map((c) => `
                    <div class="ns-tratta-campo">
                        <span class="ns-tratta-campo-label">${escapeHtml(c.label)}</span>
                        <span class="ns-tratta-campo-val">${escapeHtml(c.value ?? '')}</span>
                    </div>
                `).join('')}
            </div>
            ${note ? `<div class="ns-tratta-note"><span class="ns-tratta-campo-label">NOTE</span> ${escapeHtml(note)}</div>` : ''}
        </div>
    `;
}

/** Blocco completo da inserire nel form (hidden se nessuna tratta) */
export function htmlBloccoRiepilogoTratta(payload, { hiddenId = 'ns-tratta-fuori-asti' } = {}) {
    const t = normalizzaPayloadTratta(payload);
    const has = !!t && (t.id !== '' && t.id != null || t.comune || t.totale);
    const jsonAttr = has ? escapeHtml(JSON.stringify(t)) : '';
    return `
        <input type="hidden" id="${escapeHtml(hiddenId)}" value="${jsonAttr}">
        <div class="ns-tratta-selezionata" id="${escapeHtml(hiddenId)}-box" ${has ? '' : 'hidden'}>
            ${has ? htmlContenutoRiepilogoTratta(t) : ''}
        </div>
    `;
}

/** Aggiorna box + hidden in pagina (Nuovo Servizio / form già montato) */
export function applicaRiepilogoTrattaNelDom(payload, {
    hiddenId = 'ns-tratta-fuori-asti',
    boxId = null
} = {}) {
    const t = normalizzaPayloadTratta(payload);
    const hidden = document.getElementById(hiddenId);
    const box = document.getElementById(boxId || `${hiddenId}-box`);
    if (hidden) {
        hidden.value = t ? JSON.stringify(t) : '';
    }
    if (!box) return;
    if (!t) {
        box.hidden = true;
        box.innerHTML = '';
        return;
    }
    box.innerHTML = htmlContenutoRiepilogoTratta(t);
    box.hidden = false;
}

export function leggiTrattaDalDom(hiddenId = 'ns-tratta-fuori-asti') {
    const el = document.getElementById(hiddenId);
    if (!el?.value?.trim()) return null;
    try {
        return normalizzaPayloadTratta(JSON.parse(el.value));
    } catch (_) {
        return null;
    }
}

/** True se il campo donazione/pagamento è vuoto (cancellato dall'utente) */
export function isPagamentoDonazioneVuoto(valore) {
    const pulito = String(valore || '')
        .replace(/€/g, '')
        .replace(/\s/g, '')
        .trim();
    return pulito === '';
}

/**
 * Rimuove la riga tratta fuori Asti dal form (se presente).
 * Usare quando l'utente modifica la donazione in qualsiasi modo.
 * @returns {object|null} la tratta rimossa (con ruolo partenza/arrivo), o null
 */
export function rimuoviTrattaDalForm(hiddenId = 'ns-tratta-fuori-asti') {
    const tratta = leggiTrattaDalDom(hiddenId);
    if (!tratta) return null;
    applicaRiepilogoTrattaNelDom(null, { hiddenId });
    return tratta;
}

/** Messaggio per avvisare di reimpostare partenza o arrivo dopo rimozione tratta */
export function messaggioAvvisoDopoRimozioneTratta(tratta) {
    const ruolo = String(tratta?.ruolo || '').trim().toLowerCase();
    if (ruolo === 'partenza') {
        return (
            "Hai modificato la donazione: la tratta fuori Asti è stata rimossa.\n\n" +
            "Reimposta i campi di PARTENZA (COMUNE DI PRELIEVO e LUOGO DI PRELIEVO) se necessario."
        );
    }
    if (ruolo === 'arrivo') {
        return (
            "Hai modificato la donazione: la tratta fuori Asti è stata rimossa.\n\n" +
            "Reimposta i campi di ARRIVO (COMUNE DI DESTINAZIONE e LUOGO DI DESTINAZIONE) se necessario."
        );
    }
    return (
        "Hai modificato la donazione: la tratta fuori Asti è stata rimossa.\n\n" +
        "Controlla e reimposta i campi di partenza o destinazione compilati dalla tratta, se necessario."
    );
}

/** @deprecated usa rimuoviTrattaDalForm; mantenuto per compatibilità */
export function rimuoviTrattaSePagamentoVuoto(valorePagamento, hiddenId = 'ns-tratta-fuori-asti') {
    if (!isPagamentoDonazioneVuoto(valorePagamento)) return null;
    return rimuoviTrattaDalForm(hiddenId);
}

function isTauriRuntime() {
    return typeof window !== 'undefined' && !!(window.__TAURI__ || window.__TAURI_IPC__);
}

/** Apre la finestra selezione tratte (modalità select=1) */
export async function apriFinestraSelezioneTratta() {
    const url = 'TRATTEFUORIASTI.html?select=1';

    if (isTauriRuntime()) {
        try {
            const { WebviewWindow } = await import('@tauri-apps/api/window');
            const label = 'tratte-fuori-asti-select';

            const existing = WebviewWindow.getByLabel(label);
            if (existing) {
                try {
                    await existing.show();
                    await existing.setFocus();
                    return;
                } catch (err) {
                    console.warn('Finestra tratte select non riutilizzabile:', err);
                    try { await existing.close(); } catch (_) { /* ignore */ }
                }
            }

            const webview = new WebviewWindow(label, {
                url,
                title: 'Costo Tratte Fuori Asti',
                width: 900,
                height: 800,
                resizable: true,
                maximized: false,
                decorations: true,
                center: true
            });
            webview.setFocus().catch((err) => console.warn('setFocus tratte select:', err));
            return;
        } catch (error) {
            console.error('Errore apertura Tratte Fuori Asti:', error);
        }
    }

    window.open(url, 'tratte-fuori-asti-select', 'width=900,height=800');
}

let listenerTrattaGlobaleAttivo = false;
const callbackSelezioneTratta = new Set();

/**
 * Registra un callback chiamato quando l'utente sceglie una tratta.
 * Il listener globale (Tauri / postMessage / storage) viene avviato una sola volta.
 */
export async function onTrattaFuoriAstiSelezionata(callback) {
    if (typeof callback === 'function') {
        callbackSelezioneTratta.add(callback);
    }
    if (listenerTrattaGlobaleAttivo) return;
    listenerTrattaGlobaleAttivo = true;

    const notifica = (payload) => {
        const t = normalizzaPayloadTratta(payload);
        if (!t) return;
        callbackSelezioneTratta.forEach((fn) => {
            try { fn(t); } catch (err) { console.warn('Callback tratta:', err); }
        });
    };

    if (isTauriRuntime()) {
        try {
            const { listen } = await import('@tauri-apps/api/event');
            await listen('tratta-fuori-asti-selezionata', (event) => {
                notifica(event.payload);
            });
        } catch (err) {
            console.warn('Listener tratta fuori Asti:', err);
        }
    }

    window.addEventListener('message', (event) => {
        if (event?.data?.type === 'tratta-fuori-asti-selezionata') {
            notifica(event.data.payload);
        }
    });

    window.addEventListener('storage', (event) => {
        if (event.key !== 'tratta_fuori_asti_selezionata' || !event.newValue) return;
        try {
            notifica(JSON.parse(event.newValue));
        } catch (_) { /* ignore */ }
    });
}

function ensureDialogPartenzaArrivo() {
    if (document.getElementById('ns-dialog-partenza-arrivo')) return;
    const wrap = document.createElement('div');
    wrap.innerHTML = `
    <div id="ns-dialog-partenza-arrivo" class="ns-dialog-overlay" hidden aria-hidden="true">
        <div class="ns-dialog" role="dialog" aria-modal="true" aria-labelledby="ns-dialog-partenza-arrivo-messaggio">
            <p id="ns-dialog-partenza-arrivo-messaggio" class="ns-dialog-messaggio">
                La località fuori ASTI è la partenza o l'arrivo?
            </p>
            <div class="ns-dialog-actions">
                <button type="button" id="ns-dialog-btn-partenza" class="ns-dialog-btn ns-dialog-btn-si">PARTENZA</button>
                <button type="button" id="ns-dialog-btn-arrivo" class="ns-dialog-btn ns-dialog-btn-arrivo">ARRIVO</button>
            </div>
        </div>
    </div>`;
    document.body.appendChild(wrap.firstElementChild);
}

/** Chiede se la tratta è partenza o arrivo. Ritorna 'partenza' | 'arrivo' */
export function chiediPartenzaOArrivo(messaggio) {
    ensureDialogPartenzaArrivo();
    return new Promise((resolve) => {
        const overlay = document.getElementById('ns-dialog-partenza-arrivo');
        const msgEl = document.getElementById('ns-dialog-partenza-arrivo-messaggio');
        const btnPartenza = document.getElementById('ns-dialog-btn-partenza');
        const btnArrivo = document.getElementById('ns-dialog-btn-arrivo');

        if (!overlay || !btnPartenza || !btnArrivo) {
            const scelta = window.confirm(
                `${messaggio || "La località fuori ASTI è la partenza o l'arrivo?"}\n\nOK = PARTENZA\nAnnulla = ARRIVO`
            );
            resolve(scelta ? 'partenza' : 'arrivo');
            return;
        }

        if (msgEl) {
            msgEl.textContent = messaggio
                || "La località fuori ASTI è la partenza o l'arrivo?";
        }
        overlay.hidden = false;
        overlay.setAttribute('aria-hidden', 'false');

        const chiudi = (risposta) => {
            btnPartenza.disabled = true;
            btnArrivo.disabled = true;
            overlay.hidden = true;
            overlay.setAttribute('aria-hidden', 'true');
            window.setTimeout(() => {
                btnPartenza.disabled = false;
                btnArrivo.disabled = false;
                resolve(risposta);
            }, 150);
        };

        const onPartenza = (event) => {
            event.preventDefault();
            event.stopPropagation();
            btnPartenza.removeEventListener('click', onPartenza);
            btnArrivo.removeEventListener('click', onArrivo);
            chiudi('partenza');
        };

        const onArrivo = (event) => {
            event.preventDefault();
            event.stopPropagation();
            btnPartenza.removeEventListener('click', onPartenza);
            btnArrivo.removeEventListener('click', onArrivo);
            chiudi('arrivo');
        };

        btnPartenza.addEventListener('click', onPartenza);
        btnArrivo.addEventListener('click', onArrivo);
    });
}

/**
 * Compila comune/luogo su form Nuovo (ns-*) o Modifica (prefix-*).
 * dove = 'partenza' | 'arrivo'
 */
export function compilaCampiLocalitaDaTratta(payload, dove, idPrefix = 'ns') {
    if (!payload || !dove) return;
    const comune = String(payload.comune || '').trim();
    const localita = String(payload.localita || '').trim();

    const setCampo = (suffix, valore) => {
        const id = idPrefix === 'ns' ? `ns-${suffix}` : `${idPrefix}-${suffix}`;
        const el = document.getElementById(id);
        if (!el || !valore) return;
        el.value = valore;
        el.classList.remove('ns-campo-errore');
    };

    if (dove === 'partenza') {
        setCampo('comune-prelievo', comune);
        setCampo('luogo-prelievo', localita);
        return;
    }
    if (dove === 'arrivo') {
        setCampo('comune-destinazione', comune);
        setCampo('luogo-destinazione', localita);
    }
}
