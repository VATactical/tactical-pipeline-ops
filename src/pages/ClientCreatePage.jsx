import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { createClient } from '../services/opsService'

const initialForm = {
  code: '', business_name: '', owner_name: '', email: '', phone: '', status: 'ONBOARDING',
  phase: 'Perfil', next_action: 'Completar dossier', daily_budget: 30, services: '', markets: '', timezone: '',
}

export default function ClientCreatePage() {
  const [form, setForm] = useState(initialForm)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const navigate = useNavigate()

  const update = (field, value) => setForm((current) => ({ ...current, [field]: value }))
  const submit = async (event) => {
    event.preventDefault(); setSaving(true); setError('')
    try {
      const client = await createClient(form)
      navigate(`/clientes/${client.id}`)
    } catch (saveError) { setError(saveError.message) }
    finally { setSaving(false) }
  }

  return (
    <div className="page-stack">
      <header className="page-header"><div><p className="eyebrow">Nuevo expediente</p><h2>Crear cliente</h2><p className="muted">Registra lo esencial; podrás completar el resto del dossier después.</p></div></header>
      {error && <p className="form-error" role="alert">{error}</p>}
      <form className="content-card client-form" onSubmit={submit}>
        <div><label>Código</label><input required placeholder="C10" value={form.code} onChange={(event) => update('code', event.target.value)} /></div>
        <div><label>Negocio</label><input required value={form.business_name} onChange={(event) => update('business_name', event.target.value)} /></div>
        <div><label>Propietario</label><input value={form.owner_name} onChange={(event) => update('owner_name', event.target.value)} /></div>
        <div><label>Correo</label><input type="email" value={form.email} onChange={(event) => update('email', event.target.value)} /></div>
        <div><label>Teléfono</label><input value={form.phone} onChange={(event) => update('phone', event.target.value)} /></div>
        <div><label>Zona horaria</label><input placeholder="Eastern Time" value={form.timezone} onChange={(event) => update('timezone', event.target.value)} /></div>
        <div><label>Estado</label><select value={form.status} onChange={(event) => update('status', event.target.value)}><option>ONBOARDING</option><option>A2P SUBMITTED</option><option>ADS LIVE</option></select></div>
        <div><label>Presupuesto diario</label><input min="0" type="number" value={form.daily_budget} onChange={(event) => update('daily_budget', event.target.value)} /></div>
        <div className="wide"><label>Servicios</label><input value={form.services} onChange={(event) => update('services', event.target.value)} /></div>
        <div className="wide"><label>Mercados</label><input value={form.markets} onChange={(event) => update('markets', event.target.value)} /></div>
        <div className="wide"><label>Próxima acción</label><input required value={form.next_action} onChange={(event) => update('next_action', event.target.value)} /></div>
        <button className="primary-button wide" disabled={saving}>{saving ? 'Guardando…' : 'Crear cliente'}</button>
      </form>
    </div>
  )
}
