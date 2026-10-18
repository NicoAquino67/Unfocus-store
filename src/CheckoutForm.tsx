import { useEffect, useState, type FormEvent } from 'react'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { apiRequest, type AccountUser, type ShippingDetails, type StoreConfig } from './api'
import { calculateShipping } from './shipping'
import { formatPrice, type DisplayCurrency } from './catalog'

const provinces = ['Buenos Aires', 'Ciudad Autónoma de Buenos Aires', 'Catamarca', 'Chaco', 'Chubut', 'Córdoba', 'Corrientes', 'Entre Ríos', 'Formosa', 'Jujuy', 'La Pampa', 'La Rioja', 'Mendoza', 'Misiones', 'Neuquén', 'Río Negro', 'Salta', 'San Juan', 'San Luis', 'Santa Cruz', 'Santa Fe', 'Santiago del Estero', 'Tierra del Fuego', 'Tucumán']

type CheckoutFormProps = {
  user: AccountUser
  subtotal: number
  shipping: StoreConfig['shipping'] | null
  currency: DisplayCurrency
  usdArsRate: number | null
  isSubmitting: boolean
  onBack: () => void
  onOpenTerms: () => void
  onSubmit: (shipping: ShippingDetails, acceptTerms: boolean) => void
}

function CheckoutForm({ user, subtotal, shipping, currency, usdArsRate, isSubmitting, onBack, onOpenTerms, onSubmit }: CheckoutFormProps) {
  const [form, setForm] = useState<ShippingDetails>({ method: 'delivery', name: user.name, phone: user.phone ?? '', street: '', city: '', province: '', postalCode: '', notes: '' })
  const [acceptTerms, setAcceptTerms] = useState(false)
  const canPickup = Boolean(shipping?.pickupAddress)

  useEffect(() => {
    let isCurrent = true
    apiRequest<{ shipping: ShippingDetails | null }>('/api/account/shipping')
      .then(({ shipping: saved }) => {
        if (!isCurrent || !saved) return
        setForm((current) => ({ ...saved, method: saved.method === 'pickup' && !canPickup ? 'delivery' : saved.method, notes: current.notes }))
      })
      .catch(() => undefined)
    return () => { isCurrent = false }
  }, [canPickup])

  const shippingCost = calculateShipping(subtotal, form.method, shipping)
  const update = (field: keyof ShippingDetails, value: string) => setForm((current) => ({ ...current, [field]: value }))
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    onSubmit(form, acceptTerms)
  }
  const isDelivery = form.method === 'delivery'

  return (
    <form className="checkout-form" onSubmit={submit}>
      <button className="checkout-form__back" type="button" onClick={onBack}><ArrowLeft size={14} aria-hidden="true" /> Volver a la bolsa</button>
      <h3>Datos de entrega</h3>
      {canPickup && (
        <fieldset className="checkout-form__methods">
          <legend>Cómo quieres recibirlo</legend>
          <label><input type="radio" name="method" checked={isDelivery} onChange={() => update('method', 'delivery')} /> Envío a domicilio</label>
          <label><input type="radio" name="method" checked={!isDelivery} onChange={() => update('method', 'pickup')} /> Retiro en persona (sin costo)</label>
        </fieldset>
      )}
      {!isDelivery && shipping?.pickupAddress && <p className="checkout-form__pickup">Retiras en: {shipping.pickupAddress}. Te avisaremos cuando esté listo.</p>}
      <label><span>{isDelivery ? 'Nombre de quien recibe' : 'Nombre de quien retira'}</span><input required minLength={2} maxLength={80} autoComplete="name" value={form.name} onChange={(event) => update('name', event.target.value)} /></label>
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
      <dl className="checkout-form__totals">
        <div><dt>Subtotal</dt><dd>{formatPrice(subtotal, currency, usdArsRate)}</dd></div>
        <div><dt>{isDelivery ? 'Envío' : 'Retiro'}</dt><dd>{shippingCost > 0 ? formatPrice(shippingCost, currency, usdArsRate) : 'Sin cargo'}</dd></div>
        <div className="checkout-form__total"><dt>Total</dt><dd>{formatPrice(subtotal + shippingCost, currency, usdArsRate)}</dd></div>
      </dl>
      {isDelivery && shipping && shipping.freeThresholdArs > 0 && shippingCost > 0 && <p className="checkout-form__hint">Envío gratis desde {formatPrice(shipping.freeThresholdArs, currency, usdArsRate)}.</p>}
      <label className="checkout-form__terms"><input type="checkbox" required checked={acceptTerms} onChange={(event) => setAcceptTerms(event.target.checked)} /><span>Acepto los <button type="button" onClick={onOpenTerms}>términos y condiciones</button> y la política de cambios.</span></label>
      <p className="cart-tax-note">Se cobra en ARS a través de Mercado Pago.</p>
      <button className="button button--coral checkout-button" type="submit" disabled={isSubmitting}>{isSubmitting ? 'Preparando pago…' : 'Pagar con Mercado Pago'} <ArrowRight size={17} /></button>
    </form>
  )
}

export default CheckoutForm
