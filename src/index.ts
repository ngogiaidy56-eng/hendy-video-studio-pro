function getMainMenuData(firstName: string, isAdmin = false, version = '3.2.0') {
  const text =
    `👋 <b>Xin chào ${escapeHtml(firstName)}!</b>\n\n` +
    `Chào mừng bạn đến với <b>Trung tâm kiểm soát hệ thống (SOT v${version})</b>.\n` +
    `<i>Nguồn chuẩn duy nhất - Điều hành CRM & Video Studio</i>`;

  const colors = ['primary', 'success', 'danger'];
  const randomStyle = () => colors[Math.floor(Math.random() * colors.length)];

  // Khai báo cấu trúc mảng inline_keyboard rõ kiểu dữ liệu để tránh lỗi biên dịch TypeScript
  const inline_keyboard: Array<Array<{ text: string; callback_data?: string; web_app?: { url: string }; style?: string }>> = [
    [
      { text: '🎛️ Kiểm soát SOT', callback_data: 'view_sot_panel', style: randomStyle() },
      { text: '💼 Điều hành CRM', callback_data: 'view_crm', style: randomStyle() }
    ],
    [
      // Nút mở Telegram Mini App trực tiếp trong khung chat Telegram
      { 
        text: '📱 Mở Ứng Dụng Mini App', 
        web_app: { url: 'https://hendy-video-studio.workers.dev' } // Thay bằng URL Mini App / Frontend thực tế của bạn
      },
      { text: '📊 Trạng thái SOT', callback_data: 'view_sot', style: randomStyle() }
    ]
  ];

  if (isAdmin) {
    inline_keyboard.push([
      { text: '⚙️ Bảng Điều Khiển Admin', callback_data: 'refresh_admin', style: 'danger' }
    ]);
  }

  // QUAN TRỌNG: Trả về object thuần (không dùng JSON.stringify ở đây) 
  // vì các hàm fetch gửi đi đã tự động thực hiện JSON.stringify(payload)
  return { 
    text, 
    replyMarkup: { inline_keyboard } 
  };
}
