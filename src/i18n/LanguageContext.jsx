import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import { supabase } from '../lib/supabase'

const LanguageContext = createContext(null)
const validLanguages = new Set(['es', 'en'])

const translations = {
  'Acceso del equipo': 'Team access', 'Iniciar sesión': 'Sign in', 'Usa las credenciales asignadas por el administrador.': 'Use the credentials assigned by the administrator.',
  'Correo': 'Email', 'Contraseña': 'Password', 'Ingresar': 'Sign in', 'Ingresando…': 'Signing in…', 'Mostrar contraseña': 'Show password', 'Ocultar contraseña': 'Hide password',
  'Una operación clara para cada cliente.': 'Clear operations for every client.', 'Onboarding, A2P y campañas en un solo panel de trabajo.': 'Onboarding, A2P, and campaigns in one workspace.',
  'Panel': 'Dashboard', 'Clientes': 'Clients', 'Tareas': 'Tasks', 'Calendario': 'Calendar', 'Mi equipo': 'My team', 'Mi cuenta': 'My account', 'Mi empresa': 'My company', 'Menú': 'Menu',
  'Usuarios': 'Users', 'Cerrar sesión': 'Sign out', 'Navegación principal': 'Main navigation', 'Sin rol asignado': 'No role assigned',
  'Datos en vivo': 'Live data', 'Hola,': 'Hello,', 'Resumen operativo': 'Operations summary', 'Actividad del equipo': 'Team activity', 'Actualización reciente': 'Recent update',
  'Clientes por estado': 'Clients by status', 'Clientes que requieren atención': 'Clients requiring attention', 'Ver clientes': 'View clients', 'Abrir pipeline': 'Open pipeline',
  'Alertas operativas': 'Operational alerts', 'No hay alertas críticas.': 'No critical alerts.', 'Próxima agenda': 'Next on the calendar', 'No hay eventos próximos.': 'No upcoming events.',
  'Mis tareas abiertas': 'My open tasks', 'Mis tareas atrasadas': 'My overdue tasks', 'Qué debes hacer ahora': 'What you need to do now', 'EOD del equipo': 'Team EOD',
  'Últimos informes': 'Latest reports', 'Prioridad ejecutiva': 'Executive priority', 'Próxima acción': 'Next action', 'Ver todas': 'View all', 'Ver expediente →': 'View dossier →',
  'Encuentra rápidamente el expediente que necesita atención.': 'Quickly find the dossier that needs attention.', 'Buscar': 'Search', 'Buscar cliente': 'Search client',
  'Cliente, código, propietario o ciudad…': 'Client, code, owner, or city…', 'Filtrar por estado': 'Filter by status', 'Responsable': 'Owner', 'Servicio': 'Service',
  'Prioridad': 'Priority', 'Bloqueos': 'Blockers', 'Ordenar': 'Sort', 'Orden recomendado': 'Recommended order', 'Todos': 'All', 'Todas': 'All',
  'Con bloqueos': 'With blockers', 'Sin bloqueos': 'Without blockers', 'No encontramos clientes': 'No clients found', 'Cambia o limpia los filtros para ver más resultados.': 'Change or clear the filters to see more results.',
  'Limpiar filtros': 'Clear filters', 'Ver filtros': 'Show filters', '+ Registrar cliente': '+ Add client', 'Nuevo cliente': 'New client', 'Registrar y generar SOP automáticamente': 'Add and generate SOP automatically',
  'Código': 'Code', 'Nombre comercial': 'Business name', 'Propietario': 'Owner', 'Responsable interno': 'Internal owner', 'Estado': 'Status', 'Registrar cliente': 'Add client', 'Registrando…': 'Adding…',
  'Cerrar': 'Close', 'Seguimiento por cliente': 'Client tracking', 'Falta en el dossier': 'Missing from dossier', 'Siguiente paso del proceso': 'Next process step', 'Tareas abiertas': 'Open tasks',
  '← Todos los clientes': '← All clients', 'Buscar en este dossier': 'Search this dossier', 'Escribe código o nombre…': 'Type code or name…', 'Abrir Slack ↗': 'Open Slack ↗',
  'Abrir Drive ↗': 'Open Drive ↗', 'Copiar para Google Docs': 'Copy for Google Docs', 'Descargar WWWW PDF': 'Download WWWW PDF', 'Abrir Google Docs ↗': 'Open Google Docs ↗',
  'Marcar como actualizado': 'Mark as updated', 'Antes del dossier': 'Before the dossier', 'Dossier WWWW completo': 'Complete WWWW dossier', 'Editar': 'Edit', 'Guardar': 'Save', 'Cancelar': 'Cancel',
  'Historial de cambios': 'Change history', 'Abrir historial': 'Open history', 'Aún no hay cambios registrados.': 'No changes recorded yet.', 'Auditoría': 'Audit', 'Proceso completo · auditoría activa': 'Process complete · audit active',
  'Operational Task Log': 'Operational task log', 'Proceso asignado por rol': 'Process assigned by role', 'Siguiente:': 'Next:', 'Sin actualización': 'No update', 'Google Docs actualizado': 'Google Docs updated',
  'Asignar trabajo': 'Assign work', 'Las tareas se crean en Tareas': 'Tasks are created in Tasks', 'Nueva tarea': 'New task', 'General / Todos': 'General / Everyone', 'Cliente específico': 'Specific client',
  'Seleccionar cliente…': 'Select client…', 'Buscar tarea o cliente…': 'Search task or client…', 'Qué debe realizarse': 'What needs to be done', 'Asignar a': 'Assign to', 'Fecha límite': 'Deadline',
  'Contexto e instrucciones…': 'Context and instructions…', 'Crear tarea': 'Create task', 'Creando…': 'Creating…', 'Tarea creada y alerta enviada.': 'Task created and alert sent.',
  'Abiertas': 'Open', 'Completada': 'Completed', 'Bloqueada': 'Blocked', 'Historial completadas': 'Completed history', 'No hay tareas en esta vista.': 'No tasks in this view.',
  'Calendario del equipo': 'Team calendar', 'Agenda operativa': 'Operations calendar', 'Crear evento': 'Create event', 'Evento': 'Event', 'Reunión': 'Meeting', 'Nota': 'Note', 'Título': 'Title',
  'Zona del evento': 'Event timezone', 'Enlace de reunión': 'Meeting link', 'Notificar antes': 'Notify before', 'Evento creado con sus recordatorios.': 'Event created with reminders.',
  'Agenda del día': 'Today’s agenda', 'Próximos': 'Upcoming', 'Sin eventos.': 'No events.', 'Activar notificaciones': 'Enable notifications', 'Las alertas internas seguirán activas.': 'Internal alerts will remain active.',
  'Informe de fin de día': 'End-of-day report', 'Las tareas completadas se agregan automáticamente y puedes sumar trabajo manual.': 'Completed tasks are added automatically, and you can add manual work.',
  'Tareas registradas': 'Recorded tasks', 'Trabajo adicional': 'Additional work', 'Agregar tareas manualmente': 'Add tasks manually', '+ Agregar': '+ Add', 'Quitar': 'Remove', 'Notas del día': 'Daily notes',
  'Generar informe EOD': 'Generate EOD report', 'Generando…': 'Generating…', 'Historial': 'History', 'Informes enviados': 'Submitted reports', 'Aún no hay informes.': 'No reports yet.',
  'Formación del equipo': 'Team training', 'Training Hub': 'Training Hub', 'Tu progreso': 'Your progress', 'Abrir recursos del módulo en Drive ↗': 'Open module resources in Drive ↗',
  'Abrir en Drive ↗': 'Open in Drive ↗', 'Abrir enlace ↗': 'Open link ↗', 'Marcar vista': 'Mark complete', 'Nueva lección': 'New lesson', 'Agregar lección': 'Add lesson',
  'Crear módulo': 'Create module', 'Guardar módulo': 'Save module', 'Eliminar módulo': 'Delete module', 'Eliminar': 'Delete', 'Descripción': 'Description', 'Enlace de Drive': 'Drive link', 'Visible para': 'Visible to',
  'Lección': 'Lesson', 'Documento': 'Document', 'Video': 'Video', 'Carpeta': 'Folder', 'Orden': 'Order', 'Activo': 'Active', 'Guardar usuario': 'Save user',
  'Directorio interno': 'Internal directory', 'Contacta rápidamente a cada integrante por correo, Slack o WhatsApp.': 'Quickly contact each team member by email, Slack, or WhatsApp.',
  'Zona horaria': 'Time zone', 'Pendiente': 'Pending', 'Perfil y hora local': 'Profile and local time',
  'Esta zona controla cómo ves reuniones, fechas y tu reloj en el calendario.': 'This time zone controls how you see meetings, dates, and your calendar clock.',
  'Hora actual:': 'Current time:', 'Usuario o enlace de Slack': 'Slack username or link', 'Guardar mi perfil': 'Save my profile', 'Guardando…': 'Saving…',
  'Seguridad': 'Security', 'Cambiar contraseña': 'Change password', 'Confirma tu contraseña actual antes de establecer una nueva.': 'Confirm your current password before setting a new one.',
  'Contraseña actual': 'Current password', 'Nueva contraseña': 'New password', 'Confirmar contraseña': 'Confirm password', 'Mínimo 10 caracteres.': 'Minimum 10 characters.',
  'Actualizar contraseña': 'Update password', 'Actualizando…': 'Updating…', 'Avatar del equipo': 'Team avatar', 'Elige tu insignia': 'Choose your badge', 'Idioma': 'Language',
  'Español': 'Spanish', 'Inglés': 'English', 'Tu perfil, avatar e idioma se actualizaron.': 'Your profile, avatar, and language were updated.',
  'Usuarios y permisos': 'Users and permissions', 'Crea accesos internos y controla qué puede hacer cada integrante.': 'Create internal access and control what each team member can do.',
  'Nuevo acceso': 'New access', 'Nombre': 'Name', 'Rol': 'Role', 'Permisos': 'Permissions', 'Crear usuario': 'Create user', 'Restablecer': 'Reset',
  'Configura la identidad que aparece en la navegación, el footer y el navegador.': 'Configure the identity shown in navigation, footer, and the browser.',
  'Nombre del sistema': 'System name', 'Empresa': 'Company', 'Correo empresarial': 'Company email', 'Sitio web': 'Website', 'Cambiar logo': 'Change logo', 'Guardar empresa': 'Save company',
  'Acceso restringido': 'Restricted access', 'Tu sesión es válida, pero tu rol no tiene permiso para abrir esta sección.': 'Your session is valid, but your role cannot access this section.', 'Volver al panel': 'Back to dashboard',
  'Verificando acceso…': 'Verifying access…', 'Alta': 'High', 'Media': 'Medium', 'Baja': 'Low', 'Urgente': 'Urgent', 'Sí': 'Yes', 'No': 'No',
  'Quién · Perfil comercial': 'Who · Business profile', 'Qué · Oferta y objetivos': 'What · Offer and goals', 'Dónde · Mercado': 'Where · Market', 'Cuándo · Cronología': 'When · Timeline',
  'Infraestructura': 'Infrastructure', 'Enlaces y accesos': 'Links and access', 'Estrategia publicitaria': 'Ad strategy', 'Registro operativo': 'Operations record', 'Estado de finalización': 'Completion status',
  'Nombre del negocio': 'Business Name', 'Nombre del propietario': 'Owner Name', 'Número de teléfono': 'Phone Number', 'Correo electrónico': 'Email Address', 'Dirección física': 'Physical Address',
  'Información legal · EIN / Tax ID': 'Legal Business Info · EIN / Tax ID', 'Estado Persona / KYC': 'Persona / KYC Status', 'Servicio principal': 'Core Service', 'Oferta principal': 'Core Consumer Offer',
  'KPI mensual objetivo': 'Target Monthly KPI', 'Gasto diario objetivo': 'Target Daily Ad Spend', 'Proyecto mínimo objetivo': 'Minimum Target Project Size', 'Tipo de proyecto': 'Project Type',
  'Perfil del cliente objetivo': 'Target Customer Profile', 'ZIP objetivo / Radio': 'Target ZIP Codes / Radius', 'Mercados / Ciudades': 'Markets / Cities', 'Ubicaciones excluidas': 'Excluded Locations',
  '¿Necesita sitio web o funnel?': 'Does Client Need Website/Funnel Built?', 'Dominio existente': 'Existing Domain Name', 'URL del sitio existente': 'Existing Website URL',
  'Estado de Google Business Profile': 'Google Business Profile Status', 'Enlace GBP existente': 'Existing GBP Link', 'Recursos disponibles': 'Available Assets', 'Fecha de onboarding': 'Onboarding Date',
  'Fecha objetivo de lanzamiento': 'Target Ad Launch Date', 'Estado actual del ciclo': 'Current Lifecycle Status', 'Subcuenta / Acceso GoHighLevel': 'GoHighLevel Sub-Account / Access',
  'Carpeta de recursos en Google Drive': 'Client Google Drive Assets Folder', 'Dossier en Google Docs': 'Google Docs Dossier', 'Página de Facebook': 'Facebook Page', 'Cuenta de Instagram': 'Instagram Account',
  'ID de Meta Business Portfolio': 'Meta Business Portfolio ID', 'ID de cuenta publicitaria Meta': 'Meta Ad Account ID', 'ID de Pixel / Dataset Meta': 'Meta Pixel / Dataset ID', 'Página de aterrizaje': 'Landing Page',
  'Notas de Facebook y Business Manager': 'Facebook Page & Business Manager Notes', 'Notas de recursos Meta': 'Meta Assets Notes', 'ID del agente Retell AI': 'Retell AI Agent ID',
  'Carpeta de escenarios Make.com': 'Make.com Scenario Folder', 'Canal de Slack': 'Slack Channel', 'Estrategia publicitaria activa': 'Active Ad Strategy', 'Estado Meta': 'Meta Status',
  'Presupuesto diario': 'Daily Budget', 'Fase operativa': 'Operational Phase', 'Siguiente acción': 'Next Action', 'Estado GHL': 'GHL Status', 'Estado A2P': 'A2P Status',
  'Onboarding completado': 'Onboarding Completed', 'Acceso GHL confirmado': 'GHL Access Confirmed', 'Acceso Facebook confirmado': 'Facebook Access Confirmed',
  'Acceso a cuenta publicitaria confirmado': 'Ad Account Access Confirmed', 'Acceso al pixel confirmado': 'Pixel Access Confirmed', 'Acceso al dominio confirmado': 'Domain Access Confirmed',
  'Método de pago confirmado': 'Payment Method Confirmed', 'Persona / KYC completado': 'Persona / KYC Completed', 'A2P enviado': 'A2P Submitted', 'Funnel activo': 'Funnel Live', 'Campaña Meta activa': 'Meta Campaign Live',
  'Actualizaciones operativas': 'Operational updates', 'Agenda del equipo': 'Team agenda', 'Bloqueo abierto': 'Open blocker', 'Bloqueos abiertos': 'Open blockers', 'Citas': 'Appointments',
  'Cliente': 'Client', 'Comunicaciones': 'Communications', 'Contexto compartido': 'Shared context', 'Control por cliente': 'Client control', 'Deadline de lanzamiento ADS': 'ADS launch deadline',
  'Deadlines ADS vencidos': 'Overdue ADS deadlines', 'Dependencias': 'Dependencies', 'Detalle': 'Details', 'Ejecución': 'Execution', 'En progreso': 'In progress', 'Enlace pendiente': 'Link pending',
  'Estado de clientes': 'Client status', 'Eventos': 'Events', 'Final': 'Final', 'Gasto': 'Spend', 'Inicio': 'Home', 'Leads': 'Leads', 'Marcar como vistas': 'Mark as seen',
  'Notas': 'Notes', 'Notas del cliente': 'Client notes', 'Notas del equipo': 'Team notes', 'Notas generales': 'General notes', 'Nueva nota': 'New note', 'Nuevo': 'New',
  'Número o enlace': 'Number or link', 'Pipeline': 'Pipeline', 'Progreso': 'Progress', 'Próximo paso': 'Next step', 'Requieren seguimiento': 'Require follow-up', 'Tarea general': 'General task',
  'Tareas adicionales': 'Additional tasks', 'Tareas atrasadas': 'Overdue tasks', 'Tipo': 'Type', 'Tipo de actualización': 'Update type', 'Última copia': 'Last copy', 'Últimos': 'Latest',
  'Kevin agregó trabajo nuevo a tu tablero.': 'Kevin added new work to your dashboard.', 'Kevin todavía no ha agregado notas para este cliente.': 'Kevin has not added notes for this client yet.',
  'Las completadas se conservan separadas en Historial.': 'Completed items are kept separately in History.', 'No encontramos ese cliente.': 'We could not find that client.',
  'Sin eventos próximos.': 'No upcoming events.', 'Todavía no marcaste tareas como completadas en esta fecha.': 'You have not marked any tasks complete for this date yet.',
  'Tu usuario no tiene permiso para generar informes EOD.': 'Your user does not have permission to generate EOD reports.', 'Ver expediente completo →': 'View full dossier →',
  '¿Perdió su contraseña? Restablecer': 'Forgot your password? Reset it', '← Volver': '← Back',
  'Contexto, instrucciones o información adicional…': 'Context, instructions, or additional information…', 'Ej. EIN, presupuesto, pixel, dominio…': 'E.g. EIN, budget, pixel, domain…',
  'Ej. Reunión con cliente o revisión manual': 'E.g. Client meeting or manual review', 'Escribe una ciudad o zona…': 'Type a city or time zone…', 'Resultados, bloqueos o contexto para Kevin…': 'Results, blockers, or context for Kevin…',
  'Título de la nota': 'Note title', 'PNG, JPG o WebP · máximo 5 MB': 'PNG, JPG, or WebP · 5 MB maximum', 'Tu agenda se muestra en': 'Your calendar is shown in',
  'Responsable:': 'Owner:', 'Seleccionado:': 'Selected:', 'Zona del evento:': 'Event timezone:', 'Hecho por Diego Romario · Nicaragua': 'Built by Diego Romario · Nicaragua',
  'abiertos': 'open', 'actividades': 'activities', 'actividades reportadas': 'reported activities', 'activos': 'active', 'agendadas': 'scheduled', 'bloqueo': 'blocker',
  'campañas activas': 'active campaigns', 'campañas sin lanzar': 'campaigns not launched', 'clientes': 'clients', 'clientes bloqueados': 'blocked clients', 'clientes sin actualización': 'clients without updates',
  'clientes totales': 'total clients', 'completadas el': 'completed on', 'de': 'of', 'dossiers incompletos': 'incomplete dossiers', 'integrantes': 'team members', 'lecciones': 'lessons',
  'más de 3 días': 'more than 3 days', 'nota': 'note', 'nueva': 'new', 'nuevas': 'new', 'próximos': 'upcoming', 'recibidos': 'received', 'registrado': 'recorded',
  'requieren seguimiento': 'require follow-up', 'tarea': 'task', 'tareas abiertas': 'open tasks', 'tareas pendientes': 'pending tasks', 'usuarios': 'users', 'verificación enviada': 'verification submitted',
  'visibles': 'visible', 'visibles completados': 'visible completed',
}

const reverseTranslations = Object.fromEntries(Object.entries(translations).map(([spanish, english]) => [english, spanish]))

const patterns = [
  [/^(\d+) integrantes$/, '$1 team members'], [/^(\d+) clientes$/, '$1 clients'], [/^(\d+) tareas abiertas$/, '$1 open tasks'], [/^(\d+) sin leer$/, '$1 unread'],
  [/^(\d+) actividades$/, '$1 activities'], [/^(\d+) lecciones$/, '$1 lessons'], [/^(\d+) campañas activas$/, '$1 active campaigns'], [/^(\d+) verificación enviada$/, '$1 verification submitted'],
  [/^(\d+) clientes totales$/, '$1 total clients'], [/^(\d+) dossiers incompletos$/, '$1 incomplete dossiers'], [/^(\d+) clientes bloqueados$/, '$1 blocked clients'],
  [/^Actualizado por (.+) · (.+)$/, 'Updated by $1 · $2'], [/^Responsable:\s*(.+)$/, 'Owner: $1'], [/^Hora actual:\s*(.+)$/, 'Current time: $1'],
]

function translateValue(value, language) {
  const leading = value.match(/^\s*/)?.[0] || ''
  const trailing = value.match(/\s*$/)?.[0] || ''
  const clean = value.trim()
  if (!clean) return value
  if (language === 'es') {
    const translated = reverseTranslations[clean]
    return translated ? `${leading}${translated}${trailing}` : value
  }
  let translated = translations[clean]
  if (!translated) {
    for (const [pattern, replacement] of patterns) {
      if (pattern.test(clean)) { translated = clean.replace(pattern, replacement); break }
    }
  }
  return translated ? `${leading}${translated}${trailing}` : value
}

export function LanguageProvider({ children }) {
  const { profile, refreshProfile } = useAuth()
  const [language, setLanguageState] = useState(() => localStorage.getItem('tp-language') || 'es')
  const textState = useRef(new WeakMap())
  const attrState = useRef(new WeakMap())

  useEffect(() => {
    if (validLanguages.has(profile?.preferred_language)) {
      setLanguageState(profile.preferred_language)
      localStorage.setItem('tp-language', profile.preferred_language)
    }
  }, [profile?.preferred_language])

  useEffect(() => {
    document.documentElement.lang = language
    const translateTree = (root) => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      const nodes = []
      while (walker.nextNode()) nodes.push(walker.currentNode)
      nodes.forEach((node) => {
        if (node.parentElement?.closest('script, style, [data-no-translate]')) return
        const current = node.nodeValue
        let state = textState.current.get(node)
        if (!state || current !== state.expected) state = { original: current, expected: current }
        const expected = translateValue(state.original, language)
        textState.current.set(node, { ...state, expected })
        if (current !== expected) node.nodeValue = expected
      })
      const attributed = root.nodeType === Node.ELEMENT_NODE && root.matches?.('[placeholder], [title], [aria-label]') ? [root] : []
      attributed.push(...(root.querySelectorAll?.('[placeholder], [title], [aria-label]') || []))
      attributed.forEach((element) => {
        const previous = attrState.current.get(element) || {}
        const next = { ...previous }
        for (const attr of ['placeholder', 'title', 'aria-label']) {
          if (!element.hasAttribute(attr)) continue
          const current = element.getAttribute(attr)
          const state = previous[attr] && current === previous[attr].expected ? previous[attr] : { original: current, expected: current }
          const expected = translateValue(state.original, language)
          next[attr] = { ...state, expected }
          if (current !== expected) element.setAttribute(attr, expected)
        }
        attrState.current.set(element, next)
      })
    }
    translateTree(document.body)
    const observer = new MutationObserver((mutations) => mutations.forEach((mutation) => translateTree(mutation.target.nodeType === Node.TEXT_NODE ? mutation.target.parentElement : mutation.target)))
    observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['placeholder', 'title', 'aria-label'] })
    return () => observer.disconnect()
  }, [language])

  const setLanguage = useCallback(async (nextLanguage) => {
    if (!validLanguages.has(nextLanguage)) return
    setLanguageState(nextLanguage)
    localStorage.setItem('tp-language', nextLanguage)
    if (profile?.id && profile.preferred_language !== nextLanguage) {
      const { error } = await supabase.from('profiles').update({ preferred_language: nextLanguage }).eq('id', profile.id)
      if (error) throw error
      await refreshProfile()
    }
  }, [profile?.id, profile?.preferred_language, refreshProfile])

  const value = useMemo(() => ({ language, setLanguage }), [language, setLanguage])
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
}

export function useLanguage() {
  const context = useContext(LanguageContext)
  if (!context) throw new Error('useLanguage must be used inside LanguageProvider')
  return context
}

export function LanguageToggle({ compact = false }) {
  const { language, setLanguage } = useLanguage()
  return <div className={`language-toggle ${compact ? 'compact' : ''}`} aria-label="Idioma">
    <button type="button" className={language === 'es' ? 'active' : ''} onClick={() => setLanguage('es')}>ES</button>
    <button type="button" className={language === 'en' ? 'active' : ''} onClick={() => setLanguage('en')}>EN</button>
  </div>
}
