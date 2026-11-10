import type { ApprovalMode, WorkflowTemplate } from './domain.js';

export interface BuiltinTemplate
  extends Omit<WorkflowTemplate, 'userId' | 'isBuiltin' | 'createdAt'> {
  suggestedApprovalMode: ApprovalMode;
}

export const BUILTIN_TEMPLATES: BuiltinTemplate[] = [
  {
    id: 'tpl_launch_brief',
    name: 'Product Launch Brief',
    description:
      'A launch-ready brief covering positioning, audience, messaging, channels, timeline, and risks.',
    category: 'Strategy',
    icon: 'rocket',
    objectiveTemplate: `Create a complete product launch brief for [PRODUCT].

Context:
- What it is: [one sentence]
- Target audience: [who]
- Launch date: [date or "next quarter"]
- Primary channels: [channels]
- Key differentiator: [differentiator]

The brief must include positioning, audience segments, core messaging, channel plan, a week-by-week launch timeline, success metrics, and the top risks with mitigations.`,
    guidance:
      'Prioritize decisions over generic marketing advice. Every recommendation must be specific to the provided context.',
    suggestedApprovalMode: 'key',
  },
  {
    id: 'tpl_competitive_dossier',
    name: 'Competitive Dossier',
    description:
      'A structured analysis of competitors, positioning gaps, pricing, and strategic opportunities.',
    category: 'Research',
    icon: 'telescope',
    objectiveTemplate: `Build a competitive intelligence dossier for [COMPANY/PRODUCT] operating in [MARKET].

Competitors to cover: [COMPETITOR A], [COMPETITOR B], [COMPETITOR C].

Include: market framing, a competitor-by-competitor profile, positioning map, pricing comparison, feature gaps, threats, and three concrete strategic opportunities. Explicitly separate verified facts from assumptions.`,
    guidance:
      'Never fabricate statistics or funding numbers. When a fact is not provided, label it as an assumption or an open research question.',
    suggestedApprovalMode: 'key',
  },
  {
    id: 'tpl_architecture_review',
    name: 'Architecture Review',
    description:
      'A rigorous review of a system design with failure modes, trade-offs, and a remediation plan.',
    category: 'Engineering',
    icon: 'layers',
    objectiveTemplate: `Review the following system architecture and produce an engineering review.

System summary:
[DESCRIBE THE SYSTEM, STACK, AND SCALE]

Known constraints: [constraints]
Current pain points: [pain points]

Cover: architecture summary, data flow, scalability limits, reliability and failure modes, security concerns, operational burden, and a prioritized remediation roadmap with effort estimates.`,
    guidance:
      'Be concrete about failure modes and trade-offs. Prefer a small number of high-impact recommendations over an exhaustive checklist.',
    suggestedApprovalMode: 'always',
  },
  {
    id: 'tpl_landing_copy',
    name: 'Landing Page Copy',
    description:
      'Conversion-focused landing page copy with hierarchy, proof, objections, and CTAs.',
    category: 'Marketing',
    icon: 'create',
    objectiveTemplate: `Write complete landing page copy for [PRODUCT].

Audience: [audience]
Primary pain: [pain]
Core outcome: [outcome]
Proof points: [proof]
Tone: [tone]

Deliver the full page in order: hero headline and subhead, primary CTA, social proof, problem, solution, three benefit blocks, how it works, objection handling, FAQ, and final CTA. Keep the copy specific and free of buzzwords.`,
    guidance:
      'Every headline must make a claim the product can defend. Avoid superlatives without proof.',
    suggestedApprovalMode: 'key',
  },
  {
    id: 'tpl_api_integration',
    name: 'API Integration Plan',
    description:
      'An implementation-ready plan for integrating a third-party API, including auth, data model, and edge cases.',
    category: 'Engineering',
    icon: 'git-network',
    objectiveTemplate: `Create an implementation plan for integrating [API / SERVICE] into [APPLICATION].

Stack: [stack]
Use case: [what the integration must accomplish]
Constraints: [rate limits, compliance, latency]

Include: integration architecture, authentication and secret handling, data model changes, endpoint mapping, retry and idempotency strategy, webhook handling, observability, testing strategy, and a phased rollout plan. Provide representative TypeScript interfaces and code sketches.`,
    guidance:
      'Prefer production-grade patterns. Call out rate limits, partial failure, and secret rotation explicitly.',
    suggestedApprovalMode: 'always',
  },
  {
    id: 'tpl_investor_update',
    name: 'Investor Update',
    description:
      'A candid monthly investor update with metrics narrative, wins, challenges, and asks.',
    category: 'Business',
    icon: 'trending-up',
    objectiveTemplate: `Write a monthly investor update for [COMPANY].

Period: [month]
Highlights: [highlights]
Lowlights: [lowlights]
Metrics: [metrics with numbers]
Cash and runway: [numbers]
Asks: [how investors can help]

Structure: subject line, TL;DR, key metrics table, wins, challenges and what changed, product and team updates, runway, and specific asks. Be direct and avoid spin.`,
    guidance:
      'Do not invent metrics. Use only provided numbers and flag missing ones as gaps to fill before sending.',
    suggestedApprovalMode: 'key',
  },
  {
    id: 'tpl_bug_triage',
    name: 'Bug Triage & Fix',
    description:
      'Root-cause analysis and a tested remediation plan for a production defect.',
    category: 'Engineering',
    icon: 'bug',
    objectiveTemplate: `Triage and fix the following production defect.

Symptoms: [what users see]
Environment: [stack, versions, platform]
Reproduction steps: [steps]
Recent changes: [changes]
Logs or errors: [logs]

Deliver: severity assessment, reproduction plan, hypotheses ranked by likelihood, root-cause analysis, a concrete fix with code, regression tests, rollback plan, and prevention measures.`,
    guidance:
      'Do not claim a root cause without evidence. Clearly separate confirmed findings from hypotheses.',
    suggestedApprovalMode: 'always',
  },
];

export const TEMPLATE_CATEGORIES = [
  'All',
  'Strategy',
  'Research',
  'Engineering',
  'Marketing',
  'Business',
] as const;
