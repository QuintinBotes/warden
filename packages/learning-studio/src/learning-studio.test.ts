import { describe, it, expect } from 'vitest';
import { defineConfig, LearningModuleSchema, type TestExecution } from '@warden/core';
import { fixtureExecution, fakeProvider, type FakeProvider } from '@warden/core/testing';
import { createLearningStudio, type FfmpegRunner, type StudioWriter } from './index';

function fakeWriter() {
  const writes: { path: string; data: string }[] = [];
  const dirs: string[] = [];
  const writer: StudioWriter = {
    async mkdir(dir) {
      dirs.push(dir);
    },
    async writeFile(filePath, data) {
      writes.push({ path: filePath, data });
    },
  };
  return { writer, writes, dirs };
}

function fakeFfmpeg() {
  const calls: string[][] = [];
  const ffmpeg: FfmpegRunner = {
    async run(args) {
      calls.push(args);
    },
  };
  return { ffmpeg, calls };
}

const AUTHORED = {
  title: 'Checkout, explained',
  script: 'First we open the cart, then we complete the payment.',
  chapters: [
    { title: 'Open cart', atMs: 0 },
    { title: 'Pay', atMs: 5000 },
  ],
  article: '# Checkout\n\nA written walkthrough of the flow.',
};

function authoringProvider(): FakeProvider {
  return fakeProvider({
    toolCalls: [{ name: 'author_learning_module', input: AUTHORED }],
  });
}

function executionWithMedia(overrides: Partial<TestExecution> = {}): TestExecution {
  return fixtureExecution({
    id: 'EX-9',
    results: [
      {
        testCaseId: 'TC-checkout',
        status: 'PASS',
        duration: 1200,
        retries: 0,
        flakeFlag: false,
        videoPath: 'artifacts/checkout.webm',
        artifacts: [
          { type: 'video', path: 'artifacts/checkout.webm' },
          { type: 'screenshot', path: 'artifacts/checkout.png' },
        ],
      },
      {
        testCaseId: 'TC-failed',
        status: 'FAIL',
        duration: 10,
        retries: 0,
        flakeFlag: false,
      },
    ],
    ...overrides,
  });
}

describe('StudioLearningContentGenerator.generate', () => {
  it('returns [] and writes nothing when learningContent is disabled', async () => {
    const cfg = defineConfig({ learningContent: { enabled: false } });
    const { writer, writes, dirs } = fakeWriter();
    const { ffmpeg, calls } = fakeFfmpeg();
    const studio = createLearningStudio({ writer, ffmpeg });

    const modules = await studio.generate(executionWithMedia(), authoringProvider(), cfg);

    expect(modules).toEqual([]);
    expect(writes).toHaveLength(0);
    expect(dirs).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });

  it('produces a validated LearningModule per meaningful flow when enabled', async () => {
    const cfg = defineConfig({
      learningContent: { enabled: true, format: 'both', publishDir: 'out/learn' },
    });
    const { writer, writes } = fakeWriter();
    const { ffmpeg, calls } = fakeFfmpeg();
    const studio = createLearningStudio({ writer, ffmpeg });

    const modules = await studio.generate(executionWithMedia(), authoringProvider(), cfg);

    expect(modules).toHaveLength(1);
    const mod = modules[0]!;
    // Validates against the core schema.
    expect(() => LearningModuleSchema.parse(mod)).not.toThrow();

    expect(mod.sourceExecutionId).toBe('EX-9');
    expect(mod.flow).toBe('TC-checkout');
    expect(mod.title).toBe('Checkout, explained');
    expect(mod.script).toBe(AUTHORED.script);
    expect(mod.chapters).toEqual(AUTHORED.chapters);
    expect(mod.embedId).toMatch(/^embed-/);
    expect(mod.videoPath).toBe(`out/learn/${mod.embedId}.mp4`);
    expect(mod.transcriptPath).toBe(`out/learn/${mod.embedId}.transcript.txt`);
    expect(mod.articlePath).toBe(`out/learn/${mod.embedId}.article.md`);

    // ffmpeg stitched exactly one video for the flow.
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain(mod.videoPath);

    // The transcript file content is exactly the authored narration script.
    const transcript = writes.find((w) => w.path === mod.transcriptPath);
    expect(transcript?.data).toBe(AUTHORED.script);

    // The article file content is the authored article.
    const article = writes.find((w) => w.path === mod.articlePath);
    expect(article?.data).toBe(AUTHORED.article);
  });

  it('builds a deterministic embedId that is stable for the same execution + flow', async () => {
    const cfg = defineConfig({ learningContent: { enabled: true } });
    const studio = createLearningStudio({
      writer: fakeWriter().writer,
      ffmpeg: fakeFfmpeg().ffmpeg,
    });

    const first = await studio.generate(executionWithMedia(), authoringProvider(), cfg);
    const second = await studio.generate(executionWithMedia(), authoringProvider(), cfg);

    expect(first[0]!.embedId).toBe(second[0]!.embedId);
  });

  it('emits distinct embedIds for distinct flows in one execution', async () => {
    const cfg = defineConfig({ learningContent: { enabled: true } });
    const studio = createLearningStudio({
      writer: fakeWriter().writer,
      ffmpeg: fakeFfmpeg().ffmpeg,
    });

    const execution = fixtureExecution({
      id: 'EX-multi',
      results: [
        {
          testCaseId: 'TC-a',
          status: 'PASS',
          duration: 100,
          retries: 0,
          flakeFlag: false,
          videoPath: 'a.webm',
        },
        {
          testCaseId: 'TC-b',
          status: 'PASS',
          duration: 100,
          retries: 0,
          flakeFlag: false,
          screenshotPath: 'b.png',
        },
      ],
    });

    const modules = await studio.generate(execution, authoringProvider(), cfg);
    expect(modules).toHaveLength(2);
    expect(modules[0]!.embedId).not.toBe(modules[1]!.embedId);
    expect(modules.map((m) => m.flow)).toEqual(['TC-a', 'TC-b']);
  });

  it('honours format:"article" — writes an article, no video and no ffmpeg', async () => {
    const cfg = defineConfig({
      learningContent: { enabled: true, format: 'article', publishDir: 'out/a' },
    });
    const { writer, writes } = fakeWriter();
    const { ffmpeg, calls } = fakeFfmpeg();
    const studio = createLearningStudio({ writer, ffmpeg });

    const modules = await studio.generate(executionWithMedia(), authoringProvider(), cfg);

    const mod = modules[0]!;
    expect(calls).toHaveLength(0);
    expect(mod.videoPath).toBeUndefined();
    expect(mod.transcriptPath).toBeUndefined();
    expect(mod.articlePath).toBe(`out/a/${mod.embedId}.article.md`);
    expect(writes.map((w) => w.path)).toEqual([mod.articlePath]);
  });

  it('skips flows that neither passed nor captured media', async () => {
    const cfg = defineConfig({ learningContent: { enabled: true } });
    const studio = createLearningStudio({
      writer: fakeWriter().writer,
      ffmpeg: fakeFfmpeg().ffmpeg,
    });

    const execution = fixtureExecution({
      id: 'EX-empty',
      results: [
        // passed but no media
        { testCaseId: 'TC-nomedia', status: 'PASS', duration: 10, retries: 0, flakeFlag: false },
        // has media but failed
        {
          testCaseId: 'TC-fail',
          status: 'FAIL',
          duration: 10,
          retries: 0,
          flakeFlag: false,
          videoPath: 'x.webm',
        },
      ],
    });

    const modules = await studio.generate(execution, authoringProvider(), cfg);
    expect(modules).toEqual([]);
  });

  it('propagates ProviderError when the provider cannot author a script', async () => {
    const cfg = defineConfig({ learningContent: { enabled: true } });
    const studio = createLearningStudio({
      writer: fakeWriter().writer,
      ffmpeg: fakeFfmpeg().ffmpeg,
    });
    const emptyProvider = fakeProvider({ text: '' });

    await expect(studio.generate(executionWithMedia(), emptyProvider, cfg)).rejects.toMatchObject({
      code: 'E_PROVIDER',
    });
  });
});
