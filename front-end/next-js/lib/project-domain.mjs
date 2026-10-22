export const PROJECT_TYPES = [
  { value: 'frontend', label: 'Frontend' },
  { value: 'backend', label: 'Backend' },
  { value: 'fullstack', label: 'Fullstack' },
  { value: 'general', label: 'General' },
];
export const TECHNOLOGIES = [
  { key: 'languages', label: 'Languages', options: [
    ['javascript', 'JavaScript'], ['typescript', 'TypeScript'], ['python', 'Python'],
    ['sql', 'SQL'], ['cpp', 'C++'],
  ] },
  { key: 'frameworks', label: 'Frameworks and libraries', options: [
    ['nextjs', 'Next.js'], ['angular', 'Angular'], ['react', 'React'],
  ] },
  { key: 'runtimes', label: 'Runtimes', options: [['nodejs', 'Node.js']] },
  { key: 'database_categories', label: 'Database categories', options: [['nosql', 'NoSQL']] },
];
export function emptyDraft() {
  return { name: '', description: '', project_type: '', languages: [], frameworks: [], runtimes: [], database_categories: [] };
}
export function toDraft(project) {
  const result = emptyDraft();
  result.name = project.name;
  result.description = project.description ?? '';
  result.project_type = project.project_type;
  for (const group of TECHNOLOGIES) result[group.key] = [...project[group.key]];
  return result;
}
export function toPayload(draft) {
  const payload = { name: draft.name.trim(), description: draft.description.trim(), project_type: draft.project_type };
  for (const group of TECHNOLOGIES) payload[group.key] = [...new Set(draft[group.key])].sort();
  return payload;
}
export function validateDraft(draft) {
  const errors = {};
  if (!draft.name.trim()) errors.name = 'Enter a project name.';
  if (!PROJECT_TYPES.some(item => item.value === draft.project_type)) errors.project_type = 'Choose one project type.';
  for (const group of TECHNOLOGIES) {
    if (!Array.isArray(draft[group.key]) || draft[group.key].some(value => !group.options.some(([id]) => id === value))) {
      errors[group.key] = 'Unsupported technology selection. Reload before saving.';
    }
  }
  return errors;
}
export function isDirty(draft, saved) {
  return JSON.stringify(toPayload(draft)) !== JSON.stringify(toPayload(saved));
}
export function parseProject(value) {
  if (!value || typeof value !== 'object' || typeof value.id !== 'string' || !value.id ||
      typeof value.name !== 'string' || !Number.isInteger(value.revision) || value.revision < 1 ||
      !['active', 'deleted'].includes(value.status) ||
      !(value.description == null || typeof value.description === 'string') ||
      !PROJECT_TYPES.some(item => item.value === value.project_type)) {
    throw new Error('The project API returned an incompatible response.');
  }
  for (const group of TECHNOLOGIES) {
    if (!Array.isArray(value[group.key]) || value[group.key].some(item => typeof item !== 'string' || !group.options.some(([id]) => id === item))) {
      throw new Error('The project API returned an unsupported technology catalog.');
    }
  }
  return { ...value, description: value.description ?? '' };
}
export function technologyLabels(project) {
  return TECHNOLOGIES.flatMap(group => group.options.filter(([id]) => project[group.key].includes(id)).map(([, label]) => label));
}
