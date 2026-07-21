// Modale export elenco soci (PDF + Excel)
import { generaPdfElencoSoci } from './elencosoci-pdf.js';
import { generaExcelElencoSoci } from './elencosoci-excel.js';

export function initExportElencoSoci({ getSoci, getFiltriDescrizione }) {
    const modal = document.getElementById('modal-stampa-pdf');
    const btnApri = document.getElementById('btn-export-elenco');
    const btnChiudi = document.getElementById('btn-stampa-pdf-chiudi');
    const btnAnnulla = document.getElementById('btn-stampa-pdf-annulla');
    const btnGeneraPdf = document.getElementById('btn-stampa-pdf-genera');
    const btnGeneraExcel = document.getElementById('btn-export-excel-genera');
    const chkAnagrafica = document.getElementById('pdf-include-anagrafica');
    const chkTesseramento = document.getElementById('pdf-include-tesseramento');
    const subflagsPanel = document.getElementById('export-anagrafica-subflags');
    const flagOperatore = document.getElementById('export-flag-operatore');
    const flagDisponibilita = document.getElementById('export-flag-disponibilita');
    const flagNota = document.getElementById('export-flag-nota');
    const flagAttivo = document.getElementById('export-flag-attivo');
    const flagArchiviato = document.getElementById('export-flag-archiviato');
    const countEl = document.getElementById('pdf-soci-count');
    const erroreEl = document.getElementById('pdf-stampa-errore');

    const subflagInputs = [
        flagOperatore,
        flagDisponibilita,
        flagNota,
        flagAttivo,
        flagArchiviato
    ];

    if (!modal || !btnGeneraPdf) return;

    function mostraErrore(msg) {
        if (!erroreEl) return;
        if (msg) {
            erroreEl.textContent = msg;
            erroreEl.hidden = false;
        } else {
            erroreEl.textContent = '';
            erroreEl.hidden = true;
        }
    }

    function syncSubflagsState() {
        const attivo = chkAnagrafica?.checked === true;
        if (subflagsPanel) {
            subflagsPanel.classList.toggle('disabled', !attivo);
        }
        subflagInputs.forEach((input) => {
            if (input) input.disabled = !attivo;
        });
    }

    function getAnagraficaFlags() {
        return {
            operatore: flagOperatore?.checked === true,
            disponibilita: flagDisponibilita?.checked === true,
            nota: flagNota?.checked === true,
            attivo: flagAttivo?.checked === true,
            archiviato: flagArchiviato?.checked === true
        };
    }

    function getExportOptions() {
        return {
            includeAnagrafica: chkAnagrafica?.checked === true,
            includeTesseramento: chkTesseramento?.checked === true,
            anagraficaFlags: getAnagraficaFlags(),
            filtriDescrizione: typeof getFiltriDescrizione === 'function'
                ? getFiltriDescrizione()
                : ''
        };
    }

    function apriModal() {
        mostraErrore('');
        syncSubflagsState();
        const soci = typeof getSoci === 'function' ? getSoci() : [];
        if (countEl) {
            countEl.textContent = String(soci.length);
        }
        modal.hidden = false;
    }

    function chiudiModal() {
        modal.hidden = true;
        mostraErrore('');
    }

    chkAnagrafica?.addEventListener('change', syncSubflagsState);
    syncSubflagsState();

    btnApri?.addEventListener('click', apriModal);
    btnChiudi?.addEventListener('click', chiudiModal);
    btnAnnulla?.addEventListener('click', chiudiModal);

    modal.addEventListener('click', (e) => {
        if (e.target === modal) chiudiModal();
    });

    btnGeneraPdf.addEventListener('click', () => {
        mostraErrore('');
        const soci = typeof getSoci === 'function' ? getSoci() : [];

        try {
            generaPdfElencoSoci(soci, getExportOptions());
            chiudiModal();
        } catch (err) {
            console.error('PDF elenco soci:', err);
            mostraErrore(String(err?.message || err || 'Errore durante la generazione del PDF'));
        }
    });

    btnGeneraExcel?.addEventListener('click', () => {
        mostraErrore('');
        const soci = typeof getSoci === 'function' ? getSoci() : [];

        try {
            generaExcelElencoSoci(soci, getExportOptions());
            chiudiModal();
        } catch (err) {
            console.error('Excel elenco soci:', err);
            mostraErrore(String(err?.message || err || 'Errore durante la generazione del file Excel'));
        }
    });
}
