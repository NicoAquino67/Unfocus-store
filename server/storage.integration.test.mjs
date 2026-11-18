import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import mysql from 'mysql2/promise'
import { mysqlConfig } from './mysql.mjs'

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

async function availablePort() {
  const server = net.createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const { port } = server.address()
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  return port
}

test('checkout conserva el stock y lo restituye al cancelar', { timeout: 30000, skip: process.env.UNFOCUS_MYSQL_INTEGRATION !== '1' }, async (t) => {
  if (process.env.DB_HOST !== '127.0.0.1' || process.env.DB_NAME !== 'unfocus_integration_test') {
    throw new Error('La integración requiere una base local dedicada llamada unfocus_integration_test.')
  }
  const setup = await mysql.createConnection({ ...mysqlConfig(process.env), multipleStatements: true })
  try {
    const [objects] = await setup.query('SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()')
    if (objects.length) throw new Error('La base de integración debe estar vacía.')
    await setup.query(await readFile(path.join(project, 'mysql-migration', 'schema.sql'), 'utf8'))
  } finally {
    await setup.end()
  }
  const directory = await mkdtemp(path.join(os.tmpdir(), 'unfocus-storage-test-'))
  const port = await availablePort()
  const base = `http://127.0.0.1:${port}`
  const email = 'admin@example.test'
  const password = 'testing-only-password-123'
  const paymentFixture = path.join(directory, 'payments.json')
  await writeFile(paymentFixture, '{}')
  const child = spawn(process.execPath, ['--import', pathToFileURL(path.join(project, 'server', 'test-fixtures', 'mock-payments.mjs')).href, 'server/index.mjs'], {
    cwd: project,
    env: {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      TEMP: process.env.TEMP,
      NODE_ENV: 'test',
      PORT: String(port),
      DB_HOST: process.env.DB_HOST,
      DB_PORT: process.env.DB_PORT,
      DB_NAME: process.env.DB_NAME,
      DB_USER: process.env.DB_USER,
      DB_PASSWORD: process.env.DB_PASSWORD,
      TEST_PAYMENT_FIXTURE: paymentFixture,
      MP_ACCESS_TOKEN: 'test-token-not-used-with-real-service',
      UPLOAD_DIR: path.join(directory, 'uploads'),
      ADMIN_EMAIL: email,
      ADMIN_PASSWORD: password,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.on('data', (data) => { output += data })
  child.stderr.on('data', (data) => { output += data })
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = new Promise((resolve) => child.once('exit', resolve))
      child.kill()
      await exited
    }
    await rm(directory, { recursive: true, force: true })
  })
  let ready = false
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`El servidor terminó al iniciar: ${output}`)
    try {
      const response = await fetch(`${base}/api/health`)
      if (response.ok) {
        ready = true
        break
      }
    } catch {
      await delay(100)
    }
  }
  assert.ok(ready, `El servidor no inició: ${output}`)

  async function request(url, { method = 'GET', body, cookie } = {}) {
    const response = await fetch(`${base}${url}`, {
      method,
      headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] }
  }

  const login = await request('/api/auth/login', { method: 'POST', body: { email, password } })
  assert.equal(login.status, 200)
  assert.ok(login.cookie)
  const settings = await request('/api/admin/settings', { cookie: login.cookie })
  assert.equal(settings.status, 200)
  const configured = await request('/api/admin/settings', {
    method: 'PUT',
    cookie: login.cookie,
    body: { ...settings.body.settings, pickupAddress: 'Tienda', transferHolder: 'Tienda', transferAlias: 'tienda.test' },
  })
  assert.equal(configured.status, 200)

  const image = (index) => ({ src: `/gifts/tarjeta-${index}.svg`, alt: `Vista ${index}` })
  const created = await request('/api/admin/products', {
    method: 'POST',
    cookie: login.cookie,
    body: {
      name: 'Producto de prueba',
      slug: 'producto-prueba',
      category: 'Prueba',
      price: 1000,
      stockBySize: { M: 1 },
      composition: 'Algodón',
      description: 'Descripción',
      designDescription: 'Diseño',
      gallery: [image(1), image(2), image(3)],
    },
  })
  assert.equal(created.status, 201, JSON.stringify(created.body))
  const id = created.body.product.id
  const repeatedItem = { productId: id, quantity: 1, size: 'M' }
  const duplicateAttempt = await request('/api/orders', {
    method: 'POST',
    body: {
      guest: { name: 'Cliente de prueba', email: 'duplicate@example.test' },
      paymentMethod: 'transfer',
      acceptTerms: true,
      items: [repeatedItem, repeatedItem],
      shipping: { method: 'pickup', name: 'Cliente de prueba', phone: '12345678' },
    },
  })
  assert.equal(duplicateAttempt.status, 400)
  const unchanged = await request('/api/products/producto-prueba')
  assert.equal(unchanged.body.product.stockBySize.M, 1)
  const order = (guestEmail) => request('/api/orders', {
    method: 'POST',
    body: {
      guest: { name: 'Cliente de prueba', email: guestEmail },
      paymentMethod: 'transfer',
      acceptTerms: true,
      items: [{ productId: id, quantity: 1, size: 'M' }],
      shipping: { method: 'pickup', name: 'Cliente de prueba', phone: '12345678' },
    },
  })
  const attempts = await Promise.all([order('first@example.test'), order('second@example.test')])
  assert.deepEqual(attempts.map((result) => result.status).sort(), [201, 400])
  const succeeded = attempts.find((result) => result.status === 201)
  const soldOut = await request('/api/products/producto-prueba')
  assert.equal(soldOut.body.product.stockBySize.M, 0)
  const cancelled = await request(`/api/admin/orders/${succeeded.body.order.id}/status`, {
    method: 'PATCH',
    cookie: login.cookie,
    body: { status: 'cancelled' },
  })
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body))
  const restored = await request('/api/products/producto-prueba')
  assert.equal(restored.body.product.stockBySize.M, 1)

  const paidAttempt = await order('paid@example.test')
  assert.equal(paidAttempt.status, 201)
  const paid = await request(`/api/admin/orders/${paidAttempt.body.order.id}/status`, {
    method: 'PATCH',
    cookie: login.cookie,
    body: { status: 'paid' },
  })
  assert.equal(paid.status, 200)
  const report = await request('/api/admin/reports?days=30', { cookie: login.cookie })
  assert.equal(report.status, 200)
  assert.equal(report.body.orders, 1)
  assert.equal(report.body.revenue, 1000)
  assert.equal(report.body.topProducts[0].units, 1)
  const paidCancelled = await request(`/api/admin/orders/${paidAttempt.body.order.id}/status`, {
    method: 'PATCH',
    cookie: login.cookie,
    body: { status: 'cancelled' },
  })
  assert.equal(paidCancelled.status, 200)
  const restoredAfterPaid = await request('/api/products/producto-prueba')
  assert.equal(restoredAfterPaid.body.product.stockBySize.M, 1)
  const payment = { id: 123, status: 'approved', transaction_amount: 1000, currency_id: 'ARS' }
  await writeFile(paymentFixture, JSON.stringify({ 123: { ...payment, external_reference: paidAttempt.body.order.reference } }))
  const verified = await request('/api/payments/verify-return?payment_id=123')
  assert.equal(verified.status, 200, JSON.stringify(verified.body))
  assert.equal(verified.body.orderStatus, 'paid')
  const verifiedAgain = await request('/api/payments/verify-return?payment_id=123')
  assert.equal(verifiedAgain.body.orderStatus, 'paid')
  await writeFile(paymentFixture, JSON.stringify({ 123: { ...payment, external_reference: succeeded.body.order.reference } }))
  const wrongOrder = await request('/api/payments/verify-return?payment_id=123')
  assert.equal(wrongOrder.status, 500)
  const listed = await request('/api/admin/orders', { cookie: login.cookie })
  assert.equal(listed.body.orders.find((entry) => entry.id === succeeded.body.order.id).status, 'cancelled')
  const cancelledVerified = await request(`/api/admin/orders/${paidAttempt.body.order.id}/status`, {
    method: 'PATCH', cookie: login.cookie, body: { status: 'cancelled' },
  })
  assert.equal(cancelledVerified.status, 200)

  const secondProduct = await request('/api/admin/products', {
    method: 'POST',
    cookie: login.cookie,
    body: {
      name: 'Producto con cupón', slug: 'producto-cupon', category: 'Prueba', price: 1000,
      stockBySize: { M: 2 }, composition: 'Algodón', description: 'Descripción',
      designDescription: 'Diseño', gallery: [image(1), image(2), image(3)],
    },
  })
  assert.equal(secondProduct.status, 201, JSON.stringify(secondProduct.body))
  const coupon = await request('/api/admin/coupons', {
    method: 'POST', cookie: login.cookie,
    body: { code: 'UNUSO', type: 'fixed', value: 100, maxUses: 1 },
  })
  assert.equal(coupon.status, 201, JSON.stringify(coupon.body))
  const couponOrder = (guestEmail) => request('/api/orders', {
    method: 'POST',
    body: {
      guest: { name: 'Cliente de prueba', email: guestEmail },
      paymentMethod: 'transfer', acceptTerms: true, couponCode: 'UNUSO',
      items: [{ productId: secondProduct.body.product.id, quantity: 1, size: 'M' }],
      shipping: { method: 'pickup', name: 'Cliente de prueba', phone: '12345678' },
    },
  })
  const couponAttempts = await Promise.all([couponOrder('coupon1@example.test'), couponOrder('coupon2@example.test')])
  assert.deepEqual(couponAttempts.map((attempt) => attempt.status).sort(), [201, 400])
  const couponProduct = await request('/api/products/producto-cupon')
  assert.equal(couponProduct.body.product.stockBySize.M, 1)

  const products = await request('/api/products')
  const giftProduct = products.body.products.find((product) => product.isGiftCard)
  assert.ok(giftProduct)
  const giftOrder = await request('/api/orders', {
    method: 'POST',
    body: {
      guest: { name: 'Cliente de prueba', email: 'gift@example.test' },
      paymentMethod: 'transfer', acceptTerms: true,
      items: [{ productId: giftProduct.id, quantity: 1, size: '30000' }],
    },
  })
  assert.equal(giftOrder.status, 201, JSON.stringify(giftOrder.body))
  const giftPaid = await request(`/api/admin/orders/${giftOrder.body.order.id}/status`, {
    method: 'PATCH', cookie: login.cookie, body: { status: 'paid' },
  })
  assert.equal(giftPaid.status, 200, JSON.stringify(giftPaid.body))
  const cards = await request('/api/admin/gift-cards', { cookie: login.cookie })
  assert.equal(cards.body.giftCards.length, 1)
  const spentOrder = await request('/api/orders', {
    method: 'POST',
    body: {
      guest: { name: 'Cliente de prueba', email: 'card@example.test' },
      paymentMethod: 'transfer', acceptTerms: true, giftCardCode: cards.body.giftCards[0].code,
      items: [{ productId: id, quantity: 1, size: 'M' }],
      shipping: { method: 'pickup', name: 'Cliente de prueba', phone: '12345678' },
    },
  })
  assert.equal(spentOrder.status, 201, JSON.stringify(spentOrder.body))
  assert.equal(spentOrder.body.order.status, 'paid')
  const card = await request('/api/gift-cards/validate', { method: 'POST', body: { code: cards.body.giftCards[0].code } })
  assert.equal(card.body.balanceArs, 29000)
  const cancelSpentGift = await request(`/api/admin/orders/${giftOrder.body.order.id}/status`, {
    method: 'PATCH', cookie: login.cookie, body: { status: 'cancelled' },
  })
  assert.equal(cancelSpentGift.status, 409)
})
