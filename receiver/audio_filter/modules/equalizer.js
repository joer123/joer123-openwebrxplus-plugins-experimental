(function (root) {
    'use strict';

    function createNodes(ctx) {
        const highpass = ctx.createBiquadFilter();
        highpass.type = 'highpass';
        highpass.frequency.value = 0;
        highpass.isCustomFilter = true;

        const loudness = ctx.createBiquadFilter();
        loudness.type = 'lowshelf';
        loudness.frequency.value = 150;
        loudness.gain.value = 0;
        loudness.isCustomFilter = true;

        const peaking = ctx.createBiquadFilter();
        peaking.type = 'peaking';
        peaking.frequency.value = 2000;
        peaking.Q.value = 1;
        peaking.gain.value = 0;
        peaking.isCustomFilter = true;

        const air = ctx.createBiquadFilter();
        air.type = 'highshelf';
        air.frequency.value = 12000;
        air.gain.value = 0;
        air.isCustomFilter = true;

        const lowpass = ctx.createBiquadFilter();
        lowpass.type = 'lowpass';
        lowpass.frequency.value = (ctx.sampleRate / 2) - 100;
        lowpass.isCustomFilter = true;

        const gain = ctx.createGain();
        gain.gain.value = 1;
        gain.isCustomFilter = true;

        return { highpass, loudness, peaking, air, lowpass, gain };
    }

    function apply(nodes, settings) {
        if (nodes.highpass) nodes.highpass.frequency.value = settings.highpass;
        if (nodes.lowpass) nodes.lowpass.frequency.value = settings.lowpass;
        if (nodes.gain) nodes.gain.gain.value = settings.gain;
        if (nodes.loudness) nodes.loudness.gain.value = settings.loudnessGain;

        if (nodes.peaking) {
            if (settings.updatePeaking) {
                nodes.peaking.frequency.value = settings.peakingFreq;
                nodes.peaking.Q.value = settings.peakingQ;
            }
            nodes.peaking.gain.value = settings.peakingGain;
        }

        if (nodes.air) {
            nodes.air.gain.value = settings.airGain;
            nodes.air.frequency.value = settings.airFreq;
        }
    }

    root.AudioFilterModules = root.AudioFilterModules || {};
    root.AudioFilterModules.equalizer = { createNodes: createNodes, apply: apply };
})(window);
