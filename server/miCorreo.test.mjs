import assert from 'node:assert/strict'
import test from 'node:test'
import { MiCorreoError, buildDimensions, buildImportPayload, createMiCorreoClient, numericPostalCode, readMiCorreoConfig } from './miCorreo.mjs'

const env = { MICORREO_USER: 'u', MICORREO_PASSWORD: 'p', MICORREO_CUSTOMER_ID: '0090000025', MICORREO_ORIGIN_POSTAL_CODE: '1757' }
const reply = (body, status = 200) => ({ ok: status < 300, status, text: JSON.stringify(body) })

const fakeTransport = (routes) => {
  const calls = []
  const transport = async (url, options) => {
    calls.push({ path: url.pathname.replace('/micorreo/v1', ''), ...options })
    return routes[url.pathname.replace('/micorreo/v1', '')]()
  }
  transport.calls = calls
  return transport
}

test('config detecta variables faltantes y usa el host correcto', () => {
  assert.deepEqual(readMiCorreoConfig({}).missing, ['MICORREO_USER', 'MICORREO_PASSWORD', 'MICORREO_CUSTOMER_ID', 'MICORREO_ORIGIN_POSTAL_CODE'])
  assert.equal(readMiCorreoConfig(env).baseUrl, 'https://apitest.correoargentino.com.ar/micorreo/v1')
  assert.equal(readMiCorreoConfig({ ...env, MICORREO_ENVIRONMENT: 'production' }).baseUrl, 'https://api.correoargentino.com.ar/micorreo/v1')
})

test('numericPostalCode acepta CP numérico y CPA', () => {
  assert.equal(numericPostalCode('C1000AAA'), '1000')
  assert.equal(numericPostalCode(' 5000 '), '5000')
  assert.equal(numericPostalCode('x'), '')
})

test('buildDimensions apila prendas y respeta los límites de la API', () => {
  const config = readMiCorreoConfig(env)
  assert.deepEqual(buildDimensions(config, 3), { weight: 1200, height: 15, width: 25, length: 35 })
  assert.throws(() => buildDimensions(config, 70), MiCorreoError)
})

test('autentica con Basic una sola vez y cotiza con Bearer', async () => {
  const transport = fakeTransport({
    '/token': () => reply({ token: 'jwt', expires: '2099-01-01 00:00:00' }),
    '/rates': () => reply({ rates: [{ deliveredType: 'D', productType: 'CP', productName: 'Clasico', price: 498.06, deliveryTimeMin: '2', deliveryTimeMax: '5' }, { deliveredType: 'D', productType: 'XX', price: 0 }] }),
  })
  const client = createMiCorreoClient(readMiCorreoConfig(env), transport)
  const input = { postalCodeDestination: 'B1704ABC', dimensions: { weight: 400, height: 5, width: 25, length: 35 }, deliveredType: 'D' }
  const rates = await client.getRates(input)
  await client.getRates(input)
  assert.deepEqual(rates, [{ deliveredType: 'D', productType: 'CP', productName: 'Clasico', priceArs: 499, deliveryTimeMin: '2', deliveryTimeMax: '5' }])
  assert.equal(transport.calls.filter((call) => call.path === '/token').length, 1)
  assert.equal(transport.calls[0].headers.Authorization, `Basic ${Buffer.from('u:p').toString('base64')}`)
  assert.equal(transport.calls[1].headers.Authorization, 'Bearer jwt')
  assert.equal(JSON.parse(transport.calls[1].body).postalCodeDestination, '1704')
})

test('errores de negocio y respuestas 200 con error lanzan MiCorreoError', async () => {
  const transport = fakeTransport({
    '/token': () => reply({ token: 'jwt', expires: '2099-01-01 00:00:00' }),
    '/shipping/import': () => reply({ code: 402, message: 'La orden ya fue importada con anterioridad.' }, 402),
    '/shipping/tracking': () => reply({ error: 'No encontrado', code: '0' }),
  })
  const client = createMiCorreoClient(readMiCorreoConfig(env), transport)
  await assert.rejects(client.importShipping({}), (error) => error instanceof MiCorreoError && error.status === 400 && /ya fue importada/.test(error.message))
  await assert.rejects(client.getTracking('X'), /No encontrado/)
})

test('sin configuración no llama a la API', async () => {
  await assert.rejects(createMiCorreoClient(readMiCorreoConfig({}), fakeTransport({})).getRates({ postalCodeDestination: '1704', dimensions: {} }), (error) => error.status === 503)
})

test('buildImportPayload mapea el pedido al formato de /shipping/import', () => {
  const order = { reference: 'UF-2026-ABC123', shipping_name: 'Ana Gómez', shipping_phone: '+54 11 5555-1234', shipping_street: 'Av. Siempre Viva 742 3B', shipping_city: 'Ramos Mejía', shipping_province: 'Buenos Aires', shipping_postal_code: 'B1704ABC', total_ars: 25000.4, user_email: 'ana@mail.com' }
  const sender = { businessName: 'UnFocus', areaCodePhone: '11', phoneNumber: '40001111', email: 'hola@unfocus.shop', streetName: 'Calle', streetNumber: '1', floor: '', department: '', cityName: 'CABA', state: 'C', zipCode: 'C1000AAA' }
  const payload = buildImportPayload(order, { sender, dimensions: { weight: 800, height: 10, width: 25, length: 35 } })
  assert.equal(payload.extOrderId, 'UF-2026-ABC123')
  assert.equal(payload.recipient.email, 'ana@mail.com')
  assert.equal(payload.shipping.deliveryType, 'D')
  assert.equal(payload.shipping.address.provinceCode, 'B')
  assert.equal(payload.shipping.address.postalCode, '1704')
  assert.equal(payload.shipping.address.streetNumber, '742')
  assert.equal(payload.shipping.declaredValue, 25000)
  assert.equal(payload.sender.originAddress.postalCode, '1000')
  assert.throws(() => buildImportPayload({ ...order, shipping_province: 'Atlantis' }, { sender, dimensions: {} }), MiCorreoError)
  assert.throws(() => buildImportPayload({ ...order, user_email: '' }, { sender, dimensions: {} }), MiCorreoError)
})
