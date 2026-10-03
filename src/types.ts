export interface Env {
  AI: Ai;
  DB: D1Database;
  ASSETS_BUCKET: R2Bucket;
  VECTOR_INDEX: VectorizeIndex;
  WEBSOCKET_SERVER: DurableObjectNamespace;
  RENDER_WORKFLOW: Workflow;
}
