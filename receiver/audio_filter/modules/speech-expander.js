(function (root) {
    'use strict';

    function createState() {
        return { envelope: 0, gain: 1 };
    }

    function processSpeechExpanderSample(state, sample, settings, sampleRate) {
        const absolute = Math.abs(sample);
        const envelopeTime = absolute > state.envelope ? 0.008 : 0.09;
        const envelopeCoefficient = Math.exp(-1 / (envelopeTime * sampleRate));
        state.envelope = state.envelope * envelopeCoefficient + absolute * (1 - envelopeCoefficient);

        if (!settings.expander_enabled) {
            state.gain = 1;
            return sample;
        }

        const threshold = Math.pow(10, settings.expanderThresholdDb / 20);
        const floor = Math.pow(10, settings.expanderFloorDb / 20);
        const ratio = Math.max(1, settings.expanderRatio || 2);
        const target = state.envelope < threshold ? Math.max(floor, Math.pow(state.envelope / threshold, ratio - 1)) : 1;
        const gainTime = target < state.gain ? 0.012 : 0.075;
        const gainCoefficient = Math.exp(-1 / (gainTime * sampleRate));
        state.gain = state.gain * gainCoefficient + target * (1 - gainCoefficient);
        return sample * state.gain;
    }

    root.AudioFilterModules = root.AudioFilterModules || {};
    root.AudioFilterModules.speechExpander = {
        createState: createState,
        processSample: processSpeechExpanderSample,
        workletSource: processSpeechExpanderSample.toString()
    };
})(window);