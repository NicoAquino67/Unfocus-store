import assert from 'node:assert/strict'
import test from 'node:test'
import { mysqlConfig, withTransaction } from './mysql.mjs'

const env = {
  DB_HOST: 'localhost',
  DB_PORT: '3306',
  DB_NAME: 'store',
  DB_USER: 'store_user',
  DB_PASSWORD: 'test-password',
}

test('la configuración exige todos los datos y un puerto válido', () => {
  assert.throws(() => mysqlConfig({ ...env, DB_PASSWORD: '' }), /DB_PASSWORD/)
  for (const port of ['0', '65536', '3306.5', 'not-a-port']) {
    assert.throws(() => mysqlConfig({ ...env, DB_PORT: port }), /DB_PORT/)
  }
  const config = mysqlConfig(env)
  assert.equal(config.port, 3306)
  assert.equal(config.database, 'store')
  assert.equal(config.dateStrings, true)
})

test('la transacción confirma el trabajo y libera la conexión', async () => {
  const calls = []
  const connection = {
    async beginTransaction() { calls.push('begin') },
    async commit() { calls.push('commit') },
    async rollback() { calls.push('rollback') },
    release() { calls.push('release') },
  }
  const result = await withTransaction({ async getConnection() { return connection } }, async (current) => {
    assert.equal(current, connection)
    calls.push('work')
    return 42
  })
  assert.equal(result, 42)
  assert.deepEqual(calls, ['begin', 'work', 'commit', 'release'])
})

test('la transacción revierte los errores y libera la conexión', async () => {
  const calls = []
  const failure = new Error('falló el trabajo')
  const connection = {
    async beginTransaction() { calls.push('begin') },
    async commit() { calls.push('commit') },
    async rollback() { calls.push('rollback') },
    release() { calls.push('release') },
  }
  await assert.rejects(withTransaction({ async getConnection() { return connection } }, async () => {
    throw failure
  }), (error) => error === failure)
  assert.deepEqual(calls, ['begin', 'rollback', 'release'])
})

test('una reversión fallida conserva ambos errores', async () => {
  const failure = new Error('falló el trabajo')
  const rollbackFailure = new Error('falló la reversión')
  let released = false
  const connection = {
    async beginTransaction() {},
    async rollback() { throw rollbackFailure },
    release() { released = true },
  }
  await assert.rejects(withTransaction({ async getConnection() { return connection } }, async () => {
    throw failure
  }), (error) => error instanceof AggregateError && error.errors[0] === failure && error.errors[1] === rollbackFailure)
  assert.equal(released, true)
})
