import assert from 'node:assert/strict'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { buildSql, collectImages, productColumns, productImageUrls, readProductsFromDatabase, sqlValue, validateProducts, validateTarget } from './migrate.mjs'

const product = {
  id: 42n, slug: 'camiseta', name: "Algodón 'suave' 🧡", category: 'Remeras',
  price_ars: 1000n, garment_cost_ars: 10n, logistics_cost_ars: 20n,
  production_cost_ars: 30n, tax_percent: 5.5, profit_percent: 42.25,
  stock: 3n, stock_by_size: '{"S":1,"M":2}', composition: 'Algodón',
  features_json: '["suave"]', description: 'Una prenda', design_description: 'Diseño',
  front_image: '/gifts/tarjeta-1.svg', front_alt: 'Frente',
  back_image: '/gifts/tarjeta-2.svg', back_alt: 'Espalda', badge: '',
  created_at: '2026-01-02 03:04:05', updated_at: '2026-02-03 04:05:06',
  is_gift_card: 0n, discount_type: 'none', discount_value: 0n,
  extra_images: '[{"src":"/gifts/tarjeta-3.svg","alt":"Otra"}]', colors_json: '[]',
}

test('lee todos los campos y conserva enteros SQLite de 64 bits', () => {
  const db = new DatabaseSync(':memory:')
  const columns = productColumns.map((column) => `\`${column}\``).join(', ')
  db.exec(`CREATE TABLE products (${columns})`)
  db.prepare(`INSERT INTO products VALUES (${productColumns.map(() => '?').join(', ')})`)
    .run(...productColumns.map((column) => product[column]))
  const [result] = readProductsFromDatabase(db)
  assert.equal(result.id, 42n)
  assert.equal(result.stock_by_size, product.stock_by_size)
  assert.equal(result.name, product.name)
  assert.equal(result.extra_images, product.extra_images)
  db.close()
})

test('rechaza columnas SQLite desconocidas en lugar de omitir datos', () => {
  const db = new DatabaseSync(':memory:')
  db.exec('CREATE TABLE products (id INTEGER, nueva_columna TEXT)')
  assert.throws(() => readProductsFromDatabase(db), /no coincide/)
  db.close()
})

test('rechaza texto SQLite que no sea UTF-8 válido', () => {
  const db = new DatabaseSync(':memory:')
  const columns = productColumns.map((column) => `\`${column}\``).join(', ')
  db.exec(`CREATE TABLE products (${columns})`)
  db.prepare(`INSERT INTO products VALUES (${productColumns.map(() => '?').join(', ')})`)
    .run(...productColumns.map((column) => product[column]))
  db.exec("UPDATE products SET name = CAST(X'80' AS TEXT)")
  assert.throws(() => readProductsFromDatabase(db), /UTF-8 inválido/)
  db.close()
})

test('escapa datos como bytes UTF-8 y verifica todos los campos al insertar', () => {
  assert.equal(sqlValue("a'; DROP TABLE orders; --"), "CONVERT(X'61273b2044524f50205441424c45206f72646572733b202d2d' USING utf8mb4)")
  const sql = buildSql('CREATE TABLE example (id INT);', [product], 'test_db')
  assert.ok(sql.indexOf('information_schema.TABLES') < sql.indexOf('CREATE TABLE example'))
  assert.ok(sql.indexOf('START TRANSACTION') < sql.indexOf('INSERT INTO products'))
  for (const column of productColumns) assert.match(sql, new RegExp('`' + column + '` <=>'))
  assert.ok(sql.indexOf('SIGNAL SQLSTATE') < sql.indexOf('COMMIT'))
})

test('rechaza fechas, tipos, JSON y rutas de imagen que no puedan conservarse', async () => {
  assert.throws(() => validateProducts([{ ...product, created_at: 'invalid' }]), /Fecha incompatible/)
  assert.throws(() => validateProducts([{ ...product, stock: '3' }]), /stock/)
  assert.throws(() => productImageUrls([{ ...product, extra_images: '{' }]), /JSON/)
  const roots = { gifts: fileURLToPath(new URL('../public/gifts', import.meta.url)) }
  await assert.rejects(collectImages([{ ...product, front_image: '/uploads/../../other.jpg' }], roots), /no admitida/)
})

test('recoge las imágenes y detecta si falta un archivo', async () => {
  const roots = { gifts: fileURLToPath(new URL('../public/gifts', import.meta.url)) }
  const files = await collectImages([product], roots)
  assert.equal(files.length, 3)
  assert.ok(files.every((file) => file.bytes.length > 0 && /^[a-f0-9]{64}$/.test(file.sha256)))
  await assert.rejects(collectImages([{ ...product, front_image: '/gifts/no-existe.svg' }], roots), /ENOENT/)
})

test('rechaza parámetros SSH y de base que permitan inyección', () => {
  const target = { database: 'test_db', host: 'example.org', user: 'test', port: '65002', defaultsFile: '/home/test/.mysql.cnf' }
  assert.doesNotThrow(() => validateTarget(target))
  for (const invalid of [
    { database: 'db;drop' }, { host: '-oBad' }, { user: 'x@host' },
    { port: '0' }, { defaultsFile: '/home/test/../../secret' },
  ]) assert.throws(() => validateTarget({ ...target, ...invalid }))
})
