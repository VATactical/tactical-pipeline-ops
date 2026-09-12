import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.116.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const allowedRoles = new Set(['superadmin', 'onboarding_media', 'automation_funnels'])
const allowedPermissions = new Set([
  'clients_create', 'clients_edit', 'tasks_create', 'calendar_manage', 'eod_reports', 'users_manage',
])

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
})

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
    const token = authorization.replace(/^Bearer\s+/i, '')
    const { data: userData, error: userError } = await callerClient.auth.getUser(token)
    if (userError || !userData.user) return json({ error: 'Sesión inválida.' }, 401)

    const admin = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: caller } = await admin.from('profiles').select('role, active').eq('id', userData.user.id).single()
    if (!caller?.active || caller.role !== 'superadmin') return json({ error: 'Solo el superadmin puede administrar usuarios.' }, 403)

    const body = await request.json()
    const action = body.action === 'update' ? 'update' : 'create'
    const role = String(body.role || '')
    if (!allowedRoles.has(role)) return json({ error: 'Rol inválido.' }, 400)

    const permissions = Object.fromEntries(
      Object.entries(body.permissions || {})
        .filter(([key]) => allowedPermissions.has(key))
        .map(([key, value]) => [key, Boolean(value)]),
    )
    if (role === 'superadmin') {
      for (const permission of allowedPermissions) permissions[permission] = true
    }

    if (action === 'create') {
      const email = String(body.email || '').trim().toLowerCase()
      const password = String(body.password || '')
      const fullName = String(body.fullName || '').trim()
      if (!email || !email.includes('@')) return json({ error: 'Correo inválido.' }, 400)
      if (password.length < 10) return json({ error: 'La contraseña debe tener al menos 10 caracteres.' }, 400)
      if (!fullName) return json({ error: 'Escribe el nombre del usuario.' }, 400)

      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName },
        app_metadata: { app_role: role },
      })
      if (createError || !created.user) return json({ error: createError?.message || 'No se pudo crear el usuario.' }, 400)

      const { data: profile, error: profileError } = await admin.from('profiles').update({
        email,
        full_name: fullName,
        role,
        permissions,
        active: true,
      }).eq('id', created.user.id).select('id, email, full_name, role, permissions, active, created_at').single()

      if (profileError) {
        await admin.auth.admin.deleteUser(created.user.id)
        return json({ error: profileError.message }, 400)
      }
      return json({ profile }, 201)
    }

    const userId = String(body.userId || '')
    if (!userId) return json({ error: 'Usuario requerido.' }, 400)
    if (userId === userData.user.id && (role !== 'superadmin' || body.active === false)) {
      return json({ error: 'No puedes quitar tu propio acceso de superadmin.' }, 400)
    }
    const changes = {
      full_name: String(body.fullName || '').trim(),
      role,
      permissions,
      active: body.active !== false,
    }
    const { data: profile, error: updateError } = await admin.from('profiles').update(changes)
      .eq('id', userId).select('id, email, full_name, role, permissions, active, created_at').single()
    if (updateError) return json({ error: updateError.message }, 400)

    await admin.auth.admin.updateUserById(userId, {
      user_metadata: { full_name: changes.full_name },
      app_metadata: { app_role: role },
      ban_duration: changes.active ? 'none' : '876000h',
    })
    return json({ profile })
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Error inesperado.' }, 500)
  }
})
