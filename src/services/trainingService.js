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
