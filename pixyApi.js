// Pixy.uz orqali Telegram Stars / Premium sotib olish integratsiyasi.
//
// ❗️ MUHIM: Pixy.uz'ning ochiq/public API hujjatlari topilmadi, shu sabab bu modul
// odatiy REST API andozasi (Authorization: Bearer <key> + JSON body) asosida yozilgan.
// Ishlatishdan oldin quyidagilarni pixy.uz shaxsiy kabinetingizdagi API hujjati bilan
// solishtirib, kerak bo'lsa moslashtiring:
//   - ENDPOINT yo'llari (STARS_ENDPOINT / PREMIUM_ENDPOINT)
//   - So'rov body maydonlari (masalan "username" o'rniga "recipient" bo'lishi mumkin)
//   - Javobdagi muvaffaqiyat/ID maydonlari (parseResponse funksiyasida)
//
// Admin panel orqali "🔑 Pixy API sozlamalari" tugmasidan API manzili va kalitni kiritish kerak.

const axios = require('axios');
const { getSetting } = require('./settings');

const STARS_ENDPOINT = '/api/v1/stars/order';
const PREMIUM_ENDPOINT = '/api/v1/premium/order';

async function getClient() {
  const baseURL = await getSetting('pixy_api_url');
  const apiKey = await getSetting('pixy_api_key');
  if (!baseURL || !apiKey) {
    throw new Error('Pixy API hali sozlanmagan. Admin panel orqali API manzili va kalitni kiriting.');
  }
  return axios.create({
    baseURL: baseURL.replace(/\/+$/, ''),
    timeout: 20000,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
  });
}

function parseResponse(data) {
  // Pixy API'ning haqiqiy javob formatiga qarab shu yerni moslashtiring.
  const success = data?.success === true || data?.status === 'ok' || data?.status === 'success';
  const orderId = data?.order_id || data?.orderId || data?.id || '';
  const message = data?.message || data?.error || '';
  return { success, orderId, message };
}

// username: '@' belgisisiz yoki bilan bo'lishi mumkin — normalizatsiya qilamiz
function normalizeUsername(username) {
  return String(username || '').trim().replace(/^@/, '');
}

// Telegram Stars sotib olib, berilgan username'ga yuboradi
async function buyStars(username, amount) {
  const client = await getClient();
  const uname = normalizeUsername(username);
  try {
    const { data } = await client.post(STARS_ENDPOINT, {
      username: uname,
      amount,
    });
    return parseResponse(data);
  } catch (e) {
    const apiMsg = e.response?.data?.message || e.response?.data?.error;
    throw new Error(apiMsg || e.message || 'Pixy API xatosi (Stars)');
  }
}

// Telegram Premium sotib olib, berilgan username'ga yuboradi (months: 3 | 6 | 12)
async function buyPremium(username, months) {
  const client = await getClient();
  const uname = normalizeUsername(username);
  try {
    const { data } = await client.post(PREMIUM_ENDPOINT, {
      username: uname,
      months,
    });
    return parseResponse(data);
  } catch (e) {
    const apiMsg = e.response?.data?.message || e.response?.data?.error;
    throw new Error(apiMsg || e.message || 'Pixy API xatosi (Premium)');
  }
}

module.exports = { buyStars, buyPremium, normalizeUsername };
