# Esquema y migración aislada de productos

Este componente **no adapta ni conecta el servidor a MySQL**. `server/index.mjs`
continúa usando SQLite. No ejecuta nada automáticamente y no modifica, elimina
ni respalda el SQLite de origen.

`schema.sql` contiene las 17 tablas actuales, sus claves e índices, para
InnoDB. El migrador crea ese esquema e importa **solo `products`**: conserva
IDs, stock, precios, fechas, JSON, rutas, textos y demás columnas. Las otras
tablas quedan vacías; no migra usuarios, pedidos ni ajustes.

## Condiciones de seguridad

- Solo admite una base de destino **sin tablas, vistas, rutinas, triggers ni
  eventos**. Una segunda ejecución se rechaza sin modificar la base: es
  idempotencia por rechazo, no una sincronización incremental.
- El origen se abre en modo lectura, con una instantánea SQLite que incluye
  WAL. Se rechazan columnas desconocidas o faltantes, texto UTF-8 inválido y
  fechas incompatibles, en vez de descartar o transformar datos silenciosamente.
- Las imágenes referenciadas se leen antes de importar y se exportan con sus
  rutas originales y un `manifest.json` de SHA-256. Se rechazan rutas no
  soportadas o archivos ausentes. La carpeta de salida debe **no existir** y
  su carpeta padre debe existir.
- Previo a exportar se comprueba que el destino está vacío. El propio SQL
  repite el control y obtiene un bloqueo consultivo en la conexión que crea
  el esquema e importa los productos. Los inserts y su verificación están en
  una única transacción y conexión. El bloqueo no detiene procesos ajenos que
  no lo respeten: usar una base dedicada, sin otros escritores.
- En MySQL/MariaDB el DDL confirma implícitamente: si falla la creación del
  esquema o la importación, pueden quedar tablas vacías. La transacción de
  productos se revierte al desconectar; las imágenes exportadas pueden quedar
  en la carpeta de salida. No hay limpieza automática ni reintento destructivo.
  Inspeccionar manualmente antes de cualquier intervención.
- Se exige SSH con host conocido (`StrictHostKeyChecking=yes`) y autenticación
  no interactiva. La contraseña de MySQL permanece en el archivo de opciones
  remoto; no se lee ni se pasa como argumento. Verificar los privilegios de la
  cuenta, ya que las comprobaciones de `information_schema` requieren poder
  ver los objetos del destino.

## Uso explícito

Node 24 y el cliente `ssh` deben estar disponibles. Ejemplo de sintaxis en
PowerShell: sustituir los valores entre ángulos. La base de prueba utilizada
en esta tarea ya no está vacía y debe rechazar este comando.

```powershell
node mysql-migration\migrate.mjs `
  --sqlite <ruta-sqlite> --project <carpeta-proyecto> `
  --images-out <carpeta-nueva> --database <base-vacia> `
  --host <host-ssh> --user <usuario-ssh> --port <puerto-ssh> `
  --identity <archivo-clave-local> --defaults-file <archivo-opciones-remoto>
```

Opcionalmente, `--uploads`, `--ident` y `--gifts` seleccionan los directorios
de origen de imágenes. Por defecto son `uploads`, `ident` y `public\gifts`
bajo `--project`. En producción, `UPLOAD_DIR` puede estar fuera del proyecto:
hay que indicar su ruta real. La salida contiene `uploads`, `ident` y `gifts`
según las URLs de los productos. No se copia ni publica nada en el servidor.
En particular, el backend actual no sirve `/ident` en producción; conservar
los archivos no hace que esas URLs sean accesibles.

## Pruebas y resultados

- `node --test mysql-migration\migrate.test.mjs`: pruebas sin conexión.
- Para la integración, configurar `UNFOCUS_MARIADB_TEST=1` y las variables
  `UNFOCUS_TEST_DATABASE`, `UNFOCUS_TEST_SSH_HOST`, `UNFOCUS_TEST_SSH_USER`,
  `UNFOCUS_TEST_SSH_PORT`, `UNFOCUS_TEST_SSH_IDENTITY` y
  `UNFOCUS_TEST_MYSQL_DEFAULTS`, y ejecutar `node --test mysql-migration\*.test.mjs`.
  La base debe terminar en `test` o `prueba` y contener los productos importados
  desde `data\unfocus.sqlite`; la prueba no la vacía ni borra pedidos.
- `npm test` y `npm run lint`: pruebas y lint existentes.

Validación realizada: MariaDB 11.8.9, base de prueba inicialmente vacía;
17 tablas y 3 productos locales importados; comparación de todos los campos,
9 imágenes comparadas byte a byte y por hash, segunda ejecución rechazada y
clave foránea comprobada con rollback. El resto de tablas quedó vacío.
Las 7 pruebas unitarias, la integración, las 20 pruebas existentes y lint
pasaron. La base de prueba conserva el esquema y los productos importados.

No se ha probado MySQL Oracle ni otra versión de MariaDB. El esquema usa
valores predeterminados de texto con expresiones, disponibles en MySQL 8.0.13+
y comprobados en MariaDB 11.8.9; colaciones, límites y comportamiento de
consultas deben validarse contra el motor real. El backend sigue necesitando
una adaptación completa y pruebas transaccionales antes de utilizarlo con
MySQL/MariaDB. No se ha accedido a datos ni credenciales de producción, ni
desplegado o reiniciado la aplicación.
