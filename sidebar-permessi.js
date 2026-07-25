/**
 * Permessi voci sidebar (Programma).
 * Chiavi salvate in user_permissions.SidebarMenu (JSON testo).
 */

export const SIDEBAR_VOCI = [
    { key: 'calendario_servizi', btnId: 'btn-calendario-servizi', label: 'CALENDARIO SERVIZI' },
    { key: 'nuovo_servizio', btnId: 'btn-nuovo-servizio', label: 'NUOVO SERVIZIO' },
    { key: 'elenco_servizi', btnId: 'btn-elenco-servizi', label: 'ELENCO SERVIZI' },
    { key: 'report_giorno', btnId: 'btn-report-giorno', label: 'REPORT DEL GIORNO' },
    { key: 'report_settimanale', btnId: 'btn-report-settimanale', label: 'REPORT SETTIMANALE' },
    { key: 'elenco_soci', btnId: 'btn-elenco-soci', label: 'ELENCO SOCI' },
    { key: 'tratte_fuori_asti', btnId: 'btn-tratte-fuori-asti', label: 'TRATTE FUORI ASTI' },
    { key: 'elenco_mezzi', btnId: 'btn-elenco-mezzi', label: 'ELENCO MEZZI' },
    { key: 'riepilogo_incassi', btnId: 'btn-riepilogo-incassi', label: 'INCASSI GIORNALIERI' },
    { key: 'elenco_operatori', btnId: 'btn-elenco-operatori', label: 'ELENCO OPERATORI' },
    { key: 'riepilogo_pagamenti', btnId: 'btn-riepilogo-pagamenti', label: 'RIEPILOGO PAGAMENTI' }
];

/** Alias per UI (stesso elenco) */
export const SIDEBAR_VOCI_UI = SIDEBAR_VOCI;

/** Default: tutte le voci classiche ON; le 3 ex-admin OFF (come prima per non-admin). */
export function defaultSidebarMenu() {
    const menu = {};
    for (const v of SIDEBAR_VOCI_UI) {
        const exAdmin = ['riepilogo_incassi', 'elenco_operatori', 'riepilogo_pagamenti'].includes(v.key);
        menu[v.key] = !exAdmin;
    }
    return menu;
}

/** Tutte le voci abilitate (es. utente admin). */
export function fullSidebarMenu() {
    const menu = {};
    for (const v of SIDEBAR_VOCI_UI) {
        menu[v.key] = true;
    }
    return menu;
}

export function normalizzaSidebarMenu(raw) {
    const base = defaultSidebarMenu();
    if (raw == null || raw === '') return base;

    let obj = raw;
    if (typeof raw === 'string') {
        try {
            obj = JSON.parse(raw);
        } catch (_) {
            return base;
        }
    }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return base;

    const out = { ...base };
    for (const v of SIDEBAR_VOCI_UI) {
        if (Object.prototype.hasOwnProperty.call(obj, v.key)) {
            out[v.key] = obj[v.key] === true || obj[v.key] === 'true' || obj[v.key] === 1;
        }
    }
    return out;
}

export function sidebarMenuToJson(menu) {
    return JSON.stringify(normalizzaSidebarMenu(menu));
}

/**
 * True se l'utente può vedere la voce.
 * Admin: sempre sì. Altrimenti dipende da Programma + flag menu.
 */
export function puoVedereSidebar(key, sessione) {
    if (!sessione) return false;
    if (sessione.is_admin === true) return true;
    if (sessione.programma !== true) return false;
    const menu = normalizzaSidebarMenu(sessione.sidebar_menu);
    return menu[key] === true;
}

/** Applica hidden ai pulsanti sidebar in base alla sessione. */
export function applicaVisibilitaSidebar(sessione, root = document) {
    if (!sessione) return;
    const admin = sessione.is_admin === true;
    for (const v of SIDEBAR_VOCI) {
        const el = root.getElementById?.(v.btnId) || root.querySelector?.(`#${v.btnId}`);
        if (!el) continue;
        el.hidden = admin ? false : !puoVedereSidebar(v.key, sessione);
    }
}
