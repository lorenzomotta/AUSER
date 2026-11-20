function adattaTelefono() {
    const telefono = document.querySelector('.telefono');
    if (!telefono) return;
    const altezza = Math.min(780, window.innerHeight - 140);
    telefono.style.height = `${Math.max(520, altezza)}px`;
}

adattaTelefono();
window.addEventListener('resize', adattaTelefono);
