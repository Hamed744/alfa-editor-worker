// server.js (نسخه اصلاح شده و تضمینی)

const express = require('express');
const multer = require('multer');
const fetch = require('node-fetch');
const path = require('path');
const FormData = require('form-data'); // اضافه شد

const app = express();
const PORT = process.env.PORT || 3000;

// لیست کارگرهای اسپیس (با دامنه کامل)
const HF_WORKERS = [
    'https://ezmary-alfa-editor-worker-1.hf.space',
    'https://ezmary-alfa-editor-worker-2.hf.space',
    'https://ezmary-alfa-editor-worker-3.hf.space'
];

let nextWorkerIndex = 0;
const getNextWorker = () => {
    const workerUrl = HF_WORKERS[nextWorkerIndex];
    nextWorkerIndex = (nextWorkerIndex + 1) % HF_WORKERS.length;
    console.log(`[Load Balancer] انتخاب کارگر: ${workerUrl}`);
    return workerUrl;
};

app.use(express.static(path.join(__dirname, 'public')));

const storage = multer.memoryStorage();
const upload = multer({ 
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 } // حداکثر 10 مگابایت
});

app.post('/api/edit', upload.single('image'), async (req, res) => {
    if (!req.file || !req.body.prompt) {
        return res.status(400).json({ error: 'فایل تصویر و دستور ویرایش الزامی هستند.' });
    }

    const workerUrl = getNextWorker();
    const apiUrl = `${workerUrl}/edit`; // اصلاح شد: از /edit به جای /run/edit
    
    console.log(`[API Proxy] ارسال درخواست به کارگر: ${apiUrl}`);

    try {
        // ایجاد FormData برای ارسال به FastAPI
        const formData = new FormData();
        formData.append('image', req.file.buffer, {
            filename: req.file.originalname,
            contentType: req.file.mimetype
        });
        formData.append('prompt', req.body.prompt);

        const hfResponse = await fetch(apiUrl, {
            method: 'POST',
            body: formData,
            headers: formData.getHeaders(), // استفاده از هدرهای خودکار FormData
            timeout: 180000 // 3 دقیقه تایم‌اوت
        });

        // بررسی نوع محتوای پاسخ
        const contentType = hfResponse.headers.get('content-type');
        
        // حالت 1: پاسخ تصویری (موفقیت)
        if (contentType && contentType.includes('image/png')) {
            const imageBuffer = await hfResponse.buffer();
            res.setHeader('Content-Type', 'image/png');
            return res.send(imageBuffer);
        }
        
        // حالت 2: پاسخ JSON (خطا)
        if (contentType && contentType.includes('application/json')) {
            const errorBody = await hfResponse.json();
            const errorMsg = errorBody.error || errorBody.detail || 'خطای ناشناخته از کارگر';
            throw new Error(errorMsg);
        }
        
        // حالت 3: سایر انواع پاسخ
        const textResponse = await hfResponse.text();
        throw new Error(textResponse || 'خطای ناشناخته از کارگر');

    } catch (error) {
        console.error('[Proxy Error]', error.message);
        res.status(502).json({ error: `خطا در پردازش: ${error.message}` });
    }
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`سرور پروکسی و رابط کاربری آلفا در حال اجرا در پورت ${PORT}`);
    console.log(`توزیع بار بین کارگرها: ${HF_WORKERS.join(', ')}`);
});
