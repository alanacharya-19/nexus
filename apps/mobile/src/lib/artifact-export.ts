import { File, Paths } from 'expo-file-system';
import type { Artifact } from '@nexus/shared';
import { api } from '@/lib/api';

export type ArtifactExportFormat = 'md' | 'txt' | 'json';

export interface ArtifactExportOption {
  format: ArtifactExportFormat;
  label: string;
  description: string;
  mimeType: string;
  uti: string;
}

export const ARTIFACT_EXPORT_OPTIONS: ArtifactExportOption[] = [
  {
    format: 'md',
    label: 'Markdown',
    description: 'Keep headings, emphasis, and code fences intact.',
    mimeType: 'text/markdown',
    uti: 'net.daringfireball.markdown',
  },
  {
    format: 'txt',
    label: 'Plain text',
    description: 'Strip formatting for pasting into any document.',
    mimeType: 'text/plain',
    uti: 'public.plain-text',
  },
  {
    format: 'json',
    label: 'JSON',
    description: 'Full artifact record, including metadata.',
    mimeType: 'application/json',
    uti: 'public.json',
  },
];

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'nexus-artifact'
  );
}

export function artifactExportFilename(
  artifact: Artifact,
  format: ArtifactExportFormat
): string {
  return `${slugify(artifact.name)}-v${artifact.version}.${format}`;
}

/**
 * Fetches the server-rendered export and writes it into the cache directory so
 * the native share sheet can attach it. Returns the local file.
 */
export async function prepareArtifactExport(
  artifact: Artifact,
  format: ArtifactExportFormat
): Promise<File> {
  const content = await api.exportArtifact(artifact.id, format);
  const file = new File(Paths.cache, artifactExportFilename(artifact, format));
  if (file.exists) file.delete();
  file.create({ overwrite: true });
  file.write(content);
  return file;
}
