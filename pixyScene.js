const { Scenes, Markup } = require('telegraf');
const { User, DigitalOrder } = require('./models');
const { getSetting } = require('./settings');
const {
  backToMain,
  safeEdit,
  styledButton,
  starsAmountKeyboard,
  premiumMonthsKeyboard,
  pixyRecipientKeyboard,
  pixyConfirmKeyboard,
} = require('./keyboards');
const pixyApi = require('./pixyApi');
const { tryGrantReferralPurchasePoints } = require('./referral');

// Har bir foydalanuvchi uchun joriy holat: { type, quantity, priceUZS, recipient, step }
const waiting = {};

async function showStarsMenu(ctx) {
  const pricePerStar = await getSetting('stars_price_uzs');
  waiting[ctx.from.id] = { type: 'stars', step: 'choose_amount' };
  const text =
    `⭐ <b>Telegram Stars olish</b>\n\n` +
    `ℹ️ Narx: 1 ⭐ = <b>${pricePerStar.toLocaleString()} so'm</b>\n\n` +
    `Miqdorni tanlang:`;
  if (ctx.callbackQuery) {
    await safeEdit(ctx, text, { parse_mode: 'HTML', ...starsAmountKeyboard(pricePerStar) });
  } else {
    await ctx.reply(text, { parse_mode: 'HTML', ...starsAmountKeyboard(pricePerStar) });
  }
}

async function showPremiumMenu(ctx) {
  const prices = await getSetting('premium_prices');
  waiting[ctx.from.id] = { type: 'premium', step: 'choose_months' };
  const text =
    `💎 <b>Telegram Premium olish</b>\n\n` +
    `Muddatni tanlang:`;
  if (ctx.callbackQuery) {
    await safeEdit(ctx, text, { parse_mode: 'HTML', ...premiumMonthsKeyboard(prices) });
  } else {
    await ctx.reply(text, { parse_mode: 'HTML', ...premiumMonthsKeyboard(prices) });
  }
}

async function askRecipient(ctx) {
  const w = waiting[ctx.from.id];
  w.step = 'recipient';
  const label = w.type === 'stars' ? `⭐ ${w.quantity} Stars` : `💎 Premium ${w.quantity} oy`;
  await safeEdit(ctx,
    `👤 <b>Qabul qiluvchi</b>\n\n` +
    `${label} — <b>${w.priceUZS.toLocaleString()} so'm</b>\n\n` +
    `Kimga yubormoqchisiz? Telegram username kiriting (masalan: <code>@someone</code>) ` +
    `yoki pastdagi tugmani bosing.`,
    { parse_mode: 'HTML', ...pixyRecipientKeyboard(ctx.from.username) }
  );
}

async function showConfirm(ctx) {
  const w = waiting[ctx.from.id];
  w.step = 'confirm';
  const user = await User.findOne({ telegramId: ctx.from.id });
  const label = w.type === 'stars' ? `⭐ ${w.quantity} Stars` : `💎 Telegram Premium — ${w.quantity} oy`;
  await ctx.reply(
    `🧾 <b>Buyurtmani tasdiqlang</b>\n\n` +
    `${label}\n` +
    `👤 Qabul qiluvchi: <b>@${w.recipient}</b>\n` +
    `💰 Narx: <b>${w.priceUZS.toLocaleString()} so'm</b>\n` +
    `👛 Joriy balans: <b>${(user?.balance || 0).toLocaleString()} so'm</b>`,
    { parse_mode: 'HTML', ...pixyConfirmKeyboard() }
  );
}

async function processPurchase(ctx) {
  const w = waiting[ctx.from.id];
  delete waiting[ctx.from.id];

  const user = await User.findOne({ telegramId: ctx.from.id });
  if (!user || (user.balance || 0) < w.priceUZS) {
    return ctx.reply(
      `❌ Balansingiz yetarli emas.\n👛 Joriy balans: ${(user?.balance || 0).toLocaleString()} so'm\n💰 Kerak: ${w.priceUZS.toLocaleString()} so'm`,
      backToMain()
    );
  }

  // Avval balansdan yechamiz (atomik: faqat yetarli balans bo'lsa)
  const deducted = await User.findOneAndUpdate(
    { telegramId: ctx.from.id, balance: { $gte: w.priceUZS } },
    { $inc: { balance: -w.priceUZS, totalSpent: w.priceUZS } },
    { new: true }
  );
  if (!deducted) {
    return ctx.reply('❌ Balansingiz yetarli emas.', backToMain());
  }
  await tryGrantReferralPurchasePoints(ctx.from.id, ctx.telegram);

  const order = await DigitalOrder.create({
    telegramId: ctx.from.id,
    type: w.type,
    recipientUsername: w.recipient,
    quantity: w.quantity,
    priceUZS: w.priceUZS,
    status: 'pending',
  });

  const waitMsg = await ctx.reply('⏳ Buyurtma Pixy API orqali yuborilmoqda...');

  try {
    const result = w.type === 'stars'
      ? await pixyApi.buyStars(w.recipient, w.quantity)
      : await pixyApi.buyPremium(w.recipient, w.quantity);

    if (!result.success) {
      throw new Error(result.message || 'Pixy API buyurtmani rad etdi.');
    }

    order.status = 'success';
    order.providerOrderId = result.orderId || '';
    await order.save();

    const label = w.type === 'stars' ? `⭐ ${w.quantity} Stars` : `💎 Telegram Premium — ${w.quantity} oy`;
    const costLine = result.costTon ? `\n💎 Pixy xarajati: ~${result.costTon} TON` : '';
    await ctx.telegram.editMessageText(
      ctx.chat.id, waitMsg.message_id, undefined,
      `✅ <b>Muvaffaqiyatli yuborildi!</b>\n\n${label}\n👤 @${w.recipient} ga yetkazildi.\n💰 Yechildi: ${w.priceUZS.toLocaleString()} so'm${costLine}`,
      { parse_mode: 'HTML' }
    ).catch(() => {});
    await ctx.reply('🏠 Bosh menyu:', backToMain());
  } catch (e) {
    // Xato bo'lsa — pulni foydalanuvchiga qaytaramiz
    order.status = 'failed';
    order.error = e.message;
    await order.save();

    await User.findOneAndUpdate(
      { telegramId: ctx.from.id },
      { $inc: { balance: w.priceUZS, totalSpent: -w.priceUZS } }
    );

    await ctx.telegram.editMessageText(
      ctx.chat.id, waitMsg.message_id, undefined,
      `❌ <b>Xatolik yuz berdi:</b> ${e.message}\n\n💰 Pulingiz balansingizga qaytarildi.`,
      { parse_mode: 'HTML' }
    ).catch(() => {});
    await ctx.reply('🏠 Bosh menyu:', backToMain());
  }
}

function pixyScene() {
  const scene = new Scenes.BaseScene('pixy_flow');

  scene.enter(async ctx => {
    const type = ctx.scene.state?.type;
    if (type === 'premium') return showPremiumMenu(ctx);
    return showStarsMenu(ctx);
  });

  scene.on('callback_query', async (ctx, next) => {
    const data = ctx.callbackQuery.data;
    const w = waiting[ctx.from.id];

    if (data === 'back_main') {
      await ctx.answerCbQuery();
      delete waiting[ctx.from.id];
      return ctx.scene.leave();
    }

    const starsMatch = data.match(/^pixy_stars_amt_(\d+)$/);
    if (starsMatch) {
      await ctx.answerCbQuery();
      const pricePerStar = await getSetting('stars_price_uzs');
      const amount = parseInt(starsMatch[1], 10);
      waiting[ctx.from.id] = { type: 'stars', quantity: amount, priceUZS: amount * pricePerStar, step: 'recipient' };
      return askRecipient(ctx);
    }

    if (data === 'pixy_stars_custom') {
      await ctx.answerCbQuery();
      waiting[ctx.from.id] = { type: 'stars', step: 'custom_amount' };
      return safeEdit(ctx,
        `✏️ Nechta Stars sotib olmoqchisiz? Sonini kiriting (masalan: <code>150</code>)`,
        { parse_mode: 'HTML', ...Markup.inlineKeyboard([[styledButton('❌ Bekor', 'back_main', 'danger')]]) }
      );
    }

    const premiumMatch = data.match(/^pixy_premium_m_(\d+)$/);
    if (premiumMatch) {
      await ctx.answerCbQuery();
      const prices = await getSetting('premium_prices');
      const months = premiumMatch[1];
      const price = prices[months];
      if (!price) return ctx.answerCbQuery('❌ Bu muddat uchun narx sozlanmagan.', { show_alert: true });
      waiting[ctx.from.id] = { type: 'premium', quantity: parseInt(months, 10), priceUZS: price, step: 'recipient' };
      return askRecipient(ctx);
    }

    if (data === 'pixy_recipient_self') {
      await ctx.answerCbQuery();
      if (!w || w.step !== 'recipient') return;
      if (!ctx.from.username) {
        return ctx.answerCbQuery('❌ Sizda Telegram username o\'rnatilmagan.', { show_alert: true });
      }
      w.recipient = ctx.from.username;
      return showConfirm(ctx);
    }

    if (data === 'pixy_confirm') {
      await ctx.answerCbQuery();
      if (!w || w.step !== 'confirm') return;
      return processPurchase(ctx);
    }

    return next();
  });

  scene.on('text', async ctx => {
    const w = waiting[ctx.from.id];
    if (!w) return;

    if (w.step === 'custom_amount') {
      const amount = parseInt(ctx.message.text.replace(/\D/g, ''), 10);
      if (!amount || amount < pixyApi.MIN_STARS) {
        return ctx.reply(`❌ Iltimos, kamida ${pixyApi.MIN_STARS} dan katta son kiriting.`);
      }
      if (amount > pixyApi.MAX_STARS) {
        return ctx.reply(`❌ Maksimal miqdor ${pixyApi.MAX_STARS.toLocaleString()} Stars.`);
      }
      const pricePerStar = await getSetting('stars_price_uzs');
      waiting[ctx.from.id] = { type: 'stars', quantity: amount, priceUZS: amount * pricePerStar, step: 'recipient' };
      const label = `⭐ ${amount} Stars`;
      return ctx.reply(
        `👤 <b>Qabul qiluvchi</b>\n\n${label} — <b>${(amount * pricePerStar).toLocaleString()} so'm</b>\n\n` +
        `Kimga yubormoqchisiz? Telegram username kiriting (masalan: <code>@someone</code>) yoki pastdagi tugmani bosing.`,
        { parse_mode: 'HTML', ...pixyRecipientKeyboard(ctx.from.username) }
      );
    }

    if (w.step === 'recipient') {
      const uname = pixyApi.normalizeUsername(ctx.message.text);
      if (!uname || uname.length < 5) {
        return ctx.reply("❌ Iltimos, to'g'ri Telegram username kiriting (masalan: @someone).");
      }
      w.recipient = uname;
      return showConfirm(ctx);
    }
  });

  return scene;
}

module.exports = { pixyScene, showStarsMenu, showPremiumMenu };
