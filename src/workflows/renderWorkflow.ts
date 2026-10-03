import { WorkflowEntrypoint, WorkflowEvent, WorkflowStep } from 'cloudflare:workers';
import { Env } from '../types';

type RenderParams = {
  projectId: string;
  prompt: string;
};

export class VideoRenderWorkflow extends WorkflowEntrypoint<Env, RenderParams> {
  async run(event: WorkflowEvent<RenderParams>, step: WorkflowStep) {
    const { projectId, prompt } = event.payload;

    // Bước 1: Tạo kịch bản
    const script = await step.do('generate-script', async () => {
      return await this.env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
        prompt: `Viết kịch bản video ngắn cho: ${prompt}`,
      });
    });

    // Bước 2: Cập nhật trạng thái D1
    await step.do('update-db-status', async () => {
      await this.env.DB.prepare('UPDATE projects SET status = ? WHERE id = ?')
        .bind('script_generated', projectId)
        .run();
    });

    return { success: true, projectId, script };
  }
}
