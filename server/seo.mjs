const escapeXml = (value) => String(value).replace(/[<>&"']/g, (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[char])
const escapeAttribute = (value) => escapeXml(value)
const escapeHtml = (value) => String(value ?? '').replace(/[<>&"']/g, (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' })[char])

const absoluteUrl = (baseUrl, value) => (/^https?:\/\//.test(value) ? value : `${baseUrl}${value.startsWith('/') ? '' : '/'}${value}`)
const productUrl = (baseUrl, product) => `${baseUrl}/?producto=${encodeURIComponent(product.slug)}`
const summarize = (text, max = 160) => {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean
}
const productDescription = (product) => summarize(product.description) || 'Ropa cómoda pensada desde la experiencia neurodivergente.'
const legalTitles = {
  terminos: 'Términos y condiciones',
  privacidad: 'Política de privacidad',
  cambios: 'Cambios y devoluciones',
  arrepentimiento: 'Botón de arrepentimiento',
  defensa: 'Defensa del consumidor',
  baja: 'Botón de baja',
  faq: 'Preguntas y respuestas',
}
const contentPageUrl = (baseUrl, page) => `${baseUrl}/?${page === 'contact' ? 'contacto=1' : page === 'about' ? 'sobre=1' : page === 'diary' ? 'diario=1' : page === 'shop' ? 'tienda=1' : `legal=${encodeURIComponent(page)}`}`
const getLegalSections = (page, contact) => {
  const seller = contact.legalName || 'UnFocus'
  const sellerDetails = [contact.taxId && `CUIT ${contact.taxId}`, contact.address].filter(Boolean).join(' · ')
  const sellerName = `${seller}${sellerDetails ? ` (${sellerDetails})` : ''}`
  const content = {
    terminos: [
      ['1. Quiénes somos', `Este sitio es operado por ${sellerName}, en adelante «UnFocus». Al comprar aceptas estos términos.`],
      ['2. Productos y precios', 'Los precios están expresados en pesos argentinos (ARS) e incluyen impuestos. La visualización en dólares es orientativa; el cobro siempre se realiza en ARS. Las imágenes y descripciones buscan ser fieles, aunque los colores pueden variar según la pantalla.'],
      ['3. Stock y confirmación del pedido', 'Al iniciar el pago reservamos las unidades del pedido. Queda confirmado cuando Mercado Pago acredita el pago. Los pedidos impagos pueden cancelarse y liberar el stock.'],
      ['4. Medios de pago', 'Los pagos se procesan a través de Mercado Pago. UnFocus no almacena datos de tarjetas.'],
      ['5. Envíos y retiro', 'El costo de envío se informa antes de pagar. Los plazos dependen del transporte y de la zona. Si está disponible, también se puede elegir retiro en persona sin costo.'],
      ['6. Cambios y arrepentimiento', 'Los cambios pueden solicitarse dentro de los 30 días corridos desde la recepción. También puedes revocar la compra dentro de los 10 días corridos desde la recepción.'],
      ['7. Defensa del consumidor', 'Rigen la Ley 24.240 de Defensa del Consumidor y sus normas complementarias.'],
    ],
    privacidad: [
      ['1. Responsable del tratamiento', `${sellerName} es responsable de la base de datos que contiene tus datos personales.`],
      ['2. Datos recopilados', 'Nombre, correo, teléfono, dirección de entrega, historial de pedidos, favoritos, reseñas y mensajes que nos envías. No almacenamos los datos de tu tarjeta.'],
      ['3. Uso de los datos', 'Usamos los datos para gestionar tu cuenta y pedidos, entregar productos, responder consultas y, solo si te suscribes, enviarte novedades.'],
      ['4. Con quién se comparten', 'Compartimos los datos necesarios con Mercado Pago para procesar pagos y con los servicios de transporte para entregar pedidos. No vendemos tus datos.'],
      ['5. Cookies', 'Usamos una cookie de sesión necesaria para mantener tu cuenta iniciada. No usamos cookies publicitarias.'],
      ['6. Tus derechos', 'Puedes solicitar acceso, rectificación o supresión de tus datos. La Agencia de Acceso a la Información Pública es el órgano de control de la Ley 25.326.'],
    ],
    cambios: [
      ['Cambios por talle o modelo', 'Puedes pedir un cambio dentro de los 30 días corridos desde que recibes el pedido. La prenda debe estar sin uso, sin lavar y con sus etiquetas.'],
      ['Prendas con falla', 'Si recibes una prenda con defecto de fabricación, la cambiamos o devolvemos el dinero y nos hacemos cargo del costo de envío.'],
      ['Devolución del dinero', 'Cuando corresponde, el reembolso se realiza por el mismo medio de pago utilizado, a través de Mercado Pago.'],
      ['Costos de envío en cambios', 'El costo de envío de un cambio por talle o preferencia está a cargo del cliente, salvo falla o error nuestro.'],
      ['Derecho de arrepentimiento', 'Tienes 10 días corridos desde la recepción para revocar tu compra sin dar motivos.'],
    ],
    arrepentimiento: [
      ['Plazo y condiciones', 'Según el artículo 34 de la Ley 24.240 y la Resolución 424/2020, puedes revocar tu compra dentro de los 10 días corridos contados desde que recibes el producto o desde que se celebra el contrato, lo que ocurra último. La revocación es gratuita y no requiere motivos.'],
      ['Cómo solicitarlo', 'Envía un correo con el número de pedido y la solicitud de revocación. Te responderemos con los pasos para la devolución y el reembolso.'],
    ],
    defensa: [
      ['Tus derechos como consumidor', 'Rige la Ley 24.240 de Defensa del Consumidor. Tienes derecho a información clara y veraz, trato digno y equitativo, seguridad de los productos y a reclamar ante cualquier incumplimiento.'],
      ['Dónde reclamar', 'Si el reclamo no se resuelve con nosotros, puedes presentarlo ante Defensa del Consumidor o la autoridad de aplicación de tu jurisdicción.'],
      ['Datos del proveedor', sellerName],
    ],
    baja: [
      ['Cancelar suscripciones o cuenta', 'Puedes cancelar tus suscripciones o tu cuenta cuando quieras, sin costo. Si tienes pedidos en curso los completamos primero.'],
      ['Conservación de datos', 'Por obligaciones fiscales podemos conservar los datos de facturación durante el plazo que exige la ley.'],
    ],
    faq: [
      ['¿Cómo puedo pagar?', 'Con Mercado Pago (tarjetas de crédito y débito, dinero en cuenta y cuotas según tu tarjeta) o por transferencia bancaria.'],
      ['¿Cuánto tarda y cuánto cuesta el envío?', 'El costo se muestra antes de pagar y puede ser gratis desde cierto monto. Los plazos dependen del transporte y de tu zona.'],
      ['¿Cómo elijo mi talle?', 'Cada producto tiene una guía de talles con medidas en centímetros. Si dudas entre dos, elige el mayor para un calce más holgado.'],
      ['¿Puedo cambiar una prenda?', 'Sí, dentro de los 30 días corridos desde que la recibes, sin uso y con etiquetas.'],
      ['¿Puedo arrepentirme de mi compra?', 'Sí, tienes 10 días corridos desde la recepción para revocarla sin dar motivos.'],
    ],
  }
  return content[page] ?? []
}

export const buildHomepageJsonLd = (baseUrl, { products = [], store = {}, sameAs = [] } = {}) => {
  const organization = {
    '@type': 'Organization',
    '@id': `${baseUrl}/#organization`,
    name: store.legalName || 'UnFocus',
    url: `${baseUrl}/`,
    logo: { '@type': 'ImageObject', url: `${baseUrl}/favicon.svg` },
    description: 'Tienda online de ropa cómoda, pensada desde la experiencia neurodivergente, con información sensorial clara.',
    ...(store.phone ? { telephone: store.phone } : {}),
    ...(sameAs.length ? { sameAs } : {}),
    ...(store.email || store.phone ? {
      contactPoint: {
        '@type': 'ContactPoint',
        contactType: 'customer support',
        ...(store.email ? { email: store.email } : {}),
        ...(store.phone ? { telephone: store.phone } : {}),
        availableLanguage: ['Spanish'],
      },
    } : {}),
    ...(store.address ? {
      address: {
        '@type': 'PostalAddress',
        streetAddress: store.address,
        addressCountry: 'AR',
      },
    } : {}),
    ...(store.taxId ? { taxID: store.taxId } : {}),
  }
  const productItems = products.slice(0, 100).map((product, index) => ({
    '@type': 'ListItem',
    position: index + 1,
    url: productUrl(baseUrl, product),
    name: product.name,
  }))
  return {
    '@context': 'https://schema.org',
    '@graph': [
      organization,
      {
        '@type': 'WebSite',
        '@id': `${baseUrl}/#website`,
        url: `${baseUrl}/`,
        name: 'UnFocus Mall',
        inLanguage: 'es-AR',
        publisher: { '@id': `${baseUrl}/#organization` },
      },
      {
        '@type': 'WebPage',
        '@id': `${baseUrl}/#webpage`,
        url: `${baseUrl}/`,
        name: 'UnFocus Mall | Ropa cómoda',
        isPartOf: { '@id': `${baseUrl}/#website` },
        about: { '@id': `${baseUrl}/#organization` },
        inLanguage: 'es-AR',
      },
      ...(productItems.length ? [{
        '@type': 'ItemList',
        name: 'Productos UnFocus',
        itemListElement: productItems,
      }] : []),
    ],
  }
}

export const injectImagePreload = (html, baseUrl, imageSrc) => {
  if (!imageSrc) return html
  const imageUrl = absoluteUrl(baseUrl, imageSrc)
  const preload = `<link rel="preload" as="image" href="${escapeAttribute(imageUrl)}" fetchpriority="high" />`
  return html.replace('</head>', () => `    ${preload}\n  </head>`)
}

export const buildRobotsTxt = (baseUrl) => `User-agent: *\nContent-Signal: search=yes, ai-train=no\nDisallow: /api/\nDisallow: /?admin=1\nDisallow: /?cuenta=1\n\nSitemap: ${baseUrl}/sitemap.xml\n`

export const buildLlmsTxt = (baseUrl, products = []) => {
  const lines = [
    '# UnFocus Mall',
    '',
    '> Tienda online de ropa cómoda pensada desde la experiencia neurodivergente. Información sensorial clara para elegir a tu ritmo.',
    '',
    '## Páginas principales',
    `- [Inicio](${baseUrl}/)`,
    `- [Tienda](${contentPageUrl(baseUrl, 'shop')})`,
    `- [Nuestra mirada](${contentPageUrl(baseUrl, 'about')})`,
    `- [Diario](${contentPageUrl(baseUrl, 'diary')})`,
    `- [Contacto](${contentPageUrl(baseUrl, 'contact')})`,
    ...Object.entries(legalTitles).map(([slug, title]) => `- [${title}](${contentPageUrl(baseUrl, slug)})`),
    '',
    '## Productos',
  ]
  for (const product of products.slice(0, 100)) {
    lines.push(`- [${product.name}](${productUrl(baseUrl, product)}): ${productDescription(product)}`)
  }
  if (!products.length) lines.push('- El catálogo se está actualizando. Visita la tienda para ver los productos disponibles.')
  return `${lines.join('\n')}\n`
}

export const buildMarkdownPage = (baseUrl, { product, products = [], contact = {}, legalPage = null, aboutPage = false, diaryPage = false, shopPage = false } = {}) => {
  if (product) {
    return `# ${product.name}\n\n${productDescription(product)}\n\n- Categoría: ${product.category}\n- Precio: ARS ${Number(product.salePrice ?? product.price).toLocaleString('es-AR')}\n- [Volver a la tienda](${contentPageUrl(baseUrl, 'shop')})\n`
  }
  if (legalPage && legalTitles[legalPage]) {
    const sections = getLegalSections(legalPage, contact).flatMap(([heading, text]) => [`## ${heading}`, '', text, ''])
    return [`# ${legalTitles[legalPage]}`, '', ...sections, `- [Contacto](${contentPageUrl(baseUrl, 'contact')})`, `- [Inicio](${baseUrl}/)`].join('\n') + '\n'
  }
  if (legalPage === 'contact') {
    return `# Contacto\n\nComunícate con UnFocus Mall para consultas sobre productos y pedidos.\n${contact.email ? `\n- Correo: ${contact.email}\n` : ''}${contact.phone ? `- Teléfono: ${contact.phone}\n` : ''}\n- [Inicio](${baseUrl}/)\n`
  }
  if (aboutPage) {
    return `# Nuestra mirada\n\nNo todos sentimos el mundo de la misma manera, y eso está bien. En UnFocus creemos que la ropa debería adaptarse a las personas, no las personas a la ropa.\n\nNacimos para dar protagonismo a la comodidad, la identidad y la libertad de expresión. Las texturas, los materiales y el ajuste cambian la experiencia de una prenda; por eso compartimos información clara para que puedas elegir a tu ritmo.\n\nCelebramos la individualidad y las distintas formas de sentir. UnFocus no se trata de encajar: se trata de sentirte cómodo siendo vos mismo.\n\n- [Diario](${contentPageUrl(baseUrl, 'diary')})\n- [Contacto](${contentPageUrl(baseUrl, 'contact')})\n- [Términos y condiciones](${contentPageUrl(baseUrl, 'terminos')})\n- [Inicio](${baseUrl}/)\n`
  }
  if (diaryPage) {
    return `# Diario\n\nIdeas, historias y formas de sentir. En este espacio compartiremos vlogs, conversaciones y novedades de UnFocus. Estamos preparando las primeras publicaciones.\n\n- [Suscríbete a la newsletter](${contentPageUrl(baseUrl, 'diary')}#newsletter)\n- [Nuestra mirada](${contentPageUrl(baseUrl, 'about')})\n- [Inicio](${baseUrl}/)\n`
  }
  if (shopPage) {
    const catalog = products.slice(0, 100).map((item) => `- [${item.name}](${productUrl(baseUrl, item)}) — ${productDescription(item)}`)
    return `# Tienda UnFocus\n\n${catalog.length ? catalog.join('\n') : 'El catálogo se está actualizando. Vuelve pronto para ver las prendas disponibles.'}\n`
  }
  const lines = [
    '# UnFocus Mall',
    '',
    'Ropa cómoda pensada desde la experiencia neurodivergente, con información sensorial clara para elegir a tu ritmo.',
    '',
    '## Nuestra mirada',
    'Cada cuerpo siente distinto. Describimos las prendas con claridad para que puedas elegir lo que te hace bien, sin prisa.',
    '',
    '## Productos',
    ...products.slice(0, 30).map((item) => `- [${item.name}](${productUrl(baseUrl, item)}) — ${productDescription(item)}`),
    '',
    '## Información',
    `- [Tienda](${contentPageUrl(baseUrl, 'shop')})`,
    `- [Nuestra mirada](${contentPageUrl(baseUrl, 'about')})`,
    `- [Diario](${contentPageUrl(baseUrl, 'diary')})`,
    `- [Contacto](${contentPageUrl(baseUrl, 'contact')})`,
    `- [Términos y condiciones](${contentPageUrl(baseUrl, 'terminos')})`,
    `- [Política de privacidad](${contentPageUrl(baseUrl, 'privacidad')})`,
  ]
  if (contact.email) lines.push(`- Correo: ${contact.email}`)
  if (contact.phone) lines.push(`- Teléfono: ${contact.phone}`)
  return `${lines.join('\n')}\n`
}

export const renderAgentContent = ({ products = [], product = null, legalPage = null, contact = {}, aboutPage = false, diaryPage = false, shopPage = false } = {}) => {
  if (product) {
    const images = (product.gallery ?? []).filter((image) => image.src).slice(0, 5)
      .map((image) => `<img src="${escapeAttribute(absoluteUrl('', image.src))}" alt="${escapeAttribute(image.alt || product.name)}" />`).join('')
    return `<main id="agent-content"><nav aria-label="Migas de pan"><a href="/">Inicio</a> / <a href="${contentPageUrl('', 'shop')}">Tienda</a></nav><article><h1>${escapeHtml(product.name)}</h1><p>${escapeHtml(product.description)}</p><p><strong>Categoría:</strong> ${escapeHtml(product.category)}</p><p><strong>Precio:</strong> ARS ${Number(product.salePrice ?? product.price).toLocaleString('es-AR')}</p>${product.composition ? `<p><strong>Composición:</strong> ${escapeHtml(product.composition)}</p>` : ''}<div>${images}</div><p><a href="${contentPageUrl('', 'shop')}">Volver a la tienda</a></p></article></main>`
  }
  if (legalPage === 'contact') {
    const email = escapeAttribute(contact.email)
    const phone = escapeAttribute(contact.phone)
    return `<main id="agent-content"><h1>Contacto</h1><p>Comunícate con UnFocus Mall por consultas sobre productos y pedidos.</p>${contact.email ? `<p>Correo electrónico: <a href="mailto:${email}">${escapeHtml(contact.email)}</a></p>` : ''}${contact.phone ? `<p>Teléfono: <a href="tel:${phone}">${escapeHtml(contact.phone)}</a></p>` : ''}<p><a href="/">Inicio</a></p></main>`
  }
  if (aboutPage) {
    return `<main id="agent-content"><h1>Nuestra mirada</h1><p>No todos sentimos el mundo de la misma manera, y eso está bien. En UnFocus creemos que la ropa debería adaptarse a las personas, no las personas a la ropa.</p><p>Nacimos para dar protagonismo a la comodidad, la identidad y la libertad de expresión. Las texturas, los materiales y el ajuste cambian la experiencia de una prenda; por eso compartimos información clara para que puedas elegir a tu ritmo.</p><p>Celebramos la individualidad y las distintas formas de sentir. UnFocus no se trata de encajar: se trata de sentirte cómodo siendo vos mismo.</p><nav aria-label="Más información"><a href="/?diario=1">Diario</a> · <a href="/?contacto=1">Contacto</a> · <a href="/?legal=terminos">Términos y condiciones</a></nav></main>`
  }
  if (diaryPage) {
    return `<main id="agent-content"><h1>Diario</h1><p>Ideas, historias y formas de sentir. En este espacio compartiremos vlogs, conversaciones y novedades de UnFocus.</p><section><h2>Próximamente</h2><p>Estamos preparando las primeras publicaciones. Suscríbete a la <a href="/?diario=1#newsletter">newsletter</a> para enterarte cuando salga algo nuevo.</p></section><nav aria-label="Más información"><a href="/?sobre=1">Nuestra mirada</a> · <a href="/">Inicio</a></nav></main>`
  }
  if (shopPage) {
    const catalog = products.slice(0, 100).map((item) => `<article><h2><a href="${escapeAttribute(productUrl('', item))}">${escapeHtml(item.name)}</a></h2><p>${escapeHtml(productDescription(item))}</p><p>ARS ${Number(item.salePrice ?? item.price).toLocaleString('es-AR')}</p></article>`).join('')
    return `<main id="agent-content"><h1>Tienda UnFocus</h1><p>Explora las prendas y tarjetas de regalo disponibles.</p><section aria-label="Productos">${catalog || '<p>El catálogo se está actualizando. Vuelve pronto para ver las prendas disponibles.</p>'}</section><p><a href="/">Volver al inicio</a></p></main>`
  }
  if (legalPage && legalTitles[legalPage]) {
    const sections = getLegalSections(legalPage, contact)
      .map(([heading, text]) => `<section><h2>${escapeHtml(heading)}</h2><p>${escapeHtml(text)}</p></section>`).join('')
    const contactLink = contact.email
      ? `<p>Consultas: <a href="mailto:${escapeAttribute(contact.email)}">${escapeHtml(contact.email)}</a></p>`
      : '<p>Consultas: <a href="/?contacto=1">formulario de contacto</a></p>'
    return `<main id="agent-content"><h1>${escapeHtml(legalTitles[legalPage])}</h1>${sections}${contactLink}<nav aria-label="Páginas legales">${Object.entries(legalTitles).map(([slug, title]) => `<a href="/?legal=${encodeURIComponent(slug)}">${escapeHtml(title)}</a>`).join(' · ')}</nav></main>`
  }
  const items = products.slice(0, 30).map((item) => `<article><h2><a href="${escapeAttribute(productUrl('', item))}">${escapeHtml(item.name)}</a></h2><p>${escapeHtml(productDescription(item))}</p><p>ARS ${Number(item.salePrice ?? item.price).toLocaleString('es-AR')}</p></article>`).join('')
  return `<main id="agent-content"><section><h1>Ropa cómoda pensada desde la experiencia neurodivergente</h1><p>UnFocus Mall ofrece prendas cómodas con información sensorial clara para elegir a tu ritmo.</p><p><a href="${contentPageUrl('', 'shop')}">Ver la tienda</a> · <a href="${contentPageUrl('', 'about')}">Nuestra mirada</a> · <a href="${contentPageUrl('', 'diary')}">Diario</a> · <a href="/?contacto=1">Contacto</a> · <a href="/?legal=terminos">Términos y condiciones</a></p></section><section id="coleccion"><h2>Productos</h2>${items || '<p>El catálogo se está actualizando. Vuelve pronto para ver los productos.</p>'}</section><section id="historia"><h2>Nuestra mirada</h2><p>Cada cuerpo siente distinto. Describimos cada prenda con claridad para que puedas elegir cómo se sentirá antes de que llegue a casa. Sin reglas sobre cómo vestirte. Sin prisa.</p><a href="${contentPageUrl('', 'about')}">Conoce nuestra historia</a></section><section><h2>Contacto</h2>${contact.email ? `<p>Correo electrónico: <a href="mailto:${escapeAttribute(contact.email)}">${escapeHtml(contact.email)}</a></p>` : ''}${contact.phone ? `<p>Teléfono: <a href="tel:${escapeAttribute(contact.phone)}">${escapeHtml(contact.phone)}</a></p>` : ''}<a href="/?contacto=1">Escríbenos</a></section><nav aria-label="Información legal">${Object.entries(legalTitles).map(([slug, title]) => `<a href="/?legal=${encodeURIComponent(slug)}">${escapeHtml(title)}</a>`).join(' · ')}</nav></main>`
}

export const injectAgentContent = (html, content) => html.replace('<!--SSR_CONTENT-->', () => content)

export const injectSiteMeta = (html, baseUrl, { title = 'UnFocus Mall | Ropa cómoda', description = 'Tienda online de ropa cómoda pensada desde la experiencia neurodivergente.', canonical = `${baseUrl}/`, jsonLd } = {}) => {
  const tags = [
    canonical ? `<link rel="canonical" href="${escapeAttribute(canonical)}" />` : '',
    `<meta property="og:type" content="website" />`,
    `<meta property="og:title" content="${escapeAttribute(title)}" />`,
    `<meta property="og:description" content="${escapeAttribute(description)}" />`,
    canonical ? `<meta property="og:url" content="${escapeAttribute(canonical)}" />` : '',
    jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>` : '',
  ].filter(Boolean).join('\n    ')
  const withHead = html.replace(/<title>[\s\S]*?<\/title>/, () => `<title>${escapeHtml(title)}</title>`)
    .replace(/<meta name="description"[^>]*>/, () => `<meta name="description" content="${escapeAttribute(description)}" />`)
    .replace(/<link rel="canonical"[^>]*>\s*/g, '')
    .replace('</head>', () => `    ${tags}\n  </head>`)
  return withHead
}

export const buildMcpServerCard = (baseUrl) => ({
  $schema: 'https://modelcontextprotocol.io/schemas/server-card/draft.json',
  serverInfo: {
    name: 'unfocus-store',
    version: '1.0.0',
    title: 'UnFocus Mall',
    description: 'Consulta el catálogo público de prendas cómodas de UnFocus Mall.',
    homepage: baseUrl,
  },
  endpoint: `${baseUrl}/mcp`,
  transport: {
    type: 'streamable-http',
    url: `${baseUrl}/mcp`,
  },
  capabilities: {
    tools: { listChanged: false },
  },
  tools: [
    {
      name: 'search_products',
      description: 'Busca prendas del catálogo público de UnFocus por nombre, categoría o descripción.',
    },
  ],
  resources: [{
    name: 'site-index',
    uri: `${baseUrl}/llms.txt`,
    mimeType: 'text/plain',
    description: 'Índice de páginas principales, catálogo y políticas de UnFocus Mall.',
  }],
  links: {
    'terms-of-service': contentPageUrl(baseUrl, 'terminos'),
    'privacy-policy': contentPageUrl(baseUrl, 'privacidad'),
  },
})

export const buildSitemapXml = (baseUrl, products, legalPages = []) => {
  const urls = [
    { loc: `${baseUrl}/` },
    { loc: contentPageUrl(baseUrl, 'about') },
    { loc: contentPageUrl(baseUrl, 'diary') },
    { loc: contentPageUrl(baseUrl, 'shop') },
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
  const description = productDescription(product)
  const image = product.gallery[0]?.src ? absoluteUrl(baseUrl, product.gallery[0].src) : ''
  const jsonLd = JSON.stringify(buildProductJsonLd(baseUrl, product)).replace(/</g, '\\u003c')
  const tags = [
    image ? `<link rel="preload" as="image" href="${escapeAttribute(image)}" fetchpriority="high" />` : '',
    '<meta property="og:type" content="product" />',
    `<meta property="og:title" content="${escapeAttribute(title)}" />`,
    `<meta property="og:description" content="${escapeAttribute(description)}" />`,
    `<meta property="og:url" content="${escapeAttribute(productUrl(baseUrl, product))}" />`,
    image ? `<meta property="og:image" content="${escapeAttribute(image)}" />` : '',
    `<script type="application/ld+json">${jsonLd}</script>`,
  ].filter(Boolean).join('\n    ')
  const withMeta = injectSiteMeta(html, baseUrl, {
    title,
    description,
    canonical: productUrl(baseUrl, product),
  })
  return withMeta.replace('</head>', () => `    ${tags}\n  </head>`)
}
