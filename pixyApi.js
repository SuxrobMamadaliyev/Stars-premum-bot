// Pixy.uz (api.pixy.uz) orqali Telegram Stars / Premium sotib olish integratsiyasi.
// Hujjat: /stars/buy va /premium/buy — Fragment orqali TON hamyondan to'lov qilib,
// ko'rsatilgan Telegram username'ga Stars yoki Premium yuboradi.
//
// MUHIM XAVFSIZLIK ESLATMASI:
// Bu API har bir so'rovda TON hamyonning mnemonik fraza (seed)sini talab qiladi -
// bu fraza hamyon ustidan TO'LIQ nazoratni beradi. Admin panel orqali kiritilgan
// "pixy_wallet_seed" MongoDB'da SHIFRLANMAGAN holda saqlanadi. Faqat shu bot uchun
// alohida, kam mablag'li "ishchi" hamyon ishlatish tavsiya etiladi - asosiy/katta
// hamyon seed'ini bu yerga hech qachon kiritmang.

const axios = require('axios');
const crypto = require('crypto');
const { getSetting } = require('./settings');

const STARS_ENDPOINT = '/stars/buy';
const PREMIUM_ENDPOINT = '/premium/buy';

const MIN_STARS = 50;
const MAX_STARS = 1000000;
const VALID_PREMIUM_MONTHS = [3, 6, 12];

// Pixy API xato kodlarini foydalanuvchiga tushunarli xabarlarga o'giradi
const ERROR_MESSAGES = {
  VALIDATION_ERROR: "Ma'lumotlar noto'g'ri yuborildi.",
  PENDING_TRANSACTION: 'Bu buyurtma hozirda bajarilmoqda, biroz kuting.',
  INVALID_AMOUNT_MIN: `Minimal miqdor ${MIN_STARS} Stars bo'lishi kerak.`,
  INVALID_AMOUNT_MAX: `Maksimal miqdor ${MAX_STARS.toLocaleString()} Stars bo'lishi kerak.`,
  INSUFFICIENT_FUNDS: "Bot hamyonida yetarli TON mablag' yo'q. Admin bilan bog'laning.",
  WALLET_VM_ERROR: 'Hamyon sozlamalarida xato. Admin bilan bog\'laning.',
  FRAGMENT_ERROR: 'Fragment xizmatida muammo yuz berdi (masalan, userda allaqachon Premium bor).',
  FRAGMENT_API_ERROR: 'Fragment xizmatida muammo yuz berdi (masalan, userda allaqachon Premium bor).',
  FRAGMENT_TIMEOUT: 'Fragment serveri javob bermadi. Birozdan keyin qayta urinib ko\'ring.',
  USER_TRANSFER_FAIL: 'TON blokcheyn tarmog\'ida xatolik yuz berdi.',
  CRITICAL_SERVER_ERROR: 'Pixy serverida kutilmagan ichki xato.',
};

function generateOrderId(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

async function getClient() {
  const baseURL = (await getSetting('pixy_api_url')) || 'https://api.pixy.uz';
  return axios.create({
    baseURL: baseURL.replace(/\/+$/, ''),
    timeout: 30000, // Fragment/TON tranzaksiyalari bir necha soniya olishi mumkin
    headers: { 'Content-Type': 'application/json' },
  });
}

async function getSeed() {
  const seed = await getSetting('pixy_wallet_seed');
  if (!seed) {
    throw new Error('Pixy TON hamyon seed-fraza hali sozlanmagan. Admin panel orqali kiriting.');
  }
  return seed;
}

function normalizeUsername(username) {
  return String(username || '').trim().replace(/^@/, '');
}

function friendlyError(e) {
  const data = e.response?.data;
  const code = data?.error || data?.code;
  if (code && ERROR_MESSAGES[code]) return ERROR_MESSAGES[code];
  const msg = data?.message;
  if (msg) return msg;
  return e.message || "Pixy API bilan bog'lanishda noma'lum xato.";
}

// Telegram Stars sotib olib, berilgan username'ga yuboradi
async function buyStars(username, amount) {
  if (!amount || amount < MIN_STARS) throw new Error(ERROR_MESSAGES.INVALID_AMOUNT_MIN);
  if (amount > MAX_STARS) throw new Error(ERROR_MESSAGES.INVALID_AMOUNT_MAX);

  const client = await getClient();
  const seed = await getSeed();
  const uname = normalizeUsername(username);
  const orderId = generateOrderId('STARS');

  try {
    const { data } = await client.post(STARS_ENDPOINT, {
      username: uname,
      amount,
      seed,
      order_id: orderId,
    });
    return {
      success: data?.ok === true,
      orderId: data?.order_id || orderId,
      message: data?.message || '',
      costTon: data?.cost,
    };
  } catch (e) {
    throw new Error(friendlyError(e));
  }
}

// Telegram Premium sotib olib, berilgan username'ga yuboradi (duration: 3 | 6 | 12 oy)
async function buyPremium(username, months) {
  const duration = parseInt(months, 10);
  if (!VALID_PREMIUM_MONTHS.includes(duration)) {
    throw new Error("Premium muddati faqat 3, 6 yoki 12 oy bo'lishi mumkin.");
  }

  const client = await getClient();
  const seed = await getSeed();
  const uname = normalizeUsername(username);
  const orderId = generateOrderId('PREM');

  try {
    const { data } = await client.post(PREMIUM_ENDPOINT, {
      username: uname,
      duration,
      seed,
      order_id: orderId,
    });
    return {
      success: data?.ok === true,
      orderId: data?.order_id || orderId,
      message: data?.message || '',
      costTon: data?.cost,
    };
  } catch (e) {
    throw new Error(friendlyError(e));
  }
}

module.exports = { buyStars, buyPremium, normalizeUsername, MIN_STARS, MAX_STARS, VALID_PREMIUM_MONTHS };
