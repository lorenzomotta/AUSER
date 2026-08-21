/**
 * Servizio ripetuto su più date (Nuovo Servizio).
 * Stessi dati di base; per ogni data si possono cambiare ora, operatore e mezzo.
 * Il pagamento resta unico (importo sul primo servizio, stessa ricevuta su tutti).
 */

function escapeHtml(text) {
    return String(text ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function val(id) {
    const el = document.getElementById(id);
    if (!el) return '';
    return String(el.value || '').trim();
}

function pad2(n) {
    return String(n).padStart(2, '0');
}

function dataIsoToItaliana(isoStr) {
    if (!isoStr || typeof isoStr !== 'string') return '';
    const parts = isoStr.trim().split('-');
    if (parts.length !== 3) return '';
    const [year, month, day] = parts;
    if (!year || !month || !day) return '';
    return `${pad2(parseInt(day, 10))}/${pad2(parseInt(month, 10))}/${year}`;
}

function addDaysIso(isoStr, days) {
    const s = String(isoStr || '').trim().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const d = new Date(`${s}T12:00:00`);
    if (Number.isNaN(d.getTime())) return s;
    d.setDate(d.getDate() + Number(days || 0));
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function diffDaysIso(isoA, isoB) {
    const a = String(isoA || '').trim().slice(0, 10);
    const b = String(isoB || '').trim().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(a) || !/^\d{4}-\d{2}-\d{2}$/.test(b)) return 0;
    const da = new Date(`${a}T12:00:00`);
    const db = new Date(`${b}T12:00:00`);
    if (Number.isNaN(da.getTime()) || Number.isNaN(db.getTime())) return 0;
    return Math.round((db - da) / 86400000);
}

function copiaOpzioniSelect(fromId, toSelect) {
    const from = document.getElementById(fromId);
    if (!from || !toSelect) return;
    toSelect.innerHTML = from.innerHTML;
}

/**
 * @param {{
 *   onCambioMezzo: (mezzo: string, dataIso: string) => Promise<void> | void,
 *   onConteggioCambio: (n: number) => void
 * }} deps
 */
export function setupRipetiServizio(deps = {}) {
    const checkbox = document.getElementById('ns-ripeti-servizio');
    const panel = document.getElementById('ns-ripeti-panel');
    const tbody = document.getElementById('ns-ripeti-body');
    const hintPagamento = document.getElementById('ns-ripeti-pagamento-hint');
    const btnAggiungi = document.getElementById('btn-ripeti-aggiungi');
    const inputNuovaData = document.getElementById('ns-ripeti-nuova-data');
    const conteggioEl = document.getElementById('ns-ripeti-conteggio');

    let syncInCorso = false;
    let rigaSeq = 0;

    function isAttivo() {
        return Boolean(checkbox?.checked);
    }

    function righe() {
        return Array.from(tbody?.querySelectorAll('tr') || []);
    }

    function campiRiga(tr) {
        return {
            data: tr.querySelector('.ns-ripeti-data'),
            ora: tr.querySelector('.ns-ripeti-ora'),
            operatore: tr.querySelector('.ns-ripeti-operatore'),
            mezzo: tr.querySelector('.ns-ripeti-mezzo')
        };
    }

    function valoriUltimaRiga() {
        const lista = righe();
        const ultima = lista[lista.length - 1];
        if (!ultima) {
            return {
                data: val('ns-data-prelievo'),
                ora: val('ns-ora-inizio'),
                operatore: val('ns-operatore'),
                mezzo: val('ns-mezzo')
            };
        }
        const c = campiRiga(ultima);
        return {
            data: c.data?.value || '',
            ora: c.ora?.value || val('ns-ora-inizio'),
            operatore: c.operatore?.value || val('ns-operatore'),
            mezzo: c.mezzo?.value || val('ns-mezzo')
        };
    }

    function aggiornaConteggio() {
        const n = righe().length;
        if (conteggioEl) {
            if (!isAttivo() || n < 1) {
                conteggioEl.textContent = '';
            } else if (n === 1) {
                conteggioEl.textContent = 'Aggiungi almeno un’altra data per creare la serie.';
            } else {
                conteggioEl.textContent = `${n} servizi verranno creati.`;
            }
        }
        if (hintPagamento) {
            hintPagamento.hidden = !(isAttivo() && n >= 2);
        }
        deps.onConteggioCambio?.(isAttivo() ? n : 1);
    }

    function creaRiga({ data, ora, operatore, mezzo }, isPrima) {
        rigaSeq += 1;
        const uid = rigaSeq;
        const tr = document.createElement('tr');
        tr.dataset.ripetiUid = String(uid);
        tr.innerHTML = `
            <td>
                <input type="date" class="ns-input ns-ripeti-data" id="ns-ripeti-data-${uid}"
                    value="${escapeHtml(data || '')}" ${isPrima ? '' : 'required'}>
            </td>
            <td>
                <input type="time" class="ns-input ns-ripeti-ora" id="ns-ripeti-ora-${uid}"
                    value="${escapeHtml(ora || '')}">
            </td>
            <td>
                <select class="ns-input ns-ripeti-operatore" id="ns-ripeti-operatore-${uid}"></select>
            </td>
            <td>
                <select class="ns-input ns-ripeti-mezzo" id="ns-ripeti-mezzo-${uid}"></select>
            </td>
            <td class="ns-ripeti-azioni-riga">
                ${isPrima
                    ? '<span class="ns-ripeti-prima">Principale</span>'
                    : '<button type="button" class="ns-ripeti-rimuovi" title="Rimuovi questa data">✕</button>'}
            </td>
        `;
        const c = campiRiga(tr);
        copiaOpzioniSelect('ns-operatore', c.operatore);
        copiaOpzioniSelect('ns-mezzo', c.mezzo);
        if (c.operatore) c.operatore.value = operatore || '';
        if (c.mezzo) c.mezzo.value = mezzo || '';
        return tr;
    }

    function assicuraPrimaRiga() {
        if (!tbody) return;
        if (righe().length > 0) return;
        tbody.appendChild(creaRiga({
            data: val('ns-data-prelievo'),
            ora: val('ns-ora-inizio'),
            operatore: val('ns-operatore'),
            mezzo: val('ns-mezzo')
        }, true));
    }

    function syncFormVersoPrimaRiga() {
        if (syncInCorso || !isAttivo()) return;
        const tr = righe()[0];
        if (!tr) return;
        const c = campiRiga(tr);
        syncInCorso = true;
        if (c.data) c.data.value = val('ns-data-prelievo');
        if (c.ora) c.ora.value = val('ns-ora-inizio');
        if (c.operatore) {
            copiaOpzioniSelect('ns-operatore', c.operatore);
            c.operatore.value = val('ns-operatore');
        }
        if (c.mezzo) {
            copiaOpzioniSelect('ns-mezzo', c.mezzo);
            c.mezzo.value = val('ns-mezzo');
        }
        syncInCorso = false;
    }

    function syncPrimaRigaVersoForm(campo) {
        if (syncInCorso || !isAttivo()) return;
        const tr = righe()[0];
        if (!tr) return;
        const c = campiRiga(tr);
        syncInCorso = true;
        const imposta = (id, valore) => {
            const el = document.getElementById(id);
            if (!el) return;
            if (String(el.value || '') === String(valore || '')) return;
            el.value = valore || '';
            el.dispatchEvent(new Event('change', { bubbles: true }));
        };
        if (campo === 'data' || campo === 'all') imposta('ns-data-prelievo', c.data?.value || '');
        if (campo === 'ora' || campo === 'all') imposta('ns-ora-inizio', c.ora?.value || '');
        if (campo === 'operatore' || campo === 'all') imposta('ns-operatore', c.operatore?.value || '');
        if (campo === 'mezzo' || campo === 'all') imposta('ns-mezzo', c.mezzo?.value || '');
        syncInCorso = false;
    }

    function aggiungiRiga(dataIso = '') {
        if (!tbody) return;
        assicuraPrimaRiga();
        const last = valoriUltimaRiga();
        tbody.appendChild(creaRiga({
            data: dataIso,
            ora: last.ora,
            operatore: last.operatore,
            mezzo: last.mezzo
        }, false));
        aggiornaConteggio();
        const nuova = righe().at(-1)?.querySelector('.ns-ripeti-data');
        nuova?.focus();
    }

    function setAttivo(attivo) {
        if (!checkbox) return;
        checkbox.checked = Boolean(attivo);
        if (panel) panel.hidden = !checkbox.checked;
        if (checkbox.checked) {
            assicuraPrimaRiga();
            syncFormVersoPrimaRiga();
        }
        aggiornaConteggio();
    }

    function leggiOccorrenze() {
        if (!isAttivo()) return [];
        return righe().map((tr) => {
            const c = campiRiga(tr);
            return {
                dataIso: String(c.data?.value || '').trim(),
                ora: String(c.ora?.value || '').trim(),
                operatore: String(c.operatore?.value || '').trim(),
                mezzo: String(c.mezzo?.value || '').trim()
            };
        });
    }

    function valida() {
        const mancanti = [];
        if (!isAttivo()) return mancanti;

        const occ = leggiOccorrenze();
        if (occ.length < 2) {
            mancanti.push({
                id: 'ns-ripeti-servizio',
                label: 'RIPETI SU PIÙ DATE (aggiungi almeno un’altra data, oppure togli la spunta)'
            });
            return mancanti;
        }

        const viste = new Map();
        occ.forEach((o, i) => {
            const tr = righe()[i];
            const c = campiRiga(tr);
            const nRiga = i + 1;
            if (!o.dataIso) {
                if (c.data) c.data.classList.add('ns-campo-errore');
                mancanti.push({
                    id: c.data?.id || 'ns-ripeti-servizio',
                    label: `DATA PRELIEVO (riga ${nRiga} della serie)`
                });
            }
            if (!o.ora) {
                if (c.ora) c.ora.classList.add('ns-campo-errore');
                mancanti.push({
                    id: c.ora?.id || 'ns-ora-inizio',
                    label: `ORA SOTTO CASA (riga ${nRiga} della serie)`
                });
            }
            if (o.dataIso) {
                if (viste.has(o.dataIso)) {
                    if (c.data) c.data.classList.add('ns-campo-errore');
                    mancanti.push({
                        id: c.data?.id || 'ns-ripeti-servizio',
                        label: `DATA ${dataIsoToItaliana(o.dataIso)} ripetuta più volte nella serie`
                    });
                } else {
                    viste.set(o.dataIso, nRiga);
                }
            }
        });
        return mancanti;
    }

    function dataDestinazionePerOccorrenza(dataPrelievoIso) {
        const prelievoForm = val('ns-data-prelievo');
        const destForm = val('ns-ora-arrivo');
        if (!dataPrelievoIso) return destForm;
        if (!prelievoForm || !destForm) return dataPrelievoIso;
        const delta = diffDaysIso(prelievoForm, destForm);
        return addDaysIso(dataPrelievoIso, delta);
    }

    function reset() {
        if (checkbox) checkbox.checked = false;
        if (panel) panel.hidden = true;
        if (hintPagamento) hintPagamento.hidden = true;
        if (tbody) tbody.innerHTML = '';
        if (inputNuovaData) inputNuovaData.value = '';
        rigaSeq = 0;
        aggiornaConteggio();
    }

    function aggiornaOpzioniNelleRighe() {
        if (!tbody) return;
        righe().forEach((tr) => {
            const c = campiRiga(tr);
            const op = c.operatore?.value || '';
            const mz = c.mezzo?.value || '';
            copiaOpzioniSelect('ns-operatore', c.operatore);
            copiaOpzioniSelect('ns-mezzo', c.mezzo);
            if (c.operatore) c.operatore.value = op;
            if (c.mezzo) c.mezzo.value = mz;
        });
    }

    checkbox?.addEventListener('change', () => {
        setAttivo(checkbox.checked);
    });

    btnAggiungi?.addEventListener('click', () => {
        const dataIso = String(inputNuovaData?.value || '').trim();
        aggiungiRiga(dataIso);
        if (inputNuovaData) inputNuovaData.value = '';
    });

    inputNuovaData?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            btnAggiungi?.click();
        }
    });

    tbody?.addEventListener('click', (e) => {
        const btn = e.target.closest('.ns-ripeti-rimuovi');
        if (!btn) return;
        const tr = btn.closest('tr');
        if (!tr || righe()[0] === tr) return;
        tr.remove();
        aggiornaConteggio();
    });

    tbody?.addEventListener('input', (e) => {
        const el = e.target;
        if (el.classList.contains('ns-campo-errore')) {
            el.classList.remove('ns-campo-errore');
        }
    });

    tbody?.addEventListener('change', async (e) => {
        const el = e.target;
        const tr = el.closest('tr');
        if (!tr) return;
        const isPrima = righe()[0] === tr;
        const c = campiRiga(tr);

        if (el.classList.contains('ns-ripeti-data') && isPrima) {
            syncPrimaRigaVersoForm('data');
        } else if (el.classList.contains('ns-ripeti-ora') && isPrima) {
            syncPrimaRigaVersoForm('ora');
        } else if (el.classList.contains('ns-ripeti-operatore') && isPrima) {
            syncPrimaRigaVersoForm('operatore');
        } else if (el.classList.contains('ns-ripeti-mezzo') && isPrima) {
            syncPrimaRigaVersoForm('mezzo');
        }

        if (!isPrima && (el.classList.contains('ns-ripeti-data') || el.classList.contains('ns-ripeti-mezzo'))) {
            const mezzo = c.mezzo?.value || '';
            const dataIso = c.data?.value || '';
            if (mezzo && dataIso) {
                await deps.onCambioMezzo?.(mezzo, dataIso);
            }
        }
    });

    ['ns-data-prelievo', 'ns-ora-inizio', 'ns-operatore', 'ns-mezzo'].forEach((id) => {
        document.getElementById(id)?.addEventListener('change', () => {
            syncFormVersoPrimaRiga();
        });
    });

    return {
        isAttivo,
        leggiOccorrenze,
        valida,
        dataDestinazionePerOccorrenza,
        dataIsoToItaliana,
        reset,
        aggiornaOpzioniNelleRighe,
        setAttivo
    };
}

/**
 * Testo note usato per riconoscere una serie ripetuta.
 */
function testoNoteSerie(servizio) {
    return [
        servizio?.note_prelievo,
        servizio?.note_fine_servizio
    ].map((s) => String(s || '')).join('\n');
}

/**
 * True se il servizio è un'occorrenza aggiuntiva di una serie
 * (pagamento unico sul servizio principale).
 */
export function isServizioSerieAggiuntivo(servizio) {
    const t = testoNoteSerie(servizio);
    if (!/Serie di\s+\d+\s+servizi/i.test(t)) return false;
    if (/su questo servizio/i.test(t)) return false;
    return /sul servizio/i.test(t);
}

/** True se è il servizio principale di una serie (importo e ricevuta unica). */
export function isServizioSeriePrincipale(servizio) {
    const t = testoNoteSerie(servizio);
    return /Serie di\s+\d+\s+servizi/i.test(t) && /su questo servizio/i.test(t);
}

/** ID del servizio principale letto dalle note di un servizio aggiuntivo. */
export function idPrincipaleDaServizioAggiuntivo(servizio) {
    const t = testoNoteSerie(servizio);
    const m = t.match(/sul servizio\s+n\.?\s*(\d+)/i);
    if (!m) return 0;
    const id = parseInt(m[1], 10);
    return Number.isNaN(id) ? 0 : id;
}
