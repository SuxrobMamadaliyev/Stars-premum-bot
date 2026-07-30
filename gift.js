// Telegram Bot API'ning sendGift / getAvailableGifts metodlari bilan ishlash.
// Telegraf 4.16.3 bu metodlarni hali typed holda bilmaydi, shu sabab
// ctx.telegram.callApi orqali xom (raw) chaqiruv qilamiz.

// Bot yubora oladigan barcha gift'lar ro'yxatini (narxi bilan) qaytaradi.
// Har bir element: { id, sticker, star_count, upgrade_star_count?, total_count?, remaining_count? }
async function getAvailableGifts(telegram) {
  const res = await telegram.callApi('getAvailableGifts', {});
  return res?.gifts || [];
}

// Bot balansidan foydalanuvchiga (yoki kanalga) gift yuboradi.
// params: { userId, chatId, giftId, text, payForUpgrade }
async function sendGift(telegram, { userId, chatId, giftId, text, payForUpgrade } = {}) {
  if (!userId && !chatId) {
    throw new Error('userId yoki chatId dan biri kerak');
  }
  const payload = { gift_id: giftId };
  if (userId) payload.user_id = userId;
  if (chatId) payload.chat_id = chatId;
  if (text) payload.text = text.slice(0, 128);
  if (payForUpgrade) payload.pay_for_upgrade = true;

  return telegram.callApi('sendGift', payload);
}

module.exports = { getAvailableGifts, sendGift };
