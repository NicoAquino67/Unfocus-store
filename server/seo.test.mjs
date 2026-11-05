import assert from 'node:assert/strict'
import test from 'node:test'
import { buildHomepageJsonLd, buildLlmsTxt, buildMarkdownPage, buildMcpServerCard, buildRobotsTxt, buildSitemapXml, injectAgentContent, injectImagePreload, injectProductMeta, injectSiteMeta, renderAgentContent } from './seo.mjs'

const product = { slug: 'no-molestar', name: 'Camiseta "No Molestar"', description: 'Algodón suave & sin etiquetas.', category: 'Remeras', salePrice: 25000, stock: 3, isGiftCard: false, createdAt: '2026-01-05 10:00:00', gallery: [{ src: '/uploads/a.webp', alt: 'a' }] }
const base = 'https://unfocus.shop'

test('robots bloquea la API y declara el sitemap', () => {
  const robots = buildRobotsTxt(base)
  assert.match(robots, /Disallow: \/api\//)
  assert.match(robots, /Content-Signal: search=yes, ai-train=no/)
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
  assert.match(result, /rel="canonical" href="https:\/\/unfocus\.shop\/\?producto=no-molestar"/)
  assert.equal((result.match(/rel="canonical"/g) ?? []).length, 1)
  assert.doesNotMatch(result, /content="x"/)
})

test('injectImagePreload adds a high-priority hero image and skips empty sources', () => {
  const html = '<html><head></head><body></body></html>'
  assert.match(injectImagePreload(html, base, '/ident/productos/hero.webp'), /href="https:\/\/unfocus\.shop\/ident\/productos\/hero\.webp" fetchpriority="high"/)
  assert.equal(injectImagePreload(html, base, ''), html)
})

test('homepage schema describes the organization, website, product list, and verified profiles', () => {
  const schema = buildHomepageJsonLd(base, {
    products: [product],
    store: { legalName: 'UnFocus', email: 'hola@example.com', phone: '+541100000000', address: 'Calle 123' },
    sameAs: ['https://instagram.com/unfocus'],
  })
  assert.deepEqual(schema['@graph'].map((node) => node['@type']), ['Organization', 'WebSite', 'WebPage', 'ItemList'])
  assert.equal(schema['@graph'][0].sameAs[0], 'https://instagram.com/unfocus')
  assert.equal(schema['@graph'][0].contactPoint.email, 'hola@example.com')
  assert.equal(schema['@graph'][0].contactPoint.telephone, '+541100000000')
})

test('agent resources use llms.txt and markdown formats with linked key pages', () => {
  const llms = buildLlmsTxt(base, [product])
  assert.match(llms, /^# UnFocus Mall\n\n> /)
  assert.match(llms, /\[Contacto\]\(https:\/\/unfocus\.shop\/\?contacto=1\)/)
  assert.match(llms, /\[Términos y condiciones\]\(https:\/\/unfocus\.shop\/\?legal=terminos\)/)
  assert.match(llms, /\[Camiseta "No Molestar"\]/)
  const markdown = buildMarkdownPage(base, { products: [product] })
  assert.match(markdown, /^# UnFocus Mall/)
  assert.match(markdown, /\[Nuestra mirada\]\(https:\/\/unfocus\.shop\/#historia\)/)
})

test('agent HTML contains one page heading, navigable product links, and machine-readable contact details', () => {
  const home = renderAgentContent({ products: [product], contact: { email: 'hola@example.com', phone: '+541100000000' } })
  assert.equal((home.match(/<h1\b/g) ?? []).length, 1)
  assert.match(home, /href="\/\?producto=no-molestar"/)
  assert.match(home, /href="mailto:hola@example\.com"/)
  assert.match(home, /href="tel:\+541100000000"/)
  const contact = renderAgentContent({ legalPage: 'contact', contact: { email: 'hola@example.com' } })
  assert.equal((contact.match(/<h1\b/g) ?? []).length, 1)
  assert.match(contact, /<a href="mailto:hola@example\.com">/)
  assert.match(injectAgentContent('<div id="root"><!--SSR_CONTENT--></div>', contact), /<h1>Contacto<\/h1>/)
  const terms = renderAgentContent({ legalPage: 'terminos', contact: { legalName: 'UnFocus' } })
  assert.equal((terms.match(/<h1\b/g) ?? []).length, 1)
  assert.match(terms, /30 días corridos/)
  assert.match(terms, /Mercado Pago/)
})

test('site metadata replaces canonical and escapes JSON-LD safely', () => {
  const html = '<html><head><title>Old</title><meta name="description" content="Old" /><link rel="canonical" href="https://old.example/" /></head></html>'
  const result = injectSiteMeta(html, base, {
    canonical: `${base}/?contacto=1`,
    jsonLd: { '@context': 'https://schema.org', name: '</script><script>alert(1)</script>' },
  })
  assert.equal((result.match(/rel="canonical"/g) ?? []).length, 1)
  assert.match(result, /<link rel="canonical" href="https:\/\/unfocus\.shop\/\?contacto=1"/)
  assert.match(result, /\\u003c\/script>/)
  assert.doesNotMatch(injectSiteMeta(html, base, { canonical: '' }), /rel="canonical"/)
})

test('MCP server card advertises its read-only Streamable HTTP catalog tool', () => {
  const card = buildMcpServerCard(base)
  assert.equal(card.transport.type, 'streamable-http')
  assert.equal(card.transport.url, `${base}/mcp`)
  assert.equal(card.tools[0].name, 'search_products')
  assert.equal(card.resources[0].uri, `${base}/llms.txt`)
  assert.equal(card.links['terms-of-service'], `${base}/?legal=terminos`)
})
