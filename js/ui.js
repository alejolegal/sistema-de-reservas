// js/ui.js - Componentes de interfaz compartidos: encabezado, pie, modales, avisos.

const UI = (() => {
    let modalAbierto = null;

    // ---------- Modales accesibles (reemplazan alert/confirm del navegador) ----------
    // botones: [{ texto, clase, accion(ctl) }]  -> si accion devuelve false, el modal no se cierra.
    function modal({ titulo, cuerpo = '', botones = [], cerrable = true, clase = '', onCerrar = null }) {
        if (modalAbierto) modalAbierto.cerrar();

        const previo = document.activeElement;
        const tituloId = `modal-titulo-${Date.now()}`;
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
            <div class="modal-card ${clase}" role="dialog" aria-modal="true" aria-labelledby="${tituloId}" tabindex="-1">
                <h3 id="${tituloId}">${Utils.esc(titulo)}</h3>
                <div class="modal-body">${cuerpo}</div>
                <div class="modal-actions"></div>
            </div>`;

        const tarjeta = overlay.firstElementChild;
        const acciones = overlay.querySelector('.modal-actions');
        let cerrado = false;

        const ctl = { el: tarjeta, cuerpoEl: overlay.querySelector('.modal-body'), cerrar };

        function cerrar() {
            if (cerrado) return;
            cerrado = true;
            document.removeEventListener('keydown', alTeclear);
            overlay.remove();
            document.body.classList.remove('modal-abierto');
            if (modalAbierto === ctl) modalAbierto = null;
            if (previo && previo.focus && document.contains(previo)) previo.focus();
            if (onCerrar) onCerrar();
        }

        function alTeclear(e) {
            if (e.key === 'Escape' && cerrable) { cerrar(); return; }
            if (e.key !== 'Tab') return;
            const enfocables = tarjeta.querySelectorAll('button:not([disabled]), a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
            if (!enfocables.length) return;
            const primero = enfocables[0];
            const ultimo = enfocables[enfocables.length - 1];
            if (e.shiftKey && document.activeElement === primero) { e.preventDefault(); ultimo.focus(); }
            else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primero.focus(); }
        }

        const lista = botones.length || !cerrable ? botones : [{ texto: 'Cerrar', clase: 'btn-secundario' }];
        lista.forEach((b) => {
            const boton = document.createElement('button');
            boton.type = 'button';
            boton.className = `btn ${b.clase || ''}`.trim();
            boton.textContent = b.texto;
            boton.addEventListener('click', async () => {
                if (b.accion && (await b.accion(ctl)) === false) return;
                cerrar();
            });
            acciones.appendChild(boton);
        });

        if (cerrable) overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) cerrar(); });
        document.addEventListener('keydown', alTeclear);
        document.body.appendChild(overlay);
        document.body.classList.add('modal-abierto');
        (acciones.querySelector('button') || tarjeta).focus();

        modalAbierto = ctl;
        return ctl;
    }

    function alerta(titulo, mensajeHtml, textoOk = 'Entendido') {
        return new Promise((resolve) => {
            modal({ titulo, cuerpo: `<p>${mensajeHtml}</p>`, botones: [{ texto: textoOk }], onCerrar: resolve });
        });
    }

    function confirmar(titulo, mensajeHtml, { textoOk = 'Confirmar', textoCancelar = 'Volver', peligro = false } = {}) {
        return new Promise((resolve) => {
            let respuesta = false;
            modal({
                titulo,
                cuerpo: `<p>${mensajeHtml}</p>`,
                botones: [
                    { texto: textoCancelar, clase: 'btn-secundario' },
                    { texto: textoOk, clase: peligro ? 'btn-peligro' : '', accion: () => { respuesta = true; } }
                ],
                onCerrar: () => resolve(respuesta)
            });
        });
    }

    // ---------- Avisos breves ----------
    function toast(mensaje, tipo = 'ok') {
        let contenedor = document.getElementById('toasts');
        if (!contenedor) {
            contenedor = document.createElement('div');
            contenedor.id = 'toasts';
            contenedor.setAttribute('role', 'status');
            contenedor.setAttribute('aria-live', 'polite');
            document.body.appendChild(contenedor);
        }
        const aviso = document.createElement('div');
        aviso.className = `toast toast-${tipo}`;
        aviso.textContent = mensaje;
        contenedor.appendChild(aviso);
        setTimeout(() => {
            aviso.classList.add('saliendo');
            setTimeout(() => aviso.remove(), 300);
        }, 4200);
    }

    // ---------- Estructura común de las páginas ----------
    function montarEncabezado(activa = '') {
        const host = document.getElementById('site-header');
        if (!host) return;
        const usuario = Auth.usuarioActual();
        const nombre = Config.get().nombreComplejo;
        const enlace = (href, texto, clave) =>
            `<a href="${href}"${activa === clave ? ' aria-current="page"' : ''}>${texto}</a>`;

        const items = [enlace('index.html', 'Reservar', 'inicio'), enlace('torneos.html', 'Torneos', 'torneos')];
        if (usuario) {
            if (Auth.esStaff(usuario)) items.push(enlace('admin.html', 'Panel de gestión', 'admin'));
            items.push(enlace('perfil.html', 'Mi perfil', 'perfil'));
            items.push('<button type="button" class="nav-salir" data-accion="salir">Cerrar sesión</button>');
        } else {
            items.push(enlace('login.html', 'Ingresar', 'login'));
        }

        host.className = 'site-header';
        host.innerHTML = `
            <div class="header-inner">
                <a class="brand" href="index.html" aria-label="${Utils.esc(nombre)}, ir al inicio">
                    <img src="assets/logo-mark.svg" alt="" width="44" height="44">
                    <span class="brand-text"><strong>${Utils.esc(nombre)}</strong><small>Fútbol 5 · Fútbol 7 · Pádel</small></span>
                </a>
                <button type="button" class="nav-toggle" aria-expanded="false" aria-controls="nav-menu">Menú</button>
                <nav id="nav-menu" class="nav-menu" aria-label="Principal">${items.join('')}</nav>
            </div>`;

        const toggle = host.querySelector('.nav-toggle');
        const menu = host.querySelector('.nav-menu');
        toggle.addEventListener('click', () => {
            const abierto = menu.classList.toggle('abierto');
            toggle.setAttribute('aria-expanded', String(abierto));
        });
        const salir = host.querySelector('[data-accion="salir"]');
        if (salir) salir.addEventListener('click', Auth.logout);
    }

    function montarPie() {
        const host = document.getElementById('site-footer');
        if (!host) return;
        host.innerHTML = `<p>© ${new Date().getFullYear()} ${Utils.esc(Config.get().nombreComplejo)} · Todos los derechos reservados</p>`;
    }

    function montarWhatsapp() {
        const { whatsapp, nombreComplejo } = Config.get();
        if (!whatsapp || document.querySelector('.whatsapp-float')) return;
        const enlace = document.createElement('a');
        enlace.className = 'whatsapp-float';
        enlace.href = `https://wa.me/${whatsapp}?text=${encodeURIComponent(`Hola, tengo una consulta sobre las reservas en ${nombreComplejo}.`)}`;
        enlace.target = '_blank';
        enlace.rel = 'noopener';
        enlace.setAttribute('aria-label', 'Consultas por WhatsApp');
        enlace.title = 'Consultas por WhatsApp';
        enlace.innerHTML = '<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true" fill="currentColor"><path d="M4 3h16a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H9.5L5 21.500V18H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm4 6.500a1.200 1.200 0 1 0 0 2.400 1.200 1.200 0 0 0 0-2.400Zm4 0a1.200 1.200 0 1 0 0 2.400 1.200 1.200 0 0 0 0-2.400Zm4 0a1.200 1.200 0 1 0 0 2.400 1.200 1.200 0 0 0 0-2.400Z"/></svg>';
        document.body.appendChild(enlace);
    }

    function iniciarPagina(activa) {
        montarEncabezado(activa);
        montarPie();
        montarWhatsapp();
    }

    return { modal, alerta, confirmar, toast, iniciarPagina, montarEncabezado };
})();
