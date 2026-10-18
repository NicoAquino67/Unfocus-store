# UnFocus Mall

Tienda de ropa con React, Vite, Express y SQLite. Los precios se almacenan en pesos argentinos (ARS); la tienda puede mostrar una conversión indicativa a USD.

## Requisitos

- Node.js 24 o superior (usa el módulo integrado `node:sqlite`)
- npm

## Desarrollo

1. Copia `.env.example` como `.env`.
2. Define `ADMIN_EMAIL` y `ADMIN_PASSWORD` en `.env`. La contraseña inicial debe tener al menos 14 caracteres.
3. Ejecuta `npm run dev`.

Vite y la API se inician juntos. La tienda queda en `http://localhost:5173` (si el puerto está ocupado, Vite elige el siguiente) y la API escucha en el puerto `3001`.

En el primer arranque se crea/promueve como administrador el correo indicado en `ADMIN_EMAIL`. Las cuentas registradas desde la tienda siempre son clientes; la API no acepta que el usuario elija o cambie su rol. El rol no se muestra en la interfaz.

## Cuentas y pedidos

El registro crea una cuenta de cliente. Las sesiones usan cookies `HttpOnly` y las contraseñas se derivan con scrypt. Favoritos, pedidos y notificaciones quedan asociados a la cuenta en SQLite.

### Checkout y envío

1. En la bolsa, "Continuar" abre el paso **Datos de entrega**: nombre, teléfono, domicilio (o retiro en persona si hay dirección de retiro configurada), localidad, provincia, código postal e indicaciones. Los datos se precargan desde el último pedido.
2. Hay que aceptar los términos y condiciones.
3. El pedido se guarda en ARS con estado **Pendiente de pago** (subtotal + envío) y se redirige a Mercado Pago.

El costo de envío, el umbral de envío gratis, la dirección de retiro y los datos legales de la tienda se editan en **Administrar tienda → Envíos y datos legales** (valores iniciales desde `.env`: `SHIPPING_COST_ARS`, `FREE_SHIPPING_THRESHOLD_ARS`, `PICKUP_ADDRESS`, `STORE_*`). El envío por defecto es 0.

### Estados de pedido

`pending_payment` → `paid` → `shipped` → `delivered`, o `cancelled`.

- Pagado: lo confirma el webhook de Mercado Pago (o el admin).
- Enviado/Entregado: solo para pedidos pagados. Al marcar "enviado" el admin indica transporte, código y link de seguimiento, que el cliente ve en su cuenta.
- Un pedido pendiente conserva el enlace para reintentar el pago. Con más de 3 pagos rechazados se cancela y se libera el stock.
- Una notificación repetida de Mercado Pago no revierte un pedido ya enviado.

### Emails

Se envían por SMTP (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_SECURE`, `CONTACT_FROM_EMAIL`): pago recibido, pedido despachado, pedido cancelado, recuperación de contraseña y formulario de contacto. Sin SMTP configurado no se envía nada y la app sigue funcionando.

### Funcionalidades de tienda

- **Expiración de pedidos**: los pedidos en `pending_payment` pasan a cancelados tras `PENDING_ORDER_EXPIRY_DAYS` (3 por defecto) y devuelven stock, cupón y saldo de tarjeta.
- **Webhook seguro**: se valida la cabecera `x-signature` con `MP_WEBHOOK_SECRET` (clave secreta de Webhooks en el panel de Mercado Pago).
- **Cuotas y medios de pago**: los gestiona Mercado Pago. La transferencia bancaria se configura en el admin (titular, banco, CBU, alias) y el checkout muestra los pasos.
- **Stock**: cancelar un pedido desde el admin restaura stock (y cupón/saldo de tarjeta); reactivarlo lo vuelve a descontar.
- **Emails**: bienvenida, pedido creado, pago confirmado, envío; baja de newsletter con enlace.
- **Defensa del consumidor** y botón de baja en el pie y en las páginas legales.
- **Catálogo**: orden por precio, novedad y popularidad; "vistos recientemente" (con recomendaciones aleatorias para usuarios nuevos, sin repetir el producto abierto); galería de 3 a 10 imágenes con zoom (admin con carga múltiple).
- **Preguntas frecuentes**: página `?legal=faq` con las dudas más comunes.
- **Compra como invitado**: sin cuenta, con nombre, email y teléfono; si el email ya tiene cuenta se pide iniciar sesión. Al registrarse con ese email se heredan los pedidos.
- **Cupones**: porcentaje o monto fijo, mínimo de compra, usos máximos y vencimiento; se administran en el panel admin. No aplican a tarjetas de regalo.
- **Tarjeta de regalo**: producto digital de 30.000 a 1.000.000 ARS (montos predefinidos o libre). Al confirmarse el pago se envía por email un código `GC-XXXX-XXXX-XXXX`, canjeable (parcial o total) en el checkout. El admin ve las tarjetas emitidas y su saldo.
- **Descuentos por producto**: el admin define un descuento porcentual (1-90 %) o en pesos sobre el precio original, que nunca se modifica. Se muestra el precio tachado, el final y la etiqueta -X %; el servidor cobra siempre el precio con descuento.
- **Accesibilidad (WCAG 2.2 AA)**: enlace "Saltar al contenido", contraste de texto >= 4,5:1, objetivos t
á
ctiles >= 24 px, bolsa como di
á
logo con foco atrapado y Escape, nombres accesibles coherentes con el texto visible y `prefers-reduced-motion`. Auditado con axe-core sin violaciones en tienda, bolsa y panel admin.

### Páginas legales

Términos y condiciones, política de privacidad, cambios y devoluciones y botón de arrepentimiento (`?legal=terminos|privacidad|cambios|arrepentimiento`), enlazadas desde el pie. Son textos genéricos que deben ser revisados por un profesional antes de vender. La guía de talles (ficha de producto) usa medidas orientativas definidas en `garmentMeasurements` (`src/App.tsx`): reemplázalas por las reales.
## Monedas

ARS es la moneda base de catálogo, administración y pedidos. Si `USD_ARS_RATE` queda vacío, la API consulta la cotización de venta oficial publicada por DolarAPI; la cifra USD es informativa. Se puede fijar una tasa propia en `.env` si la política comercial requiere otra referencia.

## Persistencia y despliegue

- SQLite: `data/unfocus.sqlite` (se puede cambiar con `DATABASE_PATH`).
- Imágenes subidas desde el panel: `uploads/`.
- `.env`, la base de datos y las imágenes subidas están excluidos de Git.
- Para producción, configura `NODE_ENV=production`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, almacenamiento persistente y HTTPS; ejecuta `npm run build` y luego `npm start`.

## Mercado Pago

Para habilitar pago online, completa en `.env`:

- `MP_ACCESS_TOKEN`: token de acceso privado de Mercado Pago.
- `PUBLIC_BASE_URL`: URL pública de la tienda, por ejemplo `https://unfocus.shop`.

Cuando `MP_ACCESS_TOKEN` existe, el checkout crea una preferencia de pago (con el envío como ítem si tiene costo) y redirige a la pasarela. El webhook `POST /api/payments/webhook` actualiza el estado del pedido a `paid` cuando Mercado Pago lo confirme.

- `MP_RETURN_URL`: a dónde vuelve el comprador. `auto_return` solo se envía si es HTTPS.
- Local: Mercado Pago necesita una URL pública para el webhook. Usa un túnel (por ejemplo `cloudflared tunnel --url http://localhost:3001`) y define `MP_WEBHOOK_URL` con la URL resultante; cambia cada vez que se reinicia el túnel.
- Producción: no definas `MP_WEBHOOK_URL`; con `NODE_ENV=production` se usa `PUBLIC_BASE_URL/api/payments/webhook`.
- Un pedido se cancela automáticamente con más de 3 intentos de pago rechazados.
- Pendiente: verificar la firma `x-signature` de las notificaciones.

### Paquete Docker

El ZIP `unfocus-deploy.zip` incluye el código, los recursos de marca y la configuración Docker, pero no `.env`, usuarios, SQLite ni imágenes subidas. En el host:

1. Descomprime el ZIP y copia `.env.example` a `.env`.
2. Completa `ADMIN_EMAIL` y `ADMIN_PASSWORD` con una contraseña nueva de al menos 14 caracteres. No uses valores de ejemplo ni compartas el archivo.
3. Configura `APP_PORT` si el puerto 3001 está ocupado.
4. Con HTTPS configurado en el host o proxy, deja `COOKIE_SECURE` vacío. Para una prueba HTTP local solamente, usa `COOKIE_SECURE=false`.
5. Ejecuta `docker compose up -d --build` y revisa `docker compose logs -f unfocus`.

Docker conserva la base SQLite y las imágenes cargadas en `data/` y `uploads/`. Este entorno no tiene Docker instalado, por lo que el archivo de Compose no se pudo ejecutar aquí; la API y la compilación se validan localmente con Node.

Comprobaciones locales: `npm run build` y `npm run lint`.

## Lista de pendientes


Estado actual: MVP funcional y base de datos reiniciada (solo cuenta admin y catálogo con 10 unidades por prenda). Antes de vender hay que definir `MP_WEBHOOK_SECRET`, cargar datos bancarios y legales en el admin, probar pagos reales y desplegar las imágenes de `ident/`. Detalle en [`todo`](./todo).

Ver el archivo [`todo`](./todo): checklist del MVP y comparativa con tiendas como nike.com.
