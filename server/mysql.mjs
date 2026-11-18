import mysql from 'mysql2/promise'
import { AsyncLocalStorage } from 'node:async_hooks'

export function mysqlConfig(env) {
  const required = ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD']
  const missing = required.filter((key) => typeof env[key] !== 'string' || !env[key].trim())
  if (missing.length) throw new Error(`Faltan variables de MySQL: ${missing.join(', ')}.`)

  const port = Number(env.DB_PORT)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('DB_PORT debe ser un puerto válido.')

  return {
    host: env.DB_HOST.trim(),
    port,
    database: env.DB_NAME.trim(),
    user: env.DB_USER.trim(),
    password: env.DB_PASSWORD,
    charset: 'utf8mb4',
    timezone: 'Z',
    dateStrings: true,
    supportBigNumbers: true,
    decimalNumbers: true,
    multipleStatements: false,
  }
}

export function createMysqlPool(env = process.env) {
  return mysql.createPool(mysqlConfig(env))
}

export async function withTransaction(pool, work) {
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    let result
    try {
      result = await work(connection)
      await connection.commit()
    } catch (error) {
      try {
        await connection.rollback()
      } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], 'Falló la transacción y su reversión.')
      }
      throw error
    }

    return result
  } finally {
    connection.release()
  }
}

export function createMysqlDatabase(env = process.env) {
  const pool = createMysqlPool(env)
  const transactionContext = new AsyncLocalStorage()
  const execute = async (sql, params) => {
    const connection = transactionContext.getStore() ?? pool
    const [result] = await connection.execute(sql, params)
    return result
  }

  return {
    prepare(sql) {
      return {
        async get(...params) {
          const rows = await execute(sql, params)
          return rows[0]
        },
        async all(...params) {
          return execute(sql, params)
        },
        async run(...params) {
          const result = await execute(sql, params)
          return { changes: result.affectedRows, lastInsertRowid: result.insertId }
        },
      }
    },
    async transaction(work) {
      if (transactionContext.getStore()) throw new Error('No se admiten transacciones anidadas.')
      return withTransaction(pool, (connection) => transactionContext.run(connection, work))
    },
    close() {
      return pool.end()
    },
  }
}
