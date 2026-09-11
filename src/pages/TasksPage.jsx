import { useEffect, useMemo, useState } from 'react'
import LoadingScreen from '../components/LoadingScreen'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthContext'
import { updateTaskAssignment, updateTaskStatus } from '../services/opsService'

const roleLabels = { onboarding_media: 'Diego · Onboarding & Media', automation_funnels: 'Daniel · Automations & Funnels', superadmin: 'Kevin · Superadmin' }

export default function TasksPage() {
  const { profile } = useAuth()
  const [tasks, setTasks] = useState([])
  const [filter, setFilter] = useState('Abiertas')
  const [roleFilter, setRoleFilter] = useState('Todos')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    supabase.from('tasks').select('*, clients(code, business_name)').order('created_at').then(({ data, error: queryError }) => {
      if (queryError) setError(queryError.message)
      else setTasks(data || [])
      setLoading(false)
    })
  }, [])

  const visible = useMemo(() => tasks.filter((task) => {
    const matchesStatus = filter === 'Todas' || (filter === 'Abiertas' ? task.status !== 'Completada' : task.status === filter)
    const matchesRole = roleFilter === 'Todos' || task.owner_role === roleFilter
    return matchesStatus && matchesRole
  }), [tasks, filter, roleFilter])
  const changeStatus = async (id, status) => {
    try {
      await updateTaskStatus(id, status)
      setTasks((current) => current.map((task) => task.id === id ? { ...task, status } : task))
    } catch (updateError) { setError(updateError.message) }
  }

  const changeAssignment = async (id, ownerRole) => {
    try {
      await updateTaskAssignment(id, ownerRole)
      setTasks((current) => current.map((task) => task.id === id ? { ...task, owner_role: ownerRole, owner_name: roleLabels[ownerRole].split(' · ')[0] } : task))
    } catch (updateError) { setError(updateError.message) }
  }

  if (loading) return <LoadingScreen />

  return (
    <div className="page-stack">
      <header className="page-header"><div><p className="eyebrow">Ejecución</p><h2>Mis tareas</h2></div><span className="status-pill">{visible.length} visibles</span></header>
      {error && <p className="form-error">{error}</p>}
      <section className="filter-bar"><select value={filter} onChange={(event) => setFilter(event.target.value)}><option>Abiertas</option><option>Todas</option><option>Pendiente</option><option>En progreso</option><option>Bloqueada</option><option>Completada</option></select>{profile?.role === 'superadmin' && <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}><option>Todos</option>{Object.entries(roleLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select>}</section>
      <section className="content-card task-table">
        {visible.map((task) => <article className="task-row" key={task.id}><span className={`priority ${task.priority.toLowerCase()}`}>{task.priority}</span><div><strong>{task.clients?.code} · {task.clients?.business_name}</strong><p>{task.title}</p><small>{task.phase} · {task.owner_name}</small>{profile?.role === 'superadmin' && <select className="assignment-select" value={task.owner_role || 'onboarding_media'} onChange={(event) => changeAssignment(task.id, event.target.value)}>{Object.entries(roleLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select>}</div><select value={task.status} onChange={(event) => changeStatus(task.id, event.target.value)}><option>Pendiente</option><option>En progreso</option><option>Bloqueada</option><option>Completada</option></select></article>)}
      </section>
    </div>
  )
}
