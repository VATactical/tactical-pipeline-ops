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
  const { data, error } = await supabase.from('training_modules').insert({
    title: module.title.trim(), description: module.description.trim(), drive_url: module.driveUrl.trim(),
    audience_role: module.audienceRole || null, sort_order: Number(module.sortOrder), active: true,
  }).select('*').single()
  if (error) throw error
  return data
}

export async function updateTrainingModule(module) {
  const { data, error } = await supabase.from('training_modules').update({
    title: module.title.trim(), description: module.description.trim(), drive_url: module.drive_url.trim(),
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
  const { data, error } = await supabase.from('training_items').insert({
    module_id: moduleId, title: item.title.trim(), description: item.description.trim(),
    drive_url: item.driveUrl.trim(), resource_type: item.resourceType, sort_order: nextOrder,
  }).select('*').single()
  if (error) throw error
  return data
}

export async function updateTrainingItem(item) {
  const { data, error } = await supabase.from('training_items').update({
    title: item.title.trim(), description: item.description.trim(), drive_url: item.drive_url.trim(),
    resource_type: item.resource_type, sort_order: Number(item.sort_order),
  }).eq('id', item.id).select('*').single()
  if (error) throw error
  return data
}

export async function deleteTrainingItem(id) {
  const { error } = await supabase.from('training_items').delete().eq('id', id)
  if (error) throw error
}
