import { runWithSessionRetry, supabase } from '../lib/supabase'

export async function loadTeam() {
  const [profilesResult, departmentsResult, rolesResult, assignmentsResult] = await runWithSessionRetry(() => Promise.all([
    supabase.from('profiles')
      .select('id, email, full_name, role, active, timezone, slack_contact, whatsapp_contact, created_at')
      .order('created_at'),
    supabase.from('departments')
      .select('id, name_es, name_en, permissions, sort_order, active')
      .eq('active', true)
      .order('sort_order'),
    supabase.from('department_roles')
      .select('id, department_id, title_es, title_en, description_es, description_en, sort_order, active')
      .eq('active', true)
      .order('sort_order'),
    supabase.from('profile_department_roles')
      .select('profile_id, department_role_id, is_primary')
      .order('is_primary', { ascending: false }),
  ]))

  const error = profilesResult.error || departmentsResult.error || rolesResult.error || assignmentsResult.error
  if (error) throw error

  const departments = departmentsResult.data || []
  const departmentById = new Map(departments.map((department) => [department.id, department]))
  const departmentRoles = (rolesResult.data || []).map((role) => ({
    ...role,
    department: departmentById.get(role.department_id) || null,
  }))
  const roleById = new Map(departmentRoles.map((role) => [role.id, role]))
  const assignmentsByProfile = new Map()
  for (const assignment of assignmentsResult.data || []) {
    if (!assignmentsByProfile.has(assignment.profile_id)) assignmentsByProfile.set(assignment.profile_id, [])
    const role = roleById.get(assignment.department_role_id)
    if (role) assignmentsByProfile.get(assignment.profile_id).push({ ...role, is_primary: assignment.is_primary })
  }

  return {
    departments,
    departmentRoles,
    profiles: (profilesResult.data || []).map((profile) => ({
      ...profile,
      department_roles: assignmentsByProfile.get(profile.id) || [],
    })),
  }
}

export async function manageTeamUser(payload) {
  const { data, error } = await supabase.functions.invoke('manage-team-user', { body: payload })
  if (error) {
    try {
      const details = await error.context?.json()
      throw new Error(details?.error || error.message)
    } catch (contextError) {
      throw contextError instanceof Error && contextError.message !== 'Unexpected end of JSON input' ? contextError : error
    }
  }
  if (data?.error) throw new Error(data.error)
  return data.profile
}
