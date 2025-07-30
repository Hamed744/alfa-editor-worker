// server.js

const express = require('express');
const multer = require('multer');
const fetch = require('node-fetch'); // اطمینان حاصل کنید نسخه 2.x نصب است
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// لیست اسپیس‌های کارگر شما
const HF_WORKERS = [
    'ezmary-alfa-editor-worker-1.hf.space',
    'ezmary-alfa-editor-worker-2.hf.space',
    'ezmary-alfa-editor-worker-3.hf.space'
];

let nextWorkerIndex = 0;
const getNextWorker = () => {
    const workerHost = HF_WORKERS[nextWorkerIndex];
    nextWorkerIndex = (nextWorkerIndex + 1) % HF_WORKERS.length;
    console.log(`[Load Balancer] Selecting worker: ${workerHost}`);
    return workerHost;
};

app.use(express.static(path.join(__dirname, 'public')));

const storage = multer.memoryStorage();
const upload = multer({ 
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 }
});

app.post('/api/edit', upload.single('image'), async (req, res) => {
    if (!req.file || !req.body.prompt) {
        return res.status(400).json({ error: 'Image file and prompt text are required.' });
    }

    const workerHost = getNextWorker();
    const apiUrl = `https://${workerHost}/run/predict`; // آدرس API داخلی Gradio

    console.log(`[API Proxy] Forwarding request to Gradio worker: ${apiUrl}`);

    try {
        // 1. تبدیل تصویر به فرمت Data URI که Gradio می‌فهمد
        const imageBase64 = req.file.buffer.toString('base64');
        const imageDataURI = `data:${req.file.mimetype};base64,${imageBase64}`;
        
        // 2. ساختن payload برای API Gradio
        const payload = {
            "data": [
                imageDataURI,       // ورودی اول: image_input
                req.body.prompt,    // ورودی دوم: prompt_input
            ]
        };

        const hfResponse = await fetch(apiUrl, {
            method: 'POST',
            body: JSON.stringify(payload),
            headers: { 'Content-Type': 'application/json' },
            timeout: 180000 // تایم‌اوت ۳ دقیقه‌ای
        });

        if (!hfResponse.ok) {
            const errorText = await hfResponse.text();
            throw new Error(`Worker API error (${hfResponse.status}): ${errorText}`);
        }
        
        const responseJson = await hfResponse.json();

        // 3. بررسی خطا در پاسخ Gradio
        if (responseJson.error) {
            throw new Error(`Gradio worker returned an error: ${responseJson.error}`);
        }
        
        // 4. استخراج تصویر از پاسخ Gradio
        // ساختار پاسخ: data[0] -> output_gallery, data[0][0] -> first image in gallery
        // data[0][0][0] -> base64 data uri of the first image
        const resultImageDataURI = responseJson.data[0][0][0];
        
        if (!resultImageDataURI) {
            // اگر تصویری برنگشت، متن خطا را نمایش بده
            const errorTextFromGradio = responseJson.data[1] || "No image was generated.";
            throw new Error(errorTextFromGradio);
        }

        // 5. تبدیل Data URI به بافر (Buffer) و ارسال به کاربر
        const base64Data = resultImageDataURI.split(';base64,').pop();
        const imageBuffer = Buffer.from(base64Data, 'base64');

        res.setHeader('Content-Type', 'image/png');
        res.send(imageBuffer);

    } catch (error) {
        console.error('[Proxy Error]', error);
        res.status(502).json({ error: `An unexpected error occurred: ${error.message}` });
    }
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Alfa Image Editor Proxy & UI is running on port ${PORT}`);
    console.log(`Distributing load across: ${HF_WORKERS.join(', ')}`);
});
