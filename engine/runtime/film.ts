// Loads the film (film/project.ts), for the preview player and the headless renderer.
import type { Project } from '../core/types';

const loaders = import.meta.glob('/film/project.ts') as Record<string, () => Promise<{ default: Project }>>;

export async function loadFilm(): Promise<Project> {
  const load = loaders['/film/project.ts'];
  if (!load) throw new Error('No film at film/project.ts');
  return (await load()).default;
}
