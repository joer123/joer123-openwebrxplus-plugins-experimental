(function (root) {
    'use strict';

    let analysisBuffer = null;

    function createNodes(ctx, count) {
        const notches = [];
        for (let i = 0; i < count; i++) {
            const notch = ctx.createBiquadFilter();
            notch.type = 'notch';
            notch.frequency.value = 0;
            notch.Q.value = 20;
            notch.isCustomFilter = true;
            notches.push(notch);
        }
        return notches;
    }

    function setSharpness(notches, q) {
        notches.forEach(function (notch) {
            if (notch) notch.Q.value = q;
        });
    }

    function disable(notches) {
        notches.forEach(function (notch) { notch.frequency.value = 0; });
    }

    function process(analyser, notches, settings, state) {
        if (!analyser || !notches || notches.length === 0) return;

        const bufferLength = analyser.frequencyBinCount;
        if (!analysisBuffer || analysisBuffer.length !== bufferLength) {
            analysisBuffer = new Float32Array(bufferLength);
        }
        analyser.getFloatFrequencyData(analysisBuffer);

        const binSize = analyser.context.sampleRate / analyser.fftSize;
        const range = settings.notchRange !== null && settings.notchRange !== undefined ? settings.notchRange : 4000;
        const center = settings.notchCenter !== null && settings.notchCenter !== undefined ? settings.notchCenter : range / 2;
        const startBin = Math.floor(Math.max(50, center - range / 2) / binSize);
        const endBin = Math.floor((center + range / 2) / binSize);

        let sum = 0;
        let count = 0;
        for (let i = startBin; i < endBin; i++) {
            if (analysisBuffer[i] > -150) {
                sum += analysisBuffer[i];
                count++;
            }
        }
        const currentNoiseFloor = count > 0 ? sum / count : -100;

        if (typeof state.smoothedNoiseFloor === 'undefined') state.smoothedNoiseFloor = currentNoiseFloor;
        if (currentNoiseFloor > state.smoothedNoiseFloor) {
            state.smoothedNoiseFloor = state.smoothedNoiseFloor * 0.98 + currentNoiseFloor * 0.02;
        } else {
            state.smoothedNoiseFloor = state.smoothedNoiseFloor * 0.8 + currentNoiseFloor * 0.2;
        }

        const threshold = state.smoothedNoiseFloor + 4;
        const peaks = [];
        for (let i = startBin + 1; i < endBin - 1; i++) {
            const magnitude = analysisBuffer[i];
            if (magnitude > threshold && magnitude > analysisBuffer[i - 1] && magnitude > analysisBuffer[i + 1]) {
                peaks.push({ freq: i * binSize, mag: magnitude });
            }
        }
        peaks.sort((a, b) => b.mag - a.mag);

        const maxNotches = settings.maxNotches !== null && settings.maxNotches !== undefined ? settings.maxNotches : 4;
        notches.forEach(function (notch) {
            if (typeof notch.notchConfidence === 'undefined') notch.notchConfidence = 0;
            if (typeof notch.notchLastFreq === 'undefined') notch.notchLastFreq = 0;
            if (typeof notch.notchLastMag === 'undefined') notch.notchLastMag = -100;
        });

        notches.forEach(function (notch) {
            if (notch.notchConfidence <= 0) return;

            let bestMatchIndex = -1;
            let minDiff = 60;
            for (let i = 0; i < peaks.length; i++) {
                const diff = Math.abs(peaks[i].freq - notch.notchLastFreq);
                if (diff < minDiff) {
                    minDiff = diff;
                    bestMatchIndex = i;
                }
            }

            if (bestMatchIndex !== -1) {
                notch.notchLastFreq = peaks[bestMatchIndex].freq;
                notch.notchLastMag = peaks[bestMatchIndex].mag;
                notch.notchConfidence = Math.min(notch.notchConfidence + 10, 100);
                peaks.splice(bestMatchIndex, 1);
            } else {
                notch.notchConfidence -= 1;
                notch.notchLastMag = -100;
            }
        });

        let activeCandidates = notches.filter(function (notch) { return notch.notchConfidence > 0; });
        if (activeCandidates.length > maxNotches) {
            activeCandidates.sort(function (a, b) { return a.notchConfidence - b.notchConfidence; });
            while (activeCandidates.length > maxNotches) {
                const victim = activeCandidates.shift();
                victim.notchConfidence = 0;
                victim.notchLastMag = -100;
            }
        }

        while (peaks.length > 0) {
            const peak = peaks.shift();
            const activeNotches = notches.filter(function (notch) { return notch.notchConfidence > 0; });

            if (activeNotches.length < maxNotches) {
                const freeFilter = notches.find(function (notch) { return notch.notchConfidence <= 0; });
                if (freeFilter) {
                    freeFilter.notchLastFreq = peak.freq;
                    freeFilter.notchLastMag = peak.mag;
                    freeFilter.notchConfidence = 50;
                    continue;
                }
            }

            if (activeNotches.length > 0) {
                activeNotches.sort(function (a, b) { return a.notchLastMag - b.notchLastMag; });
                const weakest = activeNotches[0];
                if (peak.mag > weakest.notchLastMag + 6) {
                    weakest.notchLastFreq = peak.freq;
                    weakest.notchLastMag = peak.mag;
                    weakest.notchConfidence = 50;
                }
            }
        }

        notches.forEach(function (notch) {
            if (notch.notchConfidence > 0) {
                const current = notch.frequency.value;
                const target = notch.notchLastFreq;
                notch.frequency.value = current < 10 ? target : current + (target - current) * 0.5;
            } else {
                notch.frequency.value = 0;
                notch.notchLastFreq = 0;
            }
        });
    }

    root.AudioFilterModules = root.AudioFilterModules || {};
    root.AudioFilterModules.autoNotch = {
        createNodes: createNodes,
        setSharpness: setSharpness,
        disable: disable,
        process: process
    };
})(window);