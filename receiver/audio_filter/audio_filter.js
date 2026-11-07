/**
 * audio_filter.js
 * A plugin concept for OpenWebRX+ to improve audio quality (SSB, AM & Digital).
 * Features: EQ, Noise Blanker, Hang-AGC/Compressor, Auto-Notch.
 *
 * License: MIT
 * Copyright (c) 2025 DL1HQH
 */

(function() {
    'use strict';

    const PLUGIN_ID = "audio_filter";

    // Configuration for different modulations
    const CONFIG = {
        ssb: {
            highpassFreq: null,
            lowpassFreq: 13500,  // Treble optimized for SSB
            peakingFreq: 521.8739192045387,  // Shifted to 2000Hz for more presence
            peakingQ: 0.5,
            peakingGain: 12.87,
            gain: 0.9,
            agcTarget: 0.50,
            maxBoost: 35.0,
            notchQ: 30,
            maxNotches: 4,
            compHPF: 325,
            compLPF: 1475,
            nr_gain: 5,         // dB
            nr_alpha: 0.95,
            nr_snr: 24,         // dB
            nr_comb: 0.0,
            nr_speech_mode: true,
            airGain: 9.0,
            airFreq: 1475
        },
        am: {
            highpassFreq: 219,   // (Full warmth for tube sound)
            lowpassFreq: 13500,  // Treble rolled off (Vintage radio style)
            peakingFreq: 675.6313495618042,   // Boost low-mids for body/warmth
            peakingQ: 0.5,
            peakingGain: 18.48,
            gain: 0.9,
            agcTarget: 0.50,
            maxBoost: 19,
            notchQ: 30,
            maxNotches: 4,
            compHPF: 175,
            compLPF: 1325,
            nr_gain: 10,
            nr_alpha: 0.9723,
            nr_snr: 26,
            nr_comb: 0.1,
            nr_speech_mode: false,
            airFreq: 1325
        },
        cw: {
            highpassFreq: 300,
            lowpassFreq: 900,
            peakingFreq: 600,
            peakingQ: 3.0,
            peakingGain: 3.3,
            gain: 0.9,
            agcTarget: 0.40,
            maxBoost: 20.0,
            notchQ: 40,
            maxNotches: 4,
            compHPF: 400,
            compLPF: 1500,
            nr_gain: 0,
            nr_alpha: 0.9800,
            nr_snr: 30,
            nr_comb: 0.5,
            nr_speech_mode: false,
            airFreq: 1500
        },
        nfm: {
            highpassFreq: 50,
            lowpassFreq: 11100,
            peakingFreq: 2500,
            peakingQ: 0.7,
            peakingGain: 3.3,
            gain: 0.9,
            agcTarget: 0.50,
            maxBoost: 20.0,
            notchQ: 30,
            maxNotches: 4,
            compHPF: 250,
            compLPF: 5000,
            nr_gain: 0,
            nr_alpha: 0.9800,
            nr_snr: 30,
            nr_comb: 0.5,
            nr_speech_mode: true,
            airFreq: 5000
        },
        wfm: {
            highpassFreq: 50,
            lowpassFreq: 11100,
            peakingFreq: 8000,
            peakingQ: 0.5,
            peakingGain: 3.3,
            gain: 0.9,
            agcTarget: 0.50,
            maxBoost: 6.0,
            notchQ: 30,
            maxNotches: 4,
            compHPF: 100,
            compLPF: 8000,
            nr_gain: 0,
            nr_alpha: 0.95,
            nr_snr: 10,
            nr_comb: 0.5,
            nr_speech_mode: false,
            airFreq: 8000
        },
        digital: {
            highpassFreq: 50,
            lowpassFreq: 11100,
            peakingFreq: 2500,
            peakingQ: 0.7,
            peakingGain: 3.3,
            gain: 0.9,
            agcTarget: 0.50,
            maxBoost: 20.0,
            notchQ: 30,
            maxNotches: 4,
            compHPF: 50,
            compLPF: 8000,
            nr_gain: 0,
            nr_alpha: 0.95,
            nr_snr: 10,
            nr_comb: 0.5,
            nr_speech_mode: false,
            airFreq: 8000
        }
    };

    // References to filter nodes for updating
    let activeFilters = {
        highpass: null,
        lowpass: null,
        nbProcessor: null,
        nrProcessor: null,
        compProcessor: null,
        expanderProcessor: null,
        limiterProcessor: null,
        loudness: null,
        air: null,
        compHighpass: null,
        compLowpass: null,
        peaking: null,
        gain: null,
        analyser: null,
        outputAnalyser: null,
        notches: [],
        humFilters: []
    };
    let analysisBuffer = null;
    let filterModulesPromise = null;
    let last_modulation = '';
    let is_filter_enabled = false;
    let is_nb_enabled = false;
    let is_nr_enabled = false;
    let is_compressor_enabled = false;
    let is_autonotch_enabled = false;
    let is_hum_filter_enabled = false;
    let is_expander_enabled = false;
    let is_limiter_enabled = false;
    let is_loudness_enabled = false;
    let is_dtln_enabled = false;
    let show_input_spectrum = localStorage.getItem('openwebrx-audio-filter-show-in-spec') !== 'false';
    let show_output_spectrum = localStorage.getItem('openwebrx-audio-filter-show-out-spec') !== 'false';
    let is_initialized = false;

    const SETTING_KEYS = [
        'highpassFreq', 'lowpassFreq', 'peakingGain', 'peakingFreq', 'peakingQ', 'gain',
        'agcTarget', 'maxBoost', 'gateThresh', 'hangTime', 'recoveryTime', 'compGain',
        'notchQ', 'maxNotches', 'notchRange', 'notchCenter', 'compHPF', 'compLPF',
        'airGain', 'airFreq', 'nr_gain', 'nr_alpha', 'nr_snr', 'nr_comb', 'nr_speech_mode',
        'dtln_gain', 'dtln_floor', 'dtln_presence', 'dtln_mix', 'rn_target', 'rn_boost', 'rn_mix',
        'humFrequency', 'humHarmonics', 'expanderThresholdDb', 'expanderFloorDb', 'expanderRatio', 'limiterCeilingDb'
    ];

    function create_empty_settings() {
        return SETTING_KEYS.reduce((acc, key) => { acc[key] = null; return acc; }, {});
    }

    let override_settings = create_empty_settings();

    let settings_store = {
        ssb: create_empty_settings(),
        am: create_empty_settings(),
        cw: create_empty_settings(),
        nfm: create_empty_settings(),
        wfm: create_empty_settings(),
        digital: create_empty_settings()
    };

    function get_config_mode(mod) {
        if (!mod) return 'ssb';
        mod = String(mod).toLowerCase();
        if (mod === 'am') return 'am';
        if (mod === 'cw') return 'cw';
        if (mod === 'nfm' || mod === 'fm') return 'nfm';
        if (mod === 'wfm') return 'wfm';
        if (['dmr', 'ysf', 'dstar', 'nxdn', 'm17', 'p25', 'freedv'].includes(mod)) return 'digital';
        return 'ssb'; // lsb, usb, etc.
    }

    function saveSettings() {
        let modKey = get_config_mode(last_modulation);
        settings_store[modKey] = JSON.parse(JSON.stringify(override_settings));
        localStorage.setItem('openwebrx-audio-filter-settings', JSON.stringify(settings_store));
    }

    const originalConnect = AudioNode.prototype.connect;

    AudioNode.prototype.connect = function(destination, output, input) {
        const isAudioDestination = destination && destination.context &&
            destination === destination.context.destination;
        if (isAudioDestination) {
            let ctx = destination.context;

            if (!activeFilters.highpass || activeFilters.highpass.context !== ctx) {
                setupFilters(ctx);
            }

            if (!this.isCustomFilter) {
                return originalConnect.call(this, activeFilters.inputProxy, output, input);
            }
        }
        return originalConnect.apply(this, arguments);
    };

    const FFT_SIZE = 1024;
    const bitRev = new Uint16Array(FFT_SIZE);
    const cosTable = new Float32Array(FFT_SIZE / 2);
    const sinTable = new Float32Array(FFT_SIZE / 2);
    const fft_win = new Float32Array(FFT_SIZE);

    (function initFFT() {
        let m = 0, temp = FFT_SIZE;
        while (temp > 1) { temp >>= 1; m++; }
        for (let i = 0; i < FFT_SIZE; i++) {
            let j = 0, k = i;
            for (let l = 0; l < m; l++) { j = (j << 1) | (k & 1); k >>= 1; }
            bitRev[i] = j;
        }
        for (let i = 0; i < FFT_SIZE / 2; i++) {
            const theta = -2 * Math.PI * i / FFT_SIZE;
            cosTable[i] = Math.cos(theta);
            sinTable[i] = Math.sin(theta);
        }
        for(let i=0; i<FFT_SIZE; i++) fft_win[i] = Math.sin(Math.PI * i / FFT_SIZE);
    })();

    function performFFT(real, imag, inverse) {
        for (let i = 0; i < FFT_SIZE; i++) {
            const j = bitRev[i];
            if (i < j) {
                const tr = real[i]; real[i] = real[j]; real[j] = tr;
                const ti = imag[i]; imag[i] = imag[j]; imag[j] = ti;
            }
        }
        let halfSize = 1;
        while (halfSize < FFT_SIZE) {
            const step = FFT_SIZE / (2 * halfSize);
            for (let i = 0; i < FFT_SIZE; i += 2 * halfSize) {
                for (let k = 0, tIdx = 0; k < halfSize; k++, tIdx += step) {
                    const t_cos = cosTable[tIdx];
                    const t_sin = inverse ? -sinTable[tIdx] : sinTable[tIdx];
                    const j = i + k + halfSize;
                    const tr = t_cos * real[j] - t_sin * imag[j];
                    const ti = t_cos * imag[j] + t_sin * real[j];
                    real[j] = real[i + k] - tr;
                    imag[j] = imag[i + k] - ti;
                    real[i + k] += tr;
                    imag[i + k] += ti;
                }
            }
            halfSize <<= 1;
        }
        if (inverse) {
            const invSize = 1.0 / FFT_SIZE;
            for (let i = 0; i < FFT_SIZE; i++) { real[i] *= invSize; imag[i] *= invSize; }
        }
    }

    const DTLN_BLOCK = 512;
    const DTLN_HOP = 128;
    const DTLN_RATE = 16000;
    const DTLN_RING_SIZE = 65536;
    const DTLN_STATE_LEN = 1 * 2 * 128 * 2;
    const RNNOISE_FRAME = 480;

    const dtlnBitRev = new Uint16Array(DTLN_BLOCK);
    const dtlnCos = new Float32Array(DTLN_BLOCK / 2);
    const dtlnSin = new Float32Array(DTLN_BLOCK / 2);
    const dtlnReal = new Float32Array(DTLN_BLOCK);
    const dtlnImag = new Float32Array(DTLN_BLOCK);
    const dtlnMag = new Float32Array(DTLN_BLOCK / 2 + 1);
    const dtlnPhase = new Float32Array(DTLN_BLOCK / 2 + 1);

    (function initDtlnFFT() {
        let m = 0, temp = DTLN_BLOCK;
        while (temp > 1) { temp >>= 1; m++; }
        for (let i = 0; i < DTLN_BLOCK; i++) {
            let j = 0, k = i;
            for (let l = 0; l < m; l++) { j = (j << 1) | (k & 1); k >>= 1; }
            dtlnBitRev[i] = j;
        }
        for (let i = 0; i < DTLN_BLOCK / 2; i++) {
            const theta = -2 * Math.PI * i / DTLN_BLOCK;
            dtlnCos[i] = Math.cos(theta);
            dtlnSin[i] = Math.sin(theta);
        }
    })();

    function dtlnFFT(real, imag, inverse) {
        for (let i = 0; i < DTLN_BLOCK; i++) {
            const j = dtlnBitRev[i];
            if (i < j) {
                const tr = real[i]; real[i] = real[j]; real[j] = tr;
                const ti = imag[i]; imag[i] = imag[j]; imag[j] = ti;
            }
        }
        let halfSize = 1;
        while (halfSize < DTLN_BLOCK) {
            const step = DTLN_BLOCK / (2 * halfSize);
            for (let i = 0; i < DTLN_BLOCK; i += 2 * halfSize) {
                for (let k = 0, tIdx = 0; k < halfSize; k++, tIdx += step) {
                    const t_cos = dtlnCos[tIdx];
                    const t_sin = inverse ? -dtlnSin[tIdx] : dtlnSin[tIdx];
                    const j = i + k + halfSize;
                    const tr = t_cos * real[j] - t_sin * imag[j];
                    const ti = t_cos * imag[j] + t_sin * real[j];
                    real[j] = real[i + k] - tr;
                    imag[j] = imag[i + k] - ti;
                    real[i + k] += tr;
                    imag[i + k] += ti;
                }
            }
            halfSize <<= 1;
        }
        if (inverse) {
            const invSize = 1.0 / DTLN_BLOCK;
            for (let i = 0; i < DTLN_BLOCK; i++) { real[i] *= invSize; imag[i] *= invSize; }
        }
    }

    const RESAMPLE_A = 3;
    const RESAMPLE_PHASES = 256;
    const RESAMPLE_TAPS = 2 * RESAMPLE_A;
    const resampleKernel = new Float32Array(RESAMPLE_PHASES * RESAMPLE_TAPS);
    (function initResampleKernel() {
        function lanczos(x) {
            if (x === 0) return 1;
            if (x <= -RESAMPLE_A || x >= RESAMPLE_A) return 0;
            const px = Math.PI * x;
            return RESAMPLE_A * Math.sin(px) * Math.sin(px / RESAMPLE_A) / (px * px);
        }
        for (let p = 0; p < RESAMPLE_PHASES; p++) {
            const frac = p / RESAMPLE_PHASES;
            for (let t = 0; t < RESAMPLE_TAPS; t++) {
                const k = t - RESAMPLE_A + 1;
                resampleKernel[p * RESAMPLE_TAPS + t] = lanczos(frac - k);
            }
        }
    })();

    function createResampler(ratio) {
        let history = [];
        let pos = RESAMPLE_A - 1;
        return function (input) {
            for (let i = 0; i < input.length; i++) history.push(input[i]);
            const output = [];
            while (true) {
                const idx = Math.floor(pos);
                if (idx + RESAMPLE_A >= history.length || idx - RESAMPLE_A + 1 < 0) break;
                const frac = pos - idx;
                const phase = Math.min(RESAMPLE_PHASES - 1, Math.floor(frac * RESAMPLE_PHASES));
                const base = idx - RESAMPLE_A + 1;
                const koff = phase * RESAMPLE_TAPS;
                let acc = 0;
                for (let t = 0; t < RESAMPLE_TAPS; t++) acc += history[base + t] * resampleKernel[koff + t];
                output.push(acc);
                pos += ratio;
            }
            const minNeeded = Math.floor(pos) - RESAMPLE_A + 1;
            if (minNeeded > 0) {
                history.splice(0, minNeeded);
                pos -= minNeeded;
            }
            return output;
        };
    }

    let dtln = {
        enabled: false,
        loading: false,
        ready: false,
        engine: null,
        readyEngine: null,
        basePath: null,
        ctxRate: 48000,
        gainDb: 0,
        maskFloor: 0.15,
        presence: 0.3,
        presenceState: 0,
        wetMix: 0.85,
        rnTarget: 0.7,
        rnMaxBoost: 60,
        rnWetMix: 0.85,
        rnDry: [],
        aiEnvelope: 0.01,
        aiLastGain: 1,
        rnVadProbability: 0,
        rnVadHangFrames: 0,
        session1: null,
        session2: null,
        state1: null,
        state2: null,
        rnLoaded: false,
        winBuf: new Float32Array(DTLN_BLOCK),
        outBuf: new Float32Array(DTLN_BLOCK),
        pending16k: [],
        pendingOut16k: [],
        dryDelay: null,
        resampleIn: null,
        resampleOut: null,
        inRing: null, inHead: 0, inTail: 0, inCount: 0,
        outRing: null, outHead: 0, outTail: 0, outCount: 0,
        pumpTimer: null,
        outputSink: null,
        ioPort: null,
        buttons: {}
    };

    function ai_rate() {
        return dtln.engine === 'dtln' ? DTLN_RATE : 48000;
    }
    function ai_frame_size() {
        if (dtln.engine === 'rnnoise') return RNNOISE_FRAME;
        return DTLN_HOP;
    }

    function dtln_reset_runtime() {
        dtln.winBuf.fill(0);
        dtln.outBuf.fill(0);
        dtln.pending16k = [];
        dtln.pendingOut16k = [];
        dtln.presenceState = 0;
        dtln.dryDelay = new Array(DTLN_BLOCK - DTLN_HOP).fill(0);
        if (dtln.state1) dtln.state1.fill(0);
        if (dtln.state2) dtln.state2.fill(0);
        const rate = ai_rate();
        dtln.resampleIn = createResampler(dtln.ctxRate / rate);
        dtln.resampleOut = createResampler(rate / dtln.ctxRate);
        dtln.inHead = dtln.inTail = dtln.inCount = 0;
        dtln.outHead = dtln.outTail = dtln.outCount = 0;
        dtln.aiEnvelope = 0.01;
        dtln.aiLastGain = 1;
        dtln.rnVadProbability = 0;
        dtln.rnVadHangFrames = 0;
        dtln.rnDry = [];
        if (dtln.ioPort) dtln.ioPort.postMessage({ type: 'reset' });
    }

    function dtln_get_base_path() {
        const scripts = document.getElementsByTagName('script');
        for (let i = 0; i < scripts.length; i++) {
            const src = scripts[i].src;
            if (src && /audio_filter\.js(\?.*)?$/.test(src)) return src.replace(/[^\/]+$/, '');
        }
        return './';
    }

    function load_filter_modules() {
        if (filterModulesPromise) return filterModulesPromise;
        filterModulesPromise = new Promise(function (resolve, reject) {
            const moduleFiles = ['auto-notch.js', 'equalizer.js', 'noise-blanker.js', 'hum-filter.js', 'compressor.js', 'noise-reduction.js', 'speech-expander.js', 'output-limiter.js', 'ai-enhancement.js', 'dtln.js'];
            let index = 0;
            const loadNext = function () {
                if (index >= moduleFiles.length) {
                    resolve();
                    return;
                }
                const script = document.createElement('script');
                script.src = dtln_get_base_path() + 'modules/' + moduleFiles[index++];
                script.onload = loadNext;
                script.onerror = function () { reject(new Error('Failed to load ' + script.src)); };
                document.head.appendChild(script);
            };
            loadNext();
        });
        return filterModulesPromise;
    }

    function dtln_load_ort() {
        if (window.ort) return Promise.resolve();
        return new Promise(function (resolve, reject) {
            const s = document.createElement('script');
            s.src = dtln.basePath + 'ort/ort.min.js';
            s.onload = function () { resolve(); };
            s.onerror = function () { reject(new Error('Failed to load onnxruntime-web')); };
            document.head.appendChild(s);
        });
    }

    let aiWorkerController = null;
    function ai_worker_request(message, transfer) {
        if (!aiWorkerController) {
            aiWorkerController = window.AudioFilterModules.aiEnhancement.createRnnoiseWorkerController();
        }
        return aiWorkerController.request(message, transfer);
    }

    function dtln_refresh_button() {
        const btn = dtln.buttons[dtln.engine];
        if (!btn) return;
        if (btn.update) btn.update();
        if (btn.element && dtln.loading) {
            btn.element.style.background = '#e8a33d';
            btn.element.style.color = '#000';
        }
    }

    function ai_ensure_loaded() {
        if (dtln.engine === 'rnnoise') return rnnoise_ensure_loaded();
        if (dtln.engine === 'dtln') return dtln_ensure_loaded();
        return Promise.resolve(false);
    }

    function ai_disable_on_load_failure() {
        dtln.enabled = false;
        is_dtln_enabled = false;
        localStorage.setItem('openwebrx-audio-filter-ai-engine', 'none');
        if (dtln.ioPort) dtln.ioPort.postMessage({ type: 'settings', enabled: false });
    }

    async function dtln_ensure_loaded() {
        if (dtln.ready && dtln.readyEngine === 'dtln') return true;
        if (dtln.loading) return false;
        dtln.loading = true;
        dtln_refresh_button();
        try {
            dtln.basePath = dtln.basePath || dtln_get_base_path();
            await dtln_load_ort();
            ort.env.wasm.wasmPaths = dtln.basePath + 'ort/';
            ort.env.wasm.numThreads = 1;
            dtln.session1 = await ort.InferenceSession.create(dtln.basePath + 'model_1.onnx', { executionProviders: ['wasm'] });
            dtln.session2 = await ort.InferenceSession.create(dtln.basePath + 'model_2.onnx', { executionProviders: ['wasm'] });
            dtln.state1 = new Float32Array(DTLN_STATE_LEN);
            dtln.state2 = new Float32Array(DTLN_STATE_LEN);
            dtln.ready = true;
            dtln.readyEngine = 'dtln';
            dtln_reset_runtime();
            if (dtln.ioPort) dtln.ioPort.postMessage({ type: 'settings', enabled: dtln.enabled });
        } catch (e) {
            console.error(`[${PLUGIN_ID}] Failed to load DTLN model:`, e);
            ai_disable_on_load_failure();
        } finally {
            dtln.loading = false;
            dtln_refresh_button();
        }
        return dtln.ready && dtln.readyEngine === 'dtln';
    }

    async function rnnoise_ensure_loaded() {
        if (dtln.ready && dtln.readyEngine === 'rnnoise') return true;
        if (dtln.loading) return false;
        dtln.loading = true;
        dtln_refresh_button();
        try {
            dtln.basePath = dtln.basePath || dtln_get_base_path();
            if (!dtln.rnLoaded) {
                await ai_worker_request({ type: 'init-rnnoise', basePath: dtln.basePath });
                dtln.rnLoaded = true;
            }
            dtln.ready = true;
            dtln.readyEngine = 'rnnoise';
            dtln_reset_runtime();
            if (dtln.ioPort) dtln.ioPort.postMessage({ type: 'settings', enabled: dtln.enabled });
        } catch (e) {
            console.error(`[${PLUGIN_ID}] Failed to load RNNoise:`, e);
            ai_disable_on_load_failure();
        } finally {
            dtln.loading = false;
            dtln_refresh_button();
        }
        return dtln.ready && dtln.readyEngine === 'rnnoise';
    }

    async function dtlnProcessHop(hop) {
        return window.AudioFilterModules.dtln.processHop(dtln, hop, {
            blockSize: DTLN_BLOCK,
            hopSize: DTLN_HOP,
            real: dtlnReal,
            imag: dtlnImag,
            magnitude: dtlnMag,
            phase: dtlnPhase,
            fft: dtlnFFT,
            ort: ort
        });
    }

    function ai_process_rnnoise_hop(hop) {
        if (!aiWorkerController) {
            aiWorkerController = window.AudioFilterModules.aiEnhancement.createRnnoiseWorkerController();
        }
        return aiWorkerController.processHop(dtln, hop);
    }

    async function dtlnPump() {
        if (!dtln.enabled || !dtln.ready || dtln.readyEngine !== dtln.engine) { dtln.pumpTimer = setTimeout(dtlnPump, 20); return; }
        try {
            if (dtln.inCount > 0) {
                const chunk = new Float32Array(dtln.inCount);
                for (let i = 0; i < chunk.length; i++) {
                    chunk[i] = dtln.inRing[dtln.inHead];
                    dtln.inHead = (dtln.inHead + 1) % DTLN_RING_SIZE;
                }
                dtln.inCount = 0;
                const resampled = dtln.resampleIn(chunk);
                for (let i = 0; i < resampled.length; i++) dtln.pending16k.push(resampled[i]);
            }

            const hopSize = ai_frame_size();
            while (dtln.pending16k.length >= hopSize && dtln.enabled) {
                const hop = dtln.pending16k.splice(0, hopSize);
                if (dtln.engine === 'rnnoise') {
                    const out = await ai_process_rnnoise_hop(hop);
                    for (let i = 0; i < out.length; i++) dtln.pendingOut16k.push(out[i]);
                } else {
                    await dtlnProcessHop(hop);
                }
            }

            if (dtln.pendingOut16k.length > 0) {
                const outChunk = new Float32Array(dtln.pendingOut16k);
                dtln.pendingOut16k = [];
                const outResampled = dtln.resampleOut(outChunk);
                if (outResampled.length > 0 && dtln.outputSink) {
                    const gainLin = Math.pow(10, dtln.gainDb / 20);
                    const buf = new Float32Array(outResampled.length);
                    for (let i = 0; i < outResampled.length; i++) {
                        const sample = outResampled[i];
                        const emphasized = sample + dtln.presence * (sample - dtln.presenceState);
                        dtln.presenceState = sample;
                        buf[i] = emphasized * gainLin;
                    }
                    dtln.outputSink(buf);
                }
            }
        } catch (e) {
            console.error(`[${PLUGIN_ID}] AI processing error:`, e);
        }
        dtln.pumpTimer = setTimeout(dtlnPump, 4);
    }

    function dtln_push_input(samples) {
        for (let i = 0; i < samples.length; i++) {
            dtln.inRing[dtln.inTail] = samples[i];
            dtln.inTail = (dtln.inTail + 1) % DTLN_RING_SIZE;
            if (dtln.inCount < DTLN_RING_SIZE) dtln.inCount++;
        }
    }

    function createDtlnScriptProcessorNode(ctx) {
        const node = ctx.createScriptProcessor(2048, 1, 1);
        node.isCustomFilter = true;
        dtln.ioPort = null;
        dtln.outputSink = function (chunk) {
            for (let i = 0; i < chunk.length; i++) {
                if (dtln.outCount < DTLN_RING_SIZE) {
                    dtln.outRing[dtln.outTail] = chunk[i];
                    dtln.outTail = (dtln.outTail + 1) % DTLN_RING_SIZE;
                    dtln.outCount++;
                }
            }
        };

        node.onaudioprocess = function (event) {
            const input = event.inputBuffer.getChannelData(0);
            const output = event.outputBuffer.getChannelData(0);
            if (!dtln.enabled || !dtln.ready) {
                output.set(input);
                return;
            }
            dtln_push_input(input);
            for (let i = 0; i < output.length; i++) {
                if (dtln.outCount > 0) {
                    output[i] = dtln.outRing[dtln.outHead];
                    dtln.outHead = (dtln.outHead + 1) % DTLN_RING_SIZE;
                    dtln.outCount--;
                } else {
                    output[i] = input[i];
                }
            }
        };
        return node;
    }

    function createDtlnWorkletNode(ctx) {
        const node = new AudioWorkletNode(ctx, 'openwebrx-dtln-io', {
            numberOfInputs: 1,
            numberOfOutputs: 1,
            outputChannelCount: [1]
        });
        node.isCustomFilter = true;
        node.port.onmessage = function (event) {
            if (event.data && event.data.type === 'input') dtln_push_input(event.data.samples);
        };
        if (node.port.start) node.port.start();
        dtln.ioPort = node.port;
        dtln.outputSink = function (chunk) {
            node.port.postMessage({ type: 'output', samples: chunk }, [chunk.buffer]);
        };
        node.port.postMessage({ type: 'settings', enabled: dtln.enabled });
        return node;
    }

    function createAudioWorkletModule(ctx) {
        if (!ctx.audioWorklet || typeof AudioWorkletNode === 'undefined') return Promise.reject(new Error('AudioWorklet is unavailable'));
        const source = `
            const FFT_SIZE = 1024;
            const HOP_SIZE = FFT_SIZE / 2;
            const fftBitRev = new Uint16Array(FFT_SIZE);
            const fftCos = new Float32Array(FFT_SIZE / 2);
            const fftSin = new Float32Array(FFT_SIZE / 2);
            const fftWindow = new Float32Array(FFT_SIZE);
            for (let i = 0; i < FFT_SIZE; i++) {
                let j = 0;
                let value = i;
                for (let bit = 0; bit < 10; bit++) {
                    j = (j << 1) | (value & 1);
                    value >>= 1;
                }
                fftBitRev[i] = j;
                fftWindow[i] = Math.sin(Math.PI * i / FFT_SIZE);
            }
            for (let i = 0; i < FFT_SIZE / 2; i++) {
                const angle = -2 * Math.PI * i / FFT_SIZE;
                fftCos[i] = Math.cos(angle);
                fftSin[i] = Math.sin(angle);
            }
            function workletFft(real, imag, inverse) {
                for (let i = 0; i < FFT_SIZE; i++) {
                    const j = fftBitRev[i];
                    if (i < j) {
                        let temp = real[i]; real[i] = real[j]; real[j] = temp;
                        temp = imag[i]; imag[i] = imag[j]; imag[j] = temp;
                    }
                }
                for (let half = 1; half < FFT_SIZE; half <<= 1) {
                    const step = FFT_SIZE / (half << 1);
                    for (let start = 0; start < FFT_SIZE; start += half << 1) {
                        for (let k = 0, table = 0; k < half; k++, table += step) {
                            const sine = inverse ? -fftSin[table] : fftSin[table];
                            const index = start + k + half;
                            const tr = fftCos[table] * real[index] - sine * imag[index];
                            const ti = fftCos[table] * imag[index] + sine * real[index];
                            real[index] = real[start + k] - tr;
                            imag[index] = imag[start + k] - ti;
                            real[start + k] += tr;
                            imag[start + k] += ti;
                        }
                    }
                }
                if (inverse) {
                    for (let i = 0; i < FFT_SIZE; i++) {
                        real[i] /= FFT_SIZE;
                        imag[i] /= FFT_SIZE;
                    }
                }
            }
            ${window.AudioFilterModules.noiseBlanker.workletSource}
            ${window.AudioFilterModules.compressor.workletSource}
            ${window.AudioFilterModules.noiseReduction.workletSource}
            ${window.AudioFilterModules.speechExpander.workletSource}
            ${window.AudioFilterModules.outputLimiter.workletSource}
            class AudioFilterProcessor extends AudioWorkletProcessor {
                constructor(options) {
                    super();
                    this.stage = options.processorOptions.stage;
                    this.settings = {};
                    this.average = 0.1;
                    this.blankCounter = 0;
                    this.nbEnvelope = 0;
                    this.nbPreviousAbs = 0;
                    this.nbCooldown = 0;
                    this.nbSampleCounter = 0;
                    this.nbLastImpulse = -1;
                    this.nbPeriodEstimate = 0;
                    this.nbPeriodStableCount = 0;
                    this.envelope = 0;
                    this.gain = 1;
                    this.hang = 0;
                    this.noise = 0.001;
                    this.silentFrames = 0;
                    this.warmupSamples = 0;
                    this.nrInput = new Float32Array(4096 + FFT_SIZE);
                    this.nrOutput = new Float32Array(4096 + FFT_SIZE);
                    this.nrReal = new Float32Array(FFT_SIZE);
                    this.nrImag = new Float32Array(FFT_SIZE);
                    this.nrNoise = new Float32Array(FFT_SIZE / 2 + 1);
                    this.nrLastGain = new Float32Array(FFT_SIZE / 2 + 1).fill(1);
                    this.nrMagnitude = new Float32Array(FFT_SIZE / 2 + 1);
                    this.nrInitialized = false;
                    this.nrPending = new Float32Array(4096);
                    this.nrPendingLength = 0;
                    this.nrReady = new Float32Array(8192);
                    this.nrReadyLength = 0;
                    this.expanderState = { envelope: 0, gain: 1 };
                    this.limiterState = { envelope: 0, gain: 1 };
                    this.port.onmessage = event => {
                        if (event.data.type === 'reset') {
                            this.average = 0.1;
                            this.blankCounter = 0;
                            this.nbEnvelope = 0;
                            this.nbPreviousAbs = 0;
                            this.nbCooldown = 0;
                            this.nbSampleCounter = 0;
                            this.nbLastImpulse = -1;
                            this.nbPeriodEstimate = 0;
                            this.nbPeriodStableCount = 0;
                            this.envelope = 0;
                            this.gain = 1;
                            this.hang = 0;
                            this.noise = 0.001;
                            this.silentFrames = 0;
                            this.warmupSamples = 2048;
                            this.nrInput.fill(0);
                            this.nrOutput.fill(0);
                            this.nrNoise.fill(1e-9);
                            this.nrLastGain.fill(1);
                            this.nrInitialized = false;
                            this.nrPending.fill(0);
                            this.nrPendingLength = 0;
                            this.nrReady.fill(0);
                            this.nrReadyLength = 0;
                            this.expanderState = { envelope: 0, gain: 1 };
                            this.limiterState = { envelope: 0, gain: 1 };
                        } else if (event.data.type === 'settings') {
                            this.settings = event.data.value || {};
                        }
                    };
                }
                processSpectralBlock(block) {
                    processNoiseReductionBlock(this, block, workletFft, FFT_SIZE, HOP_SIZE, fftWindow, sampleRate);
                }
                process(inputs, outputs) {
                    const input = inputs[0] && inputs[0][0];
                    const output = outputs[0] && outputs[0][0];
                    if (!input || !output) return true;
                    const settings = this.settings;
                    let blockPeak = 0;
                    for (let i = 0; i < input.length; i++) blockPeak = Math.max(blockPeak, Math.abs(input[i]));
                    if (this.stage === 'nr') {
                        if (!settings.enabled) {
                            output.set(input);
                            return true;
                        }
                        for (let i = 0; i < input.length; i++) this.nrPending[this.nrPendingLength + i] = input[i];
                        this.nrPendingLength += input.length;
                        while (this.nrPendingLength >= 4096) {
                            this.processSpectralBlock(this.nrPending.slice(0, 4096));
                            this.nrPending.copyWithin(0, 4096, this.nrPendingLength);
                            this.nrPendingLength -= 4096;
                        }
                        if (this.nrReadyLength >= input.length) {
                            output.set(this.nrReady.subarray(0, input.length));
                            this.nrReady.copyWithin(0, input.length, this.nrReadyLength);
                            this.nrReadyLength -= input.length;
                        } else {
                            output.fill(0);
                        }
                        return true;
                    }
                    if (this.stage === 'nr') {
                        if (blockPeak < 0.00001) this.silentFrames++;
                        else if (this.silentFrames > 20) {
                            this.noise = Math.max(0.001, blockPeak * 0.1);
                            this.warmupSamples = 2048;
                            this.silentFrames = 0;
                        } else this.silentFrames = 0;
                    }
                    for (let i = 0; i < input.length; i++) {
                        let sample = input[i];
                        if (this.stage === 'nb' && settings.nb_enabled) {
                            sample = processNoiseBlanker(this, sample, settings, sampleRate);
                        } else if (this.stage === 'nr') {
                            // NR is processed as a spectral block below, not per sample.
                        } else if (this.stage === 'comp' && settings.comp_enabled) {
                            sample = processCompressor(this, sample, settings, sampleRate);
                        } else if (this.stage === 'expander') {
                            sample = processSpeechExpanderSample(this.expanderState, sample, settings, sampleRate);
                        } else if (this.stage === 'limiter') {
                            sample = processOutputLimiterSample(this.limiterState, sample, settings, sampleRate);
                        }
                        output[i] = sample;
                    }
                    if (this.stage === 'nr') {
                        if (!settings.enabled) {
                            output.set(input);
                            return true;
                        }
                        const bufferSize = input.length;
                        this.nrInput.copyWithin(0, bufferSize, bufferSize + FFT_SIZE);
                        this.nrInput.set(input, FFT_SIZE);
                        this.nrOutput.copyWithin(0, bufferSize, bufferSize + FFT_SIZE);
                        this.nrOutput.fill(0, FFT_SIZE);
                        const alpha = settings.alpha;
                        const threshold = Math.pow(10, settings.snr / 20);
                        const outputGain = Math.pow(10, settings.gain / 20);
                        const comb = settings.comb === undefined ? 0.5 : settings.comb;
                        const speechMode = !!settings.speech_mode;
                        const noiseRise = 1 + (1 - (speechMode && alpha > 0.98 ? 0.95 : alpha)) * 0.01;
                        for (let block = 0; block < bufferSize / HOP_SIZE; block++) {
                            const position = block * HOP_SIZE + FFT_SIZE - HOP_SIZE;
                            for (let k = 0; k < FFT_SIZE; k++) this.nrReal[k] = this.nrInput[position + k] * fftWindow[k];
                            this.nrImag.fill(0);
                            workletFft(this.nrReal, this.nrImag, false);
                            for (let k = 0; k <= FFT_SIZE / 2; k++) {
                                const magnitude = Math.sqrt(this.nrReal[k] * this.nrReal[k] + this.nrImag[k] * this.nrImag[k]);
                                this.nrMagnitude[k] = magnitude;
                                const currentAlpha = speechMode && magnitude < this.nrNoise[k] * 0.5 ? 0.90 : alpha;
                                if (magnitude < this.nrNoise[k]) this.nrNoise[k] = currentAlpha * this.nrNoise[k] + (1 - currentAlpha) * magnitude;
                                else this.nrNoise[k] = this.nrNoise[k] * noiseRise + 1e-6;
                                this.nrNoise[k] = Math.max(this.nrNoise[k], 1e-9);
                            }
                            if (!this.nrInitialized) {
                                for (let k = 0; k <= FFT_SIZE / 2; k++) this.nrNoise[k] = Math.max(this.nrMagnitude[k], 1e-6);
                                this.nrInitialized = true;
                            }
                            for (let k = 0; k <= FFT_SIZE / 2; k++) {
                                const frequency = k * sampleRate / FFT_SIZE;
                                let localThreshold = threshold;
                                const magnitude = this.nrMagnitude[k];
                                const peak = k > 1 && k < FFT_SIZE / 2 - 1 && magnitude >= this.nrMagnitude[k - 1] && magnitude >= this.nrMagnitude[k + 1];
                                if (frequency > 100 && frequency < 9000) localThreshold *= peak ? 1 - 0.95 * comb : 1 + 0.9 * comb;
                                else localThreshold *= 1.2;
                                const snr = magnitude / (this.nrNoise[k] + 0.000001);
                                let gain = snr < localThreshold ? Math.pow(snr / localThreshold, 2) : 1;
                                gain = Math.max(gain, 0.005);
                                this.nrLastGain[k] = gain > this.nrLastGain[k] ? this.nrLastGain[k] * 0.4 + gain * 0.6 : this.nrLastGain[k] * 0.95 + gain * 0.05;
                                this.nrReal[k] *= this.nrLastGain[k];
                                this.nrImag[k] *= this.nrLastGain[k];
                                if (k > 0 && k < FFT_SIZE / 2) {
                                    this.nrReal[FFT_SIZE - k] *= this.nrLastGain[k];
                                    this.nrImag[FFT_SIZE - k] *= this.nrLastGain[k];
                                }
                            }
                            workletFft(this.nrReal, this.nrImag, true);
                            for (let k = 0; k < FFT_SIZE; k++) this.nrOutput[position + k] += this.nrReal[k] * fftWindow[k];
                        }
                        for (let i = 0; i < bufferSize; i++) output[i] = this.nrOutput[i] * outputGain;
                    }
                    return true;
                }
            }
            registerProcessor('openwebrx-audio-filter', AudioFilterProcessor);

            class DtlnIoProcessor extends AudioWorkletProcessor {
                constructor() {
                    super();
                    this.enabled = false;
                    this.outQueue = [];
                    this.outOffset = 0;
                    this.port.onmessage = (event) => {
                        const d = event.data;
                        if (d.type === 'settings') this.enabled = !!d.enabled;
                        else if (d.type === 'output') this.outQueue.push(d.samples);
                        else if (d.type === 'reset') { this.outQueue = []; this.outOffset = 0; }
                    };
                }
                process(inputs, outputs) {
                    const input = inputs[0] && inputs[0][0];
                    const output = outputs[0] && outputs[0][0];
                    if (!input || !output) return true;
                    if (this.enabled) this.port.postMessage({ type: 'input', samples: input.slice() });
                    for (let i = 0; i < output.length; i++) {
                        if (this.outQueue.length > 0) {
                            const chunk = this.outQueue[0];
                            output[i] = chunk[this.outOffset++];
                            if (this.outOffset >= chunk.length) { this.outQueue.shift(); this.outOffset = 0; }
                        } else {
                            output[i] = input[i];
                        }
                    }
                    return true;
                }
            }
            registerProcessor('openwebrx-dtln-io', DtlnIoProcessor);
        `;
        const url = URL.createObjectURL(new Blob([source], { type: 'application/javascript' }));
        return ctx.audioWorklet.addModule(url).finally(() => URL.revokeObjectURL(url));
    }

    function isSecureAudioContext() {
        if (typeof window !== 'undefined' && window.isSecureContext !== undefined)
            return window.isSecureContext;
        if (typeof location === 'undefined') return false;
        return location.protocol === 'https:' ||
            location.hostname === 'localhost' ||
            location.hostname === '127.0.0.1' ||
            location.hostname === '::1';
    }

    function is_stereo_bypass(modulation) {
        return ['iq', 'bcfm', 'hdr'].includes(String(modulation).toLowerCase());
    }

    function connectFilterChain(ctx) {
        const chain = [
            activeFilters.inputProxy,
            activeFilters.nbProcessor,
            ...activeFilters.humFilters,
            activeFilters.analyser,
            ...activeFilters.notches,
            activeFilters.nrProcessor,
            activeFilters.highpass,
            activeFilters.loudness,
            activeFilters.peaking,
            activeFilters.air,
            activeFilters.lowpass,
            activeFilters.compHighpass,
            activeFilters.compLowpass,
            activeFilters.compProcessor,
            activeFilters.gain,
            activeFilters.dtlnProcessor,
            activeFilters.expanderProcessor,
            activeFilters.limiterProcessor,
            activeFilters.outputAnalyser
        ].filter(Boolean);

        chain.forEach(function (node) {
            try { node.disconnect(); } catch (error) { }
        });
        if (is_stereo_bypass(get_modulation())) {
            originalConnect.call(activeFilters.inputProxy, ctx.destination);
            return;
        }
        for (let i = 0; i < chain.length - 1; i++) chain[i].connect(chain[i + 1]);
        originalConnect.call(activeFilters.outputAnalyser, ctx.destination);
    }

    function setupScriptProcessorStages(ctx) {
        const createStage = function (handler) {
            const processor = ctx.createScriptProcessor(4096, 1, 1);
            processor.isCustomFilter = true;
            processor.onaudioprocess = handler;
            return processor;
        };

        const nbState = window.AudioFilterModules.noiseBlanker.createState();
        const nb = createStage(function (event) {
            const input = event.inputBuffer.getChannelData(0);
            const output = event.outputBuffer.getChannelData(0);
            const settings = activeFilters.dynamicsSettings || {};
            for (let i = 0; i < input.length; i++) {
                output[i] = window.AudioFilterModules.noiseBlanker.processSample(nbState, input[i], settings, ctx.sampleRate);
            }
        });

        let nrNoise = 0.001;
        const nr = window.AudioFilterModules.noiseReduction.createScriptProcessor(ctx, {
            fftSize: FFT_SIZE,
            fftWindow: fft_win,
            performFFT: performFFT,
            getSettings: function () { return activeFilters.nrSettings; }
        });

        const compState = window.AudioFilterModules.compressor.createState();
        const comp = createStage(function (event) {
            const input = event.inputBuffer.getChannelData(0);
            const output = event.outputBuffer.getChannelData(0);
            const settings = activeFilters.dynamicsSettings || {};
            for (let i = 0; i < input.length; i++) {
                output[i] = window.AudioFilterModules.compressor.processSample(compState, input[i], settings, ctx.sampleRate);
            }
        });

        const expanderState = window.AudioFilterModules.speechExpander.createState();
        const expander = createStage(function (event) {
            const input = event.inputBuffer.getChannelData(0);
            const output = event.outputBuffer.getChannelData(0);
            const settings = activeFilters.dynamicsSettings || {};
            for (let i = 0; i < input.length; i++) {
                output[i] = window.AudioFilterModules.speechExpander.processSample(expanderState, input[i], settings, ctx.sampleRate);
            }
        });

        const limiterState = window.AudioFilterModules.outputLimiter.createState();
        const limiter = createStage(function (event) {
            const input = event.inputBuffer.getChannelData(0);
            const output = event.outputBuffer.getChannelData(0);
            const settings = activeFilters.dynamicsSettings || {};
            for (let i = 0; i < input.length; i++) {
                output[i] = window.AudioFilterModules.outputLimiter.processSample(limiterState, input[i], settings, ctx.sampleRate);
            }
        });

        const dtlnSp = createDtlnScriptProcessorNode(ctx);
        [activeFilters.dtlnProcessor, activeFilters.nbProcessor, activeFilters.nrProcessor, activeFilters.compProcessor, activeFilters.expanderProcessor, activeFilters.limiterProcessor].forEach(function (node) {
            try { node.disconnect(); } catch (error) { }
        });
        activeFilters.dtlnProcessor = dtlnSp;
        activeFilters.nbProcessor = nb;
        activeFilters.nrProcessor = nr;
        activeFilters.compProcessor = comp;
        activeFilters.expanderProcessor = expander;
        activeFilters.limiterProcessor = limiter;
        connectFilterChain(ctx);
        activeFilters.workletActive = false;
        console.warn('[audio_filter] AudioWorklet unavailable; using ScriptProcessorNode fallback.');
    }

    function setupFilters(ctx) {

        const analyser = ctx.createAnalyser();
        analyser.fftSize = 4096;
        analyser.smoothingTimeConstant = 0.15;
        analyser.minDecibels = -140;
        analyser.maxDecibels = -10;
        activeFilters.analyser = analyser;

        const outputAnalyser = ctx.createAnalyser();
        outputAnalyser.fftSize = 4096;
        outputAnalyser.smoothingTimeConstant = 0.15;
        outputAnalyser.minDecibels = -140;
        outputAnalyser.maxDecibels = -10;
        activeFilters.outputAnalyser = outputAnalyser;

        activeFilters.notches = window.AudioFilterModules.autoNotch.createNodes(ctx, 4);
        activeFilters.humFilters = window.AudioFilterModules.humFilter.createNodes(ctx);

        // Compressor Pre-Filter (Bandpass)
        const compHighpass = ctx.createBiquadFilter();
        compHighpass.type = 'highpass';
        compHighpass.frequency.value = 0;
        compHighpass.isCustomFilter = true;
        activeFilters.compHighpass = compHighpass;

        const compLowpass = ctx.createBiquadFilter();
        compLowpass.type = 'lowpass';
        compLowpass.frequency.value = (ctx.sampleRate / 2) - 100;
        compLowpass.isCustomFilter = true;
        activeFilters.compLowpass = compLowpass;

        // AudioWorklet placeholders are replaced once the module is ready.
        const nbProcessor = ctx.createGain();
        nbProcessor.isCustomFilter = true;
        activeFilters.nbProcessor = nbProcessor;
        activeFilters.inputProxy = ctx.createGain();
        activeFilters.inputProxy.isCustomFilter = true;
        const dtlnPlaceholder = ctx.createGain();
        dtlnPlaceholder.isCustomFilter = true;
        activeFilters.dtlnProcessor = dtlnPlaceholder;

        dtln.ctxRate = ctx.sampleRate;
        dtln.inRing = new Float32Array(DTLN_RING_SIZE);
        dtln.outRing = new Float32Array(DTLN_RING_SIZE);
        dtln_reset_runtime();
        if (!dtln.pumpTimer) dtln.pumpTimer = setTimeout(dtlnPump, 4);

        // NR placeholder; the real processor is selected below per context.
        const nrProcessor = ctx.createGain();
        nrProcessor.isCustomFilter = true;
        activeFilters.nrProcessor = nrProcessor;

        activeFilters.reset_nr = function () {
            if (activeFilters.nrProcessor.resetSpectralState) {
                activeFilters.nrProcessor.resetSpectralState();
            } else if (activeFilters.nrProcessor.port) {
                activeFilters.nrProcessor.port.postMessage({ type: 'reset' });
                activeFilters.nrProcessor.port.postMessage({ type: 'settings', value: activeFilters.nrSettings || {} });
            }
        };

        // 3. AudioWorklet Compressor Processor (End of Chain)
        const compProcessor = ctx.createGain();
        compProcessor.isCustomFilter = true;
        activeFilters.compProcessor = compProcessor;

        const expanderProcessor = ctx.createGain();
        expanderProcessor.isCustomFilter = true;
        activeFilters.expanderProcessor = expanderProcessor;

        const limiterProcessor = ctx.createGain();
        limiterProcessor.isCustomFilter = true;
        activeFilters.limiterProcessor = limiterProcessor;

        Object.assign(activeFilters, window.AudioFilterModules.equalizer.createNodes(ctx));
        const highpass = activeFilters.highpass;
        const loudness = activeFilters.loudness;
        const peaking = activeFilters.peaking;
        const air = activeFilters.air;
        const lowpass = activeFilters.lowpass;
        const gainNode = activeFilters.gain;

        connectFilterChain(ctx);
        apply_filter_settings();

        activeFilters.workletFallback = function () {
            if (!activeFilters.workletActive) return;
            activeFilters.workletActive = false;
            [activeFilters.dtlnProcessor, activeFilters.nbProcessor, activeFilters.nrProcessor, activeFilters.compProcessor, activeFilters.expanderProcessor, activeFilters.limiterProcessor].forEach(function (node) {
                try { node.disconnect(); } catch (error) { }
            });
            const dtlnSp = createDtlnScriptProcessorNode(ctx);
            activeFilters.dtlnProcessor = dtlnSp;
            activeFilters.nbProcessor = nbProcessor;
            activeFilters.nrProcessor = nrProcessor;
            activeFilters.compProcessor = compProcessor;
            connectFilterChain(ctx);
            apply_filter_settings();
        };

        if (!isSecureAudioContext()) {
            console.warn('[audio_filter] Insecure context; using ScriptProcessorNode fallback.');
            setupScriptProcessorStages(ctx);
        } else {
            createAudioWorkletModule(ctx).then(function () {
            const options = function (stage) {
                return {
                    numberOfInputs: 1,
                    numberOfOutputs: 1,
                    outputChannelCount: [1],
                    processorOptions: { stage: stage }
                };
            };
            const createProcessor = function (stage) {
                const processor = new AudioWorkletNode(ctx, 'openwebrx-audio-filter', options(stage));
                processor.isCustomFilter = true;
                processor.addEventListener('processorerror', function () {
                    console.error('[audio_filter] AudioWorklet processor failed:', stage);
                    activeFilters.workletFallback();
                });
                if (processor.port && processor.port.start) processor.port.start();
                return processor;
            };

            const workletNb = createProcessor('nb');
            const workletNr = createProcessor('nr');
            const workletComp = createProcessor('comp');

            const dtlnWorklet = createDtlnWorkletNode(ctx);
            dtlnWorklet.addEventListener('processorerror', function () {
                console.error('[audio_filter] DTLN AudioWorklet processor failed');
                activeFilters.workletFallback();
            });
            [activeFilters.dtlnProcessor, activeFilters.nbProcessor, activeFilters.nrProcessor, activeFilters.compProcessor, activeFilters.expanderProcessor, activeFilters.limiterProcessor].forEach(function (node) {
                try { node.disconnect(); } catch (error) { }
            });
            activeFilters.dtlnProcessor = dtlnWorklet;
            activeFilters.nbProcessor = workletNb;
            activeFilters.nrProcessor = workletNr;
            activeFilters.compProcessor = workletComp;
            activeFilters.expanderProcessor = createProcessor('expander');
            activeFilters.limiterProcessor = createProcessor('limiter');
            activeFilters.workletActive = true;
            connectFilterChain(ctx);
            apply_filter_settings();
            if (is_nr_enabled) activeFilters.reset_nr();
            }).catch(function (error) {
                console.warn('[audio_filter] AudioWorklet stages unavailable; using ScriptProcessorNode fallback:', error);
                setupScriptProcessorStages(ctx);
            });
        }

    }

    function initAudioFilter() {
        if (is_initialized) return;

        if (!window.AudioFilterModules || !window.AudioFilterModules.autoNotch || !window.AudioFilterModules.equalizer || !window.AudioFilterModules.noiseBlanker || !window.AudioFilterModules.humFilter || !window.AudioFilterModules.compressor || !window.AudioFilterModules.noiseReduction || !window.AudioFilterModules.speechExpander || !window.AudioFilterModules.outputLimiter || !window.AudioFilterModules.aiEnhancement || !window.AudioFilterModules.dtln) {
            load_filter_modules().then(initAudioFilter).catch(function (error) {
                console.error(`[${PLUGIN_ID}] Error loading filter modules:`, error);
            });
            return;
        }

        try {
            if (localStorage.getItem('openwebrx-audio-filter-enabled') === 'true') is_filter_enabled = true;
            if (localStorage.getItem('openwebrx-audio-filter-nr') === 'true') is_nr_enabled = true;
            if (localStorage.getItem('openwebrx-audio-filter-autonotch') === 'true') is_autonotch_enabled = true;
            if (localStorage.getItem('openwebrx-audio-filter-declick') === 'true') is_nb_enabled = true;
            if (localStorage.getItem('openwebrx-audio-filter-compressor') === 'true') is_compressor_enabled = true;
            if (localStorage.getItem('openwebrx-audio-filter-hum') === 'true') is_hum_filter_enabled = true;
            if (localStorage.getItem('openwebrx-audio-filter-expander') === 'true') is_expander_enabled = true;
            if (localStorage.getItem('openwebrx-audio-filter-limiter') === 'true') is_limiter_enabled = true;
            if (localStorage.getItem('openwebrx-audio-filter-loudness') === 'true') is_loudness_enabled = true;
            const savedEngine = localStorage.getItem('openwebrx-audio-filter-ai-engine');
            if (savedEngine && savedEngine !== 'none') {
                dtln.engine = savedEngine;
                if (dtln.engine === 'df') dtln.engine = 'dtln'; // DF removed, fallback to DTLN
                is_dtln_enabled = true;
            } else if (!savedEngine && localStorage.getItem('openwebrx-audio-filter-dtln') === 'true') {
                // migrate pre-multi-engine setting
                dtln.engine = 'dtln';
                is_dtln_enabled = true;
            }
            dtln.enabled = is_dtln_enabled;
            if (is_dtln_enabled) ai_ensure_loaded();

            try {
                const savedSettings = localStorage.getItem('openwebrx-audio-filter-settings');
                if (savedSettings) {
                    const parsed = JSON.parse(savedSettings);
                    if (parsed.ssb || parsed.am || parsed.cw || parsed.nfm || parsed.wfm || parsed.digital) {
                        if (parsed.ssb) settings_store.ssb = parsed.ssb;
                        if (parsed.am) settings_store.am = parsed.am;
                        if (parsed.cw) settings_store.cw = parsed.cw;
                        if (parsed.nfm) settings_store.nfm = parsed.nfm;
                        if (parsed.wfm) settings_store.wfm = parsed.wfm;
                        if (parsed.digital) settings_store.digital = parsed.digital;
                    } else {
                        settings_store.ssb = parsed;
                    }
                }
            } catch (e) {
                console.error(`[${PLUGIN_ID}] Error loading settings:`, e);
            }

            if (!create_ui()) {
                setTimeout(initAudioFilter, 250);
                return;
            }

            last_modulation = get_modulation();

            let startKey = get_config_mode(last_modulation);
            if (settings_store[startKey]) {
                override_settings = JSON.parse(JSON.stringify(settings_store[startKey]));
            }

            // Start monitoring loops
            install_modulation_hook();
            setInterval(check_modulation_loop, 500);
            setInterval(process_audio_analysis, 50); // Polling for AutoNotch

            is_initialized = true;
            if (typeof Plugins !== 'undefined' && Plugins.audio_filter) {
                Plugins.audio_filter.is_initialized = true;
            }
        } catch (e) {
            console.error(`[${PLUGIN_ID}] Error during initialization:`, e);
        }
    }

    let viz_cache = { w: 0, maxFreq: 0, freqArray: null, magResponse: null, phaseResponse: null, totalResp: null, spectrumData: null };

    function draw_comp_visualization(ctx, w, h, mouseX, mouseY) {
        ctx.clearRect(0, 0, w, h);

        const minFreq = 50;
        const sampleRate = activeFilters.outputAnalyser ? activeFilters.outputAnalyser.context.sampleRate : 48000;
        const maxFreq = Math.max(minFreq + 1, Math.min(16000, sampleRate / 2 - 100));
        const freqToX = (f) => {
            if (f < minFreq) f = minFreq;
            if (f > maxFreq) f = maxFreq;
            return (w - 2) * (Math.log(f) - Math.log(minFreq)) / (Math.log(maxFreq) - Math.log(minFreq)) + 1;
        };

        if (viz_cache.w !== w || viz_cache.maxFreq !== maxFreq) {
            viz_cache.w = w;
            viz_cache.maxFreq = maxFreq;
            viz_cache.freqArray = new Float32Array(w);
            viz_cache.magResponse = new Float32Array(w);
            viz_cache.phaseResponse = new Float32Array(w);
            viz_cache.totalResp = new Float32Array(w);
            for (let x = 0; x < w; x++) {
                let t = (x - 1) / (w - 2);
                if (t < 0) t = 0; if (t > 1) t = 1;
                viz_cache.freqArray[x] = minFreq * Math.pow(maxFreq / minFreq, t);
            }
        }
        const { freqArray, magResponse, phaseResponse, totalResp } = viz_cache;

        const drawCurve = (color, fill, nodes) => {
            if (!nodes || nodes.length === 0) return;

            totalResp.fill(1.0);

            let hasNodes = false;
            nodes.forEach(node => {
                if (node && node.getFrequencyResponse) {
                    node.getFrequencyResponse(freqArray, magResponse, phaseResponse);
                    for(let i=0; i<w; i++) totalResp[i] *= magResponse[i];
                    hasNodes = true;
                }
            });

            if (!hasNodes) return;

            ctx.beginPath();
            ctx.strokeStyle = color;
            ctx.lineWidth = 1.5;
            if (fill) ctx.fillStyle = fill;

            for (let x = 0; x < w; x++) {
                let mag = totalResp[x];
                if (mag < 0.00001) mag = 0.00001;
                let db = 20 * Math.log10(mag);
                let y = 40 - db * (h - 40) / 60;

                if (x === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }

            if (fill) {
                ctx.lineTo(w, h);
                ctx.lineTo(0, h);
                ctx.fill();
            }
            ctx.stroke();
            ctx.lineWidth = 1;
        };

        // 1. Compressor Bandpass (Green)
        if (is_compressor_enabled) {
            if (activeFilters.compHighpass && activeFilters.compLowpass) {
                const xHPF = freqToX(activeFilters.compHighpass.frequency.value);
                const xLPF = freqToX(activeFilters.compLowpass.frequency.value);
                ctx.fillStyle = 'rgba(57, 255, 20, 0.1)';
                ctx.fillRect(xHPF, 0, xLPF - xHPF, h);
            }

            if (activeFilters.compHighpass) {
                const xHPF = freqToX(activeFilters.compHighpass.frequency.value);
                ctx.fillStyle = 'rgba(57, 255, 20, 0.8)';
                ctx.font = '9px sans-serif';
                ctx.textAlign = 'left';
                ctx.fillText('Comp', xHPF + 2, 10);
            }
        }

        // 2. EQ (Yellow)
        if (is_filter_enabled && activeFilters.highpass) {

            ctx.strokeStyle = 'rgba(255, 255, 0, 0.5)';
            ctx.lineWidth = 1;
            ctx.setLineDash([2, 2]);

            const xHP = freqToX(activeFilters.highpass.frequency.value);
            ctx.beginPath();
            ctx.moveTo(xHP, 0);
            ctx.lineTo(xHP, h);
            ctx.stroke();

            if (activeFilters.lowpass) {
                const xLP = freqToX(activeFilters.lowpass.frequency.value);
                ctx.beginPath();
                ctx.moveTo(xLP, 0);
                ctx.lineTo(xLP, h);
                ctx.stroke();
            }
            ctx.setLineDash([]);

            if (activeFilters.peaking && Math.abs(activeFilters.peaking.gain.value) > 0.1) {
                const f_c = activeFilters.peaking.frequency.value;
                const Q = activeFilters.peaking.Q.value;
                const term1 = Math.sqrt(1 + 1 / (4 * Q * Q));
                const term2 = 1 / (2 * Q);
                const f1 = f_c * (term1 - term2);
                const f2 = f_c * (term1 + term2);
                const x1 = freqToX(f1);
                const x2 = freqToX(f2);
                ctx.fillStyle = 'rgba(255, 255, 0, 0.15)';
                ctx.fillRect(x1, 0, x2 - x1, h);
            }
        }

        // 3. Auto Notch (Red)
        if (is_autonotch_enabled && activeFilters.notches) {
            let effectiveNotchRange = (override_settings.notchRange !== null && override_settings.notchRange !== undefined) ? override_settings.notchRange : 4000;
            let effectiveNotchCenter = (override_settings.notchCenter !== null && override_settings.notchCenter !== undefined) ? override_settings.notchCenter : (effectiveNotchRange / 2);

            let halfWidth = effectiveNotchRange / 2;
            let startFreq = Math.max(50, effectiveNotchCenter - halfWidth);
            let endFreq = effectiveNotchCenter + halfWidth;
            const x1 = freqToX(startFreq);
            const x2 = freqToX(endFreq);
            ctx.fillStyle = 'rgba(255, 50, 50, 0.1)';
            ctx.fillRect(x1, 0, x2 - x1, h);

            const activeNotches = activeFilters.notches.filter(n => n.frequency.value > 10);
            if (activeNotches.length > 0) {
                drawCurve('rgba(255, 50, 50, 0.8)', null, activeNotches);

                ctx.fillStyle = 'rgba(255, 255, 0, 0.9)';
                activeNotches.forEach(n => {
                    const bw = n.frequency.value / n.Q.value;
                    const xStart = freqToX(n.frequency.value - bw / 2);
                    const xEnd = freqToX(n.frequency.value + bw / 2);
                    const wBar = Math.max(2, xEnd - xStart);
                    ctx.fillRect(xStart, 0, wBar, 6);
                });
            }
        }

        // 4. Spectrum (Input & Output)
        const drawSpectrum = (analyser, color) => {
            if (!analyser) return;
            const bufferLength = analyser.frequencyBinCount;
            if (!viz_cache.spectrumData || viz_cache.spectrumData.length !== bufferLength) {
                viz_cache.spectrumData = new Uint8Array(bufferLength);
            }
            const dataArray = viz_cache.spectrumData;
            analyser.getByteFrequencyData(dataArray);
                const analyserSampleRate = analyser.context.sampleRate;

            ctx.beginPath();
            ctx.strokeStyle = color;
            ctx.lineWidth = 1;
            let started = false;
            for (let x = 0; x < w; x++) {
                let f = viz_cache.freqArray[x];

                let bin = Math.floor(f / (analyserSampleRate / 2) * bufferLength);
                if (bin < 0) bin = 0; if (bin >= bufferLength) bin = bufferLength - 1;

                let y = h - (dataArray[bin] / 255) * h;
                if (!started) { ctx.moveTo(x, y); started = true; } else { ctx.lineTo(x, y); }
            }
            ctx.stroke();
        };

        if (show_input_spectrum) {
            drawSpectrum(activeFilters.analyser, 'rgba(255, 255, 0, 0.6)');
        }

        if (show_output_spectrum) {
            drawSpectrum(activeFilters.outputAnalyser, 'rgba(0, 255, 255, 0.8)');
        }

        // 5. Legend
        ctx.font = '9px sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';

        ctx.fillStyle = show_input_spectrum ? 'rgba(255, 255, 0, 0.8)' : 'rgba(100, 100, 0, 0.6)';
        ctx.fillRect(5, 5, 6, 6);
        ctx.fillStyle = show_input_spectrum ? '#ddd' : '#666';
        ctx.fillText('In', 14, 8);

        ctx.fillStyle = show_output_spectrum ? 'rgba(0, 255, 255, 0.8)' : 'rgba(0, 100, 100, 0.6)';
        ctx.fillRect(32, 5, 6, 6);
        ctx.fillStyle = show_output_spectrum ? '#ddd' : '#666';
        ctx.fillText('Out', 41, 8);

        // 6. Frequency Axis
        ctx.fillStyle = '#fff';
        ctx.font = '9px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';

        const axisFreqs = [100, 200, 500, 1000, 2000, 4000, 8000, 12000, 16000].filter(f => f <= maxFreq);
        ctx.beginPath();
        axisFreqs.forEach(f => {
            const x = freqToX(f);
            ctx.moveTo(x, h);
            ctx.lineTo(x, h - 4);
            let txt = (f >= 1000) ? (f/1000) + 'k' : f;
            ctx.fillText(txt, x, h - 4);
        });
        ctx.strokeStyle = '#555';
        ctx.stroke();

        // Tooltip
        if (mouseX && mouseX > 0) {
            let hovered = null;

            if (is_autonotch_enabled) {
                let effectiveNotchRange = (override_settings.notchRange !== null && override_settings.notchRange !== undefined) ? override_settings.notchRange : 4000;
                let effectiveNotchCenter = (override_settings.notchCenter !== null && override_settings.notchCenter !== undefined) ? override_settings.notchCenter : (effectiveNotchRange / 2);
                let halfWidth = effectiveNotchRange / 2;
                let startFreq = Math.max(50, effectiveNotchCenter - halfWidth);
                let endFreq = effectiveNotchCenter + halfWidth;
                const x1 = freqToX(startFreq);
                const x2 = freqToX(endFreq);
                if (mouseX >= x1 && mouseX <= x2) hovered = "Notch Range";
            }

            if (is_filter_enabled && activeFilters.peaking && Math.abs(activeFilters.peaking.gain.value) > 0.1) {
                const f_c = activeFilters.peaking.frequency.value;
                const Q = activeFilters.peaking.Q.value;
                const term1 = Math.sqrt(1 + 1 / (4 * Q * Q));
                const term2 = 1 / (2 * Q);
                const f1 = f_c * (term1 - term2);
                const f2 = f_c * (term1 + term2);
                const x1 = freqToX(f1);
                const x2 = freqToX(f2);
                if (mouseX >= x1 && mouseX <= x2) {
                    hovered = "Presence Range";
                }
            }

            const check = (x, label) => {
                if (Math.abs(x - mouseX) < 5) hovered = label;
            };

            if (is_compressor_enabled) {
                let modKey = get_config_mode(last_modulation);
                let base = CONFIG[modKey];
                const compHPF = (override_settings.compHPF !== null && override_settings.compHPF !== undefined) ? override_settings.compHPF : (base.compHPF || 300);
                const compLPF = (override_settings.compLPF !== null && override_settings.compLPF !== undefined) ? override_settings.compLPF : (base.compLPF || 3000);
                const xHPF = freqToX(compHPF);
                const xLPF = freqToX(compLPF);
                if (mouseX >= xHPF && mouseX <= xLPF) hovered = "Comp Range";
            }

            if (is_filter_enabled && activeFilters.highpass && activeFilters.lowpass) {
                check(freqToX(activeFilters.highpass.frequency.value), `EQ Highpass: ${Math.round(activeFilters.highpass.frequency.value)}Hz`);
                check(freqToX(activeFilters.lowpass.frequency.value), `EQ Lowpass: ${Math.round(activeFilters.lowpass.frequency.value)}Hz`);
            }

            if (hovered) {
                ctx.font = '10px sans-serif';
                const tw = ctx.measureText(hovered).width;
                const tx = Math.min(Math.max(mouseX - tw / 2, 0), w - tw - 4);
                const ty = 20;

                ctx.fillStyle = 'rgba(0,0,0,0.8)';
                ctx.fillRect(tx - 2, ty - 10, tw + 4, 14);
                ctx.fillStyle = '#fff';
                ctx.textAlign = 'left';
                ctx.fillText(hovered, tx, ty);
            }
        }
    }

    let plugin_button = null;
    let window_created = false;

    function create_ui() {
        if (typeof Plugins !== 'undefined' && typeof Plugins.addButton === 'function') {
            if (!plugin_button) {
                plugin_button = Plugins.addButton(PLUGIN_ID, 'AF', on_plugin_button_click);
                if (plugin_button) {
                    plugin_button.title = 'Audio Filter Controls (EQ, NR, NB, Comp, Notch)';
                }
            }
            if (!window_created) {
                create_mini_window();
            }
            update_fil_button_state();
            return true;
        }

        return create_fallback_ui();
    }

    function on_plugin_button_click() {
        if (!window_created) {
            create_mini_window();
        }
        if (typeof Plugins !== 'undefined' && typeof Plugins.toggleWindow === 'function') {
            Plugins.toggleWindow(PLUGIN_ID);
        } else {
            var win = document.getElementById('plugin-window-' + PLUGIN_ID);
            if (win) {
                win.style.display = (win.style.display === 'none' || !win.style.display) ? 'flex' : 'none';
            }
        }
        var win = document.getElementById('plugin-window-' + PLUGIN_ID);
        var isVisible = win && (typeof $ !== 'undefined' ? $(win).is(':visible') : win.style.display !== 'none');
        if (isVisible && document.getElementById('audio-filter-graph-check') && document.getElementById('audio-filter-graph-check').checked) {
            if (typeof window.startMainGraphLoop === 'function') {
                window.startMainGraphLoop();
            }
        }
        update_fil_button_state();
    }

    function create_mini_window() {
        if (window_created) return;

        var winElem = null;
        if (typeof Plugins !== 'undefined' && typeof Plugins.addWindow === 'function') {
            winElem = Plugins.addWindow(PLUGIN_ID, 'Audio Filter');
        }
        if (!winElem) return;

        if (typeof LS !== 'undefined') {
            const name = 'plugin_' + PLUGIN_ID;
            if (!LS.has(name + '_w')) {
                winElem.style.width = '375px';
            }
        }

        var $win = $(winElem);
        $win.find('.openwebrx-plugin-close').on('click touchend', () => {
            setTimeout(update_fil_button_state, 50);
        });

        var body = winElem.querySelector('.openwebrx-plugin-body');
        if (!body) body = winElem;
        body.style.padding = '6px';
        body.style.overflow = 'hidden';

        build_filter_controls(body);

        window_created = true;
    }

    function build_filter_controls(container) {
        var content = document.createElement('div');
        content.style.padding = '2px';

        var btnContainer = document.createElement('div');
        btnContainer.style.cssText = 'display: flex; gap: 4px; flex-wrap: wrap; justify-content: space-evenly;';

        function createBtn(label, title, hasMenu, isActiveFn, onClick, onLongPress) {
            var btn = document.createElement('button');
            btn.style.cssText = 'position: relative; width: 45px; height: 32px; padding: 0; line-height: 32px; font-size: 11px; font-weight: 600; border: none; border-radius: 5px; cursor: pointer; box-shadow: 0 2px 5px rgba(0,0,0,0.2); transition: all 0.3s ease; background: #444; color: #fff; user-select: none; -webkit-user-select: none;';
            btn.title = title;

            function update() {
                var active = isActiveFn ? isActiveFn() : false;
                var html = label;
                if (hasMenu) html += '<span style="position: absolute; top: 2px; right: 3px; height: 9px; line-height: 9px; font-size: 9px; opacity: 0.7;">&#9698;</span>';
                btn.innerHTML = html;
                if (active) {
                    btn.style.background = '#39FF14';
                    btn.style.color = 'black';
                } else {
                    btn.style.background = '#444';
                    btn.style.color = '#fff';
                }
            }
            update();

            if (onLongPress) {
                var pressTimer;
                var longPressTriggered = false;
                var start = function(e) {
                    if (e.type === 'mousedown' && e.button !== 0) return;
                    longPressTriggered = false;
                    pressTimer = setTimeout(function() {
                        longPressTriggered = true;
                        onLongPress(btn.getBoundingClientRect());
                    }, 600);
                };
                var end = function(e) {
                    if (pressTimer) clearTimeout(pressTimer);
                    if (!longPressTriggered) {
                        if (e.type === 'touchend') e.preventDefault();
                        onClick();
                        update();
                        update_fil_button_state();
                    }
                };
                btn.addEventListener('mousedown', start);
                btn.addEventListener('mouseup', end);
                btn.addEventListener('mouseleave', function() { if (pressTimer) clearTimeout(pressTimer); });
                btn.addEventListener('touchstart', start, {passive: true});
                btn.addEventListener('touchend', end);
            } else {
                btn.onclick = function() {
                    onClick();
                    update();
                    update_fil_button_state();
                };
            }
            return { element: btn, update: update };
        }

        var btnNB = createBtn('NB', 'Enable/Disable Noise Blanker.', false, () => is_nb_enabled, () => {
            is_nb_enabled = !is_nb_enabled;
            localStorage.setItem('openwebrx-audio-filter-declick', is_nb_enabled);
            apply_filter_settings();
        }).element;

        var btnHum = createBtn('Hum', 'Enable/Disable mains hum filter. Long press for 50/60 Hz settings.', true, () => is_hum_filter_enabled, () => {
            is_hum_filter_enabled = !is_hum_filter_enabled;
            localStorage.setItem('openwebrx-audio-filter-hum', is_hum_filter_enabled);
            apply_filter_settings();
        }, (rect) => show_hum_menu(rect)).element;

        var btnNotch = createBtn('Notch', 'Enable/Disable Auto Notch. Long press for settings.', true, () => is_autonotch_enabled, () => {
            is_autonotch_enabled = !is_autonotch_enabled;
            localStorage.setItem('openwebrx-audio-filter-autonotch', is_autonotch_enabled);
            if (!is_autonotch_enabled) window.AudioFilterModules.autoNotch.disable(activeFilters.notches);
        }, (rect) => show_notch_menu(rect)).element;

        var btnNR = createBtn('NR', 'Enable/Disable Noise Reduction. Long press for settings.', true, () => is_nr_enabled, () => {
            is_nr_enabled = !is_nr_enabled;
            localStorage.setItem('openwebrx-audio-filter-nr', is_nr_enabled);
            apply_filter_settings();
            if (is_nr_enabled && activeFilters.reset_nr) activeFilters.reset_nr();
        }, (rect) => show_nr_menu(rect)).element;

        var btnEq = createBtn('EQ', 'Enable/Disable Equalizer. Long press for settings.', true, () => is_filter_enabled, () => {
            is_filter_enabled = !is_filter_enabled;
            localStorage.setItem('openwebrx-audio-filter-enabled', is_filter_enabled);
            apply_filter_settings();
        }, (rect) => show_eq_menu(rect)).element;

        var btnComp = createBtn('Comp', 'Enable/Disable Compressor. Long press for settings.', true, () => is_compressor_enabled, () => {
            is_compressor_enabled = !is_compressor_enabled;
            localStorage.setItem('openwebrx-audio-filter-compressor', is_compressor_enabled);
            apply_filter_settings();
        }, (rect) => show_comp_menu(rect)).element;

        var btnExpander = createBtn('Exp', 'Enable/Disable speech expander. Long press for settings.', true, () => is_expander_enabled, () => {
            is_expander_enabled = !is_expander_enabled;
            localStorage.setItem('openwebrx-audio-filter-expander', is_expander_enabled);
            apply_filter_settings();
        }, (rect) => show_expander_menu(rect)).element;

        var btnLimiter = createBtn('Lim', 'Enable/Disable output limiter. Long press for settings.', true, () => is_limiter_enabled, () => {
            is_limiter_enabled = !is_limiter_enabled;
            localStorage.setItem('openwebrx-audio-filter-limiter', is_limiter_enabled);
            apply_filter_settings();
        }, (rect) => show_limiter_menu(rect)).element;

        let nr_resync_token = 0;
        function schedule_nr_resync() {
            if (!is_nr_enabled || !activeFilters.reset_nr) return;
            const token = ++nr_resync_token;
            setTimeout(function () {
                if (token === nr_resync_token && is_nr_enabled && activeFilters.reset_nr) activeFilters.reset_nr();
            }, 600);
        }

        function select_ai_engine(name) {
            if (dtln.engine === name && is_dtln_enabled) {
                is_dtln_enabled = false;
                dtln.enabled = false;
            } else {
                dtln.engine = name;
                is_dtln_enabled = true;
                dtln.enabled = true;
            }
            localStorage.setItem('openwebrx-audio-filter-ai-engine', is_dtln_enabled ? name : 'none');
            if (dtln.ioPort) dtln.ioPort.postMessage({ type: 'settings', enabled: dtln.enabled });
            if (is_dtln_enabled) {
                dtln_reset_runtime();
                ai_ensure_loaded();
            }
            schedule_nr_resync();
        }

        var btnAiObj = createBtn('AI', 'Enable/Disable AI Speech Enhancement (DTLN, best for AM). Long press for settings.', true, () => is_dtln_enabled && dtln.engine === 'dtln', () => select_ai_engine('dtln'), (rect) => show_dtln_menu(rect));
        var btnRnObj = createBtn('RN', 'Enable/Disable AI Speech Enhancement (RNNoise). Long press for settings.', true, () => is_dtln_enabled && dtln.engine === 'rnnoise', () => select_ai_engine('rnnoise'), (rect) => show_rnnoise_menu(rect));
        dtln.buttons.dtln = btnAiObj;
        dtln.buttons.rnnoise = btnRnObj;

        btnContainer.appendChild(btnNB);
        btnContainer.appendChild(btnHum);
        btnContainer.appendChild(btnNotch);
        btnContainer.appendChild(btnNR);
        btnContainer.appendChild(btnEq);
        btnContainer.appendChild(btnComp);
        var controlRowBreak = document.createElement('div');
        controlRowBreak.style.cssText = 'flex: 0 0 100%; height: 0;';
        btnContainer.appendChild(controlRowBreak);
        btnContainer.appendChild(btnAiObj.element);
        btnContainer.appendChild(btnRnObj.element);
        btnContainer.appendChild(btnExpander);
        btnContainer.appendChild(btnLimiter);

        var btnSet = document.createElement('button');
        btnSet.style.cssText = 'position: relative; width: 45px; height: 32px; padding: 0; line-height: 32px; font-size: 11px; font-weight: 600; border: none; border-radius: 5px; cursor: pointer; box-shadow: 0 2px 5px rgba(0,0,0,0.2); transition: all 0.3s ease; background: #444; color: #fff; user-select: none; -webkit-user-select: none;';
        btnSet.title = 'Plugin Settings (Import/Export)';
        btnSet.innerHTML = 'Set<span style="position: absolute; right: 3px; bottom: 2px; font-size: 9px; opacity: 0.7;">&#9698;</span>';
        btnSet.onclick = function() {
            show_settings_menu(btnSet.getBoundingClientRect());
        };
        btnContainer.appendChild(btnSet);

        var divGraph = document.createElement('div');
        divGraph.style.cssText = 'display: flex; flex-direction: column; align-items: center; justify-content: center; width: 40px; cursor: pointer; background: #222; border-radius: 4px; border: 1px solid #444; height: 32px; user-select: none; -webkit-user-select: none;';
        divGraph.title = 'Show Visualizer';

        var lblGraph = document.createElement('span');
        lblGraph.textContent = 'Graph';
        lblGraph.style.cssText = 'font-size: 9px; color: #ccc; line-height: 10px; margin-bottom: 1px;';

        var chkGraph = document.createElement('input');
        chkGraph.type = 'checkbox';
        chkGraph.id = 'audio-filter-graph-check';
        chkGraph.style.cursor = 'pointer';
        chkGraph.style.margin = '0';

        if (localStorage.getItem('openwebrx-audio-filter-show-graph') === 'true') {
            chkGraph.checked = true;
        }

        divGraph.appendChild(lblGraph);
        divGraph.appendChild(chkGraph);

        divGraph.onclick = function(e) {
            if (e.target !== chkGraph) {
                chkGraph.checked = !chkGraph.checked;
                if (chkGraph.onchange) chkGraph.onchange();
            }
        };

        btnContainer.appendChild(divGraph);
        content.appendChild(btnContainer);

        var graphContainer = document.createElement('div');
        graphContainer.id = 'audio-filter-main-graph';
        graphContainer.style.cssText = 'display: none; margin-top: 5px; border-top: 1px solid #444; padding-top: 5px;';

        var mainCanvas = document.createElement('canvas');
        mainCanvas.width = 350;
        mainCanvas.height = 110;
        mainCanvas.style.cssText = 'background: #181818; border-radius: 3px; border: 1px solid #333; display: block; width: 100%; box-sizing: border-box;';
        graphContainer.appendChild(mainCanvas);
        content.appendChild(graphContainer);

        var mainCtx = mainCanvas.getContext('2d');
        var mainLoopId;
        var mouseX = -1, mouseY = -1;

        mainCanvas.addEventListener('click', function(e) {
            var rect = mainCanvas.getBoundingClientRect();
            var clickX = e.clientX - rect.left;
            var clickY = e.clientY - rect.top;

            if (clickX >= 5 && clickX <= 30 && clickY >= 2 && clickY <= 14) {
                show_input_spectrum = !show_input_spectrum;
                localStorage.setItem('openwebrx-audio-filter-show-in-spec', show_input_spectrum);
            }

            if (clickX >= 32 && clickX <= 60 && clickY >= 2 && clickY <= 14) {
                show_output_spectrum = !show_output_spectrum;
                localStorage.setItem('openwebrx-audio-filter-show-out-spec', show_output_spectrum);
            }
        });

        mainCanvas.addEventListener('mousemove', function(e) {
            var rect = mainCanvas.getBoundingClientRect();
            mouseX = e.clientX - rect.left;
            mouseY = e.clientY - rect.top;
            if ((mouseX >= 5 && mouseX <= 30 && mouseY >= 2 && mouseY <= 14) ||
                (mouseX >= 32 && mouseX <= 60 && mouseY >= 2 && mouseY <= 14)) {
                mainCanvas.style.cursor = 'pointer';
            } else {
                mainCanvas.style.cursor = 'default';
            }
        });
        mainCanvas.addEventListener('mouseleave', function() {
            mouseX = -1; mouseY = -1;
            mainCanvas.style.cursor = 'default';
        });

        window.startMainGraphLoop = function() {
            if (mainLoopId) cancelAnimationFrame(mainLoopId);
            let lastDraw = 0;
            const interval = 40; // ~25 FPS

            function loop(timestamp) {
                var win = document.getElementById('plugin-window-' + PLUGIN_ID);
                var fallbackPanel = document.getElementById('audio-filter-floating-panel');
                var isVisible = false;
                if (win) {
                    isVisible = (typeof $ !== 'undefined') ? $(win).is(':visible') : (win.style.display !== 'none');
                } else if (fallbackPanel) {
                    isVisible = fallbackPanel.style.display !== 'none';
                }

                if (!chkGraph.checked || !isVisible) return;
                if (document.hidden) return;
                mainLoopId = requestAnimationFrame(loop);
                if (timestamp - lastDraw >= interval) {
                    lastDraw = timestamp;
                    draw_comp_visualization(mainCtx, mainCanvas.width, mainCanvas.height, mouseX, mouseY);
                }
            }
            requestAnimationFrame(loop);
        };

        document.addEventListener('visibilitychange', function() {
            var win = document.getElementById('plugin-window-' + PLUGIN_ID);
            var fallbackPanel = document.getElementById('audio-filter-floating-panel');
            var isVisible = false;
            if (win) {
                isVisible = (typeof $ !== 'undefined') ? $(win).is(':visible') : (win.style.display !== 'none');
            } else if (fallbackPanel) {
                isVisible = fallbackPanel.style.display !== 'none';
            }
            if (!document.hidden && chkGraph.checked && isVisible) {
                startMainGraphLoop();
            }
        });

        chkGraph.onchange = function() {
            localStorage.setItem('openwebrx-audio-filter-show-graph', chkGraph.checked);
            if (chkGraph.checked) {
                graphContainer.style.display = 'block';
                startMainGraphLoop();
            } else {
                graphContainer.style.display = 'none';
                if (mainLoopId) cancelAnimationFrame(mainLoopId);
            }
        };

        if (chkGraph.checked) {
            graphContainer.style.display = 'block';
        }

        container.appendChild(content);
    }

    function create_fallback_ui() {
        var container = document.querySelector('#openwebrx-panel-receiver');
        if (!container) return false;

        if (!document.getElementById('audio-filter-toggle-btn')) {
            var toggleBtn = document.createElement('div');
            toggleBtn.id = 'audio-filter-toggle-btn';
            toggleBtn.textContent = 'AF';
            toggleBtn.title = 'Open Audio Filter Controls';
            toggleBtn.style.cssText = 'position: absolute; bottom: 3px; left: 4px; z-index: 99; font-size: 12px; font-weight: bold; color: #aaa; cursor: pointer; background: rgba(0,0,0,0.5); padding: 0px 4px; border-radius: 3px; border: 1px solid #666; user-select: none; line-height: 12px; transition: left 0.2s;';

            toggleBtn.onclick = function() {
                var panel = document.getElementById('audio-filter-floating-panel');
                if (!panel) return;
                if (panel.style.display === 'none') {
                    panel.style.display = 'block';
                } else {
                    panel.style.display = 'none';
                }
                update_fil_button_state();
                if (panel.style.display !== 'none' && document.getElementById('audio-filter-graph-check').checked) {
                    startMainGraphLoop();
                }
            };

            container.appendChild(toggleBtn);

            var af_update_pos = function() {
                var btn = document.getElementById('audio-filter-toggle-btn');
                if (!btn) return;
                var cont = document.querySelector('#openwebrx-panel-receiver');
                if (!cont) return;

                var allButtons = Array.from(cont.querySelectorAll('div[id$="-toggle-btn"], div[id$="-btn"], div[id="openwebrx-clock-utc"]'))
                    .filter(b => b.offsetParent !== null);

                allButtons.sort((a, b) => {
                    if (a.id === 'openwebrx-clock-utc') return -1;
                    if (b.id === 'openwebrx-clock-utc') return 1;
                    return a.id.localeCompare(b.id);
                });

                var left = 4;
                for (var i = 0; i < allButtons.length; i++) {
                    var currentBtn = allButtons[i];
                    if (currentBtn.id === btn.id) {
                        break;
                    }
                    var rect = currentBtn.getBoundingClientRect();
                    if (rect.width > 0) {
                        left += rect.width + 4;
                    }
                }

                btn.style.left = left + 'px';
            };
            setInterval(af_update_pos, 1000);
            af_update_pos();
        }

        if (!document.getElementById('audio-filter-floating-panel')) {
            var panel = document.createElement('div');
            panel.id = 'audio-filter-floating-panel';
            panel.style.cssText = 'display: none; position: fixed; top: 200px; left: 10px; background: rgba(30,30,30,0.95); border: 1px solid #666; border-radius: 5px; padding: 0; z-index: 10000; box-shadow: 0 0 10px rgba(0,0,0,0.5); font-family: sans-serif;';

            var dragHandle = document.createElement('div');
            dragHandle.textContent = 'Audio Filter';
            dragHandle.style.cssText = 'height: 18px; line-height: 18px; font-size: 11px; color: #ddd; text-align: center; background: #444; cursor: move; border-radius: 5px 5px 0 0; width: 100%; border-bottom: 1px solid #555; user-select: none;';
            dragHandle.title = 'Drag to move';
            panel.appendChild(dragHandle);

            var isDragging = false;
            var dragOffsetX = 0;
            var dragOffsetY = 0;

            var startDrag = function(e) {
                isDragging = true;
                var clientX = e.clientX;
                var clientY = e.clientY;
                if (e.touches && e.touches.length > 0) {
                    clientX = e.touches[0].clientX;
                    clientY = e.touches[0].clientY;
                }
                dragOffsetX = clientX - panel.offsetLeft;
                dragOffsetY = clientY - panel.offsetTop;
                e.preventDefault();
            };

            var doDrag = function(e) {
                if (isDragging) {
                    var clientX = e.clientX;
                    var clientY = e.clientY;
                    if (e.touches && e.touches.length > 0) {
                        clientX = e.touches[0].clientX;
                        clientY = e.touches[0].clientY;
                    }
                    panel.style.left = (clientX - dragOffsetX) + 'px';
                    panel.style.top = (clientY - dragOffsetY) + 'px';
                    if (e.type === 'touchmove') e.preventDefault();
                }
            };

            var stopDrag = function() { isDragging = false; };

            dragHandle.addEventListener('mousedown', startDrag);
            document.addEventListener('mousemove', doDrag);
            document.addEventListener('mouseup', stopDrag);

            dragHandle.addEventListener('touchstart', startDrag, {passive: false});
            document.addEventListener('touchmove', doDrag, {passive: false});
            document.addEventListener('touchend', stopDrag);

            var panelBody = document.createElement('div');
            panelBody.style.padding = '5px';
            build_filter_controls(panelBody);

            panel.appendChild(panelBody);
            document.body.appendChild(panel);
        }

        update_fil_button_state();
        return true;
    }

    function get_modulation() {
        if (typeof UI !== 'undefined' && UI.getDemodulator) {
            var demod = UI.getDemodulator();
            if (demod && typeof demod.get_modulation === 'function') {
                return demod.get_modulation();
            }
        }
        return 'ssb'; // Fallback
    }

    function install_modulation_hook() {
        if (typeof DemodulatorPanel === 'undefined' || !DemodulatorPanel.prototype ||
            typeof DemodulatorPanel.prototype.setMode !== 'function') return;
        const originalSetMode = DemodulatorPanel.prototype.setMode;
        DemodulatorPanel.prototype.setMode = function () {
            const result = originalSetMode.apply(this, arguments);
            check_modulation_loop();
            return result;
        };
    }

    function check_modulation_loop() {
        let current_mod = get_modulation();

        if (current_mod && current_mod !== last_modulation) {
            const wasBypassed = is_stereo_bypass(last_modulation);
            const isBypassed = is_stereo_bypass(current_mod);
            // Save current settings to store before switching
            let oldKey = get_config_mode(last_modulation);
            settings_store[oldKey] = JSON.parse(JSON.stringify(override_settings));

            last_modulation = current_mod;
            if (wasBypassed !== isBypassed && activeFilters.inputProxy && activeFilters.outputAnalyser) {
                connectFilterChain(activeFilters.inputProxy.context);
            }

            // Reset NR state before applying new settings for the new mode
            if (is_nr_enabled && activeFilters.reset_nr) {
                activeFilters.reset_nr();
            }
            if (dtln.enabled && dtln.ready) {
                dtln_reset_runtime();
            }

            // Load settings for new mode
            let newKey = get_config_mode(current_mod);
            if (settings_store[newKey]) {
                override_settings = JSON.parse(JSON.stringify(settings_store[newKey]));
            } else {
                override_settings = create_empty_settings();
            }
            apply_filter_settings();
            saveSettings();
        }
    }

    function ai_mode_defaults() {
        if (get_config_mode(last_modulation) === 'ssb') {
            return { dtlnFloor: 0.30, dtlnMix: 0.65, rnTarget: 0.30, rnBoost: 40, rnMix: 0.30 };
        }
        return { dtlnFloor: 0.15, dtlnMix: 0.85, rnTarget: 0.70, rnBoost: 60, rnMix: 0.85 };
    }

    function apply_filter_settings() {
        let settings;
        let effectiveHP, effectiveLP, effectivePeakGain, effectivePeakFreq, effectivePeakQ, effectiveGain, effectiveNotchQ, effectiveCompHPF, effectiveCompLPF;
        let dynSettings = {};

        let modKey = get_config_mode(last_modulation);
        let baseSettings = CONFIG[modKey];
        const aiDefaults = ai_mode_defaults();
        effectiveNotchQ = (override_settings.notchQ !== null && override_settings.notchQ !== undefined) ? override_settings.notchQ : (baseSettings.notchQ || 30);

        let effectiveAirGain = (override_settings.airGain !== null && override_settings.airGain !== undefined) ? override_settings.airGain : (baseSettings.airGain !== undefined ? baseSettings.airGain : 0);
        let effectiveAirFreq = (override_settings.airFreq !== null && override_settings.airFreq !== undefined) ? override_settings.airFreq : (baseSettings.airFreq !== undefined ? baseSettings.airFreq : 12000);

        effectiveCompHPF = (override_settings.compHPF !== null && override_settings.compHPF !== undefined) ? override_settings.compHPF : (baseSettings.compHPF || 300);
        effectiveCompLPF = (override_settings.compLPF !== null && override_settings.compLPF !== undefined) ? override_settings.compLPF : (baseSettings.compLPF || 3000);

        let nrSettings = {
            enabled: is_nr_enabled,
            gain: (override_settings.nr_gain !== null && override_settings.nr_gain !== undefined) ? override_settings.nr_gain : (baseSettings.nr_gain || 0),
            alpha: (override_settings.nr_alpha !== null && override_settings.nr_alpha !== undefined) ? override_settings.nr_alpha : (baseSettings.nr_alpha || 0.95),
            snr: (override_settings.nr_snr !== null && override_settings.nr_snr !== undefined) ? override_settings.nr_snr : (baseSettings.nr_snr || 10),
            comb: (override_settings.nr_comb !== null && override_settings.nr_comb !== undefined) ? override_settings.nr_comb : (baseSettings.nr_comb !== undefined ? baseSettings.nr_comb : 0.5),
            speech_mode: (override_settings.nr_speech_mode !== null && override_settings.nr_speech_mode !== undefined) ? override_settings.nr_speech_mode : (baseSettings.nr_speech_mode !== undefined ? baseSettings.nr_speech_mode : false)
        };

        dynSettings = {
            nb_enabled: is_nb_enabled,
            comp_enabled: is_compressor_enabled,
            expander_enabled: is_expander_enabled,
            expanderThresholdDb: override_settings.expanderThresholdDb !== null && override_settings.expanderThresholdDb !== undefined ? override_settings.expanderThresholdDb : -52,
            expanderFloorDb: override_settings.expanderFloorDb !== null && override_settings.expanderFloorDb !== undefined ? override_settings.expanderFloorDb : -18,
            expanderRatio: override_settings.expanderRatio !== null && override_settings.expanderRatio !== undefined ? override_settings.expanderRatio : 1.8,
            limiter_enabled: is_limiter_enabled,
            limiterCeilingDb: override_settings.limiterCeilingDb !== null && override_settings.limiterCeilingDb !== undefined ? override_settings.limiterCeilingDb : -1,
            agcTarget: baseSettings.agcTarget,
            maxBoost: (override_settings.maxBoost !== null && override_settings.maxBoost !== undefined) ? override_settings.maxBoost : baseSettings.maxBoost,
            gateThresh: (override_settings.gateThresh !== null && override_settings.gateThresh !== undefined) ? override_settings.gateThresh : 0.0025,
            hangTime: (override_settings.hangTime !== null && override_settings.hangTime !== undefined) ? override_settings.hangTime : 0.2,
            recoveryTime: (override_settings.recoveryTime !== null && override_settings.recoveryTime !== undefined) ? override_settings.recoveryTime : 0.5,
            compGain: (override_settings.compGain !== null && override_settings.compGain !== undefined) ? override_settings.compGain : 0.10,
            sampleRate: activeFilters.gain ? activeFilters.gain.context.sampleRate : 48000
        };

        if (!is_filter_enabled) {
            // Bypass / Neutral (Filter disabled)
            let maxFreq = 22000;
            if (activeFilters.lowpass && activeFilters.lowpass.context) {
                maxFreq = (activeFilters.lowpass.context.sampleRate / 2) - 100;
            }
            settings = { gain: 1.0 };
            effectiveHP = 0;
            effectiveLP = maxFreq;
            effectivePeakGain = 0;
            effectiveGain = 1.0;
            effectivePeakFreq = 2000;
            effectivePeakQ = 1.0;

            if (is_nr_enabled && get_config_mode(last_modulation) === 'am') {
                effectivePeakGain = 6.0;
                effectivePeakFreq = 500;
                effectivePeakQ = 1.0;
            }
        } else {
            settings = baseSettings;
            effectiveHP = (override_settings.highpassFreq !== null) ? override_settings.highpassFreq : settings.highpassFreq;
            effectiveLP = (override_settings.lowpassFreq !== null) ? override_settings.lowpassFreq : settings.lowpassFreq;
            effectivePeakGain = (override_settings.peakingGain !== null) ? override_settings.peakingGain : (settings.peakingGain || 0);
            effectivePeakFreq = (override_settings.peakingFreq !== null && override_settings.peakingFreq !== undefined) ? override_settings.peakingFreq : (settings.peakingFreq || 2000);
            effectivePeakQ = (override_settings.peakingQ !== null && override_settings.peakingQ !== undefined) ? override_settings.peakingQ : (settings.peakingQ || 1.0);
            effectiveGain = settings.gain; // Fixed gain
        }

        activeFilters.dynamicsSettings = dynSettings;
        activeFilters.nrSettings = nrSettings;
        dtln.gainDb = (override_settings.dtln_gain !== null && override_settings.dtln_gain !== undefined) ? override_settings.dtln_gain : 0;
        dtln.maskFloor = (override_settings.dtln_floor !== null && override_settings.dtln_floor !== undefined) ? override_settings.dtln_floor : aiDefaults.dtlnFloor;
        dtln.presence = (dtln.engine === 'dtln') ? ((override_settings.dtln_presence !== null && override_settings.dtln_presence !== undefined) ? override_settings.dtln_presence : 0.3) : 0;
        dtln.wetMix = (override_settings.dtln_mix !== null && override_settings.dtln_mix !== undefined) ? override_settings.dtln_mix : aiDefaults.dtlnMix;
        dtln.rnTarget = (override_settings.rn_target !== null && override_settings.rn_target !== undefined) ? override_settings.rn_target : aiDefaults.rnTarget;
        dtln.rnMaxBoost = (override_settings.rn_boost !== null && override_settings.rn_boost !== undefined) ? override_settings.rn_boost : aiDefaults.rnBoost;
        dtln.rnWetMix = (override_settings.rn_mix !== null && override_settings.rn_mix !== undefined) ? override_settings.rn_mix : aiDefaults.rnMix;
        const humFrequency = override_settings.humFrequency !== null && override_settings.humFrequency !== undefined ? override_settings.humFrequency : 50;
        const humHarmonics = override_settings.humHarmonics !== null && override_settings.humHarmonics !== undefined ? override_settings.humHarmonics : 4;
        window.AudioFilterModules.humFilter.apply(activeFilters.humFilters, is_hum_filter_enabled, humFrequency, humHarmonics, activeFilters.gain ? activeFilters.gain.context.sampleRate : 48000);
        const workletSettings = Object.assign({}, dynSettings, nrSettings);
        [activeFilters.nbProcessor, activeFilters.nrProcessor, activeFilters.compProcessor, activeFilters.expanderProcessor, activeFilters.limiterProcessor].forEach(function (processor) {
            if (processor && processor.port) {
                processor.port.postMessage({ type: 'settings', value: workletSettings });
            }
        });

        let finalAirGain = is_compressor_enabled ? effectiveAirGain : 0;
        if (!is_filter_enabled && is_nr_enabled && get_config_mode(last_modulation) === 'am') {
            finalAirGain = 5.0;
        }
        window.AudioFilterModules.equalizer.apply(activeFilters, {
            highpass: effectiveHP,
            lowpass: effectiveLP,
            gain: effectiveGain,
            loudnessGain: ((is_filter_enabled && is_loudness_enabled) || (is_nr_enabled && get_config_mode(last_modulation) === 'am')) ? 12 : 0,
            updatePeaking: is_filter_enabled || (is_nr_enabled && get_config_mode(last_modulation) === 'am'),
            peakingFreq: effectivePeakFreq,
            peakingQ: effectivePeakQ,
            peakingGain: effectivePeakGain,
            airGain: finalAirGain,
            airFreq: effectiveAirFreq
        });

        if (activeFilters.compHighpass && activeFilters.compLowpass) {
            if (is_compressor_enabled) {
                activeFilters.compHighpass.frequency.value = effectiveCompHPF;
                activeFilters.compLowpass.frequency.value = effectiveCompLPF;
            } else {
                activeFilters.compHighpass.frequency.value = 0;
                activeFilters.compLowpass.frequency.value = (activeFilters.compLowpass.context.sampleRate / 2) - 100;
            }
        }

        if (activeFilters.notches) window.AudioFilterModules.autoNotch.setSharpness(activeFilters.notches, effectiveNotchQ);

    }

    function process_audio_analysis() {
        if (!activeFilters.analyser || !is_autonotch_enabled) return;
        window.AudioFilterModules.autoNotch.process(
            activeFilters.analyser,
            activeFilters.notches,
            override_settings,
            activeFilters
        );
    }

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        setTimeout(initAudioFilter, 100);
    } else {
        window.addEventListener('load', initAudioFilter);
    }

    window.AudioFilterPlugin = {
        myname: PLUGIN_ID,
        init: initAudioFilter,
        toggle: on_plugin_button_click
    };

    if (typeof Plugins !== 'undefined' && Plugins.audio_filter) {
        Plugins.audio_filter.no_css = true;
        Plugins.audio_filter._version = 1.0;
        Plugins.audio_filter.init = function() {
            initAudioFilter();
            return true;
        };
    }

    function createFloatingMenu(id, titleText, rect, width, buildContentFn) {
        var existing = document.getElementById(id);
        if (existing) existing.remove();

        var menu = document.createElement('div');
        menu.id = id;
        menu.style.cssText = 'position: fixed; background: #222; border: 1px solid #444; color: #eee; z-index: 10001; border-radius: 4px; padding: 10px; font-family: sans-serif; font-size: 12px; box-shadow: 0 2px 10px rgba(0,0,0,0.5); width: ' + width + 'px; visibility: hidden;';

        if (titleText) {
            var title = document.createElement('div');
            title.textContent = titleText;
            title.style.cssText = 'font-weight: bold; margin-bottom: 10px; border-bottom: 1px solid #444; padding-bottom: 5px;';
            menu.appendChild(title);
        }

        buildContentFn(menu);

        var closeHandler = function(e) {
            if (!menu.contains(e.target)) {
                menu.remove();
                document.removeEventListener('mousedown', closeHandler);
                document.removeEventListener('touchstart', closeHandler);
            }
        };

        setTimeout(function() {
            document.addEventListener('mousedown', closeHandler);
            document.addEventListener('touchstart', closeHandler);
        }, 10);

        document.body.appendChild(menu);

        var menuHeight = menu.offsetHeight;
        var menuWidth = menu.offsetWidth;
        var left = rect.left;
        if (left + menuWidth > window.innerWidth - 5) left = rect.right - menuWidth;
        if (left < 5) left = 5;

        if (rect.top < menuHeight + 10) menu.style.top = rect.bottom + 5 + 'px';
        else menu.style.bottom = (window.innerHeight - rect.top) + 5 + 'px';

        menu.style.left = left + 'px';
        menu.style.visibility = 'visible';
    }

    function appendFilterSlider(menu, label, key, min, max, step, defaultValue, format) {
        const value = override_settings[key] !== null && override_settings[key] !== undefined ? override_settings[key] : defaultValue;
        const row = document.createElement('div');
        row.style.marginBottom = '8px';
        const caption = document.createElement('div');
        const formatValue = format || function (current) { return Number(current).toFixed(1); };
        caption.textContent = label + ': ' + formatValue(value);
        caption.style.marginBottom = '2px';
        const input = document.createElement('input');
        input.type = 'range';
        input.min = min;
        input.max = max;
        input.step = step;
        input.value = value;
        input.style.width = '100%';
        input.oninput = function () {
            const current = parseFloat(input.value);
            caption.textContent = label + ': ' + formatValue(current);
            override_settings[key] = current;
            apply_filter_settings();
        };
        input.onchange = saveSettings;
        row.appendChild(caption);
        row.appendChild(input);
        menu.appendChild(row);
    }

    function show_hum_menu(rect) {
        createFloatingMenu('audio-filter-hum-menu', 'Mains Hum Filter', rect, 210, function (menu) {
            const frequencyRow = document.createElement('label');
            frequencyRow.style.cssText = 'display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;';
            frequencyRow.appendChild(document.createTextNode('Mains frequency'));
            const frequencySelect = document.createElement('select');
            [50, 60].forEach(function (frequency) {
                const option = document.createElement('option');
                option.value = frequency;
                option.textContent = frequency + ' Hz';
                frequencySelect.appendChild(option);
            });
            frequencySelect.value = override_settings.humFrequency !== null && override_settings.humFrequency !== undefined ? override_settings.humFrequency : 50;
            frequencySelect.onchange = function () {
                override_settings.humFrequency = parseInt(frequencySelect.value, 10);
                apply_filter_settings();
                saveSettings();
            };
            frequencyRow.appendChild(frequencySelect);
            menu.appendChild(frequencyRow);
            appendFilterSlider(menu, 'Harmonics', 'humHarmonics', 1, window.AudioFilterModules.humFilter.maxHarmonics, 1, 4, function (value) { return String(Math.round(value)); });
        });
    }

    function show_expander_menu(rect) {
        createFloatingMenu('audio-filter-expander-menu', 'Speech Expander', rect, 210, function (menu) {
            appendFilterSlider(menu, 'Threshold (dBFS)', 'expanderThresholdDb', -80, 0, 1, -52, function (value) { return Math.round(value) + ' dB'; });
            appendFilterSlider(menu, 'Gain floor', 'expanderFloorDb', -36, -6, 1, -18, function (value) { return Math.round(value) + ' dB'; });
            appendFilterSlider(menu, 'Ratio', 'expanderRatio', 1, 4, 0.1, 1.8, function (value) { return Number(value).toFixed(1) + ':1'; });
        });
    }

    function show_limiter_menu(rect) {
        createFloatingMenu('audio-filter-limiter-menu', 'Output Limiter', rect, 210, function (menu) {
            appendFilterSlider(menu, 'Ceiling', 'limiterCeilingDb', -36, 0, 0.5, -1, function (value) { return Number(value).toFixed(1) + ' dBFS'; });
        });
    }

    function show_eq_menu(rect) {
        createFloatingMenu('audio-filter-eq-menu', null, rect, 200, function(menu) {
        let modKey = get_config_mode(last_modulation);
        let base = CONFIG[modKey];
        let currentHP = (override_settings.highpassFreq !== null) ? override_settings.highpassFreq : base.highpassFreq;
        let currentLP = (override_settings.lowpassFreq !== null) ? override_settings.lowpassFreq : base.lowpassFreq;
        let currentPeak = (override_settings.peakingGain !== null) ? override_settings.peakingGain : base.peakingGain;
        let currentPeakFreq = (override_settings.peakingFreq !== null && override_settings.peakingFreq !== undefined) ? override_settings.peakingFreq : base.peakingFreq;
        let currentPeakQ = (override_settings.peakingQ !== null && override_settings.peakingQ !== undefined) ? override_settings.peakingQ : (base.peakingQ || 1.0);

        var sliders = []; // Store update functions for reset

        function createMappedSlider(label, value0to100, onChange, formatFn) {
            var container = document.createElement('div');
            container.style.marginBottom = '8px';

            var getLabelText = function(val) {
                if (formatFn) return label + ': ' + formatFn(val);
                return label + ': ' + Math.round(val) + '%';
            };

            var lbl = document.createElement('div');
            lbl.textContent = getLabelText(value0to100);
            lbl.style.marginBottom = '2px';

            var inp = document.createElement('input');
            inp.type = 'range';
            inp.min = 0;
            inp.max = 100;
            inp.value = value0to100;
            inp.style.width = '100%';

            var updateUI = function(val) {
                inp.value = val;
                lbl.textContent = getLabelText(val);
            };
            sliders.push(updateUI);

            inp.oninput = function() {
                lbl.textContent = getLabelText(parseFloat(inp.value));
                onChange(parseFloat(inp.value));
            };

            inp.onchange = function() {
                saveSettings();
            };

            container.appendChild(lbl);
            container.appendChild(inp);

            return container;
        }

        var minBassFreq = 50, maxBassFreq = 1350;
        var bassPercent = 100 * (maxBassFreq - currentHP) / (maxBassFreq - minBassFreq);
        if (bassPercent < 0) bassPercent = 0; if (bassPercent > 100) bassPercent = 100;

        menu.appendChild(createMappedSlider('Bass', bassPercent, function(val) {
            var freq = maxBassFreq - (val / 100) * (maxBassFreq - minBassFreq);
            override_settings.highpassFreq = freq;
            apply_filter_settings();
        }));

        var minTrebFreq = 1500, maxTrebFreq = 13500;
        var trebPercent = 100 * Math.log(currentLP / minTrebFreq) / Math.log(maxTrebFreq / minTrebFreq);
        if (trebPercent < 0) trebPercent = 0; if (trebPercent > 100) trebPercent = 100;

        menu.appendChild(createMappedSlider('Treble', trebPercent, function(val) {
            var freq = minTrebFreq * Math.pow(maxTrebFreq / minTrebFreq, val / 100);
            override_settings.lowpassFreq = freq;
            apply_filter_settings();
        }));

        var presPercent = 100 * currentPeak / 33;
        if (presPercent < 0) presPercent = 0; if (presPercent > 100) presPercent = 100;

        menu.appendChild(createMappedSlider('Presence', presPercent, function(val) {
            override_settings.peakingGain = val * 33 / 100;
            apply_filter_settings();
        }));

        var minPresFreq = 200, maxPresFreq = 8000;
        var presFreqPercent = 100 * Math.log(currentPeakFreq / minPresFreq) / Math.log(maxPresFreq / minPresFreq);
        if (presFreqPercent < 0) presFreqPercent = 0; if (presFreqPercent > 100) presFreqPercent = 100;

        var minQ = 0.5, maxQ = 4.0;

        menu.appendChild(createMappedSlider('Presence Freq', presFreqPercent, function(val) {
            var freq = minPresFreq * Math.pow(maxPresFreq / minPresFreq, val / 100);
            override_settings.peakingFreq = freq;
            apply_filter_settings();

            if (sliders[4]) {
                var q = (override_settings.peakingQ !== null && override_settings.peakingQ !== undefined) ? override_settings.peakingQ : currentPeakQ;
                var wPct = 100 * (maxQ - q) / (maxQ - minQ);
                if (wPct < 0) wPct = 0; if (wPct > 100) wPct = 100;
                sliders[4](wPct);
            }
        }, function(val) {
            var freq = minPresFreq * Math.pow(maxPresFreq / minPresFreq, val / 100);
            return Math.round(freq) + 'Hz';
        }));

        var widthPercent = 100 * (maxQ - currentPeakQ) / (maxQ - minQ);
        if (widthPercent < 0) widthPercent = 0; if (widthPercent > 100) widthPercent = 100;

        menu.appendChild(createMappedSlider('Presence Width', widthPercent, function(val) {
            var q = maxQ - (val / 100) * (maxQ - minQ);
            override_settings.peakingQ = q;
            apply_filter_settings();
        }, function(val) {
            var q = maxQ - (val / 100) * (maxQ - minQ);
            var freq = (override_settings.peakingFreq !== null && override_settings.peakingFreq !== undefined) ? override_settings.peakingFreq : currentPeakFreq;
            var bw = freq / q;
            return Math.round(bw) + 'Hz (Q: ' + q.toFixed(1) + ')';
        }));

        var loudDiv = document.createElement('div');
        loudDiv.style.marginTop = '10px';
        loudDiv.style.borderTop = '1px solid #444';
        loudDiv.style.paddingTop = '5px';

        var loudLbl = document.createElement('label');
        loudLbl.style.display = 'flex';
        loudLbl.style.alignItems = 'center';
        loudLbl.style.cursor = 'pointer';

        var loudChk = document.createElement('input');
        loudChk.type = 'checkbox';
        loudChk.checked = is_loudness_enabled;
        loudChk.style.marginRight = '8px';
        loudChk.onchange = function() {
            is_loudness_enabled = loudChk.checked;
            localStorage.setItem('openwebrx-audio-filter-loudness', is_loudness_enabled);
            apply_filter_settings();
            update_fil_button_state();
        };

        loudLbl.appendChild(loudChk);
        loudLbl.appendChild(document.createTextNode('Loudness'));
        loudDiv.appendChild(loudLbl);
        menu.appendChild(loudDiv);

        var btnDef = document.createElement('button');
        btnDef.textContent = 'Default';
        btnDef.style.cssText = 'margin-top: 10px; width: 100%; height: 24px; background: #444; color: #fff; border: none; border-radius: 3px; cursor: pointer; font-size: 11px; user-select: none; -webkit-user-select: none;';
        btnDef.onclick = function() {
            let modKey = get_config_mode(last_modulation);
            let def = CONFIG[modKey];

            override_settings.highpassFreq = null;
            override_settings.lowpassFreq = null;
            override_settings.peakingGain = null;
            override_settings.peakingFreq = null;
            override_settings.peakingQ = null;
            override_settings.nr_gain = null;
            override_settings.nr_alpha = null;
            override_settings.nr_snr = null;
            override_settings.nr_speech_mode = null;
            if (settings_store[modKey]) {
                settings_store[modKey].highpassFreq = null;
                settings_store[modKey].lowpassFreq = null;
                settings_store[modKey].peakingGain = null;
                settings_store[modKey].peakingFreq = null;
                settings_store[modKey].peakingQ = null;
                settings_store[modKey].nr_gain = null;
                settings_store[modKey].nr_alpha = null;
                settings_store[modKey].nr_snr = null;
                settings_store[modKey].nr_speech_mode = null;
            }

            is_loudness_enabled = false;
            localStorage.setItem('openwebrx-audio-filter-loudness', 'false');
            loudChk.checked = false;

            saveSettings();
            apply_filter_settings();
            update_fil_button_state();

            // Update Sliders UI
            var bassPercent = 100 * (maxBassFreq - def.highpassFreq) / (maxBassFreq - minBassFreq);
            if (bassPercent < 0) bassPercent = 0; if (bassPercent > 100) bassPercent = 100;
            sliders[0](bassPercent);

            var trebPercent = 100 * Math.log(def.lowpassFreq / minTrebFreq) / Math.log(maxTrebFreq / minTrebFreq);
            if (trebPercent < 0) trebPercent = 0; if (trebPercent > 100) trebPercent = 100;
            sliders[1](trebPercent);

            var presPercent = 100 * (def.peakingGain || 0) / 33;
            if (presPercent < 0) presPercent = 0; if (presPercent > 100) presPercent = 100;
            sliders[2](presPercent);

            var presFreqPercent = 100 * Math.log((def.peakingFreq || 2000) / minPresFreq) / Math.log(maxPresFreq / minPresFreq);
            if (presFreqPercent < 0) presFreqPercent = 0; if (presFreqPercent > 100) presFreqPercent = 100;
            sliders[3](presFreqPercent);

            var defQ = def.peakingQ || 1.0;
            var defWidthPercent = 100 * (maxQ - defQ) / (maxQ - minQ);
            if (defWidthPercent < 0) defWidthPercent = 0; if (defWidthPercent > 100) defWidthPercent = 100;
            sliders[4](defWidthPercent);
        };
        menu.appendChild(btnDef);
        });
    }

    function show_comp_menu(rect) {
        createFloatingMenu('audio-filter-comp-menu', 'Compressor Settings', rect, 220, function(menu) {

        function createSlider(label, key, min, max, step, scale, precision) {
            var container = document.createElement('div');
            container.style.marginBottom = '8px';

            var baseSettings = CONFIG[get_config_mode(last_modulation)];
            var defVal = baseSettings[key];
            if (defVal === undefined) {
                 switch(key) {
                    case 'gateThresh': defVal = 0.0025; break;
                    case 'hangTime': defVal = 0.2; break;
                    case 'recoveryTime': defVal = 0.5; break;
                    case 'compGain': defVal = 0.10; break;
                    case 'airGain': defVal = 0; break;
                    case 'airFreq': defVal = 12000; break;
                    default: defVal = 0;
                }
            }
            var val = (override_settings[key] !== null && override_settings[key] !== undefined) ? override_settings[key] : defVal;

            var lbl = document.createElement('div');
            var decimals = (precision !== undefined) ? precision : (scale ? 0 : 2);
            lbl.textContent = label + ': ' + (val * (scale || 1)).toFixed(decimals);
            lbl.style.marginBottom = '2px';

            var inp = document.createElement('input');
            inp.type = 'range';
            inp.min = min;
            inp.max = max;
            inp.step = step;
            inp.value = val;
            inp.style.width = '100%';

            inp.oninput = function() {
                var v = parseFloat(inp.value);
                lbl.textContent = label + ': ' + (v * (scale || 1)).toFixed(decimals);
                override_settings[key] = v;
                apply_filter_settings();
            };

            inp.onchange = function() {
                saveSettings();
            };

            container.appendChild(lbl);
            container.appendChild(inp);
            return container;
        }

        function createCustomSlider(label, min, max, step, initialVal, onChange) {
            var container = document.createElement('div');
            container.style.marginBottom = '8px';

            var lbl = document.createElement('div');
            lbl.textContent = label + ': ' + Math.round(initialVal) + 'Hz';
            lbl.style.marginBottom = '2px';

            var inp = document.createElement('input');
            inp.type = 'range';
            inp.min = min;
            inp.max = max;
            inp.step = step;
            inp.value = initialVal;
            inp.style.width = '100%';

            inp.oninput = function() {
                var v = parseFloat(inp.value);
                lbl.textContent = label + ': ' + Math.round(v) + 'Hz';
                onChange(v);
            };

            inp.onchange = function() {
                saveSettings();
            };

            container.appendChild(lbl);
            container.appendChild(inp);
            return {
                element: container,
                setRange: function(minValue, maxValue) {
                    inp.min = minValue;
                    inp.max = maxValue;
                },
                setValue: function(value) {
                    inp.value = value;
                    lbl.textContent = label + ': ' + Math.round(value) + 'Hz';
                }
            };
        }

        var eqHint = document.createElement('div');
        eqHint.textContent = 'Equalizer (Air)';
        eqHint.style.cssText = 'font-size: 10px; color: #aaa; margin-bottom: 5px; font-weight: 600;';
        menu.appendChild(eqHint);

        menu.appendChild(createSlider('Air Gain (dB)', 'airGain', 0, 20, 0.5));

        var sep = document.createElement('div');
        sep.style.cssText = 'border-bottom: 1px solid #444; margin: 8px 0;';
        menu.appendChild(sep);

        menu.appendChild(createSlider('Max Boost', 'maxBoost', 1.0, 50.0, 1.0));
        menu.appendChild(createSlider('Gate Threshold', 'gateThresh', 0.000, 0.020, 0.0005, null, 4));
        menu.appendChild(createSlider('Hang Time (s)', 'hangTime', 0.0, 2.0, 0.1));
        menu.appendChild(createSlider('Recovery (s)', 'recoveryTime', 0.1, 5.0, 0.1));
        menu.appendChild(createSlider('Comp Volume', 'compGain', 0.05, 1.0, 0.01));

        let modKey = get_config_mode(last_modulation);
        let base = CONFIG[modKey];
        let currHPF = (override_settings.compHPF !== null && override_settings.compHPF !== undefined) ? override_settings.compHPF : (base.compHPF || 300);
        let currLPF = (override_settings.compLPF !== null && override_settings.compLPF !== undefined) ? override_settings.compLPF : (base.compLPF || 3000);
        let currCenter = (currHPF + currLPF) / 2;
        let currWidth = currLPF - currHPF;
        let minCenter = 50 + currWidth / 2;
        let maxCenter = 8000 - currWidth / 2;

        let centerSlider;
        function applyCompBand(center, width) {
            currWidth = Math.max(100, Math.min(7500, width));
            minCenter = 50 + currWidth / 2;
            maxCenter = 8000 - currWidth / 2;
            currCenter = Math.max(minCenter, Math.min(maxCenter, center));
            let newH = currCenter - currWidth / 2;
            let newL = currCenter + currWidth / 2;
            override_settings.compHPF = newH;
            override_settings.compLPF = newL;
            override_settings.airFreq = newL;
            if (centerSlider) {
                centerSlider.setRange(minCenter, maxCenter);
                centerSlider.setValue(currCenter);
            }
            apply_filter_settings();
        }

        centerSlider = createCustomSlider('Comp Center', minCenter, maxCenter, 50, currCenter, function(val) {
            applyCompBand(val, currWidth);
        });
        menu.appendChild(centerSlider.element);

        const widthSlider = createCustomSlider('Comp Width', 100, 7500, 50, currWidth, function(val) {
            applyCompBand(currCenter, val);
        });
        menu.appendChild(widthSlider.element);

        var btnDef = document.createElement('button');
        btnDef.textContent = 'Default';
        btnDef.style.cssText = 'margin-top: 5px; width: 100%; height: 24px; background: #444; color: #fff; border: none; border-radius: 3px; cursor: pointer; font-size: 11px; user-select: none; -webkit-user-select: none;';
        btnDef.onclick = function() {
            override_settings.maxBoost = null;
            override_settings.gateThresh = null;
            override_settings.hangTime = null;
            override_settings.recoveryTime = null;
            override_settings.compGain = null;
            override_settings.compHPF = null;
            override_settings.compLPF = null;
            override_settings.airGain = null;
            override_settings.airFreq = null;
            saveSettings();
            apply_filter_settings();
            menu.remove();
            show_comp_menu(rect);
        };
        menu.appendChild(btnDef);
        });
    }

    function show_dtln_menu(rect) {
        createFloatingMenu('audio-filter-dtln-menu', 'AI Speech Enhancement (DTLN)', rect, 220, function(menu) {

        const aiDefaults = ai_mode_defaults();

        var info = document.createElement('div');
        info.style.cssText = 'font-size: 10px; color: #aaa; margin-bottom: 8px;';
        info.textContent = (dtln.ready && dtln.readyEngine === 'dtln') ? 'Model loaded.' : (dtln.loading ? 'Model loading...' : 'Model will load when enabled.');
        menu.appendChild(info);

        var val = (override_settings.dtln_gain !== null && override_settings.dtln_gain !== undefined) ? override_settings.dtln_gain : 0;

        var lbl = document.createElement('div');
        lbl.textContent = 'Output Gain: ' + val.toFixed(1) + ' dB';
        lbl.style.marginBottom = '2px';

        var inp = document.createElement('input');
        inp.type = 'range';
        inp.min = -12;
        inp.max = 24;
        inp.step = 0.5;
        inp.value = val;
        inp.style.width = '100%';

        inp.oninput = function() {
            var v = parseFloat(inp.value);
            lbl.textContent = 'Output Gain: ' + v.toFixed(1) + ' dB';
            override_settings.dtln_gain = v;
            apply_filter_settings();
        };
        inp.onchange = function() { saveSettings(); };

        menu.appendChild(lbl);
        menu.appendChild(inp);

        var floorVal = (override_settings.dtln_floor !== null && override_settings.dtln_floor !== undefined) ? override_settings.dtln_floor : aiDefaults.dtlnFloor;
        var floorLbl = document.createElement('div');
        floorLbl.textContent = 'Speech Floor: ' + Math.round(floorVal * 100) + '%';
        floorLbl.style.cssText = 'margin-top: 8px; margin-bottom: 2px;';
        var floorInp = document.createElement('input');
        floorInp.type = 'range';
        floorInp.min = 0;
        floorInp.max = 0.6;
        floorInp.step = 0.01;
        floorInp.value = floorVal;
        floorInp.style.width = '100%';
        floorInp.oninput = function() {
            var v = parseFloat(floorInp.value);
            floorLbl.textContent = 'Speech Floor: ' + Math.round(v * 100) + '%';
            override_settings.dtln_floor = v;
            apply_filter_settings();
        };
        floorInp.onchange = function() { saveSettings(); };
        menu.appendChild(floorLbl);
        menu.appendChild(floorInp);

        var mixVal = (override_settings.dtln_mix !== null && override_settings.dtln_mix !== undefined) ? override_settings.dtln_mix : aiDefaults.dtlnMix;
        var mixLbl = document.createElement('div');
        mixLbl.textContent = 'Intensity (Wet/Dry): ' + Math.round(mixVal * 100) + '%';
        mixLbl.style.cssText = 'margin-top: 8px; margin-bottom: 2px;';
        var mixInp = document.createElement('input');
        mixInp.type = 'range';
        mixInp.min = 0.2;
        mixInp.max = 1;
        mixInp.step = 0.01;
        mixInp.value = mixVal;
        mixInp.style.width = '100%';
        mixInp.oninput = function() {
            var v = parseFloat(mixInp.value);
            mixLbl.textContent = 'Intensity (Wet/Dry): ' + Math.round(v * 100) + '%';
            override_settings.dtln_mix = v;
            apply_filter_settings();
        };
        mixInp.onchange = function() { saveSettings(); };
        menu.appendChild(mixLbl);
        menu.appendChild(mixInp);

        var presenceVal = (override_settings.dtln_presence !== null && override_settings.dtln_presence !== undefined) ? override_settings.dtln_presence : 0.3;
        var presenceLbl = document.createElement('div');
        presenceLbl.textContent = 'Clarity/Presence: ' + presenceVal.toFixed(2);
        presenceLbl.style.cssText = 'margin-top: 8px; margin-bottom: 2px;';
        var presenceInp = document.createElement('input');
        presenceInp.type = 'range';
        presenceInp.min = 0;
        presenceInp.max = get_config_mode(last_modulation) === 'ssb' ? 3.0 : 1.5;
        presenceInp.step = 0.05;
        presenceInp.value = presenceVal;
        presenceInp.style.width = '100%';
        presenceInp.oninput = function() {
            var v = parseFloat(presenceInp.value);
            presenceLbl.textContent = 'Clarity/Presence: ' + v.toFixed(2);
            override_settings.dtln_presence = v;
            apply_filter_settings();
        };
        presenceInp.onchange = function() { saveSettings(); };
        menu.appendChild(presenceLbl);
        menu.appendChild(presenceInp);

        var btnDef = document.createElement('button');
        btnDef.textContent = 'Default';
        btnDef.style.cssText = 'margin-top: 10px; width: 100%; height: 24px; background: #444; color: #fff; border: none; border-radius: 3px; cursor: pointer; font-size: 11px; user-select: none; -webkit-user-select: none;';
        btnDef.onclick = function() {
            override_settings.dtln_gain = null;
            override_settings.dtln_floor = null;
            override_settings.dtln_presence = null;
            override_settings.dtln_mix = null;
            saveSettings();
            apply_filter_settings();
            menu.remove();
            show_dtln_menu(rect);
        };
        menu.appendChild(btnDef);
        });
    }

    function show_rnnoise_menu(rect) {
        createFloatingMenu('audio-filter-rnnoise-menu', 'AI Speech Enhancement (RNNoise)', rect, 220, function(menu) {

        const aiDefaults = ai_mode_defaults();

        var info = document.createElement('div');
        info.style.cssText = 'font-size: 10px; color: #aaa; margin-bottom: 8px;';
        info.textContent = (dtln.ready && dtln.readyEngine === 'rnnoise') ? 'Model loaded.' : (dtln.loading ? 'Model loading...' : 'Model will load when enabled.');
        menu.appendChild(info);

        var val = (override_settings.dtln_gain !== null && override_settings.dtln_gain !== undefined) ? override_settings.dtln_gain : 0;

        var lbl = document.createElement('div');
        lbl.textContent = 'Output Gain: ' + val.toFixed(1) + ' dB';
        lbl.style.marginBottom = '2px';

        var inp = document.createElement('input');
        inp.type = 'range';
        inp.min = -12;
        inp.max = 24;
        inp.step = 0.5;
        inp.value = val;
        inp.style.width = '100%';

        inp.oninput = function() {
            var v = parseFloat(inp.value);
            lbl.textContent = 'Output Gain: ' + v.toFixed(1) + ' dB';
            override_settings.dtln_gain = v;
            apply_filter_settings();
        };
        inp.onchange = function() { saveSettings(); };

        menu.appendChild(lbl);
        menu.appendChild(inp);

        function addRnSlider(label, key, min, max, step, defVal, fmt) {
            var v = (override_settings[key] !== null && override_settings[key] !== undefined) ? override_settings[key] : defVal;
            var l = document.createElement('div');
            l.textContent = label + ': ' + fmt(v);
            l.style.cssText = 'margin-top: 8px; margin-bottom: 2px;';
            var s = document.createElement('input');
            s.type = 'range';
            s.min = min;
            s.max = max;
            s.step = step;
            s.value = v;
            s.style.width = '100%';
            s.oninput = function() {
                var x = parseFloat(s.value);
                l.textContent = label + ': ' + fmt(x);
                override_settings[key] = x;
                apply_filter_settings();
            };
            s.onchange = function() { saveSettings(); };
            menu.appendChild(l);
            menu.appendChild(s);
        }

        addRnSlider('Speech Level', 'rn_target', 0.1, 1.0, 0.05, aiDefaults.rnTarget, function(v) { return Math.round(v * 100) + '%'; });
        addRnSlider('Max Boost', 'rn_boost', 6, 80, 1, aiDefaults.rnBoost, function(v) { return Math.round(20 * Math.log10(v)) + ' dB'; });
        addRnSlider('Speech Preserve', 'rn_mix', 0.3, 1.0, 0.05, aiDefaults.rnMix, function(v) { return Math.round((1 - v) * 100) + '%'; });

        var btnDef = document.createElement('button');
        btnDef.textContent = 'Default';
        btnDef.style.cssText = 'margin-top: 10px; width: 100%; height: 24px; background: #444; color: #fff; border: none; border-radius: 3px; cursor: pointer; font-size: 11px; user-select: none; -webkit-user-select: none;';
        btnDef.onclick = function() {
            override_settings.dtln_gain = null;
            override_settings.rn_target = null;
            override_settings.rn_boost = null;
            override_settings.rn_mix = null;
            saveSettings();
            apply_filter_settings();
            menu.remove();
            show_rnnoise_menu(rect);
        };
        menu.appendChild(btnDef);
        });
    }

    function show_settings_menu(rect) {
        createFloatingMenu('audio-filter-settings-menu', 'Plugin Settings', rect, 150, function(menu) {

        function build_export_settings() {
            var modes = {};
            Object.keys(CONFIG).forEach(function (mode) {
                modes[mode] = {};
                SETTING_KEYS.forEach(function (key) {
                    var override = settings_store[mode] && settings_store[mode][key];
                    modes[mode][key] = override !== null && override !== undefined ?
                        override : (Object.prototype.hasOwnProperty.call(CONFIG[mode], key) ? CONFIG[mode][key] : null);
                });
            });

            return {
                version: 2,
                modes: modes,
                enabled: {
                    equalizer: is_filter_enabled,
                    noiseReduction: is_nr_enabled,
                    noiseBlanker: is_nb_enabled,
                    humFilter: is_hum_filter_enabled,
                    compressor: is_compressor_enabled,
                    speechExpander: is_expander_enabled,
                    outputLimiter: is_limiter_enabled,
                    autoNotch: is_autonotch_enabled,
                    loudness: is_loudness_enabled,
                    aiSpeechEnhancement: is_dtln_enabled,
                    aiEngine: is_dtln_enabled ? dtln.engine : 'none'
                },
                visualization: {
                    graph: localStorage.getItem('openwebrx-audio-filter-show-graph') === 'true',
                    inputSpectrum: show_input_spectrum,
                    outputSpectrum: show_output_spectrum
                }
            };
        }

        var btnExport = document.createElement('button');
        btnExport.textContent = 'Export Settings';
        btnExport.style.cssText = 'width: 100%; margin-bottom: 5px; height: 24px; background: #444; color: #fff; border: none; border-radius: 3px; cursor: pointer; user-select: none; -webkit-user-select: none;';
        btnExport.onclick = function() {
            var dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(build_export_settings(), null, 2));
            var downloadAnchorNode = document.createElement('a');
            downloadAnchorNode.setAttribute("href", dataStr);
            downloadAnchorNode.setAttribute("download", "audio_filter_settings.json");
            document.body.appendChild(downloadAnchorNode);
            downloadAnchorNode.click();
            downloadAnchorNode.remove();
            menu.remove();
        };
        menu.appendChild(btnExport);

        var btnImport = document.createElement('button');
        btnImport.textContent = 'Import Settings';
        btnImport.style.cssText = 'width: 100%; height: 24px; background: #444; color: #fff; border: none; border-radius: 3px; cursor: pointer; user-select: none; -webkit-user-select: none;';
        btnImport.onclick = function() {
            var input = document.createElement('input');
            input.type = 'file';
            input.accept = '.json';
            input.onchange = function(e) {
                var file = e.target.files[0];
                if (!file) return;
                var reader = new FileReader();
                reader.onload = function(e) {
                    try {
                        var s = JSON.parse(e.target.result);
                        var importedModes = s && s.modes ? s.modes : s;
                        if (importedModes && (importedModes.ssb || importedModes.am)) {
                            settings_store = Object.assign({
                                ssb: create_empty_settings(),
                                am: create_empty_settings(),
                                cw: create_empty_settings(),
                                nfm: create_empty_settings(),
                                wfm: create_empty_settings(),
                                digital: create_empty_settings()
                            }, importedModes);
                            localStorage.setItem('openwebrx-audio-filter-settings', JSON.stringify(settings_store));

                            if (s.enabled) {
                                is_filter_enabled = !!s.enabled.equalizer;
                                is_nr_enabled = !!s.enabled.noiseReduction;
                                is_nb_enabled = !!s.enabled.noiseBlanker;
                                is_hum_filter_enabled = !!s.enabled.humFilter;
                                is_compressor_enabled = !!s.enabled.compressor;
                                is_expander_enabled = !!s.enabled.speechExpander;
                                is_limiter_enabled = !!s.enabled.outputLimiter;
                                is_autonotch_enabled = !!s.enabled.autoNotch;
                                is_loudness_enabled = !!s.enabled.loudness;
                                is_dtln_enabled = !!s.enabled.aiSpeechEnhancement;
                                dtln.engine = (s.enabled.aiEngine && s.enabled.aiEngine !== 'none') ? s.enabled.aiEngine : 'dtln';
                                if (dtln.engine === 'df') dtln.engine = 'dtln';
                                dtln.enabled = is_dtln_enabled;
                                localStorage.setItem('openwebrx-audio-filter-enabled', is_filter_enabled);
                                localStorage.setItem('openwebrx-audio-filter-nr', is_nr_enabled);
                                localStorage.setItem('openwebrx-audio-filter-declick', is_nb_enabled);
                                localStorage.setItem('openwebrx-audio-filter-hum', is_hum_filter_enabled);
                                localStorage.setItem('openwebrx-audio-filter-compressor', is_compressor_enabled);
                                localStorage.setItem('openwebrx-audio-filter-expander', is_expander_enabled);
                                localStorage.setItem('openwebrx-audio-filter-limiter', is_limiter_enabled);
                                localStorage.setItem('openwebrx-audio-filter-autonotch', is_autonotch_enabled);
                                localStorage.setItem('openwebrx-audio-filter-loudness', is_loudness_enabled);
                                localStorage.setItem('openwebrx-audio-filter-ai-engine', is_dtln_enabled ? dtln.engine : 'none');
                                if (is_dtln_enabled) {
                                    dtln_reset_runtime();
                                    ai_ensure_loaded();
                                }
                            }
                            if (s.visualization) {
                                show_input_spectrum = !!s.visualization.inputSpectrum;
                                show_output_spectrum = !!s.visualization.outputSpectrum;
                                localStorage.setItem('openwebrx-audio-filter-show-graph', !!s.visualization.graph);
                                localStorage.setItem('openwebrx-audio-filter-show-in-spec', show_input_spectrum);
                                localStorage.setItem('openwebrx-audio-filter-show-out-spec', show_output_spectrum);
                            }
                            // Apply current
                            let modKey = get_config_mode(last_modulation);
                            if (settings_store[modKey]) {
                                override_settings = JSON.parse(JSON.stringify(settings_store[modKey]));
                            }
                            apply_filter_settings();
                            update_fil_button_state();
                        } else {
                            alert('Invalid settings file.');
                        }
                    } catch(err) {
                        console.error(`[${PLUGIN_ID}] Error importing settings:`, err);
                        alert('Error importing settings: ' + err.message);
                    }
                };
                reader.readAsText(file);
            };
            input.click();
            menu.remove();
        };
        menu.appendChild(btnImport);
        });
    }

    function show_notch_menu(rect) {
        createFloatingMenu('audio-filter-notch-menu', 'Notch Settings', rect, 200, function(menu) {

        function createSlider(label, key, min, max, step) {
            var container = document.createElement('div');
            container.style.marginBottom = '8px';

            var defVal = CONFIG[get_config_mode(last_modulation)][key];
            if (defVal === undefined) {
                if (key === 'maxNotches') defVal = 4;
                else if (key === 'notchRange') defVal = 4000;
                else if (key === 'notchCenter') {
                    let nr = (override_settings.notchRange !== null && override_settings.notchRange !== undefined) ? override_settings.notchRange : 4000;
                    defVal = nr / 2;
                }
                else defVal = 30;
            }

            var val = (override_settings[key] !== null && override_settings[key] !== undefined) ? override_settings[key] : defVal;

            var lbl = document.createElement('div');
            lbl.textContent = label + ': ' + val;
            lbl.style.marginBottom = '2px';

            var inp = document.createElement('input');
            inp.type = 'range';
            inp.min = min;
            inp.max = max;
            inp.step = step;
            inp.value = val;
            inp.style.width = '100%';

            inp.oninput = function() {
                var v = parseFloat(inp.value);
                lbl.textContent = label + ': ' + v;
                override_settings[key] = v;
                apply_filter_settings();
            };

            inp.onchange = function() {
                saveSettings();
            };

            container.appendChild(lbl);
            container.appendChild(inp);
            return container;
        }

        menu.appendChild(createSlider('Notch Q (Sharpness)', 'notchQ', 1, 50, 1));
        menu.appendChild(createSlider('Max Notches', 'maxNotches', 1, 4, 1));
        menu.appendChild(createSlider('Detection Center (Hz)', 'notchCenter', 250, 8000, 50));
        menu.appendChild(createSlider('Detection Width (Hz)', 'notchRange', 500, 8000, 100));

        var btnDef = document.createElement('button');
        btnDef.textContent = 'Default';
        btnDef.style.cssText = 'margin-top: 5px; width: 100%; height: 24px; background: #444; color: #fff; border: none; border-radius: 3px; cursor: pointer; font-size: 11px; user-select: none; -webkit-user-select: none;';
        btnDef.onclick = function() {
            override_settings.notchQ = null;
            override_settings.maxNotches = null;
            override_settings.notchRange = null;
            override_settings.notchCenter = null;
            saveSettings();
            menu.remove();
            show_notch_menu(rect);
            apply_filter_settings();
        };
        menu.appendChild(btnDef);
        });
    }

    function show_nr_menu(rect) {
        createFloatingMenu('audio-filter-nr-menu', 'Spectral Noise Reduction', rect, 200, function(menu) {

        function createSlider(label, key, min, max, step, scale) {
            var container = document.createElement('div');
            container.style.marginBottom = '8px';

            var defVal = CONFIG[get_config_mode(last_modulation)][key];
            if (defVal === undefined) {
                if (key === 'nr_gain') defVal = 0;
                else if (key === 'nr_alpha') defVal = 0.95;
                else if (key === 'nr_snr') defVal = 10;
                else if (key === 'nr_comb') defVal = 0.5;
            }
            var val = (override_settings[key] !== null && override_settings[key] !== undefined) ? override_settings[key] : defVal;

            var lbl = document.createElement('div');
            lbl.textContent = label + ': ' + (val * (scale || 1)).toFixed(scale ? 0 : 4);
            lbl.style.marginBottom = '2px';

            var inp = document.createElement('input');
            inp.type = 'range';
            inp.min = min;
            inp.max = max;
            inp.step = step;
            inp.value = val;
            inp.style.width = '100%';

            inp.oninput = function() {
                var v = parseFloat(inp.value);
                lbl.textContent = label + ': ' + (v * (scale || 1)).toFixed(scale ? 0 : 4);
                override_settings[key] = v;
                apply_filter_settings();
            };
            inp.onchange = function() { saveSettings(); };

            container.appendChild(lbl);
            container.appendChild(inp);
            return container;
        }

        menu.appendChild(createSlider('Gain (dB)', 'nr_gain', -60, 60, 1, 1));
        menu.appendChild(createSlider('Alpha (Smooth)', 'nr_alpha', 0.90, 0.9999, 0.0001));
        menu.appendChild(createSlider('Active SNR (dB)', 'nr_snr', -10, 40, 1, 1));

        menu.appendChild(createSlider('Comb Strength', 'nr_comb', 0.0, 1.0, 0.05));

        var speechDiv = document.createElement('div');
        speechDiv.style.marginTop = '10px';
        speechDiv.style.borderTop = '1px solid #444';
        speechDiv.style.paddingTop = '5px';

        var speechLbl = document.createElement('label');
        speechLbl.style.display = 'flex';
        speechLbl.style.alignItems = 'center';
        speechLbl.style.cursor = 'pointer';

        var speechChk = document.createElement('input');
        speechChk.type = 'checkbox';

        let modKey = get_config_mode(last_modulation);
        let base = CONFIG[modKey];
        speechChk.checked = (override_settings.nr_speech_mode !== null && override_settings.nr_speech_mode !== undefined) ? override_settings.nr_speech_mode : (base.nr_speech_mode !== undefined ? base.nr_speech_mode : false);

        speechChk.style.marginRight = '8px';
        speechChk.onchange = function() {
            override_settings.nr_speech_mode = speechChk.checked;
            apply_filter_settings();
            saveSettings();
        };

        speechLbl.appendChild(speechChk);
        speechLbl.appendChild(document.createTextNode('Speech Mode (Fast Adapt)'));
        speechDiv.appendChild(speechLbl);
        menu.appendChild(speechDiv);
        });
    }

    function update_fil_button_state() {
        var win = document.getElementById('plugin-window-' + PLUGIN_ID);
        var fallbackPanel = document.getElementById('audio-filter-floating-panel');
        var isVisible = false;
        if (win) {
            isVisible = (typeof $ !== 'undefined') ? $(win).is(':visible') : (win.style.display !== 'none');
        } else if (fallbackPanel) {
            isVisible = fallbackPanel.style.display !== 'none';
        }

        var active = is_filter_enabled || is_autonotch_enabled || is_nb_enabled || is_hum_filter_enabled || is_compressor_enabled || is_expander_enabled || is_limiter_enabled || is_nr_enabled || is_dtln_enabled;

        var extBtn = document.getElementById('plugin-button-' + PLUGIN_ID);
        if (extBtn) {
            extBtn.style.color = active? '#39FF14' : '';
        }

        var btn = document.getElementById('audio-filter-toggle-btn');
        if (btn) {
            if (isVisible) {
                btn.style.color = '#39FF14';
                btn.style.borderColor = '#39FF14';
            } else if (active) {
                btn.style.color = 'yellow';
                btn.style.borderColor = 'yellow';
            } else {
                btn.style.color = '#aaa';
                btn.style.borderColor = '#666';
            }
        }
    }

})();