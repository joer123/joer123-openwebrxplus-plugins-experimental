(function (root) {
    'use strict';

    const MAX_HARMONICS = 6;

    function createNodes(ctx) {
        return Array.from({ length: MAX_HARMONICS }, function () {
            const node = ctx.createBiquadFilter();
            node.type = 'notch';
            node.frequency.value = 0;
            node.Q.value = 28;
            node.isCustomFilter = true;
            return node;
        });
    }

    function apply(nodes, enabled, baseFrequency, harmonics, sampleRate) {
        const nyquist = sampleRate / 2;
        nodes.forEach(function (node, index) {
            const frequency = baseFrequency * (index + 1);
            node.frequency.value = enabled && index < harmonics && frequency < nyquist - 10 ? frequency : 0;
        });
    }

    root.AudioFilterModules = root.AudioFilterModules || {};
    root.AudioFilterModules.humFilter = {
        createNodes: createNodes,
        apply: apply,
        maxHarmonics: MAX_HARMONICS
    };
})(window);