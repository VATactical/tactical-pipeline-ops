import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import LoadingScreen from '../components/LoadingScreen'
import { loadClient } from '../services/opsService'

const fields = [
  ['Nombre legal', 'legal_name'], ['Propietario', 'owner_name'], ['Teléfono', 'phone'], ['Correo', 'email'],
  ['Dirección', 'address'], ['Zona horaria', 'timezone'], ['Servicios', 'services'], ['Oferta', 'offer'],
  ['KPI', 'kpi'], ['Proyecto mínimo', 'minimum_project'], ['Mercados', 'markets'], ['Exclusiones', 'exclusions'],
  ['Dominio', 'domain'], ['Estado GHL', 'ghl_status'], ['Estado Meta', 'meta_status'], ['Estado A2P', 'a2p_status'],
]

export default function ClientDetailPage() {
  const { clientId } = useParams()
  const [data, setData] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => { loadClient(clientId).then(setData).catch((loadError) => setError(loadError.message)) }, [clientId])

  if (!data && !error) return <LoadingScreen />
  if (error) return <div className="page-stack"><p className="form-error">{error}</p><Link to="/clientes">← Volver</Link></div>

  const { client, tasks, blockers } = data
  return (
    <div className="page-stack">
      <Link className="back-link" to="/clientes">← Todos los clientes</Link>
      <header className="page-header"><div><p className="eyebrow">{client.code} · Expediente operativo</p><h2>{client.business_name}</h2><p className="muted">{client.phase}</p></div><span className={`lifecycle large-pill ${client.status.toLowerCase().replaceAll(' ', '-')}`}>{client.status}</span></header>
      <section className="metric-grid compact"><article className="metric-card blue"><span>Gasto</span><strong>${client.spend}</strong><small>registrado</small></article><article className="metric-card green"><span>Leads</span><strong>{client.leads}</strong><small>recibidos</small></article><article className="metric-card amber"><span>Citas</span><strong>{client.appointments}</strong><small>agendadas</small></article></section>
      <section className="content-card"><p className="eyebrow">Próxima acción</p><h3>{client.next_action}</h3></section>
      <section className="content-card"><p className="eyebrow">Información del cliente</p><div className="detail-grid">{fields.map(([label, key]) => <div className="detail-item" key={key}><span>{label}</span><strong>{key === 'minimum_project' ? `$${client[key]}` : client[key] || 'Pendiente'}</strong></div>)}</div></section>
      <div className="dashboard-grid"><section className="content-card"><p className="eyebrow">Tareas</p><h3>{tasks.length} registradas</h3>{tasks.map((task) => <div className="mini-row" key={task.id}><span className={`priority ${task.priority.toLowerCase()}`}>{task.priority}</span><div><strong>{task.title}</strong><small>{task.status} · {task.owner_name}</small></div></div>)}</section><section className="content-card"><p className="eyebrow">Bloqueos</p><h3>{blockers.filter((item) => !item.resolved).length} abiertos</h3>{blockers.map((item) => <div className="blocker-row" key={item.id}><strong>{item.title}</strong><small>{item.owner_name}</small></div>)}</section></div>
    </div>
  )
}
