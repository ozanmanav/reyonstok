import { spawn, type ChildProcess } from 'node:child_process';
import type { TestProject } from 'vitest/node';

/**
 * HTTP testleri için tek paylaşımlı geliştirme sunucusu.
 *
 * Her test dosyasının kendi sunucusunu başlatması çalışmıyor: iki `next dev`
 * süreci aynı `.next` dizinini paylaşınca birbirini bozuyor ve ikincisi ayağa
 * kalkamıyor. Sunucuyu burada bir kez başlatıp adresini testlere `provide` ile
 * geçiriyoruz.
 */

const PORT = 3123;
const BASE_URL = `http://127.0.0.1:${PORT}`;

async function waitForServer(timeoutMs = 120_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = '';

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE_URL}/login`, { signal: AbortSignal.timeout(5000) });
      if (response.status === 200) {
        return;
      }

      lastError = `beklenmeyen durum kodu: ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`Geliştirme sunucusu ayağa kalkmadı (${lastError})`);
}

export default async function setup(project: TestProject) {
  const server: ChildProcess = spawn('npx', ['next', 'dev', '--port', String(PORT)], {
    cwd: process.cwd(),
    env: { ...process.env, NODE_ENV: 'development' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  // Sunucu hiç açılmazsa hata mesajını görebilmek için çıktıyı biriktiriyoruz.
  let output = '';
  server.stdout?.on('data', (chunk) => {
    output += String(chunk);
  });
  server.stderr?.on('data', (chunk) => {
    output += String(chunk);
  });

  try {
    await waitForServer();
  } catch (error) {
    server.kill('SIGTERM');
    console.error('Sunucu çıktısı:\n', output.slice(-2000));
    throw error;
  }

  project.provide('baseUrl', BASE_URL);

  return () => {
    server.kill('SIGTERM');
  };
}
