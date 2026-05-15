#!/usr/bin/env node
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const srcClient = path.join(root, 'src', 'client');
const dist = path.join(root, 'dist');

fs.mkdirSync(dist, { recursive: true });
fs.copyFileSync(path.join(srcClient, 'index.html'), path.join(dist, 'index.html'));

const watch = process.argv.includes('--watch');

const buildOptions = {
  entryPoints: [path.join(srcClient, 'main.js')],
  bundle: true,
  outfile: path.join(dist, 'bundle.js'),
  format: 'esm',
  target: ['es2020'],
  minify: !watch,
  sourcemap: watch,
  logLevel: 'info',
};

if (watch) {
  const ctx = await esbuild.context(buildOptions);
  await ctx.watch();
  fs.watch(path.join(srcClient, 'index.html'), () => {
    fs.copyFileSync(path.join(srcClient, 'index.html'), path.join(dist, 'index.html'));
    console.log('copied index.html');
  });
  console.log('watching...');
} else {
  await esbuild.build(buildOptions);
  console.log('built dist/');
}
