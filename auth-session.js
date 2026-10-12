// Sessione login AUSER (Supabase Auth + user_permissions)
const SESSION_KEY = 'auser_auth_session';
const LOCK_RINNOVO = 'auser_auth_refresh_lock';
/** Rinnova un po' prima della scadenza, così una schermata nuova non trova il login già morto. */
const MARGINE_RINNOVO_MS = 2 * 60 * 1000;

function leggiSessioneSalvata() {
    try {
        const raw = localStorage.getItem(SESSION_KEY);
        if (!raw) return null;
        const data = JSON.parse(raw);
        if (!data?.user_id || !data?.access_token) return null;
        return data;
    } catch (_) {
        return null;
    }
}

function sessioneScaduta(data) {
    const exp = Number(data?.expires_at || 0);
    return exp > 0 && Date.now() > exp;
}

function deveRinnovare(data) {
    if (!data?.refresh_token) return false;
    const exp = Number(data.expires_at || 0);
    if (!exp) return false;
    return exp - Date.now() <= MARGINE_RINNOVO_MS;
}

export function leggiSessione() {
    const data = leggiSessioneSalvata();
    if (!data) return null;
    // Senza codice di rinnovo, alla scadenza si esce. Con il codice, si prova a rinnovare.
    if (sessioneScaduta(data) && !data.refresh_token) {
        localStorage.removeItem(SESSION_KEY);
        return null;
    }
    return data;
}

export function salvaSessione(sessione) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(sessione));
}

export function cancellaSessione() {
    localStorage.removeItem(SESSION_KEY);
}

/**
 * Nome utente da salvare in CreatoDa / ModificatoDa (es. "LORENZO").
 * La data/ora va invece nelle colonne created_at / update_at.
 * @param {object|null} [sessione]
 * @returns {string}
 */
export function formatoAccountSessione(sessione = leggiSessione()) {
    if (!sessione) return '';
    const username = String(sessione.username || '').trim();
    if (username) return username;
    const email = String(sessione.email || '').trim();
    if (email.includes('@')) return email.split('@')[0];
    return email;
}

/**
 * Nome di chi è collegato, da scrivere in CreatoDa / ModificatoDa.
 * Se la sessione non ha lo username, lo cerca in user_permissions.
 * Non lancia errori: se non lo trova restituisce stringa vuota e il salvataggio continua.
 * @param {Function} invoke - tauri invoke
 * @returns {Promise<string>}
 */
export async function risolviAccountCollegato(invoke) {
    const giaPresente = formatoAccountSessione();
    if (giaPresente) return giaPresente;

    const sessione = leggiSessione();
    const userId = String(sessione?.user_id || '').trim();
    if (!userId || typeof invoke !== 'function') return '';

    try {
        const perm = await invoke('get_user_permissions', { userId, user_id: userId });
        const nome = formatoAccountSessione({
            username: perm?.username || '',
            email: sessione.email || ''
        });
        if (!nome) return '';
        salvaSessione({ ...sessione, username: nome });
        return nome;
    } catch (err) {
        console.warn('Nome utente non recuperato: il servizio viene salvato lo stesso.', err);
        return '';
    }
}

/**
 * Da un valore salvato (anche vecchio "email (username)") ricava solo lo username da mostrare.
 * Se il valore è solo una data/ora (vecchio Access in CreatoDa), non è un utente → stringa vuota.
 * @param {string} valore
 * @returns {string}
 */
export function soloUsernameAccount(valore) {
    const s = String(valore || '').trim();
    if (!s) return '';
    // Solo data/ora → non è un nome utente
    if (/^\d{1,2}\/\d{1,2}\/\d{4}/.test(s)) return '';
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return '';
    const traParentesi = s.match(/\(([^)]+)\)\s*$/);
    if (traParentesi?.[1]) return traParentesi[1].trim();
    if (s.includes('@')) return s.split('@')[0];
    return s;
}

export function isAdmin(sessione = leggiSessione()) {
    return !!(sessione && sessione.is_admin === true);
}

export function puoUsareProgramma(sessione = leggiSessione()) {
    if (!sessione) return false;
    return sessione.is_admin === true || sessione.programma === true;
}

export function vaiAlLogin() {
    window.location.href = 'LOGIN.html';
}

export function vaiAllaHome() {
    window.location.href = 'index.html';
}

function attendi(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function attendiAltroRinnovo() {
    for (let i = 0; i < 20; i += 1) {
        const lock = localStorage.getItem(LOCK_RINNOVO) || '';
        const lockMs = Number(lock.split('-')[0] || lock || 0);
        if (!lock || Date.now() - lockMs > 20000) return;
        await attendi(300);
    }
}

async function chiediTokenConRefresh(refreshToken) {
    const { invoke } = await import('@tauri-apps/api/tauri');
    await invoke('init_supabase_from_config').catch(() => {});
    const authCfg = await invoke('get_supabase_auth_config');
    const url = String(authCfg?.url || '').replace(/\/$/, '');
    const anonKey = String(authCfg?.anon_key || '').trim();
    if (!url || !anonKey) {
        throw new Error('Config Auth incompleta (url / anon_key)');
    }

    const risposta = await fetch(`${url}/auth/v1/token?grant_type=refresh_token`, {
        method: 'POST',
        headers: {
            apikey: anonKey,
            Authorization: `Bearer ${anonKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ refresh_token: refreshToken })
    });

    const body = await risposta.json().catch(() => ({}));
    if (!risposta.ok) {
        const err = new Error(body?.error_description || body?.msg || body?.error || `Rinnovo login fallito (${risposta.status})`);
        err.status = risposta.status;
        throw err;
    }
    if (!body?.access_token) {
        throw new Error('Risposta rinnovo incompleta da Supabase');
    }
    return body;
}

let rinnovoInCorso = null;

/**
 * Se il login sta per scadere (o è già scaduto), chiede un token nuovo
 * con il codice di rinnovo salvato all'accesso. Non mostra il login.
 */
export async function rinnovaSessione() {
    if (rinnovoInCorso) return rinnovoInCorso;
    rinnovoInCorso = eseguiRinnovo().finally(() => {
        rinnovoInCorso = null;
    });
    return rinnovoInCorso;
}

async function eseguiRinnovo() {
    let sessione = leggiSessioneSalvata();
    if (!sessione) return null;
    if (!deveRinnovare(sessione)) return sessione;

    const lock = localStorage.getItem(LOCK_RINNOVO) || '';
    const lockMs = Number(lock.split('-')[0] || lock || 0);
    if (lock && Date.now() - lockMs < 20000) {
        await attendiAltroRinnovo();
        const dopo = leggiSessioneSalvata();
        if (dopo && !deveRinnovare(dopo)) return dopo;
        sessione = dopo || sessione;
    }

    if (!sessione?.refresh_token) {
        if (sessione && sessioneScaduta(sessione)) {
            cancellaSessione();
            return null;
        }
        return sessione;
    }

    const mioLock = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    localStorage.setItem(LOCK_RINNOVO, mioLock);
    await attendi(80);
    if (localStorage.getItem(LOCK_RINNOVO) !== mioLock) {
        await attendiAltroRinnovo();
        const dopo = leggiSessioneSalvata();
        if (dopo && !deveRinnovare(dopo)) return dopo;
        return eseguiRinnovo();
    }

    try {
        const fresco = leggiSessioneSalvata();
        const token = fresco?.refresh_token || sessione.refresh_token;
        const body = await chiediTokenConRefresh(token);
        const expiresIn = Number(body.expires_in) || 3600;
        const nuova = {
            ...(fresco || sessione),
            access_token: body.access_token,
            refresh_token: body.refresh_token || token,
            expires_at: Date.now() + (expiresIn - 60) * 1000
        };
        salvaSessione(nuova);
        return nuova;
    } catch (error) {
        const status = Number(error?.status || 0);
        if (status >= 400 && status < 500) {
            console.warn('Login non più rinnovabile:', error?.message || error);
            cancellaSessione();
            return null;
        }
        console.warn('Rinnovo login non riuscito, riprovo più tardi.', error?.message || error);
        return leggiSessioneSalvata();
    } finally {
        localStorage.removeItem(LOCK_RINNOVO);
    }
}

let timerRinnovo = 0;
let ascoltoStorage = false;

/** Programma il prossimo rinnovo finché questa finestra resta aperta. */
export function avviaRinnovoAutomatico() {
    if (!ascoltoStorage && typeof window !== 'undefined') {
        ascoltoStorage = true;
        window.addEventListener('storage', (ev) => {
            if (ev.key === SESSION_KEY) avviaRinnovoAutomatico();
        });
    }
    if (timerRinnovo) clearTimeout(timerRinnovo);
    const sessione = leggiSessioneSalvata();
    if (!sessione?.refresh_token || !sessione.expires_at) return;
    const manca = Number(sessione.expires_at) - Date.now() - MARGINE_RINNOVO_MS;
    const attesa = manca > 0 ? manca : 60 * 1000;
    timerRinnovo = setTimeout(async () => {
        const nuova = await rinnovaSessione();
        if (!nuova) {
            cancellaSessione();
            vaiAlLogin();
            return;
        }
        avviaRinnovoAutomatico();
    }, attesa);
}

/**
 * Se non c'è sessione valida → LOGIN.
 * Se il token è scaduto ma si può rinnovare, lo rinnova senza chiedere la password.
 * Ritorna la sessione oppure null (dopo redirect).
 */
export async function richiediSessione() {
    const sessione = await rinnovaSessione();
    if (!sessione || !puoUsareProgramma(sessione)) {
        cancellaSessione();
        vaiAlLogin();
        return null;
    }
    avviaRinnovoAutomatico();
    return sessione;
}

/**
 * Login email/password via Supabase Auth REST API.
 * @param {Function} invoke - tauri invoke
 */
export async function loginConEmailPassword(invoke, email, password) {
    if (!invoke) throw new Error('Tauri non disponibile');

    await invoke('init_supabase_from_config').catch(() => {});
    const authCfg = await invoke('get_supabase_auth_config');
    const url = String(authCfg?.url || '').replace(/\/$/, '');
    const anonKey = String(authCfg?.anon_key || '').trim();
    if (!url || !anonKey) {
        throw new Error('Config Auth incompleta (url / anon_key)');
    }

    const risposta = await fetch(`${url}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: {
            apikey: anonKey,
            Authorization: `Bearer ${anonKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ email: email.trim(), password })
    });

    const body = await risposta.json().catch(() => ({}));
    if (!risposta.ok) {
        const msg = body?.error_description || body?.msg || body?.error || `Login fallito (${risposta.status})`;
        throw new Error(msg);
    }

    const userId = body?.user?.id || body?.user_id;
    const userEmail = body?.user?.email || email.trim();
    const accessToken = body?.access_token;
    const refreshToken = body?.refresh_token || '';
    const expiresIn = Number(body?.expires_in) || 3600;

    if (!userId || !accessToken) {
        throw new Error('Risposta login incompleta da Supabase');
    }

    const perm = await invoke('get_user_permissions', { userId, user_id: userId });
    if (!perm) {
        throw new Error('Utente non presente in user_permissions. Contatta l\'amministratore.');
    }

    const isAdminFlag = perm.is_admin === true;
    const programmaFlag = perm.programma === true;
    if (!isAdminFlag && !programmaFlag) {
        throw new Error('Non hai il permesso Programma per usare questa applicazione.');
    }

    const sessione = {
        user_id: userId,
        email: userEmail,
        username: perm.username || userEmail,
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_at: Date.now() + (expiresIn - 60) * 1000,
        is_admin: isAdminFlag,
        programma: programmaFlag,
        calendario: perm.calendario === true,
        sidebar_menu: perm.sidebar_menu ?? {}
    };

    salvaSessione(sessione);
    return sessione;
}

export function logout() {
    cancellaSessione();
    vaiAlLogin();
}
