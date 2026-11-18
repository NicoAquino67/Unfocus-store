import assert from 'node:assert/strict'
import test from 'node:test'
import { createMysqlPool } from './mysql.mjs'
import { paymentAttemptUpsertSql } from './paymentAttemptSql.mjs'

async function checkUpsert(execute, getRow) {
  await execute(['payment-test', 1, 'pending', null])
  await execute(['payment-test', 1, 'approved', 'accredited'])
  assert.deepEqual(await getRow(), { order_id: 1, status: 'approved', status_detail: 'accredited' })
  await execute(['payment-test', 2, 'rejected', 'other order'])
  assert.deepEqual(await getRow(), { order_id: 1, status: 'approved', status_detail: 'accredited' })
}

test('MariaDB no reasigna un pago a otro pedido', { skip: process.env.UNFOCUS_MYSQL_INTEGRATION !== '1' }, async () => {
  if (!/(?:test|prueba)$/i.test(process.env.DB_NAME ?? '')) throw new Error('Se requiere una base MySQL de prueba.')
  const pool = createMysqlPool()
  const connection = await pool.getConnection()
  try {
    const [names] = await connection.query('SELECT DATABASE() AS name')
    if (names[0].name !== process.env.DB_NAME) throw new Error('La base conectada no coincide con la base de prueba.')
    await connection.query(`
      CREATE TEMPORARY TABLE payment_attempts (
        payment_id VARCHAR(255) PRIMARY KEY, order_id BIGINT NOT NULL,
        status VARCHAR(64) NOT NULL, status_detail TEXT, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `)
    await checkUpsert(
      async (params) => connection.execute(paymentAttemptUpsertSql(), params),
      async () => {
        const [rows] = await connection.query('SELECT order_id, status, status_detail FROM payment_attempts')
        return rows[0]
      },
    )
  } finally {
    connection.release()
    await pool.end()
  }
})
