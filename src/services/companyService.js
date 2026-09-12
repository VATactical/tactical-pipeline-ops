import { runWithSessionRetry, supabase } from '../lib/supabase'
import bundledLogoUrl from '../assets/tp-logo.png'

export const defaultCompany = {
  company_name: 'Tactical Pipeline', system_name: 'TP | Ops',
  company_email: 'info@tacticalpipeline.com', company_website: '', logo_url: '/tp-logo.png',
}

export const resolveCompanyLogo = (logoUrl) => !logoUrl || logoUrl === '/tp-logo.png' || logoUrl === '/favicon.png'
  ? bundledLogoUrl
  : logoUrl

export async function loadCompanySettings() {
  const { data, error } = await runWithSessionRetry(() => supabase.from('company_settings').select('*').eq('id', 1).single())
  if (error) throw error
  return data || defaultCompany
}

export async function saveCompanySettings(settings, profileId) {
  const { data, error } = await supabase.from('company_settings').update({
    company_name: settings.company_name.trim(),
    system_name: settings.system_name.trim(),
    company_email: settings.company_email.trim(),
    company_website: settings.company_website.trim(),
    logo_url: settings.logo_url.trim() || '/tp-logo.png',
    updated_by: profileId,
    updated_at: new Date().toISOString(),
  }).eq('id', 1).select('*').single()
  if (error) throw error
  return data
}

export async function uploadCompanyLogo(file) {
  if (!file) throw new Error('Selecciona un logo.')
  if (file.size > 5 * 1024 * 1024) throw new Error('El logo debe pesar menos de 5 MB.')
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('Usa un archivo PNG, JPG o WebP.')
  const extension = file.name.split('.').pop()?.toLowerCase() || 'png'
  const path = `logo-${Date.now()}.${extension}`
  const { error } = await supabase.storage.from('branding').upload(path, file, { cacheControl: '3600' })
  if (error) throw error
  return supabase.storage.from('branding').getPublicUrl(path).data.publicUrl
}
