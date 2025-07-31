// server.js (نسخه نهایی و تضمینی)

const express = require('express');
const multer = require('multer');
const fetch = require('node-fetch');
const path = require('path');

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
    const apiUrl = `${workerUrl}/run/edit`;
    
    console.log(`[API Proxy] ارسال درخواست به کارگر گرادیو: ${apiUrl}`);

    try {
        // تبدیل بافر تصویر به Data URI
        const imageBase64 = req.file.buffer.toString('base64');
        const imageDataURI = `data:${req.file.mimetype};base64,${imageBase64}`;
        
        // ساخت پیلود برای گرادیو
        const payload = {
            "data": [
                imageDataURI, // تصویر به صورت Data URI
                req.body.prompt // دستور ویرایش
            ]
        };

        const hfResponse = await fetch(apiUrl, {
            method: 'POST',
            body: JSON.stringify(payload),
            headers: { 
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            timeout: 180000 // 3 دقیقه تایم‌اوت
        });

        if (!hfResponse.ok) {
            let errorText = `خطای کارگر گرادیو (${hfResponse.status})`;
            try {
                const errorBody = await hfResponse.json();
                errorText = errorBody.detail || errorBody.error || JSON.stringify(errorBody);
            } catch (e) {
                errorText = await hfResponse.text();
            }
            throw new Error(errorText);
        }
        
        const responseJson = await hfResponse.json();
        
        // بررسی ساختار پاسخ و استخراج تصویر
        if (responseJson.error) {
            throw new Error(`کارگر گرادیو خطا داد: ${responseJson.error}`);
        }
        
        // استخراج تصویر از پاسخ (ساختار خروجی Gallery)
        let resultImageDataURI = null;
        
        // حالت 1: ساختار پیش‌فرض گرادیو
        if (responseJson.data && responseJson.data[0] && Array.isArray(responseJson.data[0])) {
            for (const item of responseJson.data[0]) {
                if (Array.isArray(item) && item.length > 0 && typeof item[0] === 'string' && item[0].startsWith('data:image')) {
                    resultImageDataURI = item[0];
                    break;
                }
            }
        }
        // حالت 2: ساختار FastAPI
        else if (responseJson.data && responseJson.data[0] && typeof responseJson.data[0] === 'string' && responseJson.data[0].startsWith('data:image')) {
            resultImageDataURI = responseJson.data[0];
        }
        
        if (!resultImageDataURI) {
            // تلاش برای استخراج پیام خطا
            const errorText = responseJson.data && responseJson.data[1] 
                ? responseJson.data[1] 
                : "کارگر تصویری تولید نکرد. لطفاً دستور را بررسی کنید.";
            throw new Error(errorText);
        }

        // تبدیل Data URI به بافر باینری
        const base64Data = resultImageDataURI.split(';base64,').pop();
        const imageBuffer = Buffer.from(base64Data, 'base64');

        // ارسال تصویر به عنوان پاسخ
        res.setHeader('Content-Type', 'image/png');
        res.send(imageBuffer);

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
