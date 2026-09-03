import { randomUUID } from 'node:crypto';

/** Safe template rendering: only the documented variables below are replaced. */
export type TemplateVariable = 'date' | 'time' | 'uuid' | 'filename' | 'title';

export interface TemplateContext {
  readonly filename: string;
  readonly title?: string;
  readonly now?: Date;
  readonly uuid?: string;
}

export interface BuiltInTemplate {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly content: string;
}

const VARIABLE_PATTERN = /\{\{\s*([a-z]+)\s*\}\}/gi
const ALLOWED = new Set<TemplateVariable>(['date', 'time', 'uuid', 'filename', 'title']);

/**
 * Replaces only `{{date}}`, `{{time}}`, `{{uuid}}`, `{{filename}}`, and
 * `{{title}}`. Unknown variables are retained literally so template text
 * cannot execute code or access environment/process state.
 */
export function renderTemplate(template: string, context: TemplateContext): string {
  const now = context.now ?? new Date();
  const values: Record<TemplateVariable, string> = {
    date: now.toISOString().slice(0, 10),
    time: now.toISOString().slice(11, 19),
    uuid: context.uuid ?? randomUUID(),
    filename: context.filename,
    title: context.title ?? context.filename.replace(/\.[^.]+$/, ''),
  };
  return template.replace(VARIABLE_PATTERN, (whole, rawName: string) => {
    const name = rawName.toLowerCase() as TemplateVariable;
    return ALLOWED.has(name) ? values[name] : whole;
  });
}

/** Built-in starting templates, all plain Markdown. */
export const BUILT_IN_TEMPLATES: readonly BuiltInTemplate[] = [
  { id: 'research-note', name: 'Research Note', description: 'Capture a research finding.', content: '---\ntitle: {{title}}\ntype: research\ncreated: {{date}}\n---\n\n# {{title}}\n\n## Question\n\n## Findings\n\n## Sources\n' },
  { id: 'architecture-decision', name: 'Architecture Decision', description: 'Record an architectural choice.', content: '---\ntitle: {{title}}\ntype: adr\nstatus: proposed\ndate: {{date}}\n---\n\n# {{title}}\n\n## Context\n\n## Decision\n\n## Consequences\n' },
  { id: 'experiment', name: 'Experiment', description: 'Plan and record an experiment.', content: '---\ntitle: {{title}}\ntype: experiment\ncreated: {{date}}\n---\n\n# {{title}}\n\n## Hypothesis\n\n## Method\n\n## Results\n' },
  { id: 'benchmark', name: 'Benchmark', description: 'Capture reproducible measurements.', content: '---\ntitle: {{title}}\ntype: benchmark\ndate: {{date}}\n---\n\n# {{title}}\n\n## Setup\n\n## Measurements\n\n## Interpretation\n' },
  { id: 'project', name: 'Project', description: 'Start a project note.', content: '---\ntitle: {{title}}\ntype: project\nstatus: active\ncreated: {{date}}\n---\n\n# {{title}}\n\n## Goal\n\n## Tasks\n\n- [ ] Define the next step\n' },
  { id: 'provider', name: 'Provider', description: 'Document a service provider.', content: '---\ntitle: {{title}}\ntype: provider\n---\n\n# {{title}}\n\n## Endpoint\n\n## Capabilities\n' },
  { id: 'ai-model', name: 'AI Model', description: 'Document an AI model.', content: '---\ntitle: {{title}}\ntype: ai-model\n---\n\n# {{title}}\n\n## Context Window\n\n## Evaluation\n' },
  { id: 'agent-finding', name: 'Agent Finding', description: 'Record an agent result.', content: '---\ntitle: {{title}}\ntype: agent-finding\ndate: {{date}}\n---\n\n# {{title}}\n\n## Finding\n\n## Evidence\n' },
  { id: 'incident', name: 'Incident', description: 'Capture an incident timeline.', content: '---\ntitle: {{title}}\ntype: incident\nstatus: open\ndate: {{date}}\n---\n\n# {{title}}\n\n## Impact\n\n## Timeline\n\n## Remediation\n' },
  { id: 'hardware-component', name: 'Hardware Component', description: 'Document hardware.', content: '---\ntitle: {{title}}\ntype: hardware-component\n---\n\n# {{title}}\n\n## Specifications\n\n## Notes\n' },
];

export function getBuiltInTemplate(id: string): BuiltInTemplate | undefined {
  return BUILT_IN_TEMPLATES.find((template) => template.id === id);
}
