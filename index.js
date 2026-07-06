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
const STYLE_PROMPT = `Тебе даны два изображения: первое — исходное фото, которое нужно отредактировать, второе — референс стиля.
Перенеси на первое изображение визуальный стиль второго:
- фон замени на однотонный оливково-зелёный, как на референсе
- добавь мягкие полосатые тени, как от жалюзи или листвы
- сделай тёплую цветокоррекцию кожи (загорелый оттенок), как на референсе
- поверхность/кушетку под объектом оставь белой
- итоговое изображение сделай квадратным (соотношение сторон 1:1)
Composicию, позу, объект и содержание исходного фото не меняй — меняется только фон, свет и цветокоррекция.`;

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
      image_size: '1:1',
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
