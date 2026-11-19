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
                if (boton.disabled) return;
                if (b.accion && (await b.accion(ctl, boton)) === false) return;
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
        const usuario = Auth.usuario();
        const nombre = Config.get().nombreComplejo;
        const enlace = (href, texto, clave) =>
            `<a href="${href}"${activa === clave ? ' aria-current="page"' : ''}>${texto}</a>`;

        const items = [enlace('index.html', 'Reservar', 'inicio'), enlace('perfil.html', 'Mis reservas', 'perfil'), enlace('torneos.html', 'Torneos', 'torneos')];
        if (usuario) {
            if (Auth.esStaff()) items.push(enlace('admin.html', 'Panel', 'admin'));
            items.push('<button type="button" class="nav-salir" data-accion="salir">Salir</button>');
        } else {
            items.push(enlace('login.html', 'Ingresar', 'login'));
        }

        const tipos = [...new Set(Config.canchasActivas().map((c) => c.tipo).filter(Boolean))].join(' · ');
        host.className = 'site-header';
        host.innerHTML = `
            <div class="header-inner">
                <a class="brand" href="index.html" aria-label="${Utils.esc(nombre)}, ir al inicio">
                    <img src="assets/logo-mark.svg" alt="" width="44" height="44">
                    <span class="brand-text"><strong>${Utils.esc(nombre)}</strong><small>${Utils.esc(tipos || 'Reservas online')}</small></span>
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
        const cfg = Config.get();
        const extras = [
            cfg.direccion ? `<a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(cfg.direccion)}" target="_blank" rel="noopener">${Utils.esc(cfg.direccion)}</a>` : '',
            cfg.instagram ? `<a href="https://instagram.com/${encodeURIComponent(cfg.instagram)}" target="_blank" rel="noopener">@${Utils.esc(cfg.instagram)}</a>` : '',
            cfg.whatsapp ? `<a href="${Utils.esc(Utils.linkWhatsApp(cfg.whatsapp))}" target="_blank" rel="noopener">WhatsApp</a>` : ''
        ].filter(Boolean).join(' · ');
        host.innerHTML = `${extras ? `<p class="pie-links">${extras}</p>` : ''}<p>© ${Utils.ahora().getUTCFullYear()} ${Utils.esc(cfg.nombreComplejo)}</p>`;
    }

    function montarWhatsapp() {
        const { whatsapp, nombreComplejo } = Config.get();
        if (!whatsapp || document.querySelector('.whatsapp-float')) return;
        const enlace = document.createElement('a');
        enlace.className = 'whatsapp-float';
        enlace.href = Utils.linkWhatsApp(whatsapp, `Hola, tengo una consulta sobre las reservas en ${nombreComplejo}.`);
        enlace.target = '_blank';
        enlace.rel = 'noopener';
        enlace.setAttribute('aria-label', 'Consultas por WhatsApp');
        enlace.title = 'Consultas por WhatsApp';
        enlace.innerHTML = '<svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true" fill="currentColor"><path d="M12.04 2a9.9 9.9 0 0 0-8.5 15l-1.4 5 5.1-1.3A9.9 9.9 0 1 0 12.04 2Zm0 18.1a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3a8.2 8.2 0 1 1 6.9 3.8Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.7.8-.8 1-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.3-.4.7-1.4.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.4.8 3.2.7a2.8 2.8 0 0 0 1.8-1.3 2.3 2.3 0 0 0 .2-1.3c-.1-.1-.3-.2-.5-.3Z"/></svg>';
        document.body.appendChild(enlace);
    }

    function iniciarPagina(activa) {
        montarEncabezado(activa);
        montarPie();
        montarWhatsapp();
    }

    function errorConexion(mensaje) {
        const main = document.getElementById('contenido');
        if (!main) return;
        main.hidden = false;
        main.innerHTML = `<div class="estado-vacio"><div class="estado-icono" aria-hidden="true">⚠</div>
            <h1>No pudimos cargar la página</h1><p class="muted">${Utils.esc(mensaje)}</p>
            <button type="button" class="btn" onclick="location.reload()">Reintentar</button></div>`;
    }

    // Arranque común: carga configuración y sesión, arma encabezado/pie y ejecuta la página.
    async function arrancar(pagina, fn) {
        try {
            await Promise.all([Config.cargar(), Auth.iniciar()]);
        } catch (error) {
            console.error(error);
            errorConexion(error.message || 'Revisá tu conexión a internet.');
            return;
        }
        document.title = document.title.replace(/Un Show Más/g, Config.get().nombreComplejo);
        iniciarPagina(pagina);
        try {
            await fn();
        } catch (error) {
            console.error(error);
            toast(error.message || 'Ocurrió un error inesperado.', 'error');
        }
    }

    // Ejecuta una acción asincrónica con el botón deshabilitado y un texto de espera.
    async function conBoton(boton, textoOcupado, tarea) {
        if (!boton) return tarea();
        const original = boton.innerHTML;
        boton.disabled = true;
        boton.setAttribute('aria-busy', 'true');
        boton.textContent = textoOcupado;
        try { return await tarea(); } finally {
            if (document.contains(boton)) {
                boton.disabled = false;
                boton.removeAttribute('aria-busy');
                boton.innerHTML = original;
            }
        }
    }

    return { modal, alerta, confirmar, toast, iniciarPagina, montarEncabezado, arrancar, conBoton };
})();
