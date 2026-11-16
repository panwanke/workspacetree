import { defineConfig } from 'vite';
import { sharedConfig } from './vite.shared.js';

export default defineConfig({
  ...sharedConfig,
  base: process.env.VITE_BASE_PATH || '/',
});
