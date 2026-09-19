import { runWithSessionRetry, supabase } from '../lib/supabase'

export async function loadTraining(profile) {
  const [modulesResult, itemsResult, progressResult] = await runWithSessionRetry(() => Promise.all([
    supabase.from('training_modules').select('*').order('sort_order'),
    supabase.from('training_items').select('*').order('sort_order'),
    supabase.from('training_progress').select('*').eq('user_id', profile.id),
  ]))
  const error = modulesResult.error || itemsResult.error || progressResult.error
  if (error) throw error
  return {
    modules: modulesResult.data || [],
    items: itemsResult.data || [],
    progress: progressResult.data || [],
  }
}

export async function setTrainingItemCompleted(profileId, itemId, completed) {
  if (completed) {
    const { error } = await supabase.from('training_progress').upsert({
      user_id: profileId,
      item_id: itemId,
      completed_at: new Date().toISOString(),
    }, { onConflict: 'user_id,item_id' })
    if (error) throw error
    return
  }
  const { error } = await supabase.from('training_progress').delete()
    .eq('user_id', profileId).eq('item_id', itemId)
  if (error) throw error
}

export async function createTrainingModule(module) {
  const titleEs = module.titleEs.trim()
  const titleEn = module.titleEn.trim()
  const descriptionEs = module.descriptionEs.trim()
  const descriptionEn = module.descriptionEn.trim()
  const { data, error } = await supabase.from('training_modules').insert({
    title: titleEs || titleEn, description: descriptionEs || descriptionEn,
    title_es: titleEs, title_en: titleEn, description_es: descriptionEs, description_en: descriptionEn,
    drive_url: module.driveUrl.trim(),
    audience_role: module.audienceRole || null, sort_order: Number(module.sortOrder), active: true,
  }).select('*').single()
  if (error) throw error
  return data
}

export async function updateTrainingModule(module) {
  const titleEs = (module.title_es || '').trim()
  const titleEn = (module.title_en || '').trim()
  const descriptionEs = (module.description_es || '').trim()
  const descriptionEn = (module.description_en || '').trim()
  const { data, error } = await supabase.from('training_modules').update({
    title: titleEs || titleEn, description: descriptionEs || descriptionEn,
    title_es: titleEs, title_en: titleEn, description_es: descriptionEs, description_en: descriptionEn,
    drive_url: module.drive_url.trim(),
    audience_role: module.audience_role || null, sort_order: Number(module.sort_order), updated_at: new Date().toISOString(),
  }).eq('id', module.id).select('*').single()
  if (error) throw error
  return data
}

export async function deleteTrainingModule(id) {
  const { error } = await supabase.from('training_modules').delete().eq('id', id)
  if (error) throw error
}

export async function createTrainingItem(moduleId, item, nextOrder) {
  const titleEs = item.titleEs.trim()
  const titleEn = item.titleEn.trim()
  const descriptionEs = item.descriptionEs.trim()
  const descriptionEn = item.descriptionEn.trim()
  const { data, error } = await supabase.from('training_items').insert({
    module_id: moduleId, title: titleEs || titleEn, description: descriptionEs || descriptionEn,
    title_es: titleEs, title_en: titleEn, description_es: descriptionEs, description_en: descriptionEn,
    drive_url: item.driveUrl.trim(), resource_type: item.resourceType, sort_order: nextOrder,
  }).select('*').single()
  if (error) throw error
  return data
}

export async function updateTrainingItem(item) {
  const titleEs = (item.title_es || '').trim()
  const titleEn = (item.title_en || '').trim()
  const descriptionEs = (item.description_es || '').trim()
  const descriptionEn = (item.description_en || '').trim()
  const { data, error } = await supabase.from('training_items').update({
    title: titleEs || titleEn, description: descriptionEs || descriptionEn,
    title_es: titleEs, title_en: titleEn, description_es: descriptionEs, description_en: descriptionEn,
    resource_type: item.resource_type, sort_order: Number(item.sort_order),
  }).eq('id', item.id).select('*').single()
  if (error) throw error
  return data
}

export async function deleteTrainingItem(id) {
  const { error } = await supabase.from('training_items').delete().eq('id', id)
  if (error) throw error
}
