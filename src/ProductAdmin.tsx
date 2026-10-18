import { useEffect, useState, type FormEvent } from 'react'
import { ArrowLeft, Check, ImagePlus, Pencil, Plus, Search, Trash2, X } from 'lucide-react'
import { apiRequest, type AdminOrder, type AdminSummary, type ContactMessage, type NewsletterSubscriber, type OrderStatus, type StoreSettings } from './api'
import { formatPrice, getProductFacets, getProductImage, garmentCuts, productAudiences, productGenders, productFacetTag, sizes, type GarmentCut, type Product, type ProductAudience, type ProductGender } from './catalog'
import './ProductAdmin.css'

type ProductDraft = {
  id: number | null
  slug: string
  name: string
  price: string
  stockBySize: Record<string, number>
  composition: string
  cut: GarmentCut
  audience: ProductAudience
  gender: ProductGender
  isPromotion: boolean
  description: string
  designDescription: string
  frontImage: string
  backImage: string
}

type ProductAdminProps = {
  products: Product[]
  onSave: (product: Product) => Promise<void>
  onDelete: (productId: number) => Promise<void>
  onClose: () => void
}

const emptyDraft = (): ProductDraft => ({
  id: null,
  slug: '',
  name: '',
  price: '',
  stockBySize: Object.fromEntries(sizes.map((size) => [size, 0])),
  composition: '',
  cut: 'Regular fit',
  audience: 'Adultos',
  gender: 'Unisex',
  isPromotion: false,
  description: '',
  designDescription: '',
  frontImage: '',
  backImage: '',
})

const productToDraft = (product: Product): ProductDraft => {
  const facets = getProductFacets(product.features)
  return {
    id: product.id,
    slug: product.slug,
    name: product.name,
    price: String(product.price),
    stockBySize: Object.fromEntries(sizes.map((size) => [size, Number(product.stockBySize?.[size] ?? 0)])),
    composition: product.composition,
    cut: facets.cut,
    audience: facets.audience,
    gender: facets.gender,
    isPromotion: Boolean(product.badge && product.badge !== 'Diseño UnFocus'),
    description: product.description,
    designDescription: product.designDescription,
    frontImage: product.gallery?.[0]?.src ?? getProductImage(product, 0),
    backImage: product.gallery?.[1]?.src ?? getProductImage(product, 1),
  }
}

const optimizeImage = async (file: File) => {
  const source = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('No se pudo leer la imagen.'))
    reader.onerror = () => reject(new Error('No se pudo leer la imagen.'))
    reader.readAsDataURL(file)
  })
  const image = new Image()
  image.src = source
  await image.decode()

  const scale = Math.min(1, 1400 / Math.max(image.naturalWidth, image.naturalHeight))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(image.naturalWidth * scale)
  canvas.height = Math.round(image.naturalHeight * scale)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('No se pudo procesar la imagen.')
  context.fillStyle = '#eef1ef'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', 0.82)
}

const createSlug = (value: string) =>
  value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

function ProductAdmin({ products, onSave, onDelete, onClose }: ProductAdminProps) {
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState<ProductDraft | null>(null)
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null)
  const [processingImage, setProcessingImage] = useState<'frontImage' | 'backImage' | null>(null)
  const [formError, setFormError] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [summary, setSummary] = useState<AdminSummary | null>(null)
  const [orders, setOrders] = useState<AdminOrder[]>([])
  const [newsletterSubscribers, setNewsletterSubscribers] = useState<NewsletterSubscriber[]>([])
  const [pendingNewsletterDeleteId, setPendingNewsletterDeleteId] = useState<number | null>(null)
  const [contactMessages, setContactMessages] = useState<ContactMessage[]>([])
  const [settings, setSettings] = useState<StoreSettings | null>(null)
  const [settingsMessage, setSettingsMessage] = useState('')
  const [trackingDrafts, setTrackingDrafts] = useState<Record<number, { carrier: string; trackingCode: string; trackingUrl: string }>>({})

  useEffect(() => {
    let isCurrent = true
    Promise.all([
      apiRequest<AdminSummary>('/api/admin/summary'),
      apiRequest<{ orders: AdminOrder[] }>('/api/admin/orders'),
      apiRequest<{ subscribers: NewsletterSubscriber[] }>('/api/admin/newsletter'),
      apiRequest<{ messages: ContactMessage[] }>('/api/admin/contact-messages'),
      apiRequest<{ settings: StoreSettings }>('/api/admin/settings'),
    ])
      .then(([adminSummary, orderPayload, newsletterPayload, contactPayload, settingsPayload]) => {
        if (!isCurrent) return
        setSettings(settingsPayload.settings)
        setSummary(adminSummary)
        setOrders(orderPayload.orders)
        setNewsletterSubscribers(newsletterPayload.subscribers)
        setContactMessages(contactPayload.messages)
      })
      .catch(() => undefined)
    return () => { isCurrent = false }
  }, [])

  const filteredProducts = products.filter((product) =>
    `${product.name} ${product.description}`.toLocaleLowerCase('es').includes(query.toLocaleLowerCase('es').trim()),
  )
  const inventoryValue = products.reduce((total, product) => total + product.price, 0)

  const handleImage = async (field: 'frontImage' | 'backImage', file?: File) => {
    if (!file) return
    setFormError('')
    setProcessingImage(field)
    try {
      const image = await optimizeImage(file)
      setDraft((current) => current ? { ...current, [field]: image } : current)
    } catch {
      setFormError('No se pudo procesar esa imagen. Prueba con otro archivo. El formato recomendado es JPG o PNG.')
    } finally {
      setProcessingImage(null)
    }
  }

  const saveDraft = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!draft) return
    const name = draft.name.trim()
    const composition = draft.composition.trim()
    const baseSlug = createSlug(name)
    const hasSlugConflict = products.some((product) => product.id !== draft.id && product.slug === baseSlug)
    const existingProduct = products.find((product) => product.id === draft.id)
    const stockBySize = Object.fromEntries(
      sizes
        .map((size) => [size, Number(draft.stockBySize[size] ?? 0)] as const)
        .filter(([, value]) => Number.isInteger(value) && value >= 0),
    )
    const product: Product = {
      id: draft.id ?? Math.max(0, ...products.map((item) => item.id)) + 1,
      slug: existingProduct?.slug ?? (hasSlugConflict ? `${baseSlug}-${Date.now().toString(36)}` : baseSlug),
      name,
      category: 'Camisetas',
      price: Number(draft.price),
      alt: `Camiseta UnFocus ${name}`,
      features: [
        ...(composition ? [composition] : []),
        productFacetTag('cut', draft.cut),
        productFacetTag('audience', draft.audience),
        productFacetTag('gender', draft.gender),
      ],
      composition,
      description: draft.description.trim(),
      designDescription: draft.designDescription.trim(),
      stockBySize,
      gallery: [
        { src: draft.frontImage, alt: `Frente de la camiseta ${name}`, label: 'Frente' },
        { src: draft.backImage, alt: `Espalda de la camiseta ${name}`, label: 'Espalda' },
      ],
      badge: draft.isPromotion ? 'PROMO' : '',
    }
    setIsSaving(true)
    try {
      await onSave(product)
      setDraft(null)
      setFormError('')
    } catch (requestError) {
      setFormError(requestError instanceof Error ? requestError.message : 'No se pudo guardar el producto.')
    } finally {
      setIsSaving(false)
    }
  }

  const confirmDelete = async (productId: number) => {
    setFormError('')
    try {
      await onDelete(productId)
      setPendingDeleteId(null)
    } catch (requestError) {
      setFormError(requestError instanceof Error ? requestError.message : 'No se pudo eliminar el producto.')
    }
  }

  const deleteNewsletterSubscriber = async (subscriberId: number) => {
    try {
      await apiRequest<{ ok: true }>(`/api/admin/newsletter/${subscriberId}`, { method: 'DELETE' })
      setNewsletterSubscribers((current) => current.filter((subscriber) => subscriber.id !== subscriberId))
      setPendingNewsletterDeleteId(null)
    } catch (requestError) {
      setFormError(requestError instanceof Error ? requestError.message : 'No se pudo dar de baja al suscriptor.')
    }
  }

  const markContactMessageRead = async (messageId: number) => {
    try {
      await apiRequest<{ ok: true }>(`/api/admin/contact-messages/${messageId}/read`, { method: 'PATCH' })
      setContactMessages((current) => current.map((message) => message.id === messageId ? { ...message, isRead: true } : message))
    } catch (requestError) {
      setFormError(requestError instanceof Error ? requestError.message : 'No se pudo actualizar el mensaje.')
    }
  }

  const setOrderStatus = async (orderId: number, status: OrderStatus) => {
    const tracking = trackingDrafts[orderId]
    try {
      await apiRequest<{ ok: true; status: string }>(`/api/admin/orders/${orderId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status, ...(status === 'shipped' && tracking ? tracking : {}) }),
      })
      setOrders((current) => current.map((order) => order.id === orderId ? { ...order, status, ...(status === 'shipped' && tracking ? { carrier: tracking.carrier, trackingCode: tracking.trackingCode, trackingUrl: tracking.trackingUrl } : {}) } : order))
      setFormError('')
    } catch (requestError) {
      setFormError(requestError instanceof Error ? requestError.message : 'No se pudo actualizar el estado del pedido.')
    }
  }

  const saveSettings = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!settings) return
    setSettingsMessage('')
    try {
      const result = await apiRequest<{ settings: StoreSettings }>('/api/admin/settings', { method: 'PUT', body: JSON.stringify(settings) })
      setSettings(result.settings)
      setSettingsMessage('Configuración guardada.')
    } catch (requestError) {
      setSettingsMessage(requestError instanceof Error ? requestError.message : 'No se pudo guardar la configuración.')
    }
  }

  const updateTracking = (orderId: number, field: 'carrier' | 'trackingCode' | 'trackingUrl', value: string) => setTrackingDrafts((current) => ({ ...current, [orderId]: { ...(current[orderId] ?? { carrier: '', trackingCode: '', trackingUrl: '' }), [field]: value } }))

  const updateSetting = (key: keyof StoreSettings, value: string) => setSettings((current) => current ? { ...current, [key]: typeof current[key] === 'number' ? Number(value) : value } : current)

  const orderStatusLabel = (status: string) => ({
    pending_payment: 'Pendiente',
    paid: 'Pagado',
    shipped: 'Enviado',
    delivered: 'Entregado',
    cancelled: 'Cancelado',
  }[status] ?? status)

  return (
    <section className="admin-panel" aria-labelledby="admin-title">
      <header className="admin-panel__heading">
        <div>
          <p className="eyebrow">UnFocus Mall · Administración</p>
          <h1 id="admin-title">Productos</h1>
          <p>Gestiona prendas, descripciones e imágenes del catálogo.</p>
        </div>
        <button className="admin-back-button" type="button" onClick={onClose}><ArrowLeft size={16} aria-hidden="true" /> Volver a la tienda</button>
      </header>

      <div className="admin-stats" aria-label="Resumen del catálogo">
        <div><span>Productos publicados</span><strong>{summary?.products ?? products.length}</strong></div>
        <div><span>Pedidos totales</span><strong>{summary?.orders ?? 0}</strong></div>
        <div><span>Ingresos pagados</span><strong>{formatPrice(summary?.totalRevenue ?? 0)}</strong></div>
      </div>

      {formError && !draft && <p className="admin-form-error" role="alert">{formError}</p>}

      {!draft && (
        <section className="admin-summary-grid" aria-label="Panel de pedidos">
          <div className="admin-card"><span>Pendientes</span><strong>{summary?.pending ?? 0}</strong></div>
          <div className="admin-card"><span>Pagados</span><strong>{summary?.paid ?? 0}</strong></div>
          <div className="admin-card"><span>Inventario</span><strong>{formatPrice(inventoryValue)}</strong></div>
        </section>
      )}

      {draft ? (
        <form className="admin-editor" onSubmit={saveDraft}>
          <div className="admin-editor__heading"><div><p className="eyebrow">Catálogo</p><h2>{draft.id === null ? 'Añadir producto' : 'Editar producto'}</h2></div><button className="admin-icon-button" type="button" onClick={() => { setDraft(null); setFormError('') }} aria-label="Cerrar editor" title="Cerrar editor"><X size={18} /></button></div>

          <div className="admin-form-grid">
            <label className="admin-field"><span>Nombre del producto</span><input autoFocus required maxLength={80} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Ej. Mind Unfiltered" /></label>
            <label className="admin-field"><span>Precio (ARS)</span><input required type="number" min="1" step="1" value={draft.price} onChange={(event) => setDraft({ ...draft, price: event.target.value })} placeholder="45900" /></label>
            <label className="admin-field"><span>Composición</span><input required maxLength={100} value={draft.composition} onChange={(event) => setDraft({ ...draft, composition: event.target.value })} placeholder="100% algodón" /></label>
            <label className="admin-field"><span>Corte y calce</span><select value={draft.cut} onChange={(event) => setDraft({ ...draft, cut: event.target.value as GarmentCut })}>{garmentCuts.map((cut) => <option key={cut} value={cut}>{cut}</option>)}</select></label>
            <label className="admin-field"><span>Público por edad</span><select value={draft.audience} onChange={(event) => setDraft({ ...draft, audience: event.target.value as ProductAudience })}>{productAudiences.map((audience) => <option key={audience} value={audience}>{audience}</option>)}</select></label>
            <label className="admin-field"><span>Género</span><select value={draft.gender} onChange={(event) => setDraft({ ...draft, gender: event.target.value as ProductGender })}>{productGenders.map((gender) => <option key={gender} value={gender}>{gender}</option>)}</select></label>
            <label className="admin-promotion-toggle"><input type="checkbox" checked={draft.isPromotion} onChange={(event) => setDraft({ ...draft, isPromotion: event.target.checked })} /><span>Producto en promoción: mostrar distintivo azul</span></label>
            <div className="admin-field"><span>Stock por talla</span><div className="admin-size-stock-grid">{sizes.map((size) => (
              <label key={size} className="admin-size-stock-item"><span>{size}</span><input type="number" min="0" step="1" value={draft.stockBySize[size] ?? 0} onChange={(event) => setDraft((current) => current ? { ...current, stockBySize: { ...current.stockBySize, [size]: Number(event.target.value) } } : current)} /></label>
            ))}</div></div>
            <label className="admin-field admin-field--wide"><span>Descripción</span><textarea required rows={3} maxLength={500} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} placeholder="Describe la prenda con claridad." /></label>
            <label className="admin-field admin-field--wide"><span>Sobre el diseño</span><textarea required rows={3} maxLength={500} value={draft.designDescription} onChange={(event) => setDraft({ ...draft, designDescription: event.target.value })} placeholder="Cuenta qué representa el diseño." /></label>
          </div>

          <div className="admin-upload-grid">
            {([
              { field: 'frontImage', label: 'Imagen frontal', viewIndex: 0 },
              { field: 'backImage', label: 'Imagen trasera', viewIndex: 1 },
            ] as const).map(({ field, label, viewIndex }) => (
              <label className="admin-upload" key={field}>
                <span className="admin-upload__label">{label}</span>
                <span className="admin-upload__preview">{draft[field] ? <img src={draft[field]} alt={`Vista previa ${label.toLocaleLowerCase('es')}`} /> : <ImagePlus size={26} strokeWidth={1.5} aria-hidden="true" />}</span>
                <span className="admin-upload__action"><ImagePlus size={15} aria-hidden="true" /> {processingImage === field ? 'Procesando…' : draft[field] ? 'Cambiar imagen' : 'Subir imagen'}</span>
                <input type="file" accept="image/*" required={!draft[field]} disabled={processingImage !== null} onChange={(event) => { void handleImage(field, event.currentTarget.files?.[0]); event.currentTarget.value = '' }} />
                <span className="admin-upload__hint">Vista: {viewIndex === 0 ? 'Frente' : 'Espalda'}. La imagen se optimiza al subirla.</span>
              </label>
            ))}
          </div>

          {formError && <p className="admin-form-error" role="alert">{formError}</p>}
          <div className="admin-editor__footer"><button className="admin-cancel-button" type="button" onClick={() => { setDraft(null); setFormError('') }}>Cancelar</button><button className="button button--coral" type="submit" disabled={processingImage !== null || isSaving}><Check size={16} aria-hidden="true" /> {isSaving ? 'Guardando…' : 'Guardar producto'}</button></div>
        </form>
      ) : (
        <section className="admin-inventory" aria-labelledby="inventory-title">
          <div className="admin-inventory__toolbar"><div><p className="eyebrow">Catálogo actual</p><h2 id="inventory-title">Inventario <span>({products.length})</span></h2></div><div className="admin-inventory__actions"><label className="admin-search"><Search size={16} aria-hidden="true" /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar productos" aria-label="Buscar productos" /></label><button className="button button--coral" type="button" onClick={() => setDraft(emptyDraft())}><Plus size={16} aria-hidden="true" /> Añadir producto</button></div></div>
          <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th scope="col">Producto</th><th scope="col">Composición</th><th scope="col">Precio</th><th scope="col">Acciones</th></tr></thead><tbody>
            {filteredProducts.map((product) => (
              <tr key={product.id}>
                <td><div className="admin-product-cell"><img src={getProductImage(product)} alt="" /><div><strong>{product.name}</strong><span>{product.category} · {product.gallery?.length ?? 0} vistas</span></div></div></td>
                <td>{product.composition}</td>
                <td>{formatPrice(product.price)}</td>
                <td><div className="admin-row-actions">{pendingDeleteId === product.id ? <><span className="admin-confirm-label">¿Eliminar?</span><button className="admin-icon-button admin-icon-button--danger" type="button" onClick={() => { void confirmDelete(product.id) }} aria-label={`Confirmar eliminación de ${product.name}`} title="Confirmar eliminación"><Check size={16} /></button><button className="admin-icon-button" type="button" onClick={() => setPendingDeleteId(null)} aria-label="Cancelar eliminación" title="Cancelar"><X size={16} /></button></> : <><button className="admin-icon-button" type="button" onClick={() => { setDraft(productToDraft(product)); setFormError('') }} aria-label={`Editar ${product.name}`} title="Editar"><Pencil size={16} /></button><button className="admin-icon-button admin-icon-button--danger" type="button" onClick={() => setPendingDeleteId(product.id)} aria-label={`Eliminar ${product.name}`} title="Eliminar"><Trash2 size={16} /></button></>}</div></td>
              </tr>
            ))}
            {filteredProducts.length === 0 && <tr><td className="admin-empty" colSpan={4}>No hay productos que coincidan con la búsqueda.</td></tr>}
          </tbody></table></div>

          <div className="admin-order-panel">
            <div className="admin-order-panel__header"><p className="eyebrow">Pedidos</p><h3>Estado de operaciones</h3></div>
            <div className="admin-order-list">{orders.length ? orders.map((order) => (
              <article key={order.id} className="admin-order-card">
                <div className="admin-order-card__meta"><strong>{order.reference}</strong><span>{order.userName} · {order.userEmail}</span></div>
                <div className="admin-order-card__detail"><span>{new Date(`${order.createdAt.replace(' ', 'T')}Z`).toLocaleDateString('es-AR')}</span><strong>{formatPrice(order.totalArs)}</strong></div>
                <div className="admin-order-card__actions">
                  <span className={`admin-order-status admin-order-status--${order.status}`}>{orderStatusLabel(order.status)}</span>
                  <select value={order.status} onChange={(event) => { void setOrderStatus(order.id, event.target.value as OrderStatus) }} aria-label={`Actualizar estado de ${order.reference}`}>
                    <option value="pending_payment">Pendiente</option>
                    <option value="paid">Pagado</option>
                    <option value="shipped">Enviado</option>
                    <option value="delivered">Entregado</option>
                    <option value="cancelled">Cancelado</option>
                  </select>
                </div>
                <div className="admin-order-card__shipping">
                  <p>{order.shipping.method === 'pickup' ? 'Retiro en persona' : 'Envío'}: {order.shipping.name} · {order.shipping.phone}{order.shipping.method === 'delivery' && order.shipping.street ? ` · ${order.shipping.street}, ${order.shipping.city}, ${order.shipping.province} (${order.shipping.postalCode})` : ''}{order.shipping.notes ? ` · “${order.shipping.notes}”` : ''}</p>
                  <p>{order.items.map((item) => `${item.quantity}× ${item.name} (${item.size})`).join(', ')}</p>
                  {order.status === 'paid' && (
                    <div className="admin-tracking-form">
                      <input placeholder="Transporte (Andreani, Correo…)" value={trackingDrafts[order.id]?.carrier ?? ''} onChange={(event) => updateTracking(order.id, 'carrier', event.target.value)} />
                      <input placeholder="Código de seguimiento" value={trackingDrafts[order.id]?.trackingCode ?? ''} onChange={(event) => updateTracking(order.id, 'trackingCode', event.target.value)} />
                      <input placeholder="Link de seguimiento (opcional)" value={trackingDrafts[order.id]?.trackingUrl ?? ''} onChange={(event) => updateTracking(order.id, 'trackingUrl', event.target.value)} />
                      <button type="button" onClick={() => { void setOrderStatus(order.id, 'shipped') }}>Marcar como enviado</button>
                    </div>
                  )}
                  {order.status === 'shipped' && order.trackingCode && <p>{order.carrier} · {order.trackingCode}</p>}
                </div>
              </article>
            )) : <p className="admin-empty">Todavía no hay pedidos registrados.</p>}</div>
          </div>

          {settings && (
            <form className="admin-settings-panel" onSubmit={(event) => { void saveSettings(event) }}>
              <div className="admin-order-panel__header"><p className="eyebrow">Tienda</p><h3>Envíos y datos legales</h3></div>
              <div className="admin-form-grid">
                <label className="admin-field"><span>Costo de envío (ARS)</span><input type="number" min="0" step="1" value={settings.shippingCostArs} onChange={(event) => updateSetting('shippingCostArs', event.target.value)} /></label>
                <label className="admin-field"><span>Envío gratis desde (ARS, 0 = nunca)</span><input type="number" min="0" step="1" value={settings.freeShippingThresholdArs} onChange={(event) => updateSetting('freeShippingThresholdArs', event.target.value)} /></label>
                <label className="admin-field admin-field--wide"><span>Dirección de retiro (vacío = sin retiro)</span><input maxLength={200} value={settings.pickupAddress} onChange={(event) => updateSetting('pickupAddress', event.target.value)} /></label>
                <label className="admin-field"><span>Razón social</span><input maxLength={200} value={settings.legalName} onChange={(event) => updateSetting('legalName', event.target.value)} /></label>
                <label className="admin-field"><span>CUIT</span><input maxLength={200} value={settings.taxId} onChange={(event) => updateSetting('taxId', event.target.value)} /></label>
                <label className="admin-field admin-field--wide"><span>Domicilio legal</span><input maxLength={200} value={settings.address} onChange={(event) => updateSetting('address', event.target.value)} /></label>
                <label className="admin-field"><span>Email de contacto</span><input type="email" maxLength={200} value={settings.email} onChange={(event) => updateSetting('email', event.target.value)} /></label>
                <label className="admin-field"><span>Teléfono</span><input maxLength={200} value={settings.phone} onChange={(event) => updateSetting('phone', event.target.value)} /></label>
              </div>
              {settingsMessage && <p className="admin-settings-panel__message" role="status">{settingsMessage}</p>}
              <div className="admin-editor__footer"><button className="button button--coral" type="submit"><Check size={16} aria-hidden="true" /> Guardar configuración</button></div>
            </form>
          )}

          <section className="admin-newsletter-panel" aria-labelledby="admin-newsletter-title">
            <div className="admin-order-panel__header"><div><p className="eyebrow">Newsletter</p><h3 id="admin-newsletter-title">Suscriptores <span>({newsletterSubscribers.length})</span></h3></div></div>
            {newsletterSubscribers.length ? <ul className="admin-newsletter-list">
              {newsletterSubscribers.map((subscriber) => (
                <li key={subscriber.id} className="admin-newsletter-row">
                  <div><strong>{subscriber.email}</strong><time dateTime={subscriber.createdAt}>{new Date(`${subscriber.createdAt.replace(' ', 'T')}Z`).toLocaleDateString('es-AR')}</time></div>
                  {pendingNewsletterDeleteId === subscriber.id ? <div className="admin-row-actions"><span className="admin-confirm-label">¿Dar de baja?</span><button className="admin-icon-button admin-icon-button--danger" type="button" onClick={() => { void deleteNewsletterSubscriber(subscriber.id) }} aria-label={`Confirmar baja de ${subscriber.email}`} title="Confirmar baja"><Check size={16} /></button><button className="admin-icon-button" type="button" onClick={() => setPendingNewsletterDeleteId(null)} aria-label="Cancelar baja" title="Cancelar"><X size={16} /></button></div> : <button className="admin-icon-button admin-icon-button--danger" type="button" onClick={() => setPendingNewsletterDeleteId(subscriber.id)} aria-label={`Dar de baja a ${subscriber.email}`} title="Dar de baja"><Trash2 size={16} /></button>}
                </li>
              ))}
            </ul> : <p className="admin-empty">Todavía no hay suscriptores.</p>}
          </section>

          <section className="admin-contact-panel" aria-labelledby="admin-contact-title">
            <div className="admin-order-panel__header"><div><p className="eyebrow">Contacto</p><h3 id="admin-contact-title">Mensajes <span>({contactMessages.length})</span></h3></div><span className="admin-contact-panel__unread">{contactMessages.filter((message) => !message.isRead).length} sin leer</span></div>
            {contactMessages.length ? <div className="admin-contact-list">
              {contactMessages.map((message) => (
                <details className={`admin-contact-message${message.isRead ? '' : ' is-unread'}`} key={message.id}>
                  <summary><span><strong>{message.subject}</strong><small>{message.name} · {message.email}</small></span><time dateTime={message.createdAt}>{new Date(`${message.createdAt.replace(' ', 'T')}Z`).toLocaleDateString('es-AR')}</time></summary>
                  <div className="admin-contact-message__body"><p>{message.message}</p><span className={message.emailSent ? 'is-email-sent' : 'is-email-pending'}>{message.emailSent ? 'Email enviado' : 'Email pendiente'}</span>{!message.isRead && <button type="button" onClick={() => { void markContactMessageRead(message.id) }}><Check size={14} aria-hidden="true" /> Marcar leído</button>}</div>
                </details>
              ))}
            </div> : <p className="admin-empty">Todavía no hay mensajes de contacto.</p>}
          </section>
        </section>
      )}
    </section>
  )
}

export default ProductAdmin