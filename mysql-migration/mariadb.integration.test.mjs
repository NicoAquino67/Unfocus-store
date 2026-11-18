import assert from 'node:assert/strict'
import test from 'node:test'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { emptyDestinationGuard, executeSql, productColumns, readProducts } from './migrate.mjs'

const enabled = process.env.UNFOCUS_MARIADB_TEST === '1'
const target = {
  database: process.env.UNFOCUS_TEST_DATABASE,
  host: process.env.UNFOCUS_TEST_SSH_HOST,
  user: process.env.UNFOCUS_TEST_SSH_USER,
  port: process.env.UNFOCUS_TEST_SSH_PORT,
  identity: process.env.UNFOCUS_TEST_SSH_IDENTITY,
  defaultsFile: process.env.UNFOCUS_TEST_MYSQL_DEFAULTS,
}
const project = path.resolve(import.meta.dirname, '..')
const sqlite = path.join(project, 'data', 'unfocus.sqlite')

test('MariaDB aislada: esquema completo, productos exactos y rechazo de segunda ejecución', { skip: !enabled }, async () => {
  assert.match(target.database || '', /(?:test|prueba)$/i, 'Se requiere una base de prueba explícita.')
  const source = new DatabaseSync(sqlite, { readOnly: true })
  let tables
  let sourceColumns
  try {
    tables = source.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((row) => row.name)
    sourceColumns = new Map(tables.map((table) => [
      table,
      source.prepare(`PRAGMA table_info("${table}")`).all().map((column) => column.name).sort(),
    ]))
  } finally { source.close() }

  const remoteColumns = await executeSql(target, `
    SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME, COLUMN_NAME;
  `)
  const actualColumns = new Map()
  for (const line of remoteColumns.trim().split('\n')) {
    const [table, column] = line.trim().split('\t')
    if (!actualColumns.has(table)) actualColumns.set(table, [])
    actualColumns.get(table).push(column)
  }
  assert.deepEqual([...actualColumns.keys()].sort(), tables)
  for (const table of tables) {
    for (const column of sourceColumns.get(table)) assert.ok(actualColumns.get(table).includes(column), `${table}.${column}`)
  }
  assert.deepEqual(actualColumns.get('products').sort(), sourceColumns.get('products'))

  const sourceProducts = readProducts(sqlite)
  const remoteProducts = await executeSql(target, `
    SELECT ${productColumns.map((column) => `HEX(CAST(\`${column}\` AS CHAR CHARACTER SET utf8mb4))`).join(', ')}
    FROM products ORDER BY id;
  `)
  const rows = remoteProducts.trim().split('\n').filter(Boolean).map((line) => line.split('\t').map((value) => Buffer.from(value, 'hex').toString('utf8')))
  assert.equal(rows.length, sourceProducts.length)
  for (let index = 0; index < rows.length; index += 1) {
    for (let column = 0; column < productColumns.length; column += 1) {
      const expected = sourceProducts[index][productColumns[column]]
      if (typeof expected === 'number') assert.equal(Number(rows[index][column]), expected, productColumns[column])
      else assert.equal(rows[index][column], String(expected), productColumns[column])
    }
  }

  const countsQuery = `SELECT ${tables.map((table) => `(SELECT COUNT(*) FROM \`${table}\`)`).join(', ')};`
  const before = await executeSql(target, countsQuery)
  const counts = before.trim().split('\t').map(Number)
  for (let index = 0; index < tables.length; index += 1) {
    assert.equal(counts[index], tables[index] === 'products' ? sourceProducts.length : 0, tables[index])
  }
  await assert.rejects(executeSql(target, emptyDestinationGuard(target.database)), /Destino no vacío/)
  await assert.rejects(executeSql(target, `
    START TRANSACTION;
    INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ('integration-test', 9223372036854775807, 1);
    COMMIT;
  `), /foreign key constraint/i)
  assert.equal(await executeSql(target, countsQuery), before)
})
