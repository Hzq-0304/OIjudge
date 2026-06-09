import { readFileSync } from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { t } from '../src/i18n';

const extensionSource = readFileSync(path.resolve(__dirname, '..', 'src', 'extension.ts'), 'utf8');

describe('generator sample input generation flow', () => {
  it('does not open generated sample inputs automatically', () => {
    const generateFlow = extensionSource.slice(
      extensionSource.indexOf('async function generateInputFromGenerator'),
      extensionSource.indexOf('async function resolveGeneratorForSubtask')
    );

    expect(generateFlow).toContain('askSampleInputGenerateCount');
    expect(generateFlow).not.toContain('openFileInEditor');
    expect(generateFlow).not.toContain('showTextDocument');
  });

  it('has localized batch generation prompts and summaries', () => {
    expect(t('generator.input.count.prompt')).toBeTruthy();
    expect(t('generator.input.count.placeholder')).toBeTruthy();
    expect(t('generator.input.count.invalid')).toBeTruthy();
    expect(t('generator.input.count.tooLarge', { max: 100 })).toContain('100');
    expect(t('generator.input.generatedMany', { count: 5 })).toContain('5');
    expect(t('generator.input.generatedPartial', { count: 2 })).toContain('2');
    expect(t('generator.input.generatingProgress', { current: 3, total: 10 })).toContain('3');
  });
});
