import { defineConfig } from 'tsup';
export default defineConfig({
  entry: { index: 'src/index.ts', sentinel: 'src/sentinel.css' },
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'es2022',
  external: ['react', 'react-dom', 'react/jsx-runtime'],
});
