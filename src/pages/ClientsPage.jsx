import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import LoadingScreen from '../components/LoadingScreen'

export default function ClientsPage() {
  const [clients, setClients] = useState([])
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('Todos')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    supabase.from('clients').select('*').order('code').then(({ data, error: queryError }) => {
      if (queryError) setError(queryError.message)
      else setClients(data || [])
      setLoading(false)
    })
  }, [])

  const filtered = useMemo(() => clients.filter((client) => {
    const matchesStatus = status === 'Todos' || client.status === status
    const term = search.toLowerCase()
    const matchesSearch = !term || `${client.code} ${client.business_name} ${client.owner_name}`.toLowerCase().includes(term)
    return matchesStatus && matchesSearch
  }), [clients, search, status])

  if (loading) return <LoadingScreen />

  return (
    <div className="page-stack">
      <header className="page-header"><div><p className="eyebrow">Pipeline</p><h2>Clientes</h2></div><span className="status-pill">{clients.length} activos</span></header>
      {error && <p className="form-error">{error}</p>}
      <section className="filter-bar">
        <input type="search" placeholder="Buscar cliente, código o propietario…" value={search} onChange={(event) => setSearch(event.target.value)} />
        <select value={status} onChange={(event) => setStatus(event.target.value)}><option>Todos</option><option>ONBOARDING</option><option>A2P SUBMITTED</option><option>ADS LIVE</option></select>
      </section>
      <section className="client-grid">
        {filtered.map((client) => (
          <Link className="client-card" to={`/clientes/${client.id}`} key={client.id}>
            <div className="client-card-top"><span className="client-code">{client.code}</span><span className={`lifecycle ${client.status.toLowerCase().replaceAll(' ', '-')}`}>{client.status}</span></div>
            <h3>{client.business_name}</h3><p>{client.owner_name}</p>
            <dl><div><dt>Fase</dt><dd>{client.phase}</dd></div><div><dt>Presupuesto</dt><dd>${client.daily_budget}/día</dd></div><div><dt>Mercado</dt><dd>{client.timezone}</dd></div></dl>
            <span className="card-link">Ver expediente →</span>
          </Link>
        ))}
      </section>
    </div>
  )
}
