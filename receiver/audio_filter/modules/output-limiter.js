(function (root) {
    'use strict';

    function createState() {
        return { envelope: 0, gain: 1 };
    }

    function processOutputLimiterSample(state, sample, settings, sampleRate) {
        const absolute = Math.abs(sample);
        if (absolute > state.envelope) {
            state.envelope = absolute;
        } else {
            const envelopeCoefficient = Math.exp(-1 / (0.08 * sampleRate));
            state.envelope = state.envelope * envelopeCoefficient + absolute * (1 - envelopeCoefficient);
        }

        if (!settings.limiter_enabled) {
            state.gain = 1;
            return sample;
        }

        const ceiling = Math.pow(10, settings.limiterCeilingDb / 20);
        const target = state.envelope > ceiling ? ceiling / state.envelope : 1;
        if (target < state.gain) {
            state.gain = target;
        } else {
            const releaseCoefficient = Math.exp(-1 / (0.08 * sampleRate));
            state.gain = state.gain * releaseCoefficient + target * (1 - releaseCoefficient);
        }
        return sample * state.gain;
    }

    root.AudioFilterModules = root.AudioFilterModules || {};
    root.AudioFilterModules.outputLimiter = {
        createState: createState,
        processSample: processOutputLimiterSample,
        workletSource: processOutputLimiterSample.toString()
    };
})(window);