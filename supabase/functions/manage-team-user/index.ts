import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.116.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
})

const validTimezone = (timezone: string) => {
  try { new Intl.DateTimeFormat('en', { timeZone: timezone }).format(); return true }
  catch { return false }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'Método no permitido.' }, 405)

  try {
    const authorization = request.headers.get('Authorization')
    if (!authorization) return json({ error: 'Sesión requerida.' }, 401)

    const url = Deno.env.get('SUPABASE_URL') ?? ''
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const callerClient = createClient(url, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const token = authorization.replace(/^Bearer\\s+/i, '')
    const { data: userData, error: userError } = await callerClient.auth.getUser(token)
    if (userError || !userData.user) return json({ error: 'Sesión inválida.' }, 401)

    const admin = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: caller } = await admin.from('profiles').select('role, active').eq('id', userData.user.id).single()
    if (!caller?.active || caller.role !== 'superadmin') return json({ error: 'Solo el superadmin puede administrar usuarios.' }, 403)

    const body = await request.json()
    const action = body.action === 'reset_password' ? 'reset_password' : body.action === 'update' ? 'update' : 'create'
    const userId = String(body.userId || '')

    if (action === 'reset_password') {
      const password = String(body.password || '')
      if (!userId) return json({ error: 'Usuario requerido.' }, 400)
      if (password.length < 10) return json({ error: 'La contraseña debe tener al menos 10 caracteres.' }, 400)
      const { error: resetError } = await admin.auth.admin.updateUserById(userId, { password })
      if (resetError) return json({ error: resetError.message }, 400)
      return json({ success: true })
    }

    const departmentRoleIds = Array.isArray(body.departmentRoleIds)
      ? [...new Set(body.departmentRoleIds.map((value: unknown) => String(value).trim()).filter(Boolean))]
      : []
    if (!departmentRoleIds.length) return json({ error: 'Selecciona al menos una función de departamento.' }, 400)

    const { data: selectedRoles, error: rolesError } = await admin
      .from('department_roles').select('id, department_id').in('id', departmentRoleIds).eq('active', true)
    if (rolesError) return json({ error: rolesError.message }, 400)
    if (!selectedRoles || selectedRoles.length !== departmentRoleIds.length) {
      return json({ error: 'Una o más funciones de departamento no son válidas.' }, 400)
    }

    const departmentIds = [...new Set(selectedRoles.map((item) => item.department_id))]
    const { data: departments, error: departmentsError } = await admin
      .from('departments').select('id, legacy_app_role').in('id', departmentIds).eq('active', true)
    if (departmentsError) return json({ error: departmentsError.message }, 400)
    if (!departments || departments.length !== departmentIds.length) {
      return json({ error: 'Uno o más departamentos no están activos.' }, 400)
    }

    const hasDirection = departmentIds.includes('direction')
    if (hasDirection && (action === 'create' || userId !== userData.user.id)) {
      return json({ error: 'La función de Dirección está reservada al superadmin actual.' }, 403)
    }
    if (action === 'update' && !hasDirection && userId === userData.user.id) {
      return json({ error: 'No puedes quitarte tu propio acceso de superadmin.' }, 400)
    }

    if (action === 'create') {
      const email = String(body.email || '').trim().toLowerCase()
      const password = String(body.password || '')
      const fullName = String(body.fullName || '').trim()
      const timezone = String(body.timezone || 'America/Managua')
      const slackContact = String(body.slackContact || '').trim()
      const whatsappContact = String(body.whatsappContact || '').trim()
      if (!email || !email.includes('@')) return json({ error: 'Correo inválido.' }, 400)
      if (password.length < 10) return json({ error: 'La contraseña debe tener al menos 10 caracteres.' }, 400)
      if (!fullName) return json({ error: 'Escribe el nombre del usuario.' }, 400)
      if (!validTimezone(timezone)) return json({ error: 'Zona horaria inválida.' }, 400)
      if (slackContact.length > 300 || whatsappContact.length > 300) return json({ error: 'El contacto es demasiado largo.' }, 400)

      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email, password, email_confirm: true,
        user_metadata: { full_name: fullName },
        app_metadata: { app_role: departments.find((item) => item.legacy_app_role !== 'superadmin')?.legacy_app_role || 'onboarding_media' },
      })
      if (createError || !created.user) return json({ error: createError?.message || 'No se pudo crear el usuario.' }, 400)

      const { error: profileError } = await admin.from('profiles').update({
        email, full_name: fullName, active: false, timezone,
        slack_contact: slackContact, whatsapp_contact: whatsappContact,
      }).eq('id', created.user.id)
      if (profileError) {
        await admin.auth.admin.deleteUser(created.user.id)
        return json({ error: profileError.message }, 400)
      }

      const { error: assignmentError } = await admin.rpc('admin_set_profile_department_roles', {
        p_profile_id: created.user.id, p_role_ids: departmentRoleIds,
      })
      if (assignmentError) {
        await admin.auth.admin.deleteUser(created.user.id)
        return json({ error: assignmentError.message }, 400)
      }
      const { error: activationError } = await admin.from('profiles')
        .update({ active: true }).eq('id', created.user.id)
      if (activationError) {
        await admin.auth.admin.deleteUser(created.user.id)
        return json({ error: activationError.message }, 400)
      }
      const { data: profile, error: resultError } = await admin.from('profiles')
        .select('id, email, full_name, role, permissions, active, timezone, slack_contact, whatsapp_contact, created_at')
        .eq('id', created.user.id).single()
      if (resultError || !profile) return json({ error: resultError?.message || 'No se pudo cargar el perfil.' }, 400)
      await admin.auth.admin.updateUserById(created.user.id, { app_metadata: { app_role: profile.role } })
      return json({ profile }, 201)
    }

    if (!userId) return json({ error: 'Usuario requerido.' }, 400)
    const fullName = String(body.fullName || '').trim()
    const timezone = String(body.timezone || 'America/Managua')
    const slackContact = String(body.slackContact || '').trim()
    const whatsappContact = String(body.whatsappContact || '').trim()
    if (!fullName) return json({ error: 'Escribe el nombre del usuario.' }, 400)
    if (!validTimezone(timezone)) return json({ error: 'Zona horaria inválida.' }, 400)
    if (slackContact.length > 300 || whatsappContact.length > 300) return json({ error: 'El contacto es demasiado largo.' }, 400)

    const { data: currentProfile, error: currentProfileError } = await admin.from('profiles')
      .select('active').eq('id', userId).single()
    if (currentProfileError || !currentProfile) return json({ error: currentProfileError?.message || 'Usuario no encontrado.' }, 404)

    // Temporarily disable the account while its inherited permissions are replaced.
    const { error: lockError } = await admin.from('profiles').update({ active: false }).eq('id', userId)
    if (lockError) return json({ error: lockError.message }, 400)

    const { error: assignmentError } = await admin.rpc('admin_set_profile_department_roles', {
      p_profile_id: userId, p_role_ids: departmentRoleIds,
    })
    if (assignmentError) {
      await admin.from('profiles').update({ active: currentProfile.active }).eq('id', userId)
      return json({ error: assignmentError.message }, 400)
    }

    const { error: profileError } = await admin.from('profiles').update({
      full_name: fullName, active: body.active !== false, timezone,
      slack_contact: slackContact, whatsapp_contact: whatsappContact,
    }).eq('id', userId)
    if (profileError) return json({ error: profileError.message }, 400)

    const { data: profile, error: resultError } = await admin.from('profiles')
      .select('id, email, full_name, role, permissions, active, timezone, slack_contact, whatsapp_contact, created_at')
      .eq('id', userId).single()
    if (resultError || !profile) return json({ error: resultError?.message || 'No se pudo cargar el perfil.' }, 400)

    const { error: authError } = await admin.auth.admin.updateUserById(userId, {
      user_metadata: { full_name: fullName },
      app_metadata: { app_role: profile.role },
      ban_duration: profile.active ? 'none' : '876000h',
    })
    if (authError) return json({ error: authError.message }, 400)
    return json({ profile })
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Error inesperado.' }, 500)
  }
})
