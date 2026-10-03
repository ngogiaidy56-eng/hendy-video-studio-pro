import { Env } from './types';
import { transcribeAudio } from './modules/ai';
import { createProject } from './modules/storage';

// BẮT BUỘC: Export các Class để Cloudflare khởi tạo Durable Object & Workflow
export { WebSocketServer } from './modules/websocket';
export { VideoRenderWorkflow } from './workflows/renderWorkflow';

// BẮT BUỘC: Cú pháp ES Modules Export Default
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // 1. WebSocket Endpoint
    if (url.pathname === '/ws') {
      const id = env.WEBSOCKET_SERVER.idFromName('global');
      const stub = env.WEBSOCKET_SERVER.get(id);
      return stub.fetch(request);
    }

    // 2. Transcribe Audio API
    if (url.pathname === '/api/ai/transcribe' && request.method === 'POST') {
      const audioBuffer = await request.arrayBuffer();
      const result = await transcribeAudio(env, audioBuffer);
      return Response.json({ success: true, result });
    }

    // 3. Render Workflow API
    if (url.pathname === '/api/render' && request.method === 'POST') {
      const body = (await request.json()) as { projectId: string; prompt: string };
      await createProject(env, body.projectId, body.prompt);

      const instance = await env.RENDER_WORKFLOW.create({
        params: { projectId: body.projectId, prompt: body.prompt },
      });

      return Response.json({ success: true, workflowId: instance.id });
    }

    return new Response('Hendy Video Studio Pro API Active', { status: 200 });
  },
};
