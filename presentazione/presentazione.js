(() => {
    const slides = Array.from(document.querySelectorAll('.slide'));
    const counter = document.getElementById('preso-counter');
    const progress = document.getElementById('preso-progress');
    const btnPrev = document.getElementById('btn-prev');
    const btnNext = document.getElementById('btn-next');
    let index = 0;

    function show(i) {
        index = Math.max(0, Math.min(slides.length - 1, i));
        slides.forEach((slide, n) => {
            slide.classList.toggle('is-active', n === index);
        });
        counter.textContent = `${index + 1} / ${slides.length}`;
        const pct = ((index + 1) / slides.length) * 100;
        progress.style.setProperty('--progress', `${pct}%`);
        btnPrev.disabled = index === 0;
        btnNext.disabled = index === slides.length - 1;
        const title = slides[index]?.dataset.title || '';
        document.title = title
            ? `${title} — AUSER Gestione Operativa`
            : 'Presentazione — AUSER Gestione Operativa';
    }

    btnPrev?.addEventListener('click', () => show(index - 1));
    btnNext?.addEventListener('click', () => show(index + 1));

    document.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') {
            e.preventDefault();
            show(index + 1);
        } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
            e.preventDefault();
            show(index - 1);
        } else if (e.key === 'Home') {
            show(0);
        } else if (e.key === 'End') {
            show(slides.length - 1);
        } else if (e.key === 'f' || e.key === 'F') {
            if (!document.fullscreenElement) {
                document.documentElement.requestFullscreen?.();
            } else {
                document.exitFullscreen?.();
            }
        }
    });

    show(0);
})();
