// Sessione login AUSER (Supabase Auth + user_permissions)
const SESSION_KEY = 'auser_auth_session';

export function leggiSessione() {
    try {
        const raw = localStorage.getItem(SESSION_KEY);
        if (!raw) return null;
        const data = JSON.parse(raw);
        if (!data?.user_id || !data?.access_token) return null;
        if (data.expires_at && Date.now() > Number(data.expires_at)) {
            localStorage.removeItem(SESSION_KEY);
            return null;
        }
        return data;
    } catch (_) {
        return null;
    }
}

export function salvaSessione(sessione) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(sessione));
}

export function cancellaSessione() {
    localStorage.removeItem(SESSION_KEY);
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

/**
 * Se non c'è sessione valida → LOGIN.
 * Ritorna la sessione oppure null (dopo redirect).
 */
export function richiediSessione() {
    const sessione = leggiSessione();
    if (!sessione || !puoUsareProgramma(sessione)) {
        cancellaSessione();
        vaiAlLogin();
        return null;
    }
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
        calendario: perm.calendario === true
    };

    salvaSessione(sessione);
    return sessione;
}

export function logout() {
    cancellaSessione();
    vaiAlLogin();
}
