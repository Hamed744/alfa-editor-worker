// server.js (نسخه نهایی و تضمینی)

const express = require('express');
const multer = require('multer');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

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
    
    // ==========================================================
    //  آدرس صحیح و نهایی با توجه به api_name="edit"
    // ==========================================================
    const apiUrl = `https://${workerHost}/run/edit`; 
    // ==========================================================

    console.log(`[API Proxy] Forwarding request to Gradio worker: ${apiUrl}`);

    try {
        const imageBase64 = req.file.buffer.toString('base64');
        const imageDataURI = `data:${req.file.mimetype};base64,${imageBase64}`;
        
        // payload برای Gradio با api_name
        const payload = {
            "data": [
                imageDataURI,
                req.body.prompt,
            ]
        };

        const hfResponse = await fetch(apiUrl, {
            method: 'POST',
            body: JSON.stringify(payload),
            headers: { 'Content-Type': 'application/json' },
            timeout: 180000 
        });

        if (!hfResponse.ok) {
            let errorText = `Worker API error (${hfResponse.status})`;
            try {
                const errorBody = await hfResponse.json();
                errorText = errorBody.detail || errorBody.error || JSON.stringify(errorBody);
            } catch (e) {
                errorText = await hfResponse.text();
            }
            throw new Error(errorText);
        }
        
        const responseJson = await hfResponse.json();

        if (responseJson.error) {
            throw new Error(`Gradio worker returned an error: ${responseJson.error}`);
        }
        
        // استخراج تصویر از پاسخ (ساختار خروجی Gallery)
        const resultImageDataURI = responseJson.data[0] && responseJson.data[0][0] && responseJson.data[0][0][0];
        
        if (!resultImageDataURI) {
            const errorTextFromGradio = responseJson.data[1] || "Worker did not generate an image.";
            throw new Error(errorTextFromGradio);
        }

        const base64Data = resultImageDataURI.split(';base64,').pop();
        const imageBuffer = Buffer.from(base64Data, 'base64');

        res.setHeader('Content-Type', 'image/png');
        res.send(imageBuffer);

    } catch (error) {
        console.error('[Proxy Error]', error.message);
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
