// Discovers every project under projects/<id>/project.ts.
import type { Project } from '../core/types';

const loaders = import.meta.glob('/projects/*/project.ts') as Record<string, () => Promise<{ default: Project }>>;

export function projectIds(): string[] {
  return Object.keys(loaders)
    .map((p) => p.split('/')[2])
    .sort();
}

export async function loadProject(id: string): Promise<Project> {
  const key = `/projects/${id}/project.ts`;
  const load = loaders[key];
  if (!load) throw new Error(`Unknown project "${id}". Available: ${projectIds().join(', ')}`);
  return (await load()).default;
}
