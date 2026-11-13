import { describe, expect, it } from 'vitest';
import {
  approvalDecisionSchema,
  createRunSchema,
  estimateCost,
  finalDeliverableSchema,
  getModel,
  plannerOutputSchema,
  polisherOutputSchema,
  reviewOutputSchema,
  stageRequiresApproval,
} from '@nexus/shared';

describe('createRunSchema', () => {
  it('applies the default approval mode and trims input', () => {
    const parsed = createRunSchema.parse({
      objective: '  Produce a competitive analysis for the launch  ',
    });
    expect(parsed.approvalMode).toBe('key');
    expect(parsed.objective).toBe('Produce a competitive analysis for the launch');
  });

  it('rejects objectives that are too short', () => {
    expect(createRunSchema.safeParse({ objective: 'too short' }).success).toBe(false);
  });

  it('rejects an unknown approval mode', () => {
    const result = createRunSchema.safeParse({
      objective: 'Produce a competitive analysis for the launch',
      approvalMode: 'sometimes',
    });
    expect(result.success).toBe(false);
  });
});

describe('approvalDecisionSchema', () => {
  it('accepts approve and reject only', () => {
    expect(approvalDecisionSchema.safeParse({ decision: 'approve' }).success).toBe(true);
    expect(approvalDecisionSchema.safeParse({ decision: 'reject' }).success).toBe(true);
    expect(approvalDecisionSchema.safeParse({ decision: 'maybe' }).success).toBe(false);
  });
});

describe('plannerOutputSchema', () => {
  const step = {
    title: 'Research the market',
    description: 'Collect pricing and positioning for the top five competitors.',
    assigneeRole: 'worker',
    expectedOutput: 'A competitor comparison table',
  };

  it('defaults optional arrays', () => {
    const parsed = plannerOutputSchema.parse({
      summary: 'A focused plan for the launch.',
      approach: 'Research first, then draft and review the deliverable.',
      steps: [step, { ...step, title: 'Draft the brief' }],
    });
    expect(parsed.risks).toEqual([]);
    expect(parsed.steps[0]?.dependsOn).toEqual([]);
  });

  it('rejects plans with too few steps', () => {
    expect(
      plannerOutputSchema.safeParse({
        summary: 'A focused plan for the launch.',
        approach: 'Research first, then draft and review the deliverable.',
        steps: [step],
      }).success
    ).toBe(false);
  });

  it('rejects invalid assignee roles', () => {
    expect(
      plannerOutputSchema.safeParse({
        summary: 'A focused plan for the launch.',
        approach: 'Research first, then draft and review the deliverable.',
        steps: [step, { ...step, assigneeRole: 'intern' }],
      }).success
    ).toBe(false);
  });
});

describe('polisherOutputSchema', () => {
  const deliverable = {
    title: 'Mobile Gaming Startup — Business Plan',
    content: 'A detailed plan. '.repeat(10),
    summary: 'A seed-stage plan for a mid-core mobile studio.',
    sources: ['Market analysis'],
    unresolvedIssues: [],
  };

  it('validates only the fields the model owns', () => {
    const parsed = polisherOutputSchema.parse(deliverable);
    expect(parsed.sources).toEqual(['Market analysis']);
    expect(parsed).not.toHaveProperty('createdAt');
    expect(parsed).not.toHaveProperty('reviewScore');
  });

  it('rejects content that is too short', () => {
    expect(
      polisherOutputSchema.safeParse({ ...deliverable, content: 'Too short' }).success
    ).toBe(false);
  });

  it('requires server-owned provenance fields on the persisted deliverable', () => {
    expect(finalDeliverableSchema.safeParse(deliverable).success).toBe(false);
    expect(
      finalDeliverableSchema.safeParse({
        ...deliverable,
        reviewScore: 91,
        createdAt: new Date().toISOString(),
      }).success
    ).toBe(true);
  });
});

describe('reviewOutputSchema', () => {  it('accepts a valid review and defaults issue lists', () => {
    const parsed = reviewOutputSchema.parse({
      verdict: 'approve',
      score: 88,
      summary: 'The deliverable is complete and ready to ship.',
    });
    expect(parsed.issues).toEqual([]);
    expect(parsed.requiredChanges).toEqual([]);
  });

  it('rejects out-of-range scores', () => {
    expect(
      reviewOutputSchema.safeParse({
        verdict: 'approve',
        score: 120,
        summary: 'The deliverable is complete and ready to ship.',
      }).success
    ).toBe(false);
  });
});

describe('pricing', () => {
  it('computes cost from the model price table', () => {
    const model = getModel('gpt-4.1');
    expect(model).toBeDefined();
    const expected =
      (1_000_000 / 1_000_000) * model!.inputPrice +
      (500_000 / 1_000_000) * model!.outputPrice;
    expect(estimateCost('gpt-4.1', 1_000_000, 500_000)).toBeCloseTo(expected, 6);
  });

  it('returns zero for unknown models', () => {
    expect(estimateCost('does-not-exist', 1_000, 1_000)).toBe(0);
  });

  it('returns zero for zero usage', () => {
    expect(estimateCost('gpt-4.1', 0, 0)).toBe(0);
  });
});

describe('stageRequiresApproval', () => {
  it('never gates in auto mode', () => {
    expect(stageRequiresApproval('auto', 'plan')).toBe(false);
    expect(stageRequiresApproval('auto', 'work')).toBe(false);
    expect(stageRequiresApproval('auto', 'review')).toBe(false);
    expect(stageRequiresApproval('auto', 'polish')).toBe(false);
  });

  it('gates every decision point in always mode', () => {
    expect(stageRequiresApproval('always', 'plan')).toBe(true);
    expect(stageRequiresApproval('always', 'work')).toBe(true);
    expect(stageRequiresApproval('always', 'review')).toBe(true);
    expect(stageRequiresApproval('always', 'polish')).toBe(true);
  });

  it('gates only key milestones in key mode', () => {
    expect(stageRequiresApproval('key', 'plan')).toBe(true);
    expect(stageRequiresApproval('key', 'work')).toBe(false);
    expect(stageRequiresApproval('key', 'review')).toBe(true);
    expect(stageRequiresApproval('key', 'polish')).toBe(false);
  });
});
