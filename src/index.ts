export interface Env {
  DB: D1Database;
  ASSETS_BUCKET: R2Bucket;
  AI: Ai;
  WEBSOCKET_SERVER: DurableObjectNamespace;
  RENDER_WORKFLOW: Workflow;
}

// ----------------------------------------------------
// 1. Worker Main Handler
// ----------------------------------------------------
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Xử lý CORS Preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
        },
      });
    }

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Content-Type": "application/json",
    };

    // Route: Trang chủ / Health check
    if (url.pathname === "/") {
      return new Response("Hendy Video Studio Pro API Active", {
        headers: { "Access-Control-Allow-Origin": "*" },
      });
    }

    // Route: Lấy danh sách dự án từ D1
    if (url.pathname === "/api/projects" && request.method === "GET") {
      const { results } = await env.DB.prepare(
        "SELECT * FROM projects ORDER BY created_at DESC"
      ).all();
      return new Response(JSON.stringify(results), { headers: corsHeaders });
    }

    // Route: Tạo dự án mới & kích hoạt Workflow Render
    if (url.pathname === "/api/render" && request.method === "POST") {
      const body = (await request.json()) as { title: string; prompt: string };
      const projectId = crypto.randomUUID();
      const jobId = crypto.randomUUID();

      // Lưu vào D1
      await env.DB.prepare(
        "INSERT INTO projects (id, title, prompt, status) VALUES (?, ?, ?, ?)"
      ).bind(projectId, body.title || "Untitled", body.prompt, "processing").run();

      await env.DB.prepare(
        "INSERT INTO render_jobs (id, project_id, status) VALUES (?, ?, ?)"
      ).bind(jobId, projectId, "processing").run();

      // Khởi chạy Workflow
      const instance = await env.RENDER_WORKFLOW.create({
        id: jobId,
        params: { projectId, prompt: body.prompt },
      });

      return new Response(
        JSON.stringify({ success: true, projectId, jobId, workflowId: instance.id }),
        { headers: corsHeaders }
      );
    }

    // Route: Upgrade kết nối WebSocket (Durable Object)
    if (url.pathname === "/ws") {
      const id = env.WEBSOCKET_SERVER.idFromName("global_room");
      const stub = env.WEBSOCKET_SERVER.get(id);
      return stub.fetch(request);
    }

    return new Response(JSON.stringify({ error: "Not Found" }), {
      status: 404,
      headers: corsHeaders,
    });
  },
};

// ----------------------------------------------------
// 2. Durable Object cho WebSocket Real-time
// ----------------------------------------------------
export class WebSocketServer {
  state: DurableObjectState;
  sessions: Set<WebSocket>;

  constructor(state: DurableObjectState) {
    this.state = state;
    this.sessions = new Set();
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    this.state.acceptWebSocket(server);
    this.sessions.add(server);

    server.addEventListener("message", (event) => {
      // Broadcast tin nhắn đến tất cả clients đang kết nối
      for (const session of this.sessions) {
        if (session.readyState === WebSocket.OPEN) {
          session.send(event.data);
        }
      }
    });

    server.addEventListener("close", () => {
      this.sessions.delete(server);
    });

    return new Response(null, { status: 101, webSocket: client });
  }
}

// ----------------------------------------------------
// 3. Workflow Render Video
// ----------------------------------------------------
import { WorkflowEntrypoint, WorkflowEvent, WorkflowStep } from "cloudflare:workers";

type RenderParams = { projectId: string; prompt: string };

export class VideoRenderWorkflow extends WorkflowEntrypoint<Env, RenderParams> {
  async run(event: WorkflowEvent<RenderParams>, step: WorkflowStep) {
    // Bước 1: Sinh kịch bản / Prompt bằng Workers AI
    const script = await step.do("generate-script", async () => {
      const response = await this.env.AI.run("@cf/meta/llama-3-8b-instruct", {
        messages: [{ role: "user", content: `Generate video scene script for: ${event.payload.prompt}` }],
      });
      return response;
    });

    // Bước 2: Giả lập xử lý Render
    await step.sleep("rendering-delay", "5 seconds");

    // Bước 3: Cập nhật trạng thái hoàn thành vào D1 Database
    await step.do("update-db-status", async () => {
      await this.env.DB.prepare(
        "UPDATE projects SET status = 'completed', updated_at = CURRENT_TIMESTAMP WHERE id = ?"
      ).bind(event.payload.projectId).run();

      await this.env.DB.prepare(
        "UPDATE render_jobs SET status = 'completed' WHERE project_id = ?"
      ).bind(event.payload.projectId).run();
    });

    return { success: true, result: script };
  }
}
