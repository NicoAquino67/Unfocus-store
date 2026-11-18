import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

export const productColumns = [
  'id', 'slug', 'name', 'category', 'price_ars', 'garment_cost_ars',
  'logistics_cost_ars', 'production_cost_ars', 'tax_percent', 'profit_percent',
  'stock', 'stock_by_size', 'composition', 'features_json', 'description',
  'design_description', 'front_image', 'front_alt', 'back_image', 'back_alt',
  'badge', 'created_at', 'updated_at', 'is_gift_card', 'discount_type',
  'discount_value', 'extra_images', 'colors_json',
]

const numericColumns = new Set([
  'id', 'price_ars', 'garment_cost_ars', 'logistics_cost_ars',
  'production_cost_ars', 'tax_percent', 'profit_percent', 'stock',
  'is_gift_card', 'discount_value',
])

export function readProductsFromDatabase(db) {
  db.exec('PRAGMA query_only = ON; BEGIN')
  try {
    const columns = db.prepare('PRAGMA table_xinfo(products)').all().map((row) => row.name)
    if (columns.length !== productColumns.length || productColumns.some((name) => !columns.includes(name))) {
      throw new Error('El esquema SQLite de products no coincide; no se omitirán columnas.')
    }
    const textColumns = productColumns.filter((column) => !numericColumns.has(column))
    const blobs = textColumns.map((column) => `CAST(\`${column}\` AS BLOB) AS \`__bytes_${column}\``)
    const query = db.prepare(`SELECT *, ${blobs.join(', ')} FROM products ORDER BY id`)
    query.setReadBigInts(true)
    const products = query.all()
    for (const product of products) {
      for (const column of textColumns) {
        const bytes = product[`__bytes_${column}`]
        if (typeof product[column] === 'string' && !Buffer.from(product[column], 'utf8').equals(Buffer.from(bytes))) {
          throw new Error(`UTF-8 inválido en ${column}; se rechaza para preservar los datos.`)
        }
        delete product[`__bytes_${column}`]
      }
    }
    db.exec('COMMIT')
    return products
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export function readProducts(filename) {
  const db = new DatabaseSync(filename, { readOnly: true })
  try { return readProductsFromDatabase(db) } finally { db.close() }
}

export function sqlValue(value) {
  if (typeof value === 'string') return `CONVERT(X'${Buffer.from(value, 'utf8').toString('hex')}' USING utf8mb4)`
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (value === null) return 'NULL'
  throw new Error('Tipo de dato SQLite no admitido.')
}

export function validateProducts(products) {
  const ids = new Set()
  for (const product of products) {
    if (typeof product.id !== 'bigint' || product.id < 0n) throw new Error('ID de producto inválido.')
    if (ids.has(product.id.toString())) throw new Error('ID de producto duplicado.')
    ids.add(product.id.toString())
    for (const column of productColumns) {
      const value = product[column]
      if (numericColumns.has(column)) {
        if (!(typeof value === 'bigint' || (typeof value === 'number' && Number.isFinite(value)))) {
          throw new Error(`Campo numérico inválido: ${column}.`)
        }
      } else if (typeof value !== 'string') {
        throw new Error(`Campo de texto inválido: ${column}.`)
      }
    }
    for (const column of ['created_at', 'updated_at']) {
      if (!/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(product[column])) {
        throw new Error(`Fecha incompatible en ${column}; se rechaza para evitar alterarla.`)
      }
    }
  }
}

export function productImageUrls(products) {
  const urls = new Set()
  for (const product of products) {
    urls.add(product.front_image)
    urls.add(product.back_image)
    let extra
    try { extra = JSON.parse(product.extra_images) } catch { throw new Error('extra_images no contiene JSON válido.') }
    if (!Array.isArray(extra)) throw new Error('extra_images debe ser una lista.')
    for (const image of extra) {
      if (typeof image?.src !== 'string') throw new Error('Imagen adicional sin ruta válida.')
      urls.add(image.src)
    }
  }
  return [...urls].sort()
}

export async function collectImages(products, roots) {
  const files = []
  for (const url of productImageUrls(products)) {
    let root
    let filename
    if (/^\/uploads\/[a-zA-Z0-9_-]+\.(jpg|png|webp)$/.test(url)) {
      root = roots.uploads
      filename = url.slice('/uploads/'.length)
    } else if (/^\/ident\/productos\/[a-zA-Z0-9_-]+\.jpg$/.test(url)) {
      root = path.join(roots.ident, 'productos')
      filename = url.slice('/ident/productos/'.length)
    } else if (/^\/gifts\/[a-zA-Z0-9_-]+\.svg$/.test(url)) {
      root = roots.gifts
      filename = url.slice('/gifts/'.length)
    } else {
      throw new Error(`Ruta de imagen no admitida: ${url}`)
    }
    const bytes = await readFile(path.join(root, filename))
    files.push({ url, bytes, sha256: createHash('sha256').update(bytes).digest('hex') })
  }
  return files
}

export async function exportImages(files, output) {
  await mkdir(output)
  for (const file of files) {
    const destination = path.join(output, ...file.url.slice(1).split('/'))
    await mkdir(path.dirname(destination), { recursive: true })
    await writeFile(destination, file.bytes, { flag: 'wx' })
  }
  const manifest = files.map(({ url, sha256, bytes }) => ({ url, sha256, bytes: bytes.length }))
  await writeFile(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' })
}

export function validateTarget({ database, host, user, port, defaultsFile }) {
  if (!/^[A-Za-z0-9_]{1,64}$/.test(database || '')) throw new Error('Nombre de base inválido.')
  if (!/^[A-Za-z0-9.-]+$/.test(host || '') || host.startsWith('-')) throw new Error('Host SSH inválido.')
  if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(user || '')) throw new Error('Usuario SSH inválido.')
  if (!/^\d{1,5}$/.test(port || '') || Number(port) < 1 || Number(port) > 65535) throw new Error('Puerto SSH inválido.')
  if (!/^\/[A-Za-z0-9_./-]+$/.test(defaultsFile || '') || defaultsFile.split('/').includes('..')) {
    throw new Error('Ruta defaults-extra-file inválida.')
  }
}

export function emptyDestinationGuard(database) {
  if (!/^[A-Za-z0-9_]{1,64}$/.test(database)) throw new Error('Nombre de base inválido.')
  return `
SET NAMES utf8mb4;
SET SESSION sql_mode = 'STRICT_ALL_TABLES,NO_ENGINE_SUBSTITUTION,NO_AUTO_VALUE_ON_ZERO';
SET SESSION time_zone = '+00:00';
SET @lock_name = CONCAT('unfocus:', SUBSTRING(SHA2(DATABASE(), 256), 1, 48));
SET @lock_acquired = GET_LOCK(@lock_name, 0);
SET @empty = DATABASE() = '${database}'
  AND @lock_acquired = 1
  AND (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()) = 0
  AND (SELECT COUNT(*) FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = DATABASE()) = 0
  AND (SELECT COUNT(*) FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE()) = 0
  AND (SELECT COUNT(*) FROM information_schema.EVENTS WHERE EVENT_SCHEMA = DATABASE()) = 0;
SET @guard = IF(@empty, 'DO 0', 'SIGNAL SQLSTATE ''45000'' SET MESSAGE_TEXT = ''Destino no vacío o bloqueo no disponible''');
PREPARE guard FROM @guard;
EXECUTE guard;
DEALLOCATE PREPARE guard;
`
}

export function buildSql(schema, products, database) {
  validateProducts(products)
  const checks = products.map((product) => {
    const comparisons = productColumns.map((column) => {
      const prefix = numericColumns.has(column) ? '' : 'BINARY '
      return `${prefix}\`${column}\` <=> ${prefix}${sqlValue(product[column])}`
    })
    return `SET @ok = @ok AND (SELECT COUNT(*) = 1 FROM products WHERE ${comparisons.join(' AND ')});`
  })
  const rows = products.map((product) =>
    `INSERT INTO products (${productColumns.map((column) => `\`${column}\``).join(', ')}) VALUES (${productColumns.map((column) => sqlValue(product[column])).join(', ')});`,
  )
  return `
${emptyDestinationGuard(database)}
${schema}
START TRANSACTION;
${rows.join('\n')}
SET @ok = (SELECT COUNT(*) = ${products.length} FROM products);
${checks.join('\n')}
SET @guard = IF(@ok, 'DO 0', 'SIGNAL SQLSTATE ''45000'' SET MESSAGE_TEXT = ''La verificación de productos falló''');
PREPARE guard FROM @guard;
EXECUTE guard;
DEALLOCATE PREPARE guard;
COMMIT;
SELECT RELEASE_LOCK(@lock_name);
`
}

export function executeSql(target, sql) {
  validateTarget(target)
  if (!target.identity) throw new Error('Falta el archivo de identidad SSH.')
  const command = `mysql --defaults-extra-file=${target.defaultsFile} --database=${target.database} --default-character-set=utf8mb4 --batch --skip-column-names --skip-force --skip-reconnect`
  return new Promise((resolve, reject) => {
    const child = spawn('ssh', [
      '-i', target.identity, '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
      '-o', 'ConnectTimeout=15', '-p', target.port, `${target.user}@${target.host}`, command,
    ], { stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', reject)
    child.stdin.on('error', () => {})
    child.on('close', (code) => {
      if (code !== 0) reject(new Error(`La migración falló (SSH/MySQL ${code}): ${stderr.trim()}`))
      else resolve(stdout)
    })
    child.stdin.end(sql)
  })
}

function parseArgs(args) {
  const result = {}
  const names = new Set(['sqlite', 'project', 'uploads', 'ident', 'gifts', 'images-out', 'database', 'host', 'user', 'port', 'identity', 'defaults-file'])
  for (let index = 0; index < args.length; index += 2) {
    const arg = args[index]
    if (!arg?.startsWith('--') || !names.has(arg.slice(2)) || !args[index + 1] || args[index + 1].startsWith('--')) throw new Error('Argumentos inválidos.')
    const name = arg.slice(2)
    if (Object.hasOwn(result, name)) throw new Error(`Argumento repetido: ${arg}`)
    result[name] = args[index + 1]
  }
  return result
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  for (const name of ['sqlite', 'project', 'images-out', 'database', 'host', 'user', 'port', 'identity', 'defaults-file']) {
    if (!args[name]) throw new Error(`Falta --${name}.`)
  }
  const target = { database: args.database, host: args.host, user: args.user, port: args.port, identity: args.identity, defaultsFile: args['defaults-file'] }
  validateTarget(target)
  const project = path.resolve(args.project)
  const products = readProducts(path.resolve(args.sqlite))
  validateProducts(products)
  const files = await collectImages(products, {
    uploads: path.resolve(args.uploads || path.join(project, 'uploads')),
    ident: path.resolve(args.ident || path.join(project, 'ident')),
    gifts: path.resolve(args.gifts || path.join(project, 'public', 'gifts')),
  })
  const schema = await readFile(new URL('./schema.sql', import.meta.url), 'utf8')
  const sql = buildSql(schema, products, target.database)
  await executeSql(target, emptyDestinationGuard(target.database))
  await exportImages(files, path.resolve(args['images-out']))
  await executeSql(target, sql)
  console.log(`Migrados ${products.length} productos. Exportadas ${files.length} imágenes con manifiesto.`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1 })
}
