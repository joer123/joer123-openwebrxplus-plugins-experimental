(function (root) {
    'use strict';

    function createState() {
        return { envelope: 0, gain: 1, hang: 0 };
    }

    function processSample(state, sample, settings, sampleRate) {
        if (!settings.comp_enabled) return sample;
        const absolute = Math.abs(sample);
        const envelopeDecay = Math.exp(-1 / (0.05 * sampleRate));
        if (absolute > state.envelope) state.envelope = absolute;
        else state.envelope = state.envelope * envelopeDecay + absolute * (1 - envelopeDecay);
        const gate = Math.max(settings.gateThresh || 0.0025, 0.000001);
        let target = (settings.agcTarget || 0.5) / (state.envelope + 0.000001);
        target = Math.min(target, settings.maxBoost || 20);
        if (state.envelope < gate) {
            target *= Math.pow(state.envelope / gate, 1.3);
        }
        if (target < state.gain) {
            state.gain = target;
            state.hang = Math.floor((settings.hangTime || 0.2) * sampleRate);
        } else if (state.hang > 0) {
            state.hang--;
        } else {
            const recovery = Math.max(settings.recoveryTime || 0.5, 0.001);
            const recoveryFactor = Math.exp(-1 / (recovery * sampleRate));
            state.gain = state.gain * recoveryFactor + target * (1 - recoveryFactor);
        }
        return Math.tanh(sample * state.gain) * (settings.compGain || 0.1);
    }

    const workletSource = `
        function processCompressor(processor, sample, settings, rate) {
            const absolute = Math.abs(sample);
            if (absolute > processor.envelope) processor.envelope = absolute;
            else {
                const decay = Math.exp(-1 / (0.05 * rate));
                processor.envelope = processor.envelope * decay + absolute * (1 - decay);
            }
            const gate = Math.max(settings.gateThresh || 0.0025, 0.000001);
            let target = (settings.agcTarget || 0.5) / (processor.envelope + 0.000001);
            target = Math.min(target, settings.maxBoost || 20);
            if (processor.envelope < gate) target *= Math.pow(processor.envelope / gate, 1.3);
            if (target < processor.gain) {
                processor.gain = target;
                processor.hang = Math.floor((settings.hangTime || 0.2) * rate);
            } else if (processor.hang > 0) processor.hang--;
            else {
                const recovery = Math.max(settings.recoveryTime || 0.5, 0.001);
                const recoveryFactor = Math.exp(-1 / (recovery * rate));
                processor.gain = processor.gain * recoveryFactor + target * (1 - recoveryFactor);
            }
            return Math.tanh(sample * processor.gain) * (settings.compGain || 0.1);
        }
    `;

    root.AudioFilterModules = root.AudioFilterModules || {};
    root.AudioFilterModules.compressor = {
        createState: createState,
        processSample: processSample,
        workletSource: workletSource
    };
})(window);
