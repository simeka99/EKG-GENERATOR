// Inisialisasi Canvas dan Kontek
const canvas = document.getElementById('draw_canvas');
const ctx = canvas.getContext('2d');
const generateBtn = document.getElementById('generate_btn');
const clearBtn = document.getElementById('clear_btn');
const sendDataBtn = document.getElementById('send_data_btn');
const loadDataBtn = document.getElementById('load_data_btn');
const EKGChart = document.getElementById('EKG_chart');
const saveSettingsBtn = document.getElementById('saveSettings');
const connectESPBtn = document.getElementById('connectESP');
const espIPInput = document.getElementById('espIP');
const espPortInput = document.getElementById('espPort');
const connectionStatus = document.getElementById('connectionStatus');
const drawResult = document.getElementById('draw_result');
const chartResult = document.getElementById('chart_result');

// Pengaturan Awal
let minVoltage = -1;
let maxVoltage = 3;
let maxTime = 2;
let timeInterval = 0.2;
let frequency = 1;
let samplingPeriod = 1;
let waveSpeed = 100;
let lineWidth = 2;
let lineColor = '#1a73e8';
let width = canvas.width;
let height = canvas.height;
const padding = 50;

// Parameter Normal (Default dari Gambar)
let normalParams = {
    freqMin: 1,
    freqMax: 1.67,
    pMin: 0.1,
    pMax: 0.2,
    qrsMin: 0.5,
    qrsMax: 1.5,
    qrsMaxLimit: 3,
    tMin: 0.1,
    tMax: 0.5,
    prMin: 0.12,
    prMax: 0.20,
    qrsDurationMax: 0.12,
    qtMin: 0.36,
    qtMax: 0.44
};

// Variabel untuk menggambar
let isDrawing = false;
let lastX = 0;
let lastY = 0;
let drawnPoints = [];

// Variabel untuk WebSocket
let socket = null;

// Fungsi untuk menyesuaikan ukuran canvas
function resizeCanvas()
{
    const container = canvas.parentElement;
    canvas.width = container.clientWidth;
    canvas.height = container.clientWidth / 2;
    width = canvas.width;
    height = canvas.height;
    ctx.clearRect(0, 0, width, height);
    drawGrid();
    drawAxes();
    redrawCanvasData();
}

// Fungsi untuk menggambar ulang data di canvas setelah pengaturan berubah
function redrawCanvasData()
{
    if (drawnPoints.length > 0)
    {
        ctx.strokeStyle = lineColor;
        ctx.lineWidth = lineWidth;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(drawnPoints[0][0], drawnPoints[0][1]);
        for (let i = 1; i < drawnPoints.length; i++)
        {
            ctx.lineTo(drawnPoints[i][0], drawnPoints[i][1]);
        }
        ctx.stroke();
        analyzeDrawing();
    }
}

// Fungsi untuk memperbarui EKG Chart setelah pengaturan berubah
function updateEKGChart()
{
    if (EKGChart.data && EKGChart.data.length > 0)
    {
        const trace = EKGChart.data.find(d => d.name === 'EKG Signal' || d.name === 'EKG Manual');
        if (trace)
        {
            trace.line.color = lineColor;
            trace.line.width = lineWidth;
            Plotly.newPlot(EKGChart, EKGChart.data, getLayout(), { displayModeBar: false, responsive: true });
            if (trace.name === 'EKG Manual')
            {
                analyzeDrawing();
            } else
            {
                const pointsData = EKGChart.data.find(d => d.name === 'PQRST Points') || { x: [], y: [] };
                analyzeMode(trace.x, trace.y, pointsData);
            }
        }
    }
}

window.addEventListener('load', () =>
{
    loadSettingsFromStorage();
    resizeCanvas();
});
window.addEventListener('resize', resizeCanvas);

// Hitung skala
function calculateScales()
{
    const voltageRange = maxVoltage - minVoltage;
    const pixelsPerMV = (height - 2 * padding) / voltageRange;
    const pixelsPerSecond = (width - 2 * padding) / maxTime;
    return { pixelsPerMV, pixelsPerSecond };
}

// Fungsi untuk menggambar grid
function drawGrid()
{
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 0.8;
    const { pixelsPerSecond, pixelsPerMV } = calculateScales();

    for (let t = 0; t <= maxTime; t += timeInterval)
    {
        const x = padding + t * pixelsPerSecond;
        ctx.beginPath();
        ctx.moveTo(x, padding);
        ctx.lineTo(x, height - padding);
        ctx.stroke();
    }

    for (let v = minVoltage; v <= maxVoltage; v += 0.5)
    {
        const y = height - padding - (v - minVoltage) * pixelsPerMV;
        ctx.beginPath();
        ctx.moveTo(padding, y);
        ctx.lineTo(width - padding, y);
        ctx.stroke();
    }
}

// Fungsi untuk menggambar sumbu
function drawAxes()
{
    ctx.strokeStyle = '#2d3748';
    ctx.lineWidth = 2;
    const { pixelsPerMV, pixelsPerSecond } = calculateScales();

    ctx.beginPath();
    ctx.moveTo(padding, padding);
    ctx.lineTo(padding, height - padding);
    ctx.stroke();

    const yAxisZero = height - padding - (0 - minVoltage) * pixelsPerMV;
    ctx.beginPath();
    ctx.moveTo(padding, yAxisZero);
    ctx.lineTo(width - padding, yAxisZero);
    ctx.stroke();

    ctx.font = '12px Inter';
    ctx.fillStyle = '#2d3748';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let v = minVoltage; v <= maxVoltage; v += 0.5)
    {
        const y = height - padding - (v - minVoltage) * pixelsPerMV;
        ctx.fillText(v % 1 === 0 ? v.toFixed(0) : v.toFixed(1), padding - 10, y);
    }

    ctx.font = '14px Inter';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let t = 0; t <= maxTime; t += timeInterval)
    {
        const x = padding + t * pixelsPerSecond;
        ctx.fillText(t === 0 ? '0' : t.toFixed(1), x, height - padding + 10);
    }
}

// Konversi koordinat
function canvasToPlotCoords(x, y)
{
    const { pixelsPerMV, pixelsPerSecond } = calculateScales();
    return {
        x: ((x - padding) / pixelsPerSecond),
        y: maxVoltage - ((y - padding) / pixelsPerMV)
    };
}

// Fungsi untuk menggambar garis
function draw(e)
{
    if (!isDrawing) return;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvas.width / rect.width);
    const y = (e.clientY - rect.top) * (canvas.height / rect.height);

    if (x < padding || x > width - padding || y < padding || y > height - padding) return;

    ctx.strokeStyle = lineColor;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
    ctx.lineTo(x, y);
    ctx.stroke();

    drawnPoints.push([x, y]);
    lastX = x;
    lastY = y;
    analyzeDrawing();
}

// Event listener untuk mouse
canvas.addEventListener('mousedown', (e) =>
{
    isDrawing = true;
    const rect = canvas.getBoundingClientRect();
    lastX = (e.clientX - rect.left) * (canvas.width / rect.width);
    lastY = (e.clientY - rect.top) * (canvas.height / rect.height);
    if (lastX >= padding && lastX <= width - padding && lastY >= padding && lastY <= height - padding)
    {
        drawnPoints = [[lastX, lastY]];
    } else
    {
        isDrawing = false;
    }
});
canvas.addEventListener('mousemove', draw);
canvas.addEventListener('mouseup', () =>
{
    isDrawing = false;
    analyzeDrawing();
});
canvas.addEventListener('mouseout', () =>
{
    isDrawing = false;
    analyzeDrawing();
});

// Fungsi untuk mendeteksi puncak (QRS, P, T)
function detectPeaks(voltages, times)
{
    const peaks = { p: [], qrs: [], t: [] };
    const thresholdP = (normalParams.pMin + normalParams.pMax) / 2;
    const thresholdQRS = (normalParams.qrsMin + normalParams.qrsMax) / 2;
    const thresholdT = (normalParams.tMin + normalParams.tMax) / 2;

    for (let i = 1; i < voltages.length - 1; i++)
    {
        if (voltages[i] > voltages[i - 1] && voltages[i] > voltages[i + 1])
        {
            if (voltages[i] >= normalParams.qrsMin && voltages[i] <= normalParams.qrsMaxLimit)
            {
                peaks.qrs.push({ time: times[i], voltage: voltages[i] });
            } else if (voltages[i] >= normalParams.pMin && voltages[i] <= normalParams.pMax)
            {
                peaks.p.push({ time: times[i], voltage: voltages[i] });
            } else if (voltages[i] >= normalParams.tMin && voltages[i] <= normalParams.tMax)
            {
                peaks.t.push({ time: times[i], voltage: voltages[i] });
            }
        }
    }
    return peaks;
}

// Fungsi untuk menganalisis drawing
function analyzeDrawing()
{
    if (drawnPoints.length < 50)
    {
        drawResult.textContent = 'Hasil: Belum ada data cukup';
        drawResult.className = 'result-text';
        return;
    }

    const plotPoints = drawnPoints.map(([x, y]) => canvasToPlotCoords(x, y));
    const voltages = plotPoints.map(p => p.y);
    const times = plotPoints.map(p => p.x);

    const peaks = detectPeaks(voltages, times);

    const qrsTimes = peaks.qrs.map(p => p.time);
    let frequency = 0;
    let bpm = 0;
    if (qrsTimes.length > 1)
    {
        const intervals = [];
        for (let i = 1; i < qrsTimes.length; i++)
        {
            intervals.push(qrsTimes[i] - qrsTimes[i - 1]);
        }
        const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
        frequency = 1 / avgInterval;
        bpm = frequency * 60;
    }

    const pAmplitudes = peaks.p.map(p => p.voltage);
    const qrsAmplitudes = peaks.qrs.map(p => p.voltage);
    const tAmplitudes = peaks.t.map(p => p.voltage);

    const pAvg = pAmplitudes.length > 0 ? pAmplitudes.reduce((a, b) => a + b, 0) / pAmplitudes.length : 0;
    const qrsAvg = qrsAmplitudes.length > 0 ? qrsAmplitudes.reduce((a, b) => a + b, 0) / qrsAmplitudes.length : 0;
    const tAvg = tAmplitudes.length > 0 ? tAmplitudes.reduce((a, b) => a + b, 0) / tAmplitudes.length : 0;

    let prInterval = 0, qrsDuration = 0, qtInterval = 0;
    if (peaks.p.length > 0 && peaks.qrs.length > 0 && peaks.t.length > 0)
    {
        prInterval = peaks.qrs[0].time - peaks.p[0].time;
        qrsDuration = peaks.qrs.length > 1 ? peaks.qrs[1].time - peaks.qrs[0].time : 0;
        qtInterval = peaks.t[0].time - peaks.qrs[0].time;
    }

    let reasons = [];
    let isNormal = true;

    if (frequency < normalParams.freqMin || frequency > normalParams.freqMax)
    {
        reasons.push(`Frekuensi ${frequency.toFixed(2)} Hz (${bpm.toFixed(0)} BPM), normal: ${normalParams.freqMin}-${normalParams.freqMax} Hz (${(normalParams.freqMin * 60).toFixed(0)}-${(normalParams.freqMax * 60).toFixed(0)} BPM)`);
        isNormal = false;
    }
    if (pAvg < normalParams.pMin || pAvg > normalParams.pMax)
    {
        reasons.push(`Amplitudo P ${pAvg.toFixed(2)} mV, normal: ${normalParams.pMin}-${normalParams.pMax} mV`);
        isNormal = false;
    }
    if (qrsAvg < normalParams.qrsMin || qrsAvg > normalParams.qrsMaxLimit)
    {
        reasons.push(`Amplitudo QRS ${qrsAvg.toFixed(2)} mV, normal: ${normalParams.qrsMin}-${normalParams.qrsMaxLimit} mV`);
        isNormal = false;
    }
    if (tAvg < normalParams.tMin || tAvg > normalParams.tMax)
    {
        reasons.push(`Amplitudo T ${tAvg.toFixed(2)} mV, normal: ${normalParams.tMin}-${normalParams.tMax} mV`);
        isNormal = false;
    }
    if (prInterval < normalParams.prMin || prInterval > normalParams.prMax)
    {
        reasons.push(`Interval PR ${prInterval.toFixed(2)} s, normal: ${normalParams.prMin}-${normalParams.prMax} s`);
        isNormal = false;
    }
    if (qrsDuration > normalParams.qrsDurationMax)
    {
        reasons.push(`Durasi QRS ${qrsDuration.toFixed(2)} s, normal: <${normalParams.qrsDurationMax} s`);
        isNormal = false;
    }
    if (qtInterval < normalParams.qtMin || qtInterval > normalParams.qtMax)
    {
        reasons.push(`Interval QT ${qtInterval.toFixed(2)} s, normal: ${normalParams.qtMin}-${normalParams.qtMax} s`);
        isNormal = false;
    }

    let resultText = `Hasil: ${isNormal ? 'Normal' : 'Abnormal'}\n`;
    resultText += `Frekuensi: ${frequency.toFixed(2)} Hz (${bpm.toFixed(0)} BPM)\n`;
    resultText += `Amplitudo P: ${pAvg.toFixed(2)} mV\n`;
    resultText += `Amplitudo QRS: ${qrsAvg.toFixed(2)} mV\n`;
    resultText += `Amplitudo T: ${tAvg.toFixed(2)} mV\n`;
    resultText += `Interval PR: ${prInterval.toFixed(2)} s\n`;
    resultText += `Durasi QRS: ${qrsDuration.toFixed(2)} s\n`;
    resultText += `Interval QT: ${qtInterval.toFixed(2)} s\n`;
    resultText += `\nNormal EKG Parameters:\n`;
    resultText += `Frekuensi: ${normalParams.freqMin}-${normalParams.freqMax} Hz (${(normalParams.freqMin * 60).toFixed(0)}-${(normalParams.freqMax * 60).toFixed(0)} BPM)\n`;
    resultText += `Amplitudo P: ${normalParams.pMin}-${normalParams.pMax} mV\n`;
    resultText += `Amplitudo QRS: ${normalParams.qrsMin}-${normalParams.qrsMaxLimit} mV\n`;
    resultText += `Amplitudo T: ${normalParams.tMin}-${normalParams.tMax} mV\n`;
    resultText += `Interval PR: ${normalParams.prMin}-${normalParams.prMax} s\n`;
    resultText += `Durasi QRS: <${normalParams.qrsDurationMax} s\n`;
    resultText += `Interval QT: ${normalParams.qtMin}-${normalParams.qtMax} s`;

    if (!isNormal)
    {
        resultText += `\nAlasan Abnormal:\n${reasons.join('\n')}`;
    }

    drawResult.textContent = resultText;
    drawResult.className = `result-text ${isNormal ? 'result-normal' : 'result-abnormal'}`;
}

// Fungsi untuk menganalisis mode (hanya mode normal)
function analyzeMode(time, voltage, pointsData)
{
    const f = frequency;

    let pAvg = 0, qrsAvg = 0, tAvg = 0;
    const pPoints = pointsData.filter(p => p.label === 'P');
    const qrsPoints = pointsData.filter(p => p.label === 'R');
    const tPoints = pointsData.filter(p => p.label === 'T');
    pAvg = pPoints.length > 0 ? pPoints.reduce((sum, p) => sum + p.y, 0) / pPoints.length : 0;
    qrsAvg = qrsPoints.length > 0 ? qrsPoints.reduce((sum, p) => sum + p.y, 0) / qrsPoints.length : 0;
    tAvg = tPoints.length > 0 ? tPoints.reduce((sum, p) => sum + p.y, 0) / tPoints.length : 0;

    let prInterval = 0, qrsDuration = 0, qtInterval = 0;
    if (pPoints.length > 0 && qrsPoints.length > 0 && tPoints.length > 0)
    {
        prInterval = qrsPoints[0].x - pPoints[0].x;
        const qPoints = pointsData.filter(p => p.label === 'Q');
        const sPoints = pointsData.filter(p => p.label === 'S');
        if (qPoints.length > 0 && sPoints.length > 0)
        {
            qrsDuration = sPoints[0].x - qPoints[0].x;
        }
        qtInterval = tPoints[0].x - qPoints[0].x;
    }

    let reasons = [];
    let isNormal = true;

    if (f < normalParams.freqMin || f > normalParams.freqMax)
    {
        reasons.push(`Frekuensi ${f.toFixed(2)} Hz (normal: ${normalParams.freqMin}-${normalParams.freqMax} Hz)`);
        isNormal = false;
    }
    if (pAvg < normalParams.pMin || pAvg > normalParams.pMax)
    {
        reasons.push(`Amplitudo P ${pAvg.toFixed(2)} mV (normal: ${normalParams.pMin}-${normalParams.pMax} mV)`);
        isNormal = false;
    }
    if (qrsAvg < normalParams.qrsMin || qrsAvg > normalParams.qrsMaxLimit)
    {
        reasons.push(`Amplitudo QRS ${qrsAvg.toFixed(2)} mV (normal: ${normalParams.qrsMin}-${normalParams.qrsMaxLimit} mV)`);
        isNormal = false;
    }
    if (tAvg < normalParams.tMin || tAvg > normalParams.tMax)
    {
        reasons.push(`Amplitudo T ${tAvg.toFixed(2)} mV (normal: ${normalParams.tMin}-${normalParams.tMax} mV)`);
        isNormal = false;
    }
    if (prInterval < normalParams.prMin || prInterval > normalParams.prMax)
    {
        reasons.push(`Interval PR ${prInterval.toFixed(2)} s (normal: ${normalParams.prMin}-${normalParams.prMax} s)`);
        isNormal = false;
    }
    if (qrsDuration > normalParams.qrsDurationMax)
    {
        reasons.push(`Durasi QRS ${qrsDuration.toFixed(2)} s (normal: <${normalParams.qrsDurationMax} s)`);
        isNormal = false;
    }
    if (qtInterval < normalParams.qtMin || qtInterval > normalParams.qtMax)
    {
        reasons.push(`Interval QT ${qtInterval.toFixed(2)} s (normal: ${normalParams.qtMin}-${normalParams.qtMax} s)`);
        isNormal = false;
    }

    chartResult.textContent = `Hasil: ${isNormal ? 'Normal' : 'Abnormal'}${isNormal ? '' : ' - ' + reasons.join(', ')}`;
    chartResult.className = `result-text ${isNormal ? 'result-normal' : 'result-abnormal'}`;
}

// Fungsi untuk menghasilkan sinyal EKG (hanya mode normal)
function generateSquareWaveToEKG()
{
    const time = [];
    const voltage = [];
    const f = frequency;
    const T = 1 / f;
    const TS = samplingPeriod / 1000;
    const VH = maxVoltage;
    const VL = minVoltage;

    let cycleStartTimes = [];
    let prevValue = VL;
    for (let t = 0; t <= maxTime; t += TS)
    {
        time.push(t);
        const phase = (t % T) / T;
        const squareValue = phase < 0.5 ? VH : VL;
        if (squareValue === VH && prevValue === VL) cycleStartTimes.push(t);
        prevValue = squareValue;
        voltage.push(0);
    }

    const pointsData = [];
    for (let cycle = 0; cycle < cycleStartTimes.length; cycle++)
    {
        const start = cycleStartTimes[cycle];
        const end = cycle < cycleStartTimes.length - 1 ? cycleStartTimes[cycle + 1] : maxTime;
        let bestP = null, bestQ = null, bestR = null, bestS = null, bestT = null;

        for (let t = 0; t < time.length; t++)
        {
            if (time[t] < start || time[t] >= end) continue;
            let value = 0;
            const scaledT = (time[t] - start) / T * 0.8;

            const p = 0.2 * Math.exp(-Math.pow((scaledT - 0.2) * 35, 2));
            const q = -0.15 * Math.exp(-Math.pow((scaledT - 0.3) * 80, 2));
            const r = 1.5 * Math.exp(-Math.pow((scaledT - 0.35) * waveSpeed, 2));
            const s = -0.5 * Math.exp(-Math.pow((scaledT - 0.375) * 150, 2));
            const t_wave = 0.45 * Math.exp(-Math.pow((scaledT - 0.6) * 30, 2));
            value = p + q + r + s + t_wave;

            voltage[t] = value;

            const threshold = 0.005;
            if (Math.abs(scaledT - 0.2) < threshold && (!bestP || Math.abs(value - 0.2) < Math.abs(bestP.y - 0.2)))
            {
                bestP = { x: time[t], y: value, label: 'P', pos: 'top', yoffset: 0.4 };
            }
            if (Math.abs(scaledT - 0.3) < threshold && (!bestQ || Math.abs(value + 0.15) < Math.abs(bestQ.y + 0.15)))
            {
                bestQ = { x: time[t], y: value, label: 'Q', pos: 'bottom', yoffset: -0.3 };
            }
            if (Math.abs(scaledT - 0.35) < threshold && (!bestR || Math.abs(value - 1.5) < Math.abs(bestR.y - 1.5)))
            {
                bestR = { x: time[t], y: value, label: 'R', pos: 'top', yoffset: 0.5 };
            }
            if (Math.abs(scaledT - 0.375) < threshold && (!bestS || Math.abs(value + 0.5) < Math.abs(bestS.y + 0.5)))
            {
                bestS = { x: time[t], y: value, label: 'S', pos: 'bottom', yoffset: -0.4 };
            }
            if (Math.abs(scaledT - 0.6) < threshold && (!bestT || Math.abs(value - 0.45) < Math.abs(bestT.y - 0.45)))
            {
                bestT = { x: time[t], y: value, label: 'T', pos: 'top', yoffset: 0.4 };
            }
        }

        if (bestP) pointsData.push(bestP);
        if (bestQ) pointsData.push(bestQ);
        if (bestR) pointsData.push(bestR);
        if (bestS) pointsData.push(bestS);
        if (bestT) pointsData.push(bestT);
    }

    const maxLabels = 5;
    const filteredPointsData = pointsData.filter((_, i) =>
    {
        const cycleIndex = Math.floor(cycleStartTimes.findIndex(start => start <= pointsData[i].x) / Math.ceil(cycleStartTimes.length / maxLabels));
        return cycleIndex < maxLabels;
    });

    const EKGTrace = {
        x: time,
        y: voltage,
        type: 'scatter',
        mode: 'lines',
        name: 'EKG Signal',
        line: { color: lineColor, width: lineWidth, shape: 'spline' }
    };

    const pointTrace = {
        x: filteredPointsData.map(p => p.x),
        y: filteredPointsData.map(p => p.y),
        mode: 'markers+text',
        type: 'scatter',
        text: filteredPointsData.map(p => p.label),
        textposition: filteredPointsData.map(p => p.pos === 'top' ? 'top center' : 'bottom center'),
        textfont: { family: 'Inter', size: 12, color: '#2d3748' },
        marker: { color: '#ff3b30', size: 8, symbol: 'circle', line: { width: 1, color: '#ffffff' } },
        name: 'PQRST Points',
        showlegend: false
    };

    const layout = {
        title: { text: `EKG (f = ${f.toFixed(2)} Hz, TS = ${samplingPeriod} ms)`, font: { family: 'Inter', size: 20, color: '#1a3c6e' }, x: 0.5, xanchor: 'center' },
        xaxis: { title: { text: 'Waktu (s)', font: { family: 'Inter', size: 14, color: '#2d3748' } }, range: [0, maxTime], dtick: timeInterval },
        yaxis: { title: { text: 'Tegangan (mV)', font: { family: 'Inter', size: 14, color: '#2d3748' } }, range: [minVoltage, maxVoltage], dtick: 0.5 },
        margin: { l: 60, r: 40, t: 80, b: 60 },
        plot_bgcolor: '#ffffff',
        paper_bgcolor: '#ffffff',
        showlegend: true,
        font: { family: 'Inter', color: '#2d3748' }
    };

    Plotly.newPlot(EKGChart, [EKGTrace, pointTrace], layout, { displayModeBar: false, responsive: true });
    analyzeMode(time, voltage, pointsData);
}

// Fungsi untuk menyimpan data canvas ke localStorage
function saveCanvasData()
{
    if (drawnPoints.length === 0)
    {
        alert('Tidak ada data di canvas untuk disimpan.');
        return;
    }

    const fileName = prompt('Masukkan nama untuk data (tanpa ekstensi .json):', 'ekg');
    if (!fileName) return;

    const path = `database/draw/${fileName}.json`;
    const dataToSave = {
        points: drawnPoints
    };

    localStorage.setItem(path, JSON.stringify(dataToSave));
    alert(`Data berhasil disimpan sebagai: ${path}`);
}

// Fungsi untuk menyimpan pengaturan ke localStorage
function saveSettingsData(settings)
{
    const path = 'database/settings/data.json';
    localStorage.setItem(path, JSON.stringify(settings));
    alert(`Pengaturan berhasil disimpan sebagai: ${path}`);
}

// Fungsi untuk memuat pengaturan dari localStorage saat aplikasi dimulai
function loadSettingsFromStorage()
{
    const path = 'database/settings/data.json';
    const savedSettings = localStorage.getItem(path);
    if (savedSettings)
    {
        const settings = JSON.parse(savedSettings);
        minVoltage = settings.minVoltage;
        maxVoltage = settings.maxVoltage;
        maxTime = settings.maxTime;
        timeInterval = settings.timeInterval;
        frequency = settings.frequency;
        samplingPeriod = settings.samplingPeriod;
        waveSpeed = settings.waveSpeed;
        lineWidth = settings.lineWidth;
        lineColor = settings.lineColor;
        normalParams = {
            freqMin: settings.freqMin,
            freqMax: settings.freqMax,
            pMin: settings.pMin,
            pMax: settings.pMax,
            qrsMin: settings.qrsMin,
            qrsMax: settings.qrsMax,
            qrsMaxLimit: settings.qrsMaxLimit,
            tMin: settings.tMin,
            tMax: settings.tMax,
            prMin: settings.prMin,
            prMax: settings.prMax,
            qrsDurationMax: settings.qrsDurationMax,
            qtMin: settings.qtMin,
            qtMax: settings.qtMax
        };

        // Perbarui nilai input di form settings
        document.getElementById('minVoltage').value = minVoltage;
        document.getElementById('maxVoltage').value = maxVoltage;
        document.getElementById('maxTime').value = maxTime;
        document.getElementById('timeInterval').value = timeInterval;
        document.getElementById('frequency').value = frequency;
        document.getElementById('samplingPeriod').value = samplingPeriod;
        document.getElementById('waveSpeed').value = waveSpeed;
        document.getElementById('lineWidth').value = lineWidth;
        document.getElementById('lineColor').value = lineColor;
        document.getElementById('freqMin').value = normalParams.freqMin;
        document.getElementById('freqMax').value = normalParams.freqMax;
        document.getElementById('pMin').value = normalParams.pMin;
        document.getElementById('pMax').value = normalParams.pMax;
        document.getElementById('qrsMin').value = normalParams.qrsMin;
        document.getElementById('qrsMax').value = normalParams.qrsMax;
        document.getElementById('qrsMaxLimit').value = normalParams.qrsMaxLimit;
        document.getElementById('tMin').value = normalParams.tMin;
        document.getElementById('tMax').value = normalParams.tMax;
        document.getElementById('prMin').value = normalParams.prMin;
        document.getElementById('prMax').value = normalParams.prMax;
        document.getElementById('qrsDurationMax').value = normalParams.qrsDurationMax;
        document.getElementById('qtMin').value = normalParams.qtMin;
        document.getElementById('qtMax').value = normalParams.qtMax;
    }
}

// Fungsi untuk mendapatkan daftar file yang disimpan
function getSavedDrawFiles()
{
    const files = [];
    for (let i = 0; i < localStorage.length; i++)
    {
        const key = localStorage.key(i);
        if (key.startsWith('database/draw/') && key.endsWith('.json'))
        {
            files.push(key.replace('database/draw/', '').replace('.json', ''));
        }
    }
    return files;
}

// Fungsi untuk memuat data dari popup
function loadCanvasData()
{
    let savedFiles = getSavedDrawFiles();
    if (savedFiles.length === 0)
    {
        alert('Tidak ada data yang disimpan untuk dimuat.');
        return;
    }

    // Buat popup
    const modal = document.createElement('div');
    modal.className = 'modal fade';
    modal.innerHTML = `
        <div class="modal-dialog modal-dialog-centered">
            <div class="modal-content">
                <div class="modal-header bg-primary text-white">
                    <h5 class="modal-title">Pilih Data untuk Dimuat</h5>
                    <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal" aria-label="Close"></button>
                </div>
                <div class="modal-body">
                    <ul class="list-group" id="fileList">
                        ${savedFiles.map(file => `
                            <li class="list-group-item d-flex justify-content-between align-items-center" data-file="${file}">
                                <span class="file-name">${file}</span>
                                <button class="btn btn-danger btn-sm delete-btn" data-file="${file}">
                                    <i class="bi bi-trash"></i>
                                </button>
                            </li>
                        `).join('')}
                    </ul>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    const bootstrapModal = new bootstrap.Modal(modal);
    bootstrapModal.show();

    const fileList = modal.querySelector('#fileList');

    // Event listener untuk klik pada nama file
    fileList.addEventListener('click', (e) =>
    {
        const fileItem = e.target.closest('.file-name');
        if (fileItem)
        {
            const fileName = fileItem.parentElement.getAttribute('data-file');
            const path = `database/draw/${fileName}.json`;
            const data = JSON.parse(localStorage.getItem(path));

            if (data)
            {
                // Bersihkan canvas
                drawnPoints = [];
                ctx.clearRect(0, 0, width, height);
                drawGrid();
                drawAxes();

                // Muat data dan gambar ulang
                drawnPoints = data.points;
                if (drawnPoints.length > 0)
                {
                    ctx.strokeStyle = lineColor;
                    ctx.lineWidth = lineWidth;
                    ctx.lineCap = 'round';
                    ctx.beginPath();
                    ctx.moveTo(drawnPoints[0][0], drawnPoints[0][1]);
                    for (let i = 1; i < drawnPoints.length; i++)
                    {
                        ctx.lineTo(drawnPoints[i][0], drawnPoints[i][1]);
                    }
                    ctx.stroke();
                    analyzeDrawing();
                }
                bootstrapModal.hide();
                document.body.removeChild(modal);
            }
        }
    });

    // Event listener untuk tombol delete
    fileList.addEventListener('click', (e) =>
    {
        const deleteBtn = e.target.closest('.delete-btn');
        if (deleteBtn)
        {
            const fileName = deleteBtn.getAttribute('data-file');
            const path = `database/draw/${fileName}.json`;
            if (confirm(`Apakah Anda yakin ingin menghapus file "${fileName}"?`))
            {
                localStorage.removeItem(path);
                // Perbarui daftar file
                savedFiles = getSavedDrawFiles();
                if (savedFiles.length === 0)
                {
                    bootstrapModal.hide();
                    document.body.removeChild(modal);
                    alert('Tidak ada data yang tersisa untuk dimuat.');
                    return;
                }
                fileList.innerHTML = savedFiles.map(file => `
                    <li class="list-group-item d-flex justify-content-between align-items-center" data-file="${file}">
                        <span class="file-name">${file}</span>
                        <button class="btn btn-danger btn-sm delete-btn" data-file="${file}">
                            <i class="bi bi-trash"></i>
                        </button>
                    </li>
                `).join('');
            }
        }
    });

    modal.addEventListener('hidden.bs.modal', () =>
    {
        document.body.removeChild(modal);
    });
}

// Generate grafik
generateBtn.addEventListener('click', () =>
{
    generateBtn.disabled = true;
    generateBtn.innerHTML = '<i class="bi bi-hourglass-split me-2"></i> Generating...';
    setTimeout(() =>
    {
        if (drawnPoints.length > 0)
        {
            const plotPoints = drawnPoints.map(([x, y]) => canvasToPlotCoords(x, y));
            const trace = {
                x: plotPoints.map(p => p.x),
                y: plotPoints.map(p => p.y),
                type: 'scatter',
                mode: 'lines',
                name: 'EKG Manual',
                line: { color: lineColor, width: lineWidth, shape: 'spline' }
            };
            Plotly.newPlot(EKGChart, [trace], getLayout(), { displayModeBar: false, responsive: true });
            analyzeDrawing();
            saveCanvasData();
        } else
        {
            generateSquareWaveToEKG();
        }
        generateBtn.disabled = false;
        generateBtn.innerHTML = '<i class="bi bi-play-circle me-2"></i> Generate';
    }, 500);
});

// Bersihkan canvas dan grafik
clearBtn.addEventListener('click', () =>
{
    drawnPoints = [];
    ctx.clearRect(0, 0, width, height);
    drawGrid();
    drawAxes();
    Plotly.newPlot(EKGChart, [], getLayout(), { displayModeBar: false, responsive: true });
    drawResult.textContent = 'Hasil: Tidak ada data';
    drawResult.className = 'result-text';
    chartResult.textContent = 'Hasil: Tidak ada data';
    chartResult.className = 'result-text';
});

// Event listener untuk tombol Load Data
loadDataBtn.addEventListener('click', loadCanvasData);

// Fungsi untuk mengambil data dari EKG Chart
function getEKGChartData()
{
    if (!EKGChart.data || EKGChart.data.length === 0)
    {
        return null;
    }
    const trace = EKGChart.data.find(d => d.name === 'EKG Signal' || d.name === 'EKG Manual');
    if (!trace)
    {
        return null;
    }
    return {
        time: trace.x,
        voltage: trace.y
    };
}

// Fungsi untuk mengirim data ke ESP32 melalui WebSocket
async function sendDataToESP()
{
    if (!socket || socket.readyState !== WebSocket.OPEN)
    {
        alert('Silakan hubungkan ke ESP32 terlebih dahulu.');
        return;
    }

    const EKGData = getEKGChartData();
    if (!EKGData)
    {
        alert('Tidak ada data EKG untuk dikirim. Silakan generate atau gambar sinyal terlebih dahulu.');
        return;
    }

    sendDataBtn.disabled = true;
    sendDataBtn.innerHTML = '<i class="bi bi-hourglass-split me-2"></i> Sending...';

    try
    {
        const dataLines = EKGData.time.map((t, i) => `${t.toFixed(3)},${EKGData.voltage[i].toFixed(3)}\n`);

        console.log('Mengirim data ke ESP32:');
        console.log('Format: "time (sumbu X), voltage (sumbu Y)" dalam satuan detik dan mV');
        console.log('Contoh data pertama:', dataLines[0]);

        alert(`Data EKG akan dikirim ke ESP32 dalam format CSV:\n` +
            `Setiap baris berisi: "time (sumbu X), voltage (sumbu Y)"\n` +
            `- Sumbu X: Waktu dalam detik (s)\n` +
            `- Sumbu Y: Tegangan dalam milivolt (mV)\n` +
            `Contoh baris: "${dataLines[0].trim()}"\n` +
            `Total data yang dikirim: ${dataLines.length} baris.`);

        for (const line of dataLines)
        {
            socket.send(line);
            await new Promise(resolve => setTimeout(resolve, 10));
        }
        socket.send('END');
        alert('Data EKG berhasil dikirim ke ESP32!');
    } catch (error)
    {
        console.error('Error mengirim data:', error);
        alert('Gagal mengirim data ke ESP32: ' + error.message);
    } finally
    {
        sendDataBtn.disabled = false;
        sendDataBtn.innerHTML = '<i class="bi bi-send me-2"></i> Send Data';
    }
}

// Event listener untuk tombol Send Data
sendDataBtn.addEventListener('click', sendDataToESP);

// Pengaturan tata letak grafik
function getLayout()
{
    return {
        xaxis: { title: { text: 'Waktu (s)', font: { family: 'Inter', size: 14, color: '#2d3748' } }, range: [0, maxTime], dtick: timeInterval },
        yaxis: { title: { text: 'Tegangan (mV)', font: { family: 'Inter', size: 14, color: '#2d3748' } }, range: [minVoltage, maxVoltage], dtick: 0.5 },
        margin: { l: 60, r: 40, t: 40, b: 60 }
    };
}

// Simpan pengaturan
saveSettingsBtn.addEventListener('click', () =>
{
    const settings = {
        minVoltage: document.getElementById('minVoltage').value,
        maxVoltage: document.getElementById('maxVoltage').value,
        maxTime: document.getElementById('maxTime').value,
        timeInterval: document.getElementById('timeInterval').value,
        frequency: document.getElementById('frequency').value,
        samplingPeriod: document.getElementById('samplingPeriod').value,
        waveSpeed: document.getElementById('waveSpeed').value,
        lineWidth: document.getElementById('lineWidth').value,
        lineColor: document.getElementById('lineColor').value,
        freqMin: document.getElementById('freqMin').value,
        freqMax: document.getElementById('freqMax').value,
        pMin: document.getElementById('pMin').value,
        pMax: document.getElementById('pMax').value,
        qrsMin: document.getElementById('qrsMin').value,
        qrsMax: document.getElementById('qrsMax').value,
        qrsMaxLimit: document.getElementById('qrsMaxLimit').value,
        tMin: document.getElementById('tMin').value,
        tMax: document.getElementById('tMax').value,
        prMin: document.getElementById('prMin').value,
        prMax: document.getElementById('prMax').value,
        qrsDurationMax: document.getElementById('qrsDurationMax').value,
        qtMin: document.getElementById('qtMin').value,
        qtMax: document.getElementById('qtMax').value
    };

    // Validasi input
    const numericFields = [
        { key: 'minVoltage', label: 'Min Voltage' },
        { key: 'maxVoltage', label: 'Max Voltage' },
        { key: 'maxTime', label: 'Max Time' },
        { key: 'timeInterval', label: 'Time Interval' },
        { key: 'frequency', label: 'Frequency' },
        { key: 'samplingPeriod', label: 'Sampling Period' },
        { key: 'waveSpeed', label: 'Wave Speed' },
        { key: 'lineWidth', label: 'Line Width' },
        { key: 'freqMin', label: 'Min Frequency' },
        { key: 'freqMax', label: 'Max Frequency' },
        { key: 'pMin', label: 'P Wave Min Amplitude' },
        { key: 'pMax', label: 'P Wave Max Amplitude' },
        { key: 'qrsMin', label: 'QRS Min Amplitude' },
        { key: 'qrsMax', label: 'QRS Max Amplitude' },
        { key: 'qrsMaxLimit', label: 'QRS Max Limit' },
        { key: 'tMin', label: 'T Wave Min Amplitude' },
        { key: 'tMax', label: 'T Wave Max Amplitude' },
        { key: 'prMin', label: 'PR Interval Min' },
        { key: 'prMax', label: 'PR Interval Max' },
        { key: 'qrsDurationMax', label: 'QRS Duration Max' },
        { key: 'qtMin', label: 'QT Interval Min' },
        { key: 'qtMax', label: 'QT Interval Max' }
    ];

    for (const field of numericFields)
    {
        const value = settings[field.key];
        if (!value || isNaN(parseFloat(value)))
        {
            return alert(`Harap masukkan nilai numerik yang valid untuk ${field.label}.`);
        }
        settings[field.key] = parseFloat(value);
    }

    if (settings.minVoltage >= settings.maxVoltage) return alert('Tegangan minimum harus lebih kecil dari tegangan maksimum.');
    if (settings.maxTime <= 0) return alert('Waktu maksimum harus lebih besar dari 0.');
    if (settings.timeInterval <= 0 || settings.timeInterval > settings.maxTime) return alert('Interval waktu harus lebih besar dari 0 dan tidak lebih besar dari waktu maksimum.');
    if (settings.frequency <= 0) return alert('Frekuensi harus lebih besar dari 0.');
    if (settings.samplingPeriod <= 0) return alert('Periode sampling harus lebih besar dari 0.');
    if (settings.waveSpeed < 50 || settings.waveSpeed > 1000) return alert('Wave speed harus antara 50 dan 1000.');
    if (settings.lineWidth <= 0) return alert('Ketebalan garis harus lebih besar dari 0.');
    if (settings.freqMin >= settings.freqMax) return alert('Frekuensi minimum harus lebih kecil dari frekuensi maksimum.');
    if (settings.pMin >= settings.pMax) return alert('Amplitudo P minimum harus lebih kecil dari maksimum.');
    if (settings.qrsMin >= settings.qrsMax) return alert('Amplitudo QRS minimum harus lebih kecil dari maksimum.');
    if (settings.qrsMax >= settings.qrsMaxLimit) return alert('Amplitudo QRS maksimum harus lebih kecil dari batas maksimum.');
    if (settings.tMin >= settings.tMax) return alert('Amplitudo T minimum harus lebih kecil dari maksimum.');
    if (settings.prMin >= settings.prMax) return alert('Interval PR minimum harus lebih kecil dari maksimum.');
    if (settings.qtMin >= settings.qtMax) return alert('Interval QT minimum harus lebih kecil dari maksimum.');

    // Perbarui pengaturan
    minVoltage = settings.minVoltage;
    maxVoltage = settings.maxVoltage;
    maxTime = settings.maxTime;
    timeInterval = settings.timeInterval;
    frequency = settings.frequency;
    samplingPeriod = settings.samplingPeriod;
    waveSpeed = settings.waveSpeed;
    lineWidth = settings.lineWidth;
    lineColor = settings.lineColor;
    normalParams = {
        freqMin: settings.freqMin,
        freqMax: settings.freqMax,
        pMin: settings.pMin,
        pMax: settings.pMax,
        qrsMin: settings.qrsMin,
        qrsMax: settings.qrsMax,
        qrsMaxLimit: settings.qrsMaxLimit,
        tMin: settings.tMin,
        tMax: settings.tMax,
        prMin: settings.prMin,
        prMax: settings.prMax,
        qrsDurationMax: settings.qrsDurationMax,
        qtMin: settings.qtMin,
        qtMax: settings.qtMax
    };

    // Simpan pengaturan ke localStorage
    saveSettingsData(settings);

    // Terapkan pengaturan ke canvas dan chart
    resizeCanvas();
    updateEKGChart();
    drawResult.textContent = 'Hasil: Tidak ada data';
    drawResult.className = 'result-text';
    chartResult.textContent = 'Hasil: Tidak ada data';
    chartResult.className = 'result-text';
    bootstrap.Modal.getInstance(document.getElementById('settingsModal')).hide();
});

// Koneksi ke ESP32 menggunakan WebSocket
connectESPBtn.addEventListener('click', () =>
{
    const ip = espIPInput.value.trim();
    const port = espPortInput.value.trim();

    // Validasi IP dan Port
    const ipRegex = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/;
    if (!ipRegex.test(ip))
    {
        alert('Masukkan IP address yang valid (contoh: 192.168.1.100).');
        return;
    }
    if (!port || isNaN(port) || port < 1 || port > 65535)
    {
        alert('Masukkan port yang valid (1-65535).');
        return;
    }

    // Jika sudah terhubung, tutup koneksi sebelumnya
    if (socket)
    {
        socket.close();
        socket = null;
        connectionStatus.textContent = 'Tidak Terhubung';
        connectionStatus.className = 'text-muted';
    }

    // Buat koneksi WebSocket
    const wsURL = `ws://${ip}:${port}`;
    socket = new WebSocket(wsURL);

    socket.onopen = () =>
    {
        connectionStatus.textContent = 'Terhubung';
        connectionStatus.className = 'text-success';
    };

    socket.onerror = (error) =>
    {
        console.error('WebSocket Error:', error);
        connectionStatus.textContent = 'Gagal Terhubung';
        connectionStatus.className = 'text-danger';
        socket = null;
    };

    socket.onclose = () =>
    {
        connectionStatus.textContent = 'Tidak Terhubung';
        connectionStatus.className = 'text-muted';
        socket = null;
    };

    socket.onmessage = (event) =>
    {
        console.log('Pesan dari ESP32:', event.data);
    };
});

// Inisialisasi
resizeCanvas();
Plotly.newPlot(EKGChart, [], getLayout(), { displayModeBar: false, responsive: true });
drawResult.textContent = 'Hasil: Tidak ada data';
drawResult.className = 'result-text';
chartResult.textContent = 'Hasil: Tidak ada data';
chartResult.className = 'result-text';