import { useEffect, useMemo, useState } from 'react'
import LoadingScreen from '../components/LoadingScreen'
import { supabase } from '../lib/supabase'
import { updateTaskStatus } from '../services/opsService'

export default function TasksPage() {
  const [tasks, setTasks] = useState([])
  const [filter, setFilter] = useState('Abiertas')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    supabase.from('tasks').select('*, clients(code, business_name)').order('created_at').then(({ data, error: queryError }) => {
      if (queryError) setError(queryError.message)
      else setTasks(data || [])
      setLoading(false)
    })
  }, [])

  const visible = useMemo(() => tasks.filter((task) => filter === 'Todas' || (filter === 'Abiertas' ? task.status !== 'Completada' : task.status === filter)), [tasks, filter])
  const changeStatus = async (id, status) => {
    try {
      await updateTaskStatus(id, status)
      setTasks((current) => current.map((task) => task.id === id ? { ...task, status } : task))
    } catch (updateError) { setError(updateError.message) }
  }

  if (loading) return <LoadingScreen />

  return (
    <div className="page-stack">
      <header className="page-header"><div><p className="eyebrow">Ejecución</p><h2>Mis tareas</h2></div><span className="status-pill">{visible.length} visibles</span></header>
      {error && <p className="form-error">{error}</p>}
      <section className="filter-bar"><select value={filter} onChange={(event) => setFilter(event.target.value)}><option>Abiertas</option><option>Todas</option><option>Pendiente</option><option>En progreso</option><option>Bloqueada</option><option>Completada</option></select></section>
      <section className="content-card task-table">
        {visible.map((task) => <article className="task-row" key={task.id}><span className={`priority ${task.priority.toLowerCase()}`}>{task.priority}</span><div><strong>{task.clients?.code} · {task.clients?.business_name}</strong><p>{task.title}</p><small>{task.phase} · {task.owner_name}</small></div><select value={task.status} onChange={(event) => changeStatus(task.id, event.target.value)}><option>Pendiente</option><option>En progreso</option><option>Bloqueada</option><option>Completada</option></select></article>)}
      </section>
    </div>
  )
}
