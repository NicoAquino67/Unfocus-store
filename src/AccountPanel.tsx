import { useEffect, useState, type FormEvent } from 'react'
import { ArrowRight, Eye, EyeOff, Heart, LogOut, PackageCheck, ShieldCheck, UserRound } from 'lucide-react'
import { apiRequest, type AccountOrder, type AccountSummary, type AccountUser } from './api'
import { formatPrice, getProductImage, type DisplayCurrency, type Product } from './catalog'
import './AccountPanel.css'

type AccountPanelProps = {
  user: AccountUser | null
  authLoading: boolean
  currency: DisplayCurrency
  usdArsRate: number | null
  onAuthenticated: (user: AccountUser) => void
  onLogout: () => Promise<void>
  onOpenProduct: (product: Product) => void
  onOpenAdmin: () => void
  onToggleFavorite: (product: Product) => Promise<void>
}

const orderStatusLabel = (status: AccountOrder['status']) => {
  if (status === 'paid') return 'Pagado'
  if (status === 'shipped') return 'Enviado'
  if (status === 'delivered') return 'Entregado'
  if (status === 'cancelled') return 'Cancelado'
  return 'Pendiente de pago'
}

const formatOrderDate = (date: string) => {
  const parsedDate = new Date(`${date.replace(' ', 'T')}Z`)
  return Number.isNaN(parsedDate.getTime()) ? date : new Intl.DateTimeFormat('es-AR', { dateStyle: 'medium' }).format(parsedDate)
}

function AccountPanel({ user, authLoading, currency, usdArsRate, onAuthenticated, onLogout, onOpenProduct, onOpenAdmin, onToggleFavorite }: AccountPanelProps) {
  const [isRegistering, setIsRegistering] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [resetEmail, setResetEmail] = useState('')
  const [resetToken, setResetToken] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [showPasswordRecovery, setShowPasswordRecovery] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [resetSubmitting, setResetSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [resetMessage, setResetMessage] = useState('')
  const [summary, setSummary] = useState<AccountSummary | null>(null)
  const [selectedOrderId, setSelectedOrderId] = useState<number | null>(null)
  const [summaryError, setSummaryError] = useState('')

  useEffect(() => {
    if (!user) return
    let isCurrent = true
    apiRequest<AccountSummary>('/api/account/summary')
      .then((summaryData) => {
        if (!isCurrent) return
        setSummary(summaryData)
      })
      .catch((requestError: Error) => { if (isCurrent) setSummaryError(requestError.message) })
    return () => { isCurrent = false }
  }, [user])

  const submitAuthentication = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setIsSubmitting(true)
    setError('')
    try {
      const result = await apiRequest<{ user: AccountUser }>(isRegistering ? '/api/auth/register' : '/api/auth/login', {
        method: 'POST',
        body: JSON.stringify(isRegistering ? { name, email, phone, password } : { email, password }),
      })
      setPassword('')
      onAuthenticated(result.user)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'No se pudo completar el acceso.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const requestPasswordReset = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault()
    setResetSubmitting(true)
    setResetMessage('')
    setError('')
    try {
      const targetEmail = resetEmail || email
      const result = await apiRequest<{ message: string }>('/api/auth/request-password-reset', {
        method: 'POST',
        body: JSON.stringify({ email: targetEmail }),
      })
      setResetMessage(result.message)
      setShowPasswordRecovery(true)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'No se pudo solicitar el restablecimiento.')
    } finally {
      setResetSubmitting(false)
    }
  }

  const submitPasswordReset = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setResetSubmitting(true)
    setResetMessage('')
    try {
      const targetEmail = resetEmail || email
      const result = await apiRequest<{ message: string }>('/api/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ email: targetEmail, token: resetToken, password: newPassword }),
      })
      setResetMessage(result.message)
      setNewPassword('')
      setResetToken('')
      setShowPasswordRecovery(false)
    } catch (requestError) {
      setResetMessage(requestError instanceof Error ? requestError.message : 'No se pudo restablecer la contraseña.')
    } finally {
      setResetSubmitting(false)
    }
  }

  const renderProduct = (product: Product, isFavorite = false) => (
    <article className="account-product" key={product.id}>
      <button className="account-product__image" type="button" onClick={() => onOpenProduct(product)} aria-label={`Ver ${product.name}`}><img src={getProductImage(product)} alt={product.gallery?.[0]?.alt ?? product.alt} loading="lazy" /></button>
      <div className="account-product__details"><p className="product-card__category">{product.category}</p><h3><button type="button" onClick={() => onOpenProduct(product)}>{product.name}</button></h3><span>{formatPrice(product.price, currency, usdArsRate)}</span></div>
      {isFavorite && <button className="account-product__remove" type="button" onClick={async () => { await onToggleFavorite(product); setSummary((current) => current ? { ...current, favorites: current.favorites.filter((item) => item.id !== product.id) } : current) }} aria-label={`Quitar ${product.name} de favoritos`} title="Quitar de favoritos"><Heart size={17} fill="currentColor" /></button>}
      {!isFavorite && <button className="account-product__link" type="button" onClick={() => onOpenProduct(product)}>Ver prenda <ArrowRight size={14} aria-hidden="true" /></button>}
    </article>
  )

  if (authLoading) {
    return <section className="account-panel account-panel--loading" aria-live="polite"><span className="account-loader" /><p>Comprobando tu cuenta…</p></section>
  }

  if (!user) {
    return (
      <section className="account-panel account-panel--auth" aria-labelledby="account-title">
        <div className="account-auth__intro"><span className="account-auth__icon"><UserRound size={23} aria-hidden="true" /></span><p className="eyebrow">UnFocus · Mi cuenta</p><h1 id="account-title">Tu espacio,<br /><em>a tu ritmo.</em></h1><p>Guarda tus prendas favoritas y consulta tus pedidos cuando quieras.</p></div>
        <div className="account-auth__form-wrap">
          <div className="account-auth__tabs" role="tablist" aria-label="Acceso a cuenta"><button type="button" role="tab" aria-selected={!isRegistering} className={!isRegistering ? 'is-active' : ''} onClick={() => { setIsRegistering(false); setError('') }}>Iniciar sesión</button><button type="button" role="tab" aria-selected={isRegistering} className={isRegistering ? 'is-active' : ''} onClick={() => { setIsRegistering(true); setError('') }}>Crear cuenta</button></div>
          <form className="account-auth__form" onSubmit={submitAuthentication}>
            {isRegistering && <label className="account-field"><span>Nombre</span><input autoComplete="name" required minLength={2} maxLength={80} value={name} onChange={(event) => setName(event.target.value)} /></label>}
            <label className="account-field"><span>Correo electrónico</span><input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
            {isRegistering && <label className="account-field"><span>Teléfono <small>Opcional</small></span><input type="tel" autoComplete="tel" value={phone} onChange={(event) => setPhone(event.target.value)} /></label>}
            <div className="account-field"><label htmlFor="account-password">Contraseña</label><div className="account-password-control"><input id="account-password" type={showPassword ? 'text' : 'password'} autoComplete={isRegistering ? 'new-password' : 'current-password'} required minLength={isRegistering ? 10 : 1} value={password} onChange={(event) => setPassword(event.target.value)} /><button type="button" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'} aria-pressed={showPassword} title={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}>{showPassword ? <EyeOff size={17} aria-hidden="true" /> : <Eye size={17} aria-hidden="true" />}</button></div></div>
            {error && <p className="account-error" role="alert">{error}</p>}
            {!isRegistering && <button className="account-link" type="button" onClick={() => setShowPasswordRecovery((visible) => !visible)}>¿Olvidaste tu contraseña?</button>}
            {resetMessage && <p className="account-success" role="status">{resetMessage}</p>}
            <button className="button button--coral account-auth__submit" type="submit" disabled={isSubmitting}>{isSubmitting ? 'Un momento…' : isRegistering ? 'Crear mi cuenta' : 'Iniciar sesión'} <ArrowRight size={16} aria-hidden="true" /></button>
          </form>
          {!isRegistering && showPasswordRecovery && (
            <form className="account-reset-form" onSubmit={submitPasswordReset}>
              <label className="account-field"><span>Correo de recuperación</span><input type="email" autoComplete="email" value={resetEmail || email} onChange={(event) => setResetEmail(event.target.value)} /></label>
              <label className="account-field"><span>Token de acceso</span><input type="text" value={resetToken} onChange={(event) => setResetToken(event.target.value)} placeholder="Ingresá el token recibido" /></label>
              <label className="account-field"><span>Nueva contraseña</span><input type="password" autoComplete="new-password" value={newPassword} minLength={10} onChange={(event) => setNewPassword(event.target.value)} /></label>
              <div className="account-reset-form__actions">
                <button className="button button--dark" type="button" onClick={() => void requestPasswordReset()} disabled={resetSubmitting}>{resetSubmitting ? 'Enviando…' : 'Solicitar restablecimiento'}</button>
                <button className="button button--coral" type="submit" disabled={resetSubmitting}>{resetSubmitting ? 'Guardando…' : 'Guardar nueva contraseña'}</button>
              </div>
            </form>
          )}
          <p className="account-auth__privacy">Tus datos se usan para gestionar tu cuenta y tus pedidos.</p>
        </div>
      </section>
    )
  }

  return (
    <section className="account-panel" aria-labelledby="account-dashboard-title">
      <header className="account-dashboard__header">
        <div><p className="eyebrow">UnFocus · Mi cuenta</p><h1 id="account-dashboard-title">Hola, {user.name.split(' ')[0]}.</h1><p>{user.email}</p></div>
        <div className="account-dashboard__actions">{user.isAdmin && <button className="account-admin-link" type="button" onClick={onOpenAdmin}><ShieldCheck size={16} aria-hidden="true" /> Administrar tienda</button>}<button className="account-logout" type="button" onClick={() => { void onLogout() }}><LogOut size={16} aria-hidden="true" /> Cerrar sesión</button></div>
      </header>

      {summaryError && <p className="account-error" role="alert">{summaryError}</p>}

      <section className="account-section" aria-labelledby="orders-title">
        <div className="account-section__heading"><div><p className="eyebrow">Seguimiento</p><h2 id="orders-title">Pedidos recientes</h2></div><PackageCheck size={21} strokeWidth={1.6} aria-hidden="true" /></div>
        {summary?.orders.length ? <div className="account-orders">{summary.orders.map((order) => {
          const isOpen = selectedOrderId === order.id
          return (
            <article className="account-order" key={order.id}>
              <div className="account-order__summary">
                <div><strong>{order.reference}</strong><span>{formatOrderDate(order.createdAt)}</span></div>
                <div><span className={`account-order__status account-order__status--${order.status}`}>{orderStatusLabel(order.status)}</span><strong>{formatPrice(order.totalArs, currency, usdArsRate)}</strong></div>
              </div>
              <div className="account-order__meta">
                <div className="account-order__items">{order.items.map((item, index) => <span key={`${order.id}-${index}`}>{item.quantity} × {item.name} · {item.size}</span>)}</div>
                <button className="account-order__toggle" type="button" onClick={() => setSelectedOrderId(isOpen ? null : order.id)}>{isOpen ? 'Ocultar detalle' : 'Ver detalle'}</button>
              </div>
              {order.status === 'pending_payment' && order.paymentMethod === 'transfer' && order.transfer && (
                <div className="account-order__transfer">
                  <strong>Paga por transferencia</strong>
                  <p>Transfiere {formatPrice(order.totalArs, currency, usdArsRate)} a:</p>
                  <ul>
                    <li>Titular: {order.transfer.holder}</li>
                    {order.transfer.bank && <li>Banco: {order.transfer.bank}</li>}
                    {order.transfer.cbu && <li>CBU/CVU: {order.transfer.cbu}</li>}
                    {order.transfer.alias && <li>Alias: {order.transfer.alias}</li>}
                    {order.transfer.taxId && <li>CUIT/CUIL: {order.transfer.taxId}</li>}
                  </ul>
                  <p>Pon <b>{order.reference}</b> como concepto y envíanos el comprobante por correo. Confirmamos el pago manualmente.</p>
                </div>
              )}
              {order.status === 'pending_payment' && order.paymentUrl && (
                <a className="account-order__pay" href={order.paymentUrl}>Continuar pago con Mercado Pago <ArrowRight size={15} aria-hidden="true" /></a>
              )}
              {isOpen && (
                <div className="account-order__detail">
                  {order.items.map((item) => (
                    <div key={`${order.id}-${item.name}-${item.size}`} className="account-order__detail-item">
                      <span>{item.name}</span>
                      <span>Talla {item.size}</span>
                      <span>{item.quantity} u.</span>
                      <strong>{formatPrice(item.unitPriceArs * item.quantity, currency, usdArsRate)}</strong>
                    </div>
                  ))}
                  <div className="account-order__shipping">
                    {order.shippingCostArs > 0 && <p><span>Envío</span><strong>{formatPrice(order.shippingCostArs, currency, usdArsRate)}</strong></p>}
                    {order.shipping.method === 'pickup' ? <p><span>Retiro en persona</span></p> : order.shipping.street ? <p><span>Entrega en</span>{order.shipping.street}, {order.shipping.city}, {order.shipping.province} ({order.shipping.postalCode})</p> : null}
                    {order.carrier && <p><span>Transporte</span>{order.carrier}</p>}
                    {order.trackingCode && <p><span>Código de seguimiento</span>{order.trackingCode}</p>}
                  </div>
                </div>
              )}
              {order.trackingUrl && <a className="account-order__pay" href={order.trackingUrl} target="_blank" rel="noreferrer">Seguir mi envío <ArrowRight size={15} aria-hidden="true" /></a>}
            </article>
          )
        })}</div> : <p className="account-empty">Todavía no tienes pedidos. Cuando realices uno, aparecerá aquí.</p>}
      </section>

      <section className="account-section" aria-labelledby="favorites-title">
        <div className="account-section__heading"><div><p className="eyebrow">Tu selección</p><h2 id="favorites-title">Prendas favoritas</h2></div><Heart size={20} strokeWidth={1.6} aria-hidden="true" /></div>
        {summary?.favorites.length ? <div className="account-product-grid">{summary.favorites.map((product) => renderProduct(product, true))}</div> : <p className="account-empty">Aún no guardaste favoritos. Puedes marcarlos con el corazón en cada prenda.</p>}
      </section>

      <section className="account-section" aria-labelledby="recommendations-title">
        <div className="account-section__heading"><div><p className="eyebrow">Para descubrir</p><h2 id="recommendations-title">Recomendaciones</h2></div></div>
        {summary?.recommendations.length ? <div className="account-product-grid">{summary.recommendations.map((product) => renderProduct(product))}</div> : <p className="account-empty">Pronto habrá nuevas prendas para descubrir.</p>}
      </section>
    </section>
  )
}

export default AccountPanel