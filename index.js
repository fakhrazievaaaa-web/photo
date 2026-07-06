require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = 'gemini-2.5-flash-image'; // при желании можно заменить на более новую версию (gemini-3.1-flash-image), если она уже доступна в твоём аккаунте Google AI Studio

if (!TELEGRAM_TOKEN || !GEMINI_API_KEY) {
  console.error('Не заданы TELEGRAM_BOT_TOKEN или GEMINI_API_KEY в переменных окружения');
  process.exit(1);
}

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

// Референс-фото твоего фирменного стиля. Один раз кладёшь файл в assets/reference.jpg
const REFERENCE_PATH = path.join(__dirname, 'assets', 'reference.jpg');
let referenceBase64;
try {
  referenceBase64 = fs.readFileSync(REFERENCE_PATH).toString('base64');
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

async function downloadTelegramFile(fileId) {
  const file = await bot.getFile(fileId);
  const url = `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${file.file_path}`;
  const res = await axios.get(url, { responseType: 'arraybuffer' });
  return Buffer.from(res.data).toString('base64');
}

async function editWithGemini(sourceBase64) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
  const body = {
    contents: [
      {
        parts: [
          { text: STYLE_PROMPT },
          { inline_data: { mime_type: 'image/jpeg', data: sourceBase64 } },
          { inline_data: { mime_type: 'image/jpeg', data: referenceBase64 } },
        ],
      },
    ],
  };

  const res = await axios.post(url, body, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 60000,
  });

  const parts = res.data.candidates[0].content.parts;
  const imagePart = parts.find((p) => p.inline_data || p.inlineData);
  if (!imagePart) {
    throw new Error('Модель не вернула изображение. Ответ: ' + JSON.stringify(res.data));
  }
  const data = imagePart.inline_data ? imagePart.inline_data.data : imagePart.inlineData.data;
  return Buffer.from(data, 'base64');
}

bot.on('photo', async (msg) => {
  const chatId = msg.chat.id;
  try {
    await bot.sendMessage(chatId, 'Обрабатываю фото, подожди 10-20 секунд...');
    const photo = msg.photo[msg.photo.length - 1]; // берём самое качественное из присланных размеров
    const sourceBase64 = await downloadTelegramFile(photo.file_id);
    const resultBuffer = await editWithGemini(sourceBase64);
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
