# Conectar Mercado Pago (para hacer junto al dueño del complejo)

Tiempo: **10 minutos**. Se hace una sola vez. Hace falta:
- El celular o la computadora del dueño con **su cuenta de Mercado Pago** (donde quiere recibir la plata).
- Acceso al proyecto en **Vercel**.

> 🔒 El *Access Token* es como la llave de la caja: **nunca** se manda por WhatsApp, mail ni se pega
> en ningún chat. Solo se pega en Vercel.

---

## 1. Crear la "aplicación" en Mercado Pago

1. Entrar a **https://www.mercadopago.com.ar/developers** e iniciar sesión **con la cuenta del complejo**.
2. Arriba a la derecha: **Tus integraciones** → **Crear aplicación**.
3. Completar:
   - Nombre: `Reservas Un Show Más`
   - ¿Qué tipo de solución vas a integrar? → **Pagos online**
   - ¿Estás usando una plataforma de e-commerce? → **No**
   - ¿Qué producto vas a integrar? → **Checkout Pro**
4. Aceptar los términos y crear.

## 2. Activar las credenciales de producción

1. Dentro de la aplicación: menú **Producción → Credenciales de producción**.
2. Si lo pide, completar los datos del negocio (rubro: *Deportes / Alquiler de canchas*, sitio web:
   la dirección de la página de reservas).
3. Copiar el **Access Token** (empieza con `APP_USR-`). *No* hace falta la Public Key.

## 3. Pegar el token en Vercel

1. Entrar a **https://vercel.com** → proyecto **sistema-de-reservas** → **Settings** → **Environment Variables**.
2. **Add New**:
   - Key: `MP_ACCESS_TOKEN`
   - Value: *(pegar el Access Token)*
   - Environments: **Production** (y Preview si se quiere probar ahí)
   - Marcar **Sensitive**
3. Guardar.
4. Ir a **Deployments** → en el último, menú **⋯** → **Redeploy**.

## 4. (Recomendado) Firma de los avisos

1. En Mercado Pago, dentro de la aplicación: **Webhooks** → **Configurar notificaciones**.
2. URL de producción: `https://LA-DIRECCION-DE-LA-WEB/api/mp-webhook` · Evento: **Pagos**.
3. Guardar y copiar la **clave secreta** que muestra.
4. En Vercel crear `MP_WEBHOOK_SECRET` con esa clave (Sensitive) y volver a hacer **Redeploy**.

> Aunque no se haga este paso, el sistema igual funciona: cada aviso se verifica preguntándole
> el pago directamente a Mercado Pago, y además la web confirma el pago cuando el cliente vuelve.

## 5. Probar con plata de verdad (2 minutos)

1. En el panel → **Ajustes y cobros**: el cartel tiene que decir **"✅ Mercado Pago conectado"**.
2. Bajar momentáneamente la seña a **$ 100**, guardar.
3. Desde un celular, reservar un turno y pagar con otra cuenta/tarjeta.
4. Ver que el turno aparece **confirmado** en la grilla (en vivo) y que la plata entró a la cuenta.
5. Cancelar esa reserva desde el comprobante → la seña vuelve sola.
6. Volver a poner la seña en **$ 5.000**.

## Preguntas frecuentes

- **¿Dónde se ve la plata?** En la cuenta de Mercado Pago del complejo, como cualquier cobro.
- **¿Cuánto cobra Mercado Pago?** La comisión estándar de Checkout Pro según el plazo de
  acreditación elegido en la cuenta (se configura en Mercado Pago, no en la web).
- **¿Y si alguien paga tarde?** El turno se guarda 15 minutos (configurable). Si paga después y el
  horario ya lo tomó otro, el panel avisa "seña a devolver".
- **¿Por qué no aparece Rapipago/Pago Fácil?** Están desactivados a propósito: tardan días en
  acreditarse y el turno no puede quedar trabado.
- **Quiero volver al modo demostración:** borrar `MP_ACCESS_TOKEN` en Vercel y hacer Redeploy.
