import { supabase } from '../lib/supabase'

// Checklist template (Mi empresa → Checklist). Writes go through SECURITY DEFINER RPCs that only
// operations admins can run; template changes affect new clients until they are applied.

export async function loadChecklistTemplate() {
  const [steps, departments, active] = await Promise.all([
    supabase.from('workflow_step_templates').select('*').order('sort_order'),
    supabase.from('departments').select('id, name_es, name_en, sort_order').eq('active', true).order('sort_order'),
    supabase.from('clients').select('id', { count: 'exact', head: true }).eq('archived', false),
  ])
  if (steps.error) throw steps.error
  if (departments.error) throw departments.error
  return { steps: steps.data || [], departments: departments.data || [], activeClients: active.count || 0 }
}

export async function saveChecklistTemplateStep(step) {
  const { data, error } = await supabase.rpc('save_checklist_template_step', {
    p_step_key: step.step_key || null, p_title_es: step.title_es, p_title_en: step.title_en,
    p_phase: step.phase, p_department_id: step.department_id, p_evidence: step.evidence,
  })
  if (error) throw error
  return data
}

export async function moveChecklistTemplateStep(stepKey, direction) {
  const { data, error } = await supabase.rpc('move_checklist_template_step', { p_step_key: stepKey, p_direction: direction })
  if (error) throw error
  return data || []
}

export async function deleteChecklistTemplateStep(stepKey) {
  const { error } = await supabase.rpc('delete_checklist_template_step', { p_step_key: stepKey })
  if (error) throw error
}

export async function applyChecklistTemplateSteps(stepKeys) {
  const { data, error } = await supabase.rpc('apply_checklist_template_steps', { p_step_keys: stepKeys })
  if (error) throw error
  return data || { added: 0, updated: 0, removed: 0 }
}
