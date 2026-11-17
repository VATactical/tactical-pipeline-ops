import { createContext, useContext, useEffect, useState } from 'react'

// Simple 24px line icons drawn for TP Ops navigation (stroke = currentColor).
const paths = {
  home: <><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h5v-6h4v6h5V9.5" /></>,
  clients: <><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><path d="M3 13h18" /></>,
  tickets: <><path d="M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4Z" /><path d="M14 5v12" strokeDasharray="2 2" /></>,
  eod: <><rect x="5" y="4" width="14" height="17" rx="2" /><path d="M9 4V3h6v1" /><path d="m9 13 2 2 4-4" /></>,
  team: <><circle cx="9" cy="8" r="3" /><path d="M3 20a6 6 0 0 1 12 0" /><circle cx="17" cy="9" r="2.5" /><path d="M16 14.2A5 5 0 0 1 21 19" /></>,
  training: <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5Z" /><path d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5" /><path d="M9 8h7" /></>,
  users: <><path d="M12 3 4 6v6c0 4.5 3.4 8 8 9 4.6-1 8-4.5 8-9V6Z" /><path d="m9 12 2 2 4-4" /></>,
  company: <><path d="M4 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16" /><path d="M16 9h2a2 2 0 0 1 2 2v10" /><path d="M8 7h4M8 11h4M8 15h4" /><path d="M2 21h20" /></>,
  account: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
  dossier: <><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z" /><path d="M14 3v6h6" /><path d="M8 13h8M8 17h5" /></>,
  ads: <><path d="M3 11v2a1 1 0 0 0 1 1h3l5 4V6L7 10H4a1 1 0 0 0-1 1Z" /><path d="M16 9a4 4 0 0 1 0 6" /><path d="M19 6a8 8 0 0 1 0 12" /></>,
  notes: <><path d="M5 3h14a2 2 0 0 1 2 2v10l-6 6H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" /><path d="M15 21v-6h6" /><path d="M7 8h10M7 12h6" /></>,
  audit: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
}

export function NavIcon({ name }) {
  return <svg className="nav-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{paths[name]}</svg>
}

// Sections of the app. `show` decides visibility from the signed-in profile.
export const navGroups = [
  { label: 'Operación', items: [
    { to: '/', end: true, label: 'Panel', icon: 'home' },
    { to: '/clientes', label: 'Clientes', icon: 'clients' },
    { to: '/tickets', label: 'Tickets', icon: 'tickets' },
  ] },
  { label: 'Equipo', items: [
    { to: '/eod-reports', label: 'EOD Reports', icon: 'eod', badge: 'eod' },
    { to: '/mi-equipo', label: 'Mi equipo', icon: 'team' },
    { to: '/training', label: 'Training', icon: 'training' },
  ] },
  { label: 'Administración', items: [
    { to: '/equipo', label: 'Usuarios', icon: 'users', show: (profile) => profile?.role === 'superadmin' },
    { to: '/mi-empresa', label: 'Mi empresa', icon: 'company', show: (profile) => profile?.role === 'superadmin' || profile?.permissions?.operations_admin },
  ] },
]

const extraSections = [{ group: 'Cuenta', to: '/mi-cuenta', label: 'Mi cuenta', icon: 'account' }]

// Group and section for a pathname: '/clientes/abc' -> Operación › Clientes.
export function sectionFor(pathname) {
  for (const group of navGroups) {
    for (const item of group.items) {
      if (item.end ? pathname === item.to : pathname === item.to || pathname.startsWith(`${item.to}/`)) return { group: group.label, ...item }
    }
  }
  return extraSections.find((item) => pathname === item.to || pathname.startsWith(`${item.to}/`)) || null
}

// Pages add deeper crumbs (a client, a tab) with usePageTrail([...]).
const TrailContext = createContext({ trail: [], setTrail: () => {} })

export function PageTrailProvider({ children }) {
  const [trail, setTrail] = useState([])
  return <TrailContext.Provider value={{ trail, setTrail }}>{children}</TrailContext.Provider>
}

export function usePageTrailState() {
  return useContext(TrailContext).trail
}

// crumbs: [{ label, to? }]. Cleared automatically when the page unmounts.
export function usePageTrail(crumbs) {
  const { setTrail } = useContext(TrailContext)
  const key = JSON.stringify(crumbs)
  useEffect(() => {
    setTrail(crumbs)
    return () => setTrail([])
  }, [key])
}
