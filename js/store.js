// js/store.js - Capa de persistencia (localStorage).
// Es el ÚNICO archivo que toca localStorage: cuando se migre a Supabase,
// alcanza con reemplazar las funciones de este módulo.

const Store = (() => {
    const CLAVES = {
        config: 'configComplejo',
        usuarios: 'usuarios',
        reservas: 'reservas',
        cerradas: 'fechasCerradas',
        sesion: 'sesionId',
        sesionLegado: 'usuarioLogueado'
    };

    function leer(clave, defecto) {
        try {
            const crudo = localStorage.getItem(clave);
            return crudo === null ? defecto : JSON.parse(crudo);
        } catch (error) {
            console.error(`No se pudo leer "${clave}":`, error);
            return defecto;
        }
    }

    function guardar(clave, valor) {
        try {
            localStorage.setItem(clave, JSON.stringify(valor));
            return true;
        } catch (error) {
            console.error(`No se pudo guardar "${clave}":`, error);
            return false;
        }
    }

    function quitar(clave) {
        try {
            localStorage.removeItem(clave);
        } catch (error) {
            console.error(`No se pudo borrar "${clave}":`, error);
        }
    }

    const lista = (clave) => {
        const valor = leer(clave, []);
        return Array.isArray(valor) ? valor : [];
    };

    // Versiones anteriores guardaban el usuario completo (con contraseña) en la sesión.
    // Ahora solo se guarda el id y se migra la sesión existente.
    function migrarSesionLegada() {
        const legado = leer(CLAVES.sesionLegado, null);
        if (legado) {
            if (legado.id && !leer(CLAVES.sesion, null)) guardar(CLAVES.sesion, legado.id);
            quitar(CLAVES.sesionLegado);
        }
    }
    migrarSesionLegada();

    return {
        CLAVES,
        leer,
        guardar,
        quitar,

        usuarios: () => lista(CLAVES.usuarios),
        guardarUsuarios: (usuarios) => guardar(CLAVES.usuarios, usuarios),

        reservasCrudas: () => lista(CLAVES.reservas),
        guardarReservas: (reservas) => guardar(CLAVES.reservas, reservas),

        fechasCerradas: () => lista(CLAVES.cerradas),
        guardarFechasCerradas: (fechas) => guardar(CLAVES.cerradas, fechas),

        sesionId: () => leer(CLAVES.sesion, null),
        iniciarSesion: (id) => guardar(CLAVES.sesion, id),
        cerrarSesion: () => quitar(CLAVES.sesion),

        // Respaldo completo de los datos del complejo.
        exportarTodo() {
            return {
                version: 1,
                exportadoEn: new Date().toISOString(),
                config: leer(CLAVES.config, {}),
                usuarios: lista(CLAVES.usuarios),
                reservas: lista(CLAVES.reservas),
                fechasCerradas: lista(CLAVES.cerradas)
            };
        },

        importarTodo(datos) {
            const valido = datos && typeof datos === 'object'
                && Array.isArray(datos.usuarios)
                && Array.isArray(datos.reservas)
                && Array.isArray(datos.fechasCerradas)
                && datos.config && typeof datos.config === 'object';
            if (!valido) return false;
            guardar(CLAVES.config, datos.config);
            guardar(CLAVES.usuarios, datos.usuarios);
            guardar(CLAVES.reservas, datos.reservas);
            guardar(CLAVES.cerradas, datos.fechasCerradas);
            return true;
        }
    };
})();
