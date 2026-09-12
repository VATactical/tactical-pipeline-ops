import { useEffect, useMemo, useState } from 'react'
import LoadingScreen from '../components/LoadingScreen'
import { supabase } from '../lib/supabase'
import { updateTaskManagement, updateTaskStatus } from '../services/opsService'
import { useAuth } from '../auth/AuthContext'

export default function TasksPage() {
  const { profile } = useAuth()
  const [tasks, setTasks] = useState([])
  const [filter, setFilter] = useState('Abiertas')
  const [priority, setPriority] = useState('Todas')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    supabase.from('tasks').select('*, clients(code, business_name)').order('created_at', { ascending: false }).then(({ data, error: queryError }) => {
      if (queryError) setError(queryError.message)
      else setTasks(data || [])
      setLoading(false)
    })
  }, [])

  const visible = useMemo(() => tasks.filter((task) => {
    const matchesStatus = filter === 'Todas' || (filter === 'Abiertas' ? task.status !== 'Completada' : task.status === filter)
    const matchesPriority = priority === 'Todas' || task.priority === priority
    const term = search.trim().toLowerCase()
    const matchesSearch = !term || `${task.title} ${task.clients?.code || ''} ${task.clients?.business_name || ''}`.toLowerCase().includes(term)
    return matchesStatus && matchesPriority && matchesSearch
  }), [tasks, filter, priority, search])
  const changeStatus = async (id, status) => {
    try {
      await updateTaskStatus(id, status)
      setTasks((current) => current.map((task) => task.id === id ? { ...task, status } : task))
    } catch (updateError) { setError(updateError.message) }
  }
  const manageTask = async (task, changes) => {
    const next = { ownerRole: task.owner_role, priority: task.priority, dueAt: task.due_at || '', ...changes }
    try {
      await updateTaskManagement(task.id, next)
      setTasks((current) => current.map((item) => item.id === task.id ? { ...item, owner_role: next.ownerRole, owner_name: next.ownerRole === 'onboarding_media' ? 'Diego' : 'Daniel', priority: next.priority, due_at: next.dueAt || null } : item))
    } catch (updateError) { setError(updateError.message) }
  }

  if (loading) return <LoadingScreen />

  return (
    <div className="page-stack">
      <header className="page-header"><div><p className="eyebrow">Ejecución</p><h2>Mis tareas</h2></div><span className="status-pill">{visible.length} visibles</span></header>
      {error && <p className="form-error">{error}</p>}
      <section className="filter-bar"><input type="search" placeholder="Buscar tarea o cliente…" value={search} onChange={(event) => setSearch(event.target.value)} /><select value={filter} onChange={(event) => setFilter(event.target.value)}><option>Abiertas</option><option>Todas</option><option>Pendiente</option><option>En progreso</option><option>Bloqueada</option><option>Completada</option></select><select value={priority} onChange={(event) => setPriority(event.target.value)}><option>Todas</option><option>Urgente</option><option>Alta</option><option>Media</option><option>Baja</option></select></section>
      <section className="content-card task-table">
        {visible.map((task) => { const overdue = task.due_at && task.status !== 'Completada' && new Date(`${task.due_at}T23:59:59`) < new Date(); return <article className={`task-row ${overdue ? 'overdue' : ''}`} key={task.id}><span className={`priority ${task.priority.toLowerCase()}`}>{task.priority}</span><div><strong>{task.clients ? `${task.clients.code} · ${task.clients.business_name}` : 'Tarea general'}</strong><p>{task.title}</p>{task.comments && <p className="task-detail">{task.comments}</p>}<small>{task.phase} · {task.owner_name}{task.due_at ? ` · ${overdue ? 'Atrasada' : 'Vence'} ${task.due_at}` : ''}</small>{profile?.role === 'superadmin' && <div className="task-admin-controls"><select value={task.owner_role} onChange={(event) => manageTask(task, { ownerRole: event.target.value })}><option value="onboarding_media">Diego</option><option value="automation_funnels">Daniel</option></select><select value={task.priority} onChange={(event) => manageTask(task, { priority: event.target.value })}><option>Baja</option><option>Media</option><option>Alta</option><option>Urgente</option></select><input type="date" value={task.due_at || ''} onChange={(event) => manageTask(task, { dueAt: event.target.value })} /></div>}</div><select value={task.status} onChange={(event) => changeStatus(task.id, event.target.value)}><option>Pendiente</option><option>En progreso</option><option>Bloqueada</option><option>Completada</option></select></article> })}
      </section>
    </div>
  )
}
