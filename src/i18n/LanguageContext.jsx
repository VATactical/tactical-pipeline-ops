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
  'Cliente, código, propietario o ciudad…': 'Client, code, owner, or city…', 'Filtrar por estado': 'Filter by status', 'Responsable': 'Assignee', 'Servicio': 'Service',
  'Prioridad': 'Priority', 'Bloqueos': 'Blockers', 'Ordenar': 'Sort', 'Orden recomendado': 'Recommended order', 'Todos': 'All', 'Todas': 'All',
  'Con bloqueos': 'With blockers', 'Sin bloqueos': 'Without blockers', 'No encontramos clientes': 'No clients found', 'Cambia o limpia los filtros para ver más resultados.': 'Change or clear the filters to see more results.',
  'Limpiar filtros': 'Clear filters', 'Ver filtros': 'Show filters', '+ Registrar cliente': '+ Add client', 'Nuevo cliente': 'New client', 'Registrar y generar SOP automáticamente': 'Add and generate SOP automatically',
  'Código': 'Code', 'Nombre comercial': 'Business name', 'Propietario': 'Client owner', 'Responsable interno': 'Internal assignee', 'Estado': 'Status', 'Registrar cliente': 'Add client', 'Registrando…': 'Adding…',
  'Cerrar': 'Close', 'Seguimiento por cliente': 'Client tracking', 'Falta en el dossier': 'Missing from dossier', 'Siguiente paso del proceso': 'Next process step', 'Tareas abiertas': 'Open tasks',
  '← Todos los clientes': '← All clients', 'Buscar en este dossier': 'Search this dossier', 'Escribe código o nombre…': 'Type code or name…', 'Abrir Slack ↗': 'Open Slack ↗',
  'Abrir Drive ↗': 'Open Drive ↗', 'Copiar para Google Docs': 'Copy for Google Docs', 'Descargar WWWW PDF': 'Download WWWW PDF', 'Abrir Google Docs ↗': 'Open Google Docs ↗',
  'Marcar como actualizado': 'Mark as updated', 'Antes del dossier': 'Before the dossier', 'Dossier WWWW completo': 'Complete WWWW dossier', 'Editar': 'Edit', 'Guardar': 'Save', 'Cancelar': 'Cancel',
  'Historial de cambios': 'Change history', 'Abrir historial': 'Open history', 'Aún no hay cambios registrados.': 'No changes recorded yet.', 'Auditoría': 'Audit', 'Proceso completo · auditoría activa': 'Process complete · audit active',
  'Operational Task Log': 'Operational task log', 'Proceso asignado por rol': 'Process assigned by role', 'Siguiente:': 'Next:', 'Sin actualización': 'No update', 'Google Docs actualizado': 'Google Docs updated',
  'Asignar trabajo': 'Assign work', 'Las tareas se crean en Tareas': 'Tasks are created in Tasks', 'Nueva tarea': 'New task', 'General / Todos': 'General / Everyone', 'Cliente específico': 'Specific client',
  'Seleccionar cliente…': 'Select client…', 'Buscar tarea o cliente…': 'Search task or client…', 'Qué debe realizarse': 'What needs to be done', 'Asignar a': 'Assign to', 'Fecha límite': 'Deadline',
  'Contexto e instrucciones…': 'Context and instructions…', 'Crear tarea': 'Create task', 'Creando…': 'Creating…', 'Tarea creada y alerta enviada.': 'Task created and alert sent.',
  'Asignar a una persona': 'Assign to a team member', 'Todos / tarea compartida': 'Everyone / shared task', 'Asignada a': 'Assigned to', 'Editar tarea': 'Edit task',
  'Edición': 'Editing', 'Guardar cambios': 'Save changes', 'Tarea actualizada correctamente.': 'Task updated successfully.',
  'Abiertas': 'Open', 'Completada': 'Completed', 'Bloqueada': 'Blocked', 'Historial completadas': 'Completed history', 'No hay tareas en esta vista.': 'No tasks in this view.',
  'Calendario del equipo': 'Team calendar', 'Agenda operativa': 'Operations calendar', 'Crear evento': 'Create event', 'Evento': 'Event', 'Reunión': 'Meeting', 'Nota': 'Note', 'Título': 'Title',
  'Zona del evento': 'Event timezone', 'Enlace de reunión': 'Meeting link', 'Notificar antes': 'Notify before', 'Evento creado con sus recordatorios.': 'Event created with reminders.',
  'Agenda del día': 'Today’s agenda', 'Próximos': 'Upcoming', 'Sin eventos.': 'No events.', 'Activar notificaciones': 'Enable notifications', 'Las alertas internas seguirán activas.': 'Internal alerts will remain active.',
  'Informe de fin de día': 'End-of-day report', 'Las tareas completadas se agregan automáticamente y puedes sumar trabajo manual.': 'Completed tasks are added automatically, and you can add manual work.',
  'Trabajo diario del equipo': 'Team daily work', 'Reportes enviados, ordenados por día y usuario.': 'Submitted reports, organized by day and user.', 'Selecciona el trabajo completado hoy, de 00:00 a 23:59, y envíalo a Kevin.': 'Select the work completed today, from 00:00 to 23:59, and send it to Kevin.',
  'Preparar reporte': 'Prepare report', 'Cerrar reporte': 'Close report', 'Ciclo diario': 'Daily cycle', 'Día calendario · 00:00–23:59': 'Calendar day · 00:00–23:59', 'Desde': 'From', 'Hasta': 'To',
  'Checklist de actividades': 'Activity checklist', 'Desmarca cualquier tarea que no quieras incluir en este reporte.': 'Uncheck any task you do not want to include in this report.', 'Desmarcar todas': 'Uncheck all', 'Seleccionar todas': 'Select all',
  'No completaste tareas registradas durante este ciclo. Puedes agregar actividades manualmente.': 'You did not complete any recorded tasks during this cycle. You can add activities manually.',
  'Tareas registradas': 'Recorded tasks', 'Trabajo adicional': 'Additional work', 'Agregar tareas manualmente': 'Add tasks manually', 'Agregar actividad manual': 'Add manual activity', '+ Agregar': '+ Add', 'Quitar': 'Remove', 'Notas del día': 'Daily notes',
  'Generar informe EOD': 'Generate EOD report', 'Generando…': 'Generating…', 'Enviando…': 'Sending…', 'Enviar reporte a Kevin': 'Send report to Kevin', 'Reporte EOD enviado a Kevin correctamente.': 'EOD report sent to Kevin successfully.', 'Historial': 'History', 'Informes enviados': 'Submitted reports', 'Reportes recibidos': 'Received reports', 'Mis reportes enviados': 'My submitted reports', 'Buscar usuario…': 'Search user…', 'Enviado': 'Submitted', 'Aún no hay informes.': 'No reports yet.',
  'Formación del equipo': 'Team training', 'Training Hub': 'Training Hub', 'Tu progreso': 'Your progress', 'Abrir recursos del módulo en Drive ↗': 'Open module resources in Drive ↗',
  'Abrir en Drive ↗': 'Open in Drive ↗', 'Abrir enlace ↗': 'Open link ↗', 'Marcar vista': 'Mark complete', 'Nueva lección': 'New lesson', 'Agregar lección': 'Add lesson',
  'Crear módulo': 'Create module', 'Guardar módulo': 'Save module', 'Eliminar módulo': 'Delete module', 'Eliminar': 'Delete', 'Descripción': 'Description', 'Enlace de Drive': 'Drive link', 'Visible para': 'Visible to',
  'Lección': 'Lesson', 'Documento': 'Document', 'Video': 'Video', 'Carpeta': 'Folder', 'Orden': 'Order', 'Activo': 'Active', 'Guardar usuario': 'Save user',
  'Todos los usuarios': 'All users', 'módulos': 'modules', 'completado': 'complete', 'Título (ES)': 'Title (ES)', 'Title (EN)': 'Title (EN)',
  'Descripción (ES)': 'Description (ES)', 'Description (EN)': 'Description (EN)',
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
  'Crear clientes': 'Create clients', 'Editar dossiers': 'Edit dossiers', 'Crear tareas': 'Create tasks', 'Crear eventos': 'Create events', 'Generar EOD': 'Generate EOD', 'Ver credenciales sensibles': 'View sensitive credentials',
  'Configura la identidad que aparece en la navegación, el footer y el navegador.': 'Configure the identity shown in navigation, footer, and the browser.',
  'Nombre del sistema': 'System name', 'Empresa': 'Company', 'Correo empresarial': 'Company email', 'Sitio web': 'Website', 'Cambiar logo': 'Change logo', 'Guardar empresa': 'Save company',
  'Acceso restringido': 'Restricted access', 'Tu sesión es válida, pero tu rol no tiene permiso para abrir esta sección.': 'Your session is valid, but your role cannot access this section.', 'Volver al panel': 'Back to dashboard',
  'Pausar ADS': 'Pause ADS', 'Reactivar ADS': 'Resume ADS', 'Reactivando…': 'Resuming…', 'Pausando…': 'Pausing…', 'Confirmar pausa': 'Confirm pause',
  'Pausar campaña': 'Pause campaign', '¿Por qué se pausarán los ADS?': 'Why are the ADS being paused?', 'El motivo quedará visible en el cliente y en el historial.': 'The reason will remain visible on the client and in the history.',
  'Motivo de pausa': 'Pause reason', 'Escribe el motivo de la pausa.': 'Enter the reason for pausing.', 'ADS pausados correctamente.': 'ADS paused successfully.', 'ADS reactivados correctamente.': 'ADS resumed successfully.',
  'Campaña pausada': 'Campaign paused', 'Historial ADS': 'ADS history', 'Pausas y reactivaciones': 'Pauses and resumptions', 'Pausó la campaña': 'Paused the campaign', 'Reactivó la campaña': 'Resumed the campaign',
  'PAUSADO': 'PAUSED', 'REACTIVADO': 'RESUMED', 'Ads Paused': 'Ads Paused', 'campañas pausadas': 'paused campaigns',
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
  'Nota de estado': 'Status note', 'Explica por qué sigue en progreso o está bloqueada…': 'Explain why it remains in progress or is blocked…', 'Guardar estado': 'Save status', 'Estado y nota actualizados.': 'Status and note updated.',
  'Tiempo manual': 'Manual time', 'Horas trabajadas': 'Hours worked', 'Registra horas y un memo como en el diario manual de Upwork.': 'Log hours and a memo like Upwork manual time.', 'Agregar tiempo': 'Add time', 'Horas': 'Hours', 'Memo': 'Memo', 'Describe el trabajo realizado…': 'Describe the work completed…',
  'Cada registro de tiempo necesita horas y memo.': 'Each time entry needs hours and a memo.', 'Las horas del día no pueden superar 24.': 'Daily hours cannot exceed 24.',
  'Histórico semanal': 'Weekly history', 'Horas registradas · lunes a domingo': 'Logged hours · Monday through Sunday', 'Exportar horas PDF': 'Export hours PDF', 'Semana anterior': 'Previous week', 'Semana siguiente': 'Next week', 'Todo el equipo': 'All team', 'Total semanal': 'Weekly total', 'Sin horas': 'No hours',
  'Después de marcar una nota como vista permanecerá aquí durante 24 horas.': 'After marking a note as seen, it will remain here for 24 hours.', 'Exportar notas PDF': 'Export notes PDF', 'Historial de notas': 'Notes history', 'Ver activas': 'View active', 'No hay notas en el historial.': 'There are no notes in history.', 'No hay comunicaciones activas.': 'There are no active communications.', 'Visto · visible 24 h': 'Seen · visible for 24 h', 'Marcar como visto': 'Mark as seen', 'Convertir en tarea': 'Convert to task', 'Tarea creada': 'Task created',
  'Seguimiento de campaña': 'Campaign follow-up', 'Reportes ADS': 'ADS reports', 'Histórico por fecha con métricas, observaciones y responsable.': 'Dated history with metrics, observations, and owner.', 'Crear reporte ADS': 'Create ADS report', 'Reporte ADS guardado.': 'ADS report saved.', 'Fecha del reporte': 'Report date', 'Estado de campaña': 'Campaign status', 'Activa': 'Active', 'Pausada': 'Paused', 'Requiere atención': 'Needs attention', 'Impresiones': 'Impressions', 'Alcance': 'Reach', 'Clics': 'Clicks', 'Resumen ejecutivo': 'Executive summary', 'Resultados positivos': 'Wins', 'Problemas o riesgos': 'Issues or risks', 'Próximos pasos': 'Next steps', 'Guardar reporte': 'Save report', 'Todavía no hay reportes ADS para este cliente.': 'There are no ADS reports for this client yet.', 'Exportar PDF para cliente': 'Export client PDF', 'Equipo': 'Team',
  'Sin eventos próximos.': 'No upcoming events.', 'Todavía no marcaste tareas como completadas en esta fecha.': 'You have not marked any tasks complete for this date yet.',
  'Tu usuario no tiene permiso para generar informes EOD.': 'Your user does not have permission to generate EOD reports.', 'Ver expediente completo →': 'View full dossier →',
  '¿Perdió su contraseña? Restablecer': 'Forgot your password? Reset it', '← Volver': '← Back',
  'Contexto, instrucciones o información adicional…': 'Context, instructions, or additional information…', 'Ej. EIN, presupuesto, pixel, dominio…': 'E.g. EIN, budget, pixel, domain…',
  'Ej. Reunión con cliente o revisión manual': 'E.g. Client meeting or manual review', 'Escribe una ciudad o zona…': 'Type a city or time zone…', 'Resultados, bloqueos o contexto para Kevin…': 'Results, blockers, or context for Kevin…',
  'Título de la nota': 'Note title', 'PNG, JPG o WebP · máximo 5 MB': 'PNG, JPG, or WebP · 5 MB maximum', 'Tu agenda se muestra en': 'Your calendar is shown in',
  'Responsable:': 'Internal assignee:', 'Propietario del cliente:': 'Client owner:', 'Responsable interno:': 'Internal assignee:', 'Seleccionado:': 'Selected:', 'Zona del evento:': 'Event timezone:', 'Hecho por Diego Romario · Nicaragua': 'Built by Diego Romario · Nicaragua',
  'abiertos': 'open', 'actividades': 'activities', 'actividades reportadas': 'reported activities', 'activos': 'active', 'agendadas': 'scheduled', 'bloqueo': 'blocker',
  'campañas activas': 'active campaigns', 'campañas sin lanzar': 'campaigns not launched', 'clientes': 'clients', 'clientes bloqueados': 'blocked clients', 'clientes sin actualización': 'clients without updates',
  'clientes totales': 'total clients', 'completadas el': 'completed on', 'de': 'of', 'dossiers incompletos': 'incomplete dossiers', 'integrantes': 'team members', 'lecciones': 'lessons',
  'más de 3 días': 'more than 3 days', 'nota': 'note', 'nueva': 'new', 'nuevas': 'new', 'próximos': 'upcoming', 'recibidos': 'received', 'registrado': 'recorded',
  'requieren seguimiento': 'require follow-up', 'tarea': 'task', 'tareas abiertas': 'open tasks', 'tareas pendientes': 'pending tasks', 'usuarios': 'users', 'verificación enviada': 'verification submitted',
  'visibles': 'visible', 'visibles completados': 'visible completed',
  'Centro de revisión diaria': 'Daily review center', 'Revisa el trabajo del equipo, registra seguimiento y conviértelo en tareas.': 'Review team work, record follow-up, and turn it into tasks.',
  'Selecciona el trabajo completado hoy, de 00:00 a 23:59, y envíalo a Kevin y Alejandra.': 'Select the work completed today, from 00:00 to 23:59, and submit it to Kevin and Alejandra.',
  'Control diario · hora de Kevin': 'Daily control · Kevin time', 'Cumplimiento EOD': 'EOD compliance', 'La regla de las 8:00 PM se calcula en': 'The 8:00 PM rule is calculated in',
  'Día': 'Day', 'enviados': 'submitted', 'trabajando': 'working', 'pendientes': 'pending', 'No hay usuarios activos para este día.': 'There are no active users for this day.',
  'Trabajando después de las 8 PM': 'Working after 8 PM', 'EOD estimado:': 'Estimated EOD:', 'hora Kevin': 'Kevin time', 'Nuevos': 'New', 'sin revisar por ti': 'not reviewed by you',
  'Revisados': 'Reviewed', 'confirmados por ti': 'confirmed by you', 'Seguimiento': 'Follow-up', 'Regla de las 8:00 PM': '8:00 PM rule',
  'Reporte de hoy enviado': 'Today’s report submitted', 'Sigues trabajando': 'Still working', 'Estado de cierre': 'End-of-day status',
  'La referencia es la hora de Kevin:': 'The reference is Kevin’s time:', 'Si sigues activo después de las 8:00 PM, registra tu hora estimada y copia el aviso a Slack.': 'If you are still working after 8:00 PM, record your estimated time and copy the notice to Slack.',
  'Trabajando': 'Working', 'Acción requerida': 'Action required', 'Tarea actual': 'Current task', 'Enviaré el EOD a las': 'I will submit the EOD at',
  'Registrar que sigo trabajando': 'Record that I am still working', 'Copiar aviso para Slack': 'Copy Slack notice',
  'Indica la tarea actual y la hora estimada del reporte.': 'Enter your current task and the estimated report time.', 'Estado actualizado. Ya puedes copiar el aviso para Slack.': 'Status updated. You can now copy the Slack notice.',
  'Aviso para Slack copiado.': 'Slack notice copied.', 'No se pudo copiar automáticamente. Selecciona el texto y cópialo manualmente.': 'Could not copy automatically. Select the text and copy it manually.',
  'Reporte EOD enviado a Kevin y Alejandra correctamente.': 'EOD report sent to Kevin and Alejandra successfully.', 'Revisión guardada.': 'Review saved.', 'Reporte marcado para seguimiento.': 'Report marked for follow-up.',
  'Comentario agregado.': 'Comment added.', 'Seguimiento convertido en tarea de prioridad alta.': 'Follow-up converted into a high-priority task.', 'Revisado': 'Reviewed', 'Requiere seguimiento': 'Requires follow-up', 'Visto': 'Seen',
  'Desmarca cualquier tarea que no quieras incluir.': 'Uncheck any task you do not want to include.', 'Resultados, bloqueos o contexto para supervisión…': 'Results, blockers, or context for supervisors…', 'Enviar reporte': 'Submit report', 'No hay informes con estos filtros.': 'There are no reports matching these filters.',
  'Comentario del supervisor': 'Supervisor comment', 'Deja una observación o instrucción…': 'Leave an observation or instruction…', 'Agregar comentario': 'Add comment', 'Convertir en tarea alta': 'Convert to high-priority task', '✓ Tarea creada': '✓ Task created',
  'Verificando EOD…': 'Checking EOD…', 'Cierre diario · hora de Kevin': 'Daily close · Kevin time', 'EOD de hoy': 'Today’s EOD', 'Ver detalle': 'View details',
  'Ya pasaron las 8:00 PM en la hora de Kevin. Si continúas trabajando, registra la tarea y la hora estimada en EOD Reports y copia el aviso para Slack.': 'It is already past 8:00 PM in Kevin’s time zone. If you are still working, record the task and estimated time in EOD Reports and copy the Slack notice.',
  'Puedes cancelar, abrir EOD Reports y enviarlo antes de salir.': 'You can cancel, open EOD Reports, and submit it before signing out.', '¿Cerrar sesión de todos modos?': 'Sign out anyway?',
  'Salida de la operación': 'Exit from operations', 'Archivar cliente': 'Archive client', 'El dossier y el historial se conservarán fuera de los clientes activos.': 'The dossier and history will be preserved outside active clients.',
  'Motivo': 'Reason', 'Seleccionar…': 'Select…', 'Contrato finalizado': 'Contract completed', 'Cancelación del cliente': 'Client cancellation', 'Falta de pago': 'Non-payment', 'Campaña terminada': 'Campaign completed', 'Otro': 'Other',
  'Nota final opcional': 'Optional final note', 'Contexto de la salida, pendientes o condiciones para regresar…': 'Exit context, pending items, or conditions for returning…', 'Archivando…': 'Archiving…', 'Confirmar archivo': 'Confirm archive',
  'Cliente archivado': 'Archived client', 'ARCHIVADO': 'ARCHIVED', 'Restaurando…': 'Restoring…', 'Restaurar cliente': 'Restore client', 'Cliente archivado correctamente.': 'Client archived successfully.', 'Cliente restaurado a la operación activa.': 'Client restored to active operations.',
  '¿Restaurar este cliente a la operación activa?': 'Restore this client to active operations?',
  'Bóveda de credenciales': 'Credentials vault', 'No se incluye en el dossier, PDF, Google Docs ni búsquedas.': 'It is not included in the dossier, PDF, Google Docs, or searches.', 'Protegido': 'Protected',
  'Acceso restringido. Kevin puede habilitar el permiso individual desde Usuarios.': 'Restricted access. Kevin can enable individual permission from Users.', 'Verificando permiso…': 'Checking permission…', 'Mostrar token': 'Show token', 'No hay token configurado': 'No token configured', 'Copiar': 'Copy', 'Ocultar': 'Hide', 'Actualizar token': 'Update token',
  'Access Token copiado de forma segura.': 'Access Token copied securely.', 'No se pudo copiar el token. Selecciónalo manualmente.': 'Could not copy the token. Select it manually.', 'El Access Token no puede estar vacío.': 'The Access Token cannot be empty.', 'Access Token actualizado y protegido.': 'Access Token updated and protected.',
  'Formulario del cliente recibido': 'Client form received', 'Formulario del cliente pendiente': 'Client form pending', 'Confirma este paso antes de completar accesos y datos del WWWW.': 'Confirm this step before completing WWWW access and information.', 'Marcar pendiente': 'Mark pending', 'Marcar formulario recibido': 'Mark form received',
  'Formulario del cliente marcado como recibido.': 'Client form marked as received.', 'Formulario marcado como pendiente.': 'Form marked as pending.', 'PDF descargado correctamente.': 'PDF downloaded successfully.', 'Google Docs marcado como actualizado.': 'Google Docs marked as updated.',
  'guardado correctamente.': 'saved successfully.',
  'Selecciona el motivo de salida.': 'Select the exit reason.', 'Motivo de archivo': 'Archive reason', 'Nota de salida': 'Exit note', 'Fecha de archivo': 'Archive date', 'Usuario que archivó': 'User who archived',
  'Campaña activa': 'Campaign active', 'Lanzamiento atrasado': 'Launch overdue', 'Pendiente de lanzamiento': 'Pending launch', 'Sin fecha definida': 'No date set', 'Todavía no se ha copiado': 'Not copied yet', 'Sin actualizaciones registradas': 'No updates recorded',
  'Nuevo expediente': 'New dossier', 'Crear cliente': 'Create client', 'Registra lo esencial; podrás completar el resto del dossier después.': 'Enter the essentials; you can complete the rest of the dossier later.', 'Teléfono': 'Phone',
  'creó': 'created', 'actualizó': 'updated', 'eliminó': 'deleted', 'un cliente': 'a client', 'una nota': 'a note', 'un evento': 'an event', 'un registro operativo': 'an operations record',
  'Administración': 'Administration', 'Administra los módulos, listas y enlaces del equipo.': 'Manage team modules, lists, and links.', 'Revisa el hub semanalmente y marca cada lección cuando esté comprendida.': 'Review the hub weekly and mark each lesson once understood.',
  'Módulo creado.': 'Module created.', 'Lección agregada.': 'Lesson added.', 'Módulo eliminado.': 'Module deleted.', 'Módulo actualizado.': 'Module updated.', 'Lección eliminada.': 'Lesson deleted.', 'Lección actualizada.': 'Lesson updated.',
  '¿Eliminar este módulo y sus lecciones?': 'Delete this module and its lessons?', '¿Eliminar esta lección?': 'Delete this lesson?',
  'Notificaciones activadas.': 'Notifications enabled.', 'Cada usuario elige su propia hora local desde Mi cuenta.': 'Each user chooses their local time from My account.', 'Tú': 'You', 'Lun': 'Mon', 'Mar': 'Tue', 'Mié': 'Wed', 'Jue': 'Thu', 'Vie': 'Fri', 'Sáb': 'Sat', 'Dom': 'Sun',
  '15 minutos': '15 minutes', '1 hora': '1 hour', '24 horas': '24 hours',
  'Evento general': 'General event', 'Selecciona el cliente específico.': 'Select the specific client.', 'Atrasada': 'Overdue', 'Vence': 'Due',
  'Actualizó el dossier': 'Updated the dossier',
  'Usuario creado y acceso confirmado.': 'User created and access confirmed.', 'Administración operativa (sin usuarios)': 'Operations administration (without user management)', 'Usuario sin nombre': 'Unnamed user', 'Ver': 'Show',
  'Selecciona una zona válida de la lista': 'Select a valid time zone from the list', 'Las contraseñas nuevas no coinciden.': 'The new passwords do not match.', 'Contraseña actualizada correctamente.': 'Password updated successfully.',
  'Logo cargado. Guarda los cambios para aplicarlo.': 'Logo uploaded. Save the changes to apply it.', 'Identidad de TP | Ops actualizada.': 'TP | Ops identity updated.',
  'Este usuario está desactivado.': 'This user is disabled.', 'Tu sesión venció. Inicia sesión nuevamente para continuar.': 'Your session expired. Sign in again to continue.',
  'Selecciona un logo.': 'Select a logo.', 'El logo debe pesar menos de 5 MB.': 'The logo must be smaller than 5 MB.', 'Usa un archivo PNG, JPG o WebP.': 'Use a PNG, JPG, or WebP file.',
  'La prioridad seleccionada no es válida.': 'The selected priority is invalid.', 'El estado seleccionado no es válido.': 'The selected status is invalid.', 'Selecciona una zona horaria válida.': 'Select a valid time zone.', 'Selecciona un avatar válido.': 'Select a valid avatar.', 'Selecciona un idioma válido.': 'Select a valid language.',
  'La nueva contraseña debe tener al menos 10 caracteres.': 'The new password must be at least 10 characters.', 'La nueva contraseña debe ser diferente a la actual.': 'The new password must be different from the current password.', 'La contraseña actual no es correcta.': 'The current password is incorrect.',
}

const patterns = [
  [/^(\d+) integrantes$/, '$1 team members'], [/^(\d+) clientes$/, '$1 clients'], [/^(\d+) tareas abiertas$/, '$1 open tasks'], [/^(\d+) sin leer$/, '$1 unread'],
  [/^(\d+) actividades$/, '$1 activities'], [/^(\d+) lecciones$/, '$1 lessons'], [/^(\d+) campañas activas$/, '$1 active campaigns'], [/^(\d+) verificación enviada$/, '$1 verification submitted'],
  [/^(\d+) de (\d+) tareas seleccionadas$/, '$1 of $2 tasks selected'], [/^(\d+) actividades serán enviadas\.$/, '$1 activities will be submitted.'], [/^(\d+) reporte$/, '$1 report'], [/^(\d+) reportes$/, '$1 reports'],
  [/^Enviado (.+) · (\d+) actividades$/, 'Submitted $1 · $2 activities'], [/^Ciclo: (.+) — (.+)$/, 'Cycle: $1 — $2'],
  [/^(\d+) clientes totales$/, '$1 total clients'], [/^(\d+) dossiers incompletos$/, '$1 incomplete dossiers'], [/^(\d+) clientes bloqueados$/, '$1 blocked clients'],
  [/^Actualizado por (.+) · (.+)$/, 'Updated by $1 · $2'], [/^Responsable:\s*(.+)$/, 'Internal assignee: $1'], [/^Propietario del cliente:\s*(.+)$/, 'Client owner: $1'], [/^Responsable interno:\s*(.+)$/, 'Internal assignee: $1'], [/^Hora actual:\s*(.+)$/, 'Current time: $1'],
  [/^La regla de las 8:00 PM se calcula en (.+)\.$/, 'The 8:00 PM rule is calculated in $1.'], [/^La referencia es la hora de Kevin: (.+)\.$/, 'The reference is Kevin’s time: $1.'],
  [/^EOD estimado: (.+) · hora Kevin$/, 'Estimated EOD: $1 · Kevin time'], [/^(\d+) enviados$/, '$1 submitted'], [/^(\d+) trabajando$/, '$1 working'], [/^(\d+) pendientes$/, '$1 pending'],
  [/^Enviado (.+)$/, 'Submitted $1'], [/^Archivado el (.+)$/, 'Archived on $1'], [/^Marcado el (.+)$/, 'Marked on $1'], [/^Pausada el (.+)$/, 'Paused on $1'],
  [/^Últimos (\d+)$/, 'Latest $1'], [/^(\d+) eventos$/, '$1 events'], [/^(\d+) nota$/, '$1 note'], [/^(\d+) notas$/, '$1 notes'],
  [/^(.+) actualizado correctamente\.$/, '$1 updated successfully.'], [/^Contraseña de (.+) restablecida\. Comunícala por un canal seguro\.$/, '$1’s password was reset. Share it through a secure channel.'],
  [/^(.+) guardado correctamente\.$/, '$1 saved successfully.'],
  [/^No encontramos “(.+)” en este dossier\.$/, 'We could not find “$1” in this dossier.'], [/^Resultado encontrado en (.+)\.$/, 'Result found in $1.'],
  [/^Todavía no has enviado tu reporte EOD del (.+)\.$/, 'You have not submitted your EOD report for $1 yet.'], [/^No pudimos verificar el estado del EOD \((.+)\)\.$/, 'We could not verify the EOD status ($1).'],
]

export function translateValue(value, language) {
  const leading = value.match(/^\s*/)?.[0] || ''
  const trailing = value.match(/\s*$/)?.[0] || ''
  const clean = value.trim()
  if (!clean) return value
  if (language === 'es') return value
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

  const value = useMemo(() => ({
    language,
    locale: language === 'en' ? 'en-US' : 'es-NI',
    setLanguage,
    t: (value) => translateValue(String(value ?? ''), language),
    formatDate: (value, options = {}) => new Intl.DateTimeFormat(language === 'en' ? 'en-US' : 'es-NI', options).format(value instanceof Date ? value : new Date(value)),
  }), [language, setLanguage])
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
