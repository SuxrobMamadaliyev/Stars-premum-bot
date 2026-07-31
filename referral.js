const { User } = require('./models');
const { getSetting } = require('./settings');

// Referal dasturi ENDI SO'M BONUS EMAS — BALL beradi.
// Ball ikki holatda beriladi:
//   1) Taklif qilingan foydalanuvchi ilk marta minimal depozit qilganda (BIR MARTA)
//   2) Taklif qilingan foydalanuvchi har safar biror narsa sotib olganda (HAR SAFAR)
// Yig'ilgan ball haftalik konkursda (contest.js) g'olibni aniqlash uchun ishlatiladi.

// ---- 1) Majburiy kanallarga aʼzo boʻlgan YANGI foydalanuvchi uchun ball (bir marta) ----
// Depozit shart EMAS — foydalanuvchi shunchaki majburiy kanallarga aʼzo boʻlib,
// bot'dan birinchi marta toʻliq foydalanishga oʻtishi bilanoq (referredBy oʻrnatilganda) beriladi.
async function tryGrantReferralSignupPoints(newUserTelegramId, refId, telegram) {
  try {
    if (!refId) return;

    const points = (await getSetting('referral_deposit_points')) || 0;
    if (points <= 0) return;

    await User.updateOne(
      { telegramId: refId },
      { $inc: { points, referralCount: 1 } }
    );

    if (telegram) {
      try {
        await telegram.sendMessage(
          refId,
          `🎉 Sizning referalingiz orqali taklif qilingan foydalanuvchi botga qoʻshildi va majburiy kanallarga aʼzo boʻldi!\n` +
          `🏅 +${points} ball qo'shildi. Konkursda qatnashish uchun ball yig'ishda davom eting!`
        );
      } catch {}
    }
  } catch (e) {
    console.error('Referal obuna ballini berishda xato:', e.message);
  }
}

// ---- 2) Har bir xarid uchun ball (har safar) ----
// Chaqiriladigan joylar: raqam sotib olish, Stars sotib olish, Premium sotib olish
// — ya'ni referredBy'ga ega foydalanuvchi balansidan pul yechilib xarid amalga oshgan har bir joyda.
async function tryGrantReferralPurchasePoints(telegramId, telegram) {
  try {
    const user = await User.findOne({ telegramId }, { referredBy: 1 }).lean();
    if (!user || !user.referredBy) return;

    const points = (await getSetting('referral_purchase_points')) || 0;
    if (points <= 0) return;

    const refId = user.referredBy;
    await User.updateOne({ telegramId: refId }, { $inc: { points } });

    if (telegram) {
      try {
        await telegram.sendMessage(
          refId,
          `🛒 Sizning referalingiz xarid qildi!\n🏅 +${points} ball qo'shildi.`
        );
      } catch {}
    }
  } catch (e) {
    console.error('Referal xarid ballini berishda xato:', e.message);
  }
}

module.exports = { tryGrantReferralSignupPoints, tryGrantReferralPurchasePoints };
