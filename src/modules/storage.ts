import { Env } from '../types';

export async function createProject(env: Env, id: string, title: string) {
  await env.DB.prepare('INSERT INTO projects (id, title, status) VALUES (?, ?, ?)')
    .bind(id, title, 'created')
    .run();
}

export async function saveToR2(env: Env, key: string, data: ArrayBuffer, contentType: string) {
  await env.ASSETS_BUCKET.put(key, data, {
    httpMetadata: { contentType },
  });
}
