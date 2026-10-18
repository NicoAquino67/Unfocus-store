import { useState, type FormEvent, type ReactNode } from 'react'
import { Send } from 'lucide-react'
import { apiRequest, type StoreConfig } from './api'
import { legalPageKeys, legalPageTitles, type LegalPageKey } from './legalData'
import './LegalPages.css'

type LegalPageProps = {
  page: LegalPageKey
  store: StoreConfig['store'] | null
  onBack: () => void
  onOpenPage: (page: LegalPageKey) => void
  onOpenContact: () => void
}

function RegretForm({ store }: { store: StoreConfig['store'] | null }) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [feedback, setFeedback] = useState<{ message: string; isError?: boolean } | null>(null)

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setIsSubmitting(true)
    setFeedback(null)
    const form = event.currentTarget
    const data = new FormData(form)
    const reference = String(data.get('reference') ?? '').trim()
    try {
      const result = await apiRequest<{ message: string }>('/api/contact', {
        method: 'POST',
        body: JSON.stringify({
          name: data.get('name'),
          email: data.get('email'),
          subject: `Botón de arrepentimiento · Pedido ${reference}`,
          message: `Solicitud de revocación de compra.\nPedido: ${reference}\n\nMotivo: ${String(data.get('reason') ?? '').trim() || 'No indicado'}`,
        }),
      })
      form.reset()
      setFeedback({ message: `Registramos tu solicitud de arrepentimiento. ${result.message}` })
    } catch (requestError) {
      setFeedback({ message: requestError instanceof Error ? requestError.message : 'No se pudo enviar la solicitud.', isError: true })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form className="contact-form legal-page__form" onSubmit={submit}>
      <label><span>Nombre y apellido</span><input name="name" required minLength={2} maxLength={80} autoComplete="name" /></label>
      <label><span>Correo electrónico de la compra</span><input name="email" type="email" required maxLength={254} autoComplete="email" /></label>
      <label><span>Número de pedido</span><input name="reference" required minLength={6} maxLength={40} placeholder="UF-2026-ABC123" /></label>
      <label><span>Motivo (opcional)</span><textarea name="reason" rows={3} maxLength={1000} /></label>
      {feedback && <p className={`contact-form__feedback${feedback.isError ? ' is-error' : ' is-sent'}`} role="status">{feedback.message}</p>}
      <button className="button button--coral" type="submit" disabled={isSubmitting}>{isSubmitting ? 'Enviando…' : 'Revocar mi compra'} <Send size={16} aria-hidden="true" /></button>
      {store?.email && <p className="legal-page__small">También puedes escribirnos a {store.email}.</p>}
    </form>
  )
}

function LegalPages({ page, store, onBack, onOpenPage, onOpenContact }: LegalPageProps) {
  const seller = store?.legalName || 'UnFocus'
  const sellerDetails = [store?.taxId && `CUIT ${store.taxId}`, store?.address].filter(Boolean).join(' · ')
  const contact = store?.email ? <a href={`mailto:${store.email}`}>{store.email}</a> : <button type="button" onClick={onOpenContact}>el formulario de contacto</button>

  const content: Record<LegalPageKey, ReactNode> = {
    terminos: (
      <>
        <h2>1. Quiénes somos</h2>
        <p>Este sitio es operado por {seller}{sellerDetails ? ` (${sellerDetails})` : ''}, en adelante «UnFocus». Al comprar aceptas estos términos.</p>
        <h2>2. Productos y precios</h2>
        <p>Los precios están expresados en pesos argentinos (ARS) e incluyen impuestos. La visualización en dólares es solo orientativa y usa una cotización de referencia: el cobro siempre se realiza en ARS. Las imágenes y descripciones buscan ser fieles; pueden existir pequeñas diferencias de color según tu pantalla.</p>
        <h2>3. Stock y confirmación del pedido</h2>
        <p>Al iniciar el pago reservamos las unidades de tu pedido. El pedido queda confirmado cuando Mercado Pago acredita el pago. Si el pago no se completa, el pedido queda pendiente y puedes retomarlo desde tu cuenta; tras varios intentos rechazados el pedido se cancela y el stock se libera.</p>
        <h2>4. Medios de pago</h2>
        <p>Los pagos se procesan a través de Mercado Pago. UnFocus no almacena datos de tarjetas.</p>
        <h2>5. Envíos y retiro</h2>
        <p>Enviamos a la dirección que indicas al comprar. El costo se informa antes de pagar. Los plazos dependen del transporte y de la zona; cuando despachamos tu pedido te enviamos el código de seguimiento por correo y en tu cuenta. Si está disponible, también puedes elegir retiro en persona sin costo.</p>
        <h2>6. Cambios, devoluciones y arrepentimiento</h2>
        <p>Consulta nuestra <button type="button" onClick={() => onOpenPage('cambios')}>política de cambios y devoluciones</button> y el <button type="button" onClick={() => onOpenPage('arrepentimiento')}>botón de arrepentimiento</button>.</p>
        <h2>7. Cuenta de usuario</h2>
        <p>Eres responsable de mantener la confidencialidad de tu contraseña y de la veracidad de los datos que cargues.</p>
        <h2>8. Defensa del consumidor</h2>
        <p>Rigen la Ley 24.240 de Defensa del Consumidor y normas complementarias. Podes presentar reclamos ante la autoridad de aplicación de tu jurisdicción. Para consultas, escríbenos a través de {contact}.</p>
      </>
    ),
    privacidad: (
      <>
        <h2>1. Responsable del tratamiento</h2>
        <p>{seller}{sellerDetails ? ` (${sellerDetails})` : ''} es responsable de la base de datos que contiene tus datos personales.</p>
        <h2>2. Qué datos recopilamos</h2>
        <p>Nombre, correo, teléfono, dirección de entrega, historial de pedidos, favoritos, reseñas y mensajes que nos envías. No almacenamos datos de tu tarjeta: el pago lo procesa Mercado Pago.</p>
        <h2>3. Para qué los usamos</h2>
        <p>Para gestionar tu cuenta y tus pedidos, enviarte los productos, enviarte correos sobre el estado de tu compra, responder consultas y, solo si te suscribes, enviarte novedades.</p>
        <h2>4. Con quién los compartimos</h2>
        <p>Con Mercado Pago, para procesar el pago, y con los servicios de transporte, para entregar tu pedido. No vendemos tus datos.</p>
        <h2>5. Cookies</h2>
        <p>Usamos una cookie de sesión necesaria para mantener tu cuenta iniciada. No usamos cookies publicitarias.</p>
        <h2>6. Tus derechos</h2>
        <p>Puedes acceder, rectificar o suprimir tus datos escribiéndonos a través de {contact}. La Agencia de Acceso a la Información Pública, órgano de control de la Ley 25.326, tiene la atribución de atender denuncias y reclamos por incumplimiento de las normas de protección de datos personales.</p>
      </>
    ),
    cambios: (
      <>
        <h2>Cambios por talle o modelo</h2>
        <p>Puedes pedir un cambio dentro de los 30 días corridos desde que recibes tu pedido. La prenda debe estar sin uso, sin lavar y con sus etiquetas. Escríbenos a través de {contact} indicando tu número de pedido.</p>
        <h2>Prendas con falla</h2>
        <p>Si recibes una prenda con defecto de fabricación, la cambiamos o te devolvemos el dinero, y nos hacemos cargo del costo de envío.</p>
        <h2>Devolución del dinero</h2>
        <p>Cuando corresponde, el reembolso se realiza por el mismo medio de pago que usaste, a través de Mercado Pago.</p>
        <h2>Costos de envío en cambios</h2>
        <p>El costo de envío de un cambio por talle o preferencia está a cargo del cliente, salvo falla o error nuestro.</p>
        <h2>Derecho de arrepentimiento</h2>
        <p>Además, por ley tienes <strong>10 días corridos</strong> desde la recepción del producto para revocar tu compra sin dar motivos. Puedes hacerlo desde el <button type="button" onClick={() => onOpenPage('arrepentimiento')}>botón de arrepentimiento</button>.</p>
      </>
    ),
    arrepentimiento: (
      <>
        <p>Según el artículo 34 de la Ley 24.240 y la Resolución 424/2020, puedes revocar tu compra dentro de los 10 días corridos contados desde que recibes el producto o desde que se celebra el contrato, lo que ocurra último. Esta revocación es gratuita: no debes dar motivos ni afrontar costos.</p>
        <p>Completa el formulario. Quedará registrada tu solicitud con fecha y te responderemos por correo con los pasos para la devolución y el reembolso.</p>
        <RegretForm store={store} />
      </>
    ),
  }

  return (
    <section className="legal-page" aria-labelledby="legal-title">
      <button className="contact-page__back" type="button" onClick={onBack}>← Volver a la tienda</button>
      <div className="legal-page__layout">
        <nav className="legal-page__nav" aria-label="Información legal">
          {legalPageKeys.map((key) => <button key={key} type="button" className={key === page ? 'is-active' : ''} aria-current={key === page ? 'page' : undefined} onClick={() => onOpenPage(key)}>{legalPageTitles[key]}</button>)}
        </nav>
        <article className="legal-page__body">
          <p className="eyebrow">UnFocus · Información legal</p>
          <h1 id="legal-title">{legalPageTitles[page]}</h1>
          {content[page]}
        </article>
      </div>
    </section>
  )
}

export default LegalPages
