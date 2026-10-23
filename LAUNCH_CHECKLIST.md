# Checklist de lanzamiento a producción

Proceso de salida a producción en Hostinger. El desarrollo de funcionalidades sigue en [`todo`](./todo).

Ramas: `dev` es la de desarrollo y `main` es la que se despliega en Hostinger.

## 1. Hostinger

- [ ] Crear el subdominio de prueba (`dev.unfocus.shop`) o usar `unfocus.shop` directamente.
- [ ] Crear la Node.js Web App conectada a la rama `main` del repo `NicoAquino67/Unfocus-store`.
- [ ] Elegir Node 22 o superior (necesario para `node:sqlite`).
- [ ] Build: `npm install && npm run build`. Start: `npm start`.
- [ ] Confirmar que el HTTPS del dominio está activo.
- [ ] Crear una carpeta persistente fuera de la app (ej. `/home/USUARIO/unfocus-data`).
- [ ] Definir `DATABASE_PATH`, `UPLOAD_DIR` e `IDENT_DIR` apuntando a esa carpeta.
- [ ] Copiar allí las imágenes de `ident/` (no están en git).

## 2. Variables de entorno (cargar en el panel, nunca en git)

- [ ] `NODE_ENV=production`
- [ ] `PUBLIC_BASE_URL` con el dominio final.
- [ ] `ADMIN_EMAIL` y `ADMIN_PASSWORD` (contraseña fuerte).
- [ ] `MP_ACCESS_TOKEN` (primero de prueba, luego real).
- [ ] `MP_ENVIRONMENT`.
- [ ] `MP_WEBHOOK_URL=<dominio>/api/payments/webhook`
- [ ] `MP_WEBHOOK_SECRET` (clave secreta de Webhooks del panel de Mercado Pago).
- [ ] `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `CONTACT_FROM_EMAIL`, `CONTACT_TO_EMAIL`.
- [ ] Datos de la tienda: `STORE_LEGAL_NAME`, `STORE_TAX_ID`, `STORE_ADDRESS`, `STORE_EMAIL`, `STORE_PHONE`.
- [ ] Envío: `SHIPPING_COST_ARS`, `FREE_SHIPPING_THRESHOLD_ARS`, `PICKUP_ADDRESS`.
- [ ] `PENDING_ORDER_EXPIRY_DAYS` (3 por defecto).

## 3. Mercado Pago

- [ ] Registrar el webhook de producción en el panel de Mercado Pago.
- [ ] Probar el flujo completo con credenciales de prueba:
  - [ ] Pago aprobado.
  - [ ] Pago rechazado y reintento.
  - [ ] Pedido pendiente que retoma el pago.
  - [ ] Pedido que se cancela tras 3 rechazos.
- [ ] Confirmar que el webhook llega y que el `x-signature` se valida.
- [ ] Pasar a credenciales reales.
- [ ] Hacer una compra real de monto bajo y revisar pedido, email y stock.
- [ ] Reembolsar la compra de prueba desde Mercado Pago.

## 4. Contenido y datos (panel admin)

- [ ] Cargar datos bancarios para transferencias.
- [ ] Cargar los datos legales de la tienda.
- [ ] Revisar los textos legales: términos, privacidad, devoluciones, defensa del consumidor y botón de baja.
- [ ] Cargar productos reales: fotos (mínimo 3), precios, talles y stock.
- [ ] Revisar o eliminar el stock y los descuentos de prueba.
- [ ] Revisar la tarjeta de regalo (rangos y monto libre).
- [ ] Crear los cupones iniciales, si aplica.
- [ ] Revisar las preguntas frecuentes.

## 5. Pruebas finales en el sitio publicado

- [ ] Registro, login y recuperación de contraseña.
- [ ] Compra como invitado y con cuenta.
- [ ] Cupón, envío y retiro.
- [ ] Transferencia: se ve la sección con los datos de cuenta.
- [ ] Emails: bienvenida, pedido creado, cambio de estado y contacto.
- [ ] Admin: cancelar un pedido y comprobar que se restaura el stock.
- [ ] Cambiar estado de pedidos y comprobar el seguimiento.
- [ ] Revisar en móvil.
- [ ] Prueba manual de accesibilidad: lector de pantalla y zoom 200 %.
- [ ] Revisar Lighthouse (rendimiento).

## 6. Operación

- [ ] Backup periódico de la base y de las imágenes (carpeta persistente).
- [ ] Probar una restauración del backup.
- [ ] Proteger la rama `main` en GitHub (Settings → Branches).
- [ ] Revisar los logs tras el lanzamiento.
- [ ] Verificar que no hay secretos en el repo.

## Flujo de ramas

1. Desarrollar y probar en `dev`.
2. Cuando esté probado: `git checkout main`, `git merge dev` y `git push origin main`.
3. Hostinger redespliega desde `main`.
4. Volver a `dev` para seguir trabajando.
