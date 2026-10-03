import { Env } from '../types';

export async function queryVectorContext(env: Env, queryVector: number[]) {
  const matches = await env.VECTOR_INDEX.query(queryVector, { topK: 5 });
  return matches;
}
