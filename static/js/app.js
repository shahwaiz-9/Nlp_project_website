// Global UI Elements
const btnRecord = document.getElementById('btn-record');
const btnAnalyzeUpload = document.getElementById('btn-analyze-upload');
const btnClearHistory = document.getElementById('btn-clear-history');
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const fileInfo = document.getElementById('file-info');
const recordingTimer = document.getElementById('recording-timer');
const resultsPlaceholder = document.getElementById('results-placeholder');
const resultsLoader = document.getElementById('results-loader');
const resultsContent = document.getElementById('results-content');
const detectedEmoji = document.getElementById('detected-emoji');
const detectedEmotion = document.getElementById('detected-emotion');
const detectedConfidence = document.getElementById('detected-confidence');
const detectedBar = document.getElementById('detected-bar');
const breakdownList = document.getElementById('breakdown-list');
const historyTable = document.getElementById('history-table');
const historyTbody = document.getElementById('history-tbody');
const historyEmpty = document.getElementById('history-empty');
const canvas = document.getElementById('visualizer');
const canvasCtx = canvas.getContext('2d');

// Global Recording Variables
let isRecording = false;
let audioContext;
let mediaStream;
let recNode;
let audioBuffer = [];
let recordingLength = 0;
let secondsElapsed = 0;
let timerInterval;
let recordedBlob = null;
let selectedFile = null;

// Emotion UI Mapping (Emoji & Color CSS Variable Name)
const emotionConfig = {
    'angry': { emoji: '😠', colorVar: '--glow-angry' },
    'calm': { emoji: '😌', colorVar: '--glow-calm' },
    'disgust': { emoji: '🤢', colorVar: '--glow-disgust' },
    'fear': { emoji: '😨', colorVar: '--glow-fear' },
    'fearful': { emoji: '😰', colorVar: '--glow-fearful' },
    'happy': { emoji: '😊', colorVar: '--glow-happy' },
    'neutral': { emoji: '😐', colorVar: '--glow-neutral' },
    'ps': { emoji: '😲', colorVar: '--glow-ps' }, // Pleasant Surprise
    'sad': { emoji: '😢', colorVar: '--glow-sad' },
    'surprised': { emoji: '😮', colorVar: '--glow-surprised' }
};

// Initialize Page
document.addEventListener('DOMContentLoaded', () => {
    fetchHistory();
    drawStaticVisualizer();
});

// Draw Static Visualizer line on start
function drawStaticVisualizer() {
    const width = canvas.width;
    const height = canvas.height;
    canvasCtx.clearRect(0, 0, width, height);
    canvasCtx.lineWidth = 2;
    canvasCtx.strokeStyle = 'rgba(0, 245, 212, 0.2)';
    canvasCtx.beginPath();
    canvasCtx.moveTo(0, height / 2);
    canvasCtx.lineTo(width, height / 2);
    canvasCtx.stroke();
}

// Draw visualizer frame during recording
function drawVisualizerFrame(samples) {
    const width = canvas.width;
    const height = canvas.height;
    canvasCtx.clearRect(0, 0, width, height);
    canvasCtx.lineWidth = 2;
    canvasCtx.strokeStyle = '#00f5d4'; // Cyan glow line
    canvasCtx.shadowBlur = 4;
    canvasCtx.shadowColor = '#00f5d4';
    canvasCtx.beginPath();
    
    const sliceWidth = width / samples.length;
    let x = 0;
    
    for (let i = 0; i < samples.length; i++) {
        // Boost gain for visual effect
        const v = samples[i] * 2.2;
        const y = (v + 1) * height / 2;
        
        if (i === 0) {
            canvasCtx.moveTo(x, y);
        } else {
            canvasCtx.lineTo(x, y);
        }
        x += sliceWidth;
    }
    
    canvasCtx.stroke();
    canvasCtx.shadowBlur = 0; // Reset
}

// ----------------- Live Recording Flow -----------------

btnRecord.addEventListener('click', () => {
    if (!isRecording) {
        startRecording();
    } else {
        stopRecording();
    }
});

async function startRecording() {
    audioBuffer = [];
    recordingLength = 0;
    recordedBlob = null;
    secondsElapsed = 0;
    recordingTimer.textContent = '00:00';
    
    try {
        // Get user microphone stream
        mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        
        // Initialize AudioContext
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const source = audioContext.createMediaStreamSource(mediaStream);
        
        // Create ScriptProcessorNode for raw PCM extraction (bufferSize=4096)
        recNode = audioContext.createScriptProcessor(4096, 1, 1);
        
        recNode.onaudioprocess = (e) => {
            if (!isRecording) return;
            const input = e.inputBuffer.getChannelData(0);
            audioBuffer.push(new Float32Array(input));
            recordingLength += input.length;
            
            // Draw real-time waves
            drawVisualizerFrame(input);
        };
        
        source.connect(recNode);
        recNode.connect(audioContext.destination);
        
        // Update UI State
        isRecording = true;
        btnRecord.classList.add('recording');
        btnRecord.querySelector('.btn-icon').textContent = '■';
        btnRecord.querySelector('.btn-text').textContent = 'Stop & Analyze';
        
        // Start Timer
        timerInterval = setInterval(() => {
            secondsElapsed++;
            const mins = String(Math.floor(secondsElapsed / 60)).padStart(2, '0');
            const secs = String(secondsElapsed % 60).padStart(2, '0');
            recordingTimer.textContent = `${mins}:${secs}`;
            
            // Auto stop at 10 seconds to avoid giant uploads
            if (secondsElapsed >= 15) {
                stopRecording();
            }
        }, 1000);
        
    } catch (err) {
        console.error('Failed to access microphone:', err);
        alert('Could not access microphone. Please check permissions and try again.');
        drawStaticVisualizer();
    }
}

async function stopRecording() {
    if (!isRecording) return;
    
    // Clear Recording State
    isRecording = false;
    clearInterval(timerInterval);
    btnRecord.classList.remove('recording');
    btnRecord.querySelector('.btn-icon').textContent = '●';
    btnRecord.querySelector('.btn-text').textContent = 'Start Recording';
    
    // Close Stream and Nodes
    if (mediaStream) {
        mediaStream.getTracks().forEach(track => track.stop());
    }
    if (recNode) {
        recNode.disconnect();
    }
    if (audioContext) {
        await audioContext.close();
    }
    
    drawStaticVisualizer();
    
    if (recordingLength === 0) {
        alert('No audio captured.');
        return;
    }
    
    // Flatten audioBuffer
    const samples = new Float32Array(recordingLength);
    let offset = 0;
    for (let i = 0; i < audioBuffer.length; i++) {
        samples.set(audioBuffer[i], offset);
        offset += audioBuffer[i].length;
    }
    
    // Encode samples to WAV (mono 16-bit) at the audio context's sample rate
    const recordedSampleRate = audioContext.sampleRate;
    recordedBlob = encodeWAV(samples, recordedSampleRate);
    
    // Send to server
    analyzeAudioFile(recordedBlob, 'microphone_record.wav');
}

// WAV Encoder (16-bit PCM Mono)
function encodeWAV(samples, sampleRate) {
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);
    
    const writeString = (view, offset, string) => {
        for (let i = 0; i < string.length; i++) {
            view.setUint8(offset + i, string.charCodeAt(i));
        }
    };
    
    /* RIFF identifier */
    writeString(view, 0, 'RIFF');
    /* file length */
    view.setUint32(4, 36 + samples.length * 2, true);
    /* RIFF type */
    writeString(view, 8, 'WAVE');
    /* format chunk identifier */
    writeString(view, 12, 'fmt ');
    /* format chunk length */
    view.setUint32(16, 16, true);
    /* sample format (raw PCM = 1) */
    view.setUint16(20, 1, true);
    /* channel count (Mono = 1) */
    view.setUint16(22, 1, true);
    /* sample rate */
    view.setUint32(24, sampleRate, true);
    /* byte rate (sample rate * block align) */
    view.setUint32(28, sampleRate * 2, true);
    /* block align (channels * bytes per sample) */
    view.setUint16(32, 2, true);
    /* bits per sample */
    view.setUint16(34, 16, true);
    /* data chunk identifier */
    writeString(view, 36, 'data');
    /* data chunk length */
    view.setUint32(40, samples.length * 2, true);
    
    // Write the PCM audio samples
    let index = 44;
    for (let i = 0; i < samples.length; i++) {
        const s = Math.max(-1, Math.min(1, samples[i]));
        view.setInt16(index, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
        index += 2;
    }
    
    return new Blob([view], { type: 'audio/wav' });
}

// ----------------- File Drag & Drop Flow -----------------

dropZone.addEventListener('click', () => {
    fileInput.click();
});

fileInput.addEventListener('change', (e) => {
    handleFileSelection(e.target.files[0]);
});

dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
});

['dragleave', 'dragend'].forEach(type => {
    dropZone.addEventListener(type, () => {
        dropZone.classList.remove('dragover');
    });
});

dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    handleFileSelection(e.dataTransfer.files[0]);
});

function handleFileSelection(file) {
    if (!file) return;
    
    if (!file.name.endsWith('.wav')) {
        alert('Please select a valid .wav file.');
        return;
    }
    
    selectedFile = file;
    dropZone.classList.add('file-selected');
    
    const fileSizeMB = (file.size / (1024 * 1024)).toFixed(2);
    fileInfo.innerHTML = `<strong>Selected:</strong> ${file.name} (${fileSizeMB} MB)`;
    btnAnalyzeUpload.disabled = false;
}

btnAnalyzeUpload.addEventListener('click', () => {
    if (selectedFile) {
        analyzeAudioFile(selectedFile, selectedFile.name);
    }
});

// ----------------- Inference API Requests -----------------

function analyzeAudioFile(blobOrFile, filename) {
    // Show Loading state
    resultsPlaceholder.style.display = 'none';
    resultsContent.style.display = 'none';
    resultsLoader.style.display = 'flex';
    
    // Reset borders
    const resultsContainer = document.getElementById('results-card-container');
    resultsContainer.style.setProperty('--card-border-glow', 'rgba(138, 43, 226, 0.35)');
    resultsContainer.style.removeProperty('--emotion-glow');
    
    // Prepare Multi-part Form Data
    const formData = new FormData();
    formData.append('audio', blobOrFile, filename);
    
    fetch('/analyze', {
        method: 'POST',
        body: formData
    })
    .then(response => {
        if (!response.ok) {
            throw new Error(`Server returned status ${response.status}`);
        }
        return response.json();
    })
    .then(data => {
        if (data.success) {
            renderResults(data);
            fetchHistory();
        } else {
            showErrorState(data.error || 'Failed to analyze audio.');
        }
    })
    .catch(err => {
        console.error('Analysis error:', err);
        showErrorState(err.message || 'An error occurred during submission.');
    });
}

function renderResults(data) {
    const emotion = data.emotion;
    const confidence = data.confidence;
    const probabilities = data.probabilities;
    
    const config = emotionConfig[emotion.toLowerCase()] || { emoji: '🎙️', colorVar: '--glow-neutral' };
    const emotionColor = getComputedStyle(document.documentElement).getPropertyValue(config.colorVar).trim();
    
    // Update Results Card colors and borders
    const resultsContainer = document.getElementById('results-card-container');
    resultsContainer.style.setProperty('--card-border-glow', emotionColor);
    
    const primaryResult = document.querySelector('.primary-result');
    primaryResult.style.setProperty('--emotion-glow', emotionColor);
    
    // Render Primary Emotion
    detectedEmoji.textContent = config.emoji;
    detectedEmotion.textContent = emotion;
    detectedConfidence.textContent = `${(confidence * 100).toFixed(1)}%`;
    detectedBar.style.width = `${confidence * 100}%`;
    detectedBar.style.background = `linear-gradient(90deg, var(--clr-purple) 0%, ${config.colorVar} 100%)`;
    detectedBar.style.boxShadow = `0 0 10px ${emotionColor}`;
    
    // Render Probability Bars
    breakdownList.innerHTML = '';
    
    // Sort emotions by highest probability first
    const sortedEmotions = Object.entries(probabilities)
        .sort((a, b) => b[1] - a[1]);
        
    sortedEmotions.forEach(([emName, prob]) => {
        const percentage = (prob * 100).toFixed(1);
        const emConf = emotionConfig[emName.toLowerCase()] || { colorVar: '--clr-purple' };
        
        const row = document.createElement('div');
        row.className = 'breakdown-row';
        row.innerHTML = `
            <div class="bar-label">${emName}</div>
            <div class="bar-wrapper">
                <div class="bar-fill" style="width: ${percentage}%; --bar-color: var(${emConf.colorVar})"></div>
            </div>
            <div class="bar-percent">${percentage}%</div>
        `;
        breakdownList.appendChild(row);
    });
    
    // Update UI panels visibility
    resultsLoader.style.display = 'none';
    resultsContent.style.display = 'block';
}

function showErrorState(errorMsg) {
    resultsLoader.style.display = 'none';
    resultsContent.style.display = 'none';
    resultsPlaceholder.style.display = 'flex';
    resultsPlaceholder.querySelector('.placeholder-icon').textContent = '⚠️';
    resultsPlaceholder.querySelector('p').textContent = 'Inference Failed';
    resultsPlaceholder.querySelector('span').textContent = errorMsg;
}

// ----------------- History Management -----------------

function fetchHistory() {
    fetch('/history')
        .then(res => res.json())
        .then(data => {
            renderHistoryTable(data.history);
        })
        .catch(err => console.error('Error fetching history:', err));
}

function renderHistoryTable(historyList) {
    if (!historyList || historyList.length === 0) {
        historyTable.style.display = 'none';
        btnClearHistory.style.display = 'none';
        historyEmpty.style.display = 'flex';
        return;
    }
    
    historyTbody.innerHTML = '';
    
    historyList.forEach(item => {
        const confPct = `${(item.confidence * 100).toFixed(1)}%`;
        const config = emotionConfig[item.emotion.toLowerCase()] || { colorVar: '--glow-neutral' };
        
        // format timestamp (from "YYYY-MM-DD HH:MM:SS" to "HH:MM:SS")
        const timePart = item.timestamp.split(' ')[1] || item.timestamp;
        
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td class="td-time">${timePart}</td>
            <td class="td-source" title="${item.filename}">${item.filename}</td>
            <td>
                <span class="emotion-pill" style="background: rgba(255,255,255,0.04); border: 1px solid var(${config.colorVar}); color: var(${config.colorVar})">
                    ${item.emotion}
                </span>
            </td>
            <td><strong>${confPct}</strong></td>
        `;
        historyTbody.appendChild(tr);
    });
    
    historyEmpty.style.display = 'none';
    historyTable.style.display = 'table';
    btnClearHistory.style.display = 'block';
}

btnClearHistory.addEventListener('click', () => {
    if (!confirm('Are you sure you want to clear your prediction history for this session?')) return;
    
    fetch('/history/clear', { method: 'POST' })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                fetchHistory();
            }
        })
        .catch(err => console.error('Error clearing history:', err));
});
