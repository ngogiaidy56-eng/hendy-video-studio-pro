import { Env } from '../types';

export async function transcribeAudio(env: Env, audioBuffer: ArrayBuffer) {
  const response = await env.AI.run('@cf/openai/whisper', {
    audio: Array.from(new Uint8Array(audioBuffer)),
  });
  return response;
}

export async function generateScript(env: Env, prompt: string) {
  const response = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
    prompt: `Viết kịch bản video ngắn dựa trên chủ đề: ${prompt}`,
  });
  return response;
}
