import { useEffect, useState, type FormEvent } from 'react'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { apiRequest, type AccountUser, type SavedAddress, type ShippingDetails, type StoreConfig } from './api'

export type PaymentMethod = 'mercadopago' | 'transfer'
export type GuestDetails = { name: string; email: string; phone: string }
export type CheckoutPayload = { shipping: ShippingDetails; acceptTerms: boolean; paymentMethod: PaymentMethod; guest?: GuestDetails; couponCode?: string; giftCardCode?: string }
import { calculateShipping } from './shipping'
import { formatPrice, type DisplayCurrency } from './catalog'

const provinces = ['Buenos Aires', 'Ciudad Autónoma de Buenos Aires', 'Catamarca', 'Chaco', 'Chubut', 'Córdoba', 'Corrientes', 'Entre Ríos', 'Formosa', 'Jujuy', 'La Pampa', 'La Rioja', 'Mendoza', 'Misiones', 'Neuquén', 'Río Negro', 'Salta', 'San Juan', 'San Luis', 'Santa Cruz', 'Santa Fe', 'Santiago del Estero', 'Tierra del Fuego', 'Tucumán']

type CheckoutFormProps = {
  user: AccountUser | null
  subtotal: number
  digitalOnly: boolean
  items: { productId: number; size: string; quantity: number }[]
  shipping: StoreConfig['shipping'] | null
  transfer: StoreConfig['transfer']
  currency: DisplayCurrency
  usdArsRate: number | null
  isSubmitting: boolean
  onBack: () => void
  onOpenTerms: () => void
  onRequestLogin: () => void
  onSubmit: (payload: CheckoutPayload) => void
}

function CheckoutForm({ user, subtotal, digitalOnly, items, shipping, transfer, currency, usdArsRate, isSubmitting, onBack, onOpenTerms, onRequestLogin, onSubmit }: CheckoutFormProps) {
  const [form, setForm] = useState<ShippingDetails>({ method: 'delivery', name: user?.name ?? '', phone: user?.phone ?? '', street: '', city: '', province: '', postalCode: '', notes: '' })
  const [couponInput, setCouponInput] = useState('')
  const [appliedCoupon, setAppliedCoupon] = useState<{ code: string; discountArs: number } | null>(null)
  const [couponMessage, setCouponMessage] = useState('')
  const [giftInput, setGiftInput] = useState('')
  const [appliedGift, setAppliedGift] = useState<{ code: string; balanceArs: number } | null>(null)
  const [giftMessage, setGiftMessage] = useState('')
  const [guestEmail, setGuestEmail] = useState('')
  const [acceptTerms, setAcceptTerms] = useState(false)
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('mercadopago')
  const [savedAddresses, setSavedAddresses] = useState<SavedAddress[]>([])
  const [selectedAddressId, setSelectedAddressId] = useState('')
  const [addressLoadError, setAddressLoadError] = useState('')
  const canPickup = Boolean(shipping?.pickupAddress)

  const isGuest = !user

  useEffect(() => {
    if (isGuest) return
    let isCurrent = true
    apiRequest<{ addresses: SavedAddress[] }>('/api/account/addresses')
      .then(({ addresses }) => {
        if (!isCurrent) return
        setSavedAddresses(addresses)
        const preferred = addresses.find((address) => address.isDefault) ?? addresses[0]
        if (preferred) {
          setSelectedAddressId(String(preferred.id))
          setForm((current) => ({ ...current, ...preferred, method: 'delivery' }))
          return
        }
        return apiRequest<{ shipping: ShippingDetails | null }>('/api/account/shipping').then(({ shipping: saved }) => {
          if (isCurrent && saved) setForm((current) => ({ ...saved, method: saved.method === 'pickup' && !canPickup ? 'delivery' : saved.method, notes: current.notes }))
        })
      })
      .catch((requestError: Error) => {
        if (isCurrent) setAddressLoadError(requestError.message)
      })
    return () => { isCurrent = false }
  }, [canPickup, isGuest])

  const discount = Math.min(appliedCoupon?.discountArs ?? 0, subtotal)
  const shippingCost = digitalOnly ? 0 : calculateShipping(subtotal - discount, form.method, shipping)
  const giftDiscount = Math.min(appliedGift?.balanceArs ?? 0, subtotal - discount + shippingCost)
  const applyGiftCard = async () => {
    setGiftMessage('')
    try {
      const result = await apiRequest<{ code: string; balanceArs: number }>('/api/gift-cards/validate', { method: 'POST', body: JSON.stringify({ code: giftInput }) })
      setAppliedGift(result)
      setGiftMessage(`Tarjeta aplicada. Saldo disponible: ${formatPrice(result.balanceArs, currency, usdArsRate)}.`)
    } catch (requestError) {
      setAppliedGift(null)
      setGiftMessage(requestError instanceof Error ? requestError.message : 'No se pudo validar la tarjeta.')
    }
  }
  const applyCoupon = async () => {
    setCouponMessage('')
    try {
      const result = await apiRequest<{ code: string; discountArs: number }>('/api/coupons/validate', { method: 'POST', body: JSON.stringify({ code: couponInput, items }) })
      setAppliedCoupon(result)
      setCouponMessage(`Cupón ${result.code} aplicado.`)
    } catch (requestError) {
      setAppliedCoupon(null)
      setCouponMessage(requestError instanceof Error ? requestError.message : 'No se pudo validar el código.')
    }
  }
  const update = (field: keyof ShippingDetails, value: string) => {
    setForm((current) => ({ ...current, [field]: value }))
    if (['name', 'phone', 'street', 'city', 'province', 'postalCode'].includes(field)) setSelectedAddressId('')
  }
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    onSubmit({
      shipping: digitalOnly ? { ...form, method: 'digital' as ShippingDetails['method'] } : form,
      acceptTerms,
      paymentMethod: paymentMethod === 'transfer' && !transfer ? 'mercadopago' : paymentMethod,
      ...(appliedGift ? { giftCardCode: appliedGift.code } : {}),
      ...(appliedCoupon ? { couponCode: appliedCoupon.code } : {}),
      ...(isGuest ? { guest: { name: form.name, email: guestEmail, phone: form.phone } } : {}),
    })
  }
  const isDelivery = !digitalOnly && form.method === 'delivery'

  return (
    <form className="checkout-form" onSubmit={submit}>
      <button className="checkout-form__back" type="button" onClick={onBack}><ArrowLeft size={14} aria-hidden="true" /> Volver a la bolsa</button>
      <h3>Datos de entrega</h3>
      {isGuest && (
        <div className="checkout-form__guest">
          <p>Compras como invitado: no necesitas crear una cuenta. <button type="button" onClick={onRequestLogin}>¿Ya tienes cuenta? Inicia sesión</button></p>
          <label><span>Correo electrónico</span><input required type="email" maxLength={254} autoComplete="email" value={guestEmail} onChange={(event) => setGuestEmail(event.target.value)} /></label>
        </div>
      )}
      {digitalOnly && <p className="checkout-form__pickup">Tu pedido es digital: no necesita dirección de envío. Te enviamos el código de la tarjeta por correo cuando se confirme el pago.</p>}
      {canPickup && !digitalOnly && (
        <fieldset className="checkout-form__methods">
          <legend>Cómo quieres recibirlo</legend>
          <label><input type="radio" name="method" checked={isDelivery} onChange={() => update('method', 'delivery')} /> Envío a domicilio</label>
          <label><input type="radio" name="method" checked={!isDelivery} onChange={() => update('method', 'pickup')} /> Retiro en persona (sin costo)</label>
        </fieldset>
      )}
      {isDelivery && !isGuest && savedAddresses.length > 0 && (
        <label className="checkout-form__saved-address"><span>Dirección guardada</span>
          <select value={selectedAddressId} onChange={(event) => {
            const value = event.target.value
            setSelectedAddressId(value)
            const address = savedAddresses.find((item) => String(item.id) === value)
            if (address) setForm((current) => ({ ...current, ...address, method: 'delivery' }))
          }}>
            <option value="">Ingresar otra dirección</option>
            {savedAddresses.map((address) => <option key={address.id} value={address.id}>{address.label}{address.isDefault ? ' · Predeterminada' : ''}</option>)}
          </select>
        </label>
      )}
      {addressLoadError && !isGuest && <p className="checkout-form__hint" role="status">No se pudieron cargar tus direcciones guardadas: {addressLoadError}</p>}
      {!isDelivery && !digitalOnly && shipping?.pickupAddress && <p className="checkout-form__pickup">Retiras en: {shipping.pickupAddress}. Te avisaremos cuando esté listo.</p>}
      <label><span>{digitalOnly ? 'Tu nombre' : isDelivery ? 'Nombre de quien recibe' : 'Nombre de quien retira'}</span><input required minLength={2} maxLength={80} autoComplete="name" value={form.name} onChange={(event) => update('name', event.target.value)} /></label>
      <label><span>Teléfono de contacto</span><input required type="tel" maxLength={40} autoComplete="tel" value={form.phone} onChange={(event) => update('phone', event.target.value)} /></label>
      {isDelivery && (
        <>
          <label><span>Calle, número y piso/depto.</span><input required minLength={3} maxLength={120} autoComplete="street-address" value={form.street} onChange={(event) => update('street', event.target.value)} /></label>
          <div className="checkout-form__row">
            <label><span>Localidad</span><input required minLength={2} maxLength={80} autoComplete="address-level2" value={form.city} onChange={(event) => update('city', event.target.value)} /></label>
            <label><span>Código postal</span><input required minLength={4} maxLength={10} autoComplete="postal-code" value={form.postalCode} onChange={(event) => update('postalCode', event.target.value)} /></label>
          </div>
          <label><span>Provincia</span><select required value={form.province} onChange={(event) => update('province', event.target.value)}><option value="">Selecciona</option>{provinces.map((province) => <option key={province} value={province}>{province}</option>)}</select></label>
        </>
      )}
      <label><span>Indicaciones (opcional)</span><textarea rows={2} maxLength={200} value={form.notes} onChange={(event) => update('notes', event.target.value)} placeholder="Horario, referencias, timbre…" /></label>
      {!digitalOnly && (
      <>
      <div className="checkout-form__coupon">
        <label><span>Código de descuento</span><input value={couponInput} maxLength={30} onChange={(event) => { setCouponInput(event.target.value.toUpperCase()); setAppliedCoupon(null) }} placeholder="Opcional" /></label>
        <button type="button" disabled={!couponInput.trim()} onClick={() => { void applyCoupon() }}>Aplicar</button>
        {couponMessage && <p role="status">{couponMessage}</p>}
      </div>
      <div className="checkout-form__coupon">
        <label><span>Tarjeta de regalo</span><input value={giftInput} maxLength={30} onChange={(event) => { setGiftInput(event.target.value.toUpperCase()); setAppliedGift(null) }} placeholder="GC-XXXX-XXXX-XXXX" /></label>
        <button type="button" disabled={!giftInput.trim()} onClick={() => { void applyGiftCard() }}>Aplicar</button>
        {giftMessage && <p role="status">{giftMessage}</p>}
      </div>
      </>
      )}
      <dl className="checkout-form__totals">
        <div><dt>Subtotal</dt><dd>{formatPrice(subtotal, currency, usdArsRate)}</dd></div>
        {discount > 0 && <div><dt>Descuento ({appliedCoupon?.code})</dt><dd>-{formatPrice(discount, currency, usdArsRate)}</dd></div>}
        {giftDiscount > 0 && <div><dt>Tarjeta de regalo</dt><dd>-{formatPrice(giftDiscount, currency, usdArsRate)}</dd></div>}
        <div><dt>{isDelivery ? 'Envío' : 'Retiro'}</dt><dd>{shippingCost > 0 ? formatPrice(shippingCost, currency, usdArsRate) : 'Sin cargo'}</dd></div>
        <div className="checkout-form__total"><dt>Total</dt><dd>{formatPrice(subtotal - discount + shippingCost - giftDiscount, currency, usdArsRate)}</dd></div>
      </dl>
      {isDelivery && shipping && shipping.freeThresholdArs > 0 && shippingCost > 0 && <p className="checkout-form__hint">Envío gratis desde {formatPrice(shipping.freeThresholdArs, currency, usdArsRate)}.</p>}
      {transfer && (
        <fieldset className="checkout-form__methods">
          <legend>Medio de pago</legend>
          <label><input type="radio" name="payment" checked={paymentMethod === 'mercadopago'} onChange={() => setPaymentMethod('mercadopago')} /> Mercado Pago (tarjetas, cuotas, dinero en cuenta)</label>
          <label><input type="radio" name="payment" checked={paymentMethod === 'transfer'} onChange={() => setPaymentMethod('transfer')} /> Transferencia bancaria</label>
        </fieldset>
      )}
      {transfer && paymentMethod === 'transfer' && (
        <div className="checkout-form__transfer">
          <strong>Cómo pagar por transferencia</strong>
          <ol>
            <li>Confirma el pedido: te mostramos y enviamos por correo los datos de la cuenta.</li>
            <li>Transfiere el total{transfer.alias ? ` al alias ${transfer.alias}` : ''} con el código del pedido como concepto.</li>
            <li>Envíanos el comprobante por correo. Confirmamos el pago y preparamos tu envío.</li>
          </ol>
          <p>Si no recibimos el pago en 3 días, el pedido se cancela y el stock se libera.</p>
        </div>
      )}
      <label className="checkout-form__terms"><input type="checkbox" required checked={acceptTerms} onChange={(event) => setAcceptTerms(event.target.checked)} /><span>Acepto los <button type="button" onClick={onOpenTerms}>términos y condiciones</button> y la política de cambios.</span></label>
      <p className="cart-tax-note">{paymentMethod === 'transfer' ? 'El importe se transfiere en ARS.' : 'Se cobra en ARS a través de Mercado Pago.'}</p>
      <button className="button button--coral checkout-button" type="submit" disabled={isSubmitting}>{isSubmitting ? 'Preparando pago…' : paymentMethod === 'transfer' ? 'Confirmar y pagar por transferencia' : 'Pagar con Mercado Pago'} <ArrowRight size={17} /></button>
    </form>
  )
}

export default CheckoutForm
