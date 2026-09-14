import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { runWithSessionRetry, supabase } from '../lib/supabase'
import LoadingScreen from '../components/LoadingScreen'
import { useAuth } from '../auth/AuthContext'
import { createClient } from '../services/opsService'

const requiredFields = ['legal_name', 'owner_name', 'phone', 'email', 'address', 'target_zip_codes', 'legal_business_info', 'services', 'offer', 'domain', 'website_url', 'gbp_status', 'onboarding_date', 'target_launch_date', 'ad_strategy', 'ghl_subaccount_link', 'drive_folder_link', 'facebook_business_info', 'meta_assets_info', 'retell_agent_id', 'make_scenario_link', 'slack_channel_link']
const statuses = ['Todos', 'ONBOARDING', 'A2P SUBMITTED', 'ADS LIVE', 'ADS PAUSED']
const naturalCode = (value) => Number(String(value).match(/\d+/)?.[0] || 0)
const dossierComplete = (client) => requiredFields.every((key) => client[key] && !/pendiente|confirmar|verificar|bloquead|rechazad/i.test(String(client[key])))

export default function ClientsPage() {
  const { profile } = useAuth()
  const [clients, setClients] = useState([])
  const [blockedIds, setBlockedIds] = useState(new Set())
  const [tasks, setTasks] = useState([])
  const [steps, setSteps] = useState([])
  const [filters, setFilters] = useState({ search: '', status: 'Todos', owner: 'Todos', service: '', priority: 'Todas', blockers: 'Todos', sort: 'Código' })
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ code: '', business_name: '', owner_name: '', assigned_role: 'onboarding_media', status: 'ONBOARDING' })
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const setFilter = (key, value) => setFilters((current) => ({ ...current, [key]: value }))

  useEffect(() => {
    runWithSessionRetry(() => Promise.all([
      supabase.from('clients').select('*'),
      supabase.from('blockers').select('client_id').eq('resolved', false),
      supabase.from('tasks').select('client_id, status, priority'),
      supabase.from('client_workflow_steps').select('client_id, completed'),
    ])).then(([clientsResult, blockersResult, tasksResult, stepsResult]) => {
      const queryError = clientsResult.error || blockersResult.error || tasksResult.error || stepsResult.error
      if (queryError) setError(queryError.message)
      else {
        setClients(clientsResult.data || [])
        setBlockedIds(new Set((blockersResult.data || []).map((item) => item.client_id)))
        setTasks(tasksResult.data || [])
        setSteps(stepsResult.data || [])
      }
    }).catch((loadError) => setError(loadError.message)).finally(() => setLoading(false))
  }, [])

  const counts = useMemo(() => Object.fromEntries(statuses.map((status) => [status, status === 'Todos' ? clients.length : clients.filter((client) => client.status === status).length])), [clients])
  const filtered = useMemo(() => clients.filter((client) => {
    const term = filters.search.trim().toLowerCase()
    const matchesSearch = !term || `${client.code} ${client.business_name} ${client.owner_name} ${client.address}`.toLowerCase().includes(term)
    const matchesStatus = filters.status === 'Todos' || client.status === filters.status
    const matchesOwner = filters.owner === 'Todos' || client.assigned_role === filters.owner
    const matchesService = !filters.service.trim() || client.services.toLowerCase().includes(filters.service.trim().toLowerCase())
    const clientTasks = tasks.filter((task) => task.client_id === client.id && task.status !== 'Completada')
    const matchesPriority = filters.priority === 'Todas' || clientTasks.some((task) => task.priority === filters.priority)
    const blocked = blockedIds.has(client.id)
    const matchesBlocker = filters.blockers === 'Todos' || (filters.blockers === 'Con bloqueos' ? blocked : !blocked)
    return matchesSearch && matchesStatus && matchesOwner && matchesService && matchesPriority && matchesBlocker
  }).sort((a, b) => {
    if (filters.sort === 'Nombre') return a.business_name.localeCompare(b.business_name)
    if (filters.sort === 'Estado') return a.status.localeCompare(b.status) || naturalCode(a.code) - naturalCode(b.code)
    if (filters.sort === 'Actualización reciente') return new Date(b.updated_at) - new Date(a.updated_at)
    return naturalCode(a.code) - naturalCode(b.code)
  }), [clients, blockedIds, filters, tasks])
  const hasFilters = filters.search || filters.status !== 'Todos' || filters.owner !== 'Todos' || filters.service || filters.priority !== 'Todas' || filters.blockers !== 'Todos' || filters.sort !== 'Código'
  const clearFilters = () => setFilters({ search: '', status: 'Todos', owner: 'Todos', service: '', priority: 'Todas', blockers: 'Todos', sort: 'Código' })
  const canCreate = Boolean(profile?.permissions?.clients_create)
  const submitClient = async (event) => {
    event.preventDefault(); setSaving(true); setError('')
    try {
      const created = await createClient(form)
      setClients((current) => [...current, created]); setShowForm(false)
      setForm({ code: '', business_name: '', owner_name: '', assigned_role: 'onboarding_media', status: 'ONBOARDING' })
    } catch (createError) { setError(createError.message) }
    finally { setSaving(false) }
  }

  if (loading) return <LoadingScreen />
  return <div className="page-stack">
    <header className="page-header"><div><p className="eyebrow">Pipeline</p><h2>Clientes</h2><p className="muted">Encuentra rápidamente el expediente que necesita atención.</p></div><div className="header-actions"><span className="status-pill">{clients.length} activos</span>{canCreate && <button className="primary-button compact-button" onClick={() => setShowForm((value) => !value)}>+ Registrar cliente</button>}</div></header>
    {error && <p className="form-error">{error}</p>}
    {showForm && <section className="content-card"><div className="section-heading"><div><p className="eyebrow">Nuevo cliente</p><h3>Registrar y generar SOP automáticamente</h3></div><button className="secondary-button" onClick={() => setShowForm(false)}>Cerrar</button></div><form className="client-form" onSubmit={submitClient}><div><label>Código</label><input value={form.code} onChange={(event) => setForm((current) => ({ ...current, code: event.target.value }))} placeholder="C11" required /></div><div><label>Nombre comercial</label><input value={form.business_name} onChange={(event) => setForm((current) => ({ ...current, business_name: event.target.value }))} required /></div><div><label>Propietario</label><input value={form.owner_name} onChange={(event) => setForm((current) => ({ ...current, owner_name: event.target.value }))} /></div><div><label>Responsable interno</label><select value={form.assigned_role} onChange={(event) => setForm((current) => ({ ...current, assigned_role: event.target.value }))}><option value="onboarding_media">Diego</option><option value="automation_funnels">Daniel</option><option value="superadmin">Kevin</option></select></div><div><label>Estado</label><select value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))}><option>ONBOARDING</option><option>A2P SUBMITTED</option><option>ADS LIVE</option></select></div><div className="wide"><button className="primary-button" disabled={saving}>{saving ? 'Registrando…' : 'Registrar cliente'}</button></div></form></section>}
    <section className="client-filters content-card">
      <div className="status-tabs" role="group" aria-label="Filtrar por estado">{statuses.map((item) => <button className={filters.status === item ? 'active' : ''} onClick={() => setFilter('status', item)} key={item}>{item === 'Todos' ? 'Todos' : item}<span>{counts[item]}</span></button>)}</div>
      <div className="filter-controls">
        <label className="search-control">Buscar<input type="search" placeholder="Cliente, código, propietario o ciudad…" value={filters.search} onChange={(event) => setFilter('search', event.target.value)} /></label>
        <label>Responsable<select value={filters.owner} onChange={(event) => setFilter('owner', event.target.value)}><option value="Todos">Todos</option><option value="onboarding_media">Diego</option><option value="automation_funnels">Daniel</option><option value="superadmin">Kevin</option></select></label>
        <label>Servicio<input value={filters.service} onChange={(event) => setFilter('service', event.target.value)} placeholder="Roofing, painting…" /></label>
        <label>Prioridad<select value={filters.priority} onChange={(event) => setFilter('priority', event.target.value)}><option>Todas</option><option>Urgente</option><option>Alta</option><option>Media</option><option>Baja</option></select></label>
        <label>Bloqueos<select value={filters.blockers} onChange={(event) => setFilter('blockers', event.target.value)}><option>Todos</option><option>Con bloqueos</option><option>Sin bloqueos</option></select></label>
        <label>Ordenar<select value={filters.sort} onChange={(event) => setFilter('sort', event.target.value)}><option>Código</option><option>Actualización reciente</option><option>Nombre</option><option>Estado</option></select></label>
      </div>
      <div className="filter-summary"><span>{filtered.length} de {clients.length} clientes</span>{hasFilters && <button className="text-button" onClick={clearFilters}>Limpiar filtros</button>}</div>
    </section>
    {filtered.length ? <section className="client-grid">{filtered.map((client) => {
      const blocked = blockedIds.has(client.id)
      const clientTasks = tasks.filter((task) => task.client_id === client.id && task.status !== 'Completada')
      const clientSteps = steps.filter((step) => step.client_id === client.id)
      const progress = clientSteps.length ? Math.round(clientSteps.filter((step) => step.completed).length / clientSteps.length * 100) : 0
      const responsible = { onboarding_media: 'Diego', automation_funnels: 'Daniel', superadmin: 'Kevin' }[client.assigned_role] || 'Sin asignar'
      return <Link className={`client-card ${blocked || client.status === 'ADS PAUSED' ? 'has-alert' : ''}`} to={`/clientes/${client.id}`} key={client.id}>
        <div className="client-card-top"><span className="client-code">{client.code}</span><span className={`lifecycle ${client.status.toLowerCase().replaceAll(' ', '-')}`}>{client.status}</span></div>
        <h3>{client.business_name}</h3><p>Responsable: {responsible}</p>
        <div className={`client-deadline ${client.target_launch_date && !['ADS LIVE', 'ADS PAUSED'].includes(client.status) && new Date(`${client.target_launch_date}T23:59:59`) < new Date() ? 'overdue' : ''}`}><span>Deadline ADS</span><b>{client.target_launch_date || 'Sin fecha'}</b></div>
        <div className="client-progress"><div><span>Progreso</span><b>{progress}%</b></div><div className="progress-track"><span style={{ width: `${progress}%` }} /></div></div>
        <div className="client-signals"><span>{clientTasks.length} tareas pendientes</span>{client.status === 'ADS PAUSED' && <span className="paused">ADS pausados · {client.ads_pause_reason}</span>}{blocked && <span className="blocked">Bloqueo abierto</span>}</div>
        <span className="card-link">Ver expediente →</span>
      </Link>
    })}</section> : <section className="content-card empty-state"><h3>No encontramos clientes</h3><p className="muted">Cambia o limpia los filtros para ver más resultados.</p><button className="secondary-button" onClick={clearFilters}>Limpiar filtros</button></section>}
  </div>
}
