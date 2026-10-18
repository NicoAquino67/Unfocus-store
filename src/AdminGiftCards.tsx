import { useEffect, useState } from 'react'
import { apiRequest } from './api'

type IssuedGiftCard = { id: number; code: string; initialArs: number; balanceArs: number; createdAt: string; orderReference: string | null }

function AdminGiftCards() {
  const [cards, setCards] = useState<IssuedGiftCard[]>([])

  useEffect(() => {
    apiRequest<{ giftCards: IssuedGiftCard[] }>('/api/admin/gift-cards').then((payload) => setCards(payload.giftCards)).catch(() => undefined)
  }, [])

  return (
    <section className="admin-settings-panel">
      <div className="admin-order-panel__header"><p className="eyebrow">Promociones</p><h3>Tarjetas de regalo emitidas</h3></div>
      {cards.length > 0 ? (
        <ul className="admin-newsletter-list">
          {cards.map((card) => (
            <li key={card.id} className="admin-newsletter-row">
              <div>
                <strong>{card.code}</strong>
                <span>Saldo ${card.balanceArs.toLocaleString('es-AR')} de ${card.initialArs.toLocaleString('es-AR')}{card.orderReference ? ` · pedido ${card.orderReference}` : ''} · {card.createdAt}</span>
              </div>
            </li>
          ))}
        </ul>
      ) : <p className="admin-empty">Todavía no se emitió ninguna tarjeta.</p>}
    </section>
  )
}

export default AdminGiftCards