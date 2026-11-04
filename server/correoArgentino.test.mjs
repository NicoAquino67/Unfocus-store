import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOrderPayload, createCorreoArgentinoClient, normalizeZipCode, readCorreoArgentinoConfig, splitStreet } from './correoArgentino.mjs'

const env = {
  CORREO_ARGENTINO_API_KEY: 'key', CORREO_ARGENTINO_AGREEMENT: '18017', CORREO_SENDER_NAME: 'UnFocus', CORREO_SENDER_STREET: 'Calle',
  CORREO_SENDER_STREET_NUMBER: '1', CORREO_SENDER_CITY: 'CABA', CORREO_SENDER_PROVINCE_CODE: 'c', CORREO_SENDER_ZIP_CODE: 'C1000AAA',
}
const order = { reference: 'UF-2026-ABC123', total_ars: 25000.4, created_at: '2026-05-31 21:14:11', shipping_name: 'Ana', shipping_phone: '+54 11 5555-1234', shipping_street: 'Av. Siempre Viva 742 piso 3 dpto B', shipping_city: 'Springfield', shipping_province: 'Córdoba', shipping_postal_code: '5000', user_email: 'a@b.com' }

test('config reports missing variables', () => {
  assert.deepEqual(readCorreoArgentinoConfig({}).missing.slice(0, 2), ['CORREO_ARGENTINO_API_KEY', 'CORREO_ARGENTINO_AGREEMENT'])
  assert.equal(readCorreoArgentinoConfig(env).missing.length, 0)
  assert.equal(readCorreoArgentinoConfig(env).baseUrl, 'https://apitest.correoargentino.com.ar/paqar/v1')
})

test('street and zip parsing', () => {
  assert.deepEqual(splitStreet(order.shipping_street), { streetName: 'Av. Siempre Viva', streetNumber: '742', floor: '3', department: 'B' })
  assert.equal(splitStreet('Ruta sin numero').streetNumber, 'S/N')
  assert.equal(normalizeZipCode('5000', 'X'), 'X5000')
  assert.equal(normalizeZipCode('x5000abc', 'X'), 'X5000ABC')
})

test('order payload follows the Paq.ar contract', () => {
  const payload = buildOrderPayload(readCorreoArgentinoConfig(env), order)
  assert.equal(payload.order.deliveryType, 'homeDelivery')
  assert.equal(payload.order.shippingData.address.state, 'X')
  assert.equal(payload.order.shippingData.address.zipCode, 'X5000')
  assert.equal(payload.order.saleDate, '2026-05-31T18:14:11-03:00')
  assert.equal(payload.order.parcels[0].declaredValue, '25000')
  assert.equal(payload.order.senderData.state, 'C')
  assert.throws(() => buildOrderPayload(readCorreoArgentinoConfig(env), { ...order, shipping_province: 'Atlantis' }))
})

test('client sends Apikey and agreement headers and parses responses', async () => {
  const calls = []
  const transport = async (url, options) => {
    calls.push({ url: url.toString(), ...options })
    if (url.pathname.endsWith('/orders')) return { ok: true, status: 200, text: JSON.stringify({ trackingNumber: 'TN1' }) }
    if (url.pathname.endsWith('/labels')) return { ok: true, status: 200, text: JSON.stringify([{ fileBase64: Buffer.from('pdf').toString('base64'), fileName: 'a.pdf', result: 'OK' }]) }
    return { ok: false, status: 401, text: JSON.stringify({ message: 'Account not found by apiKey' }) }
  }
  const client = createCorreoArgentinoClient(readCorreoArgentinoConfig(env), transport)
  assert.equal((await client.createOrder({})).trackingNumber, 'TN1')
  assert.equal(calls[0].headers.Authorization, 'Apikey key')
  assert.equal(calls[0].headers.agreement, '18017')
  const label = await client.getLabel('TN1')
  assert.equal(label.pdf.toString(), 'pdf')
  assert.match(calls[1].url, /labelFormat=10x15/)
  await assert.rejects(client.validateCredentials(), /Account not found/)
  await assert.rejects(createCorreoArgentinoClient(readCorreoArgentinoConfig({}), transport).validateCredentials(), /Falta configurar/)
})
