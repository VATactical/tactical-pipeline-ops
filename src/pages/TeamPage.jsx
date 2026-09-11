import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export default function TeamPage() {
  const [profiles, setProfiles] = useState([])
  const [error, setError] = useState('')

  useEffect(() => {
    supabase.from('profiles').select('id, full_name, role, created_at').order('created_at')
      .then(({ data, error: queryError }) => {
        if (queryError) setError(queryError.message)
        else setProfiles(data || [])
      })
  }, [])

  return (
    <div className="page-stack">
      <header className="page-header"><div><p className="eyebrow">Superadmin</p><h2>Equipo</h2></div></header>
      <section className="content-card">
        {error && <p className="form-error">{error}</p>}
        {!error && profiles.length === 0 && <p className="muted">Aún no hay usuarios creados.</p>}
        {profiles.map((member) => (
          <div className="member-row" key={member.id}>
            <strong>{member.full_name || 'Usuario sin nombre'}</strong><span>{member.role}</span>
          </div>
        ))}
      </section>
    </div>
  )
}
