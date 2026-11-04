const escapeXml = (value) => String(value).replace(/[<>&"']/g, (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[char])
const escapeAttribute = (value) => escapeXml(value)

const absoluteUrl = (baseUrl, value) => (/^https?:\/\//.test(value) ? value : `${baseUrl}${value.startsWith('/') ? '' : '/'}${value}`)
const productUrl = (baseUrl, product) => `${baseUrl}/?producto=${encodeURIComponent(product.slug)}`
const summarize = (text, max = 160) => {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean
}

export const injectImagePreload = (html, baseUrl, imageSrc) => {
  if (!imageSrc) return html
  const imageUrl = absoluteUrl(baseUrl, imageSrc)
  const preload = `<link rel="preload" as="image" href="${escapeAttribute(imageUrl)}" fetchpriority="high" />`
  return html.replace('</head>', () => `    ${preload}\n  </head>`)
}

export const buildRobotsTxt = (baseUrl) => `User-agent: *\nDisallow: /api/\nDisallow: /?admin=1\nDisallow: /?cuenta=1\n\nSitemap: ${baseUrl}/sitemap.xml\n`

export const buildSitemapXml = (baseUrl, products, legalPages = []) => {
  const urls = [
    { loc: `${baseUrl}/` },
    { loc: `${baseUrl}/?contacto=1` },
    ...legalPages.map((page) => ({ loc: `${baseUrl}/?legal=${encodeURIComponent(page)}` })),
    ...products.map((product) => ({ loc: productUrl(baseUrl, product), lastmod: product.createdAt ? String(product.createdAt).slice(0, 10) : undefined })),
  ]
  const entries = urls.map((url) => `  <url><loc>${escapeXml(url.loc)}</loc>${url.lastmod && /^\d{4}-\d{2}-\d{2}$/.test(url.lastmod) ? `<lastmod>${url.lastmod}</lastmod>` : ''}</url>`)
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join('\n')}\n</urlset>\n`
}

export const buildProductJsonLd = (baseUrl, product) => ({
  '@context': 'https://schema.org',
  '@type': 'Product',
  name: product.name,
  description: summarize(product.description),
  image: product.gallery.filter((image) => image.src).map((image) => absoluteUrl(baseUrl, image.src)),
  category: product.category,
  url: productUrl(baseUrl, product),
  offers: {
    '@type': 'Offer',
    priceCurrency: 'ARS',
    price: product.salePrice,
    availability: product.stock > 0 || product.isGiftCard ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
    url: productUrl(baseUrl, product),
  },
})

// Inserta título, descripción, Open Graph y datos estructurados del producto en el HTML base.
export const injectProductMeta = (html, baseUrl, product) => {
  const title = `${product.name} | UnFocus`
  const description = summarize(product.description) || 'Ropa pensada desde la experiencia neurodivergente.'
  const image = product.gallery[0]?.src ? absoluteUrl(baseUrl, product.gallery[0].src) : ''
  const jsonLd = JSON.stringify(buildProductJsonLd(baseUrl, product)).replace(/</g, '\\u003c')
  const tags = [
    image ? `<link rel="preload" as="image" href="${escapeAttribute(image)}" fetchpriority="high" />` : '',
    `<link rel="canonical" href="${escapeAttribute(productUrl(baseUrl, product))}" />`,
    '<meta property="og:type" content="product" />',
    `<meta property="og:title" content="${escapeAttribute(title)}" />`,
    `<meta property="og:description" content="${escapeAttribute(description)}" />`,
    `<meta property="og:url" content="${escapeAttribute(productUrl(baseUrl, product))}" />`,
    image ? `<meta property="og:image" content="${escapeAttribute(image)}" />` : '',
    `<script type="application/ld+json">${jsonLd}</script>`,
  ].filter(Boolean).join('\n    ')
  return html
    .replace(/<title>[\s\S]*?<\/title>/, () => `<title>${escapeXml(title)}</title>`)
    .replace(/<meta name="description"[^>]*>/, () => `<meta name="description" content="${escapeAttribute(description)}" />`)
    .replace('</head>', () => `    ${tags}\n  </head>`)
}
