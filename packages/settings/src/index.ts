import { z } from 'zod';

/** Versioned user/application state, separate from note content and indexes. */

export const AppearanceSchema = z.object({
  theme: z.enum(['dark', 'light', 'system']).default('dark'),
  locale: z.enum(['en', 'fa']).default('en'),
  rtlNotes: z.boolean().default(false),
});

export const WorkspaceSchema = z.object({
  selectedVault: z.string().nullable().default(null),
  openTabs: z.array(z.string()).default([]),
  activePath: z.string().nullable().default(null),
  editorMode: z.enum(['edit', 'split', 'preview']).default('edit'),
  explorerWidth: z.number().min(160).max(500).default(240),
  rightbarWidth: z.number().min(180).max(600).default(260),
  windowWidth: z.number().min(800).max(10000).default(1280),
  windowHeight: z.number().min(600).max(10000).default(800),
});

export const SettingsSchema = z.object({
  version: z.literal(1),
  appearance: AppearanceSchema.default(AppearanceSchema.parse({})),
  workspace: WorkspaceSchema.default(WorkspaceSchema.parse({})),
  recentFiles: z.array(z.string()).max(50).default([]),
});

export type AppearanceSettings = z.infer<typeof AppearanceSchema>;
export type WorkspaceState = z.infer<typeof WorkspaceSchema>;
export type AppSettings = z.infer<typeof SettingsSchema>;

export const DEFAULT_SETTINGS: AppSettings = SettingsSchema.parse({ version: 1 });

/** Parse untrusted JSON from disk; invalid values fall back to defaults. */
export function parseSettings(raw: unknown): AppSettings {
  const parsed = SettingsSchema.safeParse(raw);
  return parsed.success ? parsed.data : DEFAULT_SETTINGS;
}

/** Merge a partial update and validate the resulting full state. */
export function updateSettings(current: AppSettings, patch: Partial<AppSettings>): AppSettings {
  return SettingsSchema.parse({
    ...current,
    ...patch,
    appearance: { ...current.appearance, ...(patch.appearance ?? {}) },
    workspace: { ...current.workspace, ...(patch.workspace ?? {}) },
  });
}

/** Persist only JSON-compatible settings; no note contents are accepted. */
export function serializeSettings(settings: AppSettings): string {
  return `${JSON.stringify(SettingsSchema.parse(settings), null, 2)}\n`;
}
