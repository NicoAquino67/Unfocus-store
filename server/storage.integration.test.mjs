import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

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

test('checkout conserva el stock y lo restituye al cancelar', { timeout: 30000 }, async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'unfocus-storage-test-'))
  const port = await availablePort()
  const base = `http://127.0.0.1:${port}`
  const email = 'admin@example.test'
  const password = 'testing-only-password-123'
  const child = spawn(process.execPath, ['server/index.mjs'], {
    cwd: project,
    env: {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      TEMP: process.env.TEMP,
      NODE_ENV: 'test',
      PORT: String(port),
      DATABASE_PATH: path.join(directory, 'test.sqlite'),
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
})
