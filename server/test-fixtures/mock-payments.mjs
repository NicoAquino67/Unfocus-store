import { readFile } from 'node:fs/promises'

const originalFetch = globalThis.fetch
globalThis.fetch = async (input, options) => {
  const url = String(input)
  if (url === 'https://api.mercadopago.com/checkout/preferences/') {
    return new Response(JSON.stringify({ id: 'test-preference', sandbox_init_point: 'https://example.test/checkout' }), { status: 201, headers: { 'content-type': 'application/json' } })
  }
  const prefix = 'https://api.mercadopago.com/v1/payments/'
  if (!url.startsWith(prefix)) {
    if (url.startsWith('https://api.mercadopago.com/')) throw new Error('Solicitud de Mercado Pago sin simular en la prueba.')
    return originalFetch(input, options)
  }
  const payments = JSON.parse(await readFile(process.env.TEST_PAYMENT_FIXTURE, 'utf8'))
  const payment = payments[url.slice(prefix.length)]
  return payment
    ? new Response(JSON.stringify(payment), { status: 200, headers: { 'content-type': 'application/json' } })
    : new Response('', { status: 404 })
}
