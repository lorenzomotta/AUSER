/**
 * Etichetta e ricerca mezzo.
 * Nel servizio il campo Mezzo contiene IdAutomezzo (non Numero_Mezzo, che è vuoto).
 */

export function idMezzo(mezzo) {
    if (!mezzo || mezzo.id == null) return '';
    const s = String(mezzo.id).trim();
    if (!s || s === '0') return '';
    if (s.endsWith('.0')) return s.slice(0, -2);
    return s;
}

export function etichettaMezzo(mezzo) {
    if (!mezzo) return '';
    const nome = [mezzo.marca, mezzo.modello]
        .map((p) => String(p || '').trim())
        .filter(Boolean)
        .join(' - ');
    const targa = String(mezzo.targa || '').trim();
    if (nome && targa) return `${nome} (${targa})`;
    if (nome) return nome;
    if (targa) return `(${targa})`;
    const id = idMezzo(mezzo);
    return id ? `Mezzo ${id}` : 'Mezzo';
}

function chiave(val) {
    const s = String(val ?? '').trim();
    if (!s) return '';
    return s.endsWith('.0') ? s.slice(0, -2) : s;
}

export function trovaAutomezzo(lista, idSalvato) {
    const key = chiave(idSalvato);
    if (!key) return null;
    const mezzi = Array.isArray(lista) ? lista : [];
    return mezzi.find((a) => idMezzo(a) === key)
        || mezzi.find((a) => chiave(a?.nr_automezzo) === key)
        || null;
}

export function testoMezzoServizio(servizio, lista) {
    const salvato = servizio?.mezzo ?? '';
    const auto = trovaAutomezzo(lista, salvato);
    if (auto) return etichettaMezzo(auto);
    const fallback = String(servizio?.mezzo_usato || '').trim();
    if (fallback) return fallback;
    return chiave(salvato);
}
