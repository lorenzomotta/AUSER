// Appunti agenda — privati / selezionati / tutti
import { richiediSessione } from './auth-session.js';
import { puoVedereSidebar } from './sidebar-permessi.js';

let invoke;
/** @type {{ user_id: string, username?: string } | null} */
let sessione = null;
/** @type {Array<object>} */
let appunti = [];
/** @type {Array<{user_id: string, username: string}>} */
let utenti = [];
/** Data selezionata YYYY-MM-DD */
let giornoCorrente = '';
/** Appunto da evidenziare dopo un salto dalla ricerca */
let evidenziaId = '';

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

/** Zoom pagina Agenda: Ctrl (o Cmd su Mac) + rotellina del mouse */
const ZOOM_DEFAULT = 1.1;
const ZOOM_MIN = 0.8;
const ZOOM_MAX = 2;
const ZOOM_STEP = 0.1;
let zoomCorrente = ZOOM_DEFAULT;

function applicaZoomAgenda(valore) {
    const arrotondato = Math.round(valore * 10) / 10;
    zoomCorrente = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, arrotondato));
    document.documentElement.style.zoom = String(zoomCorrente);
}

function initZoomAgenda() {
    const zoomCss = parseFloat(getComputedStyle(document.documentElement).zoom);
    if (Number.isFinite(zoomCss) && zoomCss > 0) {
        zoomCorrente = zoomCss;
    }
    applicaZoomAgenda(zoomCorrente);

    document.addEventListener('wheel', (ev) => {
        if (!(ev.ctrlKey || ev.metaKey)) return;
        ev.preventDefault();
        const passo = ev.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP;
        applicaZoomAgenda(zoomCorrente + passo);
    }, { passive: false });

    document.addEventListener('keydown', (ev) => {
        if (!(ev.ctrlKey || ev.metaKey)) return;
        if (ev.key === '0') {
            ev.preventDefault();
            applicaZoomAgenda(ZOOM_DEFAULT);
        } else if (ev.key === '+' || ev.key === '=') {
            ev.preventDefault();
            applicaZoomAgenda(zoomCorrente + ZOOM_STEP);
        } else if (ev.key === '-') {
            ev.preventDefault();
            applicaZoomAgenda(zoomCorrente - ZOOM_STEP);
        }
    });
}

function escapeHtml(str) {
    if (str === undefined || str === null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/** Modale per scegliere una data. Ritorna YYYY-MM-DD oppure null se annullato. */
function chiediData(titolo, dataIniziale) {
    return new Promise((resolve) => {
        const overlay = document.getElementById('ap-dialog-data');
        const titoloEl = document.getElementById('ap-dialog-data-titolo');
        const input = document.getElementById('ap-dialog-data-input');
        const btnOk = document.getElementById('ap-dialog-data-ok');
        const btnNo = document.getElementById('ap-dialog-data-no');

        if (!overlay || !titoloEl || !input || !btnOk || !btnNo) {
            const v = window.prompt(titolo, dataIniziale || oggiIso());
            resolve(v && /^\d{4}-\d{2}-\d{2}$/.test(v.trim()) ? v.trim() : null);
            return;
        }

        titoloEl.textContent = titolo;
        input.value = dataIniziale || oggiIso();
        overlay.hidden = false;
        overlay.setAttribute('aria-hidden', 'false');
        input.focus();

        const chiudi = (valore) => {
            overlay.hidden = true;
            overlay.setAttribute('aria-hidden', 'true');
            btnOk.removeEventListener('click', onOk);
            btnNo.removeEventListener('click', onNo);
            overlay.removeEventListener('click', onOverlay);
            document.removeEventListener('keydown', onKey);
            resolve(valore);
        };

        const onOk = (e) => {
            e.preventDefault();
            const v = String(input.value || '').trim();
            if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) {
                alert('Scegli una data valida.');
                input.focus();
                return;
            }
            chiudi(v);
        };
        const onNo = (e) => {
            e.preventDefault();
            chiudi(null);
        };
        const onOverlay = (e) => {
            if (e.target === overlay) chiudi(null);
        };
        const onKey = (e) => {
            if (e.key === 'Escape') chiudi(null);
            if (e.key === 'Enter') onOk(e);
        };

        btnOk.addEventListener('click', onOk);
        btnNo.addEventListener('click', onNo);
        overlay.addEventListener('click', onOverlay);
        document.addEventListener('keydown', onKey);
    });
}

/**
 * Modale Sì/Annulla (sostituisce window.confirm).
 * @param {string} messaggio
 * @param {{ si?: string, no?: string }} [etichette]
 */
function chiediConferma(messaggio, etichette = {}) {
    return new Promise((resolve) => {
        const overlay = document.getElementById('ap-dialog-conferma');
        const msgEl = document.getElementById('ap-dialog-messaggio');
        const btnSi = document.getElementById('ap-dialog-si');
        const btnNo = document.getElementById('ap-dialog-no');

        if (!overlay || !msgEl || !btnSi || !btnNo) {
            resolve(window.confirm(messaggio));
            return;
        }

        const labelSiDefault = btnSi.dataset.labelDefault || btnSi.textContent || 'SÌ';
        const labelNoDefault = btnNo.dataset.labelDefault || btnNo.textContent || 'ANNULLA';
        if (!btnSi.dataset.labelDefault) btnSi.dataset.labelDefault = labelSiDefault;
        if (!btnNo.dataset.labelDefault) btnNo.dataset.labelDefault = labelNoDefault;

        msgEl.textContent = messaggio;
        btnSi.textContent = etichette.si || labelSiDefault;
        btnNo.textContent = etichette.no || labelNoDefault;
        overlay.hidden = false;
        overlay.setAttribute('aria-hidden', 'false');
        btnSi.focus();

        const chiudi = (risposta) => {
            overlay.hidden = true;
            overlay.setAttribute('aria-hidden', 'true');
            btnSi.textContent = btnSi.dataset.labelDefault;
            btnNo.textContent = btnNo.dataset.labelDefault;
            btnSi.removeEventListener('click', onSi);
            btnNo.removeEventListener('click', onNo);
            overlay.removeEventListener('click', onOverlay);
            document.removeEventListener('keydown', onKey);
            resolve(risposta);
        };

        const onSi = (e) => {
            e.preventDefault();
            chiudi(true);
        };
        const onNo = (e) => {
            e.preventDefault();
            chiudi(false);
        };
        const onOverlay = (e) => {
            if (e.target === overlay) chiudi(false);
        };
        const onKey = (e) => {
            if (e.key === 'Escape') chiudi(false);
            if (e.key === 'Enter') chiudi(true);
        };

        btnSi.addEventListener('click', onSi);
        btnNo.addEventListener('click', onNo);
        overlay.addEventListener('click', onOverlay);
        document.addEventListener('keydown', onKey);
    });
}

function oggiIso() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function shiftGiorno(iso, deltaDays) {
    const [y, m, d] = iso.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() + deltaDays);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

function formatGiornoItaliano(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    try {
        return dt.toLocaleDateString('it-IT', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            year: 'numeric'
        });
    } catch (_) {
        return iso;
    }
}

function anteprimaTesto(testo) {
    const t = String(testo || '').replace(/\s+/g, ' ').trim();
    if (t.length <= 110) return t;
    return `${t.slice(0, 107)}…`;
}

function mostraRisultatiRicerca(lista, messaggio) {
    const box = document.getElementById('ap-ricerca-risultati');
    if (!box) return;
    box.hidden = false;
    if (!lista.length) {
        box.innerHTML = `<p class="ap-ricerca-vuoto">${escapeHtml(messaggio || 'Nessun appunto trovato.')}</p>`;
        return;
    }
    box.innerHTML = lista.map((a) => {
        const id = a.id || '';
        const data = a.data || '';
        const quando = data ? formatGiornoItaliano(data) : '';
        const autore = a.autore_username || '';
        const chi = autore ? ` · ${autore}` : '';
        return `<button type="button" class="ap-risultato" data-data="${escapeHtml(data)}" data-id="${escapeHtml(id)}">
            <span class="ap-risultato-data">${escapeHtml(quando)}${escapeHtml(chi)}</span>
            <span class="ap-risultato-testo">${escapeHtml(anteprimaTesto(a.testo))}</span>
        </button>`;
    }).join('');
}

function modoRicercaScelto() {
    return document.querySelector('input[name="ap-modo"]:checked')?.value === 'esatto'
        ? 'esatto'
        : 'contenuto';
}

function apriModale(id) {
    const overlay = document.getElementById(id);
    if (!overlay) return;
    overlay.hidden = false;
    overlay.setAttribute('aria-hidden', 'false');
}

function chiudiModale(id) {
    const overlay = document.getElementById(id);
    if (!overlay) return;
    overlay.hidden = true;
    overlay.setAttribute('aria-hidden', 'true');
}

function dataAggiungiScelta() {
    const v = String(document.getElementById('ap-aggiungi-data')?.value || '').trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : giornoCorrente;
}

function aggiornaEtichettaAggiungi() {
    const giorno = document.getElementById('ap-aggiungi-giorno');
    if (giorno) giorno.textContent = formatGiornoItaliano(dataAggiungiScelta());
}

function apriModaleAggiungi() {
    const input = document.getElementById('ap-aggiungi-data');
    if (input) input.value = giornoCorrente;
    aggiornaEtichettaAggiungi();
    apriModale('ap-dialog-aggiungi');
    document.getElementById('ap-nuovo-testo')?.focus();
}

function apriModaleCerca() {
    apriModale('ap-dialog-cerca');
    document.getElementById('ap-cerca')?.focus();
}

async function cercaAppunti() {
    const input = document.getElementById('ap-cerca');
    const q = String(input?.value || '').trim();
    const modo = modoRicercaScelto();
    if (modo === 'esatto' ? !q : q.length < 2) {
        alert(modo === 'esatto'
            ? 'Scrivi il testo esatto dell\'appunto.'
            : 'Scrivi almeno 2 lettere da cercare.');
        input?.focus();
        return;
    }
    if (!invoke || !sessione?.user_id) return;
    setStato('Ricerca in corso…');
    try {
        await invoke('init_supabase_from_config').catch(() => {});
        const list = await invoke('cerca_appunti', {
            userId: sessione.user_id,
            user_id: sessione.user_id,
            testo: q,
            modo
        });
        const trovati = Array.isArray(list) ? list : [];
        mostraRisultatiRicerca(
            trovati,
            'Nessun appunto trovato. La ricerca guarda i tuoi appunti, quelli condivisi con te e quelli visibili a tutti.'
        );
        setStato(trovati.length === 0 ? 'Nessun appunto trovato' : `${trovati.length} appunto/i trovati`);
    } catch (error) {
        console.error('Ricerca appunti:', error);
        const msg = String(error?.message || error || 'Errore');
        mostraRisultatiRicerca([], msg);
        setStato('Ricerca non riuscita');
    }
}

async function apriAppuntoTrovato(data, id) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return;
    chiudiModale('ap-dialog-cerca');
    giornoCorrente = data;
    evidenziaId = id || '';
    const dataInput = document.getElementById('ap-data');
    if (dataInput) dataInput.value = giornoCorrente;
    await caricaGiorno();
}

function setStato(testo) {
    const el = document.getElementById('ap-stato');
    if (el) el.textContent = testo || '';
}

function aggiornaEtichettaGiorno() {
    const testo = document.getElementById('ap-giorno-testo');
    const input = document.getElementById('ap-data');
    if (input && input.value !== giornoCorrente) input.value = giornoCorrente;
    if (testo) testo.textContent = formatGiornoItaliano(giornoCorrente);
}

function getVisibilitaScelta() {
    const el = document.querySelector('input[name="ap-vis"]:checked');
    return el?.value || 'privato';
}

function getDestinatariScelti() {
    return [...document.querySelectorAll('#ap-destinatari-list input[type="checkbox"]:checked')]
        .map((c) => c.value)
        .filter(Boolean);
}

function syncDestinatariPanel() {
    const box = document.getElementById('ap-destinatari');
    if (!box) return;
    box.hidden = getVisibilitaScelta() !== 'selezionati';
}

function renderUtentiDestinatari() {
    const list = document.getElementById('ap-destinatari-list');
    if (!list) return;
    const others = utenti.filter((u) => u.user_id !== sessione?.user_id);
    if (!others.length) {
        list.innerHTML = '<p class="ap-empty-mini">Nessun altro utente disponibile.</p>';
        return;
    }
    list.innerHTML = others.map((u) => `
        <label>
            <input type="checkbox" value="${escapeHtml(u.user_id)}">
            ${escapeHtml(u.username || u.user_id)}
        </label>
    `).join('');
}

async function caricaUtenti() {
    if (!invoke || !sessione?.user_id) return;
    try {
        const list = await invoke('get_utenti_per_appunti', {
            userId: sessione.user_id,
            user_id: sessione.user_id
        });
        utenti = Array.isArray(list) ? list : [];
        renderUtentiDestinatari();
    } catch (error) {
        console.warn('Utenti appunti:', error);
        utenti = [];
        const list = document.getElementById('ap-destinatari-list');
        if (list) {
            list.innerHTML = '<p class="ap-empty-mini">Impossibile caricare l\'elenco utenti.</p>';
        }
    }
}

function labelVisibilita(a) {
    const v = String(a.visibilita || 'privato');
    if (v === 'tutti') return { cls: 'ap-badge-tutti', text: 'TUTTI' };
    if (v === 'selezionati') return { cls: 'ap-badge-selezionati', text: 'PERSONE SCELTE' };
    return { cls: 'ap-badge-privato', text: 'SOLO IO' };
}

function isMio(a) {
    return String(a.user_id || '') === String(sessione?.user_id || '');
}

function puoAvereChat(a) {
    const v = String(a.visibilita || 'privato');
    return v === 'selezionati' || v === 'tutti';
}

function formatDataOra(iso) {
    if (!iso) return '';
    try {
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return String(iso).slice(0, 16);
        return d.toLocaleString('it-IT', {
            day: '2-digit',
            month: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });
    } catch (_) {
        return String(iso).slice(0, 16);
    }
}

async function caricaGiorno() {
    if (!invoke || !sessione?.user_id) return;
    setStato('Caricamento…');
    aggiornaEtichettaGiorno();

    try {
        try {
            await invoke('init_supabase_from_config');
        } catch (initErr) {
            console.warn('Init Supabase:', initErr);
        }

        const list = await invoke('get_appunti_giorno', {
            userId: sessione.user_id,
            user_id: sessione.user_id,
            data: giornoCorrente
        });
        appunti = Array.isArray(list) ? list : [];
        renderLista();
        const n = appunti.length;
        setStato(n === 0 ? 'Nessun appunto per questo giorno' : `${n} appunto/i`);
        if (evidenziaId) {
            const el = document.querySelector(`.ap-item[data-id="${CSS.escape(evidenziaId)}"]`);
            if (el) {
                el.classList.add('ap-item-trovato');
                el.scrollIntoView({ block: 'center' });
            }
            evidenziaId = '';
        }
    } catch (error) {
        console.error('Errore caricamento appunti:', error);
        const msg = String(error?.message || error || '');
        appunti = [];
        renderLista();
        if (msg.includes('appunti') || msg.includes('PGRST') || msg.includes('404') || msg.includes('relation') || msg.includes('visibilita')) {
            setStato('Esegui supabase-appunti-utente.sql aggiornato su Supabase');
            alert(
                'Aggiorna le tabelle su Supabase.\n\n' +
                'Apri Supabase → SQL Editor e riesegui il file:\n' +
                'supabase-appunti-utente.sql\n\n' +
                'Poi riprova.'
            );
        } else {
            setStato('Errore caricamento');
            alert(`Impossibile caricare gli appunti:\n${msg}`);
        }
    }
}

function renderLista() {
    const box = document.getElementById('ap-lista');
    const count = document.getElementById('ap-conteggio');
    if (count) count.textContent = String(appunti.length);
    if (!box) return;

    if (!appunti.length) {
        box.innerHTML = '<p class="ap-empty">Nessun appunto per questo giorno.<br>Usa il pulsante AGGIUNGI per scriverne uno.</p>';
        return;
    }

    box.innerHTML = appunti.map((a, idx) => {
        const id = a.id || '';
        const fatto = a.fatto === true;
        const mio = isMio(a);
        const badge = labelVisibilita(a);
        const autore = a.autore_username || (mio ? 'Tu' : 'Utente');
        const destNomi = Array.isArray(a.destinatari_nomi) ? a.destinatari_nomi.filter(Boolean) : [];
        const destLabel = destNomi.length
            ? ` · a: ${destNomi.join(', ')}`
            : '';
        const azioni = mio
            ? `<div class="ap-item-azioni">
                    <button type="button" class="ap-btn ap-btn-icona ap-btn-salva" data-azione="salva" title="Salva">💾</button>
                    <button type="button" class="ap-btn ap-btn-icona ap-btn-duplica" data-azione="duplica" title="Copia su altra data">⧉</button>
                    <button type="button" class="ap-btn ap-btn-icona ap-btn-sposta" data-azione="sposta" title="Cambia data">✏️</button>
                    <button type="button" class="ap-btn ap-btn-icona ap-btn-elimina" data-azione="elimina" title="Elimina">🗑️</button>
               </div>`
            : `<div class="ap-item-azioni"></div>`;

        const nRisp = Number(a.num_risposte) || 0;
        const apriChat = nRisp > 0;
        const chat = puoAvereChat(a)
            ? `<div class="ap-chat" data-chat-for="${escapeHtml(id)}">
                    <button type="button" class="ap-chat-toggle ${apriChat ? 'is-open' : ''}" data-azione="toggle-chat">
                        ${apriChat ? `▾ RISPOSTE (${nRisp})` : `💬 RISPOSTE (${nRisp})`}
                    </button>
                    <div class="ap-chat-body"${apriChat ? '' : ' hidden'}>
                        <div class="ap-chat-list"></div>
                        <div class="ap-chat-new">
                            <textarea class="ap-chat-input" rows="1" maxlength="2000" placeholder="Scrivi una risposta…"></textarea>
                            <button type="button" class="ap-btn ap-btn-rispondi" data-azione="invia-risposta">INVIA</button>
                        </div>
                    </div>
               </div>`
            : '';

        return `
        <article class="ap-item ${fatto ? 'is-fatto' : ''} ${mio ? '' : 'is-readonly'}"
                 data-id="${escapeHtml(id)}" data-idx="${idx}" data-mio="${mio ? '1' : '0'}">
            <div class="ap-meta">
                <span class="ap-badge ${badge.cls}">${badge.text}</span>
                ${mio ? '' : '<span class="ap-badge ap-badge-condiviso">CONDIVISO</span>'}
                <span class="ap-autore">Da ${escapeHtml(autore)}${escapeHtml(destLabel)}</span>
            </div>
            <input type="checkbox" class="ap-item-check" ${fatto ? 'checked' : ''} ${mio ? '' : 'disabled'} title="Segna come fatto">
            <textarea class="ap-item-testo" rows="1" maxlength="2000" ${mio ? '' : 'readonly'}></textarea>
            ${azioni}
            ${chat}
        </article>`;
    }).join('');

    box.querySelectorAll('.ap-item').forEach((el, i) => {
        const ta = el.querySelector('.ap-item-testo');
        if (ta) ta.value = appunti[i]?.testo || '';
    });

    // Se ci sono risposte, apri subito il thread e carica i messaggi
    box.querySelectorAll('.ap-chat').forEach((chatEl) => {
        const body = chatEl.querySelector('.ap-chat-body');
        const id = chatEl.dataset.chatFor;
        if (body && !body.hidden && id) {
            caricaRisposte(id, chatEl);
        }
    });
}

async function caricaRisposte(appuntoId, chatEl) {
    const listEl = chatEl?.querySelector('.ap-chat-list');
    if (!listEl || !invoke || !sessione?.user_id) return;
    listEl.innerHTML = '<p class="ap-chat-empty">Caricamento risposte…</p>';
    try {
        const list = await invoke('get_appunti_risposte', {
            userId: sessione.user_id,
            user_id: sessione.user_id,
            appuntoId: appuntoId,
            appunto_id: appuntoId
        });
        const rows = Array.isArray(list) ? list : [];
        const toggle = chatEl.querySelector('.ap-chat-toggle');
        const body = chatEl.querySelector('.ap-chat-body');
        const aperto = body && !body.hidden;
        if (toggle) {
            toggle.textContent = aperto
                ? `▾ RISPOSTE (${rows.length})`
                : `💬 RISPOSTE (${rows.length})`;
            toggle.classList.toggle('is-open', !!aperto);
        }
        const idx = appunti.findIndex((a) => a.id === appuntoId);
        if (idx >= 0) appunti[idx].num_risposte = rows.length;

        if (!rows.length) {
            listEl.innerHTML = '<p class="ap-chat-empty">Nessuna risposta ancora. Scrivi la prima!</p>';
            return;
        }

        const appunto = appunti.find((a) => a.id === appuntoId);
        const sonoAutoreAppunto = appunto && isMio(appunto);

        listEl.innerHTML = rows.map((r) => {
            const mia = String(r.user_id) === String(sessione.user_id);
            const canDel = mia || sonoAutoreAppunto;
            return `
            <div class="ap-chat-msg" data-risposta-id="${escapeHtml(r.id || '')}">
                <div class="ap-chat-msg-head">
                    <span class="ap-chat-author">${escapeHtml(r.username || 'Utente')}</span>
                    <span class="ap-chat-time">${escapeHtml(formatDataOra(r.created_at))}</span>
                    ${canDel ? `<button type="button" class="ap-chat-del" data-azione="elimina-risposta">Elimina</button>` : ''}
                </div>
                <div class="ap-chat-text">${escapeHtml(r.testo || '')}</div>
            </div>`;
        }).join('');
    } catch (error) {
        console.error(error);
        listEl.innerHTML = `<p class="ap-chat-empty">Errore: ${escapeHtml(error?.message || error)}</p>`;
    }
}

async function toggleChat(article) {
    const chat = article?.querySelector('.ap-chat');
    const body = chat?.querySelector('.ap-chat-body');
    const toggle = chat?.querySelector('.ap-chat-toggle');
    const id = article?.dataset?.id;
    if (!chat || !body || !id) return;
    const apri = body.hidden;
    body.hidden = !apri;
    const n = Number(appunti.find((a) => a.id === id)?.num_risposte) || 0;
    if (toggle) {
        toggle.classList.toggle('is-open', apri);
        toggle.textContent = apri ? `▾ RISPOSTE (${n})` : `💬 RISPOSTE (${n})`;
    }
    if (apri) await caricaRisposte(id, chat);
}

async function inviaRisposta(article) {
    const chat = article?.querySelector('.ap-chat');
    const input = chat?.querySelector('.ap-chat-input');
    const id = article?.dataset?.id;
    const testo = String(input?.value || '').trim();
    if (!testo) {
        alert('Scrivi una risposta.');
        input?.focus();
        return;
    }
    if (!id || !invoke || !sessione?.user_id) return;

    try {
        setStato('Invio risposta…');
        await invoke('save_appunto_risposta', {
            risposta: {
                id: null,
                appunto_id: id,
                user_id: sessione.user_id,
                username: sessione.username || '',
                testo,
                created_at: ''
            }
        });
        if (input) input.value = '';
        await caricaRisposte(id, chat);
        setStato('Risposta inviata');
    } catch (error) {
        console.error(error);
        alert(`Impossibile inviare la risposta:\n${error?.message || error}`);
        setStato('Errore risposta');
    }
}

async function eliminaRisposta(btn, article) {
    const msg = btn.closest('.ap-chat-msg');
    const rid = msg?.dataset?.rispostaId;
    const chat = article?.querySelector('.ap-chat');
    const id = article?.dataset?.id;
    if (!rid || !invoke || !sessione?.user_id) return;
    const ok = await chiediConferma('Eliminare questa risposta?', {
        si: 'SÌ, ELIMINA',
        no: 'ANNULLA'
    });
    if (!ok) return;
    try {
        await invoke('delete_appunto_risposta', {
            userId: sessione.user_id,
            user_id: sessione.user_id,
            id: rid
        });
        await caricaRisposte(id, chat);
        setStato('Risposta eliminata');
    } catch (error) {
        console.error(error);
        alert(`Impossibile eliminare:\n${error?.message || error}`);
    }
}

async function aggiungiAppunto() {
    const ta = document.getElementById('ap-nuovo-testo');
    const testo = String(ta?.value || '').trim();
    if (!testo) {
        alert('Scrivi un testo prima di aggiungere.');
        ta?.focus();
        return;
    }
    if (!invoke || !sessione?.user_id) return;

    const visibilita = getVisibilitaScelta();
    const destinatari = visibilita === 'selezionati' ? getDestinatariScelti() : [];
    if (visibilita === 'selezionati' && !destinatari.length) {
        alert('Seleziona almeno un utente, oppure scegli «Solo io» / «Tutti».');
        return;
    }

    const dataScelta = dataAggiungiScelta();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dataScelta)) {
        alert('Scegli il giorno dell\'appunto.');
        document.getElementById('ap-aggiungi-data')?.focus();
        return;
    }

    try {
        setStato('Salvataggio…');
        await invoke('save_appunto', {
            appunto: {
                id: null,
                user_id: sessione.user_id,
                autore_username: sessione.username || '',
                data: dataScelta,
                testo,
                fatto: false,
                ordine: dataScelta === giornoCorrente ? appunti.length : 100000,
                visibilita,
                destinatari,
                destinatari_nomi: []
            }
        });
        if (ta) ta.value = '';
        document.querySelector('input[name="ap-vis"][value="privato"]')?.click();
        document.querySelectorAll('#ap-destinatari-list input[type="checkbox"]').forEach((c) => {
            c.checked = false;
        });
        syncDestinatariPanel();
        if (dataScelta !== giornoCorrente) {
            giornoCorrente = dataScelta;
            const dataInput = document.getElementById('ap-data');
            if (dataInput) dataInput.value = giornoCorrente;
        }
        await caricaGiorno();
        chiudiModale('ap-dialog-aggiungi');
        setStato('Appunto aggiunto');
    } catch (error) {
        console.error(error);
        alert(`Impossibile salvare:\n${error?.message || error}`);
        setStato('Errore salvataggio');
    }
}

async function salvaAppuntoDaRiga(article) {
    if (article?.dataset?.mio !== '1') return;
    const id = article?.dataset?.id;
    if (!id || !invoke || !sessione?.user_id) return;
    const testo = String(article.querySelector('.ap-item-testo')?.value || '').trim();
    const fatto = !!article.querySelector('.ap-item-check')?.checked;
    if (!testo) {
        alert('Il testo non può essere vuoto.');
        return;
    }
    const idx = parseInt(article.dataset.idx || '0', 10);
    const prev = appunti[idx] || {};

    try {
        setStato('Salvataggio…');
        await invoke('save_appunto', {
            appunto: {
                id,
                user_id: sessione.user_id,
                autore_username: sessione.username || prev.autore_username || '',
                data: giornoCorrente,
                testo,
                fatto,
                ordine: prev.ordine ?? idx,
                visibilita: prev.visibilita || 'privato',
                destinatari: Array.isArray(prev.destinatari) ? prev.destinatari : [],
                destinatari_nomi: []
            }
        });
        await caricaGiorno();
        setStato('Appunto aggiornato');
    } catch (error) {
        console.error(error);
        alert(`Impossibile aggiornare:\n${error?.message || error}`);
        setStato('Errore salvataggio');
    }
}

async function toggleFatto(article) {
    if (article?.dataset?.mio !== '1') return;
    await salvaAppuntoDaRiga(article);
}

async function eliminaAppunto(article) {
    if (article?.dataset?.mio !== '1') return;
    const id = article?.dataset?.id;
    if (!id || !invoke || !sessione?.user_id) return;
    const ok = await chiediConferma(
        'Eliminare questo appunto?\nL\'operazione non si può annullare.',
        { si: 'SÌ, ELIMINA', no: 'ANNULLA' }
    );
    if (!ok) return;

    try {
        setStato('Eliminazione…');
        await invoke('delete_appunto', {
            userId: sessione.user_id,
            user_id: sessione.user_id,
            id
        });
        await caricaGiorno();
        setStato('Appunto eliminato');
    } catch (error) {
        console.error(error);
        alert(`Impossibile eliminare:\n${error?.message || error}`);
        setStato('Errore eliminazione');
    }
}

function payloadDaRiga(article, opzioni = {}) {
    const { data = null, fatto = null } = opzioni;
    const hasId = Object.prototype.hasOwnProperty.call(opzioni, 'id');
    const testo = String(article.querySelector('.ap-item-testo')?.value || '').trim();
    const fattoVal = fatto != null
        ? fatto
        : !!article.querySelector('.ap-item-check')?.checked;
    const idx = parseInt(article.dataset.idx || '0', 10);
    const prev = appunti[idx] || {};
    return {
        id: hasId ? opzioni.id : (article.dataset.id || null),
        user_id: sessione.user_id,
        autore_username: sessione.username || prev.autore_username || '',
        data: data || giornoCorrente,
        testo,
        fatto: fattoVal,
        ordine: prev.ordine ?? idx,
        visibilita: prev.visibilita || 'privato',
        destinatari: Array.isArray(prev.destinatari) ? prev.destinatari : [],
        destinatari_nomi: []
    };
}

async function duplicaAppunto(article) {
    if (article?.dataset?.mio !== '1') return;
    if (!invoke || !sessione?.user_id) return;
    const testo = String(article.querySelector('.ap-item-testo')?.value || '').trim();
    if (!testo) {
        alert('Il testo non può essere vuoto.');
        return;
    }

    const nuovaData = await chiediData('Copia appunto su un altro giorno', giornoCorrente);
    if (!nuovaData) return;

    try {
        setStato('Copia in corso…');
        await invoke('save_appunto', {
            appunto: payloadDaRiga(article, {
                id: null,
                data: nuovaData,
                fatto: false
            })
        });
        const vai = await chiediConferma(
            `Appunto copiato sul ${formatGiornoItaliano(nuovaData)}.\n\nVuoi aprire quel giorno?`,
            { si: 'APRI GIORNO', no: 'RESTA QUI' }
        );
        if (vai) {
            giornoCorrente = nuovaData;
            const dataInput = document.getElementById('ap-data');
            if (dataInput) dataInput.value = nuovaData;
        }
        await caricaGiorno();
        setStato(vai ? 'Giorno aperto' : 'Appunto copiato');
    } catch (error) {
        console.error(error);
        alert(`Impossibile copiare:\n${error?.message || error}`);
        setStato('Errore copia');
    }
}

async function spostaAppunto(article) {
    if (article?.dataset?.mio !== '1') return;
    const id = article?.dataset?.id;
    if (!id || !invoke || !sessione?.user_id) return;
    const testo = String(article.querySelector('.ap-item-testo')?.value || '').trim();
    if (!testo) {
        alert('Il testo non può essere vuoto.');
        return;
    }

    const nuovaData = await chiediData('Cambia data dell\'appunto', giornoCorrente);
    if (!nuovaData) return;
    if (nuovaData === giornoCorrente) {
        setStato('Data invariata');
        return;
    }

    try {
        setStato('Spostamento…');
        await invoke('save_appunto', {
            appunto: payloadDaRiga(article, { id, data: nuovaData })
        });
        const vai = await chiediConferma(
            `Appunto spostato al ${formatGiornoItaliano(nuovaData)}.\n\nVuoi aprire quel giorno?`,
            { si: 'APRI GIORNO', no: 'RESTA QUI' }
        );
        if (vai) {
            giornoCorrente = nuovaData;
            const dataInput = document.getElementById('ap-data');
            if (dataInput) dataInput.value = nuovaData;
        }
        await caricaGiorno();
        setStato(vai ? 'Giorno aperto' : 'Appunto spostato');
    } catch (error) {
        console.error(error);
        alert(`Impossibile cambiare data:\n${error?.message || error}`);
        setStato('Errore spostamento');
    }
}

async function chiudiFinestra() {
    if (isTauri()) {
        try {
            const { getCurrent, WebviewWindow } = await import('@tauri-apps/api/window');
            const currentWindow = getCurrent();
            const label = currentWindow?.label || '';
            if (label === 'appunti') {
                try {
                    const mainWin = WebviewWindow.getByLabel('main');
                    if (mainWin) {
                        await mainWin.show();
                        await mainWin.setFocus();
                    }
                } catch (_) { /* ignore */ }
                await currentWindow.close();
                return;
            }
            window.location.href = 'index.html';
            return;
        } catch (err) {
            console.warn('Chiusura:', err);
            window.location.href = 'index.html';
            return;
        }
    }
    if (window.opener) window.close();
    else window.location.href = 'index.html';
}

document.addEventListener('DOMContentLoaded', async () => {
    initZoomAgenda();

    sessione = await richiediSessione();
    if (!sessione) return;
    if (!puoVedereSidebar('appunti', sessione)) {
        alert('Non hai il permesso per gli Appunti.');
        window.location.href = 'index.html';
        return;
    }

    await initTauri();

    const userEl = document.getElementById('ap-utente');
    if (userEl) {
        userEl.textContent = sessione.username
            ? `${sessione.username} · agenda personale e condivisa`
            : 'Agenda personale e condivisa';
    }

    giornoCorrente = oggiIso();
    const dataInput = document.getElementById('ap-data');
    if (dataInput) dataInput.value = giornoCorrente;
    aggiornaEtichettaGiorno();
    syncDestinatariPanel();

    document.querySelectorAll('input[name="ap-vis"]').forEach((r) => {
        r.addEventListener('change', syncDestinatariPanel);
    });

    document.getElementById('btn-chiudi')?.addEventListener('click', chiudiFinestra);
    document.getElementById('btn-oggi')?.addEventListener('click', () => {
        giornoCorrente = oggiIso();
        caricaGiorno();
    });
    document.getElementById('btn-ieri')?.addEventListener('click', () => {
        giornoCorrente = shiftGiorno(giornoCorrente, -1);
        caricaGiorno();
    });
    document.getElementById('btn-domani')?.addEventListener('click', () => {
        giornoCorrente = shiftGiorno(giornoCorrente, 1);
        caricaGiorno();
    });
    dataInput?.addEventListener('change', () => {
        if (dataInput.value) {
            giornoCorrente = dataInput.value;
            caricaGiorno();
        }
    });

    document.getElementById('btn-apri-aggiungi')?.addEventListener('click', apriModaleAggiungi);
    document.getElementById('ap-aggiungi-data')?.addEventListener('change', aggiornaEtichettaAggiungi);
    document.getElementById('btn-chiudi-aggiungi')?.addEventListener('click', () => {
        chiudiModale('ap-dialog-aggiungi');
    });
    document.getElementById('ap-dialog-aggiungi')?.addEventListener('click', (ev) => {
        if (ev.target?.id === 'ap-dialog-aggiungi') chiudiModale('ap-dialog-aggiungi');
    });

    document.getElementById('btn-apri-cerca')?.addEventListener('click', apriModaleCerca);
    document.getElementById('btn-chiudi-cerca')?.addEventListener('click', () => {
        chiudiModale('ap-dialog-cerca');
    });
    document.getElementById('ap-dialog-cerca')?.addEventListener('click', (ev) => {
        if (ev.target?.id === 'ap-dialog-cerca') chiudiModale('ap-dialog-cerca');
    });
    document.addEventListener('keydown', (ev) => {
        if (ev.key !== 'Escape') return;
        const aggiungi = document.getElementById('ap-dialog-aggiungi');
        const cerca = document.getElementById('ap-dialog-cerca');
        if (aggiungi && !aggiungi.hidden) chiudiModale('ap-dialog-aggiungi');
        else if (cerca && !cerca.hidden) chiudiModale('ap-dialog-cerca');
    });

    document.getElementById('btn-cerca')?.addEventListener('click', cercaAppunti);
    document.getElementById('ap-cerca')?.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') {
            ev.preventDefault();
            cercaAppunti();
        }
    });
    document.getElementById('ap-ricerca-risultati')?.addEventListener('click', (ev) => {
        const btn = ev.target.closest('.ap-risultato');
        if (!btn) return;
        apriAppuntoTrovato(btn.dataset.data || '', btn.dataset.id || '');
    });

    document.getElementById('btn-aggiungi')?.addEventListener('click', aggiungiAppunto);
    document.getElementById('ap-nuovo-testo')?.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) {
            ev.preventDefault();
            aggiungiAppunto();
        }
    });

    document.getElementById('ap-lista')?.addEventListener('click', (ev) => {
        const btn = ev.target.closest('button[data-azione]');
        if (!btn) return;
        const article = btn.closest('.ap-item');
        if (!article) return;
        const azione = btn.dataset.azione;
        if (azione === 'salva') salvaAppuntoDaRiga(article);
        else if (azione === 'duplica') duplicaAppunto(article);
        else if (azione === 'sposta') spostaAppunto(article);
        else if (azione === 'elimina') eliminaAppunto(article);
        else if (azione === 'toggle-chat') toggleChat(article);
        else if (azione === 'invia-risposta') inviaRisposta(article);
        else if (azione === 'elimina-risposta') eliminaRisposta(btn, article);
    });

    document.getElementById('ap-lista')?.addEventListener('change', (ev) => {
        if (ev.target?.matches?.('.ap-item-check')) {
            const article = ev.target.closest('.ap-item');
            if (article) toggleFatto(article);
        }
    });

    await caricaUtenti();
    await caricaGiorno();
});
