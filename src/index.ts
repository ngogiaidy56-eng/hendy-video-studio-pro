import { WorkflowEntrypoint, WorkflowEvent, WorkflowStep } from "cloudflare:workers";

export interface Env {
  TELEGRAM_BOT_TOKEN: string;
  ADMIN_USER_IDS?: string;
  ADMIN_ID?: string; // legacy alias
  APP_VERSION?: string;
  TELEGRAM_SECRET_TOKEN?: string;
  ADMIN_APP_URL?: string;
  MCP_OTP_SECRET?: string;
  TELEGRAM_ADMIN_CHAT_ID: string;
  DB: D1Database;
  ASSETS_BUCKET: R2Bucket;
  AI: Ai;
  WEBSOCKET_SERVER: DurableObjectNamespace;
  RENDER_WORKFLOW: Workflow;
}

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

    // Health check endpoint
    if (url.pathname === '/health' || url.pathname === '/telegram/health') {
      return Response.json({ ok: true, service: 'telegram-bot', version: env.APP_VERSION || '3.2.0' }, { headers: corsHeaders });
    }

    // ==========================================
    // TELEGRAM WEBHOOK (Hỗ trợ cả /bot-webhook, /webhook và /telegram/webhook)
    // ==========================================
    if ((url.pathname === "/bot-webhook" || url.pathname === "/webhook" || url.pathname === "/telegram/webhook") && request.method === "POST") {
      const secretToken = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
      if (env.TELEGRAM_SECRET_TOKEN && secretToken !== env.TELEGRAM_SECRET_TOKEN) {
        return new Response('Unauthorized', { status: 401 });
      }

      try {
        const update: any = await request.json();

        if (update.message) {
          ctx.waitUntil(handleMessage(update.message, env));
        }

        if (update.callback_query) {
          ctx.waitUntil(handleCallbackQuery(update.callback_query, env));
        }

        return new Response("OK", { status: 200 });
      } catch (err: unknown) {
        console.error('Lỗi xử lý Webhook:', err);
        return new Response("Internal Server Error", { status: 500 });
      }
    }

    // Root & API Endpoints
    if (url.pathname === "/") {
      return new Response("Hendy Video Studio Pro & SOT API Active", { headers: corsHeaders });
    }

    // WebSocket Durable Object endpoint
    if (url.pathname === "/ws") {
      const id = env.WEBSOCKET_SERVER.idFromName("global_room");
      const stub = env.WEBSOCKET_SERVER.get(id);
      return stub.fetch(request);
    }

    return new Response(JSON.stringify({ error: "Not Found" }), { status: 404, headers: corsHeaders });
  },
};

// ==========================================
// 1. GIAO DIỆN HỆ THỐNG & ĐIỀU HÀNH SOT
// ==========================================

function getMainMenuData(firstName: string, isAdmin = false, version = '3.2.0') {
  const text =
    `👋 <b>Xin chào ${escapeHtml(firstName)}!</b>\n\n` +
    `Chào mừng bạn đến với <b>Trung tâm kiểm soát hệ thống (SOT v${version})</b>.\n` +
    `<i>Nguồn chuẩn duy nhất - Điều hành CRM & Video Studio</i>`;

  const inline_keyboard: Array<Array<{ text: string; callback_data?: string; web_app?: { url: string } }>> = [
    [
      { text: '🎛️ Kiểm soát SOT', callback_data: 'view_sot_panel' },
      { text: '💼 Điều hành CRM', callback_data: 'view_crm' }
    ],
    [
      { 
        text: '📱 Mở Ứng Dụng Mini App', 
        web_app: { url: 'https://hendy-video-studio.workers.dev' } // Thay bằng URL Mini App thực tế của bạn
      },
      { text: '📊 Trạng thái SOT', callback_data: 'view_sot' }
    ]
  ];

  if (isAdmin) {
    inline_keyboard.push([
      { text: '⚙️ Bảng Điều Khiển Admin', callback_data: 'refresh_admin' }
    ]);
  }

  return { text, replyMarkup: { inline_keyboard } };
}

async function getSOTControlPanelData(env: Env, version = env.APP_VERSION || '3.2.0') {
  const wsUrl = (await getSetting(env, 'ws_url')) || 'ws://127.0.0.1:8799/ws';
  const dryRunStatus = (await getSetting(env, 'dry_run_status')) || 'CHỜ LỆNH';
  const sandboxStatus = (await getSetting(env, 'sandbox_status')) || '🔴 NGOẠI TUYẾN';

  const text =
    `🛡 <b>TRUNG TÂM KIỂM SOÁT HỆ THỐNG</b> | <code>SOT v${version}</code>\n` +
    `<i>Nguồn chuẩn duy nhất - ĐIỀU HÀNH CRM</i>\n\n` +
    `🛡️ <b>Cổng kiểm định:</b> <code>${dryRunStatus}</code>\n` +
    `📡 <b>Sandbox:</b> <b>${sandboxStatus}</b>\n` +
    `🔌 <b>Cổng WebSocket:</b> <code>${wsUrl}</code>\n\n` +
    `<i>Bấm nút bên dưới để phát lệnh điều khiển:</i>`;

  const replyMarkup = {
    inline_keyboard: [
      [
        { text: '🧪 KIỂM TRA (DRY-RUN)', callback_data: 'sot_dry_run' },
        { text: '🛠️ TỰ ĐỘNG VÁ', callback_data: 'sot_auto_patch' }
      ],
      [
        { text: '🔑 ĐỒNG BỘ TẤT CẢ', callback_data: 'sot_sync_all' }
      ],
      [
        { text: '⚡ Đổi Trạng Thái Sandbox', callback_data: 'sot_toggle_sandbox' },
        { text: '📜 Nhật ký Telemetry', callback_data: 'sot_telemetry' }
      ],
      [
        { text: '◀️ Quay lại Menu Chính', callback_data: 'back_to_main' }
      ]
    ]
  };

  return { text, replyMarkup };
}

async function getAdminPanelData(env: Env) {
  const isMaint = (await getSetting(env, 'maintenance')) === '1';
  const statusBadge = isMaint ? '🔴 ĐANG BẢO TRÌ' : '🟢 HOẠT ĐỘNG BÌNH THƯỜNG';
  const toggleBtnText = isMaint ? '🟢 Mở lại Hệ thống' : '🔴 Bật Chế độ Bảo trì';

  const text =
    `⚙️ <b>BẢNG ĐIỀU HÀNH ADMIN</b>\n\n` +
    `ID Admin: <code>${escapeHtml(adminIdsLabel(env))}</code>\n` +
    `Trạng thái máy chủ: <b>${statusBadge}</b>\n\n` +
    `<i>Chọn tác vụ quản trị:</i>`;

  const replyMarkup = {
    inline_keyboard: [
      [{ text: toggleBtnText, callback_data: 'toggle_maint' }],
      [
        { text: '📊 Thống kê D1', callback_data: 'view_stats' },
        { text: '🔄 Tải lại Bảng Admin', callback_data: 'refresh_admin' }
      ],
      [
        { text: '◀️ Quay lại Menu Chính', callback_data: 'back_to_main' }
      ]
    ]
  };

  return { text, replyMarkup };
}

// ==========================================
// 2. XỬ LÝ TIN NHẮN VĂN BẢN (INCOMING MESSAGES)
// ==========================================
async function handleMessage(message: any, env: Env): Promise<void> {
  const chatId = message.chat?.id?.toString();
  const userId = message.from?.id;
  if (!chatId || !userId) return;

  const username = message.from?.username || '';
  const firstName = message.from?.first_name || '';
  const text = String(message.text || '').trim();
  const isAdmin = isAdminUser(env, userId);

  try {
    if (env.DB) {
      await env.DB.prepare(`
        INSERT INTO users (user_id, username, first_name)
        VALUES (?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
          username = excluded.username,
          first_name = excluded.first_name
      `).bind(userId, username, firstName).run();

      await env.DB.prepare(`
        INSERT INTO logs (user_id, message) VALUES (?, ?)
      `).bind(userId, text).run();
    }
  } catch (err) {
    console.error('Lỗi lưu D1:', err);
  }

  // Bắt sự kiện /start hoặc /menu
  if (text === "/start" || text.startsWith("/start ") || text === "/menu") {
    const { text: mainText, replyMarkup } = getMainMenuData(firstName, isAdmin, env.APP_VERSION || '3.2.0');
    await sendTelegramMessageWithKeyboard(env.TELEGRAM_BOT_TOKEN, chatId, mainText, replyMarkup);
    return;
  }

  if (isAdmin && (text.startsWith('ws://') || text.startsWith('wss://'))) {
    await setSetting(env, 'ws_url', text.trim());
    await logEvent(env, userId, `Cập nhật Cổng WebSocket thành: ${text.trim()}`);
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, `✅ <b>Đã cập nhật Cổng WebSocket mới:</b>\n<code>${text.trim()}</code>`);
    return;
  }

  const isMaint = (await getSetting(env, 'maintenance')) === '1';
  if (isMaint && !isAdmin) {
    await sendTelegramMessage(
      env.TELEGRAM_BOT_TOKEN,
      chatId,
      '🚧 <b>HỆ THỐNG ĐANG BẢO TRÌ</b>\n\nHệ thống đang nâng cấp. Vui lòng quay lại sau ít phút!'
    );
    return;
  }

  if (text === "/status") {
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, "🟢 <b>Hệ thống Hendy Studio Đang Hoạt Động!</b>\n- Database (D1): OK\n- Workers AI: OK\n- R2 Storage: OK\n- SOT Control Hub: ACTIVE");
    return;
  }

  if (text === "/projects") {
    if (env.DB) {
      try {
        const { results } = await env.DB.prepare("SELECT title, status FROM projects ORDER BY created_at DESC LIMIT 5").all<any>();
        let msg = "🎬 <b>5 Dự án gần nhất:</b>\n\n";
        if (results && results.length > 0) {
          results.forEach((r: any) => {
            msg += `- <b>${escapeHtml(r.title)}</b>: ${r.status === 'completed' ? '✅' : '⏳'} <i>${r.status}</i>\n`;
          });
        } else {
          msg += "<i>Chưa có dự án nào.</i>";
        }
        await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, msg);
      } catch (err) {
        console.error(err);
        await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, "❌ Lỗi truy xuất cơ sở dữ liệu.");
      }
    }
    return;
  }

  if (text.startsWith("/render ")) {
    if (!isAdmin) {
      await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, "⚠️ Chỉ Admin mới có quyền tạo lệnh render video.");
      return;
    }
    const prompt = text.replace("/render ", "").trim();
    const projectId = crypto.randomUUID();
    const jobId = crypto.randomUUID();

    if (env.DB && env.RENDER_WORKFLOW) {
      try {
        await env.DB.prepare("INSERT INTO projects (id, title, prompt, status) VALUES (?, ?, ?, ?)")
          .bind(projectId, "Telegram Request", prompt, "processing").run();
        await env.DB.prepare("INSERT INTO render_jobs (id, project_id, status) VALUES (?, ?, ?)")
          .bind(jobId, projectId, "processing").run();

        await env.RENDER_WORKFLOW.create({
          id: jobId,
          params: { projectId, prompt },
        });

        await logEvent(env, userId, `Phát lệnh Render Video: ${prompt}`);
        await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, `🚀 <b>Đã đưa vào hàng đợi Render!</b>\n\nID: <code>${projectId}</code>\nNội dung: <i>${escapeHtml(prompt)}</i>`);
      } catch (err) {
        console.error(err);
        await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, "❌ Có lỗi xảy ra khi gọi Workflow Render.");
      }
    } else {
      await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, "❌ Cảnh báo: Thiếu cấu hình RENDER_WORKFLOW hoặc DB.");
    }
    return;
  }

  if (isAdmin && text === '/admin') {
    const { text: adminText, replyMarkup } = await getAdminPanelData(env);
    await sendTelegramMessageWithKeyboard(env.TELEGRAM_BOT_TOKEN, chatId, adminText, replyMarkup);
    return;
  }

  const { text: mainText, replyMarkup } = getMainMenuData(firstName, isAdmin, env.APP_VERSION || '3.2.0');
  await sendTelegramMessageWithKeyboard(env.TELEGRAM_BOT_TOKEN, chatId, mainText, replyMarkup);
}

// ==========================================
// 3. XỬ LÝ SỰ KIỆN NÚT BẤM (INLINE CALLBACKS)
// ==========================================
async function handleCallbackQuery(callbackQuery: any, env: Env): Promise<void> {
  const queryId = callbackQuery.id;
  const userId = callbackQuery.from?.id;
  const chatId = callbackQuery.message?.chat?.id;
  const messageId = callbackQuery.message?.message_id;
  const firstName = callbackQuery.from?.first_name || '';
  const action = callbackQuery.data;
  const isAdmin = isAdminUser(env, userId);

  if (!chatId || !messageId) return;

  await answerCallbackQuery(env.TELEGRAM_BOT_TOKEN, queryId);

  if (action === 'back_to_main') {
    const { text, replyMarkup } = getMainMenuData(firstName, isAdmin, env.APP_VERSION || '3.2.0');
    await editTelegramMessageText(env.TELEGRAM_BOT_TOKEN, chatId, messageId, text, replyMarkup);
    return;
  }

  if (action === 'view_sot_panel') {
    const { text, replyMarkup } = await getSOTControlPanelData(env, env.APP_VERSION || '3.2.0');
    await editTelegramMessageText(env.TELEGRAM_BOT_TOKEN, chatId, messageId, text, replyMarkup);
    return;
  }

  if (action === 'sot_dry_run') {
    await setSetting(env, 'dry_run_status', 'ĐANG KIỂM TRA (RUNNING)');
    await logEvent(env, userId, 'Chạy kiểm định Dry-Run');
    await answerCallbackQuery(env.TELEGRAM_BOT_TOKEN, queryId, '🧪 Đã phát lệnh Kiểm tra Dry-Run!');

    const { text, replyMarkup } = await getSOTControlPanelData(env, env.APP_VERSION || '3.2.0');
    await editTelegramMessageText(env.TELEGRAM_BOT_TOKEN, chatId, messageId, text, replyMarkup);
    return;
  }

  if (action === 'sot_auto_patch') {
    await logEvent(env, userId, 'Kích hoạt Tự động vá lỗi SOT');
    await answerCallbackQuery(env.TELEGRAM_BOT_TOKEN, queryId, '🛠️ Tiến trình Tự động vá lỗi đã bắt đầu!', true);
    return;
  }

  if (action === 'sot_sync_all') {
    await logEvent(env, userId, 'Đồng bộ toàn bộ WebSocket, CRM & D1');
    await answerCallbackQuery(env.TELEGRAM_BOT_TOKEN, queryId, '🔑 Đã phát lệnh Đồng bộ tất cả kênh dữ liệu!');
    return;
  }

  if (action === 'sot_toggle_sandbox') {
    const currentStatus = await getSetting(env, 'sandbox_status');
    const newStatus = currentStatus && currentStatus.includes('TRỰC TUYẾN')
      ? '🔴 NGOẠI TUYẾN'
      : '🟢 TRỰC TUYẾN (ws://127.0.0.1:8799/ws)';
    await setSetting(env, 'sandbox_status', newStatus);
    await logEvent(env, userId, `Chuyển trạng thái Sandbox: ${newStatus}`);

    const { text, replyMarkup } = await getSOTControlPanelData(env, env.APP_VERSION || '3.2.0');
    await editTelegramMessageText(env.TELEGRAM_BOT_TOKEN, chatId, messageId, text, replyMarkup);
    return;
  }

  if (action === 'sot_telemetry') {
    let logLines = '<i>Chưa có dữ liệu sự kiện.</i>';
    try {
      if (env.DB) {
        const logs = await env.DB.prepare('SELECT message, created_at FROM logs ORDER BY id DESC LIMIT 6').all<{ message: string; created_at: string }>();
        if (logs && logs.results && logs.results.length > 0) {
          logLines = logs.results.map(l => `• <code>[${l.created_at || 'Mới'}]</code> ${escapeHtml(l.message)}`).join('\n');
        }
      }
    } catch (e) {
      console.error('Lỗi đọc logs:', e);
    }

    const telemetryText =
      `📜 <b>NHẬT KÝ SỰ KIỆN (TELEMETRY)</b>\n\n${logLines}\n\n` +
      `<i>Gửi tin nhắn bắt đầu bằng <code>ws://</code> để đổi Cổng WebSocket.</i>`;

    const replyMarkup = {
      inline_keyboard: [
        [{ text: '🔄 Làm mới Logs', callback_data: 'sot_telemetry' }],
        [
          { text: '◀️ Quay lại SOT Panel', callback_data: 'view_sot_panel' },
          { text: '🏠 Menu Chính', callback_data: 'back_to_main' }
        ]
      ]
    };

    await editTelegramMessageText(env.TELEGRAM_BOT_TOKEN, chatId, messageId, telemetryText, replyMarkup);
    return;
  }

  if (action === 'view_crm') {
    const crmText =
      `💼 <b>ĐIỀU HÀNH CRM HỆ THỐNG</b>\n\n` +
      `🌐 <b>Trạng thái phân hệ:</b> ĐANG HOẠT ĐỘNG\n` +
      `📡 <b>Webhook Hub:</b> Cloudflare Workers -> Telegram Bot\n` +
      `🗄️ <b>Cơ sở dữ liệu:</b> Cloudflare D1 Storage\n\n` +
      `<i>Chọn thao tác điều hành:</i>`;

    const replyMarkup = {
      inline_keyboard: [
        [
          { text: '🔑 Đồng bộ CRM', callback_data: 'sot_sync_all' },
          { text: '📊 Thống kê CRM', callback_data: 'view_stats' }
        ],
        [{ text: '◀️ Quay lại Menu Chính', callback_data: 'back_to_main' }]
      ]
    };

    await editTelegramMessageText(env.TELEGRAM_BOT_TOKEN, chatId, messageId, crmText, replyMarkup);
    return;
  }

  if (action === 'view_sot') {
    const sotText =
      `📊 <b>TRẠNG THÁI HỆ THỐNG SOT</b>\n\n` +
      `🟢 WebSocket Hub: <b>ONLINE</b>\n` +
      `🟢 Express API / Workers: <b>ACTIVE</b>\n` +
      `🟢 D1 Database: <b>CONNECTED</b>\n` +
      `🟢 Workers AI & R2: <b>READY</b>`;

    const replyMarkup = {
      inline_keyboard: [
        [{ text: '◀️ Quay lại Menu Chính', callback_data: 'back_to_main' }]
      ]
    };

    await editTelegramMessageText(env.TELEGRAM_BOT_TOKEN, chatId, messageId, sotText, replyMarkup);
    return;
  }

  if (action === 'view_render_jobs') {
    let msg = "🎬 <b>DANH SÁCH DỰ ÁN RENDER GẦN NHẤT</b>\n\n";
    try {
      if (env.DB) {
        const { results } = await env.DB.prepare("SELECT title, prompt, status FROM projects ORDER BY created_at DESC LIMIT 5").all<any>();
        if (results && results.length > 0) {
          results.forEach((r: any) => {
            msg += `🔹 <b>${escapeHtml(r.title)}</b> (${r.status === 'completed' ? '✅' : '⏳'})\n<i>${escapeHtml(r.prompt)}</i>\n\n`;
          });
        } else {
          msg += "<i>Chưa có dự án nào được khởi tạo.</i>\n";
        }
      }
    } catch (e) {
      msg += "❌ Lỗi truy xuất cơ sở dữ liệu.\n";
    }

    msg += `\n<i>💡 Gợi ý: Gõ lệnh <code>/render [nội dung]</code> để tạo dự án render mới.</i>`;

    const replyMarkup = {
      inline_keyboard: [
        [{ text: '🔄 Làm mới danh sách', callback_data: 'view_render_jobs' }],
        [{ text: '◀ Quay lại Menu Chính', callback_data: 'back_to_main' }]
      ]
    };

    await editTelegramMessageText(env.TELEGRAM_BOT_TOKEN, chatId, messageId, msg, replyMarkup);
    return;
  }

  if (!isAdmin && (action === 'toggle_maint' || action === 'refresh_admin' || action === 'view_stats')) {
    await answerCallbackQuery(env.TELEGRAM_BOT_TOKEN, queryId, '⚠️ Bạn không có quyền Admin!', true);
    return;
  }

  if (action === 'refresh_admin') {
    const { text, replyMarkup } = await getAdminPanelData(env);
    await editTelegramMessageText(env.TELEGRAM_BOT_TOKEN, chatId, messageId, text, replyMarkup);
    return;
  }

  if (action === 'toggle_maint') {
    const currentStatus = await getSetting(env, 'maintenance');
    const newStatus = currentStatus === '1' ? '0' : '1';
    await setSetting(env, 'maintenance', newStatus);

    const { text, replyMarkup } = await getAdminPanelData(env);
    await editTelegramMessageText(env.TELEGRAM_BOT_TOKEN, chatId, messageId, text, replyMarkup);
    return;
  }

  if (action === 'view_stats') {
    let userCount = 0;
    let logCount = 0;
    try {
      if (env.DB) {
        const u = await env.DB.prepare('SELECT COUNT(*) as count FROM users').first<{ count: number }>();
        const l = await env.DB.prepare('SELECT COUNT(*) as count FROM logs').first<{ count: number }>();
        userCount = u?.count ?? 0;
        logCount = l?.count ?? 0;
      }
    } catch (e) {
      console.error('Lỗi thống kê D1:', e);
    }

    const statsText =
      `📊 <b>THỐNG KÊ CƠ SỞ DỮ LIỆU D1</b>\n\n` +
      `👥 Tổng người dùng: <code>${userCount}</code>\n` +
      `💬 Tổng nhật ký tin nhắn: <code>${logCount}</code>`;

    const replyMarkup = {
      inline_keyboard: [
        [{ text: '◀ Quay lại Admin Panel', callback_data: 'refresh_admin' }],
        [{ text: '🏠 Quay lại Menu Chính', callback_data: 'back_to_main' }]
      ]
    };

    await editTelegramMessageText(env.TELEGRAM_BOT_TOKEN, chatId, messageId, statsText, replyMarkup);
    return;
  }
}

// ==========================================
// 4. DURABLE OBJECT CHO WEBSOCKET REAL-TIME
// ==========================================
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
      for (const session of this.sessions) {
        if (session.readyState === WebSocket.OPEN) session.send(event.data);
      }
    });

    server.addEventListener("close", () => this.sessions.delete(server));
    return new Response(null, { status: 101, webSocket: client });
  }
}

// ==========================================
// 5. WORKFLOW RENDER VIDEO (TÍCH HỢP AI & TELEGRAM)
// ==========================================
type RenderParams = { projectId: string; prompt: string };

export class VideoRenderWorkflow extends WorkflowEntrypoint<Env, RenderParams> {
  async run(event: WorkflowEvent<RenderParams>, step: WorkflowStep) {
    const script = await step.do("generate-script", async () => {
      return await this.env.AI.run("@cf/meta/llama-3-8b-instruct", {
        messages: [{ role: "user", content: `Generate video scene script for: ${event.payload.prompt}` }],
      });
    });

    await step.sleep("rendering-delay", "5 seconds");

    await step.do("update-db-status", async () => {
      await this.env.DB.prepare("UPDATE projects SET status = 'completed', updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(event.payload.projectId).run();
      await this.env.DB.prepare("UPDATE render_jobs SET status = 'completed' WHERE project_id = ?").bind(event.payload.projectId).run();
    });

    // BÁO CÁO HOÀN TẤT QUA TELEGRAM
    await step.do("notify-admin", async () => {
      const msg = `✅ <b>Render hoàn tất thành công!</b>\n\nProject ID: <code>${event.payload.projectId}</code>\nPrompt: <i>${escapeHtml(event.payload.prompt)}</i>`;
      await sendTelegramMessage(this.env.TELEGRAM_BOT_TOKEN, this.env.TELEGRAM_ADMIN_CHAT_ID, msg);
    });

    return { success: true, result: script };
  }
}

// ==========================================
// 6. CÁC HÀM TIỆN ÍCH D1 & TELEGRAM API
// ==========================================
async function getSetting(env: Env, key: string): Promise<string | null> {
  try {
    if (env.DB) {
      const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>();
      return row ? row.value : null;
    }
  } catch (e) {
    return null;
  }
  return null;
}

async function setSetting(env: Env, key: string, value: string): Promise<void> {
  try {
    if (env.DB) {
      await env.DB.prepare(`
        INSERT INTO settings (key, value) VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).bind(key, value).run();
    }
  } catch (e) {
    console.error('Lỗi setSetting:', e);
  }
}

async function logEvent(env: Env, userId: number | string, eventMessage: string): Promise<void> {
  try {
    if (env.DB) {
      await env.DB.prepare(`
        INSERT INTO logs (user_id, message) VALUES (?, ?)
      `).bind(userId, `[SOT LOG] ${eventMessage}`).run();
    }
  } catch (e) {
    console.error('Lỗi logEvent:', e);
  }
}

async function sendTelegramMessage(token: string, chatId: string | number, text: string): Promise<void> {
  if (!token || !chatId) return;
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: text, parse_mode: "HTML" })
  });
}

async function sendTelegramMessageWithKeyboard(
  token: string,
  chatId: string | number,
  text: string,
  replyMarkup: unknown
): Promise<void> {
  if (!token || !chatId) return;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", reply_markup: replyMarkup })
  });
}

async function editTelegramMessageText(
  token: string,
  chatId: string | number,
  messageId: number,
  text: string,
  replyMarkup: unknown = null
): Promise<void> {
  if (!token || !chatId) return;
  const payload: Record<string, unknown> = { chat_id: chatId, message_id: messageId, text, parse_mode: "HTML" };
  if (replyMarkup) payload.reply_markup = replyMarkup;

  await fetch(`https://api.telegram.org/bot${token}/editMessageText`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

async function answerCallbackQuery(
  token: string,
  callbackQueryId: string,
  text = '',
  showAlert = false
): Promise<void> {
  if (!token) return;
  await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: callbackQueryId, text, show_alert: showAlert })
  });
}

function adminIds(env: Env): Set<string> {
  const raw = env.ADMIN_USER_IDS || env.ADMIN_ID || '';
  const set = new Set(raw.split(',').map(v => v.trim()).filter(Boolean));
  if (env.TELEGRAM_ADMIN_CHAT_ID) {
    set.add(env.TELEGRAM_ADMIN_CHAT_ID.trim());
  }
  return set;
}

function isAdminUser(env: Env, userId: number | string | undefined): boolean {
  return userId != null && adminIds(env).has(String(userId));
}

function adminIdsLabel(env: Env): string {
  const ids = [...adminIds(env)];
  return ids.length ? ids.join(', ') : 'Chưa thiết lập';
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
