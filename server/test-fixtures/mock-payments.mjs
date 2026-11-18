import { readFile } from 'node:fs/promises'

const originalFetch = globalThis.fetch
globalThis.fetch = async (input, options) => {
  const url = String(input)
  const prefix = 'https://api.mercadopago.com/v1/payments/'
  if (!url.startsWith(prefix)) return originalFetch(input, options)
  const payments = JSON.parse(await readFile(process.env.TEST_PAYMENT_FIXTURE, 'utf8'))
  const payment = payments[url.slice(prefix.length)]
  return payment
    ? new Response(JSON.stringify(payment), { status: 200, headers: { 'content-type': 'application/json' } })
    : new Response('', { status: 404 })
}
