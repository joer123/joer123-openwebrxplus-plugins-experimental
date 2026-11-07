(function (root) {
    'use strict';

    function createScriptProcessor(ctx, options) {
        const fftSize = options.fftSize;
        const fftWindow = options.fftWindow;
        const performFFT = options.performFFT;
        const getSettings = options.getSettings;
        const processor = ctx.createScriptProcessor(4096, 1, 1);
        processor.isCustomFilter = true;

        const hopSize = fftSize / 2;
        const bufferSize = 4096;
        const real = new Float32Array(fftSize);
        const imag = new Float32Array(fftSize);
        const noise = new Float32Array(fftSize / 2 + 1).fill(0);
        const lastGain = new Float32Array(fftSize / 2 + 1).fill(1);
        const magnitude = new Float32Array(fftSize / 2 + 1);
        const inputHistory = new Float32Array(bufferSize + fftSize);
        const outputHistory = new Float32Array(bufferSize + fftSize);
        let noiseInitialized = false;
        let wasEnabled = false;

        const reset = function () {
            noiseInitialized = false;
            noise.fill(1e-9);
            lastGain.fill(1);
            inputHistory.fill(0);
            outputHistory.fill(0);
        };

        processor.resetSpectralState = reset;
        processor.onaudioprocess = function (event) {
            const input = event.inputBuffer.getChannelData(0);
            const output = event.outputBuffer.getChannelData(0);
            const settings = getSettings();
            const enabled = !!(settings && settings.enabled);

            if (enabled && !wasEnabled) reset();
            wasEnabled = enabled;

            inputHistory.copyWithin(0, bufferSize, bufferSize + fftSize);
            inputHistory.set(input, fftSize);
            outputHistory.copyWithin(0, bufferSize, bufferSize + fftSize);
            outputHistory.fill(0, fftSize);

            if (!enabled) {
                output.set(input);
                return;
            }

            const alpha = settings.alpha;
            const threshold = Math.pow(10, settings.snr / 20);
            const outputGain = Math.pow(10, settings.gain / 20);
            const comb = settings.comb === undefined ? 0.5 : settings.comb;
            const speechMode = !!settings.speech_mode;
            const alphaForRise = speechMode && alpha > 0.98 ? 0.95 : alpha;
            const noiseRise = 1 + (1 - alphaForRise) * 0.01;

            let blockSilent = true;
            for (let i = 0; i < input.length; i++) {
                if (Math.abs(input[i]) > 0.0005) { blockSilent = false; break; }
            }

            for (let block = 0; block < bufferSize / hopSize; block++) {
                const position = block * hopSize + fftSize - hopSize;
                for (let k = 0; k < fftSize; k++) real[k] = inputHistory[position + k] * fftWindow[k];
                imag.fill(0);
                performFFT(real, imag, false);

                for (let k = 0; k <= fftSize / 2; k++) {
                    const mag = Math.sqrt(real[k] * real[k] + imag[k] * imag[k]);
                    magnitude[k] = mag;
                    if (!blockSilent) {
                        const currentAlpha = speechMode && mag < noise[k] * 0.5 ? 0.90 : alpha;
                        if (mag < noise[k]) noise[k] = currentAlpha * noise[k] + (1 - currentAlpha) * mag;
                        else noise[k] = noise[k] * noiseRise + 1e-6;
                        noise[k] = Math.max(noise[k], 1e-9);
                    }
                }

                if (!noiseInitialized && !blockSilent) {
                    for (let k = 0; k <= fftSize / 2; k++) noise[k] = Math.max(magnitude[k], 1e-6);
                    noiseInitialized = true;
                }

                for (let k = 0; k <= fftSize / 2; k++) {
                    const mag = magnitude[k];
                    const frequency = k * ctx.sampleRate / fftSize;
                    let localThreshold = threshold;
                    const isPeak = k > 1 && k < fftSize / 2 - 1 && mag >= magnitude[k - 1] && mag >= magnitude[k + 1];
                    if (frequency > 100 && frequency < 9000) localThreshold *= isPeak ? 1 - 0.95 * comb : 1 + 0.9 * comb;
                    else localThreshold *= 1.2;

                    const snr = mag / (noise[k] + 0.000001);
                    let gain = snr < localThreshold ? Math.pow(snr / localThreshold, 2) : 1;
                    gain = Math.max(gain, 0.005);
                    lastGain[k] = gain > lastGain[k] ? lastGain[k] * 0.4 + gain * 0.6 : lastGain[k] * 0.95 + gain * 0.05;
                    real[k] *= lastGain[k];
                    imag[k] *= lastGain[k];
                    if (k > 0 && k < fftSize / 2) {
                        real[fftSize - k] *= lastGain[k];
                        imag[fftSize - k] *= lastGain[k];
                    }
                }

                performFFT(real, imag, true);
                for (let k = 0; k < fftSize; k++) outputHistory[position + k] += real[k] * fftWindow[k];
            }

            for (let i = 0; i < bufferSize; i++) output[i] = outputHistory[i] * outputGain;
        };
        return processor;
    }

    const workletSource = `
        function processNoiseReductionBlock(processor, block, workletFft, FFT_SIZE, HOP_SIZE, fftWindow, sampleRate) {
            const settings = processor.settings;
            processor.nrInput.copyWithin(0, 4096, 4096 + FFT_SIZE);
            processor.nrInput.set(block, FFT_SIZE);
            processor.nrOutput.copyWithin(0, 4096, 4096 + FFT_SIZE);
            processor.nrOutput.fill(0, FFT_SIZE);
            const alpha = settings.alpha;
            const threshold = Math.pow(10, settings.snr / 20);
            const outputGain = Math.pow(10, settings.gain / 20);
            const comb = settings.comb === undefined ? 0.5 : settings.comb;
            const speechMode = !!settings.speech_mode;
            const noiseRise = 1 + (1 - (speechMode && alpha > 0.98 ? 0.95 : alpha)) * 0.01;
            let blockSilent = true;
            for (let i = 0; i < block.length; i++) {
                if (Math.abs(block[i]) > 0.0005) { blockSilent = false; break; }
            }
            for (let blockIndex = 0; blockIndex < 8; blockIndex++) {
                const position = blockIndex * HOP_SIZE + FFT_SIZE - HOP_SIZE;
                for (let k = 0; k < FFT_SIZE; k++) processor.nrReal[k] = processor.nrInput[position + k] * fftWindow[k];
                processor.nrImag.fill(0);
                workletFft(processor.nrReal, processor.nrImag, false);
                for (let k = 0; k <= FFT_SIZE / 2; k++) {
                    const magnitude = Math.sqrt(processor.nrReal[k] * processor.nrReal[k] + processor.nrImag[k] * processor.nrImag[k]);
                    processor.nrMagnitude[k] = magnitude;
                    if (!blockSilent) {
                        const currentAlpha = speechMode && magnitude < processor.nrNoise[k] * 0.5 ? 0.90 : alpha;
                        if (magnitude < processor.nrNoise[k]) processor.nrNoise[k] = currentAlpha * processor.nrNoise[k] + (1 - currentAlpha) * magnitude;
                        else processor.nrNoise[k] = processor.nrNoise[k] * noiseRise + 1e-6;
                        processor.nrNoise[k] = Math.max(processor.nrNoise[k], 1e-9);
                    }
                }
                if (!processor.nrInitialized && !blockSilent) {
                    for (let k = 0; k <= FFT_SIZE / 2; k++) processor.nrNoise[k] = Math.max(processor.nrMagnitude[k], 1e-6);
                    processor.nrInitialized = true;
                }
                for (let k = 0; k <= FFT_SIZE / 2; k++) {
                    const magnitude = processor.nrMagnitude[k];
                    const frequency = k * sampleRate / FFT_SIZE;
                    let localThreshold = threshold;
                    const peak = k > 1 && k < FFT_SIZE / 2 - 1 && magnitude >= processor.nrMagnitude[k - 1] && magnitude >= processor.nrMagnitude[k + 1];
                    if (frequency > 100 && frequency < 9000) localThreshold *= peak ? 1 - 0.95 * comb : 1 + 0.9 * comb;
                    else localThreshold *= 1.2;
                    const snr = magnitude / (processor.nrNoise[k] + 0.000001);
                    const gain = Math.max(snr < localThreshold ? Math.pow(snr / localThreshold, 2) : 1, 0.005);
                    processor.nrLastGain[k] = gain > processor.nrLastGain[k] ? processor.nrLastGain[k] * 0.4 + gain * 0.6 : processor.nrLastGain[k] * 0.95 + gain * 0.05;
                    processor.nrReal[k] *= processor.nrLastGain[k];
                    processor.nrImag[k] *= processor.nrLastGain[k];
                    if (k > 0 && k < FFT_SIZE / 2) {
                        processor.nrReal[FFT_SIZE - k] *= processor.nrLastGain[k];
                        processor.nrImag[FFT_SIZE - k] *= processor.nrLastGain[k];
                    }
                }
                workletFft(processor.nrReal, processor.nrImag, true);
                for (let k = 0; k < FFT_SIZE; k++) processor.nrOutput[position + k] += processor.nrReal[k] * fftWindow[k];
            }
            for (let k = 0; k < 4096; k++) processor.nrReady[processor.nrReadyLength + k] = processor.nrOutput[k] * outputGain;
            processor.nrReadyLength += 4096;
        }
    `;

    root.AudioFilterModules = root.AudioFilterModules || {};
    root.AudioFilterModules.noiseReduction = {
        createScriptProcessor: createScriptProcessor,
        workletSource: workletSource
    };
})(window);
