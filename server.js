const express = require('express');
const multer = require('multer');
const fetch = require('node-fetch');
const path = require('path');
const { pipeline } = require('stream');
const { promisify } = require('util');

const app = express();
const PORT = process.env.PORT || 3000;

// --- پیکربندی اسپیس‌های کارگر ---
// آدرس‌های اسپیس‌های شما در اینجا قرار گرفته است
const HF_WORKERS = [
    'ezmary-alfa-editor-worker-1.hf.space',
    'ezmary-alfa-editor-worker-2.hf.space',
    'ezmary-alfa-editor-worker-3.hf.space'
];

// --- سیستم توزیع بار چرخشی (Round Robin) ---
let nextWorkerIndex = 0;
const getNextWorker = () => {
    const workerHost = HF_WORKERS[nextWorkerIndex];
    nextWorkerIndex = (nextWorkerIndex + 1) % HF_WORKERS.length;
    console.log(`[Load Balancer] Selecting worker: ${workerHost}`);
    return workerHost;
};

// --- Middleware ---
app.use(express.static(path.join(__dirname, 'public')));

const storage = multer.memoryStorage();
const upload = multer({ 
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 } // محدودیت ۱۰ مگابایت برای فایل
});

// --- نقطه پایانی اصلی API ---
app.post('/api/edit', upload.single('image'), async (req, res) => {
    if (!req.file || !req.body.prompt) {
        return res.status(400).json({ error: 'Image file and prompt text are required.' });
    }

    const workerHost = getNextWorker();
    const apiUrl = `https://${workerHost}/api/edit`;

    console.log(`[API Proxy] Forwarding request to: ${apiUrl}`);

    try {
        // برای ارسال فایل به عنوان form-data، از پکیج form-data استفاده می‌کنیم
        const FormData = require('form-data');
        const formData = new FormData();
        formData.append('image', req.file.buffer, {
            filename: req.file.originalname,
            contentType: req.file.mimetype,
        });
        formData.append('prompt', req.body.prompt);

        const hfResponse = await fetch(apiUrl, {
            method: 'POST',
            body: formData,
            headers: formData.getHeaders(),
            timeout: 180000 // تایم‌اوت ۱۸۰ ثانیه‌ای (۳ دقیقه)
        });

        if (!hfResponse.ok) {
            let errorText = `Worker API error (${hfResponse.status})`;
            try {
                // تلاش برای خواندن جزئیات خطا از FastAPI
                const errorJson = await hfResponse.json();
                errorText = errorJson.detail || JSON.stringify(errorJson);
            } catch (e) {
                // اگر پاسخ JSON نبود
                errorText = await hfResponse.text();
            }
            throw new Error(errorText);
        }
        
        // پاسخ موفقیت‌آمیز یک تصویر است
        res.setHeader('Content-Type', hfResponse.headers.get('content-type') || 'image/png');
        
        const pipe = promisify(pipeline);
        await pipe(hfResponse.body, res);

    } catch (error) {
        console.error('[Proxy Error]', error);
        res.status(502).json({ error: `An unexpected error occurred: ${error.message}` });
    }
});

// تمام درخواست‌های GET به صفحه اصلی هدایت می‌شوند
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Alfa Image Editor Proxy & UI is running on port ${PORT}`);
    console.log(`Distributing load across: ${HF_WORKERS.join(', ')}`);
});
