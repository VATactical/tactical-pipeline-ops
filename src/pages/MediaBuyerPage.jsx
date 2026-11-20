import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { useLanguage } from '../i18n/LanguageContext'
import LoadingScreen from '../components/LoadingScreen'
import { addClientComment, updateTaskStatus } from '../services/opsService'
import { AD_STATUSES, changeAdStatus, downloadPmsCsv, loadMediaBuyerData, updateBuyerField } from '../services/mediaBuyerService'

const RESULTS = ['Bad', 'Good', 'Excellent']
const CONVERSIONS = ['Instant Form', 'Landing page']
const TASK_STATUSES = ['Pendiente', 'En progreso', 'Bloqueada', 'Completada']
const STATUS_CLASS = { Active: 'active', Paused: 'paused', 'Payment Error': 'payment', Draft: 'draft' }
const RESULT_CLASS = { Bad: 'bad', Good: 'good', Excellent: 'excellent' }

const shortUrl = (url) => {
  try { const { hostname } = new URL(url); return hostname.replace(/^www\./, '') } catch { return url }
}

// One editable cell. Saves on blur / Enter (text, url, number) or on change (select).
function Cell({ value, type = 'text', options, canEdit, onSave, display, placeholder }) {
  const { t } = useLanguage()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value ?? '')
  const [saving, setSaving] = useState(false)
  useEffect(() => { if (!editing) setDraft(value ?? '') }, [value, editing])
  const empty = value == null || value === '' || (type === 'number' && !(Number(value) > 0))

  const commit = async (next = draft) => {
    const clean = type === 'number' ? (next === '' ? 0 : Number(next)) : String(next).trim()
    setEditing(false)
    if (clean === (type === 'number' ? Number(value || 0) : String(value ?? ''))) return
    setSaving(true)
    try { await onSave(clean) } catch { setDraft(value ?? '') } finally { setSaving(false) }
  }

  if (type === 'select') {
    if (!canEdit) return empty ? <span className="mb-missing">{t('Falta')}</span> : display || value
    return <select className={`mb-select ${empty ? 'is-missing' : ''}`} value={value || ''} disabled={saving} onChange={(event) => commit(event.target.value)}>
      <option value="">{t('Falta')}</option>
      {options.map((option) => <option key={option} value={option}>{option}</option>)}
    </select>
  }
  if (editing) {
    return <input className="mb-input" autoFocus type={type === 'number' ? 'number' : 'text'} min={type === 'number' ? 0 : undefined}
      value={draft} placeholder={placeholder} onChange={(event) => setDraft(event.target.value)}
      onBlur={() => commit()} onKeyDown={(event) => { if (event.key === 'Enter') commit(); if (event.key === 'Escape') { setDraft(value ?? ''); setEditing(false) } }} />
  }
  const shown = empty ? <span className="mb-missing">{t('Falta')}</span>
    : display || (type === 'url' && /^https?:\/\//i.test(value) ? <a href={value} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>{shortUrl(value)} ↗</a>
      : type === 'number' ? `$${value}` : value)
  return <div className={`mb-cell ${canEdit ? 'editable' : ''} ${saving ? 'saving' : ''}`}>
    <span data-no-translate>{shown}</span>
    {canEdit && <button type="button" className="mb-edit" aria-label={t('Editar')} onClick={() => setEditing(true)}>✎</button>}
  </div>
}

function StatusCell({ client, canEdit, onChange }) {
  const { t } = useLanguage()
  const [next, setNext] = useState('')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const status = client.adStatus
  const options = status === 'Draft' ? [] : client.status === 'CRUISE CONTROL' ? ['Active'] : ['Active', 'Paused', 'Payment Error']
  const pick = (value) => {
    setError('')
    if (value === status) return
    if (value === 'Active') { save(value, ''); return }
    setNext(value)
    setReason(status === 'Active' ? '' : client.ads_pause_reason || '')
  }
  const save = async (value, why) => {
    setSaving(true)
    try { await onChange(client, value, why); setNext(''); setReason('') } catch (saveError) { setError(t(saveError.message)) } finally { setSaving(false) }
  }
  return <div className="mb-status">
    {canEdit && options.length > 1
      ? <select className={`mb-select mb-pill ${STATUS_CLASS[status]}`} value={status} disabled={saving} onChange={(event) => pick(event.target.value)}>
        {options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
      : <span className={`mb-pill ${STATUS_CLASS[status]}`} title={status === 'Draft' ? t(client.status) : undefined}>{status}</span>}
    {next && <form className="mb-reason" onSubmit={(event) => { event.preventDefault(); save(next, reason) }}>
      <input autoFocus value={reason} maxLength="2000" onChange={(event) => setReason(event.target.value)} placeholder={next === 'Payment Error' ? t('Ej. tarjeta rechazada') : t('Motivo de la pausa')} />
      <button className="primary-button compact-button" disabled={saving}>{t('Guardar')}</button>
      <button className="secondary-button compact-button" type="button" onClick={() => setNext('')}>{t('Cancelar')}</button>
    </form>}
    {error && <small className="danger-text">{error}</small>}
  </div>
}

function NoteCell({ client, canEdit, onAdd }) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const [body, setBody] = useState('')
  const [saving, setSaving] = useState(false)
  const submit = async (event) => {
    event.preventDefault()
    if (!body.trim()) return
    setSaving(true)
    try { await onAdd(client, body); setBody(''); setOpen(false) } catch { /* shown above */ } finally { setSaving(false) }
  }
  return <div className="mb-note">
    {client.lastComment ? <span className="mb-note-text" title={client.lastComment.body} data-no-translate>{client.lastComment.body}</span> : <span className="mb-muted">—</span>}
    {canEdit && !open && <button type="button" className="mb-edit" aria-label={t('Agregar nota')} onClick={() => setOpen(true)}>+</button>}
    {open && <form className="mb-reason" onSubmit={submit}>
      <input autoFocus value={body} maxLength="4000" onChange={(event) => setBody(event.target.value)} placeholder={t('Nota para la bitácora del cliente')} />
      <button className="primary-button compact-button" disabled={saving}>{t('Guardar')}</button>
      <button className="secondary-button compact-button" type="button" onClick={() => setOpen(false)}>{t('Cancelar')}</button>
    </form>}
  </div>
}

export default function MediaBuyerPage() {
  const { profile } = useAuth()
  const { t } = useLanguage()
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [statusFilter, setStatusFilter] = useState('launched')
  const [resultFilter, setResultFilter] = useState('')
  const [conversionFilter, setConversionFilter] = useState('')
  const [search, setSearch] = useState('')
  const canEdit = profile?.role === 'superadmin' || Boolean(profile?.permissions?.clients_edit)

  const load = useCallback(async () => {
    try { setData(await loadMediaBuyerData(profile.id)); setError('') } catch (loadError) { setError(t(loadError.message || 'No se pudo cargar la vista.')) }
  }, [profile?.id, t])
  useEffect(() => { load() }, [load])

  const replaceClient = (updated) => setData((current) => ({ ...current, clients: current.clients.map((client) => client.id === updated.id ? { ...client, ...updated } : client) }))
  const run = async (action, message) => {
    setError(''); setNotice('')
    try { await action(); if (message) setNotice(t(message)) } catch (actionError) { setError(t(actionError.message)); throw actionError }
  }
  const saveField = (client, changes) => run(async () => replaceClient(await updateBuyerField(client.id, changes)))
  const saveStatus = async (client, next, reason) => {
    const updated = await changeAdStatus(client, next, reason)
    replaceClient(updated)
    setNotice(t('Estado de anuncios actualizado. Se avisa en el canal del cliente.'))
  }
  const addNote = (client, body) => run(async () => {
    await addClientComment({ clientId: client.id, profileId: profile.id, kind: 'update', body })
    replaceClient({ id: client.id, lastComment: { body: body.trim(), created_at: new Date().toISOString() } })
  }, 'Nota guardada en la bitácora del cliente.')
  const setTaskStatus = (task, status) => run(async () => {
    await updateTaskStatus(task.id, status)
    setData((current) => ({ ...current, tasks: status === 'Completada' ? current.tasks.filter((item) => item.id !== task.id) : current.tasks.map((item) => item.id === task.id ? { ...item, status } : item) }))
  })

  const clients = data?.clients || []
  const counts = useMemo(() => Object.fromEntries(AD_STATUSES.map((status) => [status, clients.filter((client) => client.adStatus === status).length])), [clients])
  const visible = useMemo(() => {
    const term = search.trim().toLowerCase()
    return clients.filter((client) => (statusFilter === 'all' || (statusFilter === 'launched' ? client.adStatus !== 'Draft' : client.adStatus === statusFilter))
      && (!resultFilter || (resultFilter === 'none' ? !client.ad_result_status : client.ad_result_status === resultFilter))
      && (!conversionFilter || (conversionFilter === 'none' ? !client.conversion_location : client.conversion_location === conversionFilter))
      && (!term || `${client.code} ${client.business_name}`.toLowerCase().includes(term)))
  }, [clients, statusFilter, resultFilter, conversionFilter, search])
  const missingCount = visible.filter((client) => !client.conversion_location || !client.facebook_page_url || !client.ad_creatives_link || !client.booking_calendar_link
    || (client.conversion_location === 'Instant Form' ? !client.instant_form_name : !client.landing_page_url)).length

  if (!data && !error) return <LoadingScreen label={t('Cargando vista Media Buyer…')} />

  return <section className="media-buyer-page">
    <header className="page-header">
      <div><p className="eyebrow">{t('Media Buyer')}</p><h2>{t('Campañas por cliente')}</h2>
        <p className="muted">{t('Los mismos datos del dossier: lo que cambies aquí se guarda en la ficha del cliente.')}</p></div>
      <button className="secondary-button" type="button" onClick={() => downloadPmsCsv(visible)}>{t('Descargar Excel (CSV)')}</button>
    </header>

    <div className="mb-counters">
      {AD_STATUSES.map((status) => <button type="button" key={status} className={`mb-counter ${STATUS_CLASS[status]} ${statusFilter === status ? 'selected' : ''}`} onClick={() => setStatusFilter(statusFilter === status ? 'launched' : status)}>
        <span>{status}</span><strong>{counts[status] || 0}</strong>
      </button>)}
    </div>

    <div className="mb-filters">
      <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('Buscar cliente')} />
      <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
        <option value="launched">{t('Con anuncios (sin Draft)')}</option><option value="all">{t('Todos los clientes')}</option>
        {AD_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
      </select>
      <select value={resultFilter} onChange={(event) => setResultFilter(event.target.value)}>
        <option value="">{t('Resultado: todos')}</option>{RESULTS.map((value) => <option key={value} value={value}>{value}</option>)}<option value="none">{t('Sin resultado')}</option>
      </select>
      <select value={conversionFilter} onChange={(event) => setConversionFilter(event.target.value)}>
        <option value="">{t('Conversión: todas')}</option>{CONVERSIONS.map((value) => <option key={value} value={value}>{value}</option>)}<option value="none">{t('Sin definir')}</option>
      </select>
      {missingCount > 0 && <span className="mb-missing-count">{missingCount} {t(missingCount === 1 ? 'cliente con datos por completar' : 'clientes con datos por completar')}</span>}
    </div>

    {error && <p className="form-error" role="alert">{error}</p>}
    {notice && <p className="form-success" role="status">{notice}</p>}

    <div className="mb-table-wrap">
      <table className="mb-table">
        <thead><tr>
          <th>{t('Cliente')}</th><th>{t('Cuenta publicitaria')}</th><th>Ad status</th><th>{t('Motivo')}</th><th>{t('Resultado')}</th><th>{t('Conversión')}</th>
          <th>{t('Instant Form / landing')}</th><th>{t('Página de Facebook')}</th><th>{t('Gasto diario')}</th><th>{t('Ubicación')}</th><th>{t('Radio')}</th>
          <th>{t('Creativos')}</th><th>{t('Calendario')}</th><th>{t('Notas')}</th>
        </tr></thead>
        <tbody>
          {visible.map((client) => <tr key={client.id}>
            <td className="mb-client"><Link to={`/clientes/${client.id}`} data-no-translate><strong>{client.code}</strong> {client.business_name}</Link>
              {client.google_docs_url && <a className="mb-sub" href={client.google_docs_url} target="_blank" rel="noreferrer">{t('Onboarding')} ↗</a>}</td>
            <td><Cell value={client.ad_account_name} canEdit={canEdit} placeholder={client.meta_ad_account_id || ''} onSave={(value) => saveField(client, { ad_account_name: value })} />
              {client.meta_ad_account_id && <small className="mb-sub" data-no-translate>ID {client.meta_ad_account_id}</small>}</td>
            <td><StatusCell client={client} canEdit={canEdit} onChange={saveStatus} /></td>
            <td className="mb-reason-cell" data-no-translate>{client.adStatus === 'Paused' || client.adStatus === 'Payment Error' ? client.ads_pause_reason : <span className="mb-muted">—</span>}</td>
            <td><Cell type="select" options={RESULTS} value={client.ad_result_status} canEdit={canEdit} display={<span className={`mb-pill ${RESULT_CLASS[client.ad_result_status] || ''}`}>{client.ad_result_status}</span>} onSave={(value) => saveField(client, { ad_result_status: value })} /></td>
            <td><Cell type="select" options={CONVERSIONS} value={client.conversion_location} canEdit={canEdit} onSave={(value) => saveField(client, { conversion_location: value })} /></td>
            <td>{client.conversion_location === 'Instant Form'
              ? <Cell value={client.instant_form_name} canEdit={canEdit} placeholder={t('Nombre del Instant Form')} onSave={(value) => saveField(client, { instant_form_name: value })} />
              : <Cell type="url" value={client.landing_page_url} canEdit={canEdit} placeholder="https://" onSave={(value) => saveField(client, { landing_page_url: value })} />}</td>
            <td><Cell type="url" value={client.facebook_page_url} canEdit={canEdit} placeholder="https://facebook.com/…" onSave={(value) => saveField(client, { facebook_page_url: value })} /></td>
            <td><Cell type="number" value={client.daily_budget} canEdit={canEdit} onSave={(value) => saveField(client, { daily_budget: value })} /></td>
            <td><Cell value={client.ads_targeting_address} canEdit={canEdit} placeholder={client.markets || ''} display={client.ads_targeting_address} onSave={(value) => saveField(client, { ads_targeting_address: value })} /></td>
            <td><Cell type="text" value={client.targeting_radius_miles ?? ''} canEdit={canEdit} display={client.targeting_radius_miles ? `${client.targeting_radius_miles} mi` : ''}
              onSave={(value) => { const miles = Number(value); if (value !== '' && !(miles >= 1 && miles <= 500)) { setError(t('El radio debe estar entre 1 y 500 millas.')); return Promise.resolve() } return saveField(client, { targeting_radius_miles: value === '' ? null : Math.round(miles) }) }} /></td>
            <td><Cell type="url" value={client.ad_creatives_link} canEdit={canEdit} placeholder="https://drive.google.com/…" onSave={(value) => saveField(client, { ad_creatives_link: value })} /></td>
            <td><Cell type="url" value={client.booking_calendar_link} canEdit={canEdit} placeholder="https://" onSave={(value) => saveField(client, { booking_calendar_link: value })} /></td>
            <td><NoteCell client={client} canEdit={canEdit} onAdd={addNote} /></td>
          </tr>)}
          {!visible.length && <tr><td colSpan="14" className="mb-empty">{t('No hay clientes con esos filtros.')}</td></tr>}
        </tbody>
      </table>
    </div>

    <section className="content-card mb-tasks">
      <div className="section-heading"><div><p className="eyebrow">To-Do</p><h3>{t('Mis pendientes')}</h3></div><Link className="secondary-button compact-button" to="/tickets">{t('Ver todas las tareas')}</Link></div>
      {data.tasks.length ? <table className="mb-table mb-task-table">
        <thead><tr><th>{t('Cliente')}</th><th>{t('Tarea')}</th><th>{t('Prioridad')}</th><th>{t('Fecha límite')}</th><th>{t('Estado')}</th></tr></thead>
        <tbody>{data.tasks.map((task) => {
          const overdue = task.due_at && new Date(`${task.due_at}T23:59:59`) < new Date()
          return <tr key={task.id} className={overdue ? 'overdue' : ''}>
            <td data-no-translate>{task.clients ? <Link to={`/clientes/${task.client_id}`}>{task.clients.code}</Link> : t('General')}</td>
            <td data-no-translate><strong>{task.title}</strong>{task.comments && <small className="mb-sub">{task.comments}</small>}</td>
            <td><span className={`priority ${String(task.priority || '').toLowerCase()}`}>{t(task.priority || 'Media')}</span></td>
            <td>{task.due_at ? <span className={overdue ? 'danger-text' : ''}>{task.due_at}</span> : <span className="mb-muted">—</span>}</td>
            <td><select value={task.status} onChange={(event) => setTaskStatus(task, event.target.value).catch(() => {})}>{TASK_STATUSES.map((status) => <option key={status} value={status}>{t(status)}</option>)}</select></td>
          </tr>
        })}</tbody>
      </table> : <p className="muted">{t('No tienes tareas abiertas.')}</p>}
    </section>
  </section>
}
