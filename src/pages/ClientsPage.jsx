import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import LoadingScreen from '../components/LoadingScreen'

const requiredFields = ['legal_name', 'owner_name', 'phone', 'email', 'address', 'target_zip_codes', 'legal_business_info', 'services', 'offer', 'domain', 'website_url', 'gbp_status', 'onboarding_date', 'target_launch_date', 'ad_strategy', 'ghl_subaccount_link', 'drive_folder_link', 'facebook_business_info', 'meta_assets_info', 'retell_agent_id', 'make_scenario_link', 'slack_channel_link']
const statuses = ['Todos', 'ONBOARDING', 'A2P SUBMITTED', 'ADS LIVE']
const naturalCode = (value) => Number(String(value).match(/\d+/)?.[0] || 0)
const dossierComplete = (client) => requiredFields.every((key) => client[key] && !/pendiente|confirmar|verificar|bloquead|rechazad/i.test(String(client[key])))

export default function ClientsPage() {
  const [clients, setClients] = useState([])
  const [blockedIds, setBlockedIds] = useState(new Set())
  const [filters, setFilters] = useState({ search: '', status: 'Todos', phase: 'Todas', dossier: 'Todos', blockers: 'Todos', sort: 'Código' })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const setFilter = (key, value) => setFilters((current) => ({ ...current, [key]: value }))

  useEffect(() => {
    Promise.all([
      supabase.from('clients').select('*'),
      supabase.from('blockers').select('client_id').eq('resolved', false),
    ]).then(([clientsResult, blockersResult]) => {
      const queryError = clientsResult.error || blockersResult.error
      if (queryError) setError(queryError.message)
      else {
        setClients(clientsResult.data || [])
        setBlockedIds(new Set((blockersResult.data || []).map((item) => item.client_id)))
      }
    }).finally(() => setLoading(false))
  }, [])

  const phases = useMemo(() => ['Todas', ...new Set(clients.map((client) => client.phase).filter(Boolean))], [clients])
  const counts = useMemo(() => Object.fromEntries(statuses.map((status) => [status, status === 'Todos' ? clients.length : clients.filter((client) => client.status === status).length])), [clients])
  const filtered = useMemo(() => clients.filter((client) => {
    const term = filters.search.trim().toLowerCase()
    const matchesSearch = !term || `${client.code} ${client.business_name} ${client.owner_name} ${client.address}`.toLowerCase().includes(term)
    const matchesStatus = filters.status === 'Todos' || client.status === filters.status
    const matchesPhase = filters.phase === 'Todas' || client.phase === filters.phase
    const complete = dossierComplete(client)
    const matchesDossier = filters.dossier === 'Todos' || (filters.dossier === 'Completos' ? complete : !complete)
    const blocked = blockedIds.has(client.id)
    const matchesBlocker = filters.blockers === 'Todos' || (filters.blockers === 'Con bloqueos' ? blocked : !blocked)
    return matchesSearch && matchesStatus && matchesPhase && matchesDossier && matchesBlocker
  }).sort((a, b) => {
    if (filters.sort === 'Nombre') return a.business_name.localeCompare(b.business_name)
    if (filters.sort === 'Estado') return a.status.localeCompare(b.status) || naturalCode(a.code) - naturalCode(b.code)
    return naturalCode(a.code) - naturalCode(b.code)
  }), [clients, blockedIds, filters])
  const hasFilters = filters.search || filters.status !== 'Todos' || filters.phase !== 'Todas' || filters.dossier !== 'Todos' || filters.blockers !== 'Todos' || filters.sort !== 'Código'
  const clearFilters = () => setFilters({ search: '', status: 'Todos', phase: 'Todas', dossier: 'Todos', blockers: 'Todos', sort: 'Código' })

  if (loading) return <LoadingScreen />
  return <div className="page-stack">
    <header className="page-header"><div><p className="eyebrow">Pipeline</p><h2>Clientes</h2><p className="muted">Encuentra rápidamente el expediente que necesita atención.</p></div><span className="status-pill">{clients.length} activos</span></header>
    {error && <p className="form-error">{error}</p>}
    <section className="client-filters content-card">
      <div className="status-tabs" role="group" aria-label="Filtrar por estado">{statuses.map((item) => <button className={filters.status === item ? 'active' : ''} onClick={() => setFilter('status', item)} key={item}>{item === 'Todos' ? 'Todos' : item}<span>{counts[item]}</span></button>)}</div>
      <div className="filter-controls">
        <label className="search-control">Buscar<input type="search" placeholder="Cliente, código, propietario o ciudad…" value={filters.search} onChange={(event) => setFilter('search', event.target.value)} /></label>
        <label>Fase<select value={filters.phase} onChange={(event) => setFilter('phase', event.target.value)}>{phases.map((phase) => <option key={phase}>{phase}</option>)}</select></label>
        <label>Dossier<select value={filters.dossier} onChange={(event) => setFilter('dossier', event.target.value)}><option>Todos</option><option>Completos</option><option>Incompletos</option></select></label>
        <label>Bloqueos<select value={filters.blockers} onChange={(event) => setFilter('blockers', event.target.value)}><option>Todos</option><option>Con bloqueos</option><option>Sin bloqueos</option></select></label>
        <label>Ordenar<select value={filters.sort} onChange={(event) => setFilter('sort', event.target.value)}><option>Código</option><option>Nombre</option><option>Estado</option></select></label>
      </div>
      <div className="filter-summary"><span>{filtered.length} de {clients.length} clientes</span>{hasFilters && <button className="text-button" onClick={clearFilters}>Limpiar filtros</button>}</div>
    </section>
    {filtered.length ? <section className="client-grid">{filtered.map((client) => {
      const complete = dossierComplete(client)
      const blocked = blockedIds.has(client.id)
      return <Link className={`client-card ${blocked ? 'has-alert' : ''}`} to={`/clientes/${client.id}`} key={client.id}>
        <div className="client-card-top"><span className="client-code">{client.code}</span><span className={`lifecycle ${client.status.toLowerCase().replaceAll(' ', '-')}`}>{client.status}</span></div>
        <h3>{client.business_name}</h3><p>{client.owner_name}</p>
        <div className="client-signals"><span className={complete ? 'complete' : ''}>{complete ? 'Dossier completo' : 'Dossier incompleto'}</span>{blocked && <span className="blocked">Bloqueo abierto</span>}</div>
        <dl><div><dt>Fase</dt><dd>{client.phase}</dd></div><div><dt>Presupuesto</dt><dd>$${client.daily_budget}/día</dd></div><div><dt>Mercado</dt><dd>{client.timezone}</dd></div></dl>
        <span className="card-link">Ver expediente →</span>
      </Link>
    })}</section> : <section className="content-card empty-state"><h3>No encontramos clientes</h3><p className="muted">Cambia o limpia los filtros para ver más resultados.</p><button className="secondary-button" onClick={clearFilters}>Limpiar filtros</button></section>}
  </div>
}
