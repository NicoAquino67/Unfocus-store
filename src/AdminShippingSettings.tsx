import { useEffect, useState, type FormEvent } from 'react'
import { Check } from 'lucide-react'
import { apiRequest, type ShippingSettings } from './api'

export type ShippingStatus = { configured: boolean; missing: string[]; environment: string }

type Props = {
  onStatusChange: (correo: ShippingStatus) => void
}

const senderFields: { key: keyof ShippingSettings; label: string; type?: string; maxLength?: number }[] = [
  { key: 'senderName', label: 'Nombre o razón social del remitente' },
  { key: 'senderEmail', label: 'Email del remitente', type: 'email' },
  { key: 'senderAreaCode', label: 'Código de área telefónico' },
  { key: 'senderPhone', label: 'Teléfono del remitente', type: 'tel' },
  { key: 'senderStreet', label: 'Calle del remitente' },
  { key: 'senderStreetNumber', label: 'Número' },
  { key: 'senderFloor', label: 'Piso (opcional)' },
  { key: 'senderDepartment', label: 'Departamento (opcional)' },
  { key: 'senderCity', label: 'Localidad' },
  { key: 'senderProvinceCode', label: 'Código de provincia (ej. B, C, X)', maxLength: 1 },
  { key: 'senderZipCode', label: 'Código postal del remitente' },
]

const parcelFields: { key: keyof ShippingSettings; label: string; max: number }[] = [
  { key: 'parcelWeightGrams', label: 'Peso del paquete (gramos)', max: 50000 },
  { key: 'parcelHeightCm', label: 'Alto del paquete (cm)', max: 200 },
  { key: 'parcelWidthCm', label: 'Ancho (cm)', max: 200 },
  { key: 'parcelDepthCm', label: 'Largo (cm)', max: 200 },
]

export default function AdminShippingSettings({ onStatusChange }: Props) {
  const [settings, setSettings] = useState<ShippingSettings | null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let active = true
    apiRequest<{ settings: ShippingSettings }>('/api/admin/shipping-settings')
      .then((result) => { if (active) setSettings(result.settings) })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : 'No se pudieron cargar los datos de envío.') })
    return () => { active = false }
  }, [])

  const update = (key: keyof ShippingSettings, value: string) => {
    setSettings((current) => current ? { ...current, [key]: value } : current)
    setMessage('')
  }

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!settings) return
    setSaving(true)
    setError('')
    setMessage('')
    try {
      const result = await apiRequest<{ settings: ShippingSettings }>('/api/admin/shipping-settings', {
        method: 'PUT',
        body: JSON.stringify(settings),
      })
      setSettings(result.settings)
      setMessage('Datos de envío guardados.')
      try {
        const correo = await apiRequest<ShippingStatus>('/api/admin/correo-argentino/status')
        onStatusChange(correo)
      } catch {
        setError('Los datos se guardaron, pero no se pudo actualizar el estado de las integraciones.')
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudieron guardar los datos de envío.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <details className="admin-shipping-settings">
      <summary>Configurar remitente y paquete</summary>
      <p className="admin-hint">Datos para Paq.ar. Solo los administradores pueden verlos y editarlos.</p>
      <p className="admin-hint">Las credenciales, identificadores de cuenta, entorno y URL de las API se mantienen en las variables del servidor.</p>
      {settings && (
        <form onSubmit={(event) => { void save(event) }}>
          <fieldset className="admin-shipping-settings__group">
            <legend>Remitente y origen</legend>
            <div className="admin-form-grid">
              {senderFields.map(({ key, label, type, maxLength }) => (
                <label className="admin-field" key={key}>
                  <span>{label}</span>
                  <input type={type ?? 'text'} maxLength={maxLength ?? 200} value={settings[key]} onChange={(event) => update(key, event.target.value)} />
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className="admin-shipping-settings__group">
            <legend>Servicio y paquete</legend>
            <p className="admin-hint">Paq.ar usa estas medidas para el paquete del envío.</p>
            <div className="admin-form-grid">
              <label className="admin-field"><span>Tipo de servicio de Paq.ar (ej. CP)</span><input maxLength={2} value={settings.serviceType} onChange={(event) => update('serviceType', event.target.value)} required /></label>
              <label className="admin-field"><span>Categoría del paquete</span><input maxLength={200} value={settings.parcelCategory} onChange={(event) => update('parcelCategory', event.target.value)} required /></label>
              {parcelFields.map(({ key, label, max }) => (
                <label className="admin-field" key={key}>
                  <span>{label}</span>
                  <input type="number" min="1" max={max} step="1" value={settings[key]} onChange={(event) => update(key, event.target.value)} required />
                </label>
              ))}
            </div>
          </fieldset>
          {message && <p className="admin-settings-panel__message" role="status">{message}</p>}
          <div className="admin-editor__footer"><button className="button button--coral" type="submit" disabled={saving}><Check size={16} aria-hidden="true" /> {saving ? 'Guardando…' : 'Guardar datos de envío'}</button></div>
        </form>
      )}
      {error && <p className="admin-form-error" role="alert">{error}</p>}
    </details>
  )
}
