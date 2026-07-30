// Haftalik referal konkursi:
// - Har 7 kunda eng ko'p yangi referal chaqirgan foydalanuvchi aniqlanadi
// - G'olibga bot balansidan avtomatik ~15 ⭐ turgan gift yuboriladi
// - Hammasi avtomatik ishlaydi (setInterval orqali fon jarayoni)

const { User, Contest } = require('./models');
const gift = require('./gift');

const CYCLE_MS = 7 * 24 * 60 * 60 * 1000; // 7 kun
const CHECK_INTERVAL_MS = 60 * 60 * 1000; // har soatda tekshiradi
const TARGET_GIFT_STARS = 15; // "15 tali gift"

// Katalogdan star_count'i 15 ga eng yaqin (afzalan teng) gift'ni tanlaydi.
async function pickContestGift(telegram) {
  const gifts = await gift.getAvailableGifts(telegram);
  if (!gifts.length) return null;
  const exact = gifts.find(g => g.star_count === TARGET_GIFT_STARS);
  if (exact) return exact;
  // Aynan 15 topilmasa, eng yaqinini olamiz
  return gifts.reduce((best, g) =>
    Math.abs(g.star_count - TARGET_GIFT_STARS) < Math.abs(best.star_count - TARGET_GIFT_STARS) ? g : best
  );
}

// Barcha foydalanuvchilarning HOZIRGI referralCount qiymatlarini snapshot qiladi
// va yangi 7 kunlik konkurs siklini boshlaydi.
async function startNewCycle(telegram) {
  const users = await User.find({}, { telegramId: 1, referralCount: 1 }).lean();
  const snapshot = {};
  for (const u of users) snapshot[u.telegramId] = u.referralCount || 0;

  const selectedGift = await pickContestGift(telegram);

  const now = new Date();
  const contest = await Contest.create({
    cycleStart: now,
    cycleEnd: new Date(now.getTime() + CYCLE_MS),
    giftId: selectedGift?.id,
    giftStarCount: selectedGift?.star_count,
    snapshot,
    status: 'active',
  });
  return contest;
}

// Joriy faol konkursni qaytaradi (bo'lmasa null)
async function getActiveContest() {
  return Contest.findOne({ status: 'active' }).sort({ createdAt: -1 });
}

// Joriy sikl bo'yicha reyting: [{ telegramId, gained }] kamayish tartibida
async function getLeaderboard(contest, limit = 10) {
  if (!contest) return [];
  const users = await User.find({}, { telegramId: 1, referralCount: 1, username: 1, fullName: 1 }).lean();
  const snap = contest.snapshot instanceof Map ? contest.snapshot : new Map(Object.entries(contest.snapshot || {}));
  const rows = users
    .map(u => {
      const before = snap.get(String(u.telegramId)) ?? snap.get(u.telegramId) ?? 0;
      const gained = (u.referralCount || 0) - before;
      return { telegramId: u.telegramId, username: u.username, fullName: u.fullName, gained };
    })
    .filter(r => r.gained > 0)
    .sort((a, b) => b.gained - a.gained)
    .slice(0, limit);
  return rows;
}

// Konkursni yakunlaydi: g'olibni topadi, gift yuboradi, keyingi siklni boshlaydi.
async function finishCycle(contest, telegram) {
  const leaderboard = await getLeaderboard(contest, 1);
  const winner = leaderboard[0];

  if (!winner || !contest.giftId) {
    contest.status = 'no_winner';
    contest.finishedAt = new Date();
    await contest.save();
  } else {
    try {
      await gift.sendGift(telegram, { userId: winner.telegramId, giftId: contest.giftId, text: "🏆 Haftalik referal konkursi g'olibisiz!" });
      contest.status = 'completed';
      contest.winnerId = winner.telegramId;
      contest.winnerReferrals = winner.gained;
      contest.finishedAt = new Date();
      await contest.save();
      try {
        await telegram.sendMessage(
          winner.telegramId,
          `🏆 Tabriklaymiz! Siz shu hafta ${winner.gained} ta referal chaqirib, konkursda g'olib bo'ldingiz!\n` +
          `🎁 Sizga ⭐ ${contest.giftStarCount} qiymatidagi gift yuborildi.`
        );
      } catch {}
    } catch (e) {
      console.error("Konkurs g'olibiga gift yuborishda xato:", e.message);
      contest.status = 'no_winner';
      contest.finishedAt = new Date();
      await contest.save();
    }
  }

  // Keyingi haftalik siklni darhol boshlaymiz
  return startNewCycle(telegram);
}

// Fon jarayoni: har soatda tekshiradi, muddati o'tgan konkursni yakunlab,
// agar faol konkurs umuman bo'lmasa — yangisini boshlaydi.
function startContestScheduler(telegram) {
  const tick = async () => {
    try {
      let contest = await getActiveContest();
      if (!contest) {
        await startNewCycle(telegram);
        console.log('🏆 Konkurs: yangi haftalik sikl boshlandi.');
        return;
      }
      if (contest.cycleEnd.getTime() <= Date.now()) {
        await finishCycle(contest, telegram);
        console.log('🏆 Konkurs: sikl yakunlandi, g\'olib aniqlandi va keyingi sikl boshlandi.');
      }
    } catch (e) {
      console.error('Konkurs schedulerida xato:', e.message);
    }
  };
  tick(); // darhol bir marta tekshiradi (bot birinchi ishga tushganda)
  setInterval(tick, CHECK_INTERVAL_MS);
}

module.exports = {
  startNewCycle,
  getActiveContest,
  getLeaderboard,
  finishCycle,
  startContestScheduler,
};
