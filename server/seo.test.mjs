import assert from 'node:assert/strict'
import test from 'node:test'
import { buildRobotsTxt, buildSitemapXml, injectImagePreload, injectProductMeta } from './seo.mjs'

const product = { slug: 'no-molestar', name: 'Camiseta "No Molestar"', description: 'Algodón suave & sin etiquetas.', category: 'Remeras', salePrice: 25000, stock: 3, isGiftCard: false, createdAt: '2026-01-05 10:00:00', gallery: [{ src: '/uploads/a.webp', alt: 'a' }] }
const base = 'https://unfocus.shop'

test('robots bloquea la API y declara el sitemap', () => {
  const robots = buildRobotsTxt(base)
  assert.match(robots, /Disallow: \/api\//)
  assert.match(robots, /Sitemap: https:\/\/unfocus\.shop\/sitemap\.xml/)
})

test('sitemap lista productos y legales con URLs escapadas', () => {
  const xml = buildSitemapXml(base, [product], ['terminos'])
  assert.match(xml, /<loc>https:\/\/unfocus\.shop\/\?producto=no-molestar<\/loc><lastmod>2026-01-05<\/lastmod>/)
  assert.match(xml, /\?legal=terminos/)
})

test('injectProductMeta reemplaza título y descripción y añade JSON-LD sin romper el HTML', () => {
  const html = '<html><head><meta name="description" content="x" /><title>Base</title></head><body></body></html>'
  const result = injectProductMeta(html, base, product)
  assert.match(result, /<title>Camiseta &quot;No Molestar&quot; \| UnFocus<\/title>/)
  assert.match(result, /og:image" content="https:\/\/unfocus\.shop\/uploads\/a\.webp"/)
  assert.match(result, /rel="preload" as="image" href="https:\/\/unfocus\.shop\/uploads\/a\.webp" fetchpriority="high"/)
  assert.match(result, /"availability":"https:\/\/schema\.org\/InStock"/)
  assert.doesNotMatch(result, /content="x"/)
})

test('injectImagePreload adds a high-priority hero image and skips empty sources', () => {
  const html = '<html><head></head><body></body></html>'
  assert.match(injectImagePreload(html, base, '/ident/productos/hero.webp'), /href="https:\/\/unfocus\.shop\/ident\/productos\/hero\.webp" fetchpriority="high"/)
  assert.equal(injectImagePreload(html, base, ''), html)
})
