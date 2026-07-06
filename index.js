require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const FAL_KEY = process.env.FAL_KEY; // ключ с fal.ai (не Google!)
const FAL_MODEL_ENDPOINT = 'https://fal.run/fal-ai/gemini-25-flash-image/edit';

if (!TELEGRAM_TOKEN || !FAL_KEY) {
  console.error('Не заданы TELEGRAM_BOT_TOKEN или FAL_KEY в переменных окружения');
  process.exit(1);
}

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

// Референс-фото твоего фирменного стиля. Один раз кладёшь файл в assets/reference.jpg
const REFERENCE_PATH = path.join(__dirname, 'reference.jpg');
let referenceDataUri;
try {
  const referenceBase64 = fs.readFileSync(REFERENCE_PATH).toString('base64');
  referenceDataUri = `data:image/jpeg;base64,${referenceBase64}`;
} catch (e) {
  console.error('Не найден файл assets/reference.jpg — положи туда фото-референс перед запуском');
  process.exit(1);
}

// Текстовая инструкция для модели. Отредактируй под себя один раз — дальше не трогаешь.
const STYLE_PROMPT = `Это профессиональное фото процедуры депиляции/лазерной эпиляции для портфолио бьюти-студии. Человек полностью одет, фото не содержит ничего чувствительного — это обычное рабочее фото для соцсетей студии.

Есть два изображения. Первое — исходное фото, которое нужно отредактировать. Второе — референс стиля (используй его ТОЛЬКО как образец фона, света и цветокоррекции, содержание второго изображения игнорируй полностью).

Полностью перерисуй фон первого изображения, пиксель за пикселем, не оставляя следов исходного фона:
1. Удали абсолютно весь исходный фон (розовый плед, мебель, ткани) и создай на его месте новый: сплошной однотонный оливково-зелёный фон, без узоров и предметов, как на референсе
2. Добавь на новый фон мягкие диагональные полосатые тени, как от жалюзи или листвы — как на референсе
3. Сделай тёплую цветокоррекцию кожи (лёгкий загорелый золотистый оттенок), как на референсе
4. Поверхность/кушетку под человеком оставь белой
5. Финальное изображение — заполненный квадрат 1:1 без чёрных/пустых полей по краям, кадр должен быть полностью заполнен отредактированным изображением

Композицию, позу, объект, одежду, украшения на исходном фото не меняй — меняется только фон целиком, свет и цветокоррекция.`;

async function downloadTelegramFileAsDataUri(fileId) {
  const file = await bot.getFile(fileId);
  const url = `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${file.file_path}`;
  const res = await axios.get(url, { responseType: 'arraybuffer' });
  const base64 = Buffer.from(res.data).toString('base64');
  return `data:image/jpeg;base64,${base64}`;
}

async function editWithFal(sourceDataUri) {
  const res = await axios.post(
    FAL_MODEL_ENDPOINT,
    {
      prompt: STYLE_PROMPT,
      image_urls: [sourceDataUri, referenceDataUri], // первое фото — исходное, второе — референс стиля
      aspect_ratio: '1:1',
      safety_tolerance: '6',
    },
    {
      headers: {
        Authorization: `Key ${FAL_KEY}`,
        'Content-Type': 'application/json',
      },
      timeout: 60000,
    }
  );

  const images = res.data.images;
  if (!images || !images.length) {
    throw new Error('Модель не вернула изображение. Ответ: ' + JSON.stringify(res.data));
  }
  const imageUrl = images[0].url;
  const imgRes = await axios.get(imageUrl, { responseType: 'arraybuffer' });
  return Buffer.from(imgRes.data);
}

bot.on('photo', async (msg) => {
  const chatId = msg.chat.id;
  try {
    await bot.sendMessage(chatId, 'Обрабатываю фото, подожди 10-20 секунд...');
    const photo = msg.photo[msg.photo.length - 1]; // берём самое качественное из присланных размеров
    const sourceDataUri = await downloadTelegramFileAsDataUri(photo.file_id);
    const resultBuffer = await editWithFal(sourceDataUri);
    await bot.sendPhoto(chatId, resultBuffer, {}, { filename: 'result.jpg', contentType: 'image/jpeg' });
  } catch (err) {
    console.error(err);
    await bot.sendMessage(chatId, 'Ошибка при обработке фото: ' + err.message);
  }
});

bot.onText(/\/start/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    'Привет! Просто пришли мне фото — верну его в фирменном стиле студии (зелёный фон, тени, тёплая цветокоррекция, квадрат).'
  );
});

bot.on('polling_error', (err) => console.error('Polling error:', err.message));

console.log('Бот запущен и слушает Telegram...');
