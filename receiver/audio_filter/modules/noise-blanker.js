(function (root) {
    'use strict';

    function createState() {
        return {
            average: 0.1,
            envelope: 0,
            previousAbs: 0,
            blankCounter: 0,
            cooldown: 0,
            nbSampleCounter: 0,
            nbLastImpulse: -1,
            nbPeriodEstimate: 0,
            nbPeriodStableCount: 0
        };
    }

    function updateImpulseTiming(state, sampleRate) {
        const interval = state.nbLastImpulse >= 0 ? state.nbSampleCounter - state.nbLastImpulse : 0;
        if (interval > 0) {
            const minInterval = sampleRate * 0.0005;
            const maxInterval = sampleRate * 0.05;
            if (interval < minInterval || interval > maxInterval) {
                state.nbPeriodEstimate = 0;
                state.nbPeriodStableCount = 0;
            } else if (state.nbPeriodEstimate === 0) {
                state.nbPeriodEstimate = interval;
                state.nbPeriodStableCount = 0;
            } else {
                const cycles = Math.round(interval / state.nbPeriodEstimate);
                const expectedInterval = cycles * state.nbPeriodEstimate;
                const tolerance = Math.max(2, expectedInterval * 0.08);
                if (cycles >= 1 && cycles <= 4 && Math.abs(interval - expectedInterval) <= tolerance) {
                    const measuredPeriod = interval / cycles;
                    state.nbPeriodEstimate += (measuredPeriod - state.nbPeriodEstimate) * 0.2;
                    state.nbPeriodStableCount = Math.min(state.nbPeriodStableCount + 1, 8);
                } else {
                    state.nbPeriodEstimate = interval;
                    state.nbPeriodStableCount = 0;
                }
            }
        }
        state.nbLastImpulse = state.nbSampleCounter;
        return state.nbPeriodStableCount >= 4;
    }

    function isExpectedImpulse(state) {
        if (state.nbPeriodStableCount < 4 || state.nbPeriodEstimate <= 0) return false;
        const elapsed = state.nbSampleCounter - state.nbLastImpulse;
        if (elapsed < state.nbPeriodEstimate * 0.5) return false;
        const cycles = Math.round(elapsed / state.nbPeriodEstimate);
        if (cycles < 1 || cycles > 4) return false;
        return Math.abs(elapsed - cycles * state.nbPeriodEstimate) <= Math.max(2, state.nbPeriodEstimate * 0.12);
    }

    function processSample(state, sample, settings, sampleRate) {
        if (!settings.nb_enabled) return sample;
        const absolute = Math.abs(sample);
        const clipped = Math.min(absolute, Math.max(state.average * 4, 0.002));
        state.average = state.average * 0.9995 + clipped * 0.0005;
        if (state.average < 0.0002) state.average = 0.0002;
        state.envelope = state.envelope * 0.82 + absolute * 0.18;
        const strongImpulse = absolute > state.average * 4 &&
            absolute > Math.max(state.envelope * 2.2, state.average * 6) &&
            absolute - state.previousAbs > Math.max(state.average * 2, 0.0004);
        const periodicImpulse = isExpectedImpulse(state) &&
            absolute > state.average * 3 &&
            absolute > Math.max(state.envelope * 1.5, state.average * 4.5) &&
            absolute - state.previousAbs > Math.max(state.average * 1.2, 0.0003);
        const impulse = strongImpulse || periodicImpulse;

        if (state.blankCounter > 0) {
            sample *= 0.08;
            state.blankCounter--;
        } else if (state.cooldown > 0) {
            state.cooldown--;
        } else if (settings.nb_enabled && impulse) {
            const periodLocked = updateImpulseTiming(state, sampleRate);
            const blankLength = periodLocked ? Math.min(state.nbPeriodEstimate * 0.35, sampleRate * 0.0007) : sampleRate * 0.00035;
            state.blankCounter = Math.max(4, Math.round(blankLength));
            state.cooldown = Math.max(2, Math.round(sampleRate * 0.00015));
            sample *= 0.08;
        }

        state.previousAbs = absolute;
        state.nbSampleCounter++;
        return sample;
    }

    const workletSource = `
        ${updateImpulseTiming.toString()}
        ${isExpectedImpulse.toString()}
        function processNoiseBlanker(processor, sample, settings, rate) {
            const absolute = Math.abs(sample);
            const clipped = Math.min(absolute, Math.max(processor.average * 4, 0.002));
            processor.average = processor.average * 0.9995 + clipped * 0.0005;
            if (processor.average < 0.0002) processor.average = 0.0002;
            processor.nbEnvelope = processor.nbEnvelope * 0.82 + absolute * 0.18;
            const slope = absolute - processor.nbPreviousAbs;
            const strongImpulse = absolute > processor.average * 4 &&
                absolute > Math.max(processor.nbEnvelope * 2.2, processor.average * 6) &&
                slope > Math.max(processor.average * 2, 0.0004);
            const periodicImpulse = isExpectedImpulse(processor) &&
                absolute > processor.average * 3 &&
                absolute > Math.max(processor.nbEnvelope * 1.5, processor.average * 4.5) &&
                slope > Math.max(processor.average * 1.2, 0.0003);
            const impulse = strongImpulse || periodicImpulse;
            if (processor.blankCounter > 0) {
                sample *= 0.08;
                processor.blankCounter--;
            } else if (processor.nbCooldown > 0) {
                processor.nbCooldown--;
            } else if (impulse) {
                const periodLocked = updateImpulseTiming(processor, rate);
                const blankLength = periodLocked ? Math.min(processor.nbPeriodEstimate * 0.35, rate * 0.0007) : rate * 0.00035;
                processor.blankCounter = Math.max(4, Math.round(blankLength));
                processor.nbCooldown = Math.max(2, Math.round(rate * 0.00015));
                sample *= 0.08;
            }
            processor.nbPreviousAbs = absolute;
            processor.nbSampleCounter++;
            return sample;
        }
    `;

    root.AudioFilterModules = root.AudioFilterModules || {};
    root.AudioFilterModules.noiseBlanker = {
        createState: createState,
        processSample: processSample,
        workletSource: workletSource
    };
})(window);
